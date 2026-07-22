import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryIdFromRemote } from "@roll/spec";
import { nodePorts, type RunnerPaths } from "../src/runner/index.js";
import { executeSetupCommand } from "../src/runner/setup-handlers.js";

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function materializeRemote(source: string, remote: string): void {
  mkdirSync(source, { recursive: true });
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "roll@example.test"]);
  git(source, ["config", "user.name", "Roll Test"]);
  writeFileSync(join(source, "README.md"), `${source}\n`, "utf8");
  git(source, ["add", "README.md"]);
  git(source, ["commit", "-q", "-m", "fixture"]);
  mkdirSync(dirname(remote), { recursive: true });
  git(dirname(remote), ["clone", "-q", "--bare", source, remote]);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "roll-multi-repo-worktree-"));
  const rollHome = join(root, "roll-home");
  const workspace = join(root, "workspace");
  const storyId = "US-WS-011";
  const remotes = ["sot", "docs"].map((alias) => {
    const remotePath = join(root, "remotes", `${alias}.git`);
    materializeRemote(join(root, "sources", alias), remotePath);
    const remote = `file://${remotePath}`;
    const repoId = repositoryIdFromRemote(remote);
    if (!repoId.ok) throw new Error("fixture remote must be canonical");
    return { alias, remote, remotePath, repoId: repoId.value };
  });
  mkdirSync(join(workspace, "backlog", "workspace-orchestration", storyId), { recursive: true });
  writeFileSync(join(workspace, "workspace.yaml"), `${JSON.stringify({
    schema: "roll.workspace/v1",
    workspaceId: "ws-alpha",
    displayName: "Workspace Alpha",
    createdAt: "2026-07-22T00:00:00.000Z",
    requirements: [],
    repositories: remotes.map((repository) => ({
      schema: "roll.repository-binding/v1",
      repoId: repository.repoId,
      alias: repository.alias,
      remote: repository.remote,
      integrationBranch: "main",
      provider: "github",
      workflow: {
        branchPattern: "roll/{workspace_id}/{story_id}/{repo_alias}",
        requiredChecks: [],
      },
    })),
  }, null, 2)}\n`);
  writeFileSync(join(workspace, "backlog", "index.md"), `| Story | Description | Status |\n|---|---|---|\n| ${storyId} | fixture | 📋 Todo |\n`);
  writeFileSync(join(workspace, "backlog", "workspace-orchestration", storyId, "spec.md"), `---
id: ${storyId}
repositories:
  - alias: sot
    access: write
    required_delivery: true
  - alias: docs
    access: read
---

# ${storyId} fixture
`);
  const runtime = join(workspace, "runtime");
  const paths: RunnerPaths = {
    eventsPath: join(runtime, "events.ndjson"),
    runsPath: join(runtime, "runs.jsonl"),
    alertsPath: join(runtime, "alerts.log"),
    lockPath: join(runtime, "cycle.lock"),
    heartbeatPath: join(runtime, "heartbeat"),
    worktreePath: join(runtime, "legacy-worktree"),
    storyLeasePath: join(runtime, "locks", "story-leases.json"),
  };
  return { workspace, rollHome, storyId, paths, remotes };
}

