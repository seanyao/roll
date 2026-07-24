import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("keeps canonical help primary and derives the visible alias note", async () => {
    registerPorted("workspace", () => 9, {
      help: "Usage: roll workspace <create|list> [--workspace <id|path>]",
    });

    const canonical = await captureDispatch(["workspace", "--help"]);
    const alias = await captureDispatch(["ws", "--help"]);

    expect(alias).toEqual(canonical);
    expect(canonical.status).toBe(0);
    expect(canonical.stdout).toContain("Usage: roll workspace");
    expect(canonical.stdout).toContain("Alias: roll ws ...");
    expect(canonical.stdout).toContain("Workspace selector alias: --ws <id|path>");
    expect(canonical.stdout).not.toContain("Usage: roll ws");
  });

  it("renders generated alias notes in the configured help language", async () => {
    const home = mkdtempSync(join(tmpdir(), "roll-workspace-alias-lang-"));
    const rollHome = join(home, ".roll");
    mkdirSync(rollHome, { recursive: true });
    writeFileSync(join(rollHome, "config.yaml"), "lang: zh\n");
    const saved = {
      rollHome: process.env["ROLL_HOME"],
      rollLang: process.env["ROLL_LANG"],
    };
    process.env["ROLL_HOME"] = rollHome;
    delete process.env["ROLL_LANG"];
    registerPorted("workspace", () => 9, { help: "用法：roll workspace <list>" });

    try {
      const result = await captureDispatch(["ws", "--help"]);
      expect(result.stdout).toContain("别名：roll ws ...");
      expect(result.stdout).toContain("Workspace selector 别名：--ws <ID|路径>");
      expect(result.stdout).not.toContain("Alias: roll ws");
    } finally {
      if (saved.rollHome === undefined) delete process.env["ROLL_HOME"];
      else process.env["ROLL_HOME"] = saved.rollHome;
      if (saved.rollLang === undefined) delete process.env["ROLL_LANG"];
      else process.env["ROLL_LANG"] = saved.rollLang;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
