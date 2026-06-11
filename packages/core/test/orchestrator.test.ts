/**
 * Unit tests: CycleOrchestrator pure state machine (loop/orchestrator.ts).
 *
 * Pins the v2 inner-runner phase walk (bin/roll:8391-9380) as a pure stepper:
 *   - full happy path pick→…→done asserting the COMMAND SEQUENCE;
 *   - every failure branch (no story→idle; worktree fail→failed; agent fail after
 *     retries→failed+alert; timeout breach→clean teardown ORDER; publish tier-2
 *     gh-missing→merge_back; publish PR-fail→orphan/failed);
 *   - retry/backoff exhaustion → failed (NOT agent-swap, I6);
 *   - SIGKILL mid-phase → state machine resumable from persisted events (I2/I8);
 *   - event-sourcing round-trip: replay simulated events through spec
 *     parseEventLine + foldCycle and assert the rebuilt terminal state (I8).
 */
import { parseEventLine, type RollEvent } from "@roll/spec";
import { describe, expect, it } from "vitest";
import {
  type CycleCommand,
  type CycleContext,
  type CycleEvent,
  type CycleState,
  backoffSchedule,
  classifyCaptured,
  classifyPublish,
  cycleStep,
  foldCycle,
  initialCycleState,
  mapV2Status,
  retryPlan,
  timeoutTeardownCommands,
  watchdogVerdict,
  MAX_AGENT_ATTEMPTS,
  RETRY_BASE_BACKOFF_SEC,
  CYCLE_TIMEOUT_SEC,
} from "../src/index.js";

const CTX: CycleContext = {
  cycleId: "20260605-013000-12345",
  branch: "loop/cycle-20260605-013000-12345",
  loop: "main",
};

/** Drive a list of events through the stepper from a fresh start, collecting the
 *  command kinds in order (the SEQUENCE assertions read these). */
function walk(events: CycleEvent[]): { state: CycleState; kinds: string[]; commands: CycleCommand[] } {
  let state = initialCycleState(CTX);
  const kinds: string[] = [];
  const commands: CycleCommand[] = [];
  for (const ev of events) {
    const r = cycleStep(state, ev);
    state = r.state;
    for (const c of r.commands) {
      kinds.push(c.kind);
      commands.push(c);
    }
  }
  return { state, kinds, commands };
}

// ── six-state classification ─────────────────────────────────────────────────

describe("classifyCaptured — pre-publish six-state (bin/roll:9127-9157)", () => {
  it("timed out → blocked (watchdog path)", () => {
    expect(classifyCaptured({ usedWorktree: true, agentExit: 0, timedOut: true, commitsAhead: 3 })).toBe("blocked");
  });
  it("worktree-setup failed → failed (bin/roll:9000)", () => {
    expect(classifyCaptured({ usedWorktree: false, agentExit: 0, timedOut: false, commitsAhead: 0 })).toBe("failed");
  });
  it("agent exit ≠ 0 → failed (bin/roll:9133)", () => {
    expect(classifyCaptured({ usedWorktree: true, agentExit: 1, timedOut: false, commitsAhead: 0 })).toBe("failed");
  });
  it("exit 0 + 0 commits → idle (bin/roll:9180)", () => {
    expect(classifyCaptured({ usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 0 })).toBe("idle");
  });
  it("FIX-252: exit 0 + 0 branch commits but local main ahead origin → failed drift, not idle", () => {
    expect(classifyCaptured({ usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 0, mainAhead: 1 })).toBe("failed");
  });
  it("exit 0 + commits → built (bin/roll:9142)", () => {
    expect(classifyCaptured({ usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 2 })).toBe("built");
  });
});

