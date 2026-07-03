import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolRequirement, ToolRequirementResolution } from "@roll/spec";
import { collectToolRows, renderToolRows, toolCommand } from "../src/commands/tool.js";

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

function fakeResolver(requirement: ToolRequirement): ToolRequirementResolution {
  if (requirement.name === "gh") return { requirement, status: "missing", detail: "gh is not on PATH.", repair: { command: "brew install gh" } };
  if (requirement.name === "playwright-chromium") {
    return { requirement, status: "missing", detail: "Chromium is not installed.", repair: { command: "npx playwright install chromium" } };
  }
  return { requirement, status: "ok", detail: `${requirement.name} ok` };
}

describe("US-TOOL-015 roll tool status", () => {
  it("prints registered tools and their default policy state", async () => {
    const cwd = tmp("defaults");
    const stdout = renderToolRows(await collectToolRows(cwd, fakeResolver));

    expect(stdout).toMatchInlineSnapshot(`
      "tool                kind        enabled  readiness    timeout  limit  contract                                       sandbox
      bash                bash        yes      available    30000    -      args?, command, cwd?, env?                     maxOutputBytes=65536
      browser.console     browser     yes      degraded     60000    -      url, waitFor?                                  headlessOnly=true,maxOutputBytes=2097152
      browser.dom-query   browser     yes      degraded     60000    -      selector, url, waitFor?                        headlessOnly=true,maxOutputBytes=2097152
      browser.screenshot  browser     yes      degraded     60000    -      screenshotPath?, url, viewport?, waitFor?      headlessOnly=true,maxOutputBytes=2097152
      filesystem.read     filesystem  yes      available    30000    -      limit?, offset?, path                          -
      filesystem.stat     filesystem  yes      available    30000    -      path                                           -
      filesystem.write    filesystem  yes      available    30000    -      content, path                                  -
      git.commit          git         yes      available    60000    -      allowEmpty?, cwd, message                      -
      git.merge           git         yes      available    60000    -      cwd, ffOnly?, noCommit?, ref                   -
      git.push            git         yes      available    60000    -      branch, cwd, remote?, setUpstream?             -
      git.status          git         yes      available    60000    -      cwd                                            -
      github.ci           github      yes      unavailable  60000    -      oneOf                                          -
      github.pr           github      yes      unavailable  60000    -      oneOf                                          -
      mcp.call            mcp         yes      available    30000    -      arguments?, serverName, toolName               network=restricted
      network.fetch       network     yes      available    30000    -      body?, headers?, method?, timeoutMs?, url      network=restricted
      physical.screenshot physical    yes      available    60000    -      oneOf                                          maxOutputBytes=2097152
      "
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
    expect(result.stdout).toMatch(/bash\s+bash\s+no\s+available\s+2500\s+2\s+args\?, command, cwd\?, env\?\s+allowedPaths=\.,maxOutputBytes=65536/);
    expect(result.stdout).toMatch(/network\.fetch\s+network\s+yes\s+available\s+30000\s+-\s+body\?, headers\?, method\?, timeoutMs\?, url\s+network=blocked/);
  });

  it("prints usage for bare/help and rejects unknown subcommands", async () => {
    const cwd = tmp("help");

    await expect(tsTool([], cwd)).resolves.toEqual({
      status: 0,
      stdout: "Usage: roll tool status\n  Show registered tools, input contracts, effective policy state, and requirement readiness.\n展示已注册工具、入参契约、有效 policy 状态与 requirement 就绪度。\n",
      stderr: "",
    });
    await expect(tsTool(["bogus"], cwd)).resolves.toEqual({
      status: 1,
      stdout: "",
      stderr: "[roll] unknown 'roll tool' subcommand: bogus\n",
    });
  });
});
