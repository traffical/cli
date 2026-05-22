/**
 * init command
 *
 * Orchestrates first-time setup. Composes:
 *   ensureLoggedIn  → run device flow if no session
 *   ensureLinked    → write .traffical/project.yaml (pick or create a project)
 *   writeConfig     → create .traffical/config.yaml only if missing
 *   provisionSdk    → mint SDK key, write to .traffical/.env, update .gitignore
 *   writeAgentsMd   → AGENTS.md project hint
 *   writeTemplates  → framework-specific TEMPLATES.md
 *
 * Never overwrites existing files without --force. In --format json or
 * non-TTY environments, never prompts — errors with an actionable hint.
 */

import chalk from "chalk";
import { writeFile, access } from "fs/promises";
import { join } from "node:path";
import { select, search } from "@inquirer/prompts";
import { ApiClient, ValidationError, AuthError, EXIT_AUTH_ERROR } from "../lib/api.ts";
import { getIdentity, hasEnvCredentials } from "../lib/auth.ts";
import { readSession } from "../lib/token-store.ts";
import {
  createConfigFile,
  writeProjectLink,
  apiParamToConfig,
  apiEventToConfig,
  ensureTrafficalDir,
  getDefaultConfigPath,
  getAgentsPath,
  getProjectLinkPath,
  readAgentsFile,
  readProjectLink,
  ensureTrafficalGitignore,
  TRAFFICAL_DIR,
  AGENTS_FILENAME,
  TEMPLATES_FILENAME,
} from "../lib/config.ts";
import type { ConfigParameter, ConfigEvent, ApiOrganization, ApiProject } from "../lib/types.ts";
import {
  detectFramework,
  getFrameworkDisplayName,
  getSdkPackage,
  SUPPORTED_FRAMEWORKS,
  type Framework,
} from "../lib/detection.ts";
import { generateAgentsMd, updateAgentsMd } from "../lib/agents.ts";
import { copyTemplate } from "../lib/templates.ts";
import { parseFormatOption } from "../lib/output.ts";
import { loginCommand } from "./login.ts";

const INTERACTIVE_THRESHOLD = 10;

export interface InitOptions {
  profile?: string;
  apiKey?: string;
  apiBase?: string;
  format?: string | boolean;
  sdkKey?: boolean;
  framework?: string;
  project?: string;
  org?: string;
  yes?: boolean;
  /** Overwrite existing files (config.yaml, project.yaml, .env). */
  force?: boolean;
}

export interface InitResult {
  success: boolean;
  project: { id: string; name: string; key: string };
  org: { id: string; name: string; key: string };
  framework: { detected: Framework; language: string; sdkPackage: string };
  files: {
    config: string;
    project_link: string;
    agents: string;
    templates: string;
    env?: string;
  };
  sdk_key: { created: boolean; key_prefix?: string };
  next_steps: string[];
}

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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

async function pickProject(projects: ApiProject[]): Promise<ApiProject | "__create__"> {
  const choices: Array<{ name: string; value: ApiProject | "__create__" }> = [
    ...projects.map((p) => ({ name: `${p.name} (${p.key})`, value: p as ApiProject | "__create__" })),
    { name: chalk.dim("+ Create new project…"), value: "__create__" as const },
  ];
  if (projects.length + 1 <= INTERACTIVE_THRESHOLD) {
    return select({ message: "Select project:", choices });
  }
  return search({
    message: "Search project:",
    source: async (input) => {
      const term = (input || "").toLowerCase();
      return choices.filter((c) =>
        c.value === "__create__" || typeof c.value === "object"
          ? c.name.toLowerCase().includes(term)
          : false
      );
    },
  });
}

function keyFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// ============================================================================
// Step 1: ensure logged in
// ============================================================================

