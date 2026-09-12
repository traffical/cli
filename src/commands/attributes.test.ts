/**
 * push / pull / sync / status: attribute wiring against a mocked API client.
 *
 * `mock.module` is process-wide in bun, so every command test that needs the
 * fake client lives in this one file.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { parse } from "yaml";
import * as realApi from "../lib/api.ts";
import type { ApiAttributeDefinition, AttributeSyncRequest } from "../lib/types.ts";

// ---------------------------------------------------------------------------
// Fake API client
// ---------------------------------------------------------------------------

const calls: Array<{ method: string; args: unknown[] }> = [];
let remoteAttributes: ApiAttributeDefinition[] = [];
/** When set, the fake's listAttributes throws this instead of answering. */
let listAttributesError: Error | null = null;

const attr = (
  key: string,
  extra: Partial<ApiAttributeDefinition> = {}
): ApiAttributeDefinition => ({
  id: `attr_${key}`,
  projectId: "proj_1",
  key,
  type: "string",
  identifier: false,
  logging: "allowed",
  breakdown: false,
  managedBy: "user",
  synced: true,
  createdAt: "2026-09-12T00:00:00Z",
  updatedAt: "2026-09-12T00:00:00Z",
  ...extra,
});

class FakeApiClient {
  static async create() {
    return new FakeApiClient();
  }
  private record<T>(method: string, args: unknown[], value: T): T {
    calls.push({ method, args });
    return value;
  }
  async getProject() {
    return { id: "proj_1", name: "Demo", key: "demo", orgId: "org_1", environments: [] };
  }
  async getOrganization() {
    return { id: "org_1", name: "Org", key: "org" };
  }
  async listParameters() {
    return this.record("listParameters", [], []);
  }
  async listNamespaces() {
    return [];
  }
  async listEventDefinitions() {
    return this.record("listEventDefinitions", [], []);
  }
  async listPropertyGroups() {
    return this.record("listPropertyGroups", [], []);
  }
  async listMetrics() {
    return [];
  }
  async listAttributes(projectId: string) {
    if (listAttributesError) throw listAttributesError;
    return this.record("listAttributes", [projectId], remoteAttributes);
  }
  async syncAttributes(projectId: string, request: AttributeSyncRequest) {
    const entries = request.attributes.map((a) => ({ key: a.key, id: `attr_${a.key}` }));
    return this.record("syncAttributes", [projectId, request], {
      created: entries,
      updated: [],
      unchanged: [],
      remoteOnly: [{ key: "legacy_flag", id: "attr_legacy_flag" }],
      pruned: request.prune ? [{ key: "legacy_flag", id: "attr_legacy_flag" }] : [],
      skipped: request.prune ? [{ key: "in_use", id: "attr_in_use" }] : [],
      summary: {
        totalInConfig: entries.length,
        created: entries.length,
        updated: 0,
        unchanged: 0,
        remoteOnly: 1,
        pruned: request.prune ? 1 : 0,
        skipped: request.prune ? 1 : 0,
      },
    });
  }
  async syncParameters(projectId: string, request: unknown) {
    return this.record("syncParameters", [projectId, request], {
      created: [],
      updated: [],
      unchanged: [],
      remoteOnly: [],
      summary: { totalInConfig: 0, created: 0, updated: 0, unchanged: 0, remoteOnly: 0 },
    });
  }
  async syncPropertyGroups(projectId: string, request: unknown) {
    return this.record("syncPropertyGroups", [projectId, request], {
      created: [],
      updated: [],
      unchanged: [],
      summary: { totalInConfig: 0, created: 0, updated: 0, unchanged: 0 },
    });
  }
  async syncEventDefinitions(projectId: string, request: unknown) {
    return this.record("syncEventDefinitions", [projectId, request], {
      created: [],
      updated: [],
      unchanged: [],
      remoteOnly: [],
      summary: { totalInConfig: 0, created: 0, updated: 0, unchanged: 0, remoteOnly: 0 },
    });
  }
  async bulkUpdateParameters() {
    return { succeeded: [] };
  }
}

mock.module("../lib/api.ts", () => ({ ...realApi, ApiClient: FakeApiClient }));

const { pushConfig } = await import("./push.ts");
const { pullConfig } = await import("./pull.ts");
const { syncConfig } = await import("./sync.ts");
const { getStatus } = await import("./status.ts");
const { generateTypes } = await import("./generate-types.ts");

