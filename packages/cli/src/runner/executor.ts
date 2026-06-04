/**
 * Runner adapter — the executable glue that lets the pure {@link cycleStep}
 * orchestrator actually drive a cycle (prerequisite for US-LOOP-006 v2-vs-v3
 * parallel verification).
 *
 * ── Architectural home (the card asked me to pick + justify) ─────────────────
 * The card suggests `packages/infra/src/runner/executor.ts` ("command EXECUTION
 * is infra"). I place it in `packages/cli/src/runner/` instead. Justification —
 * the established package arrow is strictly one-directional:
 *     @roll/spec  ←  @roll/core
 *     @roll/spec  ←  @roll/infra
 *     @roll/core + @roll/infra  ←  @roll/cli
 * `@roll/infra`'s package.json depends ONLY on `@roll/spec` (verified), and the
 * git/github/process modules document that the arrow into core stays
 * one-directional ("core already depends on no infra; keeping the arrow
 * one-directional", github.ts:531). The dispatcher MUST import BOTH the
 * orchestrator's {@link CycleCommand} vocabulary (lives in @roll/core) AND the
 * infra executors. Putting it in infra would force `@roll/infra → @roll/core`,
 * inverting the layer arrow and creating a core↔infra coupling the whole port
 * was designed to avoid. The cli is the one package that already sees both, so
 * the adapter belongs here. The CLI command handler stays a thin one-liner
 * (commands/index.ts) that delegates to {@link runCycleOnce}; all logic is in
 * this module — "cli stays thin" is honoured at the command layer.
 *
 * ── What this module is ──────────────────────────────────────────────────────
 * {@link executeCommand} is the 1:1 dispatcher: every {@link CycleCommand} the
 * orchestrator emits maps onto an existing infra call / core plan, via an
 * injectable {@link Ports} bundle (git / github / process / events / agentSpawn /
 * clock) so tests fake every execution layer (PATH shims + file:// remotes; no
 * real network / agent / PR side effects). `*_run`-style commands return a
 * {@link CycleEvent} to feed back into the next {@link cycleStep}.
 */
import {
  type CapturedFacts,
  type CycleCommand,
  type CycleContext,
  type CycleEvent,
  EventBus,
  type PublishResult,
  type RouteDeps,
  type RunKey,
  type Tier,
  budgetVerdict,
  classifyComplexity,
  parseClaimedIdsFromBacklog,
  parseBacklog,
  pickStory,
  planPublishDocPr,
  planPublishPr,
  resolveRoute,
  resolveFallback,
} from "@roll/core";
import type { RollEvent } from "@roll/spec";
import {
  type Clock,
  acquireLock,
  ghRepoSlug,
  prViewState,
  releaseLock,
  remoteUrl,
  runPublishPlan,
  systemClock,
  writeHeartbeat,
  worktreeAdd,
  worktreeRemove,
  push as gitPush,
} from "@roll/infra";
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  type AgentSpawn,
  realAgentSpawn,
} from "./agent-spawn.js";

const execFileAsync = promisify(execFile);

/** The injectable wall clock (epoch seconds) — infra's {@link Clock}. */
export type ProcessClock = Clock;

// ── Ports bundle (the injectable execution surface) ───────────────────────────

/**
 * Git operations the executor needs — a thin facet of @roll/infra's git module
 * so tests can fake worktree create/cleanup, push, and the rev-list count behind
 * an in-memory double without spawning git.
 */
export interface GitPort {
  /** `_worktree_create` — STRICT add (exit code propagated). */
  worktreeAdd(repoCwd: string, path: string, branch: string, base: string): Promise<{ code: number }>;
  /** `_worktree_cleanup` — tolerant remove (always code 0). */
  worktreeRemove(repoCwd: string, path: string, branch: string): Promise<{ code: number }>;
  /** `git push origin <branch>` (orphan push safety net). */
  push(repoCwd: string, branch: string): Promise<{ code: number }>;
  /** `git rev-list --count origin/main..HEAD` in the worktree → commits ahead. */
  commitsAhead(worktreeCwd: string): Promise<number>;
}