describe("FIX-244 — phantom-failure classification (published terminal)", () => {
  it("non-zero exit + commits + OPEN PR for the cycle branch → published, not failed", () => {
    expect(
      classifyCaptured({ usedWorktree: true, agentExit: 1, timedOut: false, commitsAhead: 3, prState: "OPEN" }),
    ).toBe("published");
  });
  it("non-zero exit + commits + already-MERGED PR → published (backfill credits it)", () => {
    expect(
      classifyCaptured({ usedWorktree: true, agentExit: 1, timedOut: false, commitsAhead: 3, prState: "MERGED" }),
    ).toBe("published");
  });
  it("non-zero exit with no PR → failed (unchanged: a real no-output failure)", () => {
    expect(
      classifyCaptured({ usedWorktree: true, agentExit: 1, timedOut: false, commitsAhead: 3 }),
    ).toBe("failed");
    expect(
      classifyCaptured({ usedWorktree: true, agentExit: 1, timedOut: false, commitsAhead: 3, prState: "UNKNOWN" }),
    ).toBe("failed");
  });
  it("OPEN PR but zero commits ahead → not published (nothing of this cycle is in it)", () => {
    expect(
      classifyCaptured({ usedWorktree: true, agentExit: 1, timedOut: false, commitsAhead: 0, prState: "OPEN" }),
    ).toBe("failed");
  });
  it("mapV2Status(published) → published_pending_merge (PR open, merge pending)", () => {
    expect(mapV2Status("published")).toBe("published_pending_merge");
  });
});

describe("classifyPublish — publish ladder refines built (bin/roll:9239-9356)", () => {
  it("FIX-244: status 0 → published (PR open, merge pending — done ≡ merged, I4)", () => {
    expect(classifyPublish({ status: 0 })).toBe("published");
  });
  it("status 2 + mergedBack → done (gh missing, ff)", () => {
    expect(classifyPublish({ status: 2, mergedBack: true })).toBe("done");
  });
  it("manual merge + gh missing never counts merge_back as done", () => {
    expect(classifyPublish({ status: 2, manualMerge: true, mergedBack: true })).toBe("failed");
  });
  it("status 2 + orphanPushed → orphan", () => {
    expect(classifyPublish({ status: 2, orphanPushed: true })).toBe("orphan");
  });
  it("status 2 + neither → failed", () => {
    expect(classifyPublish({ status: 2 })).toBe("failed");
  });
  it("PR-fail + orphanPushed → orphan", () => {
    expect(classifyPublish({ status: 1, orphanPushed: true })).toBe("orphan");
  });
  it("PR-fail + not pushed → failed", () => {
    expect(classifyPublish({ status: 1 })).toBe("failed");
  });
});

describe("mapV2Status — v2 rows → TerminalOutcome bridge", () => {
  it("idle/built/orphan use closed terminal vocabulary", () => {
    expect(mapV2Status("idle")).toBe("idle_no_work");
    expect(mapV2Status("built")).toBe("published_pending_merge");
    expect(mapV2Status("orphan")).toBe("aborted_with_delivery");
  });
  it("done → delivered, blocked/failed passthrough, aborted is reasoned", () => {
    expect(mapV2Status("done")).toBe("delivered");
    expect(mapV2Status("blocked")).toBe("blocked");
    expect(mapV2Status("failed")).toBe("failed");
    expect(mapV2Status("aborted")).toBe("aborted_no_delivery");
  });
});

// ── happy path: pick → … → done ──────────────────────────────────────────────

describe("happy-path phase walk → done", () => {
  it("emits the full command sequence and ends delivered", () => {
    const { state, kinds } = walk([
      { type: "start", ctx: CTX },
      { type: "preflight_done" },
      { type: "worktree_created" },
      { type: "story_picked", storyId: "US-1" },
      { type: "route_resolved", agent: "claude", model: "sonnet" },
      { type: "budget_ok" },
      { type: "agent_exited", exit: 0, timedOut: false },
      { type: "facts_captured", facts: { usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 2 } },
      { type: "published", result: { status: 0 } },
    ]);
    expect(kinds).toEqual([
      "preflight",
      "create_worktree",
      "emit_event", // cycle:start
      "pick_story",
      "resolve_route",
      "budget_check",
      "spawn_agent",
      "capture_facts",
      "publish_pr",
      "cleanup_worktree",
      "emit_event", // cycle:end (published — merge pending, FIX-244)
      "append_run",
    ]);
    expect(state.done).toBe(true);
    expect(state.terminal).toBe("published");
    expect(state.phase).toBe("cleanup");
  });
});