// ---------------------------------------------------------------------------
// Temp repo scaffolding
// ---------------------------------------------------------------------------

const originalCwd = process.cwd();
let repoDir: string;
let configPath: string;

async function writeRepo(configYaml: string) {
  repoDir = await mkdtemp(join(tmpdir(), "traffical-cli-attrs-"));
  await mkdir(join(repoDir, ".traffical"), { recursive: true });
  await writeFile(
    join(repoDir, ".traffical", "project.yaml"),
    "version: '1.0'\norg:\n  id: org_1\nproject:\n  id: proj_1\n"
  );
  configPath = join(repoDir, ".traffical", "config.yaml");
  await writeFile(configPath, configYaml);
  process.chdir(repoDir);
}

const CONFIG_WITH_ATTRS = `version: "1.0"
parameters:
  checkout.enabled:
    type: boolean
    default: false
events:
  purchase:
    valueType: currency
propertyGroups:
  geo:
    properties:
      country:
        type: string
attributes:
  device_type:
    type: string
    format: enum
    values:
      mobile: Phone or small tablet
      desktop: Desktop or laptop
    logging: always
  plan:
    type: string
    format: enum
    values: [free, pro]
  cart_value: { type: number, range: [0, 100000] }
`;

beforeEach(() => {
  calls.length = 0;
  remoteAttributes = [];
  listAttributesError = null;
});

