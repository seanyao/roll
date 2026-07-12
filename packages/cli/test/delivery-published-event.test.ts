/**
 * US-DELIV-001 — delivery:published event emission tests (terminal executor).
 *
 * AC2 (goal 2): a successful publish appends `delivery:published` — the fact
 * that moves the cycle into awaiting_merge and releases the loop (no
 * merge-wait). A failed publish appends nothing: no awaiting_merge without a PR.
 */
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CycleContext } from "@roll/core";
import type { RollEvent } from "@roll/spec";
import type { Ports } from "../src/runner/ports.js";
import { executeCommand } from "../src/runner/executor.js";

function makeCtx(): CycleContext {
  return {
    cycleId: "20260712-000000-1",
    branch: "loop/cycle-20260712-000000-1",
    loop: "ci" as never,
    storyId: "US-DELIV-001",
    agent: "claude",
    model: "",
    startSec: 1,
    cost: { cycleId: "20260712-000000-1", agent: "claude", model: "", tokensIn: 0, tokensOut: 0, estimatedCost: 0, revertCount: 0, effectiveCost: 0 },
  } as CycleContext;
}

function git(cwd: string, ...args: string[]): void {
  const env = { ...process.env };
  delete env["GIT_DIR"];
  delete env["GIT_WORK_TREE"];
  execFileSync("git", args, { cwd, env });
}

function initRepoWithEvidence(): { root: string; runtimeDir: string } {
  const root = mkdtempSync(join(tmpdir(), "roll-deliv-pub-"));
  const cardDir = join(root, ".roll", "features", "delivery-reconciler", "US-DELIV-001");
  const runDir = join(cardDir, "20260712-000000-1");
  mkdirSync(join(runDir, "latest"), { recursive: true });
  writeFileSync(join(cardDir, "ac-map.json"), "[]\n");
  writeFileSync(join(runDir, "latest", "evidence.json"), "{}\n");

  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "roll-test@example.test");
  git(root, "config", "user.name", "Roll Test");
  git(root, "config", "core.hooksPath", "");
  writeFileSync(join(root, "README.md"), "# test\n");
  git(root, "add", "-A");
  git(root, "commit", "-m", "init");

  return { root, runtimeDir: join(root, ".roll", "loop") };
}

function makePorts(runtimeDir: string, repoCwd: string, publishPlan: () => Promise<{ status: 0 | 1; prUrl: string; ok: boolean }>): { ports: Ports; events: RollEvent[] } {
  mkdirSync(runtimeDir, { recursive: true });
  const events: RollEvent[] = [];
  const ports = {
    repoCwd,
    paths: {
      eventsPath: join(runtimeDir, "events.ndjson"),
      runsPath: join(runtimeDir, "runs.jsonl"),
      alertsPath: join(runtimeDir, "ALERT.md"),
      lockPath: join(runtimeDir, "inner.lock"),
      heartbeatPath: join(runtimeDir, "heartbeat"),
      worktreePath: join(repoCwd, "wt"),
    },
    clock: () => 42,
    skillBody: "work",
    github: {
      repoSlug: vi.fn(async () => "o/r"),
      runPublishPlan: vi.fn(publishPlan),
      prState: vi.fn(async () => "UNKNOWN"),
      prMergeInfo: vi.fn(async () => undefined),
      openPrTitles: vi.fn(async () => []),
    },
    git: {
      fetchOrigin: vi.fn(async () => ({ fetched: true })),
      worktreeAdd: vi.fn(async () => ({ code: 0 })),
      worktreeSubmoduleInit: vi.fn(async () => ({ code: 0 })),
      worktreeRemove: vi.fn(async () => ({ code: 0 })),
      push: vi.fn(async () => ({ code: 0 })),
      commitsAhead: vi.fn(async () => 1),
      mainAhead: vi.fn(async () => 0),
      rescueLeaked: vi.fn(async () => ({ code: 0, rescuedSha: "" })),
      tcrCount: vi.fn(async () => 0),
      recentCommits: vi.fn(async () => []),
      fetchRemoteBranch: vi.fn(async () => ({ fetched: true })),
      branchMergedIntoMain: vi.fn(async () => false),
      branchCleanlyRebasesOntoMain: vi.fn(async () => true),
      resetWorktreeHard: vi.fn(async () => ({ code: 0 })),
    },
    events: {
      ensureEventFiles: vi.fn(),
      appendEvent: vi.fn((_path: string, ev: RollEvent) => events.push(ev)),
      upsertRun: vi.fn(),
      appendAlert: vi.fn(),
    },
    process: {
      acquireLock: vi.fn(() => ({ acquired: true, heldByPid: undefined })),
      releaseLock: vi.fn(),
      writeHeartbeat: vi.fn(),
    },
    backlog: { read: vi.fn(() => []) },
    metadata: {
      commit: vi.fn(async () => ({ committed: false, pushed: false, nothingToCommit: true })),
    },
    route: { resolve: vi.fn(() => ({ agent: "claude", model: "" })) },
    evidence: { openFrame: vi.fn(() => join(repoCwd, ".roll", "features", "delivery-reconciler", "US-DELIV-001", "20260712-000000-1")) },
    capture: { fromMarker: vi.fn(async () => ({ kind: "web", out: "", taken: false })) },
    attest: { render: vi.fn(async () => 0) },
    agentSpawn: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false })),
    installedAgents: () => [],
  } as unknown as Ports;
  return { ports, events };
}

