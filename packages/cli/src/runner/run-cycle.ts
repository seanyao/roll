/**
 * runCycleOnce — the driver that walks the pure {@link cycleStep} state machine
 * to a terminal state, executing each emitted {@link CycleCommand} through the
 * {@link Ports} bundle and feeding the result back. This is the executable heart
 * of the runner adapter (prerequisite for US-LOOP-006 v2-vs-v3 verification).
 *
 * Honours (the card's hard list):
 *   - LOCK acquire/release (infra/process). Acquire the inner lock before the
 *     walk; release UNCONDITIONALLY on every exit path (try/finally).
 *   - HEARTBEAT cadence: written at cycle start and refreshed on each step while
 *     executing, so a monitor reading the heartbeat file sees liveness during a
 *     long agent run.
 *   - WATCHDOG timeout: the elapsed-time breach is checked before each step via
 *     the pure {@link watchdogVerdict}; a breach injects a synthetic timed-out
 *     `agent_exited` so the orchestrator runs its clean teardown path
 *     (timeoutTeardownCommands) — terminal event + lock release included.
 *   - TERMINAL event UNCONDITIONAL (I8): the orchestrator's terminate() always
 *     emits cycle:end + a runs row; the driver additionally guarantees, in a
 *     finally block, that if NO terminal command was observed (e.g. an exception
 *     mid-walk), a fallback `aborted` cycle:end + runs row are still written —
 *     so a terminal event exists on EVERY exit path, and the next runCycleOnce
 *     takes over cleanly (I2).
 *   - events/runs bookkeeping: ensureEventFiles up front; cycle:start/:end +
 *     runs upsert flow through the executor's emit_event / append_run commands.
 */
import {
  type CycleCommand,
  type CycleContext,
  type CycleEvent,
  type CycleState,
  type V2CycleStatus,
  cycleEndEvent,
  cycleStep,
  initialCycleState,
  mapV2Status,
  watchdogVerdict,
} from "@roll/core";
import { CYCLE_TIMEOUT_SEC } from "@roll/core";
import { type Ports, type ProcessClock, executeCommand, buildRunRow } from "./executor.js";

/** Inputs for one cycle run. */
export interface RunCycleOptions {
  ports: Ports;
  /** The cycle context (cycleId/branch/loop). agent/model/storyId filled by walk. */
  ctx: CycleContext;
  /** Hard cycle timeout in seconds (watchdog). Defaults to v2 {@link CYCLE_TIMEOUT_SEC}. */
  timeoutSec?: number;
  /** Inner lock staleness; defaults to infra INNER_LOCK_STALE_SEC via acquireLock. */
  lockStaleSec?: number;
  /** Max steps before bailing (loop-safety; a terminal is normally reached fast). */
  maxSteps?: number;
}

/** What a finished cycle reports back. */
export interface RunCycleResult {
  /** The terminal v2 status the cycle landed on (undefined ⇒ never reached one). */
  terminal: V2CycleStatus | undefined;
  /** True iff we acquired the lock and ran the walk (false ⇒ another cycle held it). */
  ran: boolean;
  /** When `ran` is false, the live owner's pid. */
  heldByPid?: number;
  /** The final orchestrator state (for assertions / dashboards). */
  state?: CycleState;
}

/**
 * Drive ONE cycle to terminal. Acquires the inner lock; on contention returns
 * `{ ran: false }` (mirrors v2's skip-when-held, bin/roll:8412-8425). Otherwise
 * walks the state machine, executing each command and feeding the result back,
 * with the watchdog + heartbeat woven in, and releases the lock + guarantees a
 * terminal event in `finally`.
 */