// ── failure branches ─────────────────────────────────────────────────────────

describe("failure branches", () => {
  it("no story → idle terminal + worktree reclaimed (bin/roll:9180-class)", () => {
    const { state, kinds } = walk([
      { type: "start", ctx: CTX },
      { type: "preflight_done" },
      { type: "worktree_created" },
      { type: "no_story" },
    ]);
    expect(state.terminal).toBe("idle");
    expect(mapV2Status(state.terminal!)).toBe("idle_no_work");
    expect(kinds.slice(-3)).toEqual(["cleanup_worktree", "emit_event", "append_run"]);
  });

  it("FIX-252: local-main drift fails loud, leaves worktree, and writes an alert", () => {
    const { state, kinds, commands } = walk([
      { type: "start", ctx: CTX },
      { type: "preflight_done" },
      { type: "worktree_created" },
      { type: "story_picked", storyId: "FIX-252" },
      { type: "route_resolved", agent: "pi", model: "" },
      { type: "budget_ok" },
      { type: "agent_exited", exit: 0, timedOut: false },
      { type: "facts_captured", facts: { usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 0, mainAhead: 1 } },
    ]);
    expect(state.terminal).toBe("failed");
    expect(kinds).not.toContain("cleanup_worktree");
    expect(kinds.slice(-3)).toEqual(["append_alert", "emit_event", "append_run"]);
    expect(commands.find((c) => c.kind === "append_alert")).toMatchObject({
      message: expect.stringContaining("local main is ahead of origin/main"),
    });
  });

  it("worktree setup fail → failed (bin/roll:8998-9007)", () => {
    const { state, kinds } = walk([
      { type: "start", ctx: CTX },
      { type: "preflight_done" },
      { type: "worktree_failed" },
    ]);
    expect(state.terminal).toBe("failed");
    expect(kinds.slice(-2)).toEqual(["emit_event", "append_run"]);
  });

  it("agent fail after retry budget → failed + ALERT (I6, no agent-swap)", () => {
    let state = initialCycleState(CTX);
    const drive = (ev: CycleEvent): CycleCommand[] => {
      const r = cycleStep(state, ev);
      state = r.state;
      return r.commands;
    };
    drive({ type: "start", ctx: CTX });
    drive({ type: "preflight_done" });
    drive({ type: "worktree_created" });
    drive({ type: "story_picked", storyId: "US-1" });
    drive({ type: "route_resolved", agent: "pi", model: "k2" });
    drive({ type: "budget_ok" }); // → spawn attempt 1
    // attempt 1 fails → retry to 2
    let cmds = drive({ type: "agent_exited", exit: 1, timedOut: false });
    expect(cmds.map((c) => c.kind)).toEqual(["sleep_backoff", "spawn_agent"]);
    expect(state.attempt).toBe(2);
    // attempt 2 fails → retry to 3
    cmds = drive({ type: "agent_exited", exit: 1, timedOut: false });
    expect(state.attempt).toBe(3);
    // attempt 3 fails → exhausted → failed terminal + alert
    cmds = drive({ type: "agent_exited", exit: 1, timedOut: false });
    expect(state.terminal).toBe("failed");
    expect(cmds.map((c) => c.kind)).toEqual(["append_alert", "emit_event", "append_run"]);
    // I6: no spawn_agent / no route-swap among the terminal commands.
    expect(cmds.some((c) => c.kind === "spawn_agent")).toBe(false);
  });

  it("publish tier-2 (gh missing) merge_back classifies done", () => {
    expect(classifyPublish({ status: 2, mergedBack: true })).toBe("done");
    const { state } = walk([
      { type: "start", ctx: CTX },
      { type: "preflight_done" },
      { type: "worktree_created" },
      { type: "story_picked", storyId: "US-1" },
      { type: "route_resolved", agent: "claude", model: "sonnet" },
      { type: "budget_ok" },
      { type: "agent_exited", exit: 0, timedOut: false },
      { type: "facts_captured", facts: { usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 1 } },
      { type: "published", result: { status: 2, mergedBack: true } },
    ]);
    expect(state.terminal).toBe("done");
  });

  it("publish PR-fail + orphan pushed → orphan; not pushed → failed (worktree preserved)", () => {
    const orphan = walk([
      { type: "start", ctx: CTX },
      { type: "preflight_done" },
      { type: "worktree_created" },
      { type: "story_picked", storyId: "US-1" },
      { type: "route_resolved", agent: "claude", model: "sonnet" },
      { type: "budget_ok" },
      { type: "agent_exited", exit: 0, timedOut: false },
      { type: "facts_captured", facts: { usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 1 } },
      { type: "published", result: { status: 1, orphanPushed: true } },
    ]);
    expect(orphan.state.terminal).toBe("orphan");
    expect(orphan.kinds).toContain("cleanup_worktree");

    const failed = walk([
      { type: "start", ctx: CTX },
      { type: "preflight_done" },
      { type: "worktree_created" },
      { type: "story_picked", storyId: "US-1" },
      { type: "route_resolved", agent: "claude", model: "sonnet" },
      { type: "budget_ok" },
      { type: "agent_exited", exit: 0, timedOut: false },
      { type: "facts_captured", facts: { usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 1 } },
      { type: "published", result: { status: 1 } },
    ]);
    expect(failed.state.terminal).toBe("failed");
    // worktree PRESERVED on publish-fail (bin/roll:9337) — no cleanup command.
    expect(failed.kinds).not.toContain("cleanup_worktree");
  });

  it("budget breach (I11) halts before spawn → blocked, no agent spawn", () => {
    let state = initialCycleState(CTX);
    const drive = (ev: CycleEvent): CycleCommand[] => {
      const r = cycleStep(state, ev);
      state = r.state;
      return r.commands;
    };
    drive({ type: "start", ctx: CTX });
    drive({ type: "preflight_done" });
    drive({ type: "worktree_created" });
    drive({ type: "story_picked", storyId: "US-1" });
    drive({ type: "route_resolved", agent: "claude", model: "opus" });
    const cmds = drive({ type: "budget_halt", reason: "daily ceiling reached" });
    expect(state.terminal).toBe("blocked");
    expect(cmds.map((c) => c.kind)).toEqual(["halt_cycle", "emit_event", "append_run"]);
    expect(cmds.some((c) => c.kind === "spawn_agent")).toBe(false);
  });
});

