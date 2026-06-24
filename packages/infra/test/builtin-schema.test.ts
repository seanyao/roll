import { describe, expect, it } from "vitest";
import { builtinToolDeclarations } from "../src/index.js";

describe("US-TOOL-022 builtin schema coverage", () => {
  const tools = builtinToolDeclarations();

  it("every builtin tool has an inputSchema with type 'object'", () => {
    for (const tool of tools) {
      expect(tool.inputSchema, `missing inputSchema on ${tool.id}`).toBeDefined();
      expect(tool.inputSchema!.type, `inputSchema.type on ${tool.id}`).toBe("object");
    }
  });

  it("every builtin tool has an outputSchema with type 'object'", () => {
    for (const tool of tools) {
      expect(tool.outputSchema, `missing outputSchema on ${tool.id}`).toBeDefined();
      expect(tool.outputSchema!.type, `outputSchema.type on ${tool.id}`).toBe("object");
    }
  });

  it("every inputSchema has required fields that exist in properties", () => {
    for (const tool of tools) {
      const schema = tool.inputSchema!;
      const required = schema.required ?? [];
      const properties = Object.keys(schema.properties ?? {});
      for (const field of required) {
        expect(properties, `${tool.id} inputSchema: required field "${field}" not in properties`).toContain(field);
      }
    }
  });

  it("every outputSchema has required fields that exist in properties (when properties are declared)", () => {
    for (const tool of tools) {
      const schema = tool.outputSchema!;
      const required = schema.required ?? [];
      const properties = Object.keys(schema.properties ?? {});
      // github.pr outputSchema has additionalProperties: true and no properties — skip
      if (properties.length === 0) continue;
      for (const field of required) {
        expect(properties, `${tool.id} outputSchema: required field "${field}" not in properties`).toContain(field);
      }
    }
  });

  it("every inputSchema is structurally a valid JSON Schema object", () => {
    for (const tool of tools) {
      const schema = tool.inputSchema!;
      expect(schema).toHaveProperty("type", "object");
      if (schema.properties !== undefined) {
        expect(typeof schema.properties).toBe("object");
        expect(Array.isArray(schema.properties)).toBe(false);
      }
      if (schema.required !== undefined) {
        expect(Array.isArray(schema.required)).toBe(true);
      }
    }
  });

  it("total builtin tool count matches expected", () => {
    // Bash(1) + Browser(3) + Git(4) + GitHub(2) + Network(1) + Filesystem(3) + MCP(1) = 15
    expect(tools.length).toBe(15);
  });
});