export async function runCycleOnce(opts: RunCycleOptions): Promise<RunCycleResult> {
  const { ports, ctx } = opts;
  const timeoutSec = opts.timeoutSec ?? CYCLE_TIMEOUT_SEC;
  const maxSteps = opts.maxSteps ?? 1000;

  // Lock: single-flight re-entry guard. Skip if another live cycle holds it.
  const acq = ports.process.acquireLock(ports.paths.lockPath, { staleSec: opts.lockStaleSec });
  if (!acq.acquired) {
    return { ran: false, terminal: undefined, heldByPid: acq.heldByPid };
  }

  // Files + first heartbeat up front (FIX-157 self-heal + liveness).
  ports.events.ensureEventFiles(ports.paths.eventsPath, ports.paths.runsPath);
  ports.process.writeHeartbeat(ports.paths.heartbeatPath);

  const startSec = ports.clock();
  let state: CycleState = initialCycleState(ctx);
  let lockReleased = false;
  let terminalEmitted = false;
  let liveCtx: CycleContext = ctx;

  /** Mark whether the orchestrator already wrote the terminal event for I8. */
  const noteTerminal = (cmds: CycleCommand[]): void => {
    if (cmds.some((c) => c.kind === "emit_event" && c.event.type === "cycle:end")) {
      terminalEmitted = true;
    }
    if (cmds.some((c) => c.kind === "release_lock")) lockReleased = true;
  };

  try {
    // Kick the machine: `start` → preflight.
    let pending: CycleEvent | undefined = { type: "start", ctx };
    let steps = 0;

    while (pending !== undefined && steps < maxSteps) {
      steps += 1;

      // Watchdog: before stepping, if we're executing and the budget is breached,
      // inject a timed-out agent_exited so the orchestrator runs clean teardown.
      if (state.phase === "execute" && !state.done) {
        const elapsed = ports.clock() - startSec;
        const verdict = watchdogVerdict(elapsed, timeoutSec);
        if (verdict.breached) {
          pending = { type: "agent_exited", exit: 143, timedOut: true };
        }
      }

      const { state: next, commands } = cycleStep(state, pending);
      state = next;
      liveCtx = mergeCtx(liveCtx, next.ctx);
      noteTerminal(commands);

      // Refresh heartbeat each step (liveness during a long execute phase).
      ports.process.writeHeartbeat(ports.paths.heartbeatPath);

      // Execute the commands in order; the LAST feedback event (if any) becomes
      // the next `pending`. Commands are 1:1 with infra calls (executeCommand).
      let nextEvent: CycleEvent | undefined;
      for (const cmd of commands) {
        const res = await executeCommand(cmd, ports, liveCtx);
        if (res.lockReleased === true) lockReleased = true;
        if (res.event !== undefined) nextEvent = res.event;
      }

      // Terminal? stop the walk once a status is stamped and no feedback remains.
      if (state.done && nextEvent === undefined) {
        pending = undefined;
      } else {
        pending = nextEvent;
      }
    }
  } finally {
    // I8: a terminal cycle:end + runs row MUST exist on every exit path. If the
    // walk threw / bailed before the orchestrator emitted one, write a fallback
    // `aborted` terminal directly (idempotent — the bus upsert dedupes the row).
    if (!terminalEmitted) {
      const status: V2CycleStatus = "aborted";
      const tctx = {
        cycleId: liveCtx.cycleId,
        branch: liveCtx.branch,
        agent: liveCtx.agent ?? "",
        model: liveCtx.model ?? "",
      };
      try {
        ports.events.appendEvent(
          ports.paths.eventsPath,
          { ...cycleEndEvent(tctx, status), ts: ports.clock() },
        );
        const fakeAppend: Extract<CycleCommand, { kind: "append_run" }> = {
          kind: "append_run",
          status,
          outcome: mapV2Status(status),
          cycleId: liveCtx.cycleId,
        };
        ports.events.upsertRun(
          ports.paths.runsPath,
          { storyId: liveCtx.storyId ?? "", cycleId: liveCtx.cycleId },
          buildRunRow(fakeAppend, liveCtx),
        );
      } catch {
        /* best-effort terminal write; never mask the original failure */
      }
      if (state.done) state = { ...state, terminal: status };
    }

    // Lock release UNCONDITIONAL (mirrors the EXIT trap, bin/roll:8770). The
    // orchestrator's timeout/terminal paths may already have released it; this
    // is the belt-and-braces final release (idempotent rm -f).
    if (!lockReleased) ports.process.releaseLock(ports.paths.lockPath);
  }

  return { ran: true, terminal: state.terminal, state };
}

