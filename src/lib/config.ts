/**
 * Config File Parser
 *
 * Reads and writes Traffical config files.
 * Supports both new .traffical/config.yaml and legacy traffical.yaml paths.
 */

import { parse, stringify } from "yaml";
import { readFile, writeFile, access, mkdir } from "fs/promises";
import { join, dirname } from "path";
import Ajv from "ajv";
import type {
  TrafficalConfig,
  ConfigParameter,
  ConfigEvent,
  ConfigPropertyField,
  ConfigPropertyGroup,
  ParameterType,
  ParameterValue,
  ParameterConstraints,
  EventValueType,
  EventSchemaEnforcement,
  EventPropertySchema,
  EventPropertySchemaField,
  ProjectLink,
} from "./types.ts";

// Import the JSON Schema
import configSchema from "../../schemas/traffical-config.schema.json";

/** Directory name for Traffical config */
export const TRAFFICAL_DIR = ".traffical";

/** Config filename within .traffical directory */
export const CONFIG_FILENAME = "config.yaml";

/** Project link filename within .traffical directory */
export const PROJECT_LINK_FILENAME = "project.yaml";

/** Legacy config filename (for backwards compatibility) */
export const LEGACY_CONFIG_FILENAME = "traffical.yaml";

/** AGENTS.md filename (legacy, for backwards compatibility) */
export const AGENTS_FILENAME = "AGENTS.md";

/** Templates filename */
export const TEMPLATES_FILENAME = "TEMPLATES.md";

/** Claude Code Skills directory */
export const CLAUDE_DIR = ".claude";
export const CLAUDE_SKILLS_DIR = "skills";
export const CLAUDE_SKILL_NAME = "traffical";
export const CLAUDE_SKILL_FILENAME = "SKILL.md";

// Initialize AJV validator
const ajv = new Ajv({ allErrors: true, verbose: true });
const validateSchema = ajv.compile(configSchema);

/**
 * Validation error with detailed information
 */
export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate a config object against the JSON Schema.
 */