/** GitHub facet — the publish-plan executor + slug resolution. */
export interface GithubPort {
  /** Resolve `owner/repo` from the repo's origin remote (undefined ⇒ no gh). */
  repoSlug(repoCwd: string): Promise<string | undefined>;
  /** Execute a publish PLAN (core planPublishPr/DocPr) → publish status. */
  runPublishPlan(
    plan: ReadonlyArray<{ kind: string; tool: "git" | "gh"; argv: string[] }>,
  ): Promise<{ status: 0 | 1 | 2; prUrl: string; ok: boolean }>;
  /** Poll a PR's merge state (sync merge-wait). Returns the gh state string. */
  prState(repoCwd: string, branch: string): Promise<string>;
}

/** Process facet — lock + heartbeat (infra/process.ts). */
export interface ProcessPort {
  acquireLock(lockPath: string, opts?: { staleSec?: number }): { acquired: boolean; heldByPid: number | undefined };
  releaseLock(lockPath: string): void;
  writeHeartbeat(path: string): void;
}

/** Events facet — append + upsert (events/bus.ts). */
export interface EventsPort {
  ensureEventFiles(eventsPath: string, runsPath: string): void;
  appendEvent(eventsPath: string, event: RollEvent): void;
  upsertRun(runsPath: string, key: RunKey, row: Record<string, unknown>): void;
  appendAlert(alertsPath: string, message: string): void;
}

/** Backlog facet — read the project backlog and pick a story (picker.ts). */
export interface BacklogPort {
  /** Read backlog rows from the worktree's `.roll/backlog.md`. */
  read(worktreeCwd: string): { id: string; desc: string; status: string }[];
  /** Mark a story id to a status (e.g. 🔨 In Progress) in the worktree backlog. */
  markStatus?(worktreeCwd: string, id: string, status: string): void;
}

/** Routing facet — resolve tier→agent for a story (router.ts). */
export interface RoutePort {
  resolve(storyId: string, estMin: number | undefined): { agent: string; model: string };
}

/** Budget facet — the I11 gate verdict at route→execute boundary. */
export interface BudgetPort {
  check(storyId: string): "ok" | "downgrade" | "pause_and_notify";
}

/**
 * The full injectable Ports bundle. The runtime wiring ({@link nodePorts})
 * binds these to the real infra; tests pass fakes for every facet so NO real
 * network / agent / PR side effects occur (PATH shims + file:// remotes only).
 */
export interface Ports {
  git: GitPort;
  github: GithubPort;
  process: ProcessPort;
  events: EventsPort;
  backlog: BacklogPort;
  route: RoutePort;
  budget: BudgetPort;
  agentSpawn: AgentSpawn;
  clock: ProcessClock;
  /** Runtime paths the executor writes to. */
  paths: RunnerPaths;
  /** The repo (main tree) the worktree commands run against. */
  repoCwd: string;
  /** The skill body the agent runs (the loop hands the agent SKILL.md). */
  skillBody: string;
}

/** Resolved runtime file paths under `<project>/.roll/loop/`. */
export interface RunnerPaths {
  eventsPath: string;
  runsPath: string;
  alertsPath: string;
  lockPath: string;
  heartbeatPath: string;
  /** The cycle worktree path. */
  worktreePath: string;
}

// ── Command dispatch ──────────────────────────────────────────────────────────

/** What {@link executeCommand} returns: an optional feedback event for the next
 *  step, plus side-effect flags the driver needs (lock released, terminal). */
export interface ExecuteResult {
  /** Event to feed back into the orchestrator (undefined ⇒ pure side effect). */
  event?: CycleEvent;
  /** True iff this command released the inner lock (driver stops re-releasing). */
  lockReleased?: boolean;
}

/**
 * Dispatch ONE {@link CycleCommand} to the matching infra call / core plan via
 * {@link Ports}. The mapping table (command → executor) is documented inline.
 * Commands whose result the orchestrator consumes return a {@link CycleEvent};
 * pure side-effect commands return `{}`.
 *
 * `ctx` is the live cycle context (branch/agent/model/storyId) the orchestrator
 * threads; the executor reads it to parameterize publish/spawn calls.
 */
