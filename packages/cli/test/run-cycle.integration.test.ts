/**
 * E2E integration test for the v3 loop RUNNER ADAPTER (US-LOOP-006 prerequisite).
 *
 * The crown: a REAL fixture git repo (bare file:// remote + working clone) with a
 * fixture backlog carrying one story, driven end-to-end through {@link
 * runCycleOnce} — pick → route → worktree → execute → publish → terminal — with
 * EVERY execution layer faked so there are NO real network / agent / PR side
 * effects:
 *   - agentSpawn  : a SHIM that fabricates a passing `tcr:` commit IN the cycle
 *                   worktree (no real `claude`), exactly like difftests fabricate
 *                   binaries.
 *   - github      : a FAKE facet returning a canned publish status (the publish
 *                   PLAN is real core output; the gh execution is faked). The
 *                   push targets the LOCAL bare remote (file://), so even the
 *                   git half stays offline.
 *
 * Asserts the runner honours the hard list:
 *   - the lock is RELEASED at the end (next cycle can take over),
 *   - a heartbeat file EXISTED during the run,
 *   - a TERMINAL cycle:end event is present (I8),
 *   - the runs.jsonl row shape matches v2 (keys checked against the dashboard
 *     difftest fixture: run_id/status/agent/built/tcr_count + the bus dedupe
 *     keys story_id/cycle_id),
 *   - the cycle lands `done` (published) / built.
 *
 * Plus a kill-mid-execute test (I2): a watchdog breach during execute → terminal
 * event STILL written, lock released, and a fresh runCycleOnce takes over cleanly.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { RouteDeps } from "@roll/core";
import {
  type AgentSpawn,
  type AgentSpawnResult,
  type Ports,
  type RunnerPaths,
  nodePorts,
  runCycleOnce,
} from "../src/runner/index.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) {
    try {
      execFileSync("rm", ["-rf", d]);
    } catch {
      /* best effort */
    }
  }
});

function tmp(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `roll-runner-${tag}-`));
  dirs.push(d);
  return realpathSync(d);
}

