import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repositoryIdFromRemote } from "@roll/spec";
import { dispatch } from "../src/bridge.js";
import { registerAll } from "../src/commands/index.js";

interface Run { readonly status: number; readonly stdout: string; readonly stderr: string }
interface InitStep { readonly kind: "journal" | "directory" | "file" | "cache" | "registry"; readonly target: string; readonly action: "created" | "reused" | "repaired" | "rejected" }
interface InitResult { readonly schema: string; readonly mode: "check" | "apply"; readonly outcome: string; readonly workspaceId: string; readonly root: string; readonly steps: readonly InitStep[] }
const roots: string[] = [];
const ENV_KEYS = ["HOME", "ROLL_HOME", "ROLL_LANG", "NO_COLOR"] as const;

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "roll-workspace-init-cli-"));
  roots.push(home);
  const source = join(home, "source");
  const remote = join(home, "product.git");
  mkdirSync(source);
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "roll@example.test"]);
  git(source, ["config", "user.name", "Roll Test"]);
  writeFileSync(join(source, "README.md"), "fixture\n", "utf8");
  git(source, ["add", "README.md"]);
  git(source, ["commit", "-q", "-m", "fixture"]);
  git(home, ["clone", "-q", "--bare", source, remote]);
  const rollHome = join(home, ".roll");
  const workspace = join(home, "workspace");
  const config = join(home, "workspace-init.yaml");
  const remoteUrl = `file://${remote}`;
  const repoId = repositoryIdFromRemote(remoteUrl);
  if (!repoId.ok) throw new Error("fixture remote must be valid");
  writeFileSync(config, `
schema: roll.workspace-init/v1
id: ws-demo
root: ${workspace}
display_name: Demo Workspace
repositories:
  - alias: product
    source: ${remoteUrl}
    integration_branch: main
`, "utf8");
  return { home, rollHome, workspace, config, remote, remoteUrl, repoId: repoId.value };
}

function expectedSteps(f: ReturnType<typeof fixture>, action: "created" | "reused"): readonly InitStep[] {
  return [
    { kind: "journal", target: join(f.rollHome, "workspace-init", "ws-demo.pending.json"), action: "created" },
    { kind: "directory", target: f.workspace, action },
    ...["workspace.yaml", "charter.md", "agents.yaml", "policy.yaml"].map((name) => ({ kind: "file" as const, target: join(f.workspace, name), action })),
    { kind: "directory", target: join(f.workspace, "requirements"), action },
    { kind: "directory", target: join(f.workspace, "design"), action },
    { kind: "directory", target: join(f.workspace, "backlog"), action },
    { kind: "file", target: join(f.workspace, "backlog", "index.md"), action },
    ...["issues", "runtime", join("runtime", "locks"), join("runtime", "heartbeats"), join("runtime", "alerts")]
      .map((name) => ({ kind: "directory" as const, target: join(f.workspace, name), action })),
    { kind: "cache", target: f.repoId, action },
    { kind: "registry", target: "ws-demo", action },
  ];
}

function tree(root: string): readonly string[] {
  if (!existsSync(root)) return [];
  const rows: string[] = [];
  const visit = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (entry.name === ".git") continue;
      const target = join(path, entry.name);
      const rel = relative(root, target);
      if (entry.isDirectory()) {
        rows.push(`d:${rel}`);
        visit(target);
      } else {
        rows.push(`f:${rel}:${statSync(target).mode}:${createHash("sha256").update(readFileSync(target)).digest("hex")}`);
      }
    }
  };
  visit(root);
  return rows;
}

