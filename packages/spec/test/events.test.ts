import { describe, expect, it } from "vitest";
import { parseEventLine, type RollEvent } from "../src/types/events.js";

describe("parseEventLine (I8: readers skip bad lines, never crash)", () => {
  it("parses a valid cycle:start line", () => {
    const e = parseEventLine(
      '{"type":"cycle:start","cycleId":"c1","storyId":"US-1","agent":"claude","model":"opus","ts":1}',
    );
    expect(e).not.toBeNull();
    expect(e?.type).toBe("cycle:start");
  });
  it("returns null for blank, malformed, and shapeless lines", () => {
    expect(parseEventLine("")).toBeNull();
    expect(parseEventLine("   ")).toBeNull();
    expect(parseEventLine("{not json")).toBeNull();
    expect(parseEventLine('"just a string"')).toBeNull();
    expect(parseEventLine('{"type":"x"}')).toBeNull(); // no ts
    expect(parseEventLine('{"ts":1}')).toBeNull(); // no type
  });
  it("event union is exhaustive on type field at compile time", () => {
    const e: RollEvent = { type: "loop:fire", loop: "main", ts: 0 };
    expect(e.ts).toBe(0);
  });
  it("parses an attest:gate line (FIX-207)", () => {
    const e = parseEventLine(
      '{"type":"attest:gate","cycleId":"c1","verdict":"skipped","reasons":["no fresh report"],"ts":2}',
    );
    expect(e).not.toBeNull();
    expect(e?.type).toBe("attest:gate");
    const a: RollEvent = { type: "attest:gate", cycleId: "c", verdict: "produced", reasons: [], ts: 1 };
    expect(a.ts).toBe(1);
  });
  it("parses an evidence:frame-opened line (US-EVID-001)", () => {
    const e = parseEventLine(
      '{"type":"evidence:frame-opened","cycleId":"c1","storyId":"US-EVID-001","runDir":"/repo/.roll/features/e/US-EVID-001/c1","ts":3}',
    );
    expect(e).not.toBeNull();
    expect(e?.type).toBe("evidence:frame-opened");
    const a: RollEvent = { type: "evidence:frame-opened", cycleId: "c", storyId: "US-EVID-001", runDir: "/r", ts: 1 };
    expect(a.runDir).toBe("/r");
  });
  it("types goal lifecycle events (US-GOAL-001)", () => {
    const created: RollEvent = { type: "goal:created", schema: "goal.v1", scope: { kind: "epic", epic: "goal-mode" }, status: "active", review: "auto", ts: 1 };
    const state: RollEvent = { type: "goal:state", schema: "goal.v1", from: "active", to: "paused", actor: "system", reason: "owner_pause", ts: 2 };
    expect(created.type).toBe("goal:created");
    expect(created.review).toBe("auto");
    expect(state.to).toBe("paused");
  });
  it("types goal go session events (US-GOAL-002)", () => {
    const start: RollEvent = {
      type: "goal:session_start",
      sessionId: "goal-20260611-080000",
      scope: { kind: "all" },
      ts: 1_780_000_000,
    };
    const end: RollEvent = {
      type: "goal:session_end",
      sessionId: "goal-20260611-080000",
      status: "paused",
      reason: "pause_marker",
      cycles: 2,
      ts: 1_780_000_100,
    };
    const tickYield: RollEvent = {
      type: "goal:tick_skipped",
      reason: "go_session_lock",
      heldByPid: 123,
      ts: 1_780_000_001,
    };
    expect(start.type).toBe("goal:session_start");
    expect(end.cycles).toBe(2);
    expect(tickYield.reason).toBe("go_session_lock");
  });
  it("types goal truth evaluation events (US-GOAL-003)", () => {
    const evaluated: RollEvent = {
      type: "goal:evaluated",
      sessionId: "goal-20260611-090000",
      status: "continue",
      total: 1,
      delivered: 0,
      reason: "blocked:US-DRIFT:premature_done",
      blockers: ["US-DRIFT:fail:premature_done"],
      ts: 1_780_000_200,
    };
    expect(evaluated.type).toBe("goal:evaluated");
    expect(evaluated.blockers).toContain("US-DRIFT:fail:premature_done");
  });
  it("types goal card skip events (US-GOAL-004)", () => {
    const skipped: RollEvent = {
      type: "goal:card_skipped",
      sessionId: "goal-20260611-100000",
      storyId: "REFACTOR-048",
      reason: "zero_delivery_streak",
      zeroDeliveries: 2,
      cycleId: "cycle-2",
      ts: 1_780_000_300,
    };
    expect(skipped.type).toBe("goal:card_skipped");
    expect(skipped.zeroDeliveries).toBe(2);
  });

  it("types goal final review events (US-GOAL-006)", () => {
    const reviewed: RollEvent = {
      type: "goal:final_review",
      sessionId: "goal-20260611-100000",
      mode: "auto",
      effectiveMode: "hetero",
      reviewer: "codex",
      provider: "openai",
      verdict: "APPROVE",
      reason: "accepted",
      findings: ["AC and tests line up"],
      commandFamily: "codex",
      durationMs: 1250,
      transcriptPath: ".roll/peer/transcripts/review.txt",
      evidencePath: ".roll/peer/runs.jsonl",
      ts: 1_780_000_300,
    };
    const degraded: RollEvent = {
      type: "goal:review_degraded",
      sessionId: "goal-20260611-100000",
      from: "auto",
      to: "self",
      reviewer: "claude",
      provider: "anthropic",
      reason: "single_provider_available",
      ts: 1_780_000_301,
    };
    expect(reviewed.verdict).toBe("APPROVE");
    expect(reviewed.commandFamily).toBe("codex");
    expect(reviewed.durationMs).toBe(1250);
    expect(degraded.to).toBe("self");
  });

  it("parses + types story:split events (US-AGENT-042 self-downgrade)", () => {
    const e = parseEventLine(
      '{"type":"story:split","parentStoryId":"FIX-356","childStoryIds":["FIX-356a","FIX-356b"],"reason":"too big","chainDepth":0,"capped":false,"ts":5}',
    );
    expect(e).not.toBeNull();
    expect(e?.type).toBe("story:split");
    const split: RollEvent = {
      type: "story:split",
      parentStoryId: "FIX-356",
      childStoryIds: ["FIX-356a", "FIX-356b"],
      reason: "too big: 4 cuts",
      chainDepth: 0,
      capped: false,
      ts: 1,
    };
    const capped: RollEvent = {
      type: "story:split",
      parentStoryId: "US-X-a-1",
      childStoryIds: [],
      reason: "chain cap",
      chainDepth: 2,
      capped: true,
      ts: 2,
    };
    expect(split.childStoryIds).toHaveLength(2);
    expect(capped.capped).toBe(true);
    expect(capped.childStoryIds).toHaveLength(0);
  });

  it("types pair:score-failure events (FIX-910 — per-attempt score failure attribution)", () => {
    // Unparseable: reviewer answered but format didn't match strict protocol
    const unparseable: RollEvent = {
      type: "pair:score-failure",
      cycleId: "c1",
      peer: "pi",
      cause: "unparseable",
      detail: "SCORE: the delivery was good overall",
      stage: "score",
      ts: 1,
    };
    expect(unparseable.cause).toBe("unparseable");
    expect(unparseable.peer).toBe("pi");
    // Timeout: clean timeout, no external block detected
    const timeout: RollEvent = {
      type: "pair:score-failure",
      cycleId: "c2",
      peer: "kimi",
      cause: "timeout",
      stage: "score",
      ts: 2,
    };
    expect(timeout.cause).toBe("timeout");
    // Auth-block: external block surfaced by attributeBlockCause
    const authBlock: RollEvent = {
      type: "pair:score-failure",
      cycleId: "c3",
      peer: "codex",
      cause: "auth-block",
      detail: "401 Unauthorized",
      stage: "score",
      ts: 3,
    };
    expect(authBlock.cause).toBe("auth-block");
    // Exit-error: process exited non-zero, no auth/network signature
    const exitError: RollEvent = {
      type: "pair:score-failure",
      cycleId: "c4",
      peer: "claude",
      cause: "exit-error",
      detail: "Error: spawn failed",
      stage: "score",
      ts: 4,
    };
    expect(exitError.cause).toBe("exit-error");
    // With artifactPath (US-OBS-035 — raw output persisted)
    const withArtifact: RollEvent = {
      type: "pair:score-failure",
      cycleId: "c5",
      peer: "reasonix",
      cause: "unparseable",
      detail: "SCORE: good work",
      artifactPath: ".roll/loop/cycle-logs/c5/peer/reasonix.score.raw.txt",
      stage: "score",
      ts: 5,
    };
    expect(withArtifact.artifactPath).toBe(".roll/loop/cycle-logs/c5/peer/reasonix.score.raw.txt");
    // parseEventLine round-trips with artifactPath
    const parsed = parseEventLine(
      '{"type":"pair:score-failure","cycleId":"c1","peer":"pi","cause":"unparseable","detail":"malformed","stage":"score","ts":5}',
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("pair:score-failure");
    // parseEventLine round-trips artifactPath (US-OBS-035)
    const parsedWithArtifact = parseEventLine(
      '{"type":"pair:score-failure","cycleId":"c5","peer":"reasonix","cause":"unparseable","detail":"malformed","artifactPath":".roll/loop/cycle-logs/c5/peer/reasonix.score.raw.txt","stage":"score","ts":5}',
    );
    expect(parsedWithArtifact).not.toBeNull();
    expect(parsedWithArtifact?.type).toBe("pair:score-failure");
    if (parsedWithArtifact?.type === "pair:score-failure") {
      expect(parsedWithArtifact.artifactPath).toBe(".roll/loop/cycle-logs/c5/peer/reasonix.score.raw.txt");
    }
  });

  it("types goal safety gate trip events (US-GOAL-005; progress + timebox gates)", () => {
    const progress: RollEvent = {
      type: "goal:gate_tripped",
      sessionId: "goal-20260611-110000",
      gate: "progress",
      action: "paused",
      reason: "no_progress_breaker",
      reading: { noProgressCycles: 3, threshold: 3 },
      ts: 1_780_000_400,
    };
    const timebox: RollEvent = {
      type: "goal:gate_tripped",
      sessionId: "goal-20260611-110000",
      gate: "timebox",
      action: "paused",
      reason: "timebox",
      reading: { nowSec: 1_780_003_000, deadlineSec: 1_780_002_000 },
      ts: 1_780_000_401,
    };
    expect(progress.gate).toBe("progress");
    expect(timebox.gate).toBe("timebox");
  });

  // US-LOOP-079e: loop state events — compile-time union members + round-trip
  it("types loop:dormant event (US-LOOP-079e)", () => {
    const dormant: RollEvent = {
      type: "loop:dormant",
      loop: "main",
      ts: 1_780_000_000,
      reason: "all_done",
      since: 1_780_000_000,
    };
    expect(dormant.type).toBe("loop:dormant");
    expect(dormant.reason).toBe("all_done");
    expect(dormant.since).toBe(1_780_000_000);
  });

  it("types loop:woke event (US-LOOP-079e)", () => {
    const woke: RollEvent = {
      type: "loop:woke",
      loop: "main",
      ts: 1_780_000_100,
      trigger: "dream",
      picked: "REFACTOR-044",
      wakeEpoch: 1,
    };
    expect(woke.type).toBe("loop:woke");
    expect(woke.trigger).toBe("dream");
    expect(woke.picked).toBe("REFACTOR-044");
    // picked is optional
    const wokeNoPick: RollEvent = {
      type: "loop:woke",
      loop: "pr",
      ts: 1,
      trigger: "roll-cmd",
      wakeEpoch: 0,
    };
    expect(wokeNoPick.picked).toBeUndefined();
  });

  it("types loop:dormant_failed event (US-LOOP-079e)", () => {
    const failed: RollEvent = {
      type: "loop:dormant_failed",
      loop: "main",
      ts: 1_780_000_200,
      reason: "all_done",
      error: "launchctl bootout failed: ENOENT",
    };
    expect(failed.type).toBe("loop:dormant_failed");
    expect(failed.error).toContain("bootout");
  });

  it("parseEventLine round-trips loop:dormant/woke/dormant_failed (US-LOOP-079e)", () => {
    const dormant = parseEventLine(
      '{"type":"loop:dormant","loop":"main","ts":1,"reason":"all_done","since":100}',
    );
    expect(dormant).not.toBeNull();
    expect(dormant?.type).toBe("loop:dormant");

    const woke = parseEventLine(
      '{"type":"loop:woke","loop":"main","ts":2,"trigger":"dream","picked":"REFACTOR-044","wakeEpoch":1}',
    );
    expect(woke).not.toBeNull();
    expect(woke?.type).toBe("loop:woke");

    const failed = parseEventLine(
      '{"type":"loop:dormant_failed","loop":"main","ts":3,"reason":"all_done","error":"ENOENT"}',
    );
    expect(failed).not.toBeNull();
    expect(failed?.type).toBe("loop:dormant_failed");
  });

  it("parseEventLine rejects malformed loop:dormant/woke/dormant_failed lines (US-LOOP-079e)", () => {
    // missing ts
    expect(parseEventLine('{"type":"loop:dormant","loop":"main","reason":"x","since":1}')).toBeNull();
    // missing type
    expect(parseEventLine('{"ts":1,"loop":"main","reason":"x","since":1}')).toBeNull();
    // malformed JSON
    expect(parseEventLine('{type:loop:dormant}')).toBeNull();
    // wrong shape — no type field as string
    expect(parseEventLine('{"type":123,"ts":1}')).toBeNull();
  });
});
