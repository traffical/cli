/**
 * Context attributes: schema validation + YAML <-> API converters.
 */

import { describe, expect, test } from "bun:test";
import {
  validateConfig,
  configAttributeToApi,
  apiAttributeToConfig,
  attributeDiffers,
} from "./config.ts";
import type { ConfigAttribute } from "./types.ts";

const base = { version: "1.0", parameters: {} };

describe("traffical.yaml schema: attributes", () => {
  test("accepts a well-formed attributes block", () => {
    const result = validateConfig({
      ...base,
      attributes: {
        device_type: {
          type: "string",
          format: "enum",
          values: { mobile: "Phone or small tablet", desktop: "Desktop or laptop" },
          description: "Client form factor",
          logging: "always",
          breakdown: true,
        },
        plan: { type: "string", format: "enum", values: ["free", "pro", "enterprise"] },
        cart_value: { type: "number", range: [0, 100000], encoding: { binning: "quantile", topK: 10 } },
        app_version: { type: "string", format: "semver" },
        "url.pathname": { type: "string" },
        signed_up_at: { type: "timestamp" },
        user_id: { type: "string", identifier: true, logging: "never", label: "User" },
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("rejects $-prefixed keys (system attributes are server-managed)", () => {
    const result = validateConfig({
      ...base,
      attributes: { $unit_key: { type: "string" } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      {
        path: "attributes.$unit_key",
        message: "invalid key: $-prefixed attributes are system-managed and cannot be declared in config",
      },
    ]);
  });

  test("rejects keys with other invalid characters", () => {
    const result = validateConfig({
      ...base,
      attributes: { "device-type": { type: "string" } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { path: "attributes.device-type", message: "invalid key (must match ^[A-Za-z_][A-Za-z0-9_.]*$)" },
    ]);
  });

  test("rejects an unknown type", () => {
    const result = validateConfig({
      ...base,
      attributes: { plan: { type: "json" } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      path: "attributes.plan.type",
      message: "must be one of: string, number, boolean, timestamp",
    });
  });

  test("requires type", () => {
    const result = validateConfig({ ...base, attributes: { plan: { format: "enum" } } });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      path: "attributes.plan.type",
      message: "missing required property 'type'",
    });
  });

  test("rejects bad format / logging / range / encoding values", () => {
    expect(validateConfig({ ...base, attributes: { a: { type: "string", format: "uuid" } } }).valid).toBe(false);
    expect(validateConfig({ ...base, attributes: { a: { type: "string", logging: "maybe" } } }).valid).toBe(false);
    expect(validateConfig({ ...base, attributes: { a: { type: "number", range: [0] } } }).valid).toBe(false);
    expect(validateConfig({ ...base, attributes: { a: { type: "number", range: ["0", "1"] } } }).valid).toBe(false);
    expect(validateConfig({ ...base, attributes: { a: { type: "number", encoding: { binning: "log" } } } }).valid).toBe(false);
    expect(validateConfig({ ...base, attributes: { a: { type: "string", values: [1, 2] } } }).valid).toBe(false);
    expect(validateConfig({ ...base, attributes: { a: { type: "string", unknown: true } } }).valid).toBe(false);
  });
});

describe("configAttributeToApi", () => {
  test("normalises list-form values", () => {
    expect(
      configAttributeToApi("plan", { type: "string", format: "enum", values: ["free", "pro"] })
    ).toEqual({
      key: "plan",
      type: "string",
      format: "enum",
      values: [{ value: "free" }, { value: "pro" }],
    });
  });

  test("normalises map-form values to value + description", () => {
    expect(
      configAttributeToApi("device_type", {
        type: "string",
        format: "enum",
        values: { mobile: "Phone or small tablet", desktop: "Desktop or laptop" },
        description: "Client form factor",
        logging: "always",
      })
    ).toEqual({
      key: "device_type",
      type: "string",
      format: "enum",
      values: [
        { value: "mobile", description: "Phone or small tablet" },
        { value: "desktop", description: "Desktop or laptop" },
      ],
      description: "Client form factor",
      logging: "always",
    });
  });

  test("omits absent fields so the server applies defaults", () => {
    expect(configAttributeToApi("cart_value", { type: "number", range: [0, 100000] })).toEqual({
      key: "cart_value",
      type: "number",
      range: [0, 100000],
    });
    expect(Object.keys(configAttributeToApi("x", { type: "boolean" }))).toEqual(["key", "type"]);
  });

  test("passes identifier / breakdown / encoding through", () => {
    expect(
      configAttributeToApi("user_id", {
        type: "string",
        identifier: true,
        logging: "never",
        breakdown: false,
        encoding: { binning: "none", topK: 5 },
        label: "User",
      })
    ).toEqual({
      key: "user_id",
      type: "string",
      label: "User",
      identifier: true,
      logging: "never",
      breakdown: false,
      encoding: { binning: "none", topK: 5 },
    });
  });
});

describe("apiAttributeToConfig", () => {
  test("emits the list form when no value carries a description", () => {
    const { key, config } = apiAttributeToConfig({
      key: "plan",
      type: "string",
      format: "enum",
      values: [{ value: "free" }, { value: "pro", label: "Pro" }],
      identifier: false,
      logging: "allowed",
      breakdown: false,
    });
    expect(key).toBe("plan");
    expect(config).toEqual({ type: "string", format: "enum", values: ["free", "pro"] });
  });

  test("emits the map form when any value carries a description", () => {
    const { config } = apiAttributeToConfig({
      key: "device_type",
      type: "string",
      format: "enum",
      values: [{ value: "mobile", description: "Phone" }, { value: "desktop" }],
      logging: "always",
    });
    expect(config).toEqual({
      type: "string",
      format: "enum",
      values: { mobile: "Phone", desktop: "" },
      logging: "always",
    });
  });

  test("leaves server defaults implicit", () => {
    const { config } = apiAttributeToConfig({
      key: "flag",
      type: "boolean",
      identifier: false,
      logging: "allowed",
      breakdown: false,
      encoding: {},
    });
    expect(config).toEqual({ type: "boolean" });
  });

  test("round-trips list and map forms", () => {
    const samples: Record<string, ConfigAttribute> = {
      plan: { type: "string", format: "enum", values: ["free", "pro", "enterprise"] },
      device_type: {
        type: "string",
        format: "enum",
        values: { mobile: "Phone or small tablet", desktop: "Desktop or laptop" },
        description: "Client form factor",
        logging: "always",
        breakdown: true,
      },
      cart_value: { type: "number", range: [0, 100000], encoding: { binning: "quantile" } },
      user_id: { type: "string", identifier: true, logging: "never", label: "User" },
      signed_up_at: { type: "timestamp" },
    };
    for (const [key, attr] of Object.entries(samples)) {
      const api = configAttributeToApi(key, attr);
      const back = apiAttributeToConfig(api);
      expect(back.key).toBe(key);
      expect(back.config).toEqual(attr);
    }
  });
});

describe("attributeDiffers", () => {
  const remote = {
    key: "plan",
    type: "string" as const,
    format: "enum" as const,
    values: [{ value: "free" }, { value: "pro" }],
    identifier: false,
    logging: "allowed" as const,
    breakdown: false,
  };

  test("treats explicit defaults as equal to implicit ones", () => {
    const local = configAttributeToApi("plan", {
      type: "string",
      format: "enum",
      values: ["free", "pro"],
      logging: "allowed",
      identifier: false,
    });
    expect(attributeDiffers(local, remote)).toBe(false);
  });

  test("detects a changed value list", () => {
    const local = configAttributeToApi("plan", { type: "string", format: "enum", values: ["free"] });
    expect(attributeDiffers(local, remote)).toBe(true);
  });

  test("detects a changed description", () => {
    const local = configAttributeToApi("plan", {
      type: "string",
      format: "enum",
      values: { free: "Free tier", pro: "" },
    });
    expect(attributeDiffers(local, remote)).toBe(true);
  });
});
