/**
 * TypeScript code emitter for event property schemas.
 *
 * Converts EventPropertySchema (JSON Schema subset) to TypeScript interfaces.
 */

import type { EventPropertySchemaField, EventPropertySchema } from "../types.ts";

/**
 * Convert a snake_case or kebab-case event name to PascalCase.
 * "checkout_completed" -> "CheckoutCompleted"
 */
export function toPascalCase(name: string): string {
  return name
    .split(/[_\-\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

/**
 * Generate a TypeScript interface string from a resolved property schema.
 */
export function generateInterface(
  interfaceName: string,
  schema: EventPropertySchema,
  options?: { includeDescriptions?: boolean; indent?: string }
): string {
  const indent = options?.indent ?? "  ";
  const requiredSet = new Set(schema.required ?? []);
  const lines: string[] = [];

  lines.push(`export interface ${interfaceName} {`);

  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const isRequired = requiredSet.has(name);
    const tsType = schemaFieldToTS(field, indent + indent);
    const optional = isRequired ? "" : "?";

    if (options?.includeDescriptions && field.description) {
      lines.push(`${indent}/** ${field.description} */`);
    }

    lines.push(`${indent}${safePropName(name)}${optional}: ${tsType};`);
  }

  lines.push(`}`);
  return lines.join("\n");
}

/**
 * Convert a single JSON Schema field to a TypeScript type string.
 */
export function schemaFieldToTS(
  field: EventPropertySchemaField,
  indent: string = "  "
): string {
  switch (field.type) {
    case "string":
      if (field.enum && field.enum.length > 0) {
        return field.enum.map((v) => JSON.stringify(v)).join(" | ");
      }
      return "string";

    case "number":
    case "integer":
      if (field.enum && field.enum.length > 0) {
        return field.enum.map((v) => String(v)).join(" | ");
      }
      return "number";

    case "boolean":
      return "boolean";

    case "array":
      if (field.items) {
        const itemType = schemaFieldToTS(field.items, indent + "  ");
        return `Array<${itemType}>`;
      }
      return "unknown[]";

    case "object":
      if (field.properties && Object.keys(field.properties).length > 0) {
        return inlineObjectType(field, indent);
      }
      return "Record<string, unknown>";

    default:
      return "unknown";
  }
}

function inlineObjectType(
  field: EventPropertySchemaField,
  indent: string
): string {
  const requiredSet = new Set(field.required ?? []);
  const lines: string[] = ["{"];

  for (const [name, prop] of Object.entries(field.properties ?? {})) {
    const isRequired = requiredSet.has(name);
    const tsType = schemaFieldToTS(prop, indent + "  ");
    const optional = isRequired ? "" : "?";
    lines.push(`${indent}  ${safePropName(name)}${optional}: ${tsType};`);
  }

  lines.push(`${indent}}`);
  return lines.join("\n");
}

/**
 * Wrap property names that aren't valid JS identifiers in quotes.
 */
function safePropName(name: string): string {
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
    return name;
  }
  return `"${name}"`;
}
