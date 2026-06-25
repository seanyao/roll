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
  cycleEndEvent,
  cycleStep,
  foldCycle,
  initialCycleState,
  mapV2Status,
  retryPlan,
  timeoutTeardownCommands,
  watchdogVerdict,
  cycleTimeoutVerdict,
  agentStallVerdict,
  AGENT_STALL_IDLE_SEC,
  AGENT_STALL_STARTUP_EXEMPT_SEC,
  MAX_AGENT_ATTEMPTS,
  RETRY_BASE_BACKOFF_SEC,
  CYCLE_TIMEOUT_SEC,
  CYCLE_WALL_TIMEOUT_SEC,
  CYCLE_NO_PROGRESS_SEC,
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
  it("agent exit ≠ 0 + 0 commits → failed (bin/roll:9133)", () => {
    expect(classifyCaptured({ usedWorktree: true, agentExit: 1, timedOut: false, commitsAhead: 0 })).toBe("failed");
  });
  it("agent exit ≠ 0 + commits → built (non-zero exit with real work)", () => {
    expect(classifyCaptured({ usedWorktree: true, agentExit: 1, timedOut: false, commitsAhead: 3 })).toBe("built");
  });
  it("exit 0 + 0 commits + no agent executed → idle (genuine no-op, bin/roll:9180)", () => {
    expect(classifyCaptured({ usedWorktree: true, agentExecuted: false, agentExit: 0, timedOut: false, commitsAhead: 0 })).toBe("idle");
  });
  it("FIX-252: exit 0 + 0 branch commits but local main ahead origin → failed drift, not idle", () => {
    expect(classifyCaptured({ usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 0, mainAhead: 1 })).toBe("failed");
  });
  it("exit 0 + commits → built (bin/roll:9142)", () => {
    expect(classifyCaptured({ usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 2 })).toBe("built");
  });
});