// ── hard timeout: watchdog + clean teardown ORDER ────────────────────────────

describe("watchdogVerdict — hard timeout (bin/roll:8473)", () => {
  it("default limit is 2700s", () => {
    expect(CYCLE_TIMEOUT_SEC).toBe(2700);
  });
  it("not breached below the limit, reports remaining", () => {
    expect(watchdogVerdict(100, 2700)).toEqual({ breached: false, remainingSec: 2600 });
  });
  it("breaches at the boundary (>=) and reports overshoot", () => {
    expect(watchdogVerdict(2700, 2700)).toEqual({ breached: true, overshootSec: 0 });
    expect(watchdogVerdict(2750, 2700)).toEqual({ breached: true, overshootSec: 50 });
  });
});

describe("timeout breach mid-execute → clean teardown ORDER", () => {
  it("teardownCommands order: kill → terminal event → run → alert → release lock", () => {
    const cmds = timeoutTeardownCommands({ cycleId: "c1", branch: "loop/cycle-c1", agent: "claude", model: "sonnet" });
    expect(cmds.map((c) => c.kind)).toEqual([
      "kill_agent",
      "emit_event",
      "append_run",
      "append_alert",
      "release_lock",
    ]);
    // lock release is LAST — terminal record durable before slot frees.
    expect(cmds[cmds.length - 1]?.kind).toBe("release_lock");
    // worktree is PRESERVED (no cleanup command, bin/roll:9122).
    expect(cmds.some((c) => c.kind === "cleanup_worktree")).toBe(false);
  });

  it("agent_exited with timedOut short-circuits to teardown (no retry, bin/roll:9066)", () => {
    let state = initialCycleState(CTX);
    const drive = (ev: CycleEvent): CycleCommand[] => {
      const r = cycleStep(state, ev);
      state = r.state;
      return r.commands;
    };
    drive({ type: "start", ctx: CTX });
    drive({ type: "preflight_done" });
    drive({ type: "worktree_created" });
    drive({ type: "story_picked", storyId: "US-1" });
    drive({ type: "route_resolved", agent: "claude", model: "sonnet" });
    drive({ type: "budget_ok" });
    const cmds = drive({ type: "agent_exited", exit: 0, timedOut: true });
    expect(state.terminal).toBe("blocked");
    expect(state.done).toBe(true);
    expect(cmds.map((c) => c.kind)).toEqual([
      "kill_agent",
      "emit_event",
      "append_run",
      "append_alert",
      "release_lock",
    ]);
  });
});

