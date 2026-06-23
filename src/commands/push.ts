/**
 * push command
 *
 * Push local config file parameters and events to Traffical.
 * Creates new parameters/events, updates existing ones.
 * Supports both human-readable and JSON output.
 */

import chalk from "chalk";
import {
  findConfigFile,
  readConfigFile,
  resolveProject,
  configParamToApi,
  configEventToApi,
  configPropertyGroupToApi,
  compilePropertySchema,
  TRAFFICAL_DIR,
} from "../lib/config.ts";
import { ApiClient, ValidationError, NotLinkedError } from "../lib/api.ts";
import { parseFormatOption } from "../lib/output.ts";
import {
  findMetricsFile,
  readMetricsFile,
  metricsConfigToSyncRequest,
} from "../lib/metrics-config.ts";

export interface PushOptions {
  profile?: string;
  configPath?: string;
  metricsFile?: string;
  apiBase?: string;
  dryRun?: boolean;
  prune?: boolean;
  format?: string | boolean;
}

export interface PushResult {
  success: boolean;
  project: {
    id: string;
    name: string;
  };
  configPath: string;
  dryRun: boolean;
  created: string[];
  updated: string[];
  unchanged: string[];
  remoteOnly: string[];
  pruned: string[];
  total: number;
  events: {
    created: string[];
    updated: string[];
    unchanged: string[];
    remoteOnly: string[];
    total: number;
  };
  propertyGroups: {
    created: string[];
    updated: string[];
    unchanged: string[];
    total: number;
  };
  metrics: {
    created: string[];
    updated: string[];
    unchanged: string[];
    remoteOnly: string[];
    certified: number;
    total: number;
    warnings?: string[];
  };
  metricsPath?: string;
}

/**
 * Core push function (can be used by MCP or other integrations).
 */
