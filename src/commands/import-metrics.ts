/**
 * import metrics command
 *
 * Export metric definitions from the dashboard to a local metrics.yaml file.
 *
 * Usage:
 *   traffical import metrics Revenue      - Export one metric by name
 *   traffical import metrics --all        - Export all metrics
 */

import chalk from "chalk";
import { join } from "path";
import { ApiClient, ValidationError, NotLinkedError } from "../lib/api.ts";
import { resolveProject, ensureTrafficalDir, TRAFFICAL_DIR } from "../lib/config.ts";
import {
  findMetricsFile,
  readMetricsFile,
  writeMetricsFile,
  apiMetricsToConfig,
  METRICS_FILENAME,
} from "../lib/metrics-config.ts";
import { parseFormatOption } from "../lib/output.ts";
import type { MetricsConfig } from "../lib/types.ts";

export interface ImportMetricsOptions {
  profile?: string;
  apiBase?: string;
  name?: string;
  all?: boolean;
  metricsFile?: string;
  format?: string | boolean;
}

export async function importMetricsCommand(options: ImportMetricsOptions): Promise<void> {
  const format = parseFormatOption(options.format);
  const isJson = format === "json";

  if (!options.name && !options.all) {
    throw new ValidationError("Specify a metric name or use --all to import all metrics.");
  }

  const link = await resolveProject();
  if (!link) {
    throw new NotLinkedError();
  }

  const client = await ApiClient.create({ profile: options.profile, apiBase: options.apiBase });

  const [allMetrics, factDefinitions] = await Promise.all([
    client.listMetrics(link.projectId),
    client.listFactDefinitions(link.projectId),
  ]);

  let selectedMetrics = allMetrics;
  if (options.name && !options.all) {
    selectedMetrics = allMetrics.filter(
      (m) => m.name.toLowerCase() === options.name!.toLowerCase()
    );
    if (selectedMetrics.length === 0) {
      throw new ValidationError(`Metric "${options.name}" not found in project.`);
    }
  }

  // Build the config from API data, resolving fact IDs to names
  const newConfig = apiMetricsToConfig(selectedMetrics, factDefinitions);

  // Merge with existing metrics.yaml if it exists
  const existingPath = await findMetricsFile(options.metricsFile);
  let config: MetricsConfig;
  if (existingPath) {
    try {
      config = await readMetricsFile(existingPath);
      // Merge: incoming metrics overwrite by name
      for (const [name, metric] of Object.entries(newConfig.metrics)) {
        config.metrics[name] = metric;
      }
    } catch {
      config = newConfig;
    }
  } else {
    config = newConfig;
  }

  // Write the file
  const trafficalDir = await ensureTrafficalDir();
  const metricsPath = existingPath ?? join(trafficalDir, METRICS_FILENAME);
  await writeMetricsFile(metricsPath, config);

  if (isJson) {
    console.log(JSON.stringify({
      success: true,
      path: metricsPath,
      imported: selectedMetrics.map((m) => m.name),
      total: selectedMetrics.length,
    }, null, 2));
  } else {
    console.log(chalk.green(`✓ Imported ${selectedMetrics.length} metric${selectedMetrics.length !== 1 ? "s" : ""} to ${metricsPath}`));
    for (const m of selectedMetrics) {
      const badges: string[] = [];
      if (m.synced) badges.push(chalk.blue("synced"));
      if (m.certificationStatus === "certified") badges.push(chalk.green("certified"));
      const badgeStr = badges.length > 0 ? ` [${badges.join(", ")}]` : "";
      console.log(chalk.dim(`  ${m.name} (${m.metricType})${badgeStr}`));
    }
    console.log();
    console.log(chalk.dim("Run 'traffical push' to sync these metrics back to the dashboard."));
  }
}