async function run(args: string[], f: ReturnType<typeof fixture>, language = "en"): Promise<Run> {
  const saved: Partial<Record<typeof ENV_KEYS[number], string>> = {};
  for (const key of ENV_KEYS) {
    if (process.env[key] !== undefined) saved[key] = process.env[key];
  }
  process.env["HOME"] = f.home;
  process.env["ROLL_HOME"] = f.rollHome;
  process.env["ROLL_LANG"] = language;
  process.env["NO_COLOR"] = "1";
  let stdout = "";
  let stderr = "";
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture seam
  process.stdout.write = (chunk: string | Uint8Array): boolean => { stdout += String(chunk); return true; };
  // @ts-expect-error capture seam
  process.stderr.write = (chunk: string | Uint8Array): boolean => { stderr += String(chunk); return true; };
  try {
    const result = await dispatch(args, async () => ({ ok: true }));
    return { status: result.status, stdout, stderr };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

beforeEach(() => registerAll());
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("US-WS-006 roll workspace init", () => {
  it("runs check, first apply and idempotent second apply against one local file remote", async () => {
    const f = fixture();
    const before = tree(f.home);
    const check = await run(["workspace", "init", "ws-demo", "--config", f.config, "--check", "--json"], f);
    expect(check.status, check.stderr).toBe(0);
    const checkResult = JSON.parse(check.stdout) as InitResult;
    expect(checkResult).toMatchObject({
      schema: "roll.workspace-init-result/v1",
      mode: "check",
      outcome: "created",
      workspaceId: "ws-demo",
    });
    expect(checkResult.steps).toEqual(expectedSteps(f, "created"));
    expect(tree(f.home)).toEqual(before);

    const first = await run(["workspace", "init", "ws-demo", "--config", f.config, "--json"], f);
    expect(first.status, first.stderr).toBe(0);
    const firstResult = JSON.parse(first.stdout) as InitResult;
    expect(firstResult).toMatchObject({ mode: "apply", outcome: "created" });
    expect(firstResult.steps).toEqual(expectedSteps(f, "created"));
    expect(existsSync(join(f.workspace, ".git"))).toBe(false);
    const cachePath = join(f.rollHome, "repos", `${f.repoId}.git`);
    const identityPath = join(f.rollHome, "repos", `${f.repoId}.json`);
    const firstIdentity = JSON.parse(readFileSync(identityPath, "utf8")) as Record<string, unknown>;
    expect(firstIdentity).toMatchObject({ repoId: f.repoId, remote: f.remoteUrl.replace(/\.git$/u, ""), cachePath });
    expect(git(cachePath, ["remote", "get-url", "origin"])).toBe(f.remoteUrl.replace(/\.git$/u, ""));

    const second = await run(["workspace", "init", "ws-demo", "--config", f.config, "--json"], f);
    expect(second.status, second.stderr).toBe(0);
    const secondResult = JSON.parse(second.stdout) as InitResult;
    expect(secondResult).toMatchObject({ mode: "apply", outcome: "reused" });
    expect(secondResult.steps).toEqual(expectedSteps(f, "reused"));
    const secondIdentity = JSON.parse(readFileSync(identityPath, "utf8")) as Record<string, unknown>;
    expect(secondIdentity).toMatchObject({ repoId: f.repoId, remote: firstIdentity["remote"], cachePath });
    expect(readdirSync(join(f.rollHome, "repos")).filter((name) => name.endsWith(".git"))).toEqual([`${f.repoId}.git`]);
  });

  it("rejects identity mismatch and invalid arguments without any initialization writes", async () => {
    const f = fixture();
    const before = tree(f.home);
    const mismatch = await run(["workspace", "init", "ws-other", "--config", f.config, "--json"], f);
    const invalid = await run(["workspace", "init", "ws-demo", "--config", f.config, "--unknown", "--json"], f);
    expect(mismatch.status).toBe(1);
    expect(JSON.parse(mismatch.stderr)).toMatchObject({ schema: "roll.workspace-init-error/v1", error: { code: "identity_mismatch" } });
    expect(invalid.status).toBe(1);
    expect(JSON.parse(invalid.stderr)).toMatchObject({ error: { code: "invalid_arguments" } });
    expect(tree(f.home)).toEqual(before);
  });

  it("exposes init in locale-specific Workspace help", async () => {
    const f = fixture();
    const en = await run(["workspace", "--help"], f);
    const initEn = await run(["workspace", "init", "--help"], f, "en");
    const initZh = await run(["workspace", "init", "--help"], f, "zh");
    expect(en.stdout).toContain("init <id> --config <file> [--check] [--json]");
    expect(initEn).toMatchObject({ status: 0, stderr: "" });
    expect(initEn.stdout).toContain("Usage: roll workspace init <id> --config <file> [--check] [--json]");
    expect(initZh).toMatchObject({ status: 0, stderr: "" });
    expect(initZh.stdout).toContain("用法：roll workspace init <ID> --config <文件> [--check] [--json]");
  });
});
