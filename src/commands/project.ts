/**
 * project list / project create / project use
 *
 * `project list`   — list projects in the active org
 * `project create` — create a new project (and optionally link the repo)
 * `project use`    — alias of `traffical link --project <key|id>`
 */

import chalk from "chalk";
import { ApiClient, ValidationError } from "../lib/api.ts";
import { readSession } from "../lib/token-store.ts";
import { resolveProject } from "../lib/config.ts";
import { parseFormatOption } from "../lib/output.ts";
import { linkCommand } from "./link.ts";
import type { ApiOrganization } from "../lib/types.ts";

export interface ProjectCommonOptions {
  org?: string;
  profile?: string;
  apiBase?: string;
  format?: string | boolean;
}

/** Resolve the active org id from: --org → cwd link → session default → single-org user. */
async function resolveActiveOrg(
  client: ApiClient,
  orgFlag?: string
): Promise<ApiOrganization> {
  if (orgFlag) {
    if (orgFlag.startsWith("org_")) return client.getOrganization(orgFlag);
    const orgs = await client.listOrganizations();
    const match = orgs.find((o) => o.key === orgFlag);
    if (!match) throw new ValidationError(`No organization with key or id "${orgFlag}"`);
    return match;
  }

  const link = await resolveProject();
  if (link) return client.getOrganization(link.orgId);

  const session = await readSession();
  const orgs = await client.listOrganizations();
  if (session?.default_org_key) {
    const match = orgs.find((o) => o.key === session.default_org_key);
    if (match) return match;
  }
  if (orgs.length === 1) return orgs[0]!;

  throw new ValidationError(
    "No active org. Pass --org <key>, run 'traffical link', or 'traffical org use <key>'."
  );
}

export async function projectListCommand(options: ProjectCommonOptions): Promise<void> {
  const isJson = parseFormatOption(options.format) === "json";
  const client = await ApiClient.create({ profile: options.profile, apiBase: options.apiBase });
  const org = await resolveActiveOrg(client, options.org);
  const projects = await client.listProjects(org.id);

  if (isJson) {
    console.log(
      JSON.stringify(
        {
          org: { id: org.id, key: org.key, name: org.name },
          projects: projects.map((p) => ({ id: p.id, key: p.key, name: p.name })),
        },
        null,
        2
      )
    );
    return;
  }

  if (projects.length === 0) {
    console.log(chalk.dim(`No projects in ${org.name}.`));
    return;
  }
  console.log(chalk.bold(org.name));
  for (const p of projects) {
    console.log(`  ${p.key.padEnd(24)} ${chalk.dim(p.name)}`);
  }
}

export interface ProjectCreateOptions extends ProjectCommonOptions {
  name: string;
  key?: string;
  description?: string;
  /** Also link the current repo to the new project. */
  link?: boolean;
}

function keyFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export async function projectCreateCommand(options: ProjectCreateOptions): Promise<void> {
  const isJson = parseFormatOption(options.format) === "json";
  const client = await ApiClient.create({ profile: options.profile, apiBase: options.apiBase });
  const org = await resolveActiveOrg(client, options.org);

  const key = options.key || keyFromName(options.name);
  const project = await client.createProject(org.id, {
    name: options.name,
    key,
    description: options.description,
  });

  if (isJson) {
    console.log(
      JSON.stringify({
        success: true,
        project: { id: project.id, key: project.key, name: project.name },
        org: { id: org.id, key: org.key },
      })
    );
  } else {
    console.log(chalk.green(`✓ Created project ${project.name} (${project.key})`));
  }

  if (options.link) {
    await linkCommand({
      project: project.id,
      org: org.id,
      force: true,
      profile: options.profile,
      apiBase: options.apiBase,
      format: options.format,
    });
  }
}

export interface ProjectUseOptions extends ProjectCommonOptions {
  key: string;
}

export async function projectUseCommand(options: ProjectUseOptions): Promise<void> {
  await linkCommand({
    project: options.key,
    org: options.org,
    force: true,
    profile: options.profile,
    apiBase: options.apiBase,
    format: options.format,
  });
}