const GIT_ID = ["-c", "user.email=t@t", "-c", "user.name=t"];
function git(cwd: string, args: string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

const BACKLOG = [
  "| ID | Description | Status |",
  "|----|-------------|--------|",
  "| US-RUN-001 | Runner adapter smoke story est_min:5 | 📋 Todo |",
  "",
].join("\n");

/**
 * Build a fixture: a bare remote with `main` (carrying .roll/backlog.md) + a
 * working clone whose `origin` is the bare remote (file://). Returns both paths.
 */
function makeFixture(tag: string): { repo: string; remote: string } {
  const remote = tmp(`${tag}-remote`);
  git(remote, ["init", "-q", "--bare", "-b", "main"]);

  // Seed the remote's main via a throwaway clone.
  const seed = tmp(`${tag}-seed`);
  git(seed, ["clone", "-q", remote, "."]);
  mkdirSync(join(seed, ".roll"), { recursive: true });
  writeFileSync(join(seed, ".roll", "backlog.md"), BACKLOG, "utf8");
  git(seed, [...GIT_ID, "add", "-A"]);
  git(seed, [...GIT_ID, "commit", "-q", "-m", "seed backlog"]);
  git(seed, ["push", "-q", "origin", "main"]);

  // The working clone the runner operates from.
  const repo = tmp(`${tag}-repo`);
  git(repo, ["clone", "-q", remote, "."]);
  git(repo, ["fetch", "-q", "origin"]);
  return { repo, remote };
}

function paths(rt: string, cycleId: string): RunnerPaths {
  return {
    eventsPath: join(rt, "events.ndjson"),
    runsPath: join(rt, "runs.jsonl"),
    alertsPath: join(rt, "alerts.log"),
    lockPath: join(rt, "inner.lock"),
    heartbeatPath: join(rt, "heartbeat"),
    worktreePath: join(rt, "worktrees", `cycle-${cycleId}`),
  };
}

const routeDeps: RouteDeps = {
  readSlot: () => "claude",
  firstInstalled: () => "claude",
};

/** A SHIM agent: makes a passing `tcr:` commit in the worktree, exit 0. */
const shimAgentTcr: AgentSpawn = async (_agent, opts): Promise<AgentSpawnResult> => {
  const wt = opts.cwd;
  writeFileSync(join(wt, "delivered.txt"), "work done by shim agent\n", "utf8");
  git(wt, [...GIT_ID, "add", "-A"]);
  git(wt, [...GIT_ID, "commit", "-q", "--no-verify", "-m", "tcr: deliver US-RUN-001"]);
  return { stdout: "model: claude\ninput: 100\noutput: 50\n", stderr: "", exitCode: 0, timedOut: false };
};

/** A fake github facet that returns a canned publish status without any gh. */
function fakeGithub(status: 0 | 1 | 2): Ports["github"] {
  return {
    async repoSlug() {
      return "fixture/runner";
    },
    async runPublishPlan() {
      return { status, prUrl: status === 0 ? "https://example/pr/1" : "", ok: status === 0 };
    },
    async prState() {
      return "MERGED";
    },
  };
}

/** A fixed clock (epoch seconds) we can advance to drive the watchdog. */
function fixedClock(start: number): { clock: () => number; set: (v: number) => void } {
  let now = start;
  return { clock: () => now, set: (v) => (now = v) };
}

describe("runCycleOnce E2E (fixture repo + shim agent + faked gh)", () => {
  it("drives pick→route→worktree→execute→publish→done, writes events/runs, releases lock", async () => {
    const { repo } = makeFixture("e2e");
    const rt = tmp("e2e-rt");
    const cycleId = "20260605-000000-1234";
    const p = paths(rt, cycleId);

    // Observe heartbeat liveness DURING the run via the agent shim (it runs in
    // the execute phase, after the heartbeat is written). Also capture the
    // worktree's commit log AT execute time (the `done` path cleans the worktree
    // afterward, so we record the tcr commit while the worktree still exists).
    let heartbeatExistedDuringRun = false;
    let tcrLogAtExecute = "";
    const shim: AgentSpawn = async (agent, opts) => {
      heartbeatExistedDuringRun = existsSync(p.heartbeatPath);
      const r = await shimAgentTcr(agent, opts);
      tcrLogAtExecute = git(opts.cwd, ["log", "--oneline"]);
      return r;
    };

    const base = nodePorts({ repoCwd: repo, paths: p, skillBody: "deliver", routeDeps });
    const ports: Ports = { ...base, agentSpawn: shim, github: fakeGithub(0) };

    const result = await runCycleOnce({
      ports,
      ctx: { cycleId, branch: `loop/cycle-${cycleId}`, loop: "ci" as never },
    });

    // Terminal: published → done.
    expect(result.ran).toBe(true);
    expect(result.terminal).toBe("done");

    // Heartbeat existed during the agent run.
    expect(heartbeatExistedDuringRun).toBe(true);

    // Lock released (next cycle can take over).
    expect(existsSync(p.lockPath)).toBe(false);

    // Terminal cycle:end event present (I8).
    const events = readFileSync(p.eventsPath, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as { type: string; outcome?: string });
    const end = events.find((e) => e.type === "cycle:end");
    expect(end).toBeDefined();
    expect(end?.outcome).toBe("delivered");
    expect(events.some((e) => e.type === "cycle:start")).toBe(true);

    // runs.jsonl row shape matches v2 (keys verified vs dashboard difftest).
    const runs = readFileSync(p.runsPath, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(runs.length).toBe(1);
    const row = runs[0] as Record<string, unknown>;
    for (const key of ["run_id", "status", "agent", "built", "tcr_count", "story_id", "cycle_id"]) {
      expect(Object.keys(row)).toContain(key);
    }
    expect(row["status"]).toBe("done");
    expect(row["agent"]).toBe("claude");
    expect(row["cycle_id"]).toBe(cycleId);
    expect(row["story_id"]).toBe("US-RUN-001");
    expect(row["built"]).toEqual(["US-RUN-001"]);

    // The shim's tcr commit really landed in the worktree (captured at execute
    // time; the worktree is cleaned by the `done` terminal path afterward).
    expect(tcrLogAtExecute).toContain("tcr: deliver US-RUN-001");
    expect(existsSync(p.worktreePath)).toBe(false);
  });

  it("kill-mid-execute (watchdog breach): terminal still written, lock released, next cycle takes over (I2)", async () => {
    const { repo } = makeFixture("kill");
    const rt = tmp("kill-rt");
    const cycleId = "20260605-111111-2222";
    const p = paths(rt, cycleId);
    const fc = fixedClock(1_000_000);

    // Agent shim that "hangs": it advances the clock PAST the timeout so the
    // watchdog breaches on the NEXT step (simulating a SIGKILL mid-execute —
    // the cycle never gets a clean agent_exited).
    const hangingAgent: AgentSpawn = async (agent, opts) => {
      fc.set(1_000_000 + 4000); // > CYCLE_TIMEOUT_SEC (2700)
      return shimAgentTcr(agent, opts);
    };

    const base = nodePorts({
      repoCwd: repo,
      paths: p,
      skillBody: "deliver",
      routeDeps,
      clock: fc.clock,
    });
    const ports: Ports = { ...base, agentSpawn: hangingAgent, github: fakeGithub(0) };

    const result = await runCycleOnce({
      ports,
      ctx: { cycleId, branch: `loop/cycle-${cycleId}`, loop: "ci" as never },
      timeoutSec: 2700,
    });

    expect(result.ran).toBe(true);
    // The watchdog breach short-circuits to a blocked terminal.
    expect(result.terminal).toBe("blocked");

    // Terminal event STILL written (I8) even on the abort path.
    const events = readFileSync(p.eventsPath, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as { type: string; outcome?: string });
    const end = events.find((e) => e.type === "cycle:end");
    expect(end).toBeDefined();
    expect(end?.outcome).toBe("blocked");

    // Lock released despite the abort.
    expect(existsSync(p.lockPath)).toBe(false);

    // A FRESH runCycleOnce takes over cleanly (lock free, new terminal).
    const cycleId2 = "20260605-222222-3333";
    const p2 = paths(rt, cycleId2);
    const fc2 = fixedClock(2_000_000);
    const base2 = nodePorts({
      repoCwd: repo,
      paths: p2,
      skillBody: "deliver",
      routeDeps,
      clock: fc2.clock,
    });
    const ports2: Ports = { ...base2, agentSpawn: shimAgentTcr, github: fakeGithub(0) };
    const result2 = await runCycleOnce({
      ports: ports2,
      ctx: { cycleId: cycleId2, branch: `loop/cycle-${cycleId2}`, loop: "ci" as never },
    });
    expect(result2.ran).toBe(true);
    expect(result2.terminal).toBe("done");
  });

  it("lock contention: a second concurrent cycle is skipped (ran=false)", async () => {
    const { repo } = makeFixture("lock");
    const rt = tmp("lock-rt");
    const cycleId = "20260605-333333-4444";
    const p = paths(rt, cycleId);

    // Pre-take the lock with THIS live pid so isLockHeld sees it as held.
    mkdirSync(rt, { recursive: true });
    writeFileSync(p.lockPath, `${process.pid}:${Math.floor(Date.now() / 1000)}\n`, "utf8");

    const base = nodePorts({ repoCwd: repo, paths: p, skillBody: "deliver", routeDeps });
    const ports: Ports = { ...base, agentSpawn: shimAgentTcr, github: fakeGithub(0) };
    const result = await runCycleOnce({
      ports,
      ctx: { cycleId, branch: `loop/cycle-${cycleId}`, loop: "ci" as never },
    });
    expect(result.ran).toBe(false);
    expect(result.heldByPid).toBe(process.pid);
  });

  it("no-story backlog → idle terminal, worktree cleaned, lock released", async () => {
    const remote = tmp("idle-remote");
    git(remote, ["init", "-q", "--bare", "-b", "main"]);
    const seed = tmp("idle-seed");
    git(seed, ["clone", "-q", remote, "."]);
    mkdirSync(join(seed, ".roll"), { recursive: true });
    // Backlog with the one story already Done → nothing pickable.
    writeFileSync(
      join(seed, ".roll", "backlog.md"),
      "| ID | Description | Status |\n|--|--|--|\n| US-RUN-001 | done already | ✅ Done |\n",
      "utf8",
    );
    git(seed, [...GIT_ID, "add", "-A"]);
    git(seed, [...GIT_ID, "commit", "-q", "-m", "seed"]);
    git(seed, ["push", "-q", "origin", "main"]);
    const repo = tmp("idle-repo");
    git(repo, ["clone", "-q", remote, "."]);
    git(repo, ["fetch", "-q", "origin"]);

    const rt = tmp("idle-rt");
    const cycleId = "20260605-444444-5555";
    const p = paths(rt, cycleId);
    const base = nodePorts({ repoCwd: repo, paths: p, skillBody: "deliver", routeDeps });
    const ports: Ports = { ...base, agentSpawn: shimAgentTcr, github: fakeGithub(0) };

    const result = await runCycleOnce({
      ports,
      ctx: { cycleId, branch: `loop/cycle-${cycleId}`, loop: "ci" as never },
    });
    // idle folds to the `built` spec outcome but the v2 terminal status is idle.
    expect(result.terminal).toBe("idle");
    expect(existsSync(p.lockPath)).toBe(false);
    const events = readFileSync(p.eventsPath, "utf8");
    expect(events).toContain('"cycle:end"');
  });
});

/**
 * FIX-198 — the OWNER-OBSERVED scenario, end to end on the ORDINARY project
 * layout (`.roll/` GITIGNORED, never checked out into worktrees):
 *   1. pick must read the MAIN checkout's backlog (a worktree read sees no
 *      .roll at all and idles forever),
 *   2. 🔨 In Progress must land on the MAIN backlog the moment the story is
 *      claimed (anti duplicate-pick, visible to `roll backlog`/brief),
 *   3. ✅ Done must land deterministically at the done terminal — never an
 *      agent-discipline hope (the "嘴上 Done" lesson),
 *   4. a dead claim left by a killed cycle is recycled to 📋 Todo at the next
 *      cycle's preflight (the inner lock guarantees single-flight).
 */
function makeGitignoredFixture(tag: string): { repo: string } {
  const remote = tmp(`${tag}-remote`);
  git(remote, ["init", "-q", "--bare", "-b", "main"]);
  const seed = tmp(`${tag}-seed`);
  git(seed, ["clone", "-q", remote, "."]);
  writeFileSync(join(seed, ".gitignore"), ".roll/\n", "utf8");
  writeFileSync(join(seed, "app.txt"), "app\n", "utf8");
  git(seed, [...GIT_ID, "add", "-A"]);
  git(seed, [...GIT_ID, "commit", "-q", "-m", "seed app (.roll gitignored)"]);
  git(seed, ["push", "-q", "origin", "main"]);
  const repo = tmp(`${tag}-repo`);
  git(repo, ["clone", "-q", remote, "."]);
  // .roll exists ONLY in the main checkout — exactly the SoloGo layout.
  mkdirSync(join(repo, ".roll"), { recursive: true });
  writeFileSync(join(repo, ".roll", "backlog.md"), BACKLOG, "utf8");
  return { repo };
}

/**
 * FIX-206 — the PARTIAL-fossil layout. `.roll/` is gitignored, yet a few stray
 * paths were force-committed before the ignore rule landed (the roll-meta
 * migration leak: `.roll/ops/release.sh` et al.). `git worktree add` checks
 * those fossils out, materializing a REAL `.roll/ops/` dir that shadows the
 * gitignored, main-only backlog the loop must read — the link guard saw `dst`
 * exist and skipped, so the worktree never saw the backlog (production blind
 * spot of FIX-204C, observed on the first v3 cycle).
 */
function makePartialFossilFixture(tag: string): { repo: string } {
  const remote = tmp(`${tag}-remote`);
  git(remote, ["init", "-q", "--bare", "-b", "main"]);
  const seed = tmp(`${tag}-seed`);
  git(seed, ["clone", "-q", remote, "."]);
  writeFileSync(join(seed, ".gitignore"), ".roll/\n", "utf8");
  writeFileSync(join(seed, "app.txt"), "app\n", "utf8");
  // The fossil: force-added past the ignore rule, exactly like the leaked
  // `.roll/ops/release.sh` the real repo still tracked.
  mkdirSync(join(seed, ".roll", "ops"), { recursive: true });
  writeFileSync(join(seed, ".roll", "ops", "release.sh"), "#!/bin/sh\n", "utf8");
  git(seed, [...GIT_ID, "add", "app.txt", ".gitignore"]);
  git(seed, [...GIT_ID, "add", "-f", ".roll/ops/release.sh"]);
  git(seed, [...GIT_ID, "commit", "-q", "-m", "seed app + fossil .roll/ops/release.sh"]);
  git(seed, ["push", "-q", "origin", "main"]);
  const repo = tmp(`${tag}-repo`);
  git(repo, ["clone", "-q", remote, "."]);
  // The real backlog lives ONLY in the main checkout (gitignored, main-only) —
  // alongside the checked-out fossil. The worktree will materialize the fossil
  // but never this backlog.
  writeFileSync(join(repo, ".roll", "backlog.md"), BACKLOG, "utf8");
  return { repo };
}

describe("FIX-206 — a partial-fossil .roll is relinked so the backlog is visible", () => {
  it("replaces the fossil dir with the symlink; agent reads the main-only backlog", async () => {
    const { repo } = makePartialFossilFixture("fossil");
    const rt = tmp("fossil-rt");
    const cycleId = "20260606-032000-3203";
    const p = paths(rt, cycleId);
    let isLink: boolean | null = null;
    let backlogViaWorktree = "";
    const shim: AgentSpawn = async (agent, opts) => {
      isLink = lstatSync(join(opts.cwd, ".roll"), { throwIfNoEntry: false })?.isSymbolicLink() === true;
      backlogViaWorktree = existsSync(join(opts.cwd, ".roll", "backlog.md"))
        ? readFileSync(join(opts.cwd, ".roll", "backlog.md"), "utf8")
        : "";
      return shimAgentTcr(agent, opts);
    };
    const base = nodePorts({ repoCwd: repo, paths: p, skillBody: "deliver", routeDeps });
    const ports: Ports = { ...base, agentSpawn: shim, github: fakeGithub(0) };
    const result = await runCycleOnce({
      ports,
      ctx: { cycleId, branch: `loop/cycle-${cycleId}`, loop: "ci" as never },
    });

    expect(result.terminal).toBe("done");
    // Before the fix: the materialized fossil dir blocked the link (real dir,
    // backlog shadowed). After: the guard replaces it with the link.
    expect(isLink).toBe(true);
    expect(backlogViaWorktree).toContain("US-RUN-001");
    // MAIN .roll untouched — the fossil's contents survive at the source.
    expect(readFileSync(join(repo, ".roll", "ops", "release.sh"), "utf8")).toContain("#!/bin/sh");
  });
});

describe("FIX-198 status flips on the gitignored-.roll layout", () => {

  it("pick from main · In-Progress mid-cycle · Done at terminal", async () => {
    const { repo } = makeGitignoredFixture("ord");
    const rt = tmp("ord-rt");
    const cycleId = "20260606-000000-2001";
    const p = paths(rt, cycleId);
    const backlogPath = join(repo, ".roll", "backlog.md");

    let inProgressDuringRun = "";
    let worktreeRollIsLink: boolean | null = null;
    const shim: AgentSpawn = async (agent, opts) => {
      inProgressDuringRun = readFileSync(backlogPath, "utf8");
      // FIX-204C: the worktree now SEES .roll — as a symlink to the main one.
      worktreeRollIsLink = lstatSync(join(opts.cwd, ".roll"), { throwIfNoEntry: false })?.isSymbolicLink() === true;
      return shimAgentTcr(agent, opts);
    };

    const base = nodePorts({ repoCwd: repo, paths: p, skillBody: "deliver", routeDeps });
    const ports: Ports = { ...base, agentSpawn: shim, github: fakeGithub(0) };
    const result = await runCycleOnce({
      ports,
      ctx: { cycleId, branch: `loop/cycle-${cycleId}`, loop: "ci" as never },
    });

    expect(result.terminal).toBe("done");
    expect(worktreeRollIsLink).toBe(true); // FIX-204C: linked, not checked out
    expect(inProgressDuringRun).toContain("🔨 In Progress"); // claimed on MAIN, mid-cycle
    expect(readFileSync(backlogPath, "utf8")).toContain("✅ Done"); // flipped at terminal
    expect(readFileSync(backlogPath, "utf8")).not.toContain("🔨 In Progress");
  });

  it("dead claim (🔨 left by a killed cycle) is recycled at the next preflight", async () => {
    const { repo } = makeGitignoredFixture("orphan");
    const backlogPath = join(repo, ".roll", "backlog.md");
    writeFileSync(backlogPath, readFileSync(backlogPath, "utf8").replace("📋 Todo", "🔨 In Progress"), "utf8");

    const rt = tmp("orphan-rt");
    const cycleId = "20260606-000000-2002";
    const p = paths(rt, cycleId);
    const base = nodePorts({ repoCwd: repo, paths: p, skillBody: "deliver", routeDeps });
    const ports: Ports = { ...base, agentSpawn: shimAgentTcr, github: fakeGithub(0) };
    const result = await runCycleOnce({
      ports,
      ctx: { cycleId, branch: `loop/cycle-${cycleId}`, loop: "ci" as never },
    });

    expect(result.terminal).toBe("done"); // recycled → re-picked → delivered
    expect(readFileSync(backlogPath, "utf8")).toContain("✅ Done");
  });
});

describe("US-PORT-011 — live.log streams the agent transcript", () => {
  it("happy path leaves the shim output in .roll-side live.log (header + chunks)", async () => {
    const { repo } = makeFixture("live");
    const rt = tmp("live-rt");
    const cycleId = "20260606-030000-3001";
    const p = paths(rt, cycleId);
    // The shim honours the real-spawn contract: feed stdout through onChunk.
    const streamingShim: AgentSpawn = async (agent, opts) => {
      const r = await shimAgentTcr(agent, opts);
      opts.onChunk?.(Buffer.from(r.stdout));
      return r;
    };
    const base = nodePorts({ repoCwd: repo, paths: p, skillBody: "deliver", routeDeps });
    const ports: Ports = { ...base, agentSpawn: streamingShim, github: fakeGithub(0) };
    const result = await runCycleOnce({ ports, ctx: { cycleId, branch: `loop/cycle-${cycleId}`, loop: "ci" as never } });
    expect(result.terminal).toBe("done");
    const live = readFileSync(join(rt, "live.log"), "utf8");
    expect(live).toContain(`── cycle ${cycleId}`);
    expect(live).toContain("model: claude"); // shim stdout chunk streamed through
  });
});

describe("FIX-204B — the executor pins the picked story into the agent spawn", () => {
  it("agentSpawn receives storyId === the story pick_story claimed", async () => {
    const { repo } = makeFixture("pin");
    const rt = tmp("pin-rt");
    const cycleId = "20260606-031500-3101";
    const p = paths(rt, cycleId);
    let seenStoryId: string | undefined;
    const pinProbe: AgentSpawn = async (agent, opts) => {
      seenStoryId = opts.storyId;
      return shimAgentTcr(agent, opts);
    };
    const base = nodePorts({ repoCwd: repo, paths: p, skillBody: "deliver", routeDeps });
    const ports: Ports = { ...base, agentSpawn: pinProbe, github: fakeGithub(0) };
    const result = await runCycleOnce({
      ports,
      ctx: { cycleId, branch: `loop/cycle-${cycleId}`, loop: "ci" as never },
    });
    expect(result.terminal).toBe("done");
    expect(seenStoryId).toBe("US-RUN-001");
  });
});

describe("FIX-204C — worktree sees the main .roll via symlink", () => {
  it("links on create, agent reads backlog through it, commit stays clean, cleanup spares the target", async () => {
    const { repo } = makeGitignoredFixture("link");
    const rt = tmp("link-rt");
    const cycleId = "20260606-032000-3201";
    const p = paths(rt, cycleId);

    let linkTarget = "";
    let backlogViaWorktree = "";
    let wtStatus = "";
    let committed = "";
    const shim: AgentSpawn = async (agent, opts) => {
      linkTarget = readlinkSync(join(opts.cwd, ".roll"));
      backlogViaWorktree = readFileSync(join(opts.cwd, ".roll", "backlog.md"), "utf8");
      const r = await shimAgentTcr(agent, opts);
      // AFTER the shim's `git add -A` + commit: the symlink must NOT be tracked
      // (info/exclude guard — `.gitignore`'s dir-only `.roll/` misses links).
      wtStatus = git(opts.cwd, ["status", "--porcelain"]);
      committed = git(opts.cwd, ["show", "--name-only", "--format=", "HEAD"]);
      return r;
    };

    const base = nodePorts({ repoCwd: repo, paths: p, skillBody: "deliver", routeDeps });
    const ports: Ports = { ...base, agentSpawn: shim, github: fakeGithub(0) };
    const result = await runCycleOnce({
      ports,
      ctx: { cycleId, branch: `loop/cycle-${cycleId}`, loop: "ci" as never },
    });

    expect(result.terminal).toBe("done");
    expect(linkTarget).toBe(join(repo, ".roll"));
    expect(backlogViaWorktree).toContain("US-RUN-001");
    expect(wtStatus).not.toContain(".roll");
    // the delivered commit carries the work, never the link
    expect(committed).toContain("delivered.txt");
    expect(committed).not.toContain(".roll");
    // cleanup: worktree gone, MAIN .roll intact (the LINK died, not the target)
    expect(existsSync(p.worktreePath)).toBe(false);
    expect(readFileSync(join(repo, ".roll", "backlog.md"), "utf8")).toContain("✅ Done");
  });

  it("a project that TRACKS .roll keeps its real checked-out dir (no link, no exclude line)", async () => {
    const { repo } = makeFixture("tracked");
    const rt = tmp("tracked-rt");
    const cycleId = "20260606-032000-3202";
    const p = paths(rt, cycleId);
    let isLink: boolean | null = null;
    const shim: AgentSpawn = async (agent, opts) => {
      isLink = lstatSync(join(opts.cwd, ".roll")).isSymbolicLink();
      return shimAgentTcr(agent, opts);
    };
    const base = nodePorts({ repoCwd: repo, paths: p, skillBody: "deliver", routeDeps });
    const ports: Ports = { ...base, agentSpawn: shim, github: fakeGithub(0) };
    const result = await runCycleOnce({
      ports,
      ctx: { cycleId, branch: `loop/cycle-${cycleId}`, loop: "ci" as never },
    });
    expect(result.terminal).toBe("done");
    expect(isLink).toBe(false);
    expect(existsSync(join(repo, ".git", "info", "exclude")) ? readFileSync(join(repo, ".git", "info", "exclude"), "utf8") : "").not.toMatch(/^\.roll$/m);
  });
});