async function withCleanGitEnv<T>(fn: () => Promise<T>): Promise<T> {
  const oldGitDir = process.env["GIT_DIR"];
  const oldGitWorkTree = process.env["GIT_WORK_TREE"];
  delete process.env["GIT_DIR"];
  delete process.env["GIT_WORK_TREE"];
  try {
    return await fn();
  } finally {
    if (oldGitDir === undefined) delete process.env["GIT_DIR"];
    else process.env["GIT_DIR"] = oldGitDir;
    if (oldGitWorkTree === undefined) delete process.env["GIT_WORK_TREE"];
    else process.env["GIT_WORK_TREE"] = oldGitWorkTree;
  }
}

describe("US-DELIV-001 — delivery:published emission", () => {
  it("successful publish appends delivery:published{prNumber,prUrl} (→ awaiting_merge)", async () => {
    const { root, runtimeDir } = initRepoWithEvidence();
    try {
      await withCleanGitEnv(async () => {
        const { ports, events } = makePorts(runtimeDir, root, async () => ({ status: 0 as const, prUrl: "https://github.com/o/r/pull/42", ok: true }));
        const r = await executeCommand({ kind: "publish_pr", branch: "loop/cycle-20260712-000000-1", docOnly: false }, ports, makeCtx());
        expect(r.event).toMatchObject({ type: "published", result: { status: 0 } });

        const published = events.filter((e) => e.type === "delivery:published");
        expect(published).toHaveLength(1);
        expect(published[0]).toMatchObject({
          type: "delivery:published",
          cycleId: "20260712-000000-1",
          storyId: "US-DELIV-001",
          branch: "loop/cycle-20260712-000000-1",
          prNumber: 42,
          prUrl: "https://github.com/o/r/pull/42",
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("failed publish appends NO delivery:published (no awaiting_merge without a PR)", async () => {
    const { root, runtimeDir } = initRepoWithEvidence();
    try {
      await withCleanGitEnv(async () => {
        const { ports, events } = makePorts(runtimeDir, root, async () => ({ status: 1 as const, prUrl: "", ok: false }));
        const r = await executeCommand({ kind: "publish_pr", branch: "loop/cycle-20260712-000000-1", docOnly: false }, ports, makeCtx());
        expect(r.event).toMatchObject({ type: "published", result: { status: 1 } });
        expect(events.filter((e) => e.type === "delivery:published")).toHaveLength(0);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