export async function pushConfig(options: {
  profile?: string;
  configPath?: string;
  metricsFile?: string;
  apiBase?: string;
  dryRun?: boolean;
  prune?: boolean;
}): Promise<PushResult> {
  const isDryRun = options.dryRun || false;

  // Find config file
  const configPath = options.configPath || (await findConfigFile());

  if (!configPath) {
    throw new ValidationError(
      `No ${TRAFFICAL_DIR}/config.yaml found. Run 'traffical init' to create one.`
    );
  }

  // Read, validate, and normalize config (flattens namespaces into parameters)
  let config;
  try {
    config = await readConfigFile(configPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ValidationError(message);
  }

  const link = await resolveProject();
  if (!link) {
    throw new NotLinkedError();
  }
  const projectId = link.projectId;

  // Create API client
  const client = await ApiClient.create({ profile: options.profile, apiBase: options.apiBase });

  // Get project info
  const project = await client.getProject(projectId);

  // Convert config parameters to API format
  const parameters = Object.entries(config.parameters).map(([key, param]) =>
    configParamToApi(key, param)
  );

  // Convert config events to API format
  const events = Object.entries(config.events || {}).map(([name, event]) =>
    configEventToApi(name, event)
  );

  // Convert config property groups to API format
  const propertyGroups = Object.entries(config.propertyGroups || {}).map(
    ([name, group]) => configPropertyGroupToApi(name, group)
  );

  // Auto-detect metrics.yaml
  const metricsPath = await findMetricsFile(options.metricsFile);
  let metricsRequest = null;
  if (metricsPath) {
    try {
      const metricsConfig = await readMetricsFile(metricsPath);
      metricsRequest = metricsConfigToSyncRequest(metricsConfig);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ValidationError(message);
    }
  }

  const emptyMetrics: PushResult["metrics"] = {
    created: [],
    updated: [],
    unchanged: [],
    remoteOnly: [],
    certified: 0,
    total: 0,
  };

  if (parameters.length === 0 && events.length === 0 && propertyGroups.length === 0 && !metricsRequest) {
    return {
      success: true,
      project: { id: project.id, name: project.name },
      configPath,
      dryRun: isDryRun,
      created: [],
      updated: [],
      unchanged: [],
      remoteOnly: [],
      pruned: [],
      total: 0,
      events: {
        created: [],
        updated: [],
        unchanged: [],
        remoteOnly: [],
        total: 0,
      },
      propertyGroups: {
        created: [],
        updated: [],
        unchanged: [],
        total: 0,
      },
      metrics: emptyMetrics,
    };
  }

  if (isDryRun) {
    // Dry run: compare parameters with remote
    const remoteParams = await client.listParameters(projectId, { synced: true });
    const remoteKeys = new Map(remoteParams.map((p) => [p.key, p]));

    const created: string[] = [];
    const updated: string[] = [];
    const unchanged: string[] = [];

    for (const param of parameters) {
      const remote = remoteKeys.get(param.key);
      if (!remote) {
        created.push(param.key);
      } else if (
        JSON.stringify(remote.defaultValue) !== JSON.stringify(param.default) ||
        remote.type !== param.type
      ) {
        updated.push(param.key);
      } else {
        unchanged.push(param.key);
      }
    }

    const localKeys = new Set(parameters.map((p) => p.key));
    const remoteOnly = remoteParams.filter((p) => !localKeys.has(p.key)).map((p) => p.key);

    // Dry run: compare events with remote (including schema fields)
    const remoteEvents = await client.listEventDefinitions(projectId, { synced: true });
    const remoteEventNames = new Map(remoteEvents.map((e) => [e.name, e]));

    const eventsCreated: string[] = [];
    const eventsUpdated: string[] = [];
    const eventsUnchanged: string[] = [];

    for (const event of events) {
      const remote = remoteEventNames.get(event.name as string);
      if (!remote) {
        eventsCreated.push(event.name as string);
      } else if (
        remote.valueType !== event.valueType ||
        remote.unit !== event.unit ||
        remote.schemaVersion !== event.schemaVersion ||
        remote.schemaEnforcement !== (event.schemaEnforcement || undefined) ||
        JSON.stringify(remote.propertySchema) !== JSON.stringify(event.propertySchema)
      ) {
        eventsUpdated.push(event.name as string);
      } else {
        eventsUnchanged.push(event.name as string);
      }
    }

    const localEventNames = new Set(events.map((e) => e.name));
    const eventsRemoteOnly = remoteEvents.filter((e) => !localEventNames.has(e.name)).map((e) => e.name);

    // Dry run: compare property groups with remote
    const remoteGroups = propertyGroups.length > 0 ? await client.listPropertyGroups(projectId) : [];
    const remoteGroupNames = new Map(remoteGroups.map((g) => [g.name, g]));

    const groupsCreated: string[] = [];
    const groupsUpdated: string[] = [];
    const groupsUnchanged: string[] = [];

    for (const group of propertyGroups) {
      const remote = remoteGroupNames.get(group.name);
      if (!remote) {
        groupsCreated.push(group.name);
      } else if (
        JSON.stringify(remote.schema) !== JSON.stringify(group.schema) ||
        remote.schemaVersion !== group.schemaVersion
      ) {
        groupsUpdated.push(group.name);
      } else {
        groupsUnchanged.push(group.name);
      }
    }

    // Dry run: compare metrics with remote
    let metricsDry = emptyMetrics;
    if (metricsRequest) {
      const remoteMetrics = await client.listMetrics(projectId, { synced: true });
      const remoteMetricNames = new Map(remoteMetrics.map((m) => [m.name, m]));

      const metricsCreated: string[] = [];
      const metricsUpdated: string[] = [];
      const metricsUnchanged: string[] = [];

      for (const metric of metricsRequest.metrics) {
        const remote = remoteMetricNames.get(metric.name);
        if (!remote) {
          metricsCreated.push(metric.name);
        } else if (
          remote.metricType !== metric.metricType ||
          (remote.description ?? null) !== (metric.description ?? null) ||
          (remote.unit ?? null) !== (metric.unit ?? null) ||
          (remote.desiredDirection ?? null) !== (metric.desiredDirection ?? null)
        ) {
          metricsUpdated.push(metric.name);
        } else {
          metricsUnchanged.push(metric.name);
        }
      }

      const localMetricNames = new Set(metricsRequest.metrics.map((m) => m.name));
      const metricsRemoteOnly = remoteMetrics.filter((m) => !localMetricNames.has(m.name)).map((m) => m.name);
      const certifiedCount = metricsRequest.metrics.filter((m) => m.certificationStatus === "certified").length;

      metricsDry = {
        created: metricsCreated,
        updated: metricsUpdated,
        unchanged: metricsUnchanged,
        remoteOnly: metricsRemoteOnly,
        certified: certifiedCount,
        total: metricsRequest.metrics.length,
      };
    }

    return {
      success: true,
      project: { id: project.id, name: project.name },
      configPath,
      dryRun: true,
      created,
      updated,
      unchanged,
      remoteOnly,
      pruned: options.prune ? remoteOnly : [],
      total: parameters.length,
      events: {
        created: eventsCreated,
        updated: eventsUpdated,
        unchanged: eventsUnchanged,
        remoteOnly: eventsRemoteOnly,
        total: events.length,
      },
      propertyGroups: {
        created: groupsCreated,
        updated: groupsUpdated,
        unchanged: groupsUnchanged,
        total: propertyGroups.length,
      },
      metrics: metricsDry,
      metricsPath: metricsPath ?? undefined,
    };
  }

  // Actual push - parameters
  const result = await client.syncParameters(projectId, {
    parameters,
    source: "config.yaml",
  });

  // Actual push - property groups (before events, since events may reference groups)
  let groupResult = { created: [], updated: [], unchanged: [] } as {
    created: { name: string }[];
    updated: { name: string }[];
    unchanged: { name: string }[];
  };
  if (propertyGroups.length > 0) {
    groupResult = await client.syncPropertyGroups(projectId, {
      groups: propertyGroups,
      source: "config.yaml",
    });
  }

  // Actual push - events
  let eventResult = { created: [], updated: [], unchanged: [], remoteOnly: [] } as {
    created: { name: string }[];
    updated: { name: string }[];
    unchanged: { name: string }[];
    remoteOnly: { name: string }[];
  };
  if (events.length > 0) {
    eventResult = await client.syncEventDefinitions(projectId, {
      events,
      source: "config.yaml",
    });
  }

  // Actual push - metrics
  let metricsResult = emptyMetrics;
  if (metricsRequest) {
    const syncResult = await client.syncMetrics(projectId, metricsRequest);
    const certifiedCount = metricsRequest.metrics.filter((m) => m.certificationStatus === "certified").length;
    metricsResult = {
      created: syncResult.metrics.created.map((m) => m.name),
      updated: syncResult.metrics.updated.map((m) => m.name),
      unchanged: syncResult.metrics.unchanged.map((m) => m.name),
      remoteOnly: syncResult.metrics.remoteOnly.map((m) => m.name),
      certified: certifiedCount,
      total: metricsRequest.metrics.length,
      warnings: syncResult.warnings,
    };
  }

  // Handle --prune: archive orphaned synced parameters
  const pruned: string[] = [];
  if (options.prune && result.remoteOnly.length > 0) {
    const orphanIds = result.remoteOnly.map((p) => p.id);
    const bulkResult = await client.bulkUpdateParameters(
      projectId,
      { action: "archive", parameterIds: orphanIds },
      false
    );
    if (bulkResult.succeeded) {
      pruned.push(...bulkResult.succeeded.map((p) => p.key));
    }
  }

  return {
    success: true,
    project: { id: project.id, name: project.name },
    configPath,
    dryRun: false,
    created: result.created.map((p) => p.key),
    updated: result.updated.map((p) => p.key),
    unchanged: result.unchanged.map((p) => p.key),
    remoteOnly: result.remoteOnly.map((p) => p.key),
    pruned,
    total: parameters.length,
    events: {
      created: eventResult.created.map((e) => e.name),
      updated: eventResult.updated.map((e) => e.name),
      unchanged: eventResult.unchanged.map((e) => e.name),
      remoteOnly: eventResult.remoteOnly.map((e) => e.name),
      total: events.length,
    },
    propertyGroups: {
      created: groupResult.created.map((g) => g.name),
      updated: groupResult.updated.map((g) => g.name),
      unchanged: groupResult.unchanged.map((g) => g.name),
      total: propertyGroups.length,
    },
    metrics: metricsResult,
    metricsPath: metricsPath ?? undefined,
  };
}

/**
 * Print push result for human-readable output.
 */
function printPushHuman(result: PushResult): void {
  console.log(chalk.dim(`Using config: ${result.configPath}\n`));

  if (result.dryRun) {
    console.log(chalk.cyan("DRY RUN - No changes will be made\n"));
    console.log(`Would push to ${chalk.bold(result.project.name)}...\n`);
  } else {
    console.log(`Pushing to ${chalk.bold(result.project.name)}...\n`);
  }

  if (result.metricsPath) {
    console.log(chalk.dim(`Using metrics: ${result.metricsPath}\n`));
  }

  if (result.total === 0 && result.events.total === 0 && result.propertyGroups.total === 0 && result.metrics.total === 0) {
    console.log(chalk.yellow("No parameters, events, property groups, or metrics in config files."));
    return;
  }

  // Parameters section
  if (result.total > 0) {
    console.log(chalk.bold(result.dryRun ? "Would change (Local → Remote) Parameters:" : "Local → Remote (Parameters):"));

    if (result.created.length > 0) {
      console.log(chalk.green(`  + ${result.created.length} ${result.dryRun ? "would be created" : "created"}`));
      result.created.forEach((key) => console.log(chalk.dim(`    ${key}`)));
    }

    if (result.updated.length > 0) {
      console.log(chalk.yellow(`  ~ ${result.updated.length} ${result.dryRun ? "would be updated" : "updated"}`));
      result.updated.forEach((key) => console.log(chalk.dim(`    ${key}`)));
    }

    if (result.unchanged.length > 0) {
      console.log(chalk.dim(`  = ${result.unchanged.length} ${result.dryRun ? "already in sync" : "unchanged"}`));
    }

    console.log();
  }

  if (result.pruned.length > 0) {
    console.log(chalk.green(`🗄 Archived ${result.pruned.length} orphaned synced parameter${result.pruned.length !== 1 ? "s" : ""}:`));
    result.pruned.forEach((key) => console.log(chalk.dim(`  ${key}`)));
    console.log();
  } else if (result.remoteOnly.length > 0) {
    console.log(chalk.yellow(`⚠ ${result.remoteOnly.length} orphaned synced parameter${result.remoteOnly.length !== 1 ? "s" : ""} (no longer in your config):`));
    result.remoteOnly.forEach((key) => console.log(chalk.dim(`  ${key}`)));
    console.log();
    console.log(
      chalk.dim("Use --prune to archive them, or 'traffical pull' to add them back to your config.")
    );
    console.log();
  }

  // Events section
  if (result.events.total > 0) {
    console.log(chalk.bold(result.dryRun ? "Would change (Local → Remote) Events:" : "Local → Remote (Events):"));

    if (result.events.created.length > 0) {
      console.log(chalk.green(`  + ${result.events.created.length} ${result.dryRun ? "would be created" : "created"}`));
      result.events.created.forEach((name) => console.log(chalk.dim(`    ${name}`)));
    }

    if (result.events.updated.length > 0) {
      console.log(chalk.yellow(`  ~ ${result.events.updated.length} ${result.dryRun ? "would be updated" : "updated"}`));
      result.events.updated.forEach((name) => console.log(chalk.dim(`    ${name}`)));
    }

    if (result.events.unchanged.length > 0) {
      console.log(chalk.dim(`  = ${result.events.unchanged.length} ${result.dryRun ? "already in sync" : "unchanged"}`));
    }

    console.log();
  }

  if (result.events.remoteOnly.length > 0) {
    console.log(chalk.yellow("⚠ Remote-only synced events (not in your config):"));
    result.events.remoteOnly.forEach((name) => console.log(chalk.dim(`  ${name}`)));
    console.log();
    console.log(
      chalk.dim("Run 'traffical pull' to add these to your config, or they will remain synced.")
    );
    console.log();
  }

  // Property Groups section
  if (result.propertyGroups.total > 0) {
    console.log(chalk.bold(result.dryRun ? "Would change (Local → Remote) Property Groups:" : "Local → Remote (Property Groups):"));

    if (result.propertyGroups.created.length > 0) {
      console.log(chalk.green(`  + ${result.propertyGroups.created.length} ${result.dryRun ? "would be created" : "created"}`));
      result.propertyGroups.created.forEach((name) => console.log(chalk.dim(`    ${name}`)));
    }

    if (result.propertyGroups.updated.length > 0) {
      console.log(chalk.yellow(`  ~ ${result.propertyGroups.updated.length} ${result.dryRun ? "would be updated" : "updated"}`));
      result.propertyGroups.updated.forEach((name) => console.log(chalk.dim(`    ${name}`)));
    }

    if (result.propertyGroups.unchanged.length > 0) {
      console.log(chalk.dim(`  = ${result.propertyGroups.unchanged.length} ${result.dryRun ? "already in sync" : "unchanged"}`));
    }

    console.log();
  }

  // Metrics section
  if (result.metrics.total > 0) {
    console.log(chalk.bold(result.dryRun ? "Would change (Local → Remote) Metrics:" : "Local → Remote (Metrics):"));

    if (result.metrics.created.length > 0) {
      console.log(chalk.green(`  + ${result.metrics.created.length} ${result.dryRun ? "would be created" : "created"}`));
      result.metrics.created.forEach((name) => console.log(chalk.dim(`    ${name}`)));
    }

    if (result.metrics.updated.length > 0) {
      console.log(chalk.yellow(`  ~ ${result.metrics.updated.length} ${result.dryRun ? "would be updated" : "updated"}`));
      result.metrics.updated.forEach((name) => console.log(chalk.dim(`    ${name}`)));
    }

    if (result.metrics.unchanged.length > 0) {
      console.log(chalk.dim(`  = ${result.metrics.unchanged.length} ${result.dryRun ? "already in sync" : "unchanged"}`));
    }

    if (result.metrics.certified > 0) {
      console.log(chalk.green(`  ✦ ${result.metrics.certified} certified`));
    }

    console.log();
  }

  if (result.metrics.remoteOnly.length > 0) {
    console.log(chalk.yellow(`⚠ ${result.metrics.remoteOnly.length} orphaned synced metric${result.metrics.remoteOnly.length !== 1 ? "s" : ""} (not in your metrics.yaml):`));
    result.metrics.remoteOnly.forEach((name) => console.log(chalk.dim(`  ${name}`)));
    console.log();
    console.log(
      chalk.dim("Run 'traffical import metrics --all' to add them to your metrics.yaml.")
    );
    console.log();
  }

  if (result.metrics.warnings && result.metrics.warnings.length > 0) {
    for (const warning of result.metrics.warnings) {
      console.log(chalk.yellow(`⚠ ${warning}`));
    }
    console.log();
  }

  if (result.dryRun) {
    console.log(chalk.cyan("✓ Dry run complete - no changes made"));
  } else {
    const parts: string[] = [];
    if (result.total > 0) {
      parts.push(`${result.total} parameter${result.total !== 1 ? "s" : ""}`);
    }
    if (result.propertyGroups.total > 0) {
      parts.push(`${result.propertyGroups.total} property group${result.propertyGroups.total !== 1 ? "s" : ""}`);
    }
    if (result.events.total > 0) {
      parts.push(`${result.events.total} event${result.events.total !== 1 ? "s" : ""}`);
    }
    if (result.metrics.total > 0) {
      parts.push(`${result.metrics.total} metric${result.metrics.total !== 1 ? "s" : ""}`);
    }
    console.log(chalk.green(`✓ Pushed ${parts.join(" and ")}`));
  }
}

export async function pushCommand(options: PushOptions): Promise<void> {
  const format = parseFormatOption(options.format);
  const isJson = format === "json";

  if (!isJson) {
    // Validation messages for human output
    const configPath = options.configPath || (await findConfigFile());
    if (configPath) {
      console.log(chalk.dim(`Using config: ${configPath}\n`));
      console.log("Validating configuration...");
    }
  }

  try {
    const result = await pushConfig({ ...options, prune: options.prune, metricsFile: options.metricsFile });

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (!options.dryRun && (result.total > 0 || result.events.total > 0)) {
        console.log(chalk.green("✓ Configuration valid\n"));
      }
      printPushHuman(result);
    }
  } catch (err) {
    if (!isJson && err instanceof ValidationError) {
      console.log(chalk.red(`\n✗ ${err.message}`));
      console.log();
      console.log(chalk.dim("Fix the errors above and try again."));
      console.log(chalk.dim("Schema reference: https://docs.traffical.io/tools/config-file"));
    }
    throw err;
  }
}