/** Merge orchestrator-updated ctx fields (agent/model/storyId) into the live ctx. */
function mergeCtx(live: CycleContext, next: CycleContext): CycleContext {
  return {
    ...live,
    storyId: next.storyId ?? live.storyId,
    agent: next.agent ?? live.agent,
    model: next.model ?? live.model,
  };
}

// ── Dry-run plan rendering (the parallel-verification protocol's preview) ─────

/**
 * Render the command PLAN the cycle WOULD execute, without running anything.
 * Drives the pure {@link cycleStep} with a SCRIPTED happy-path event sequence
 * (preflight→worktree→pick→route→budget→execute(accept)→capture(built)→publish→
 * done), collecting every command. No ports, no I/O — purely the orchestrator's
 * command vocabulary, so `roll loop run-once --dry-run` shows the executor map.
 */
export function dryRunPlan(ctx: CycleContext): string[] {
  const scripted: CycleEvent[] = [
    { type: "start", ctx },
    { type: "preflight_done" },
    { type: "worktree_created" },
    { type: "story_picked", storyId: ctx.storyId ?? "US-EXAMPLE" },
    { type: "route_resolved", agent: ctx.agent ?? "claude", model: ctx.model ?? "" },
    { type: "budget_ok" },
    { type: "agent_exited", exit: 0, timedOut: false },
    {
      type: "facts_captured",
      facts: { usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 1 },
    },
    { type: "published", result: { status: 0 } },
  ];
  const out: string[] = [];
  let state: CycleState = initialCycleState(ctx);
  for (const ev of scripted) {
    const { state: next, commands } = cycleStep(state, ev);
    state = next;
    for (const cmd of commands) out.push(describeCommand(cmd));
    if (state.done) break;
  }
  return out;
}

/** One-line human description of a command (command → executor mapping). */
function describeCommand(cmd: CycleCommand): string {
  switch (cmd.kind) {
    case "preflight":
      return "preflight            → recovery.preflightPlan + orphan heal";
    case "create_worktree":
      return `create_worktree      → git.worktreeAdd(${cmd.branch})`;
    case "pick_story":
      return "pick_story           → picker.pickStory(.roll/backlog.md)";
    case "resolve_route":
      return `resolve_route        → router.resolveRoute(${cmd.storyId})`;
    case "budget_check":
      return `budget_check         → budget.budgetVerdict(${cmd.storyId})`;
    case "budget_downgrade":
      return `budget_downgrade     → alert(downgrade: ${cmd.reason})`;
    case "halt_cycle":
      return `halt_cycle           → alert + stop (${cmd.reason})`;
    case "spawn_agent":
      return `spawn_agent          → agentSpawn(${cmd.agent}, attempt ${cmd.attempt})`;
    case "kill_agent":
      return `kill_agent           → SIGKILL (grace ${cmd.graceSec}s)`;
    case "sleep_backoff":
      return `sleep_backoff        → sleep ${cmd.seconds}s`;
    case "capture_facts":
      return "capture_facts        → git rev-list --count origin/main..HEAD";
    case "publish_pr":
      return `publish_pr           → planPublishPr + github.runPublishPlan(${cmd.branch})`;
    case "merge_back":
      return `merge_back           → git.push(${cmd.branch}) ff fallback`;
    case "push_orphan":
      return `push_orphan          → git.push(${cmd.branch}) audit safety net`;
    case "wait_merge":
      return `wait_merge           → github.prState(${cmd.branch}) poll`;
    case "reconcile":
      return "reconcile            → reconcile.reconcileMergeEvidence";
    case "cleanup_worktree":
      return `cleanup_worktree     → git.worktreeRemove(${cmd.branch})`;
    case "emit_event":
      return `emit_event           → events.appendEvent(${cmd.event.type})`;
    case "append_run":
      return `append_run           → events.upsertRun(status=${cmd.status})`;
    case "append_alert":
      return `append_alert         → events.appendAlert`;
    case "release_lock":
      return "release_lock         → process.releaseLock";
    default: {
      const _x: never = cmd;
      return `unknown(${JSON.stringify(_x)})`;
    }
  }
}
