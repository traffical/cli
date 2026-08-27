#!/usr/bin/env node
/**
 * Traffical CLI
 *
 * Config-as-code for your experimentation platform.
 *
 * Commands:
 *   init               - Initialize Traffical in a project
 *   pull               - Pull synced params from Traffical → local file
 *   push               - Push local file params → Traffical
 *   sync               - Bidirectional sync (pull + push)
 *   status             - Show sync status
 *   import             - Add dashboard param to config file
 *
 * Exit Codes:
 *   0  - Success
 *   1  - Validation error (invalid config)
 *   2  - Authentication error (not logged in / token invalid)
 *   3  - Network/API error
 *   4  - Not linked (no .traffical/project.yaml)
 *   10 - Config drift detected (status command)
 *   11 - Policy needs attention
 */

import { Command } from "commander";
import chalk from "chalk";
import { initCommand } from "./commands/init.ts";
import { pullCommand } from "./commands/pull.ts";
import { pushCommand } from "./commands/push.ts";
import { syncCommand } from "./commands/sync.ts";
import { statusCommand } from "./commands/status.ts";
import { importCommand } from "./commands/import.ts";
import { importMetricsCommand } from "./commands/import-metrics.ts";
import { generateTypesCommand } from "./commands/generate-types.ts";
import { loginCommand } from "./commands/login.ts";
import { logoutCommand } from "./commands/logout.ts";
import { whoamiCommand } from "./commands/whoami.ts";
import { linkCommand, unlinkCommand } from "./commands/link.ts";
import { orgListCommand, orgUseCommand } from "./commands/org.ts";
import { projectListCommand, projectCreateCommand, projectUseCommand } from "./commands/project.ts";
import { CliError, EXIT_VALIDATION_ERROR } from "./lib/api.ts";
import { TRAFFICAL_DIR, CONFIG_FILENAME } from "./lib/config.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_VERSION: string = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
).version;

/**
 * Handle errors with appropriate exit codes.
 */
function handleError(error: unknown, format?: string): never {
  const isJson = format === "json";

  if (error instanceof CliError) {
    if (isJson) {
      console.log(
        JSON.stringify({
          success: false,
          code: error.code,
          message: error.message,
          hint: error.hint,
          exit_code: error.exitCode,
          ...(error.details !== undefined ? { details: error.details } : {}),
        })
      );
    } else {
      console.error(chalk.red(`Error: ${error.message}`));
      if (error.hint) {
        console.error(chalk.dim(`Try: ${error.hint}`));
      }
    }
    process.exit(error.exitCode);
  }

  // Unknown errors default to validation error (exit 1)
  const message = error instanceof Error ? error.message : String(error);
  if (isJson) {
    console.log(
      JSON.stringify({
        success: false,
        code: "unknown_error",
        message,
        exit_code: EXIT_VALIDATION_ERROR,
      })
    );
  } else {
    console.error(chalk.red(`Error: ${message}`));
  }
  process.exit(EXIT_VALIDATION_ERROR);
}

const program = new Command();

program
  .name("traffical")
  .description("Config-as-code for your experimentation platform")
  .version(CLI_VERSION);

// Global options
program
  .option("-p, --profile <name>", "Legacy ~/.trafficalrc profile (deprecated)")
  .option("-c, --config <path>", `Path to config file (default: ${TRAFFICAL_DIR}/${CONFIG_FILENAME})`)
  .option("-b, --api-base <url>", "API base URL (overrides default / env / profile)")
  .option("-j, --format <format>", "Output format: human (default) or json", "human")
  .option("-q, --quiet", "Suppress non-essential output");

