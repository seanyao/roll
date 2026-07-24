import { describe, expect, it } from "vitest";
import { dispatch, registerPorted } from "../src/bridge.js";

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

describe("US-WS-022 workspace command alias", () => {
  it("canonicalizes the complete `ws` subtree before the workspace handler", async () => {
    const calls: string[][] = [];
    registerPorted("workspace", (args) => {
      calls.push(args);
      process.stdout.write(`${JSON.stringify({ command: "workspace", args })}\n`);
      return 0;
    });

    const canonical = await captureDispatch([
      "workspace", "create", "demo", "--config", "demo.workspace.yaml", "--check", "--json",
    ]);
    const alias = await captureDispatch([
      "ws", "create", "demo", "--config", "demo.workspace.yaml", "--check", "--json",
    ]);

    expect(alias).toEqual(canonical);
    expect(calls).toEqual([
      ["create", "demo", "--config", "demo.workspace.yaml", "--check", "--json"],
      ["create", "demo", "--config", "demo.workspace.yaml", "--check", "--json"],
    ]);
    expect(alias.stdout).toContain('"command":"workspace"');
    expect(alias.stdout).not.toContain('"command":"ws"');
  });
});
