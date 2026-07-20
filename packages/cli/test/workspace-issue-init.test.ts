import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repositoryIdFromRemote } from "@roll/spec";
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

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "roll-workspace-issue-cli-"));
  roots.push(home);
  const rollHome = join(home, ".roll");
  const workspace = join(home, "workspace");
  const cwd = join(home, "project");
  mkdirSync(cwd, { recursive: true });

  const sotRemote = join(home, "sot.git");
  const readRemote = join(home, "read.git");
  materializeRemote(join(home, "sot-source"), sotRemote);
  materializeRemote(join(home, "read-source"), readRemote);
  const sotUrl = `file://${sotRemote}`;
  const readUrl = `file://${readRemote}`;
  const sotRepoId = repositoryIdFromRemote(sotUrl);
  const readRepoId = repositoryIdFromRemote(readUrl);
  if (!sotRepoId.ok || !readRepoId.ok) throw new Error("fixture remotes must be valid");

  const config = join(home, "workspace-init.yaml");
  writeFileSync(config, `
schema: roll.workspace-init/v1
id: ws-demo
root: ${workspace}
display_name: Demo Workspace
repositories:
  - alias: sot
    source: ${sotUrl}
    integration_branch: main
  - alias: docs
    source: ${readUrl}
    integration_branch: main
`, "utf8");

  return { home, rollHome, workspace, config, cwd, sotRepoId: sotRepoId.value, readRepoId: readRepoId.value };
}

/** Write the Story Contract INSIDE the Workspace's own backlog tree
 *  (`backlog/**\/<story-id>/spec.md`) — its only valid runtime home. Called
 *  after `workspace init` so it never collides with the fresh-workspace plan. */
function writeBacklogStorySpec(f: ReturnType<typeof fixture>, storyId = "US-XX1"): void {
  const backlogStoryDir = join(f.workspace, "backlog", "workspace-orchestration", storyId);
  mkdirSync(backlogStoryDir, { recursive: true });
  writeFileSync(join(backlogStoryDir, "spec.md"), `---
id: ${storyId}
repositories:
  - alias: sot
    access: write
    required_delivery: true
  - alias: docs
    access: read
---

# ${storyId} fixture story
`, "utf8");
}

