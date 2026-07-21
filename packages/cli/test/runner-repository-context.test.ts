import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  repositoryIdFromRemote,
  type CycleRepositoryExecutionContext,
  type RepositoryExecutionContext,
} from "@roll/spec";
import { cycleStep, initialCycleState, type RouteDeps } from "@roll/core";
import {
  REPOSITORY_CONTEXT_MAX_CHARS,
  buildRepositoryContextMap,
} from "../src/runner/project-map.js";
import {
  nodePorts,
  type RunnerPaths,
} from "../src/runner/index.js";
import type { AgentSpawn } from "../src/runner/agent-spawn.js";
import type { RepositoryPortAdapters } from "../src/runner/ports.js";

function repository(
  repoId: string,
  alias: string,
  access: "read" | "write",
): RepositoryExecutionContext {
  return {
    repoId,
    alias,
    access,
    requiredDelivery: access === "write",
    worktreePath: `/workspace/issues/US-WS-010/${alias}`,
    baseSha: `${alias}-base`,
    headSha: `${alias}-head`,
    commands: {
      test: [`pnpm --dir ${alias} test`],
      integration: [`pnpm --dir ${alias} test:integration`],
    },
  };
}

const writable = repository("repo-111111111111", "sot1", "write");
const readonly = repository("repo-222222222222", "reference", "read");
const execution: CycleRepositoryExecutionContext = {
  workspaceId: "ws-20260717001",
  issueRoot: "/workspace/issues/US-WS-010",
  repositories: {
    [writable.repoId]: writable,
    [readonly.repoId]: readonly,
  },
};

const paths: RunnerPaths = {
  eventsPath: "/runtime/events.ndjson",
  runsPath: "/runtime/runs.jsonl",
  alertsPath: "/runtime/alerts.log",
  lockPath: "/runtime/lock",
  heartbeatPath: "/runtime/heartbeat",
  worktreePath: "/legacy/single-repo-worktree",
};
const routeDeps: RouteDeps = {
  readSlot: () => ({ agent: "claude" }),
  firstInstalled: () => "claude",
};

function fakeSpawn(): AgentSpawn {
  const spawn: AgentSpawn = vi.fn(async () => ({
    stdout: "",
    stderr: "",
    exitCode: 0,
    timedOut: false,
  }));
  spawn.supportedPurposes = ["builder", "test_author", "implementer", "attacker"];
  return spawn;
}

function productionWorkspaceFixture(): { root: string; storyId: string; repoId: string; headSha: string } {
  const root = mkdtempSync(join(tmpdir(), "roll-us-ws-010-context-"));
  const storyId = "US-WS-010";
  const remote = "https://github.com/example/sot1.git";
  const parsedRepoId = repositoryIdFromRemote(remote);
  if (!parsedRepoId.ok) throw new Error("fixture remote must be canonicalizable");
  const repoId = parsedRepoId.value;
  const issueRoot = join(root, "issues", storyId);
  const worktreePath = join(issueRoot, "sot1");
  mkdirSync(worktreePath, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: worktreePath });
  execFileSync("git", ["config", "user.name", "Roll Test"], { cwd: worktreePath });
  execFileSync("git", ["config", "user.email", "roll-test@example.invalid"], { cwd: worktreePath });
  writeFileSync(join(worktreePath, "README.md"), "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: worktreePath });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: worktreePath });
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktreePath, encoding: "utf8" }).trim();
  writeFileSync(join(root, "workspace.yaml"), `${JSON.stringify({
    schema: "roll.workspace/v1",
    workspaceId: "ws-20260717001",
    displayName: "US-WS-010 fixture",
    requirements: [],
    repositories: [{
      schema: "roll.repository-binding/v1",
      repoId,
      alias: "sot1",
      remote,
      integrationBranch: "main",
      provider: "github",
      workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: [] },
    }],
  }, null, 2)}\n`);
  writeFileSync(join(issueRoot, "manifest.json"), `${JSON.stringify({
    schema: "roll.issue/v1",
    workspaceId: "ws-20260717001",
    storyId,
    requirements: [],
    repositories: [{
      repoId,
      alias: "sot1",
      access: "write",
      requiredDelivery: true,
      noChangePolicy: "changes_required",
    }],
  }, null, 2)}\n`);
  writeFileSync(join(issueRoot, "events.jsonl"), `${JSON.stringify({
    type: "issue:repository_bound",
    workspaceId: "ws-20260717001",
    storyId,
    alias: "sot1",
    repoId,
    access: "write",
    baseSha: headSha,
    worktreePath,
    workBranch: "story/US-WS-010",
    ts: 1,
  })}\n`);
  return { root, storyId, repoId, headSha };
}

