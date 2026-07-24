import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "../src/bridge.js";
import { registerAll } from "../src/commands/index.js";

interface Run { readonly status: number; readonly stdout: string; readonly stderr: string }
const roots: string[] = [];
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function run(args: string[], home: string, language: "en" | "zh" = "en"): Promise<Run> {
  const saved = { HOME: process.env["HOME"], ROLL_HOME: process.env["ROLL_HOME"], ROLL_LANG: process.env["ROLL_LANG"] };
  process.env["HOME"] = home;
  process.env["ROLL_HOME"] = join(home, ".roll");
  process.env["ROLL_LANG"] = language;
  let stdout = "";
  let stderr = "";
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture seam
  process.stdout.write = (chunk: string | Uint8Array): boolean => (stdout += String(chunk), true);
  // @ts-expect-error capture seam
  process.stderr.write = (chunk: string | Uint8Array): boolean => (stderr += String(chunk), true);
  try {
    const result = await dispatch(args, async () => ({ ok: true }));
    return { status: result.status, stdout, stderr };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

beforeEach(() => registerAll());
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("US-WS-023 create-only CLI", () => {
  it("normalizes workspace and ws create to byte-equivalent canonical JSON", async () => {
    const home = mkdtempSync(join(tmpdir(), "roll-workspace-create-"));
    roots.push(home);
    const config = join(home, "workspace-create.yaml");
    writeFileSync(config, `schema: roll.workspace-create/v1\nid: ws-demo\nroot: ${join(home, "workspace")}\nrepositories:\n  - alias: product\n    source: file://${join(home, "product.git")}\n    integration_branch: main\n`, "utf8");

    const canonical = await run(["workspace", "create", "ws-demo", "--config", config, "--check", "--json"], home);
    const alias = await run(["ws", "create", "ws-demo", "--config", config, "--check", "--json"], home);
    expect(canonical.status, canonical.stderr).toBe(0);
    expect(alias).toEqual(canonical);
    expect(JSON.parse(canonical.stdout)).toMatchObject({ schema: "roll.workspace-create-result/v1", mode: "check" });
  });

  it("rejects workspace init as unknown without reading or mutating its config", async () => {
    const home = mkdtempSync(join(tmpdir(), "roll-workspace-create-init-reject-"));
    roots.push(home);
    const marker = join(home, "must-not-read.yaml");
    writeFileSync(marker, "sentinel", "utf8");
    const before = readFileSync(marker, "utf8");

    const result = await run(["workspace", "init", "ws-demo", "--config", marker], home);
    expect(result).toEqual({
      status: 1,
      stdout: "",
      stderr: "Unknown workspace subcommand \"init\". Use \"roll workspace create\".\n",
    });
    expect(readFileSync(marker, "utf8")).toBe(before);

    const zh = await run(["workspace", "init", "ws-demo", "--config", marker], home, "zh");
    expect(zh).toEqual({
      status: 1,
      stdout: "",
      stderr: "未知工作区子命令“init”。请使用“roll workspace create”。\n",
    });
  });

  it("returns a create/v1 conversion error for the legacy config without applying it", async () => {
    const home = mkdtempSync(join(tmpdir(), "roll-workspace-create-legacy-"));
    roots.push(home);
    const config = join(home, "legacy.yaml");
    writeFileSync(config, `schema: roll.workspace-init/v1\nid: ws-demo\nroot: ${join(home, "workspace")}\nrepositories:\n  - alias: product\n    source: file://${join(home, "product.git")}\n    integration_branch: main\n`, "utf8");

    const result = await run(["workspace", "create", "ws-demo", "--config", config, "--json"], home);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      schema: "roll.workspace-create-error/v1",
      error: {
        code: "legacy_create_config",
        message: "Legacy Workspace init config must be converted before create",
        conversions: [{ path: "schema", from: "roll.workspace-init/v1", to: "roll.workspace-create/v1" }],
        nextAction: "roll workspace create ws-demo --config <converted-path>",
      },
    });
  });

  it("keeps top-level roll init independently registered", async () => {
    const home = mkdtempSync(join(tmpdir(), "roll-top-level-init-"));
    roots.push(home);
    const result = await run(["init", "--help"], home);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("roll init");
    expect(result.stderr).toBe("");
  });

  it("records an honest physical-capture skip beside a redacted headless transcript", () => {
    const evidenceRoot = join(repoRoot, "packages", "cli", "test", "fixtures", "workspace", "us-ws-023-terminal-evidence");
    const skip = JSON.parse(readFileSync(join(evidenceRoot, "capture-skip.json"), "utf8")) as {
      readonly captures: readonly { readonly taken: boolean; readonly skipped: string; readonly out: string }[];
      readonly fallback: { readonly path: string; readonly countsAsScreenshot: boolean };
    };
    const transcript = readFileSync(join(evidenceRoot, skip.fallback.path), "utf8");

    expect(skip.captures).toEqual([expect.objectContaining({
      taken: false,
      out: "screenshots/terminal.png",
      skipped: expect.stringContaining("no PNG was fabricated"),
    })]);
    expect(skip.fallback.countsAsScreenshot).toBe(false);
    expect(existsSync(join(evidenceRoot, "screenshots", "terminal.png"))).toBe(false);
    expect(transcript).toContain("Usage: roll workspace create");
    expect(transcript).toContain("Unknown workspace subcommand \"init\". Use \"roll workspace create\".");
    expect(transcript).not.toContain("/Users/");
  });
});