// ── retry / backoff ──────────────────────────────────────────────────────────

describe("retryPlan — bounded transient retry + backoff (I6, bin/roll:9032-9072)", () => {
  it("exit 0 → accept (break)", () => {
    expect(retryPlan({ attempt: 1, exit: 0, timedOut: false })).toEqual({ action: "accept" });
  });
  it("timed out → abort_timeout (break, no retry)", () => {
    expect(retryPlan({ attempt: 1, exit: 0, timedOut: true })).toEqual({ action: "abort_timeout" });
  });
  it("fail before budget → retry with exponential backoff (NEW v3; base 30s)", () => {
    expect(retryPlan({ attempt: 1, exit: 1, timedOut: false })).toEqual({ action: "retry", nextAttempt: 2, backoffSec: 30 });
    expect(retryPlan({ attempt: 2, exit: 1, timedOut: false })).toEqual({ action: "retry", nextAttempt: 3, backoffSec: 60 });
  });
  it("fail at the budget → exhausted (NOT agent-swap, I6)", () => {
    expect(retryPlan({ attempt: MAX_AGENT_ATTEMPTS, exit: 1, timedOut: false })).toEqual({ action: "exhausted" });
  });
  it("backoffSchedule has maxAttempts-1 entries, doubling from base", () => {
    expect(backoffSchedule()).toEqual([RETRY_BASE_BACKOFF_SEC, RETRY_BASE_BACKOFF_SEC * 2]);
    expect(backoffSchedule(4, 10)).toEqual([10, 20, 40]);
  });
});

// ── SIGKILL mid-phase resumability (I2/I8) ───────────────────────────────────

describe("resumability — late/duplicate events are no-ops (I8)", () => {
  it("an event that doesn't apply to the current phase changes nothing", () => {
    let state = initialCycleState(CTX);
    state = cycleStep(state, { type: "start", ctx: CTX }).state;
    // A stray 'published' before the worktree even exists must be a no-op.
    const r = cycleStep(state, { type: "published", result: { status: 0 } });
    expect(r.commands).toEqual([]);
    expect(r.state.phase).toBe(state.phase);
    expect(r.state.done).toBe(false);
  });

  it("re-applying the terminal publish event is idempotent in outcome", () => {
    const evs: CycleEvent[] = [
      { type: "start", ctx: CTX },
      { type: "preflight_done" },
      { type: "worktree_created" },
      { type: "story_picked", storyId: "US-1" },
      { type: "route_resolved", agent: "claude", model: "sonnet" },
      { type: "budget_ok" },
      { type: "agent_exited", exit: 0, timedOut: false },
      { type: "facts_captured", facts: { usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 1 } },
      { type: "published", result: { status: 0 } },
    ];
    const first = walk(evs);
    // Replay the same published event again → same terminal.
    const again = cycleStep(first.state, { type: "published", result: { status: 0 } });
    expect(again.state.terminal).toBe("published");
  });
});

// ── event-sourcing round-trip (I8): serialize → parseEventLine → foldCycle ────