describe("US-WS-010 repository Builder context", () => {
  it("resolves the production Workspace Issue only after the Story identity is known", async () => {
    const fixture = productionWorkspaceFixture();
    const fixturePaths: RunnerPaths = {
      eventsPath: join(fixture.root, "runtime", "events.ndjson"),
      runsPath: join(fixture.root, "runtime", "runs.jsonl"),
      alertsPath: join(fixture.root, "runtime", "alerts.log"),
      lockPath: join(fixture.root, "runtime", "lock"),
      heartbeatPath: join(fixture.root, "runtime", "heartbeat"),
      worktreePath: join(fixture.root, "legacy-worktree"),
    };
    const ports = nodePorts({
      repoCwd: fixture.root,
      paths: fixturePaths,
      skillBody: "BUILD STORY",
      routeDeps,
      agentSpawn: fakeSpawn(),
    });

    const resolved = await ports.repositoryContext?.resolve(fixture.storyId);

    expect(resolved).toMatchObject({
      workspaceId: "ws-20260717001",
      issueRoot: realpathSync(join(fixture.root, "issues", fixture.storyId)),
      repositories: {
        [fixture.repoId]: {
          repoId: fixture.repoId,
          alias: "sot1",
          access: "write",
          baseSha: fixture.headSha,
          headSha: fixture.headSha,
          commands: { test: [], integration: [] },
        },
      },
    });
    const start = initialCycleState({ cycleId: "cycle-fixture", branch: "cycle-fixture", loop: "ci" });
    const ready = { ...start, phase: "pick" as const, worktreeReady: true };
    const stepped = cycleStep(ready, {
      type: "story_picked",
      storyId: fixture.storyId,
      repositoryExecution: resolved,
    });
    expect(stepped.state.ctx.repositoryExecution).toEqual(resolved);
  });

  it("renders one bounded prompt map with access, worktree and verification commands", () => {
    const rendered = buildRepositoryContextMap(execution);

    expect(rendered.length).toBeLessThanOrEqual(REPOSITORY_CONTEXT_MAX_CHARS);
    expect(rendered).toContain("ws-20260717001");
    expect(rendered).toContain("/workspace/issues/US-WS-010");
    expect(rendered).toContain('"repoId": "repo-111111111111"');
    expect(rendered).toContain('"access": "read"');
    expect(rendered).toContain("pnpm --dir sot1 test");
    expect(rendered).toContain("pnpm --dir reference test:integration");
    expect(rendered).toContain("read-only repositories are context-only");
  });

  it("fails loud instead of truncating an oversized repository contract", () => {
    const oversized: CycleRepositoryExecutionContext = {
      ...execution,
      repositories: {
        [writable.repoId]: {
          ...writable,
          commands: { test: ["x".repeat(REPOSITORY_CONTEXT_MAX_CHARS)], integration: [] },
        },
      },
    };

    expect(() => buildRepositoryContextMap(oversized)).toThrow("repository_context_too_large");
  });

  it("runs the Builder at the Issue root and injects the repository map without spawning an external engine", async () => {
    const spawn = fakeSpawn();
    const ports = nodePorts({
      repoCwd: "/project",
      paths,
      skillBody: "BUILD STORY",
      routeDeps,
      agentSpawn: spawn,
      repositoryExecution: execution,
    });

    await ports.agentSpawn("claude", {
      purpose: "builder",
      cwd: paths.worktreePath,
      skillBody: "BUILD STORY",
    });

    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledWith(
      "claude",
      expect.objectContaining({
        cwd: execution.issueRoot,
        skillBody: expect.stringContaining("repo-111111111111"),
      }),
    );
    expect(ports.agentSpawn.supportedPurposes).toEqual(spawn.supportedPurposes);
  });

  it("binds Git/provider adapters by repoId and rejects read-only publish before the adapter runs", async () => {
    const commitsAhead = vi.fn(async (_repository: RepositoryExecutionContext) => 2);
    const push = vi.fn(async (_repository: RepositoryExecutionContext, _branch: string) => ({ code: 0 }));
    const repoSlug = vi.fn(async (_repository: RepositoryExecutionContext) => "owner/sot1");
    const adapters: RepositoryPortAdapters = {
      git: {
        commitsAhead,
        tcrCount: vi.fn(async () => 1),
        recentCommits: vi.fn(async () => []),
        push,
      },
      provider: {
        repoSlug,
        prState: vi.fn(async () => "OPEN"),
        prMergeInfo: vi.fn(async () => undefined),
      },
    };
    const ports = nodePorts({
      repoCwd: "/project",
      paths,
      skillBody: "BUILD STORY",
      routeDeps,
      agentSpawn: fakeSpawn(),
      repositoryExecution: execution,
      repositoryAdapters: adapters,
    });

    expect(await ports.repositories?.git.commitsAhead(writable.repoId)).toBe(2);
    expect(commitsAhead).toHaveBeenCalledWith(writable, undefined);
    expect(await ports.repositories?.provider.repoSlug(writable.repoId)).toBe("owner/sot1");
    expect(repoSlug).toHaveBeenCalledWith(writable);
    await expect(ports.repositories?.git.push(readonly.repoId, "story-branch")).rejects.toThrow(
      "read_only_repository",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("preserves the current one-repository spawn contract when no Workspace context is supplied", async () => {
    const spawn = fakeSpawn();
    const ports = nodePorts({
      repoCwd: "/project",
      paths,
      skillBody: "BUILD STORY",
      routeDeps,
      agentSpawn: spawn,
    });

    await ports.agentSpawn("claude", {
      purpose: "builder",
      cwd: paths.worktreePath,
      skillBody: "BUILD STORY",
    });

    expect(spawn).toHaveBeenCalledWith("claude", {
      purpose: "builder",
      cwd: paths.worktreePath,
      skillBody: "BUILD STORY",
    });
    expect(ports.repositories).toBeUndefined();
  });

  it("does not rewrite non-Builder agent calls", async () => {
    const spawn = fakeSpawn();
    const ports = nodePorts({
      repoCwd: "/project",
      paths,
      skillBody: "REVIEW",
      routeDeps,
      agentSpawn: spawn,
      repositoryExecution: execution,
    });

    await ports.agentSpawn("claude", {
      purpose: "pick_ranking",
      cwd: "/ranking-cwd",
      skillBody: "RANK",
    });

    expect(spawn).toHaveBeenCalledWith("claude", {
      purpose: "pick_ranking",
      cwd: "/ranking-cwd",
      skillBody: "RANK",
    });
  });
});