async function ensureLoggedIn(opts: InitOptions): Promise<void> {
  if (opts.apiKey || hasEnvCredentials()) return;
  const session = await readSession();
  if (session) return;

  const isJson = parseFormatOption(opts.format) === "json";
  if (isJson || opts.yes || !isInteractive()) {
    throw new AuthError(
      "Not authenticated. Run 'traffical login' first, or set TRAFFICAL_API_KEY."
    );
  }
  // Run the device flow inline
  await loginCommand({ apiBase: opts.apiBase, format: "human" });
}

// ============================================================================
// Step 2: ensure project link
// ============================================================================

async function ensureLinked(
  client: ApiClient,
  opts: InitOptions
): Promise<{ org: ApiOrganization; project: ApiProject }> {
  const projectDir = process.cwd();
  const existing = await readProjectLink(projectDir);
  if (existing && !opts.force) {
    const org = await client.getOrganization(existing.org.id);
    const project = await client.getProject(existing.project.id);
    return { org, project };
  }

  const isJson = parseFormatOption(opts.format) === "json";
  const interactive = isInteractive() && !isJson && !opts.yes;

  // Resolve org
  let org: ApiOrganization;
  if (opts.org) {
    if (opts.org.startsWith("org_")) {
      org = await client.getOrganization(opts.org);
    } else {
      const orgs = await client.listOrganizations();
      const match = orgs.find((o) => o.key === opts.org);
      if (!match) throw new ValidationError(`No organization with key "${opts.org}"`);
      org = match;
    }
  } else {
    const session = await readSession();
    const orgs = await client.listOrganizations();
    if (orgs.length === 0) {
      throw new ValidationError("No organizations available — create one in the dashboard first.");
    }
    const defaultMatch = session?.default_org_key
      ? orgs.find((o) => o.key === session.default_org_key)
      : undefined;
    if (defaultMatch) {
      org = defaultMatch;
    } else if (orgs.length === 1) {
      org = orgs[0]!;
    } else if (!interactive) {
      throw new ValidationError(
        "Multiple organizations — pass --org <key>, or run 'traffical org use <key>' first."
      );
    } else {
      org = await pickOrg(orgs);
    }
  }

  // Resolve project
  let project: ApiProject;
  if (opts.project) {
    if (opts.project.startsWith("proj_")) {
      project = await client.getProject(opts.project);
    } else {
      const projects = await client.listProjects(org.id);
      const match = projects.find((p) => p.key === opts.project);
      if (!match)
        throw new ValidationError(`No project with key "${opts.project}" in ${org.name}`);
      project = match;
    }
  } else {
    const projects = await client.listProjects(org.id);
    if (projects.length === 0) {
      if (!interactive) {
        throw new ValidationError(
          `No projects in ${org.name}. Create one with 'traffical project create <name>'.`
        );
      }
      // Auto-jump to create flow
      const name = await promptProjectName(org.name);
      project = await client.createProject(org.id, { name, key: keyFromName(name) });
    } else if (projects.length === 1 && !interactive) {
      project = projects[0]!;
    } else if (!interactive) {
      throw new ValidationError(
        `Multiple projects in ${org.name} — pass --project <key>.`
      );
    } else {
      const choice = await pickProject(projects);
      if (choice === "__create__") {
        const name = await promptProjectName(org.name);
        project = await client.createProject(org.id, { name, key: keyFromName(name) });
      } else {
        project = choice;
      }
    }
  }

  await ensureTrafficalDir(projectDir);
  await writeProjectLink(projectDir, {
    version: "1.0",
    org: { id: org.id, key: org.key },
    project: { id: project.id, key: project.key },
  });

  return { org, project };
}

async function promptProjectName(orgName: string): Promise<string> {
  const { input } = await import("@inquirer/prompts");
  return input({
    message: `New project name in ${orgName}:`,
    validate: (v) => (v.trim().length > 0 ? true : "Required"),
  });
}

// ============================================================================
// Step 3: provision SDK key
// ============================================================================