describe("US-WS-011 Workspace repository preparation", () => {
  it("prepares one transaction for every repository leg and resolves the durable execution map", async () => {
    const f = fixture();
    const previousRollHome = process.env["ROLL_HOME"];
    process.env["ROLL_HOME"] = f.rollHome;
    try {
      const ports = nodePorts({
        repoCwd: f.workspace,
        paths: f.paths,
        skillBody: "BUILD STORY",
        routeDeps: { readSlot: () => ({ agent: "claude" }), firstInstalled: () => "claude" },
      });
      const prepared = await ports.repositories?.prepare({ storyId: f.storyId, cycleId: "cycle-11" });
      expect(prepared).toEqual({ kind: "prepared", outcome: "created" });
      const execution = await ports.repositories?.resolve(f.storyId);
      expect(execution?.workspaceId).toBe("ws-alpha");
      expect(Object.values(execution?.repositories ?? {}).map((entry) => [entry.alias, entry.access])).toEqual([
        ["sot", "write"],
        ["docs", "read"],
      ]);
    } finally {
      if (previousRollHome === undefined) delete process.env["ROLL_HOME"];
      else process.env["ROLL_HOME"] = previousRollHome;
    }
  });

  it("claims the Story lease, prepares every leg, then marks In Progress and returns the resolved map", async () => {
    const f = fixture();
    const previousRollHome = process.env["ROLL_HOME"];
    process.env["ROLL_HOME"] = f.rollHome;
    try {
      const ports = nodePorts({
        repoCwd: f.workspace,
        paths: f.paths,
        skillBody: "BUILD STORY",
        routeDeps: { readSlot: () => ({ agent: "claude" }), firstInstalled: () => "claude" },
      });
      const repositories = ports.repositories;
      if (repositories === undefined) throw new Error("Workspace ports must exist");
      let leaseObservedBeforePrepare = false;
      ports.repositories = {
        ...repositories,
        async prepare(request) {
          leaseObservedBeforePrepare = existsSync(f.paths.storyLeasePath!)
            && JSON.parse(readFileSync(f.paths.storyLeasePath!, "utf8"))[f.storyId]?.source === "cycle";
          expect(readFileSync(join(f.workspace, "backlog", "index.md"), "utf8")).toContain("📋 Todo");
          return repositories.prepare(request);
        },
      };

      const result = await executeSetupCommand({ kind: "pick_story" }, ports, {
        cycleId: "cycle-11",
        branch: "loop/cycle-11",
        loop: "main",
      });

      expect(leaseObservedBeforePrepare).toBe(true);
      expect(result.event?.type).toBe("story_picked");
      expect(result.event).toMatchObject({ storyId: f.storyId });
      expect(readFileSync(join(f.workspace, "backlog", "index.md"), "utf8")).toContain("🔨 In Progress");
      expect(realpathSync(join(f.workspace, "issues", f.storyId, "sot"))).toContain(`/issues/${f.storyId}/sot`);
      expect(realpathSync(join(f.workspace, "issues", f.storyId, "docs"))).toContain(`/issues/${f.storyId}/docs`);
    } finally {
      if (previousRollHome === undefined) delete process.env["ROLL_HOME"];
      else process.env["ROLL_HOME"] = previousRollHome;
    }
  });

  it("fails before Builder routing, restores Todo and releases the Story lease when a later remote cannot prepare", async () => {
    const f = fixture();
    const previousRollHome = process.env["ROLL_HOME"];
    process.env["ROLL_HOME"] = f.rollHome;
    renameSync(f.remotes[1]!.remotePath, `${f.remotes[1]!.remotePath}.unavailable`);
    try {
      const ports = nodePorts({
        repoCwd: f.workspace,
        paths: f.paths,
        skillBody: "BUILD STORY",
        routeDeps: { readSlot: () => ({ agent: "claude" }), firstInstalled: () => "claude" },
      });
      const result = await executeSetupCommand({ kind: "pick_story" }, ports, {
        cycleId: "cycle-11-failed",
        branch: "loop/cycle-11-failed",
        loop: "main",
      });

      expect(result.event).toEqual({ type: "repository_setup_failed", storyId: f.storyId });
      expect(readFileSync(join(f.workspace, "backlog", "index.md"), "utf8")).toContain("📋 Todo");
      expect(existsSync(f.paths.storyLeasePath!)).toBe(false);
      expect(existsSync(join(f.workspace, "issues", f.storyId))).toBe(false);
      const event = readFileSync(f.paths.eventsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line)).at(-1);
      expect(event).toMatchObject({
        type: "workspace:issue_init_failed",
        workspaceId: "ws-alpha",
        storyId: f.storyId,
        cycleId: "cycle-11-failed",
        code: "apply_failed",
        repairJournal: null,
      });
    } finally {
      if (previousRollHome === undefined) delete process.env["ROLL_HOME"];
      else process.env["ROLL_HOME"] = previousRollHome;
    }
  });
});