export function validateConfig(config: unknown): ValidationResult {
  const valid = validateSchema(config);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const rawErrors = validateSchema.errors || [];
  
  // Filter out internal schema errors that are confusing to users
  // (like "must match 'then' schema" from conditional validation)
  const filteredErrors = rawErrors.filter((err) => {
    // Skip "if" keyword errors - these are internal to conditional validation
    if (err.keyword === "if") return false;
    // Skip generic "then" errors - the more specific type error will be shown
    if (err.keyword === "then") return false;
    // Skip oneOf errors - we'll provide cleaner messages for these
    if (err.keyword === "oneOf") return false;
    return true;
  });
  
  // Check for json type mismatches and provide a cleaner error
  // (When type is "json" but default is not object/array, we get multiple type errors)
  const jsonTypeMismatch = rawErrors.some(
    (err) => err.keyword === "oneOf" && err.instancePath?.endsWith("/default")
  );
  if (jsonTypeMismatch) {
    // Find the parameter path and add a cleaner error
    const oneOfError = rawErrors.find((err) => err.keyword === "oneOf");
    if (oneOfError) {
      const path = oneOfError.instancePath?.slice(1).replace(/\//g, ".") || "";
      // Check if there's already a type error for this path
      const hasTypeError = filteredErrors.some(
        (err) => err.instancePath === oneOfError.instancePath && err.keyword === "type"
      );
      if (!hasTypeError) {
        filteredErrors.push({
          keyword: "type",
          instancePath: oneOfError.instancePath || "",
          schemaPath: "",
          params: { type: "object or array (json)" },
          message: "must be object or array (json type)",
        } as typeof rawErrors[0]);
      }
    }
  }

  const errors: ValidationError[] = filteredErrors.map((err) => {
    // Build a human-readable path
    let path = err.instancePath || "/";
    if (path.startsWith("/")) {
      path = path.slice(1).replace(/\//g, ".");
    }
    if (!path) {
      path = "(root)";
    }

    // Build a human-readable message
    let message = err.message || "Unknown error";

    // Enhance messages for common error types
    if (err.keyword === "enum" && err.params?.allowedValues) {
      message = `must be one of: ${(err.params.allowedValues as string[]).join(", ")}`;
    } else if (err.keyword === "required" && err.params?.missingProperty) {
      message = `missing required property '${err.params.missingProperty}'`;
      if (path !== "(root)") {
        path = `${path}.${err.params.missingProperty}`;
      } else {
        path = err.params.missingProperty as string;
      }
    } else if (err.keyword === "additionalProperties" && err.params?.additionalProperty) {
      message = `unknown property '${err.params.additionalProperty}'`;
    } else if (err.keyword === "pattern") {
      message = `invalid format (${message})`;
    } else if (err.keyword === "type" && err.params?.type) {
      // Improve type mismatch messages
      const expectedType = err.params.type as string;
      message = `must be ${expectedType}`;
    }

    return { path, message };
  });

  // Deduplicate errors by path+message
  const uniqueErrors = errors.filter((err, index, self) =>
    index === self.findIndex((e) => e.path === err.path && e.message === err.message)
  );

  // Collapse "must be object" + "must be array" into a single "must be object or array" error
  const collapsedErrors: ValidationError[] = [];
  const processedPaths = new Set<string>();
  
  for (const err of uniqueErrors) {
    if (processedPaths.has(err.path)) continue;
    
    // Check if this path has both object and array type errors
    const hasObjectError = uniqueErrors.some(
      (e) => e.path === err.path && e.message === "must be object"
    );
    const hasArrayError = uniqueErrors.some(
      (e) => e.path === err.path && e.message === "must be array"
    );
    
    if (hasObjectError && hasArrayError) {
      // Collapse into single error
      collapsedErrors.push({
        path: err.path,
        message: "must be object or array (for json type)",
      });
      processedPaths.add(err.path);
    } else if (err.message !== "must be object" && err.message !== "must be array") {
      // Keep non-object/array errors as-is
      collapsedErrors.push(err);
      processedPaths.add(err.path);
    } else {
      // Single object or array error (not both) - keep it
      collapsedErrors.push(err);
      processedPaths.add(err.path);
    }
  }

  return { valid: false, errors: collapsedErrors };
}

/**
 * Format validation errors for display.
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return "";

  const lines = ["", "Errors:"];
  for (const err of errors) {
    lines.push(`  - ${err.path}: ${err.message}`);
  }
  return lines.join("\n");
}

/**
 * Find Traffical config file in the current directory or parent directories.
 *
 * Search order (first match wins):
 * 1. .traffical/config.yaml (new default)
 * 2. traffical.yaml (legacy, for backwards compatibility)
 *
 * Walks up the directory tree until a config is found or root is reached.
 */
export async function findConfigFile(startDir: string = process.cwd()): Promise<string | null> {
  let currentDir = startDir;

  while (true) {
    // First check for new .traffical/config.yaml
    const newPath = join(currentDir, TRAFFICAL_DIR, CONFIG_FILENAME);
    try {
      await access(newPath);
      return newPath;
    } catch {
      // Not found, try legacy location
    }

    // Fallback: check for legacy traffical.yaml
    const legacyPath = join(currentDir, LEGACY_CONFIG_FILENAME);
    try {
      await access(legacyPath);
      return legacyPath;
    } catch {
      // Not found
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached root
      return null;
    }
    currentDir = parentDir;
  }
}

/**
 * Ensure the .traffical directory exists.
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns The full path to the .traffical directory
 */
export async function ensureTrafficalDir(baseDir: string = process.cwd()): Promise<string> {
  const trafficalDir = join(baseDir, TRAFFICAL_DIR);
  await mkdir(trafficalDir, { recursive: true });
  return trafficalDir;
}

/**
 * Ensure .traffical/.gitignore exists and contains ".env".
 * Only creates or updates the file if .env is not already listed.
 */
export async function ensureTrafficalGitignore(baseDir: string): Promise<void> {
  const gitignorePath = join(baseDir, TRAFFICAL_DIR, ".gitignore");

  try {
    const existing = await readFile(gitignorePath, "utf-8");
    // Check if .env is already in the gitignore
    const lines = existing.split("\n").map((l) => l.trim());
    if (!lines.includes(".env")) {
      await writeFile(gitignorePath, existing.trimEnd() + "\n.env\n", "utf-8");
    }
  } catch {
    // File doesn't exist — create it
    await writeFile(gitignorePath, "# Secrets - do not commit\n.env\n", "utf-8");
  }
}

/**
 * Get the default config file path (.traffical/config.yaml).
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns The full path to the config file
 */
export function getDefaultConfigPath(baseDir: string = process.cwd()): string {
  return join(baseDir, TRAFFICAL_DIR, CONFIG_FILENAME);
}

/**
 * Get the path to the project link file (.traffical/project.yaml).
 */
export function getProjectLinkPath(baseDir: string = process.cwd()): string {
  return join(baseDir, TRAFFICAL_DIR, PROJECT_LINK_FILENAME);
}

/**
 * Read the project link file. Returns null if not present.
 */
export async function readProjectLink(baseDir: string = process.cwd()): Promise<ProjectLink | null> {
  try {
    const content = await readFile(getProjectLinkPath(baseDir), "utf-8");
    const parsed = parse(content) as ProjectLink;
    if (!parsed?.project?.id || !parsed?.org?.id) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write the project link file atomically with a header comment.
 */
export async function writeProjectLink(
  baseDir: string,
  link: ProjectLink
): Promise<string> {
  const path = getProjectLinkPath(baseDir);
  const header = [
    `# Traffical project link — managed by \`traffical link\`.`,
    `# This file records which Traffical project this repo syncs with.`,
    `# Safe to commit. Edit via \`traffical link\` rather than by hand.`,
    ``,
  ].join("\n");
  const body = stringify(link, { indent: 2, lineWidth: 0 });
  await writeFile(path, header + body, "utf-8");
  return path;
}

/**
 * Resolved project context: where the IDs came from and the IDs themselves.
 */
export interface ResolvedProject {
  orgId: string;
  projectId: string;
  orgKey?: string;
  projectKey?: string;
  source: "project.yaml" | "config.yaml";
}

/**
 * Resolve the active project for a repo. Prefers .traffical/project.yaml,
 * falls back to the legacy `project:` block in config.yaml.
 * Returns null if neither is present.
 */
export async function resolveProject(
  baseDir: string = process.cwd()
): Promise<ResolvedProject | null> {
  const link = await readProjectLink(baseDir);
  if (link) {
    return {
      orgId: link.org.id,
      projectId: link.project.id,
      orgKey: link.org.key,
      projectKey: link.project.key,
      source: "project.yaml",
    };
  }

  // Back-compat: look in config.yaml
  const configPath = await findConfigFile(baseDir);
  if (configPath) {
    try {
      const config = await readConfigFile(configPath);
      if (config.project?.id && config.project?.orgId) {
        return {
          orgId: config.project.orgId,
          projectId: config.project.id,
          source: "config.yaml",
        };
      }
    } catch {
      // ignore — caller will get its own error from readConfigFile
    }
  }

  return null;
}

/**
 * Get the path to AGENTS.md file.
 * Note: AGENTS.md lives at the project root (for OpenAI Codex CLI compatibility),
 * not inside .traffical/
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns The full path to AGENTS.md
 */
export function getAgentsPath(baseDir: string = process.cwd()): string {
  return join(baseDir, AGENTS_FILENAME);
}

/** Marker used to identify Traffical section in AGENTS.md */
export const TRAFFICAL_AGENTS_MARKER = "<!-- TRAFFICAL_INTEGRATION_START -->";
export const TRAFFICAL_AGENTS_MARKER_END = "<!-- TRAFFICAL_INTEGRATION_END -->";

/**
 * Check if AGENTS.md file exists.
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns True if AGENTS.md exists
 */
export async function agentsFileExists(baseDir: string = process.cwd()): Promise<boolean> {
  try {
    await access(getAgentsPath(baseDir));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read existing AGENTS.md content.
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns The content of AGENTS.md, or null if it doesn't exist
 */
export async function readAgentsFile(baseDir: string = process.cwd()): Promise<string | null> {
  try {
    return await readFile(getAgentsPath(baseDir), "utf-8");
  } catch {
    return null;
  }
}

/**
 * Check if existing AGENTS.md already contains Traffical section.
 *
 * @param content - The content of AGENTS.md
 * @returns True if Traffical section exists
 */
export function hasTrafficalSection(content: string): boolean {
  return content.includes(TRAFFICAL_AGENTS_MARKER);
}

/**
 * Get the path to the TEMPLATES.md file.
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns The full path to TEMPLATES.md
 */
export function getTemplatesPath(baseDir: string = process.cwd()): string {
  return join(baseDir, TRAFFICAL_DIR, TEMPLATES_FILENAME);
}

/**
 * Ensure the .claude/skills/traffical directory exists.
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns The full path to the skill directory
 */
export async function ensureClaudeSkillDir(baseDir: string = process.cwd()): Promise<string> {
  const skillDir = join(baseDir, CLAUDE_DIR, CLAUDE_SKILLS_DIR, CLAUDE_SKILL_NAME);
  await mkdir(skillDir, { recursive: true });
  return skillDir;
}

/**
 * Get the path to the Claude Code Skill file.
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns The full path to SKILL.md
 */
export function getClaudeSkillPath(baseDir: string = process.cwd()): string {
  return join(baseDir, CLAUDE_DIR, CLAUDE_SKILLS_DIR, CLAUDE_SKILL_NAME, CLAUDE_SKILL_FILENAME);
}

/**
 * Check if a config file is at the legacy location.
 */
export function isLegacyConfigPath(configPath: string): boolean {
  return configPath.endsWith(LEGACY_CONFIG_FILENAME);
}

/**
 * Normalize a parsed config by flattening namespaces: blocks into the flat parameters map.
 * Parameters inside `namespaces.{nsName}.parameters.{localKey}` are merged into
 * `parameters` with the full qualified key (`{nsName}.{localKey}`, or just `{localKey}` for `main`).
 */
function normalizeConfig(raw: TrafficalConfig): TrafficalConfig {
  if (!raw.namespaces) return raw;

  const merged = { ...raw.parameters };
  for (const [nsName, nsBlock] of Object.entries(raw.namespaces)) {
    for (const [localKey, param] of Object.entries(nsBlock.parameters)) {
      const fullKey = nsName === "main" ? localKey : `${nsName}.${localKey}`;
      merged[fullKey] = { ...param, namespace: nsName };
    }
  }

  return { ...raw, parameters: merged, namespaces: undefined };
}

/**
 * Read and parse a traffical.yaml file.
 * Validates against JSON Schema before returning.
 * Normalizes grouped namespaces: blocks into the flat parameters map.
 */
export async function readConfigFile(configPath: string): Promise<TrafficalConfig> {
  const content = await readFile(configPath, "utf-8");
  const parsed = parse(content);

  // Validate against JSON Schema
  const validation = validateConfig(parsed);
  if (!validation.valid) {
    const errorDetails = formatValidationErrors(validation.errors);
    throw new Error(`Invalid traffical.yaml at ${configPath}${errorDetails}`);
  }

  return normalizeConfig(parsed as TrafficalConfig);
}

/**
 * Options for writing config file with metadata
 */
export interface WriteConfigOptions {
  /** Include metadata comments (project name, org name, date) */
  metadata?: {
    projectName?: string;
    orgName?: string;
    createdAt?: string;
  };
  /** Include example section for empty configs */
  includeExample?: boolean;
}

/**
 * Generate the example section for empty config files.
 */
function generateExampleSection(): string {
  return `
# ──────────────────────────────────────────────────────────────────────────────
# Example parameter definitions:
#
#   checkout.button.color:
#     type: string
#     default: "#FF6600"
#     namespace: checkout
#     description: Primary CTA button background color
#
#   pricing.discount.enabled:
#     type: boolean
#     default: false
#     namespace: pricing
#
#   api.rate_limit:
#     type: number
#     default: 1000
#     description: Maximum requests per minute
#
#   ui.theme.config:
#     type: json
#     default:
#       primaryColor: "#FF6600"
#       borderRadius: 8
#
# Supported types: string, number, boolean, json
# Learn more: https://docs.traffical.io/tools/config-file#parameters
#
# ──────────────────────────────────────────────────────────────────────────────
# Example event definitions:
#
#   purchase:
#     valueType: currency
#     unit: USD
#     description: User completes a purchase
#     schemaEnforcement: warn
#     propertyGroups:
#       - geo
#     properties:
#       order_id:
#         type: string
#         required: true
#       total:
#         type: number
#         required: true
#         dimension: true
#       country:
#         type: string
#         dimension: true
#
#   add_to_cart:
#     valueType: count
#     description: User adds item to cart
#
#   checkout_started:
#     valueType: boolean
#     description: User initiates checkout
#
# Supported valueTypes: currency, count, rate, boolean
# Learn more: https://docs.traffical.io/tools/config-file#events
#
# ──────────────────────────────────────────────────────────────────────────────
# Example property groups (reusable schemas across events):
#
#   geo:
#     description: Geographic context
#     properties:
#       market:
#         type: string
#         required: true
#         enum: [US, EU, APAC]
#         dimension: true
#       country:
#         type: string
#         dimension: true
#
# Learn more: https://docs.traffical.io/tools/config-file#property-groups
# ──────────────────────────────────────────────────────────────────────────────
`;
}

/**
 * Build the grouped config object for serialization.
 * Groups parameters by namespace: `main` parameters go into top-level `parameters:`,
 * all others go into `namespaces: { nsName: { parameters: { localKey: ... } } }`.
 * Strips the `namespace` field from individual parameter entries in grouped blocks.
 */
function buildGroupedConfig(config: TrafficalConfig): TrafficalConfig {
  const mainParams: Record<string, ConfigParameter> = {};
  const nsBuckets: Record<string, Record<string, ConfigParameter>> = {};

  for (const [fullKey, param] of Object.entries(config.parameters)) {
    const nsName = param.namespace ?? "main";

    if (nsName === "main") {
      // Strip namespace field for main params
      const { namespace: _, ...rest } = param;
      mainParams[fullKey] = rest;
    } else {
      // Derive local key by stripping prefix
      const prefix = nsName + ".";
      const localKey = fullKey.startsWith(prefix) ? fullKey.slice(prefix.length) : fullKey;

      if (!nsBuckets[nsName]) nsBuckets[nsName] = {};
      // Strip namespace field — it's implicit from the block
      const { namespace: _, ...rest } = param;
      nsBuckets[nsName][localKey] = rest;
    }
  }

  const grouped: TrafficalConfig = {
    version: config.version,
    parameters: mainParams,
  };

  // Preserve legacy project block on round-trip if present.
  if (config.project) {
    grouped.project = config.project;
  }

  if (Object.keys(nsBuckets).length > 0) {
    grouped.namespaces = {};
    for (const [nsName, params] of Object.entries(nsBuckets).sort(([a], [b]) => a.localeCompare(b))) {
      grouped.namespaces[nsName] = { parameters: params };
    }
  }

  if (config.events) {
    grouped.events = config.events;
  }

  return grouped;
}

/**
 * Write a traffical.yaml file.
 * Outputs the grouped namespaces: format.
 */
export async function writeConfigFile(
  configPath: string,
  config: TrafficalConfig,
  options: WriteConfigOptions = {}
): Promise<void> {
  const { metadata, includeExample } = options;

  // Build header with metadata
  let header = `# Traffical Configuration File\n`;

  if (metadata?.projectName) {
    header += `# Project: ${metadata.projectName}\n`;
  }
  if (metadata?.orgName) {
    header += `# Organization: ${metadata.orgName}\n`;
  }
  if (metadata?.createdAt) {
    header += `# Created: ${metadata.createdAt}\n`;
  }

  header += `#\n`;
  header += `# Parameters defined here are synced with Traffical.\n`;
  header += `# Base defaults become read-only in the dashboard.\n`;
  header += `# Project link lives in .traffical/project.yaml.\n`;
  header += `# Learn more: https://docs.traffical.io/tools/config-file\n`;
  header += `\n`;

  // Build the grouped config for output
  const outputConfig = buildGroupedConfig(config);

  // Generate YAML content
  let content = stringify(outputConfig, {
    indent: 2,
    lineWidth: 0, // Don't wrap lines
  });

  // Add a hint comment above empty events block
  if (outputConfig.events && Object.keys(outputConfig.events).length === 0) {
    content = content.replace(
      "events: {}\n",
      "# Track user actions for experiment analysis (see examples below)\nevents: {}\n"
    );
  }

  // Add example section if requested and config has no parameters
  const totalParams = Object.keys(config.parameters).length;
  let footer = "";
  if (includeExample && totalParams === 0) {
    footer = generateExampleSection();
  }

  await writeFile(configPath, header + content + footer, "utf-8");
}

/**
 * Options for creating a new config file
 */
export interface CreateConfigOptions {
  projectName?: string;
  orgName?: string;
  parameters?: Record<string, ConfigParameter>;
  events?: Record<string, ConfigEvent>;
}

/**
 * Create a new config.yaml file. The project link itself lives in
 * .traffical/project.yaml — written separately via writeProjectLink().
 */
export async function createConfigFile(
  configPath: string,
  options: CreateConfigOptions = {}
): Promise<TrafficalConfig> {
  const { projectName, orgName, parameters = {}, events } = options;

  const config: TrafficalConfig = {
    version: "1.0",
    parameters,
  };

  // Include events if provided, otherwise add an empty events block
  if (events && Object.keys(events).length > 0) {
    config.events = events;
  } else {
    config.events = {};
  }

  const createdAt = new Date().toISOString();

  await writeConfigFile(configPath, config, {
    metadata: {
      projectName,
      orgName,
      createdAt,
    },
    includeExample: Object.keys(parameters).length === 0,
  });

  return config;
}

/**
 * Add or update a parameter in a config file.
 */
export async function upsertParameter(
  configPath: string,
  key: string,
  param: ConfigParameter
): Promise<void> {
  const config = await readConfigFile(configPath);
  config.parameters[key] = param;
  await writeConfigFile(configPath, config);
}

/**
 * Remove a parameter from a config file.
 */
export async function removeParameter(configPath: string, key: string): Promise<boolean> {
  const config = await readConfigFile(configPath);
  if (key in config.parameters) {
    delete config.parameters[key];
    await writeConfigFile(configPath, config);
    return true;
  }
  return false;
}

/**
 * Convert API parameter to config format.
 * Returns the full key, a local key (prefix stripped), namespace name, and config object.
 */
export function apiParamToConfig(param: {
  key: string;
  type: ParameterType;
  defaultValue: ParameterValue;
  namespace?: string;
  description?: string;
  constraints?: ParameterConstraints;
}): { key: string; localKey: string; namespace: string; config: ConfigParameter } {
  const nsName = param.namespace ?? "main";

  // Derive local key by stripping namespace prefix
  let localKey = param.key;
  if (nsName !== "main") {
    const prefix = nsName + ".";
    if (param.key.startsWith(prefix)) {
      localKey = param.key.slice(prefix.length);
    }
  }

  const config: ConfigParameter = {
    type: param.type,
    default: param.defaultValue,
  };

  // In the grouped format, `namespace` is implicit from the block, so don't set it on the config.
  // But keep it for backward compat with callers that still need the flat format.
  if (nsName !== "main") {
    config.namespace = nsName;
  }

  if (param.description) {
    config.description = param.description;
  }

  if (param.constraints && Object.keys(param.constraints).length > 0) {
    const c: ParameterConstraints = {};
    if (param.constraints.min !== undefined) c.min = param.constraints.min;
    if (param.constraints.max !== undefined) c.max = param.constraints.max;
    if (param.constraints.pattern) c.pattern = param.constraints.pattern;
    if (param.constraints.allowedValues?.length) c.allowedValues = param.constraints.allowedValues;
    if (Object.keys(c).length > 0) {
      config.constraints = c;
    }
  }

  return { key: param.key, localKey, namespace: nsName, config };
}

/**
 * Convert config parameter to API sync format.
 */
export function configParamToApi(key: string, param: ConfigParameter) {
  return {
    key,
    type: param.type,
    default: param.default,
    namespace: param.namespace,
    description: param.description,
    constraints: param.constraints,
  };
}

/**
 * Convert API event definition to config format.
 */
export function apiEventToConfig(event: {
  name: string;
  valueType: EventValueType;
  unit?: string;
  description?: string;
  propertySchema?: EventPropertySchema;
  propertyGroupRefs?: string[];
  schemaVersion?: string;
  schemaEnforcement?: EventSchemaEnforcement;
}): { name: string; config: ConfigEvent } {
  const config: ConfigEvent = {
    valueType: event.valueType,
  };

  if (event.unit) {
    config.unit = event.unit;
  }

  if (event.description) {
    config.description = event.description;
  }

  if (event.schemaVersion) {
    config.schemaVersion = event.schemaVersion;
  }

  if (event.schemaEnforcement && event.schemaEnforcement !== "off") {
    config.schemaEnforcement = event.schemaEnforcement;
  }

  if (event.propertyGroupRefs?.length) {
    config.propertyGroups = event.propertyGroupRefs;
  }

  if (event.propertySchema?.properties && Object.keys(event.propertySchema.properties).length > 0) {
    config.properties = decompilePropertySchema(event.propertySchema);
  }

  return { name: event.name, config };
}

/**
 * Convert config event to API sync format.
 * Compiles the YAML DSL property definitions to JSON Schema.
 */
export function configEventToApi(name: string, event: ConfigEvent) {
  const result: {
    name: string;
    valueType: EventValueType;
    unit?: string;
    description?: string;
    propertySchema?: EventPropertySchema;
    propertyGroupRefs?: string[];
    schemaVersion?: string;
    schemaEnforcement?: EventSchemaEnforcement;
  } = {
    name,
    valueType: event.valueType,
    unit: event.unit,
    description: event.description,
    schemaVersion: event.schemaVersion,
    schemaEnforcement: event.schemaEnforcement,
    propertyGroupRefs: event.propertyGroups,
  };

  if (event.properties) {
    result.propertySchema = compilePropertySchema(event.properties);
  }

  return result;
}

/**
 * Convert config property group to API sync format.
 */
export function configPropertyGroupToApi(name: string, group: ConfigPropertyGroup) {
  const { schema, schemaVersion } = compilePropertyGroupSchema(group);
  return {
    name,
    description: group.description,
    schema,
    schemaVersion,
  };
}

/**
 * Convert API property group to config format.
 */
export function apiPropertyGroupToConfig(group: {
  name: string;
  description?: string;
  schema: EventPropertySchemaField;
  schemaVersion?: string;
}): ConfigPropertyGroup {
  const config: ConfigPropertyGroup = {
    properties: {},
  };

  if (group.description) {
    config.description = group.description;
  }

  if (group.schemaVersion) {
    config.schemaVersion = group.schemaVersion;
  }

  if (group.schema.properties) {
    const requiredSet = new Set(group.schema.required ?? []);
    for (const [name, field] of Object.entries(group.schema.properties)) {
      config.properties[name] = decompilePropertyField(field, requiredSet.has(name));
    }
  }

  return config;
}

// =============================================================================
// DSL Compiler: Traffical YAML DSL <-> JSON Schema
// =============================================================================

/**
 * Compile a Traffical YAML property DSL into JSON Schema (EventPropertySchema).
 * Lifts per-property `required` flags into the parent's `required` array.
 * Preserves Traffical extensions (dimension, warehouseType).
 */
export function compilePropertySchema(
  fields: Record<string, ConfigPropertyField>
): EventPropertySchema {
  const properties: Record<string, EventPropertySchemaField> = {};
  const required: string[] = [];

  for (const [name, field] of Object.entries(fields)) {
    if (field.required) {
      required.push(name);
    }
    properties[name] = compilePropertyField(field);
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: true,
  };
}

function compilePropertyField(field: ConfigPropertyField): EventPropertySchemaField {
  const result: EventPropertySchemaField = { type: field.type };

  if (field.description) result.description = field.description;
  if (field.enum) result.enum = field.enum;
  if (field.pattern) result.pattern = field.pattern;
  if (field.format) result.format = field.format;
  if (field.minimum !== undefined) result.minimum = field.minimum;
  if (field.maximum !== undefined) result.maximum = field.maximum;
  if (field.minLength !== undefined) result.minLength = field.minLength;
  if (field.maxLength !== undefined) result.maxLength = field.maxLength;
  if (field.default !== undefined) result.default = field.default;
  if (field.examples) result.examples = field.examples;

  if (field.dimension) result.dimension = field.dimension;
  if (field.measure) result.measure = field.measure;
  if (field.measureDisplayName) result.measureDisplayName = field.measureDisplayName;
  if (field.desiredDirection) result.desiredDirection = field.desiredDirection;
  if (field.warehouseType) result.warehouseType = field.warehouseType;

  if (field.type === "array" && field.items) {
    result.items = compilePropertyField(field.items);
  }
  if (field.minItems !== undefined) result.minItems = field.minItems;
  if (field.maxItems !== undefined) result.maxItems = field.maxItems;

  if (field.type === "object" && field.properties) {
    const nested = compilePropertySchema(field.properties);
    result.properties = nested.properties;
    if (nested.required?.length) result.required = nested.required;
  }
  if (field.additionalProperties !== undefined) {
    result.additionalProperties = field.additionalProperties;
  }

  return result;
}

/**
 * Compile a property group's DSL fields into a JSON Schema field (type: object).
 */
export function compilePropertyGroupSchema(
  group: ConfigPropertyGroup
): { schema: EventPropertySchemaField; schemaVersion?: string } {
  const compiled = compilePropertySchema(group.properties);
  return {
    schema: {
      type: "object" as const,
      properties: compiled.properties,
      required: compiled.required,
    },
    schemaVersion: group.schemaVersion,
  };
}

/**
 * Decompile a JSON Schema (EventPropertySchema) back to the Traffical YAML DSL.
 * Moves entries from the `required` array back to per-property `required: true`.
 */
export function decompilePropertySchema(
  schema: EventPropertySchema
): Record<string, ConfigPropertyField> {
  const result: Record<string, ConfigPropertyField> = {};
  const requiredSet = new Set(schema.required ?? []);

  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    result[name] = decompilePropertyField(field, requiredSet.has(name));
  }

  return result;
}

function decompilePropertyField(
  field: EventPropertySchemaField,
  isRequired: boolean
): ConfigPropertyField {
  const result: ConfigPropertyField = { type: field.type };

  if (isRequired) result.required = true;
  if (field.description) result.description = field.description;
  if (field.enum) result.enum = field.enum;
  if (field.pattern) result.pattern = field.pattern;
  if (field.format) result.format = field.format;
  if (field.minimum !== undefined) result.minimum = field.minimum;
  if (field.maximum !== undefined) result.maximum = field.maximum;
  if (field.minLength !== undefined) result.minLength = field.minLength;
  if (field.maxLength !== undefined) result.maxLength = field.maxLength;
  if (field.default !== undefined) result.default = field.default;
  if (field.examples) result.examples = field.examples;

  if (field.dimension) result.dimension = field.dimension;
  if (field.measure) result.measure = field.measure;
  if (field.measureDisplayName) result.measureDisplayName = field.measureDisplayName;
  if (field.desiredDirection) result.desiredDirection = field.desiredDirection;
  if (field.warehouseType) result.warehouseType = field.warehouseType;

  if (field.type === "array" && field.items) {
    result.items = decompilePropertyField(field.items, false);
  }
  if (field.minItems !== undefined) result.minItems = field.minItems;
  if (field.maxItems !== undefined) result.maxItems = field.maxItems;

  if (field.type === "object" && field.properties) {
    const nestedRequiredSet = new Set(field.required ?? []);
    result.properties = {};
    for (const [name, nested] of Object.entries(field.properties)) {
      result.properties[name] = decompilePropertyField(nested, nestedRequiredSet.has(name));
    }
  }
  if (field.additionalProperties !== undefined) {
    result.additionalProperties = field.additionalProperties;
  }

  return result;
}