// Login command
program
  .command("login")
  .description("Authenticate with Traffical via browser (OAuth Device Flow)")
  .option("--no-browser", "Print the URL/code instead of opening a browser")
  .option("--token <jwt>", "Skip the device flow and seed the session with a pre-minted token (CI/agent use)")
  .action(async (options) => {
    const globalOpts = program.opts();
    try {
      await loginCommand({
        apiBase: globalOpts.apiBase,
        noBrowser: options.browser === false,
        token: options.token,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Logout command
program
  .command("logout")
  .description("Remove the local Traffical session")
  .action(async () => {
    const globalOpts = program.opts();
    try {
      await logoutCommand({ format: globalOpts.format });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Whoami command
program
  .command("whoami")
  .description("Show the active identity and linked project")
  .option("--verify", "Validate the session against the server (live check, not just the cached token)")
  .action(async (opts) => {
    const globalOpts = program.opts();
    try {
      await whoamiCommand({
        format: globalOpts.format,
        profile: globalOpts.profile,
        apiBase: globalOpts.apiBase,
        verify: opts.verify,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Link / Unlink commands
program
  .command("link")
  .description("Link the current repo to a Traffical project (writes .traffical/project.yaml)")
  .option("--org <keyOrId>", "Organization key or id")
  .option("--project <keyOrId>", "Project key or id")
  .option("-y, --yes", "Non-interactive (errors instead of prompting)")
  .option("--force", "Overwrite an existing project link")
  .action(async (options) => {
    const globalOpts = program.opts();
    try {
      await linkCommand({
        org: options.org,
        project: options.project,
        yes: options.yes,
        force: options.force,
        profile: globalOpts.profile,
        apiBase: globalOpts.apiBase,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

program
  .command("unlink")
  .description("Remove the .traffical/project.yaml link (leaves config.yaml in place)")
  .action(async () => {
    const globalOpts = program.opts();
    try {
      await unlinkCommand({ format: globalOpts.format });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Org commands
const org = program.command("org").description("Manage Traffical organizations");
org
  .command("list")
  .description("List organizations you belong to")
  .action(async () => {
    const globalOpts = program.opts();
    try {
      await orgListCommand({
        profile: globalOpts.profile,
        apiBase: globalOpts.apiBase,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });
org
  .command("use <key>")
  .description("Set the default organization for commands that need one")
  .action(async (key: string) => {
    const globalOpts = program.opts();
    try {
      await orgUseCommand({
        key,
        profile: globalOpts.profile,
        apiBase: globalOpts.apiBase,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Project commands
const project = program.command("project").description("Manage Traffical projects");
project
  .command("list")
  .description("List projects in the active organization")
  .option("--org <keyOrId>", "Organization key or id (defaults to active org)")
  .action(async (options) => {
    const globalOpts = program.opts();
    try {
      await projectListCommand({
        org: options.org,
        profile: globalOpts.profile,
        apiBase: globalOpts.apiBase,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });
project
  .command("create <name>")
  .description("Create a new project in the active organization")
  .option("--key <key>", "Project key (auto-derived from name if omitted)")
  .option("--description <text>", "Project description")
  .option("--org <keyOrId>", "Organization key or id (defaults to active org)")
  .option("--link", "Also link this repo to the new project")
  .action(async (name: string, options) => {
    const globalOpts = program.opts();
    try {
      await projectCreateCommand({
        name,
        key: options.key,
        description: options.description,
        org: options.org,
        link: options.link,
        profile: globalOpts.profile,
        apiBase: globalOpts.apiBase,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });
project
  .command("use <keyOrId>")
  .description("Link this repo to a project (alias of 'traffical link --project <keyOrId>')")
  .option("--org <keyOrId>", "Organization key or id")
  .action(async (keyOrId: string, options) => {
    const globalOpts = program.opts();
    try {
      await projectUseCommand({
        key: keyOrId,
        org: options.org,
        profile: globalOpts.profile,
        apiBase: globalOpts.apiBase,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Init command
program
  .command("init")
  .description("Initialize Traffical in a project (login + link + scaffold)")
  .option("--api-key <key>", "Override the bearer token (otherwise: session / TRAFFICAL_API_KEY)")
  .option("--framework <framework>", "Skip framework detection (react, nextjs, svelte, sveltekit, node)")
  .option("--org <keyOrId>", "Organization to link (skips org selection)")
  .option("--project <keyOrId>", "Project to link (skips project selection)")
  .option("-y, --yes", "Non-interactive mode: accept defaults, error if input would be required")
  .option("--force", "Overwrite existing config.yaml / project.yaml / .env files")
  .option("--no-sdk-key", "Skip automatic SDK key creation")
  .action(async (options) => {
    const globalOpts = program.opts();
    try {
      await initCommand({
        profile: globalOpts.profile,
        apiKey: options.apiKey,
        apiBase: globalOpts.apiBase,
        format: globalOpts.format,
        sdkKey: options.sdkKey,
        framework: options.framework,
        org: options.org,
        project: options.project,
        yes: options.yes,
        force: options.force,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Pull command
program
  .command("pull")
  .description("Pull synced parameters, events, and property groups from Traffical to local config")
  .option("--include-types", "Also generate TypeScript types after pulling")
  .option("--types-output <path>", "Output path for generated types (with --include-types)")
  .action(async (options) => {
    const globalOpts = program.opts();
    try {
      await pullCommand({
        profile: globalOpts.profile,
        configPath: globalOpts.config,
        apiBase: globalOpts.apiBase,
        format: globalOpts.format,
        includeTypes: options.includeTypes,
        typesOutput: options.typesOutput,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Push command
program
  .command("push")
  .description("Push local config parameters, events, and metrics to Traffical")
  .option("-n, --dry-run", "Validate and show changes without pushing")
  .option("--prune", "Archive orphaned synced parameters that are no longer in the config file")
  .option("--metrics-file <path>", "Path to metrics.yaml (default: auto-detect .traffical/metrics.yaml)")
  .action(async (options) => {
    const globalOpts = program.opts();
    try {
      await pushCommand({
        profile: globalOpts.profile,
        configPath: globalOpts.config,
        metricsFile: options.metricsFile,
        apiBase: globalOpts.apiBase,
        dryRun: options.dryRun,
        prune: options.prune,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Sync command
program
  .command("sync")
  .description("Sync config with Traffical (local wins: pushes your changes, adds new remote params)")
  .option("--all", "Sync all config files in the repository")
  .option("-n, --dry-run", "Validate and show changes without syncing")
  .option("--prune", "Archive orphaned synced parameters that are no longer in the config file")
  .action(async (options) => {
    const globalOpts = program.opts();
    try {
      await syncCommand({
        profile: globalOpts.profile,
        configPath: globalOpts.config,
        apiBase: globalOpts.apiBase,
        all: options.all,
        dryRun: options.dryRun,
        prune: options.prune,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Status command
program
  .command("status")
  .description("Show current sync status")
  .action(async () => {
    const globalOpts = program.opts();
    try {
      await statusCommand({
        profile: globalOpts.profile,
        configPath: globalOpts.config,
        apiBase: globalOpts.apiBase,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Import command (parent)
const importCmd = program
  .command("import")
  .description("Import definitions from the dashboard to local config files");

importCmd
  .command("param <key>")
  .description("Import dashboard parameters to config (supports wildcards: ui.*, *.enabled)")
  .action(async (key: string) => {
    const globalOpts = program.opts();
    try {
      await importCommand({
        profile: globalOpts.profile,
        configPath: globalOpts.config,
        apiBase: globalOpts.apiBase,
        key,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

importCmd
  .command("metrics [name]")
  .description("Import metric definitions to metrics.yaml (or use --all for all metrics)")
  .option("--all", "Import all metrics from the dashboard")
  .option("--metrics-file <path>", "Path to metrics.yaml output file")
  .action(async (name: string | undefined, options) => {
    const globalOpts = program.opts();
    try {
      await importMetricsCommand({
        profile: globalOpts.profile,
        apiBase: globalOpts.apiBase,
        name,
        all: options.all,
        metricsFile: options.metricsFile,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Backwards-compat: `traffical import <key>` still works as `traffical import param <key>`
importCmd
  .argument("[key]", "Parameter key (deprecated: use 'traffical import param <key>')")
  .action(async (key: string | undefined) => {
    if (!key) return;
    const globalOpts = program.opts();
    try {
      await importCommand({
        profile: globalOpts.profile,
        configPath: globalOpts.config,
        apiBase: globalOpts.apiBase,
        key,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Generate Types command
program
  .command("generate-types")
  .description("Generate typed definitions from traffical.yaml config")
  .option("-o, --output <path>", "Output file path (default: .traffical/traffical.generated.ts)")
  .option("-l, --language <lang>", "Output language (default: typescript)", "typescript")
  .action(async (options) => {
    const globalOpts = program.opts();
    try {
      await generateTypesCommand({
        configPath: globalOpts.config,
        output: options.output,
        language: options.language,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

program.parse();
