/**
 * status command
 *
 * Show the current sync status of the project.
 * Supports both human-readable and JSON output.
 */

import chalk from "chalk";
import { findConfigFile, readConfigFile, resolveProject, TRAFFICAL_DIR } from "../lib/config.ts";
import { ApiClient, EXIT_DRIFT_DETECTED, EXIT_SUCCESS, NotLinkedError } from "../lib/api.ts";
import { parseFormatOption, type OutputFormat } from "../lib/output.ts";
import { findMetricsFile, readMetricsFile } from "../lib/metrics-config.ts";
import type { ApiParameter, ApiEventDefinition, ApiMetricDefinition } from "../lib/types.ts";

export interface StatusOptions {
  profile?: string;
  configPath?: string;
  apiBase?: string;
  format?: string | boolean;
}

export interface ParameterInfo {
  key: string;
  type: string;
  namespace?: string;
  createdAt?: string;
  synced: boolean;
}

export interface EventInfo {
  name: string;
  valueType: string;
  unit?: string;
  createdAt?: string;
  synced: boolean;
  discovered: boolean;
}

export interface MetricInfo {
  name: string;
  metricType: string;
  synced: boolean;
  certified: boolean;
}

export interface StatusResult {
  project: {
    id: string;
    name: string;
    key: string;
  };
  org: {
    id: string;
    name: string;
    key: string;
  };
  configPath: string;
  metricsPath?: string;
  // Parameters
  synced: ParameterInfo[];
  dashboardOnly: ParameterInfo[];
  localOnly: ParameterInfo[];
  // Events
  events: {
    synced: EventInfo[];
    dashboardOnly: EventInfo[];
    localOnly: EventInfo[];
    discovered: EventInfo[];
  };
  // Metrics
  metrics: {
    synced: MetricInfo[];
    certified: MetricInfo[];
    dashboardOnly: MetricInfo[];
    localOnly: MetricInfo[];
    remoteOnly: MetricInfo[];
  };
  hasDrift: boolean;
}

/**
 * Core function to get status (can be used by MCP or other integrations).
 */
