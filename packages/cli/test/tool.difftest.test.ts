import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { toolCommand } from "../src/commands/tool.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tmp(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `roll-tool-command-${tag}-`));
  dirs.push(dir);
  return dir;
}

async function tsTool(args: string[], cwd: string): Promise<{ status: number; stdout: string; stderr: string }> {
  const saveCwd = process.cwd();
  process.chdir(cwd);
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (outChunks.push(String(c)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (c: string | Uint8Array): boolean => (errChunks.push(String(c)), true);
  let status = -1;
  try {
    status = await toolCommand(args);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.chdir(saveCwd);
  }
  return { status, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

describe("US-TOOL-015 roll tool status", () => {
  it("prints registered tools and their default policy state", async () => {
    const cwd = tmp("defaults");

    await expect(tsTool(["status"], cwd)).resolves.toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "tool              kind        enabled  timeout  limit  sandbox
      bash               bash        yes      30000    -      maxOutputBytes=65536
      browser.console    browser     yes      60000    -      headlessOnly=true,maxOutputBytes=2097152
      browser.dom-query  browser     yes      60000    -      headlessOnly=true,maxOutputBytes=2097152
      browser.screenshot browser     yes      60000    -      headlessOnly=true,maxOutputBytes=2097152
      filesystem.read    filesystem  yes      30000    -      -
      filesystem.stat    filesystem  yes      30000    -      -
      filesystem.write   filesystem  yes      30000    -      -
      git.commit         git         yes      60000    -      -
      git.merge          git         yes      60000    -      -
      git.push           git         yes      60000    -      -
      git.status         git         yes      60000    -      -
      github.ci          github      yes      60000    -      -
      github.pr          github      yes      60000    -      -
      mcp.call           mcp         yes      30000    -      network=restricted
      network.fetch      network     yes      30000    -      network=restricted
      ",
      }
    `);
  });

  it("merges .roll/policy.yaml over declaration defaults", async () => {
    const cwd = tmp("policy");
    mkdirSync(join(cwd, ".roll"), { recursive: true });
    writeFileSync(
      join(cwd, ".roll", "policy.yaml"),
      [
        "tools:",
        "  bash:",
        "    enabled: false",
        "    timeoutMs: 2500",
        "    maxInvocationsPerCycle: 2",
        "    sandbox:",
        "      allowedPaths: [.]",
        "  network.fetch:",
        "    sandbox:",
        "      network: blocked",
        "",
      ].join("\n"),
    );

    const result = await tsTool(["status"], cwd);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("bash               bash        no       2500     2      allowedPaths=.,maxOutputBytes=65536");
    expect(result.stdout).toContain("network.fetch      network     yes      30000    -      network=blocked");
  });

  it("prints usage for bare/help and rejects unknown subcommands", async () => {
    const cwd = tmp("help");

    await expect(tsTool([], cwd)).resolves.toEqual({
      status: 0,
      stdout: "Usage: roll tool status\n  Show registered tools and their effective policy state.\n展示已注册工具及其有效 policy 状态。\n",
      stderr: "",
    });
    await expect(tsTool(["bogus"], cwd)).resolves.toEqual({
      status: 1,
      stdout: "",
      stderr: "[roll] unknown 'roll tool' subcommand: bogus\n",
    });
  });
});
