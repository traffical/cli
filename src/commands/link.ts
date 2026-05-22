/**
 * link / unlink commands
 *
 * `traffical link` writes .traffical/project.yaml. Interactive picker if
 * --project / --org aren't supplied. Refuses to overwrite without --force.
 *
 * `traffical unlink` removes the file.
 */

import chalk from "chalk";
import { rm, access } from "fs/promises";
import { select, search } from "@inquirer/prompts";
import {
  ensureTrafficalDir,
  writeProjectLink,
  getProjectLinkPath,
  readProjectLink,
} from "../lib/config.ts";
import { ApiClient, ValidationError } from "../lib/api.ts";
import { parseFormatOption } from "../lib/output.ts";
import type { ApiOrganization, ApiProject } from "../lib/types.ts";

const INTERACTIVE_THRESHOLD = 10;

export interface LinkOptions {
  org?: string;
  project?: string;
  force?: boolean;
  yes?: boolean;
  apiBase?: string;
  profile?: string;
  format?: string | boolean;
}

export interface LinkResult {
  success: true;
  org: { id: string; key?: string };
  project: { id: string; key?: string };
  path: string;
}

async function pickOrg(orgs: ApiOrganization[]): Promise<ApiOrganization> {
  if (orgs.length === 1) return orgs[0]!;
  const choices = orgs.map((o) => ({ name: `${o.name} (${o.key})`, value: o }));
  if (orgs.length <= INTERACTIVE_THRESHOLD) {
    return select({ message: "Select organization:", choices });
  }
  return search({
    message: "Search organization:",
    source: async (input) => {
      const term = (input || "").toLowerCase();
      return choices.filter(
        (c) => c.value.name.toLowerCase().includes(term) || c.value.key.toLowerCase().includes(term)
      );
    },
  });
}

async function pickProject(projects: ApiProject[]): Promise<ApiProject> {
  if (projects.length === 1) return projects[0]!;
  const choices = projects.map((p) => ({ name: `${p.name} (${p.key})`, value: p }));
  if (projects.length <= INTERACTIVE_THRESHOLD) {
    return select({ message: "Select project:", choices });
  }
  return search({
    message: "Search project:",
    source: async (input) => {
      const term = (input || "").toLowerCase();
      return choices.filter(
        (c) => c.value.name.toLowerCase().includes(term) || c.value.key.toLowerCase().includes(term)
      );
    },
  });
}

async function resolveOrgByKeyOrId(
  client: ApiClient,
  keyOrId: string
): Promise<ApiOrganization> {
  if (keyOrId.startsWith("org_")) return client.getOrganization(keyOrId);
  // Fall back to matching by key from the user's org list
  const orgs = await client.listOrganizations();
  const match = orgs.find((o) => o.key === keyOrId);
  if (!match) throw new ValidationError(`No organization with key or id "${keyOrId}"`);
  return match;
}

async function resolveProjectByKeyOrId(
  client: ApiClient,
  orgId: string,
  keyOrId: string
): Promise<ApiProject> {
  if (keyOrId.startsWith("proj_")) return client.getProject(keyOrId);
  const projects = await client.listProjects(orgId);
  const match = projects.find((p) => p.key === keyOrId);
  if (!match) throw new ValidationError(`No project with key or id "${keyOrId}" in org ${orgId}`);
  return match;
}

export async function linkCommand(options: LinkOptions): Promise<void> {
  const isJson = parseFormatOption(options.format) === "json";
  const projectDir = process.cwd();

  const existing = await readProjectLink(projectDir);
  if (existing && !options.force) {
    throw new ValidationError(
      `This repo is already linked to project ${existing.project.id} (${existing.org.id}). ` +
        `Pass --force to re-link.`
    );
  }

  const client = await ApiClient.create({ profile: options.profile, apiBase: options.apiBase });

  // Resolve org
  let org: ApiOrganization;
  if (options.org) {
    org = await resolveOrgByKeyOrId(client, options.org);
  } else {
    const orgs = await client.listOrganizations();
    if (orgs.length === 0) {
      throw new ValidationError("No organizations available for this user.");
    }
    if (orgs.length === 1) {
      org = orgs[0]!;
    } else if (options.yes || isJson) {
      throw new ValidationError("Multiple organizations available — pass --org <key|id>.");
    } else {
      org = await pickOrg(orgs);
    }
  }

  // Resolve project
  let project: ApiProject;
  if (options.project) {
    project = await resolveProjectByKeyOrId(client, org.id, options.project);
  } else {
    const projects = await client.listProjects(org.id);
    if (projects.length === 0) {
      throw new ValidationError(
        `No projects in ${org.name}. Use 'traffical project create <name>' first.`
      );
    }
    if (projects.length === 1) {
      project = projects[0]!;
    } else if (options.yes || isJson) {
      throw new ValidationError("Multiple projects in this org — pass --project <key|id>.");
    } else {
      project = await pickProject(projects);
    }
  }

  await ensureTrafficalDir(projectDir);
  const path = await writeProjectLink(projectDir, {
    version: "1.0",
    org: { id: org.id, key: org.key },
    project: { id: project.id, key: project.key },
  });

  const result: LinkResult = {
    success: true,
    org: { id: org.id, key: org.key },
    project: { id: project.id, key: project.key },
    path,
  };

  if (isJson) {
    console.log(JSON.stringify(result));
  } else {
    console.log(chalk.green(`✓ Linked to ${project.name} (${org.name})`));
    console.log(chalk.dim(`  Wrote ${path}`));
  }
}

export interface UnlinkOptions {
  format?: string | boolean;
}

export async function unlinkCommand(options: UnlinkOptions): Promise<void> {
  const isJson = parseFormatOption(options.format) === "json";
  const path = getProjectLinkPath();
  let removed = false;
  try {
    await access(path);
    await rm(path);
    removed = true;
  } catch {
    /* not linked */
  }

  if (isJson) {
    console.log(JSON.stringify({ success: true, removed }));
  } else {
    if (removed) {
      console.log(chalk.green("✓ Unlinked"));
    } else {
      console.log(chalk.dim("Not linked"));
    }
  }
}