async function run(args: string[], f: ReturnType<typeof fixture>): Promise<Run> {
  const saved: Partial<Record<typeof ENV_KEYS[number], string>> = {};
  for (const key of ENV_KEYS) {
    if (process.env[key] !== undefined) saved[key] = process.env[key];
  }
  process.env["HOME"] = f.home;
  process.env["ROLL_HOME"] = f.rollHome;
  process.env["ROLL_LANG"] = "en";
  process.env["NO_COLOR"] = "1";
  let stdout = "";
  let stderr = "";
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const savedCwd = process.cwd();
  // @ts-expect-error capture seam
  process.stdout.write = (chunk: string | Uint8Array): boolean => { stdout += String(chunk); return true; };
  // @ts-expect-error capture seam
  process.stderr.write = (chunk: string | Uint8Array): boolean => { stderr += String(chunk); return true; };
  process.chdir(f.cwd);
  try {
    const result = await dispatch(args, async () => ({ ok: true }));
    return { status: result.status, stdout, stderr };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
    process.chdir(savedCwd);
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

beforeEach(() => registerAll());
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function initWorkspace(f: ReturnType<typeof fixture>): Promise<void> {
  const result = await run(["workspace", "init", "ws-demo", "--config", f.config, "--json"], f);
  expect(result.status, result.stderr).toBe(0);
}

describe("US-WS-008 roll workspace issue init", () => {
  it("resolves the Story contract and creates real worktrees across two repositories, then reuses them idempotently", async () => {
    const f = fixture();
    await initWorkspace(f);
    writeBacklogStorySpec(f);

    const check = await run(["workspace", "issue", "init", "US-XX1", "--workspace", "ws-demo", "--check", "--json"], f);
    expect(check.status, check.stderr).toBe(0);
    const checkView = JSON.parse(check.stdout) as { report: { manifest: { state: string }; targets: Record<string, { decision: string; access: string; workBranch: string | null }> } };
    expect(checkView.report.manifest.state).toBe("absent");
    expect(checkView.report.targets["sot"]).toMatchObject({ decision: "created", access: "write" });
    expect(checkView.report.targets["docs"]).toMatchObject({ decision: "created", access: "read", workBranch: null });
    expect(existsSync(join(f.workspace, "issues", "US-XX1"))).toBe(false);

    const apply = await run(["workspace", "issue", "init", "US-XX1", "--workspace", "ws-demo", "--json"], f);
    expect(apply.status, apply.stderr).toBe(0);
    const applyView = JSON.parse(apply.stdout) as { outcome: string; manifest: { schema: string; repositories: readonly unknown[] } };
    expect(applyView.outcome).toBe("created");
    expect(applyView.manifest).toMatchObject({ schema: "roll.issue/v1", workspaceId: "ws-demo", storyId: "US-XX1" });
    const issueRoot = join(f.workspace, "issues", "US-XX1");
    expect(existsSync(join(issueRoot, "sot", ".git"))).toBe(true);
    expect(existsSync(join(issueRoot, "docs", ".git"))).toBe(true);
    expect(existsSync(join(issueRoot, "manifest.json"))).toBe(true);
    expect(existsSync(join(issueRoot, "events.jsonl"))).toBe(true);
    const events = readFileSync(join(issueRoot, "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(events).toHaveLength(2);
    for (const event of events) expect(event).toMatchObject({ type: "issue:repository_bound", storyId: "US-XX1" });

    const reused = await run(["workspace", "issue", "init", "US-XX1", "--workspace", "ws-demo", "--json"], f);
    expect(reused.status, reused.stderr).toBe(0);
    expect(JSON.parse(reused.stdout)).toMatchObject({ outcome: "reused" });

    const recheck = await run(["workspace", "issue", "init", "US-XX1", "--workspace", "ws-demo", "--check", "--json"], f);
    expect(recheck.status, recheck.stderr).toBe(0);
    const recheckView = JSON.parse(recheck.stdout) as { report: { manifest: { state: string }; targets: Record<string, { decision: string }> } };
    expect(recheckView.report.manifest.state).toBe("compatible");
    expect(recheckView.report.targets["sot"]).toMatchObject({ decision: "reused" });
    expect(recheckView.report.targets["docs"]).toMatchObject({ decision: "reused" });
  });

  it("resolves no target and creates nothing when the second repository's remote is unreachable at cache-resolution time", async () => {
    const f = fixture();
    await initWorkspace(f);
    writeBacklogStorySpec(f);

    // Fault injection: destroy the SECOND repository's source remote entirely
    // (a real, unmocked failure). ALL targets' caches must resolve before the
    // Issue root is created or mutated, so this must leave zero trace.
    rmSync(join(f.home, "read.git"), { recursive: true, force: true });

    const failed = await run(["workspace", "issue", "init", "US-XX1", "--workspace", "ws-demo", "--json"], f);
    expect(failed.status).toBe(1);
    expect(JSON.parse(failed.stderr)).toMatchObject({ error: { code: "apply_failed" } });
    expect(existsSync(join(f.workspace, "issues", "US-XX1"))).toBe(false);

    // Repair: restore the remote and re-run — the same CLI contract converges.
    // The Issue root itself was never created, but the READ target's
    // repository cache was left interrupted mid-resolution, so the overall
    // outcome is honestly "repaired" (a cache-level repair), not "created".
    execFileSync("git", ["clone", "-q", "--bare", join(f.home, "read-source"), join(f.home, "read.git")], { stdio: "ignore" });
    const repaired = await run(["workspace", "issue", "init", "US-XX1", "--workspace", "ws-demo", "--json"], f);
    expect(repaired.status, repaired.stderr).toBe(0);
    expect(JSON.parse(repaired.stdout)).toMatchObject({ outcome: "repaired" });
    const issueRoot = join(f.workspace, "issues", "US-XX1");
    expect(existsSync(join(issueRoot, "sot", ".git"))).toBe(true);
    expect(existsSync(join(issueRoot, "docs", ".git"))).toBe(true);
  });

  it("rolls back the clean first target's real git worktree via git worktree remove when the SECOND target's worktree add genuinely fails", async () => {
    const f = fixture();
    await initWorkspace(f);
    writeBacklogStorySpec(f);

    // A real, unmocked git-level failure at the worktree-ADD phase: apply
    // once to create sot's real branch/worktree, then simulate an operator
    // manually deleting the worktree DIRECTORY by hand (leaving the branch —
    // and the Issue root's manifest/events — behind, an inconsistent-but-real
    // state). Re-running must genuinely fail `worktree add -b` on the
    // survived branch and roll back cleanly rather than duplicate anything.
    const first = await run(["workspace", "issue", "init", "US-XX1", "--workspace", "ws-demo", "--json"], f);
    expect(first.status, first.stderr).toBe(0);
    const issueRootPre = join(f.workspace, "issues", "US-XX1");
    const sotCachePath = join(f.rollHome, "repos", `${f.sotRepoId}.git`);
    execFileSync("git", ["worktree", "remove", "--force", join(issueRootPre, "sot")], { cwd: sotCachePath, stdio: "ignore" });
    rmSync(join(issueRootPre, "docs"), { recursive: true, force: true });

    const failed = await run(["workspace", "issue", "init", "US-XX1", "--workspace", "ws-demo", "--json"], f);
    expect(failed.status).toBe(1);
    expect(JSON.parse(failed.stderr)).toMatchObject({ error: { code: "apply_failed" } });

    const issueRoot = join(f.workspace, "issues", "US-XX1");
    expect(existsSync(join(issueRoot, "docs"))).toBe(false);
    const journal = JSON.parse(readFileSync(join(issueRoot, "issue-init.pending.json"), "utf8"));
    expect(journal).toMatchObject({ schema: "roll.issue-init-journal/v1", status: "repair_required" });

    // Repair: remove the colliding branch, then re-run — the same CLI contract converges.
    execFileSync("git", ["branch", "-D", "roll/ws-demo/US-XX1/sot"], { cwd: sotCachePath, stdio: "ignore" });
    const repaired = await run(["workspace", "issue", "init", "US-XX1", "--workspace", "ws-demo", "--json"], f);
    expect(repaired.status, repaired.stderr).toBe(0);
    expect(JSON.parse(repaired.stdout)).toMatchObject({ outcome: "created" });
    expect(existsSync(join(issueRoot, "sot", ".git"))).toBe(true);
    expect(existsSync(join(issueRoot, "docs", ".git"))).toBe(true);
    expect(existsSync(join(issueRoot, "issue-init.pending.json"))).toBe(false);
  });

  it("rejects invalid arguments and an unknown story id without any writes", async () => {
    const f = fixture();
    await initWorkspace(f);
    writeBacklogStorySpec(f);
    const invalid = await run(["workspace", "issue", "init", "US-XX1", "--workspace", "ws-demo", "--unknown", "--json"], f);
    expect(invalid.status).toBe(1);
    expect(JSON.parse(invalid.stderr)).toMatchObject({ error: { code: "invalid_arguments" } });

    const missing = await run(["workspace", "issue", "init", "US-NOPE", "--workspace", "ws-demo", "--json"], f);
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stderr)).toMatchObject({ error: { code: "story_not_found" } });
    expect(existsSync(join(f.workspace, "issues", "US-NOPE"))).toBe(false);
  });

  it("never resolves a Story Contract from the caller cwd's .roll/features tree, only from the Workspace's own backlog tree", async () => {
    const f = fixture();
    await initWorkspace(f);
    // Deliberately place a spec in the CALLER cwd's .roll/features layout —
    // this must be completely invisible to the Workspace-scoped resolver.
    const cwdEpicDir = join(f.cwd, ".roll", "features", "workspace-orchestration", "US-XX1");
    mkdirSync(cwdEpicDir, { recursive: true });
    writeFileSync(join(cwdEpicDir, "spec.md"), `---
id: US-XX1
repositories:
  - alias: sot
    access: write
    required_delivery: true
  - alias: docs
    access: read
---

# US-XX1 fixture story (cwd — must be ignored)
`, "utf8");

    const result = await run(["workspace", "issue", "init", "US-XX1", "--workspace", "ws-demo", "--json"], f);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "story_not_found" } });
    expect(existsSync(join(f.workspace, "issues", "US-XX1"))).toBe(false);
  });

  it.each([
    ["dot", "."],
    ["dot-dot", ".."],
    ["traversal", "../../etc/passwd"],
    ["embedded traversal", "US-../../XX1"],
    ["contains slash", "US-XX/1"],
  ])("rejects a %s story id as unsafe before any path use, with zero writes", async (_name, storyId) => {
    const f = fixture();
    await initWorkspace(f);
    const before = readFileSync(f.config, "utf8"); // sentinel: config untouched proves no writes escaped
    const result = await run(["workspace", "issue", "init", storyId, "--workspace", "ws-demo", "--json"], f);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "invalid_story_id" } });
    // The pre-existing empty issues/ dir (from workspace init) must gain no new entries.
    expect(existsSync(join(f.workspace, "issues"))).toBe(true);
    expect(readFileSync(f.config, "utf8")).toBe(before);
    expect(readdirSync(join(f.workspace, "issues"))).toEqual([]);
  });
});
