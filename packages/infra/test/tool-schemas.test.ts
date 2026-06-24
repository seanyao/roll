import { validateJsonSchemaValue } from "../../core/src/tools/schema.js";
import { builtinToolDeclarations } from "../src/index.js";
import { describe, expect, it } from "vitest";

const VALID_INPUTS: Record<string, unknown> = {
  bash: { command: "node", args: ["--version"], cwd: "." },
  "browser.console": { url: "http://127.0.0.1:3000" },
  "browser.dom-query": { url: "http://127.0.0.1:3000", selector: "body" },
  "browser.screenshot": { url: "http://127.0.0.1:3000", viewport: { width: 1280, height: 720 } },
  "filesystem.read": { path: "README.md", offset: 0, limit: 120 },
  "filesystem.stat": { path: "README.md" },
  "filesystem.write": { path: ".roll/tmp.txt", content: "ok" },
  "git.commit": { cwd: ".", message: "test" },
  "git.merge": { cwd: ".", ref: "origin/main", ffOnly: true },
  "git.push": { cwd: ".", branch: "main", remote: "origin" },
  "git.status": { cwd: "." },
  "github.ci": { action: "status", slug: "seanyao/roll", commit: "HEAD" },
  "github.pr": { action: "status", slug: "seanyao/roll", ref: "1" },
  "mcp.call": { serverName: "local", toolName: "echo", arguments: { text: "ok" } },
  "network.fetch": { url: "https://example.com", method: "GET" },
};

describe("US-TOOL-022 builtin tool schemas", () => {
  it("gives every builtin declaration an input and output schema", () => {
    for (const declaration of builtinToolDeclarations()) {
      expect(declaration.inputSchema, declaration.id).toBeDefined();
      expect(declaration.outputSchema, declaration.id).toBeDefined();
    }
  });

  it("accepts representative valid inputs for every builtin", () => {
    for (const declaration of builtinToolDeclarations()) {
      const input = VALID_INPUTS[String(declaration.id)];
      expect(input, String(declaration.id)).toBeDefined();
      expect(validateJsonSchemaValue(declaration.inputSchema, input), String(declaration.id)).toMatchObject({ ok: true, errors: [] });
    }
  });

  it("rejects structurally invalid inputs before adapters can interpret them", () => {
    const invalids: Record<string, unknown> = {
      bash: { args: ["--version"] },
      "browser.dom-query": { url: "http://127.0.0.1:3000" },
      "filesystem.write": { path: "x" },
      "git.push": { cwd: "." },
      "github.pr": { action: "create", slug: "seanyao/roll" },
      "mcp.call": { serverName: "local" },
      "network.fetch": { method: "GET" },
    };

    for (const declaration of builtinToolDeclarations().filter((item) => String(item.id) in invalids)) {
      expect(validateJsonSchemaValue(declaration.inputSchema, invalids[String(declaration.id)]).ok, String(declaration.id)).toBe(false);
    }
  });
});