export async function getStatus(options: {
  profile?: string;
  configPath?: string;
  apiBase?: string;
}): Promise<StatusResult> {
  // Find config file
  const configPath = options.configPath || (await findConfigFile());

  if (!configPath) {
    throw new Error(
      `No ${TRAFFICAL_DIR}/config.yaml found. Run 'traffical init' to create one.`
    );
  }

  // Read config (parameters/events) and resolve the project link separately
  const config = await readConfigFile(configPath);
  const link = await resolveProject();
  if (!link) {
    throw new NotLinkedError();
  }
  const projectId = link.projectId;

  // Create API client
  const client = await ApiClient.create({ profile: options.profile, apiBase: options.apiBase });

  // Get project and org info
  const project = await client.getProject(projectId);
  const org = await client.getOrganization(link.orgId);

  // ==========================================================================
  // Parameters
  // ==========================================================================

  // Get all parameters from API
  const allParams = await client.listParameters(projectId);
  const namespaces = await client.listNamespaces(projectId);
  const namespaceMap = new Map(namespaces.map((ns) => [ns.id, ns]));

  // Categorize parameters
  const syncedParams = allParams.filter((p) => p.synced);
  const dashboardOnlyParams = allParams.filter((p) => !p.synced);

  // Find local-only params (in config but not synced remotely)
  const remoteParamKeys = new Set(allParams.map((p) => p.key));
  const localOnlyParamKeys = Object.keys(config.parameters).filter(
    (key) => !remoteParamKeys.has(key)
  );

  // Convert to ParameterInfo
  const toParameterInfo = (p: ApiParameter): ParameterInfo => {
    const namespace = namespaceMap.get(p.namespaceId);
    return {
      key: p.key,
      type: p.type,
      namespace: namespace?.name,
      createdAt: p.createdAt,
      synced: p.synced ?? false,
    };
  };

  const synced = syncedParams.map(toParameterInfo);
  const dashboardOnly = dashboardOnlyParams.map(toParameterInfo);
  const localOnly = localOnlyParamKeys.map((key) => {
    const param = config.parameters[key]!;
    return {
      key,
      type: param.type,
      namespace: param.namespace,
      synced: false,
    } as ParameterInfo;
  });

  // ==========================================================================
  // Events
  // ==========================================================================

  // Get all events from API
  const allEvents = await client.listEventDefinitions(projectId);

  // Categorize events
  const syncedEvents = allEvents.filter((e) => e.synced);
  const discoveredEvents = allEvents.filter((e) => e.discovered && !e.synced);
  const dashboardOnlyEvents = allEvents.filter((e) => !e.synced && !e.discovered);

  // Find local-only events (in config but not synced remotely)
  const configEvents = config.events ?? {};
  const remoteEventNames = new Set(allEvents.map((e) => e.name));
  const localOnlyEventNames = Object.keys(configEvents).filter(
    (name) => !remoteEventNames.has(name)
  );

  // Convert to EventInfo
  const toEventInfo = (e: ApiEventDefinition): EventInfo => ({
    name: e.name,
    valueType: e.valueType,
    unit: e.unit,
    createdAt: e.createdAt,
    synced: e.synced,
    discovered: e.discovered,
  });

  const eventsSynced = syncedEvents.map(toEventInfo);
  const eventsDashboardOnly = dashboardOnlyEvents.map(toEventInfo);
  const eventsDiscovered = discoveredEvents.map(toEventInfo);
  const eventsLocalOnly = localOnlyEventNames.map((name) => {
    const event = configEvents[name]!;
    return {
      name,
      valueType: event.valueType,
      unit: event.unit,
      synced: false,
      discovered: false,
    } as EventInfo;
  });

  // ==========================================================================
  // Metrics
  // ==========================================================================
  const metricsPath = await findMetricsFile();
  let metricsConfig = null;
  if (metricsPath) {
    try {
      metricsConfig = await readMetricsFile(metricsPath);
    } catch {
      // ignore parse errors for status
    }
  }

  const allMetrics = await client.listMetrics(link.projectId);

  const toMetricInfo = (m: ApiMetricDefinition): MetricInfo => ({
    name: m.name,
    metricType: m.metricType,
    synced: m.synced ?? false,
    certified: m.certificationStatus === "certified",
  });

  const syncedMetrics = allMetrics.filter((m) => m.synced).map(toMetricInfo);
  const certifiedMetrics = allMetrics.filter((m) => m.certificationStatus === "certified").map(toMetricInfo);
  const dashboardOnlyMetrics = allMetrics.filter((m) => !m.synced).map(toMetricInfo);

  const localMetricNames = metricsConfig ? Object.keys(metricsConfig.metrics) : [];
  const remoteMetricNames = new Set(allMetrics.map((m) => m.name));
  const localOnlyMetrics = localMetricNames.filter((n) => !remoteMetricNames.has(n)).map((n) => ({
    name: n,
    metricType: metricsConfig?.metrics[n]?.metricType ?? "unknown",
    synced: false,
    certified: metricsConfig?.metrics[n]?.certified ?? false,
  }));

  const configMetricNames = new Set(localMetricNames);
  const remoteOnlyMetrics = allMetrics
    .filter((m) => m.synced && !configMetricNames.has(m.name))
    .map(toMetricInfo);

  // Drift exists if there are local-only params, events, or metrics
  const hasDrift = localOnlyParamKeys.length > 0 || localOnlyEventNames.length > 0 || localOnlyMetrics.length > 0;

  return {
    project: {
      id: project.id,
      name: project.name,
      key: project.key,
    },
    org: {
      id: org.id,
      name: org.name,
      key: org.key,
    },
    configPath,
    metricsPath: metricsPath ?? undefined,
    synced,
    dashboardOnly,
    localOnly,
    events: {
      synced: eventsSynced,
      dashboardOnly: eventsDashboardOnly,
      localOnly: eventsLocalOnly,
      discovered: eventsDiscovered,
    },
    metrics: {
      synced: syncedMetrics,
      certified: certifiedMetrics,
      dashboardOnly: dashboardOnlyMetrics,
      localOnly: localOnlyMetrics,
      remoteOnly: remoteOnlyMetrics,
    },
    hasDrift,
  };
}

