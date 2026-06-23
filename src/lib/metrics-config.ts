/**
 * Metrics Config File Parser
 *
 * Reads and writes .traffical/metrics.yaml files for metrics-as-code.
 */

import { parse, stringify } from "yaml";
import { readFile, writeFile, access } from "fs/promises";
import { join, dirname } from "path";
import Ajv from "ajv";
import type {
  MetricsConfig,
  ConfigFactSource,
  ConfigMetric,
  MetricSyncRequest,
  ApiMetricDefinition,
} from "./types.ts";
import { TRAFFICAL_DIR } from "./config.ts";

import metricsSchema from "../../schemas/traffical-metrics.schema.json";

export const METRICS_FILENAME = "metrics.yaml";

const ajv = new Ajv({ allErrors: true, verbose: true });
const validateMetricsSchema = ajv.compile(metricsSchema);

export interface MetricsValidationError {
  path: string;
  message: string;
}

export interface MetricsValidationResult {
  valid: boolean;
  errors: MetricsValidationError[];
}

export function validateMetricsConfig(config: unknown): MetricsValidationResult {
  const valid = validateMetricsSchema(config);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const rawErrors = validateMetricsSchema.errors || [];

  const errors: MetricsValidationError[] = rawErrors
    .filter((err) => !["if", "then", "oneOf"].includes(err.keyword))
    .map((err) => {
      let path = err.instancePath || "/";
      if (path.startsWith("/")) {
        path = path.slice(1).replace(/\//g, ".");
      }
      if (!path) path = "(root)";

      let message = err.message || "Unknown error";
      if (err.keyword === "enum" && err.params?.allowedValues) {
        message = `must be one of: ${(err.params.allowedValues as string[]).join(", ")}`;
      } else if (err.keyword === "required" && err.params?.missingProperty) {
        message = `missing required property '${err.params.missingProperty}'`;
        path = path === "(root)" ? (err.params.missingProperty as string) : `${path}.${err.params.missingProperty}`;
      }

      return { path, message };
    });

  const unique = errors.filter(
    (err, i, self) => i === self.findIndex((e) => e.path === err.path && e.message === err.message)
  );

  return { valid: false, errors: unique };
}

export function formatMetricsValidationErrors(errors: MetricsValidationError[]): string {
  if (errors.length === 0) return "";
  const lines = ["", "Errors:"];
  for (const err of errors) {
    lines.push(`  - ${err.path}: ${err.message}`);
  }
  return lines.join("\n");
}

/**
 * Find the metrics.yaml file. Checks .traffical/metrics.yaml, or uses a custom path.
 */
export async function findMetricsFile(
  customPath?: string,
  startDir: string = process.cwd()
): Promise<string | null> {
  if (customPath) {
    try {
      await access(customPath);
      return customPath;
    } catch {
      return null;
    }
  }

  let currentDir = startDir;
  while (true) {
    const path = join(currentDir, TRAFFICAL_DIR, METRICS_FILENAME);
    try {
      await access(path);
      return path;
    } catch {
      // Not found, walk up
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

/**
 * Read and parse a metrics.yaml file.
 */
export async function readMetricsFile(metricsPath: string): Promise<MetricsConfig> {
  const content = await readFile(metricsPath, "utf-8");
  const parsed = parse(content);

  const validation = validateMetricsConfig(parsed);
  if (!validation.valid) {
    const errorDetails = formatMetricsValidationErrors(validation.errors);
    throw new Error(`Invalid metrics.yaml at ${metricsPath}${errorDetails}`);
  }

  return parsed as MetricsConfig;
}

/**
 * Transform a parsed MetricsConfig into the API sync request payload.
 */
export function metricsConfigToSyncRequest(
  config: MetricsConfig,
  source: string = "metrics.yaml"
): MetricSyncRequest {
  const factSources = config.fact_sources
    ? Object.entries(config.fact_sources).map(([name, fact]) => metricsFactToApi(name, fact))
    : undefined;

  const metrics = Object.entries(config.metrics).map(([name, metric]) =>
    metricsMetricToApi(name, metric)
  );

  return {
    factSources: factSources && factSources.length > 0 ? factSources : undefined,
    metrics,
    source,
  };
}

export function metricsFactToApi(name: string, fact: ConfigFactSource) {
  return {
    name,
    description: fact.description,
    sql: fact.sql,
    timestampColumn: fact.timestamp_column,
    measures: fact.measures,
    dimensions: fact.dimensions,
  };
}

export function metricsMetricToApi(name: string, metric: ConfigMetric) {
  return {
    name,
    displayName: metric.display_name,
    description: metric.description,
    metricType: metric.metricType,
    event: metric.event,
    fact: metric.fact,
    measure: metric.measure,
    desiredDirection: metric.desiredDirection,
    unit: metric.unit,
    winsorizeAt: metric.winsorizeAt,
    certificationStatus: metric.certified ? ("certified" as const) : undefined,
    filters: metric.filters as any,
    timeframe: metric.timeframe,
    numerator: metric.numerator,
    denominator: metric.denominator,
    percentile: metric.percentile,
    funnelSteps: metric.funnelSteps,
  };
}

/**
 * Write a metrics.yaml file from config.
 */
export async function writeMetricsFile(
  metricsPath: string,
  config: MetricsConfig
): Promise<void> {
  const header = [
    `# Traffical Metrics Configuration`,
    `#`,
    `# Metrics defined here are synced with Traffical via 'traffical push'.`,
    `# Synced metrics become read-only in the dashboard.`,
    `# Learn more: https://docs.traffical.io/tools/config-file#metrics-yaml`,
    ``,
  ].join("\n");

  const body = stringify(config, { indent: 2, lineWidth: 0 });
  await writeFile(metricsPath, header + body, "utf-8");
}

/**
 * Convert API metric definitions back to a MetricsConfig for import.
 */
export function apiMetricsToConfig(
  metrics: ApiMetricDefinition[],
  factDefinitions?: Array<{ id: string; name: string; sqlText?: string; columnMapping?: any }>
): MetricsConfig {
  const config: MetricsConfig = {
    version: "1.0",
    metrics: {},
  };

  const factIdToName = new Map<string, string>();
  if (factDefinitions) {
    for (const fact of factDefinitions) {
      factIdToName.set(fact.id, fact.name);
    }
  }

  for (const metric of metrics) {
    const entry: ConfigMetric = {
      metricType: metric.metricType,
    };

    if (metric.displayName) entry.display_name = metric.displayName;
    if (metric.description) entry.description = metric.description;
    if (metric.desiredDirection) entry.desiredDirection = metric.desiredDirection;
    if (metric.unit) entry.unit = metric.unit;
    if (metric.winsorizeAt) entry.winsorizeAt = metric.winsorizeAt;
    if (metric.certificationStatus === "certified") entry.certified = true;

    if (metric.factDefinitionId) {
      const factName = factIdToName.get(metric.factDefinitionId);
      if (factName) {
        entry.fact = factName;
      }
    }
    if (metric.factMeasureColumn) entry.measure = metric.factMeasureColumn;

    if (metric.filters && metric.filters.length > 0) {
      entry.filters = metric.filters.map((f) => ({
        dimension: f.column,
        operator: f.operator,
        values: f.values,
      }));
    }
    if (metric.timeframe) entry.timeframe = metric.timeframe;

    if (metric.extendedConfig) {
      if (metric.extendedConfig.numerator) entry.numerator = metric.extendedConfig.numerator as any;
      if (metric.extendedConfig.denominator) entry.denominator = metric.extendedConfig.denominator as any;
      if (metric.extendedConfig.percentile) entry.percentile = metric.extendedConfig.percentile as number;
      if (metric.extendedConfig.funnelSteps) entry.funnelSteps = metric.extendedConfig.funnelSteps as any;
    }

    config.metrics[metric.name] = entry;
  }

  return config;
}
