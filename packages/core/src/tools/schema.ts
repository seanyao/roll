/**
 * US-TOOL-022 — lightweight JSON Schema validator for tool input/output.
 *
 * Covers the subset actually used by built-in tool declarations: type
 * (including "integer" as an alias for "number"), required, properties
 * (nested), enum, items (arrays), and additionalProperties (default false
 * for objects).  Unsupported keywords are silently ignored so the schema
 * object is portable to any compliant JSON Schema tool.
 */
import type { ToolJsonSchema, ToolJsonSchemaProperty } from "@roll/spec";

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate `input` against `schema`.  Returns `{ valid: true }` or a list of
 * human-readable error paths (DOT-separated property names).
 */
export function validateToolInput(input: unknown, schema: ToolJsonSchema): SchemaValidationResult {
  return validateValue(input, schema, "$");
}

function validateValue(value: unknown, schema: ToolJsonSchemaProperty | ToolJsonSchema, path: string): SchemaValidationResult {
  const errors: string[] = [];

  if (schema.type !== undefined) {
    if (!typeMatches(value, schema.type)) {
      errors.push(`${path}: expected ${schema.type}, got ${typeOf(value)}`);
      // Don't attempt property/required/enum checks when the type is wrong.
      return { valid: false, errors };
    }
  }

  if (schema.enum !== undefined) {
    if (!schema.enum.some((item) => item === value)) {
      errors.push(`${path}: value not in enum [${schema.enum.map(String).join(", ")}]`);
    }
  }

  if (isRecord(value) && (schema.type === "object" || schema.type === undefined)) {
    const properties = schema.properties ?? {};
    const required = schema.required ?? [];
    const allowExtra = schema.additionalProperties === true;

    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${path}.${key}: required property missing`);
      }
    }

    for (const [key, val] of Object.entries(value)) {
      const propertySchema = properties[key];
      if (propertySchema === undefined) {
        if (!allowExtra) {
          errors.push(`${path}.${key}: unexpected property`);
        }
        continue;
      }
      const result = validateValue(val, propertySchema, `${path}.${key}`);
      errors.push(...result.errors);
    }
  }

  if (Array.isArray(value) && schema.type === "array") {
    const itemsSchema = schema.items;
    if (itemsSchema !== undefined) {
      for (let i = 0; i < value.length; i++) {
        const result = validateValue(value[i], itemsSchema, `${path}[${i}]`);
        errors.push(...result.errors);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function typeMatches(value: unknown, type: string): boolean {
  if (value === null) return false;
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    default:
      return true;
  }
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