/**
 * Format status result for human-readable output.
 */
function printStatusHuman(result: StatusResult): void {
  console.log(chalk.dim(`Using config: ${result.configPath}\n`));
  console.log(`Connected to: ${chalk.bold(`${result.org.name}/${result.project.name}`)} (${result.project.id})\n`);

  // ==========================================================================
  // Parameters
  // ==========================================================================
  console.log(chalk.cyan.bold("Parameters"));
  console.log();

  // Display synced parameters
  console.log(chalk.bold(`  Synced: ${result.synced.length} parameter${result.synced.length !== 1 ? "s" : ""}`));
  if (result.synced.length > 0) {
    result.synced.forEach((p) => {
      console.log(chalk.dim(`    ${p.key}`));
    });
  }
  console.log();

  // Display dashboard-only parameters
  console.log(
    chalk.bold(`  Dashboard-only: ${result.dashboardOnly.length} parameter${result.dashboardOnly.length !== 1 ? "s" : ""}`)
  );
  if (result.dashboardOnly.length > 0) {
    result.dashboardOnly.forEach((p) => {
      const age = p.createdAt ? getTimeAgo(new Date(p.createdAt)) : "";
      console.log(chalk.dim(`    ${p.key}`) + (age ? chalk.gray(` (created ${age})`) : ""));
    });
  }
  console.log();

  // Display local-only parameters
  if (result.localOnly.length > 0) {
    console.log(
      chalk.yellow(`  Local-only: ${result.localOnly.length} parameter${result.localOnly.length !== 1 ? "s" : ""} (not yet pushed)`)
    );
    result.localOnly.forEach((p) => {
      console.log(chalk.dim(`    ${p.key}`));
    });
    console.log();
  }

  // ==========================================================================
  // Events
  // ==========================================================================
  const totalEvents = result.events.synced.length + result.events.dashboardOnly.length + 
                      result.events.localOnly.length + result.events.discovered.length;
  
  if (totalEvents > 0 || Object.keys(result.events).some(k => (result.events as any)[k].length > 0)) {
    console.log(chalk.cyan.bold("Events"));
    console.log();

    // Display synced events
    console.log(chalk.bold(`  Synced: ${result.events.synced.length} event${result.events.synced.length !== 1 ? "s" : ""}`));
    if (result.events.synced.length > 0) {
      result.events.synced.forEach((e) => {
        console.log(chalk.dim(`    ${e.name}`) + chalk.gray(` (${e.valueType})`));
      });
    }
    console.log();

    // Display dashboard-only events
    console.log(
      chalk.bold(`  Dashboard-only: ${result.events.dashboardOnly.length} event${result.events.dashboardOnly.length !== 1 ? "s" : ""}`)
    );
    if (result.events.dashboardOnly.length > 0) {
      result.events.dashboardOnly.forEach((e) => {
        const age = e.createdAt ? getTimeAgo(new Date(e.createdAt)) : "";
        console.log(chalk.dim(`    ${e.name}`) + chalk.gray(` (${e.valueType})`) + (age ? chalk.gray(` created ${age}`) : ""));
      });
    }
    console.log();

    // Display discovered events
    if (result.events.discovered.length > 0) {
      console.log(
        chalk.magenta(`  Discovered: ${result.events.discovered.length} event${result.events.discovered.length !== 1 ? "s" : ""} (auto-detected from tracking)`)
      );
      result.events.discovered.forEach((e) => {
        const age = e.createdAt ? getTimeAgo(new Date(e.createdAt)) : "";
        console.log(chalk.dim(`    ${e.name}`) + chalk.gray(` (${e.valueType})`) + (age ? chalk.gray(` discovered ${age}`) : ""));
      });
      console.log();
    }

    // Display local-only events
    if (result.events.localOnly.length > 0) {
      console.log(
        chalk.yellow(`  Local-only: ${result.events.localOnly.length} event${result.events.localOnly.length !== 1 ? "s" : ""} (not yet pushed)`)
      );
      result.events.localOnly.forEach((e) => {
        console.log(chalk.dim(`    ${e.name}`) + chalk.gray(` (${e.valueType})`));
      });
      console.log();
    }
  }

  // ==========================================================================
  // Metrics
  // ==========================================================================
  const totalMetrics = result.metrics.synced.length + result.metrics.dashboardOnly.length +
                       result.metrics.localOnly.length + result.metrics.remoteOnly.length;

  if (totalMetrics > 0 || result.metricsPath) {
    console.log(chalk.cyan.bold("Metrics"));
    if (result.metricsPath) {
      console.log(chalk.dim(`  Config: ${result.metricsPath}`));
    }
    console.log();

    console.log(chalk.bold(`  Synced: ${result.metrics.synced.length} metric${result.metrics.synced.length !== 1 ? "s" : ""}`));
    if (result.metrics.synced.length > 0) {
      result.metrics.synced.forEach((m) => {
        const badge = m.certified ? chalk.green(" [certified]") : "";
        console.log(chalk.dim(`    ${m.name}`) + chalk.gray(` (${m.metricType})`) + badge);
      });
    }
    console.log();

    if (result.metrics.certified.length > 0) {
      console.log(chalk.bold(`  Certified: ${result.metrics.certified.length} metric${result.metrics.certified.length !== 1 ? "s" : ""}`));
      result.metrics.certified.forEach((m) => {
        console.log(chalk.dim(`    ${m.name}`) + chalk.gray(` (${m.metricType})`));
      });
      console.log();
    }

    console.log(
      chalk.bold(`  Dashboard-only: ${result.metrics.dashboardOnly.length} metric${result.metrics.dashboardOnly.length !== 1 ? "s" : ""}`)
    );
    if (result.metrics.dashboardOnly.length > 0) {
      result.metrics.dashboardOnly.forEach((m) => {
        console.log(chalk.dim(`    ${m.name}`) + chalk.gray(` (${m.metricType})`));
      });
    }
    console.log();

    if (result.metrics.localOnly.length > 0) {
      console.log(
        chalk.yellow(`  Local-only: ${result.metrics.localOnly.length} metric${result.metrics.localOnly.length !== 1 ? "s" : ""} (not yet pushed)`)
      );
      result.metrics.localOnly.forEach((m) => {
        console.log(chalk.dim(`    ${m.name}`) + chalk.gray(` (${m.metricType})`));
      });
      console.log();
    }

    if (result.metrics.remoteOnly.length > 0) {
      console.log(
        chalk.yellow(`  Remote-only: ${result.metrics.remoteOnly.length} synced metric${result.metrics.remoteOnly.length !== 1 ? "s" : ""} not in metrics.yaml`)
      );
      result.metrics.remoteOnly.forEach((m) => {
        console.log(chalk.dim(`    ${m.name}`) + chalk.gray(` (${m.metricType})`));
      });
      console.log();
    }
  }

  // ==========================================================================
  // Suggestions
  // ==========================================================================
  if (result.dashboardOnly.length > 0) {
    console.log(chalk.dim("Import dashboard parameters to your config:"));
    console.log(chalk.dim("  traffical import param <key>  # Import a single parameter"));
    console.log(chalk.dim("  traffical import param 'ui.*' # Import all ui.* parameters"));
    console.log();
  }

  if (result.metrics.dashboardOnly.length > 0) {
    console.log(chalk.dim("Import dashboard metrics to metrics.yaml:"));
    console.log(chalk.dim("  traffical import metrics --all  # Import all metrics"));
    console.log();
  }
  
  const hasLocalOnlyItems = result.localOnly.length > 0 || result.events.localOnly.length > 0 || result.metrics.localOnly.length > 0;
  if (hasLocalOnlyItems) {
    console.log(chalk.dim(`Run 'traffical push' to sync local-only items.`));
  }
  
  if (result.events.discovered.length > 0) {
    console.log(chalk.dim(`Run 'traffical pull' to add discovered events to your config.`));
  }
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const format = parseFormatOption(options.format);
  const result = await getStatus(options);

  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printStatusHuman(result);
  }

  // Exit with drift code if there are local-only params
  if (result.hasDrift) {
    process.exitCode = EXIT_DRIFT_DETECTED;
  }
}

/**
 * Get a human-readable time ago string.
 */
function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;

  return date.toLocaleDateString();
}