describe("Hook 1 — productivity floor: gave_up vs idle", () => {
  it("agent EXECUTED + exit 0 + 0 commits → gave_up (failed-class), not idle", () => {
    expect(
      classifyCaptured({ usedWorktree: true, agentExecuted: true, agentExit: 0, timedOut: false, commitsAhead: 0 }),
    ).toBe("gave_up");
  });
  it("no agent executed (genuine no-op) → still idle, never gave_up", () => {
    expect(
      classifyCaptured({ usedWorktree: true, agentExecuted: false, agentExit: 0, timedOut: false, commitsAhead: 0 }),
    ).toBe("idle");
  });
  it("agentExecuted undefined defaults to executed (capture only follows a spawn) → gave_up", () => {
    expect(classifyCaptured({ usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 0 })).toBe("gave_up");
  });
  it("gave_up maps to its own terminal outcome (failed-class, not idle_no_work)", () => {
    expect(mapV2Status("gave_up")).toBe("gave_up");
  });
  it("a gave_up cycle cleans the worktree and ALERTs on the FIRST occurrence (no streak)", () => {
    const { state, kinds, commands } = walk([
      { type: "start", ctx: CTX },
      { type: "preflight_done" },
      { type: "worktree_created" },
      { type: "story_picked", storyId: "FIX-284" },
      { type: "route_resolved", agent: "codex", model: "" },
      { type: "agent_exited", exit: 0, timedOut: false },
      { type: "facts_captured", facts: { usedWorktree: true, agentExecuted: true, agentExit: 0, timedOut: false, commitsAhead: 0 } },
    ]);
    expect(state.terminal).toBe("gave_up");
    expect(kinds).toContain("cleanup_worktree");
    // ALERT is written on the FIRST gave_up — no 2-hit streak required.
    const alert = commands.find((c) => c.kind === "append_alert");
    expect(alert).toMatchObject({ message: expect.stringContaining("gave_up") });
    // The terminal runs row carries the gave_up status (failed-class).
    const run = commands.find((c) => c.kind === "append_run");
    expect(run).toMatchObject({ status: "gave_up", outcome: "gave_up" });
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
  it("non-zero exit + commits + no PR → built (agent did real work; publish ladder opens PR)", () => {
    expect(
      classifyCaptured({ usedWorktree: true, agentExit: 1, timedOut: false, commitsAhead: 3 }),
    ).toBe("built");
    expect(
      classifyCaptured({ usedWorktree: true, agentExit: 1, timedOut: false, commitsAhead: 3, prState: "UNKNOWN" }),
    ).toBe("built");
  });
  it("non-zero exit + 0 commits → failed (agent crashed without producing work)", () => {
    expect(
      classifyCaptured({ usedWorktree: true, agentExit: 1, timedOut: false, commitsAhead: 0 }),
    ).toBe("failed");
  });
  it("gateBlocked + commits → failed (policy rejection, not code defect)", () => {
    expect(
      classifyCaptured({ usedWorktree: true, agentExit: 0, gateBlocked: true, timedOut: false, commitsAhead: 3 }),
    ).toBe("failed");
  });
  it("gateBlocked + commits + existing PR → published (FIX-244 re-run)", () => {
    expect(
      classifyCaptured({ usedWorktree: true, agentExit: 0, gateBlocked: true, timedOut: false, commitsAhead: 3, prState: "OPEN" }),
    ).toBe("published");
  });
  // FIX-908: a gate-blocked cycle that did real work but is only missing a
  // required acceptance artifact is `needs_review` (work preserved), NOT `failed`.
  it("FIX-908: gateBlocked + commits + needsReview → needs_review (work preserved, not orphaned)", () => {
    expect(
      classifyCaptured({ usedWorktree: true, agentExit: 0, gateBlocked: true, timedOut: false, commitsAhead: 3, needsReview: true }),
    ).toBe("needs_review");
  });
  it("FIX-908: gateBlocked + ZERO commits + needsReview → failed (no real work to preserve)", () => {
    // needs_review is gated on real work; a 0-commit block can never escape failed.
    expect(
      classifyCaptured({ usedWorktree: true, agentExit: 0, gateBlocked: true, timedOut: false, commitsAhead: 0, needsReview: true }),
    ).toBe("failed");
  });
  it("FIX-908: gateBlocked + commits WITHOUT needsReview → failed (normal failed path unchanged)", () => {
    expect(
      classifyCaptured({ usedWorktree: true, agentExit: 0, gateBlocked: true, timedOut: false, commitsAhead: 3 }),
    ).toBe("failed");
  });
  it("FIX-908: existing PR pre-empts needs_review → published (FIX-244 takes precedence)", () => {
    expect(
      classifyCaptured({ usedWorktree: true, agentExit: 0, gateBlocked: true, timedOut: false, commitsAhead: 3, needsReview: true, prState: "MERGED" }),
    ).toBe("published");
  });
  it("FIX-908: needsReview never escapes a non-gateBlocked clean built cycle", () => {
    // A passing-gate built cycle ignores needsReview entirely (it is only set on a
    // gate block) — defends against any future caller leaking the flag onto a pass.
    expect(
      classifyCaptured({ usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 3, needsReview: true }),
    ).toBe("built");
  });
  it("FIX-908: mapV2Status(needs_review) → needs_review (distinct terminal outcome)", () => {
    expect(mapV2Status("needs_review")).toBe("needs_review");
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
  it("FIX-909: status 0 + draft manual review stays needs_review", () => {
    expect(classifyPublish({ status: 0, manualMerge: true, draft: true })).toBe("needs_review");
  });
  it("status 2 + mergedBack → done (gh missing, ff)", () => {
    expect(classifyPublish({ status: 2, mergedBack: true })).toBe("done");
  });
  it("manual merge + gh missing never counts merge_back as done", () => {
    // gh missing + manualMerge + a ff merge_back: not `done` (manual merge owes a
    // human). FIX-351: the WORK passed its gates and is committed locally, so this
    // is `local` (unpublished), NOT `failed` — only a GATE failure is `failed`.
    expect(classifyPublish({ status: 2, manualMerge: true, mergedBack: true })).toBe("local");
  });
  it("status 2 + orphanPushed → orphan", () => {
    expect(classifyPublish({ status: 2, orphanPushed: true })).toBe("orphan");
  });
  it("FIX-351: status 2 + neither (no merge-back, no orphan) → local (gates passed, unpublished)", () => {
    expect(classifyPublish({ status: 2 })).toBe("local");
  });
  it("PR-fail + orphanPushed → orphan", () => {
    expect(classifyPublish({ status: 1, orphanPushed: true })).toBe("orphan");
  });
  it("FIX-351: PR-fail + not pushed → local, NOT failed (work passed gates, only publish couldn't complete)", () => {
    expect(classifyPublish({ status: 1 })).toBe("local");
  });
});

describe("FIX-351 — gates-passed-but-unpublished is a neutral terminal, not a failure", () => {
  it("a `built` capture (gates passed: exit 0, commits>0) is the ONLY entry to the publish ladder", () => {
    // The publish ladder (classifyPublish) is only ever reached from a `built`
    // capture — i.e. a cycle whose gates already PASSED. So a publish that can't
    // complete is a sound cycle that didn't publish, not a gate failure.
    expect(classifyCaptured({ usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 2 })).toBe("built");
  });
  it("agent exit ≠ 0 with commits now reaches the publish ladder (built, not failed)", () => {
    // Non-zero exit from an agent that produced commits (e.g. pi exiting ≠0 after
    // a successful build) is now "built", giving the publish ladder a chance to
    // open a PR. CI + peer review catch real quality issues.
    expect(classifyCaptured({ usedWorktree: true, agentExit: 1, timedOut: false, commitsAhead: 1 })).toBe("built");
  });
  it("`local` v2 status maps to the neutral `unpublished` TerminalOutcome (never `failed`)", () => {
    expect(mapV2Status("local")).toBe("unpublished");
    expect(mapV2Status("local")).not.toBe("failed");
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
  it("US-LOOP-079d: dormant → dormant_entered (连续 N idle 后自卸)", () => {
    expect(mapV2Status("dormant")).toBe("dormant_entered");
  });
});

describe("US-TOOL-011 — tool costs in cycle:end", () => {
  it("threads ToolRegistry snapshot costs into the CycleCost payload", () => {
    const event = cycleEndEvent(
      {
        cycleId: "cycle-tools",
        branch: "loop/cycle-tools",
        agent: "codex",
        model: "gpt-5",
        toolCosts: [
          {
            toolId: "bash.exec" as never,
            invocations: 2,
            durationMs: 46,
            failures: 1,
            estimatedCost: 0,
            currency: "USD",
            inputBytes: 12,
            outputBytes: 34,
          },
        ],
      },
      "done",
      123,
    );

    expect(event).toMatchObject({
      type: "cycle:end",
      cycleId: "cycle-tools",
      outcome: "delivered",
      cost: {
        cycleId: "cycle-tools",
        toolCosts: [
          expect.objectContaining({
            toolId: "bash.exec",
            invocations: 2,
            durationMs: 46,
            failures: 1,
            inputBytes: 12,
            outputBytes: 34,
          }),
        ],
      },
    });
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
      { type: "agent_exited", exit: 0, timedOut: false },
      { type: "facts_captured", facts: { usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 2 } },
      { type: "published", result: { status: 0 } },
    ]);
    // The budget gate is REMOVED — route_resolved now emits spawn_agent directly
    // (no intermediate budget_check step).
    // FIX-382: cycle:start moved from worktree_created to route_resolved.
    expect(kinds).toEqual([
      "preflight",
      "create_worktree",
      "pick_story",
      "resume_worktree", // RESUME-PRIOR-WORK re-point (post-pick, before route/spawn)
      "resolve_route",
      "emit_event", // cycle:start (FIX-382: now emitted at route_resolved with real storyId+agent)
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

  it("RESUME wiring (FIX-284): story_picked emits resume_worktree with the picked id BEFORE resolve_route/spawn_agent", () => {
    // The resume decision MUST carry the freshly-picked story id (the pick runs
    // INSIDE the worktree, so storyId is undefined until story_picked), and must
    // happen before the agent spawns so the worktree can be re-pointed in time.
    const r = cycleStep(
      { ...initialCycleState(CTX), phase: "pick", worktreeReady: true },
      { type: "story_picked", storyId: "FIX-284" },
    );
    const resumeIdx = r.commands.findIndex((c) => c.kind === "resume_worktree");
    const routeIdx = r.commands.findIndex((c) => c.kind === "resolve_route");
    expect(resumeIdx).toBeGreaterThanOrEqual(0);
    expect(routeIdx).toBeGreaterThan(resumeIdx); // resume re-point precedes route → spawn
    expect(r.commands[resumeIdx]).toEqual({ kind: "resume_worktree", storyId: "FIX-284" });
    // The story id threaded into ctx is the picked one (feeds resolveResumeBase).
    expect(r.state.ctx.storyId).toBe("FIX-284");
  });

  it("FIX-909: needs_review publishes a draft/manual PR instead of silently ending", () => {
    const r = cycleStep(
      { ...initialCycleState(CTX), phase: "reconcile", ctx: { ...CTX, branch: "loop/cycle-x", storyId: "FIX-909" } },
      {
        type: "facts_captured",
        facts: { usedWorktree: true, agentExit: 0, gateBlocked: true, needsReview: true, timedOut: false, commitsAhead: 2 },
      },
    );
    expect(r.state.phase).toBe("publish");
    expect(r.commands).toEqual([{ kind: "publish_pr", branch: "loop/cycle-x", docOnly: false, manualMerge: true, draft: true }]);
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

  it("FIX-252: local-main drift fails loud, saves rescue ref, leaves worktree, and writes an alert", () => {
    const { state, kinds, commands } = walk([
      { type: "start", ctx: CTX },
      { type: "preflight_done" },
      { type: "worktree_created" },
      { type: "story_picked", storyId: "FIX-252" },
      { type: "route_resolved", agent: "pi", model: "" },
      { type: "agent_exited", exit: 0, timedOut: false },
      { type: "facts_captured", facts: { usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 0, mainAhead: 1 } },
    ]);
    expect(state.terminal).toBe("failed");
    expect(kinds).not.toContain("cleanup_worktree");
    // FIX-903: rescue_leaked saves commits before alert + terminal
    expect(kinds.slice(-4)).toEqual(["rescue_leaked", "append_alert", "emit_event", "append_run"]);
    expect(commands.find((c) => c.kind === "rescue_leaked")).toMatchObject({
      kind: "rescue_leaked",
      cycleId: CTX.cycleId,
    });
    expect(commands.find((c) => c.kind === "append_alert")).toMatchObject({
      message: expect.stringContaining("local main is ahead of origin/main"),
    });
  });

  it("worktree setup fail → failed + tolerant worktree cleanup", () => {
    const { state, kinds } = walk([
      { type: "start", ctx: CTX },
      { type: "preflight_done" },
      { type: "worktree_failed" },
    ]);
    expect(state.terminal).toBe("failed");
    expect(kinds.slice(-3)).toEqual(["cleanup_worktree", "emit_event", "append_run"]);
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
      { type: "agent_exited", exit: 0, timedOut: false },
      { type: "facts_captured", facts: { usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 1 } },
      { type: "published", result: { status: 2, mergedBack: true } },
    ]);
    expect(state.terminal).toBe("done");
  });

  it("publish PR-fail + orphan pushed → orphan; not pushed → local (FIX-351, worktree preserved)", () => {
    const orphan = walk([
      { type: "start", ctx: CTX },
      { type: "preflight_done" },
      { type: "worktree_created" },
      { type: "story_picked", storyId: "US-1" },
      { type: "route_resolved", agent: "claude", model: "sonnet" },
      { type: "agent_exited", exit: 0, timedOut: false },
      { type: "facts_captured", facts: { usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 1 } },
      { type: "published", result: { status: 1, orphanPushed: true } },
    ]);
    expect(orphan.state.terminal).toBe("orphan");
    expect(orphan.kinds).toContain("cleanup_worktree");

    // FIX-351: a gates-passed (`built`) cycle whose publish couldn't complete and
    // whose orphan branch wasn't pushed is `local` (unpublished), NOT `failed` —
    // the work is sound and committed; only the publish step didn't land. This is
    // FIX-313's exact shape (3 TCR commits, attest produced, peer consulted, then
    // a publish that couldn't complete) — it must no longer paint the cycle red.
    const local = walk([
      { type: "start", ctx: CTX },
      { type: "preflight_done" },
      { type: "worktree_created" },
      { type: "story_picked", storyId: "US-1" },
      { type: "route_resolved", agent: "claude", model: "sonnet" },
      { type: "agent_exited", exit: 0, timedOut: false },
      { type: "facts_captured", facts: { usedWorktree: true, agentExit: 0, timedOut: false, commitsAhead: 1 } },
      { type: "published", result: { status: 1 } },
    ]);
    expect(local.state.terminal).toBe("local");
    expect(local.state.terminal).not.toBe("failed");
    // worktree PRESERVED on publish-fail (bin/roll:9337) — no cleanup command,
    // so the local commits stay recoverable on the branch.
    expect(local.kinds).not.toContain("cleanup_worktree");
  });

  it("agent exit ≠ 0 with commits → built → enters publish ladder (not failed)", () => {
    // Non-zero exit + commits = agent did real work. It now classifies as "built"
    // and enters the publish ladder to open a PR. CI + peer review catch issues.
    const built = walk([
      { type: "start", ctx: CTX },
      { type: "preflight_done" },
      { type: "worktree_created" },
      { type: "story_picked", storyId: "US-1" },
      { type: "route_resolved", agent: "claude", model: "sonnet" },
      { type: "agent_exited", exit: 0, timedOut: false },
      { type: "facts_captured", facts: { usedWorktree: true, agentExit: 1, timedOut: false, commitsAhead: 1 } },
    ]);
    // built → enters publish phase
    expect(built.state.phase).toBe("publish");
    expect(built.kinds).toContain("publish_pr");
  });

  it("route_resolved spawns the agent directly (budget gate removed)", () => {
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
    const cmds = drive({ type: "route_resolved", agent: "claude", model: "opus" });
    // FIX-382: route_resolved now emits cycle:start (with resolved storyId+agent) before spawn.
    expect(cmds.map((c) => c.kind)).toEqual(["emit_event", "spawn_agent"]);
    expect(state.phase).toBe("execute");
    expect(state.attempt).toBe(1);
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

describe("FIX-907 — cycleTimeoutVerdict (per-cycle hard timeout: wall + no-progress)", () => {
  it("defaults are 45min wall / 15min no-progress", () => {
    expect(CYCLE_WALL_TIMEOUT_SEC).toBe(2700);
    expect(CYCLE_NO_PROGRESS_SEC).toBe(900);
  });

  it("not timed out below both limits — reports the tighter remaining budget", () => {
    const v = cycleTimeoutVerdict({ elapsedSec: 100, idleSec: 60, wallLimitSec: 2700, noProgressLimitSec: 900 });
    // wall remaining 2600, idle remaining 840 → tighter is 840.
    expect(v).toEqual({ timedOut: false, remainingSec: 840 });
  });

  it("WALL breach at the boundary (>=) is attributed to wall", () => {
    const v = cycleTimeoutVerdict({ elapsedSec: 2700, idleSec: 10, wallLimitSec: 2700, noProgressLimitSec: 900 });
    expect(v).toEqual({ timedOut: true, reason: "wall", elapsedSec: 2700, idleSec: 10 });
  });

  it("NO-PROGRESS breach (silent hang) when idle exceeds the window but wall is fine", () => {
    const v = cycleTimeoutVerdict({ elapsedSec: 1000, idleSec: 900, wallLimitSec: 2700, noProgressLimitSec: 900 });
    expect(v).toEqual({ timedOut: true, reason: "no-progress", elapsedSec: 1000, idleSec: 900 });
  });

  it("误杀-prevention: a slow-but-progressing call (high elapsed, LOW idle) does NOT trip", () => {
    // 40min into the cycle but progress 30s ago (e.g. a slow deepseek call still
    // emitting stdout) — neither criterion fires.
    const v = cycleTimeoutVerdict({ elapsedSec: 2400, idleSec: 30, wallLimitSec: 2700, noProgressLimitSec: 900 });
    expect(v.timedOut).toBe(false);
  });

  it("WALL wins when BOTH would trip (attribution is wall-first)", () => {
    const v = cycleTimeoutVerdict({ elapsedSec: 3000, idleSec: 1000, wallLimitSec: 2700, noProgressLimitSec: 900 });
    expect(v).toEqual({ timedOut: true, reason: "wall", elapsedSec: 3000, idleSec: 1000 });
  });

  it("a 0 / negative limit DISABLES that criterion (operator escape hatch)", () => {
    // wall disabled → a huge elapsed never trips on wall; idle still guards.
    expect(cycleTimeoutVerdict({ elapsedSec: 1e9, idleSec: 10, wallLimitSec: 0, noProgressLimitSec: 900 }).timedOut).toBe(false);
    // both disabled → never times out.
    expect(cycleTimeoutVerdict({ elapsedSec: 1e9, idleSec: 1e9, wallLimitSec: 0, noProgressLimitSec: 0 }).timedOut).toBe(false);
    // no-progress disabled, idle huge, wall fine → still alive.
    expect(cycleTimeoutVerdict({ elapsedSec: 100, idleSec: 1e9, wallLimitSec: 2700, noProgressLimitSec: -1 }).timedOut).toBe(false);
  });

  it("uses the core defaults when limits are omitted", () => {
    expect(cycleTimeoutVerdict({ elapsedSec: 2700, idleSec: 0 })).toMatchObject({ timedOut: true, reason: "wall" });
    expect(cycleTimeoutVerdict({ elapsedSec: 1000, idleSec: 900 })).toMatchObject({ timedOut: true, reason: "no-progress" });
    expect(cycleTimeoutVerdict({ elapsedSec: 10, idleSec: 10 }).timedOut).toBe(false);
  });
});

describe("FIX-929 — agentStallVerdict (observational silent-hang signal)", () => {
  it("default idle window is shorter than the no-progress KILL window", () => {
    // The whole point: a stall must be OBSERVED before the no-progress watchdog
    // would kill, so the self-heal ladder has a chance to act.
    expect(AGENT_STALL_IDLE_SEC).toBe(300);
    expect(AGENT_STALL_STARTUP_EXEMPT_SEC).toBe(120);
    expect(AGENT_STALL_IDLE_SEC).toBeLessThan(CYCLE_NO_PROGRESS_SEC);
  });

  it("NOT stalled while still emitting tokens (idle below the window)", () => {
    const v = agentStallVerdict({ sinceSpawnSec: 1000, idleSinceTokenSec: 60, idleLimitSec: 300, startupExemptSec: 120 });
    expect(v).toEqual({ stalled: false });
  });

  it("STALLED once idle-since-token crosses the window (boundary >=)", () => {
    const v = agentStallVerdict({ sinceSpawnSec: 1000, idleSinceTokenSec: 300, idleLimitSec: 300, startupExemptSec: 120 });
    expect(v).toEqual({ stalled: true, idleSec: 300 });
  });

  it("startup-exempt: a silent agent within the warmup window is NOT stalled", () => {
    // 119s after spawn, fully idle — still warming up, no false positive.
    const v = agentStallVerdict({ sinceSpawnSec: 119, idleSinceTokenSec: 119, idleLimitSec: 300, startupExemptSec: 120 });
    expect(v).toEqual({ stalled: false });
  });

  it("past the exempt window, a long idle IS a stall", () => {
    const v = agentStallVerdict({ sinceSpawnSec: 500, idleSinceTokenSec: 480, idleLimitSec: 300, startupExemptSec: 120 });
    expect(v).toEqual({ stalled: true, idleSec: 480 });
  });

  it("a 0 / negative idle limit DISABLES stall detection (operator escape hatch)", () => {
    expect(agentStallVerdict({ sinceSpawnSec: 1e9, idleSinceTokenSec: 1e9, idleLimitSec: 0 })).toEqual({ stalled: false });
    expect(agentStallVerdict({ sinceSpawnSec: 1e9, idleSinceTokenSec: 1e9, idleLimitSec: -1 })).toEqual({ stalled: false });
  });

  it("uses the core defaults when limits are omitted", () => {
    // idle 300 ≥ default 300, spawn 400 ≥ default exempt 120 → stalled.
    expect(agentStallVerdict({ sinceSpawnSec: 400, idleSinceTokenSec: 300 })).toEqual({ stalled: true, idleSec: 300 });
    // idle 299 < 300 → not yet.
    expect(agentStallVerdict({ sinceSpawnSec: 400, idleSinceTokenSec: 299 })).toEqual({ stalled: false });
    // within default 120s exempt → not stalled regardless of idle.
    expect(agentStallVerdict({ sinceSpawnSec: 100, idleSinceTokenSec: 1e9 })).toEqual({ stalled: false });
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
  it("fail at the retry budget → exhausted (NOT agent-swap, I6)", () => {
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
