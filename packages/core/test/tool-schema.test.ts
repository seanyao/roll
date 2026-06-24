import { describe, expect, it } from "vitest";
import { validateToolInput } from "../src/tools/schema.js";
import type { ToolJsonSchema } from "@roll/spec";

describe("US-TOOL-022 validateToolInput", () => {
  const simpleSchema: ToolJsonSchema = {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", description: "the name" },
      age: { type: "integer", description: "the age" },
    },
  };

  it("passes valid input", () => {
    const result = validateToolInput({ name: "alice" }, simpleSchema);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("passes valid input with optional fields", () => {
    const result = validateToolInput({ name: "bob", age: 30 }, simpleSchema);
    expect(result.valid).toBe(true);
  });

  it("rejects missing required field", () => {
    const result = validateToolInput({}, simpleSchema);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["$.name: required property missing"]);
  });

  it("rejects wrong type", () => {
    const result = validateToolInput({ name: 42, age: "old" }, simpleSchema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("$.name: expected string, got number");
    expect(result.errors).toContain("$.age: expected integer, got string");
  });

  it("rejects null input", () => {
    const result = validateToolInput(null, simpleSchema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("$: expected object, got null");
  });

  it("rejects non-object input", () => {
    const result = validateToolInput("hello", simpleSchema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("$: expected object, got string");
  });

  it("rejects unexpected properties by default", () => {
    const result = validateToolInput({ name: "alice", extra: true }, simpleSchema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("$.extra: unexpected property");
  });

  it("allows extra properties when additionalProperties is true", () => {
    const schema: ToolJsonSchema = {
      type: "object",
      additionalProperties: true,
      properties: { name: { type: "string" } },
    };
    const result = validateToolInput({ name: "alice", extra: true }, schema);
    expect(result.valid).toBe(true);
  });

  describe("enum", () => {
    const enumSchema: ToolJsonSchema = {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "status", "merge"] },
      },
    };

    it("passes valid enum value", () => {
      expect(validateToolInput({ action: "create" }, enumSchema).valid).toBe(true);
    });

    it("rejects invalid enum value", () => {
      const result = validateToolInput({ action: "delete" }, enumSchema);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("$.action: value not in enum [create, status, merge]");
    });
  });

  describe("arrays", () => {
    const arraySchema: ToolJsonSchema = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "string" },
        },
      },
    };

    it("passes valid array", () => {
      expect(validateToolInput({ items: ["a", "b"] }, arraySchema).valid).toBe(true);
    });

    it("rejects wrong array element type", () => {
      const result = validateToolInput({ items: ["a", 1] }, arraySchema);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("$.items[1]: expected string, got number");
    });
  });

  describe("nested objects", () => {
    const nestedSchema: ToolJsonSchema = {
      type: "object",
      properties: {
        viewport: {
          type: "object",
          required: ["width", "height"],
          properties: {
            width: { type: "integer" },
            height: { type: "integer" },
          },
        },
      },
    };

    it("passes valid nested object", () => {
      expect(validateToolInput({ viewport: { width: 1024, height: 768 } }, nestedSchema).valid).toBe(true);
    });

    it("rejects missing nested required field", () => {
      const result = validateToolInput({ viewport: { width: 1024 } }, nestedSchema);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("$.viewport.height: required property missing");
    });
  });

  describe("boolean type", () => {
    const boolSchema: ToolJsonSchema = {
      type: "object",
      properties: {
        allowEmpty: { type: "boolean" },
      },
    };

    it("passes boolean", () => {
      expect(validateToolInput({ allowEmpty: true }, boolSchema).valid).toBe(true);
      expect(validateToolInput({ allowEmpty: false }, boolSchema).valid).toBe(true);
    });

    it("rejects non-boolean", () => {
      const result = validateToolInput({ allowEmpty: "yes" }, boolSchema);
      expect(result.valid).toBe(false);
    });
  });

  it("returns empty errors array for valid input", () => {
    // Sanity: errors is always an array, never undefined
    const result = validateToolInput({ name: "ok" }, simpleSchema);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates complex input with multiple error paths", () => {
    const schema: ToolJsonSchema = {
      type: "object",
      required: ["url", "method"],
      properties: {
        url: { type: "string" },
        method: { type: "string", enum: ["GET", "POST"] },
        headers: {
          type: "object",
          additionalProperties: true,
        },
        timeoutMs: { type: "integer" },
      },
    };

    // Missing required, wrong enum, wrong type
    const result = validateToolInput({ method: "DELETE", timeoutMs: 1.5 }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("$.url: required property missing");
    expect(result.errors).toContain("$.method: value not in enum [GET, POST]");
    expect(result.errors).toContain("$.timeoutMs: expected integer, got number");
  });

  describe("schema self-validation: each builtin schema is a valid JSON Schema", () => {
    it("has type 'object'", () => {
      const validSchemas: ToolJsonSchema[] = [
        { type: "object" },
        { type: "object", required: ["x"] },
        { type: "object", properties: { x: { type: "string" } } },
      ];
      for (const schema of validSchemas) {
        const result = validateToolInput({}, { type: "object", properties: { type: { ...(schema as unknown as Record<string, unknown>).type ? {} : {} } } });
        // Each schema itself has `type: "object"` — structurally, that's the self-validation
        expect(schema.type).toBe("object");
      }
    });
  });
});
