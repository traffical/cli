/**
 * generate-types command
 *
 * Generate type definitions from the traffical.yaml config file.
 * Creates strongly-typed parameter keys, event names, and event property
 * interfaces. When the repo is linked and the control plane exposes the
 * attribute registry, also emits `TrafficalContext` / `TrafficalAttributeKey`
 * from the project's active attributes (system rows included).
 *
 * Multi-language architecture: currently supports TypeScript.
 * Add --language flag for future Go/Python/Swift support.
 */

import chalk from "chalk";
import { writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { findConfigFile, readConfigFile, resolveProject, TRAFFICAL_DIR } from "../lib/config.ts";
import { ApiClient, CliError, AuthError } from "../lib/api.ts";
import { generateEventTypesContent } from "../lib/codegen/index.ts";
import type { CodegenLanguage } from "../lib/codegen/types.ts";
import type { ApiAttributeDefinition } from "../lib/types.ts";
import { parseFormatOption } from "../lib/output.ts";

export interface GenerateTypesOptions {
  configPath?: string;
  output?: string;
  language?: string;
  format?: string | boolean;
  profile?: string;
  apiBase?: string;
}

export interface GenerateTypesResult {
  success: boolean;
  configPath: string;
  outputPath: string;
  language: string;
  parameters: number;
  events: number;
  propertyGroups: number;
  eventsWithSchema: number;
  /** Number of context attributes emitted; absent when the registry was skipped. */
  attributes?: number;
  /** Why the context types were left out (older server, not linked, …). */
  attributesNote?: string;
}

const LANGUAGE_EXTENSIONS: Record<CodegenLanguage, string> = {
  typescript: ".ts",
};

const SUPPORTED_LANGUAGES: CodegenLanguage[] = ["typescript"];

/**
 * Fetch the project's active attributes for codegen.
 *
 * Returns `{ note }` instead of throwing when the registry is unreachable in
 * a way that should not block an otherwise offline command: the repo is not
 * linked, no credentials are available, or the server predates the
 * attributes endpoint (403/404). Anything else propagates.
 */
async function fetchAttributesForCodegen(options: {
  profile?: string;
  apiBase?: string;
}): Promise<{ attributes?: ApiAttributeDefinition[]; note?: string }> {
  const link = await resolveProject();
  if (!link) {
    return { note: "Context types skipped: repo is not linked to a project (run 'traffical link')." };
  }

  let client: ApiClient;
  try {
    client = await ApiClient.create({ profile: options.profile, apiBase: options.apiBase });
  } catch (err) {
    if (err instanceof AuthError) {
      return { note: "Context types skipped: not logged in (run 'traffical login')." };
    }
    throw err;
  }

  try {
    const rows = await client.listAttributes(link.projectId);
    return { attributes: rows.filter((a) => !a.archivedAt) };
  } catch (err) {
    if (err instanceof CliError && (err.status === 403 || err.status === 404)) {
      return {
        note: `Context types skipped: attribute registry unavailable on this server (HTTP ${err.status}).`,
      };
    }
    throw err;
  }
}

/**
 * Generate types from config.
 *
 * Pass `attributes` to reuse rows already fetched (e.g. from `pull`);
 * otherwise the command fetches them itself.
 */
export async function generateTypes(options: {
  configPath?: string;
  output?: string;
  language?: string;
  profile?: string;
  apiBase?: string;
  attributes?: ApiAttributeDefinition[];
}): Promise<GenerateTypesResult> {
  const configPath = options.configPath || (await findConfigFile());

  if (!configPath) {
    throw new Error(
      `No ${TRAFFICAL_DIR}/config.yaml found. Run 'traffical init' to create one.`
    );
  }

  const language = (options.language || "typescript") as CodegenLanguage;

  if (!SUPPORTED_LANGUAGES.includes(language)) {
    throw new Error(
      `Language "${language}" is not yet supported. Supported languages: ${SUPPORTED_LANGUAGES.join(", ")}`
    );
  }

  const config = await readConfigFile(configPath);

  const configDir = dirname(configPath);
  const ext = LANGUAGE_EXTENSIONS[language];
  const outputPath = options.output || join(configDir, `traffical.generated${ext}`);

  const registry = options.attributes
    ? { attributes: options.attributes.filter((a) => !a.archivedAt) }
    : await fetchAttributesForCodegen({ profile: options.profile, apiBase: options.apiBase });

  const result = generateEventTypesContent(config, {
    language,
    configPath,
    attributes: registry.attributes,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.content, "utf-8");

  const eventEntries = Object.entries(config.events || {});
  const eventsWithSchema = eventEntries.filter(
    ([, e]) => e.properties || (e.propertyGroups && e.propertyGroups.length > 0)
  ).length;

  return {
    success: true,
    configPath,
    outputPath,
    language,
    parameters: Object.keys(config.parameters).length,
    events: eventEntries.length,
    propertyGroups: Object.keys(config.propertyGroups || {}).length,
    eventsWithSchema,
    attributes: registry.attributes?.length,
    attributesNote: registry.note,
  };
}

function printHuman(result: GenerateTypesResult): void {
  console.log(chalk.dim(`Using config: ${result.configPath}`));
  console.log();
  console.log(`Generated ${result.language} types:`);
  console.log(chalk.dim(`  Parameters: ${result.parameters}`));
  console.log(chalk.dim(`  Events: ${result.events} (${result.eventsWithSchema} with property schema)`));
  if (result.propertyGroups > 0) {
    console.log(chalk.dim(`  Property Groups: ${result.propertyGroups}`));
  }
  if (result.attributes !== undefined) {
    console.log(chalk.dim(`  Attributes: ${result.attributes}`));
  } else if (result.attributesNote) {
    console.log(chalk.dim(`  ${result.attributesNote}`));
  }
  console.log();
  console.log(chalk.green(`✓ Written to ${result.outputPath}`));
}

export async function generateTypesCommand(options: GenerateTypesOptions): Promise<void> {
  const format = parseFormatOption(options.format);
  const result = await generateTypes(options);

  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
}