async function provisionSdkKey(
  client: ApiClient,
  org: ApiOrganization,
  project: ApiProject,
  opts: InitOptions
): Promise<{ created: boolean; keyPrefix?: string; envPath?: string }> {
  if (opts.sdkKey === false) return { created: false };

  const projectDir = process.cwd();
  const envPath = join(projectDir, TRAFFICAL_DIR, ".env");
  if ((await fileExists(envPath)) && !opts.force) {
    return { created: false, envPath };
  }

  try {
    const newKey = await client.createApiKey(org.id, {
      name: `CLI SDK key — ${project.name}`,
      projectId: project.id,
      scopes: ["sdk:read", "sdk:write"],
    });

    const content = [
      "# Traffical SDK key — auto-generated by `traffical init`.",
      "# Use in your application for parameter resolution + event tracking.",
      "# Gitignored by .traffical/.gitignore.",
      `TRAFFICAL_API_KEY=${newKey.key}`,
      "",
    ].join("\n");
    await writeFile(envPath, content, { mode: 0o600 });

    await ensureTrafficalGitignore(projectDir);

    return { created: true, keyPrefix: newKey.apiKey.keyPrefix, envPath };
  } catch (err) {
    // Non-fatal: log and continue
    process.stderr.write(
      `⚠ Could not create SDK key: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return { created: false };
  }
}

// ============================================================================
// Step 4: starter config
// ============================================================================

async function writeStarterConfig(
  client: ApiClient,
  org: ApiOrganization,
  project: ApiProject,
  opts: InitOptions
): Promise<{ created: boolean; path: string }> {
  const configPath = getDefaultConfigPath();
  if ((await fileExists(configPath)) && !opts.force) {
    return { created: false, path: configPath };
  }

  // Pull existing synced params/events so the new config.yaml isn't empty
  // for projects that already have content.
  const [params, events, namespaces] = await Promise.all([
    client.listParameters(project.id, { synced: true }).catch(() => []),
    client.listEventDefinitions(project.id, { synced: true }).catch(() => []),
    client.listNamespaces(project.id).catch(() => []),
  ]);
  const nsMap = new Map(namespaces.map((n) => [n.id, n]));

  const configParams: Record<string, ConfigParameter> = {};
  for (const p of params) {
    const ns = nsMap.get(p.namespaceId);
    const { key, config } = apiParamToConfig({
      key: p.key,
      type: p.type,
      defaultValue: p.defaultValue,
      namespace: ns?.name,
      description: p.description,
    });
    configParams[key] = config;
  }

  const configEvents: Record<string, ConfigEvent> = {};
  for (const e of events) {
    const { name, config } = apiEventToConfig({
      name: e.name,
      valueType: e.valueType,
      unit: e.unit,
      description: e.description,
    });
    configEvents[name] = config;
  }

  await createConfigFile(configPath, {
    projectName: project.name,
    orgName: org.name,
    parameters: configParams,
    events: configEvents,
  });

  return { created: true, path: configPath };
}

// ============================================================================
// Step 5: AGENTS.md + TEMPLATES.md
// ============================================================================

async function writeAgentsAndTemplates(
  org: ApiOrganization,
  project: ApiProject,
  framework: Framework,
  language: "typescript" | "javascript",
  configParams: Record<string, ConfigParameter>
): Promise<{ agentsPath: string; templatesPath: string }> {
  const projectDir = process.cwd();
  const agentsPath = getAgentsPath(projectDir);
  const templatesPath = join(projectDir, TRAFFICAL_DIR, TEMPLATES_FILENAME);

  const agentsOpts = {
    projectName: project.name,
    orgName: org.name,
    framework,
    language,
    parameters: configParams,
  };
  const existing = await readAgentsFile(projectDir);
  if (existing === null) {
    await writeFile(agentsPath, generateAgentsMd(agentsOpts), "utf-8");
  } else {
    await writeFile(agentsPath, updateAgentsMd(existing, agentsOpts), "utf-8");
  }

  await copyTemplate(join(projectDir, TRAFFICAL_DIR), framework);

  return { agentsPath, templatesPath };
}

// ============================================================================
// Main
// ============================================================================

export async function initCommand(options: InitOptions): Promise<void> {
  const format = parseFormatOption(options.format);
  const isJson = format === "json";

  if (!isJson) {
    console.log();
    console.log(chalk.bold("🚀 Traffical init"));
    console.log();
  }

  await ensureLoggedIn(options);

  const client = await ApiClient.create({
    profile: options.profile,
    apiKey: options.apiKey,
    apiBase: options.apiBase,
  });

  if (!isJson) {
    const id = await getIdentity();
    if (id.user_email) {
      console.log(chalk.dim(`Signed in as ${id.user_email}`));
    } else {
      console.log(chalk.dim(`Authenticated via ${id.source}`));
    }
  }

  const { org, project } = await ensureLinked(client, options);
  if (!isJson) {
    console.log(chalk.green(`✓ Linked to ${project.name} (${org.name})`));
  }

  // Framework detection
  const detected = await detectFramework(process.cwd());
  const framework: Framework = options.framework
    ? (() => {
        const valid = SUPPORTED_FRAMEWORKS.map((f) => f.value);
        if (!valid.includes(options.framework as Framework)) {
          throw new ValidationError(
            `Invalid framework "${options.framework}". Valid: ${valid.join(", ")}`
          );
        }
        return options.framework as Framework;
      })()
    : detected.framework === "unknown"
      ? "node"
      : detected.framework;
  const language = detected.language;

  const configResult = await writeStarterConfig(client, org, project, options);
  if (!isJson) {
    if (configResult.created) {
      console.log(chalk.green(`✓ Wrote ${TRAFFICAL_DIR}/config.yaml`));
    } else {
      console.log(chalk.dim(`  Kept existing ${TRAFFICAL_DIR}/config.yaml (use --force to overwrite)`));
    }
  }

  // Read the config we just wrote (or the existing one) to feed AGENTS.md
  const configParams: Record<string, ConfigParameter> = {};

  const { agentsPath, templatesPath } = await writeAgentsAndTemplates(
    org,
    project,
    framework,
    language,
    configParams
  );
  if (!isJson) {
    console.log(chalk.green(`✓ Wrote ${AGENTS_FILENAME}`));
    console.log(chalk.green(`✓ Wrote ${TRAFFICAL_DIR}/${TEMPLATES_FILENAME}`));
  }

  const sdk = await provisionSdkKey(client, org, project, options);
  if (!isJson) {
    if (sdk.created) {
      console.log(chalk.green(`✓ Provisioned SDK key → ${TRAFFICAL_DIR}/.env`));
      console.log(chalk.dim(`  ${sdk.keyPrefix}… (sdk:read, sdk:write)`));
    } else if (sdk.envPath) {
      console.log(chalk.dim(`  Kept existing ${TRAFFICAL_DIR}/.env (use --force to regenerate)`));
    }
  }

  const sdkPackage = getSdkPackage(framework);
  const nextSteps = [
    `Install the SDK: npm install ${sdkPackage}`,
    `Source ${TRAFFICAL_DIR}/.env in your app and use TRAFFICAL_API_KEY`,
    `Edit ${TRAFFICAL_DIR}/config.yaml to define parameters and events`,
    `Run 'traffical sync' to push your config to Traffical`,
  ];

  const result: InitResult = {
    success: true,
    project: { id: project.id, name: project.name, key: project.key },
    org: { id: org.id, name: org.name, key: org.key },
    framework: { detected: framework, language, sdkPackage },
    files: {
      config: configResult.path,
      project_link: getProjectLinkPath(),
      agents: agentsPath,
      templates: templatesPath,
      env: sdk.envPath,
    },
    sdk_key: { created: sdk.created, key_prefix: sdk.keyPrefix },
    next_steps: nextSteps,
  };

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log();
    console.log(chalk.bold("Next steps:"));
    nextSteps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
    console.log();
    console.log(chalk.dim(`Stack: ${getFrameworkDisplayName(framework)} + ${language}`));
    console.log();
  }
}

// Silence unused-var TS error for EXIT_AUTH_ERROR (kept for symmetry).
void EXIT_AUTH_ERROR;