afterAll(async () => {
  process.chdir(originalCwd);
  if (repoDir) await rm(repoDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// push
// ---------------------------------------------------------------------------

describe("push: attributes", () => {
  test("syncs attributes before parameters, property groups and events", async () => {
    await writeRepo(CONFIG_WITH_ATTRS);
    const result = await pushConfig({ configPath });

    const order = calls.filter((c) => c.method.startsWith("sync")).map((c) => c.method);
    expect(order).toEqual([
      "syncAttributes",
      "syncParameters",
      "syncPropertyGroups",
      "syncEventDefinitions",
    ]);

    const [projectId, request] = calls.find((c) => c.method === "syncAttributes")!.args as [
      string,
      AttributeSyncRequest,
    ];
    expect(projectId).toBe("proj_1");
    expect(request.source).toBe("config.yaml");
    expect(request.prune).toBeUndefined();
    expect(request.attributes).toEqual([
      {
        key: "device_type",
        type: "string",
        format: "enum",
        values: [
          { value: "mobile", description: "Phone or small tablet" },
          { value: "desktop", description: "Desktop or laptop" },
        ],
        logging: "always",
      },
      { key: "plan", type: "string", format: "enum", values: [{ value: "free" }, { value: "pro" }] },
      { key: "cart_value", type: "number", range: [0, 100000] },
    ]);

    expect(result.attributes).toEqual({
      created: ["device_type", "plan", "cart_value"],
      updated: [],
      unchanged: [],
      remoteOnly: ["legacy_flag"],
      pruned: [],
      skipped: [],
      total: 3,
    });
  });

  test("--prune passes prune: true and reports pruned + skipped", async () => {
    await writeRepo(CONFIG_WITH_ATTRS);
    const result = await pushConfig({ configPath, prune: true });

    const [, request] = calls.find((c) => c.method === "syncAttributes")!.args as [string, AttributeSyncRequest];
    expect(request.prune).toBe(true);
    expect(result.attributes.pruned).toEqual(["legacy_flag"]);
    expect(result.attributes.skipped).toEqual(["in_use"]);
  });

  test("skips the sync call when the file has no attributes block", async () => {
    await writeRepo(`version: "1.0"\nparameters:\n  a:\n    type: boolean\n    default: true\n`);
    const result = await pushConfig({ configPath });

    expect(calls.map((c) => c.method)).not.toContain("syncAttributes");
    expect(calls.map((c) => c.method)).toContain("syncParameters");
    expect(result.attributes.total).toBe(0);
  });

  test("dry run diffs against the remote registry, ignoring system rows", async () => {
    await writeRepo(CONFIG_WITH_ATTRS);
    remoteAttributes = [
      attr("$unit_key", { managedBy: "system", identifier: true, logging: "never" }),
      attr("plan", { format: "enum", values: [{ value: "free" }, { value: "pro" }] }),
      attr("cart_value", { type: "number", range: [0, 500] }),
      attr("stale", { synced: true }),
      attr("dashboard_only", { synced: false }),
      attr("gone", { synced: true, archivedAt: "2026-09-01T00:00:00Z" }),
    ];

    const result = await pushConfig({ configPath, dryRun: true, prune: true });

    expect(calls.map((c) => c.method)).not.toContain("syncAttributes");
    expect(result.attributes).toEqual({
      created: ["device_type"],
      updated: ["cart_value"],
      unchanged: ["plan"],
      remoteOnly: ["stale"],
      pruned: ["stale"],
      skipped: [],
      total: 3,
    });
  });

  test("rejects a $-prefixed key before any network call", async () => {
    await writeRepo(`version: "1.0"\nparameters: {}\nattributes:\n  $unit_key:\n    type: string\n`);
    await expect(pushConfig({ configPath })).rejects.toThrow(/attributes/);
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// pull
// ---------------------------------------------------------------------------

describe("pull: attributes", () => {
  test("writes the attributes block from the list endpoint, excluding system and archived rows", async () => {
    await writeRepo(`version: "1.0"\nparameters: {}\nattributes:\n  local_only:\n    type: boolean\n`);
    remoteAttributes = [
      attr("$unit_key", { managedBy: "system", identifier: true, logging: "never" }),
      attr("device_type", {
        format: "enum",
        values: [{ value: "mobile", description: "Phone" }, { value: "desktop", description: "Desktop" }],
        logging: "always",
      }),
      attr("plan", { format: "enum", values: [{ value: "free" }, { value: "pro" }] }),
      attr("user_id", { identifier: true, logging: "never" }),
      attr("gone", { archivedAt: "2026-09-01T00:00:00Z" }),
    ];

    const result = await pullConfig({ configPath });

    expect(result.attributes).toEqual({
      added: ["device_type", "plan", "user_id"],
      updated: [],
      unchanged: [],
      localOnly: ["local_only"],
      total: 3,
    });

    const written = parse(await readFile(configPath, "utf-8"));
    expect(written.attributes).toEqual({
      device_type: {
        type: "string",
        format: "enum",
        values: { mobile: "Phone", desktop: "Desktop" },
        logging: "always",
      },
      plan: { type: "string", format: "enum", values: ["free", "pro"] },
      user_id: { type: "string", identifier: true, logging: "never" },
      local_only: { type: "boolean" },
    });
    expect(Object.keys(written.attributes)).not.toContain("$unit_key");
    expect(Object.keys(written.attributes)).not.toContain("gone");
  });

  test("leaves the file without an attributes block when the registry has no user rows", async () => {
    await writeRepo(`version: "1.0"\nparameters: {}\n`);
    remoteAttributes = [attr("$unit_key", { managedBy: "system" })];

    await pullConfig({ configPath });

    const written = await readFile(configPath, "utf-8");
    expect(written).not.toContain("attributes:");
  });
});

// ---------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------

describe("sync: attributes", () => {
  test("pushes attributes first and pulls new remote ones into the file", async () => {
    await writeRepo(CONFIG_WITH_ATTRS);
    remoteAttributes = [
      attr("$unit_key", { managedBy: "system" }),
      attr("from_dashboard", { type: "number", synced: false }),
    ];

    const result = await syncConfig({ configPath });

    const order = calls.filter((c) => c.method.startsWith("sync")).map((c) => c.method);
    expect(order[0]).toBe("syncAttributes");
    expect(result.attributes.push.created).toEqual(["device_type", "plan", "cart_value"]);
    expect(result.attributes.pull.added).toEqual(["from_dashboard"]);

    const written = parse(await readFile(configPath, "utf-8"));
    expect(written.attributes.from_dashboard).toEqual({ type: "number" });
    expect(Object.keys(written.attributes)).not.toContain("$unit_key");
  });

  test("--prune reports pruned and skipped from the server response", async () => {
    await writeRepo(CONFIG_WITH_ATTRS);
    const result = await syncConfig({ configPath, prune: true });
    expect(result.attributes.pruned).toEqual(["legacy_flag"]);
    expect(result.attributes.skipped).toEqual(["in_use"]);
  });
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

describe("status: attributes", () => {
  test("reports synced / dashboard-only / local-only and flags drift", async () => {
    await writeRepo(CONFIG_WITH_ATTRS);
    remoteAttributes = [
      attr("$unit_key", { managedBy: "system" }),
      attr("plan", { format: "enum" }),
      attr("from_dashboard", { synced: false }),
    ];

    const result = await getStatus({ configPath });

    expect(result.attributes.synced.map((a) => a.key)).toEqual(["plan"]);
    expect(result.attributes.dashboardOnly.map((a) => a.key)).toEqual(["from_dashboard"]);
    expect(result.attributes.localOnly.map((a) => a.key)).toEqual(["device_type", "cart_value"]);
    expect(result.hasDrift).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generate-types
// ---------------------------------------------------------------------------

describe("generate-types: attributes", () => {
  test("emits TrafficalContext from active rows, system included, archived excluded", async () => {
    await writeRepo(CONFIG_WITH_ATTRS);
    remoteAttributes = [
      attr("$unit_key", { managedBy: "system", identifier: true, logging: "never" }),
      attr("plan", { format: "enum", values: [{ value: "free" }, { value: "pro" }] }),
      attr("signed_up_at", { type: "timestamp" }),
      attr("gone", { archivedAt: "2026-09-01T00:00:00Z" }),
    ];

    const result = await generateTypes({ configPath });

    expect(calls.filter((c) => c.method === "listAttributes").map((c) => c.args)).toEqual([["proj_1"]]);
    expect(result.attributes).toBe(3);
    expect(result.attributesNote).toBeUndefined();

    const generated = await readFile(result.outputPath, "utf-8");
    expect(generated).toContain("export interface TrafficalContext {");
    expect(generated).toContain('  "$unit_key"?: string;');
    expect(generated).toContain('  plan?: "free" | "pro";');
    expect(generated).toContain("  signed_up_at?: number;");
    expect(generated).toContain("  [key: string]: unknown;");
    expect(generated).not.toContain("gone");
    expect(generated).toContain('export type TrafficalAttributeKey =\n  | "$unit_key"\n  | "plan"\n  | "signed_up_at";');
    // Existing output is untouched
    expect(generated).toContain('export type TrafficalParameterKey =\n  | "checkout.enabled";');
  });

  test("older server (404) leaves the context types out and records a note", async () => {
    await writeRepo(CONFIG_WITH_ATTRS);
    const notFound = new realApi.ValidationError("Not found");
    notFound.status = 404;
    listAttributesError = notFound;

    const result = await generateTypes({ configPath });

    expect(result.attributes).toBeUndefined();
    expect(result.attributesNote).toMatch(/HTTP 404/);
    const generated = await readFile(result.outputPath, "utf-8");
    expect(generated).not.toContain("TrafficalContext");
    expect(generated).toContain("TrafficalParameterKey");
  });

  test("403 is treated the same way; other API errors propagate", async () => {
    await writeRepo(CONFIG_WITH_ATTRS);
    const forbidden = new realApi.AuthError("Forbidden");
    forbidden.status = 403;
    listAttributesError = forbidden;
    const result = await generateTypes({ configPath });
    expect(result.attributesNote).toMatch(/HTTP 403/);

    const boom = new realApi.NetworkError("Bad gateway");
    boom.status = 502;
    listAttributesError = boom;
    await expect(generateTypes({ configPath })).rejects.toThrow("Bad gateway");
  });

  test("pull --include-types reuses the pulled rows (one fetch) and keeps system rows in the types", async () => {
    await writeRepo(CONFIG_WITH_ATTRS);
    remoteAttributes = [
      attr("$unit_key", { managedBy: "system", identifier: true, logging: "never" }),
      attr("plan", { format: "enum", values: [{ value: "free" }, { value: "pro" }] }),
    ];

    const result = await pullConfig({ configPath, includeTypes: true });

    expect(calls.filter((c) => c.method === "listAttributes")).toHaveLength(1);
    expect(result.typesGenerated).toBeDefined();
    const generated = await readFile(result.typesGenerated!, "utf-8");
    expect(generated).toContain('  "$unit_key"?: string;');
    expect(generated).toContain('  plan?: "free" | "pro";');

    // ...while the config file still excludes the system row
    const written = parse(await readFile(configPath, "utf-8"));
    expect(Object.keys(written.attributes)).not.toContain("$unit_key");
  });
});
