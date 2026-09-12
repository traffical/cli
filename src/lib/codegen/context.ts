/**
 * TypeScript emitter for the context attribute registry.
 *
 * Turns the project's attribute definitions (as returned by the control
 * plane) into a `TrafficalContext` interface plus a `TrafficalAttributeKey`
 * union, so SDK call sites can type-check the context they pass to
 * `decide()` while unregistered keys still compile.
 */

import type { ApiAttributeDefinition } from "../types.ts";

/**
 * Bare identifiers only. `$`-prefixed and dotted keys are quoted — `$` is a
 * legal identifier character in JS, but the registry treats it as the
 * system-key marker, so it is always quoted for readability.
 */
function contextPropName(key: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return key;
  }
  return JSON.stringify(key);
}

/**
 * TypeScript type for one attribute.
 */
export function attributeToTS(attr: ApiAttributeDefinition): string {
  switch (attr.type) {
    case "string":
      if (attr.format === "enum" && attr.values && attr.values.length > 0) {
        return attr.values.map((v) => JSON.stringify(v.value)).join(" | ");
      }
      return "string";
    case "number":
    case "timestamp":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "unknown";
  }
}

/**
 * Doc comment lines for one attribute (empty when nothing to say).
 */
function attributeDocLines(attr: ApiAttributeDefinition): string[] {
  const lines: string[] = [];
  if (attr.description) lines.push(attr.description);
  if (attr.identifier) lines.push("identifier — may serve as a unit or entity key");
  if (attr.type === "timestamp") lines.push("timestamp — epoch milliseconds");
  return lines;
}

function renderDoc(lines: string[], indent: string): string {
  if (lines.length === 0) return "";
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`).join("\n")}\n${indent} */\n`;
}

/**
 * Generate the `TrafficalContext` interface and `TrafficalAttributeKey` union.
 *
 * Callers pass the active rows (system rows included, archived rows
 * excluded). Output is sorted by key so regenerating is a stable diff.
 */
export function generateContextTypes(attributes: ApiAttributeDefinition[]): string {
  const sorted = [...attributes].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  let content = "";
  content += `/**\n * Context attributes registered for this project.\n *\n`;
  content += ` * Every property is optional; unregistered keys are still accepted\n`;
  content += ` * through the index signature.\n */\n`;
  content += `export interface TrafficalContext {\n`;
  for (const attr of sorted) {
    content += renderDoc(attributeDocLines(attr), "  ");
    content += `  ${contextPropName(attr.key)}?: ${attributeToTS(attr)};\n`;
  }
  content += `  [key: string]: unknown;\n`;
  content += `}\n\n`;

  content += `/**\n * All registered context attribute keys\n */\n`;
  if (sorted.length > 0) {
    content += `export type TrafficalAttributeKey =\n`;
    content += sorted.map((a) => `  | ${JSON.stringify(a.key)}`).join("\n") + ";\n";
  } else {
    content += `export type TrafficalAttributeKey = never;\n`;
  }

  return content;
}
