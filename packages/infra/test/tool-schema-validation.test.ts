import { describe, expect, it } from "vitest";
import { invokeInfraTool } from "../src/tools/delegation.js";
import { BashTool } from "../src/tools/bash.js";
import type { BashInput } from "../src/index.js";

describe("US-TOOL-022 E2E: validation pipeline", () => {
  const bashTool = new BashTool();

  it("accepts valid bash input via invokeInfraTool", async () => {
    const result = await invokeInfraTool<BashInput, unknown>({
      declaration: bashTool.declaration,
      input: { command: "echo", args: ["hello"] },
      caller: { cycleId: "cycle-1" },
      run: async () => ({ ok: true, output: { exitCode: 0, stdout: "hello", stderr: "", timedOut: false }, meta: { invocationId: "inv-1", toolId: "bash", caller: { cycleId: "cycle-1" }, startedAt: 1, endedAt: 2, durationMs: 1 } }),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing required field via invokeInfraTool", async () => {
    const result = await invokeInfraTool<BashInput, unknown>({
      declaration: bashTool.declaration,
      input: {} as BashInput,
      caller: { cycleId: "cycle-1" },
      run: async () => {
        throw new Error("should not be called");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_input");
      expect(result.error.message).toContain("command");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("rejects wrong type via invokeInfraTool", async () => {
    const result = await invokeInfraTool<BashInput, unknown>({
      declaration: bashTool.declaration,
      input: { command: 123 } as unknown as BashInput,
      caller: { cycleId: "cycle-1" },
      run: async () => {
        throw new Error("should not be called");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_input");
      expect(result.error.message).toContain("expected string");
    }
  });

  it("skips validation when tool has no inputSchema", async () => {
    const noSchemaDeclaration = { ...bashTool.declaration, inputSchema: undefined };
    const result = await invokeInfraTool<BashInput, unknown>({
      declaration: noSchemaDeclaration,
      input: { command: "echo" },
      caller: { cycleId: "cycle-1" },
      run: async () => ({ ok: true, output: { exitCode: 0, stdout: "", stderr: "", timedOut: false }, meta: { invocationId: "inv-1", toolId: "bash", caller: { cycleId: "cycle-1" }, startedAt: 1, endedAt: 2, durationMs: 1 } }),
    });
    expect(result.ok).toBe(true);
  });
});
