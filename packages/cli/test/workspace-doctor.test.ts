import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureRepositoryCache, WorkspaceRegistry } from "@roll/infra";
import { AGENT_CAPACITY_LEASE_SCHEMA, repositoryIdFromRemote, type RepositoryBinding } from "@roll/spec";
import { dispatch } from "../src/bridge.js";
import { registerAll } from "../src/commands/index.js";

interface Run { readonly status: number; readonly stdout: string; readonly stderr: string }
const roots: string[] = [];
const ENV_KEYS = ["HOME", "ROLL_HOME", "ROLL_LANG", "NO_COLOR"] as const;

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function materializeRemote(source: string, remote: string): void {
  mkdirSync(source, { recursive: true });
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "roll@example.test"]);
  git(source, ["config", "user.name", "Roll Test"]);
  writeFileSync(join(source, "README.md"), "fixture\n", "utf8");
  git(source, ["add", "README.md"]);
  git(source, ["commit", "-q", "-m", "fixture"]);
  mkdirSync(dirname(remote), { recursive: true });
  git(dirname(remote), ["clone", "-q", "--bare", source, remote]);
}

async function fixture() {
  const home = mkdtempSync(join(tmpdir(), "roll-workspace-doctor-cli-"));
  roots.push(home);
  const rollHome = join(home, ".roll");
  const workspace = join(home, "workspace");
  const remotePath = join(home, "product.git");
  materializeRemote(join(home, "source"), remotePath);
  const remote = `file://${remotePath}`;
  const repoId = repositoryIdFromRemote(remote);
  if (!repoId.ok) throw new Error("fixture remote must be valid");
  const binding: RepositoryBinding = {
    schema: "roll.repository-binding/v1",
    repoId: repoId.value,
    alias: "product",
    remote,
    integrationBranch: "main",
    provider: "generic",
    workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: [] },
  };
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "workspace.yaml"), `${JSON.stringify({
    schema: "roll.workspace/v1",
    workspaceId: "ws-demo",
    displayName: "Demo",
    requirements: [],
    repositories: [binding],
  }, null, 2)}\n`, "utf8");
  const registry = new WorkspaceRegistry({ rollHome, now: () => 1 });
  registry.register({ workspaceId: "ws-demo", root: workspace });
  registry.activate("ws-demo");
  const cache = await ensureRepositoryCache({
    rollHome,
    binding,
    integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
  });
  return { home, rollHome, workspace, binding, cache };
}

async function run(args: string[], f: Awaited<ReturnType<typeof fixture>>, lang: "en" | "zh" = "en"): Promise<Run> {
  const saved: Partial<Record<typeof ENV_KEYS[number], string>> = {};
  for (const key of ENV_KEYS) if (process.env[key] !== undefined) saved[key] = process.env[key];
  process.env["HOME"] = f.home;
  process.env["ROLL_HOME"] = f.rollHome;
  process.env["ROLL_LANG"] = lang;
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

describe("US-WS-018 roll workspace doctor", () => {
  it("reports a healthy Workspace from real registry, manifest and cache facts", async () => {
    const f = await fixture();
    const result = await run(["workspace", "doctor", "ws-demo", "--json"], f);

    expect(result).toMatchObject({ status: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual({
      schema: "roll.workspace-doctor/v1",
      workspaceId: "ws-demo",
      status: "healthy",
      findings: [],
      nextAction: { kind: "none" },
    });
  });

  it("reports a missing recorded cache as repairable with one typed action", async () => {
    const f = await fixture();
    rmSync(f.cache.cachePath, { recursive: true, force: true });
    const result = await run(["workspace", "doctor", "ws-demo"], f);

    expect(result).toMatchObject({ status: 0, stderr: "" });
    expect(result.stdout).toContain("Workspace ws-demo doctor: repairable");
    expect(result.stdout).toContain("cache_repairable");
    expect(result.stdout).toContain(`rebuild_cache:${f.binding.repoId}`);
    expect(result.stdout).not.toContain(f.home);
  });

  it("blocks a stale foreign machine lease without leaking owner identity or credentials", async () => {
    const f = await fixture();
    const leaseRoot = join(f.rollHome, "locks", "capacity", "leases");
    mkdirSync(leaseRoot, { recursive: true });
    writeFileSync(join(leaseRoot, "foreign.json"), `${JSON.stringify({
      schema: AGENT_CAPACITY_LEASE_SCHEMA,
      key: { agent: "codex", model: "gpt-secret", contextKey: "credential-sentinel-context" },
      owner: {
        leaseId: "lease-foreign",
        ownerToken: "credential-sentinel-token",
        workspaceId: "ws-demo",
        storyId: "US-SECRET",
        cycleId: "cycle-secret",
        spawnId: "spawn-secret",
        host: "private-hostname",
        pid: 999999,
        processStartedAtMs: 1,
      },
      acquiredAtMs: 1,
      heartbeatAtMs: 1,
    })}\n`, "utf8");

    const result = await run(["workspace", "doctor", "ws-demo", "--json"], f);
    expect(result.status).toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "blocked",
      findings: [{ code: "lease_stale_live_or_foreign", status: "blocked" }],
    });
    for (const secret of ["credential-sentinel", "private-hostname", "US-SECRET", "cycle-secret", "spawn-secret", "gpt-secret"]) {
      expect(output).not.toContain(secret);
    }
  });

  it("shows localized help and rejects unknown or duplicated selectors", async () => {
    const f = await fixture();
    const help = await run(["workspace", "doctor", "--help"], f, "zh");
    expect(help).toMatchObject({ status: 0, stderr: "" });
    expect(help.stdout).toContain("roll workspace doctor <ID>");

    for (const args of [
      ["workspace", "doctor", "ws-demo", "other", "--json"],
      ["workspace", "doctor", "ws-demo", "--unknown", "--json"],
    ]) {
      const rejected = await run(args, f);
      expect(rejected.status).toBe(1);
      expect(JSON.parse(rejected.stderr)).toMatchObject({ error: { code: "invalid_arguments" } });
    }
  });
});