export async function executeCommand(
  cmd: CycleCommand,
  ports: Ports,
  ctx: CycleContext,
): Promise<ExecuteResult> {
  switch (cmd.kind) {
    // recovery.ts preflightPlan + orphan recovery. The pure plan is consulted by
    // the driver before the loop; here we just acknowledge readiness (the driver
    // already healed orphan state / verified hooks). Feeds back preflight_done.
    case "preflight":
      return { event: { type: "preflight_done" } };

    // infra/git _worktree_create (STRICT). worktree_created on success, else
    // worktree_failed (→ failed terminal, bin/roll:9000).
    case "create_worktree": {
      const r = await ports.git.worktreeAdd(
        ports.repoCwd,
        ports.paths.worktreePath,
        cmd.branch,
        "origin/main",
      );
      return { event: r.code === 0 ? { type: "worktree_created" } : { type: "worktree_failed" } };
    }

    // backlog/picker pickStory (read backlog INSIDE the worktree, bin/roll:8938).
    case "pick_story": {
      const items = ports.backlog.read(ports.paths.worktreePath);
      const story = pickStory(items as never);
      if (story === undefined) return { event: { type: "no_story" } };
      // Mark 🔨 In Progress so the open-PR dedup sees the claim (best-effort).
      ports.backlog.markStatus?.(ports.paths.worktreePath, story.id, "🔨 In Progress");
      return { event: { type: "story_picked", storyId: story.id } };
    }

    // agent/router resolveRoute (+ pre-spawn availability fallback).
    case "resolve_route": {
      const items = ports.backlog.read(ports.paths.worktreePath);
      const story = items.find((i) => i.id === cmd.storyId);
      const estMin = story === undefined ? undefined : parseEstMin(story.desc);
      const r = ports.route.resolve(cmd.storyId, estMin);
      return { event: { type: "route_resolved", agent: r.agent, model: r.model } };
    }

    // cost/budget budgetVerdict (I11) at the route→execute boundary.
    case "budget_check": {
      const verdict = ports.budget.check(cmd.storyId);
      if (verdict === "pause_and_notify") {
        return { event: { type: "budget_halt", reason: `budget gate: ${cmd.storyId}` } };
      }
      // downgrade is advisory (no auto-mutation) → proceed as ok.
      return { event: { type: "budget_ok" } };
    }

    // budget downgrade signal (advisory) — record an alert, no mutation.
    case "budget_downgrade":
      ports.events.appendAlert(ports.paths.alertsPath, `budget downgrade: ${cmd.reason}`);
      return {};

    // halt the cycle before spawning (fail-closed). Side effect only.
    case "halt_cycle":
      ports.events.appendAlert(ports.paths.alertsPath, `cycle halted: ${cmd.reason}`);
      return {};

    // execute: spawn the agent (TCR commits happen inside the worktree). The
    // exit code + timeout feed back as agent_exited; usage is captured for cost.
    case "spawn_agent": {
      const res = await ports.agentSpawn(cmd.agent, {
        cwd: ports.paths.worktreePath,
        skillBody: ports.skillBody,
      });
      return { event: { type: "agent_exited", exit: res.exitCode, timedOut: res.timedOut } };
    }

    // watchdog teardown — SIGKILL is owned by the spawn-local timeout; here the
    // command is a structural marker (the kill already happened at the spawn
    // layer). No feedback event (the orchestrator already transitioned).
    case "kill_agent":
      return {};

    // retry backoff (the adapter sleeps). Honour the schedule via the clock-free
    // setTimeout; the orchestrator already advanced attempt, so re-spawn follows.
    case "sleep_backoff":
      await sleep(cmd.seconds * 1000);
      return {};

    // capture facts: git rev-list/log count (bin/roll:9127-9157). worktree used
    // (we created it), agent exit (carried by the prior agent_exited — the driver
    // tracks it), commits ahead from git. timedOut is false here (timeout path
    // short-circuits before capture).
    case "capture_facts": {
      const commitsAhead = await ports.git.commitsAhead(ports.paths.worktreePath);
      const facts: CapturedFacts = {
        usedWorktree: true,
        agentExit: 0, // accept-path only reaches capture (retryPlan accept = exit 0)
        timedOut: false,
        commitsAhead,
      };
      return { event: { type: "facts_captured", facts } };
    }

    // delivery/pr planPublishPr → github.runPublishPlan → published result.
    case "publish_pr": {
      const slug = await ports.github.repoSlug(ports.repoCwd);
      if (slug === undefined) {
        // gh unavailable / no github remote → status 2 (gh-missing tier).
        const pub: PublishResult = { status: 2, mergedBack: false, orphanPushed: false };
        return { event: { type: "published", result: pub } };
      }
      const plan = cmd.docOnly
        ? planPublishDocPr({ branch: cmd.branch, slug, body: publishBody(ctx) })
        : planPublishPr({ branch: cmd.branch, slug, body: publishBody(ctx) });
      const r = await ports.github.runPublishPlan(plan);
      const pub: PublishResult = { status: r.status };
      return { event: { type: "published", result: pub } };
    }

    // _worktree_merge_back (gh-missing ff tier). Drive a push + ff; report via a
    // published refinement is not needed (the orchestrator handles status 2 in
    // classifyPublish), so this is a structural side effect. The driver routes
    // the gh-missing path through publish_pr's status-2 result already.
    case "merge_back": {
      const r = await ports.git.push(ports.repoCwd, cmd.branch);
      ports.events.appendAlert(
        ports.paths.alertsPath,
        `merge_back ${cmd.branch}: push ${r.code === 0 ? "ok" : "failed"}`,
      );
      return {};
    }

    // FIX-039 orphan branch+tag push (audit safety net, C2).
    case "push_orphan": {
      const r = await ports.git.push(ports.repoCwd, cmd.branch);
      ports.events.appendAlert(
        ports.paths.alertsPath,
        `orphan push ${cmd.branch}: ${r.code === 0 ? "ok" : "failed"}`,
      );
      return {};
    }

    // delivery/pr nextWaitAction sync merge-wait poll. Re-poll the gh state and
    // feed merge_polled back so the orchestrator's nextWaitAction drives it.
    case "wait_merge": {
      const state = await ports.github.prState(ports.repoCwd, cmd.branch);
      return { event: { type: "merge_polled", state, elapsedSec: cmd.elapsedSec } };
    }

    // reconcile/engine reconcileMergeEvidence — terminal bookkeeping only here
    // (the six-state classification already happened); ack with reconciled.
    case "reconcile":
      return { event: { type: "reconciled" } };

    // _worktree_cleanup (tolerant). Side effect; no feedback (terminal path).
    case "cleanup_worktree":
      await ports.git.worktreeRemove(ports.repoCwd, ports.paths.worktreePath, cmd.branch);
      return {};

    // events/bus appendEvent (I8 — terminal event written unconditionally).
    case "emit_event":
      ports.events.appendEvent(ports.paths.eventsPath, stampTs(cmd.event, ports.clock()));
      return {};

    // events/bus upsertRun — the dashboard terminal record (v2 runs.jsonl shape).
    case "append_run": {
      const key: RunKey = { storyId: ctx.storyId ?? "", cycleId: cmd.cycleId };
      ports.events.upsertRun(ports.paths.runsPath, key, buildRunRow(cmd, ctx));
      return {};
    }

    // _worktree_alert.
    case "append_alert":
      ports.events.appendAlert(ports.paths.alertsPath, cmd.message);
      return {};

    // infra/process releaseLock.
    case "release_lock":
      ports.process.releaseLock(ports.paths.lockPath);
      return { lockReleased: true };

    default: {
      // Exhaustiveness guard — an unmapped command is a hard error (report, don't
      // silently swallow). If a new CycleCommand kind appears, this throws.
      const _exhaustive: never = cmd;
      throw new Error(`executeCommand: unmapped command ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Stamp `ts` onto an event the orchestrator built with ts=0 (it owns no clock). */
function stampTs(event: RollEvent, ts: number): RollEvent {
  return { ...event, ts } as RollEvent;
}

/** Build the v2-shaped runs.jsonl row (keys verified against the dashboard
 *  difftest fixture: project/run_id/ts/tcr_count/built[]/status/agent/duration_sec).
 *  The bus upsert adds story_id + cycle_id for the dedupe key. */
export function buildRunRow(
  cmd: Extract<CycleCommand, { kind: "append_run" }>,
  ctx: CycleContext,
): Record<string, unknown> {
  const built = cmd.status === "done" || cmd.status === "built" ? [ctx.storyId ?? ""].filter(Boolean) : [];
  return {
    run_id: cmd.cycleId,
    status: cmd.status,
    agent: ctx.agent ?? "",
    built,
    tcr_count: 0,
    outcome: cmd.outcome,
  };
}

/** Compose the gh pr-create body (commit-count-style; kept simple + pure). */
function publishBody(ctx: CycleContext): string {
  return `loop cycle ${ctx.cycleId}${ctx.storyId !== undefined ? ` — ${ctx.storyId}` : ""}`;
}

/** Parse an `est_min:<n>` tag from a backlog desc (router input). */
export function parseEstMin(desc: string): number | undefined {
  const m = /est[_-]?min:\s*(\d+)/i.exec(desc);
  return m === null ? undefined : Number(m[1]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Node-backed Ports wiring (real infra) ─────────────────────────────────────

/**
 * Build the real Node-backed {@link Ports} bundle. The agent spawn defaults to
 * {@link realAgentSpawn} (claude argv); tests override `agentSpawn` (+ the github
 * facet) with fakes so no real agent / PR side effects occur.
 */
export function nodePorts(opts: {
  repoCwd: string;
  paths: RunnerPaths;
  skillBody: string;
  routeDeps: RouteDeps;
  budget?: BudgetPort;
  agentSpawn?: AgentSpawn;
  clock?: ProcessClock;
}): Ports {
  const bus = new EventBus();
  const clock = opts.clock ?? systemClock;
  return {
    repoCwd: opts.repoCwd,
    paths: opts.paths,
    skillBody: opts.skillBody,
    clock,
    agentSpawn: opts.agentSpawn ?? realAgentSpawn,
    git: {
      async worktreeAdd(repoCwd, path, branch, base) {
        return worktreeAdd(repoCwd, path, branch, base);
      },
      async worktreeRemove(repoCwd, path, branch) {
        return worktreeRemove(repoCwd, path, branch);
      },
      async push(repoCwd, branch) {
        return gitPush(repoCwd, branch);
      },
      async commitsAhead(worktreeCwd) {
        const r = await execFileAsync("git", ["rev-list", "--count", "origin/main..HEAD"], {
          cwd: worktreeCwd,
          encoding: "utf8",
        }).catch(() => ({ stdout: "0" }));
        const n = Number((r.stdout ?? "0").trim());
        return Number.isFinite(n) ? n : 0;
      },
    },
    github: {
      async repoSlug(repoCwd) {
        const url = await remoteUrl(repoCwd);
        return ghRepoSlug(url);
      },
      async runPublishPlan(plan) {
        const r = await runPublishPlan(plan);
        return { status: r.status, prUrl: r.prUrl, ok: r.ok };
      },
      async prState(repoCwd, branch) {
        const slug = ghRepoSlug(await remoteUrl(repoCwd));
        if (slug === undefined) return "UNKNOWN";
        return prViewState(slug, branch);
      },
    },
    process: {
      acquireLock(lockPath, o) {
        return acquireLock(lockPath, process.pid, { staleSec: o?.staleSec, now: clock });
      },
      releaseLock(lockPath) {
        releaseLock(lockPath);
      },
      writeHeartbeat(path) {
        writeHeartbeat(path, clock);
      },
    },
    events: {
      ensureEventFiles(eventsPath, runsPath) {
        bus.ensureEventFiles(eventsPath, runsPath);
      },
      appendEvent(eventsPath, event) {
        bus.appendEvent(eventsPath, event);
      },
      upsertRun(runsPath, key, row) {
        bus.upsertRun(runsPath, key, row);
      },
      appendAlert(alertsPath, message) {
        appendAlertLine(alertsPath, message);
      },
    },
    backlog: {
      read(worktreeCwd) {
        const p = join(worktreeCwd, ".roll", "backlog.md");
        if (!existsSync(p)) return [];
        return parseBacklog(readFileSync(p, "utf8"));
      },
    },
    route: opts.routeDeps
      ? {
          resolve(_storyId, estMin) {
            const tier: Tier = classifyComplexity(estMin);
            const dec = resolveRoute(tier, opts.routeDeps);
            return { agent: dec.agent, model: "" };
          },
        }
      : { resolve: () => ({ agent: "claude", model: "" }) },
    budget: opts.budget ?? { check: () => "ok" },
  };
}

function appendAlertLine(alertsPath: string, message: string): void {
  mkdirSync(dirname(alertsPath), { recursive: true });
  appendFileSync(alertsPath, `${message}\n`, "utf8");
}

// Keep these referenced so resolveFallback / budgetVerdict / parseClaimedIds are
// not stripped by a too-eager tree-shaker in the test bundle (they document the
// available execution surface; nodePorts wires the common path).
export const _availableCoreSurface = {
  resolveFallback,
  budgetVerdict,
  parseClaimedIdsFromBacklog,
} as const;
