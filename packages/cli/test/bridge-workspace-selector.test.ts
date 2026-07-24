import { beforeEach, describe, expect, it } from "vitest";
import {
  canonicalizeWorkspaceAliasTokens,
  dispatch,
  parseCanonicalWorkspaceSelectorArgs,
  registerPorted,
} from "../src/bridge.js";
import {
  WORKSPACE_SELECTOR_OPERATIONS,
  aliasHelpDecision,
  validateWorkspaceSelectorOperations,
  workspaceSelectorOperation,
} from "../src/lib/command-surface.js";

async function captureDispatch(argv: string[]): Promise<{
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  let stdout = "";
  let stderr = "";
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  try {
    // @ts-expect-error test capture
    process.stdout.write = (chunk: string | Uint8Array): boolean => ((stdout += String(chunk)), true);
    // @ts-expect-error test capture
    process.stderr.write = (chunk: string | Uint8Array): boolean => ((stderr += String(chunk)), true);
    const result = await dispatch(argv, async () => ({ ok: true }));
    return { status: result.status, stdout, stderr };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
}

describe("US-WS-022 bridge Workspace selector normalization", () => {
  let calls: string[][];

  beforeEach(() => {
    calls = [];
    registerPorted("backlog", (args) => {
      calls.push(args);
      return 0;
    });
  });

  it("normalizes the full argv before a family dispatcher without reordering", async () => {
    const result = await captureDispatch(["backlog", "show", "US-WS-022", "--ws", "roll", "--no-color"]);

    expect(result.status).toBe(0);
    expect(calls).toEqual([["show", "US-WS-022", "--workspace", "roll", "--no-color"]]);
  });

  it("is idempotent and leaves exact --ws tokens after -- untouched", () => {
    const once = canonicalizeWorkspaceAliasTokens(["show", "US-WS-022", "--ws", "roll", "--", "--ws"]);
    const twice = canonicalizeWorkspaceAliasTokens(once.args);

    expect(once).toEqual({
      args: ["show", "US-WS-022", "--workspace", "roll", "--", "--ws"],
      aliasUsed: true,
    });
    expect(twice).toEqual({ args: once.args, aliasUsed: false });
  });

  it("rejects duplicate canonical/alias selectors before the handler runs", async () => {
    const result = await captureDispatch([
      "backlog", "--workspace", "roll", "--ws", "roll", "--json",
    ]);

    expect(result.status).toBe(1);
    expect(calls).toEqual([]);
    expect(JSON.parse(result.stderr)).toEqual({
      schema: "roll.workspace-selector-error/v1",
      error: {
        code: "duplicate_workspace_selector",
        message: "Provide exactly one --workspace <id|path>.",
        command: "roll backlog",
        nextAction: "Remove the duplicate and use --workspace <id|path> once.",
      },
    });
    expect(result.stderr).not.toContain('"--ws"');
  });

  it("rejects a missing selector value without consuming the next flag", async () => {
    const result = await captureDispatch(["backlog", "--ws", "--no-color"]);

    expect(result.status).toBe(1);
    expect(calls).toEqual([]);
    expect(result.stderr).toContain("workspace_selector_missing_value");
    expect(result.stderr).toContain("--workspace <id|path>");
    expect(result.stderr).not.toMatch(/(^|\s)--ws(?=\s|$)/u);
  });

  it("keeps unsupported operations unsupported while still canonicalizing the token", async () => {
    const unsupportedCalls: string[][] = [];
    registerPorted("status", (args) => {
      unsupportedCalls.push(args);
      return 9;
    });

    const result = await captureDispatch(["status", "--ws"]);

    expect(result.status).toBe(9);
    expect(unsupportedCalls).toEqual([["--workspace"]]);
  });

  it("parses one canonical selector without treating post-sentinel literals as flags", () => {
    expect(parseCanonicalWorkspaceSelectorArgs([
      "show", "US-WS-022", "--workspace", "roll", "--", "--workspace", "literal",
    ])).toEqual({
      ok: true,
      selector: "roll",
      remaining: ["show", "US-WS-022", "--", "--workspace", "literal"],
    });
  });

  it("generates the alias contract from every declared selector capability", () => {
    expect(() => validateWorkspaceSelectorOperations(WORKSPACE_SELECTOR_OPERATIONS)).not.toThrow();

    for (const operation of WORKSPACE_SELECTOR_OPERATIONS) {
      expect(operation.acceptsWorkspaceSelector, operation.id).toBe(true);
      expect(workspaceSelectorOperation(operation.command, operation.exampleArgs), operation.id).toEqual(operation);
      const aliasArgs = operation.exampleArgs.map((arg) => arg === "--workspace" ? "--ws" : arg);
      expect(canonicalizeWorkspaceAliasTokens(aliasArgs).args, operation.id).toEqual(operation.exampleArgs);
      expect(parseCanonicalWorkspaceSelectorArgs(operation.exampleArgs), operation.id).toMatchObject({
        ok: true,
        selector: "roll",
      });
    }
  });

  it("derives help aliases from the command and selector capability registries", () => {
    expect(aliasHelpDecision("workspace")).toEqual({
      canonicalCommand: "workspace",
      commandAliases: ["ws"],
      workspaceSelectorAliases: ["--ws"],
    });
    expect(aliasHelpDecision("backlog")).toEqual({
      canonicalCommand: "backlog",
      commandAliases: [],
      workspaceSelectorAliases: ["--ws"],
    });
    expect(aliasHelpDecision("status")).toBeUndefined();
  });
});
