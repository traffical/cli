/**
 * generate-types command
 *
 * Generate type definitions from the traffical.yaml config file.
 * Creates strongly-typed parameter keys, event names, and event property interfaces.
 *
 * Multi-language architecture: currently supports TypeScript.
 * Add --language flag for future Go/Python/Swift support.
 */

import chalk from "chalk";
import { writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { findConfigFile, readConfigFile, TRAFFICAL_DIR } from "../lib/config.ts";
import { generateEventTypesContent } from "../lib/codegen/index.ts";
import type { CodegenLanguage } from "../lib/codegen/types.ts";
import { parseFormatOption } from "../lib/output.ts";

export interface GenerateTypesOptions {
  configPath?: string;
  output?: string;
  language?: string;
  format?: string | boolean;
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
}

const LANGUAGE_EXTENSIONS: Record<CodegenLanguage, string> = {
  typescript: ".ts",
};

const SUPPORTED_LANGUAGES: CodegenLanguage[] = ["typescript"];

/**
 * Generate types from config.
 */
export async function generateTypes(options: {
  configPath?: string;
  output?: string;
  language?: string;
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

  const result = generateEventTypesContent(config, {
    language,
    configPath,
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