describe("event-sourcing round-trip (I8)", () => {
  /** Serialize RollEvents to ndjson, parse each back via the spec, fold. */
  function roundTrip(events: RollEvent[]) {
    const ndjson = events.map((e) => JSON.stringify(e)).join("\n");
    const parsed: RollEvent[] = [];
    for (const line of ndjson.split("\n")) {
      const ev = parseEventLine(line);
      if (ev !== null) parsed.push(ev);
    }
    return foldCycle(parsed);
  }

  it("rebuilds terminal 'delivered' from a done cycle stream", () => {
    const stream: RollEvent[] = [
      { type: "cycle:start", cycleId: "c1", storyId: "US-1", agent: "claude", model: "sonnet", ts: 1 },
      { type: "cycle:phase", cycleId: "c1", phase: "execute", ts: 2 },
      { type: "cycle:phase", cycleId: "c1", phase: "publish", ts: 3 },
      { type: "cycle:end", cycleId: "c1", outcome: "delivered", cost: { cycleId: "c1", agent: "claude", model: "sonnet", tokensIn: 0, tokensOut: 0, estimatedCost: 0, revertCount: 0, effectiveCost: 0 }, ts: 4 },
    ];
    const rebuilt = roundTrip(stream);
    expect(rebuilt.ended).toBe(true);
    expect(rebuilt.outcome).toBe("delivered");
    expect(rebuilt.storyId).toBe("US-1");
    expect(rebuilt.phases).toEqual(["execute", "publish"]);
  });

  it("SIGKILL mid-phase: no cycle:end → ended=false (recovery layer heals, I2)", () => {
    const stream: RollEvent[] = [
      { type: "cycle:start", cycleId: "c2", storyId: "FIX-9", agent: "pi", model: "k2", ts: 1 },
      { type: "cycle:phase", cycleId: "c2", phase: "execute", ts: 2 },
      // process SIGKILLed here — no cycle:end ever written.
    ];
    const rebuilt = roundTrip(stream);
    expect(rebuilt.ended).toBe(false);
    expect(rebuilt.outcome).toBeUndefined();
    expect(rebuilt.cycleId).toBe("c2");
  });

  it("the LAST cycle:end wins (idempotent re-emission)", () => {
    const stream: RollEvent[] = [
      { type: "cycle:start", cycleId: "c3", storyId: "US-3", agent: "claude", model: "sonnet", ts: 1 },
      { type: "cycle:end", cycleId: "c3", outcome: "failed", cost: { cycleId: "c3", agent: "claude", model: "sonnet", tokensIn: 0, tokensOut: 0, estimatedCost: 0, revertCount: 0, effectiveCost: 0 }, ts: 2 },
      { type: "cycle:end", cycleId: "c3", outcome: "delivered", cost: { cycleId: "c3", agent: "claude", model: "sonnet", tokensIn: 0, tokensOut: 0, estimatedCost: 0, revertCount: 0, effectiveCost: 0 }, ts: 3 },
    ];
    expect(roundTrip(stream).outcome).toBe("delivered");
  });

  it("a simulated cycle walk's emitted cycle:end folds back to the same outcome", () => {
    // Run the stepper, harvest its emit_event commands, round-trip them.
    const { commands } = walk([
      { type: "start", ctx: CTX },
      { type: "preflight_done" },
      { type: "worktree_created" },
      { type: "story_picked", storyId: "US-7" },
      { type: "route_resolved", agent: "claude", model: "sonnet" },
      { type: "budget_ok" },
      { type: "agent_exited", exit: 0, timedOut: false },
      { type: "facts_captured", facts: { usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 1 } },
      { type: "published", result: { status: 0 } },
    ]);
    const emitted = commands.filter((c): c is Extract<CycleCommand, { kind: "emit_event" }> => c.kind === "emit_event").map((c) => c.event);
    const rebuilt = roundTrip(emitted);
    expect(rebuilt.ended).toBe(true);
    expect(rebuilt.outcome).toBe("published_pending_merge");
  });
});
