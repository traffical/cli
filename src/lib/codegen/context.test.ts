/**
 * TrafficalContext / TrafficalAttributeKey emitter.
 */

import { describe, expect, test } from "bun:test";
import { generateContextTypes, attributeToTS } from "./context.ts";
import { generateEventTypesContent } from "./index.ts";
import type { ApiAttributeDefinition, TrafficalConfig } from "../types.ts";

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
  createdAt: "2026-09-12T00:00:00Z",
  updatedAt: "2026-09-12T00:00:00Z",
  ...extra,
});

/** One row per type / format, plus the quoting and doc-comment cases. */
const FIXTURE: ApiAttributeDefinition[] = [
  attr("user_id", { identifier: true, logging: "never", description: "Stable customer id" }),
  attr("device_type", {
    format: "enum",
    values: [{ value: "mobile", description: "Phone" }, { value: "desktop" }],
    description: "Client form factor",
  }),
  attr("app_version", { format: "semver" }),
  attr("country", { format: "country" }),
  attr("referrer", { format: "url" }),
  attr("cart_value", { type: "number", range: [0, 100000] }),
  attr("is_beta", { type: "boolean" }),
  attr("signed_up_at", { type: "timestamp", description: "Account creation" }),
  attr("$unit_key", { managedBy: "system", identifier: true, logging: "never", source: "system" }),
  attr("$env", { managedBy: "system", format: "enum", values: [{ value: "prod" }, { value: "staging" }] }),
  attr("geo.city"),
];

describe("attributeToTS", () => {
  test("maps every type and format", () => {
    expect(attributeToTS(attr("a"))).toBe("string");
    expect(attributeToTS(attr("a", { format: "semver" }))).toBe("string");
    expect(attributeToTS(attr("a", { format: "country" }))).toBe("string");
    expect(attributeToTS(attr("a", { format: "url" }))).toBe("string");
    expect(attributeToTS(attr("a", { format: "enum", values: [{ value: "x" }, { value: "y z" }] })))
      .toBe('"x" | "y z"');
    expect(attributeToTS(attr("a", { type: "number" }))).toBe("number");
    expect(attributeToTS(attr("a", { type: "timestamp" }))).toBe("number");
    expect(attributeToTS(attr("a", { type: "boolean" }))).toBe("boolean");
  });

  test("enum without values falls back to string", () => {
    expect(attributeToTS(attr("a", { format: "enum", values: [] }))).toBe("string");
    expect(attributeToTS(attr("a", { format: "enum" }))).toBe("string");
  });
});

describe("generateContextTypes", () => {
  const out = generateContextTypes(FIXTURE);

  test("emits one optional property per attribute, sorted, with an index signature last", () => {
    expect(out).toBe(`/**
 * Context attributes registered for this project.
 *
 * Every property is optional; unregistered keys are still accepted
 * through the index signature.
 */
export interface TrafficalContext {
  "$env"?: "prod" | "staging";
  /** identifier — may serve as a unit or entity key */
  "$unit_key"?: string;
  app_version?: string;
  cart_value?: number;
  country?: string;
  /** Client form factor */
  device_type?: "mobile" | "desktop";
  "geo.city"?: string;
  is_beta?: boolean;
  referrer?: string;
  /**
   * Account creation
   * timestamp — epoch milliseconds
   */
  signed_up_at?: number;
  /**
   * Stable customer id
   * identifier — may serve as a unit or entity key
   */
  user_id?: string;
  [key: string]: unknown;
}

/**
 * All registered context attribute keys
 */
export type TrafficalAttributeKey =
  | "$env"
  | "$unit_key"
  | "app_version"
  | "cart_value"
  | "country"
  | "device_type"
  | "geo.city"
  | "is_beta"
  | "referrer"
  | "signed_up_at"
  | "user_id";
`);
  });

  test("quotes $-prefixed and dotted keys, leaves identifiers bare", () => {
    expect(out).toContain('  "$unit_key"?: string;');
    expect(out).toContain('  "geo.city"?: string;');
    expect(out).toContain("  cart_value?: number;");
    expect(out).not.toContain('"cart_value"?:');
  });

  test("enum values become a string-literal union", () => {
    expect(out).toContain('  device_type?: "mobile" | "desktop";');
    expect(out).toContain('  "$env"?: "prod" | "staging";');
  });

  test("timestamp is a number with an epoch-milliseconds comment", () => {
    expect(out).toContain(
      "  /**\n   * Account creation\n   * timestamp — epoch milliseconds\n   */\n  signed_up_at?: number;"
    );
  });

  test("identifier rows and descriptions become doc comments", () => {
    expect(out).toContain("  /** identifier — may serve as a unit or entity key */\n  \"$unit_key\"?: string;");
    expect(out).toContain("  /** Client form factor */\n  device_type?:");
    expect(out).toContain(
      "  /**\n   * Stable customer id\n   * identifier — may serve as a unit or entity key\n   */\n  user_id?: string;"
    );
  });

  test("index signature is the last member", () => {
    const body = out.slice(out.indexOf("export interface TrafficalContext {"), out.indexOf("}\n\n"));
    expect(body.trimEnd().endsWith("[key: string]: unknown;")).toBe(true);
  });

  test("key union lists the literal keys only", () => {
    expect(out).toContain(
      'export type TrafficalAttributeKey =\n  | "$env"\n  | "$unit_key"\n  | "app_version"'
    );
    expect(out).toContain('  | "user_id";\n');
  });

  test("no attributes: empty interface with index signature, never key union", () => {
    const empty = generateContextTypes([]);
    expect(empty).toContain("export interface TrafficalContext {\n  [key: string]: unknown;\n}");
    expect(empty).toContain("export type TrafficalAttributeKey = never;");
  });
});

describe("generateEventTypesContent + attributes", () => {
  const config: TrafficalConfig = {
    version: "1.0",
    parameters: { "checkout.enabled": { type: "boolean", default: false } },
  };

  test("appends the context block after the helper types when attributes are passed", () => {
    const { content } = generateEventTypesContent(config, {
      language: "typescript",
      configPath: "/repo/.traffical/config.yaml",
      attributes: [attr("plan")],
    });
    expect(content.indexOf("export type TypedTrack")).toBeLessThan(content.indexOf("export interface TrafficalContext"));
    expect(content).toContain("  plan?: string;");
    expect(content).toContain('export type TrafficalAttributeKey =\n  | "plan";');
  });

  test("omits the context block entirely when attributes are not passed", () => {
    const { content } = generateEventTypesContent(config, {
      language: "typescript",
      configPath: "/repo/.traffical/config.yaml",
    });
    expect(content).not.toContain("TrafficalContext");
    expect(content).not.toContain("TrafficalAttributeKey");
  });
});
