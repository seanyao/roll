/**
 * US-OBS-026 — cycleActivityFromEvents projection function tests (AC3, AC4).
 *
 * AC3: agent-agnostic projection from RollEvent[] → CycleActivityEvent[],
 *      using only durable facts from events.ndjson.
 * AC4: deterministic fixture → stable output; torn/unknown events skipped;
 *      missing fields degraded gracefully; no crash.
 */
import { describe, expect, it } from "vitest";
import type { RollEvent } from "@roll/spec";
import { cycleActivityFromEvents } from "../src/loop/cycle-activity.js";

// ════════════════════════════════════════════════════════════════════════════
// AC4 — deterministic fixture → stable CycleActivityEvent[].
// ════════════════════════════════════════════════════════════════════════════

const CYCLE_ID = "cycle-20260620-1";

/** A realistic events.ndjson slice for one cycle. */
const fixture: RollEvent[] = [
  { type: "cycle:start", cycleId: CYCLE_ID, storyId: "US-OBS-026", agent: "claude", model: "opus", ts: 1000 },
  { type: "cycle:phase", cycleId: CYCLE_ID, phase: "execute", ts: 2000 },
  { type: "cycle:first_edit", cycleId: CYCLE_ID, commitHash: "abc1234def", ts: 30000 },
  { type: "cycle:tcr", cycleId: CYCLE_ID, commitHash: "abc1234def", message: "tcr: define CycleActivityEvent type", ts: 31000, commitTs: 30000 },
  { type: "cycle:tcr", cycleId: CYCLE_ID, commitHash: "def5678abc", message: "tcr: add projection function", ts: 60000, commitTs: 59000 },
  { type: "cycle:stdout", cycleId: CYCLE_ID, data: "heartbeat: building · still working (1) · 2m quiet · 2 tcr so far", ts: 120000 },
  { type: "cycle:phase", cycleId: CYCLE_ID, phase: "publish", ts: 180000 },
  { type: "peer:gate", cycleId: CYCLE_ID, verdict: "consulted", reasons: ["hetero peer reviewed"], ts: 190000 },
  { type: "attest:gate", cycleId: CYCLE_ID, verdict: "produced", reasons: [], ts: 200000 },
  { type: "pr:open", prNumber: 999, storyId: "US-OBS-026", ts: 210000 },
  { type: "ci:pass", prNumber: 999, ts: 250000 },
  { type: "pr:merge", prNumber: 999, storyId: "US-OBS-026", ts: 260000 },
  { type: "cycle:end", cycleId: CYCLE_ID, outcome: "delivered", cost: { cycleId: CYCLE_ID, agent: "claude", model: "opus", tokensIn: 5000, tokensOut: 2000, estimatedCost: 0.15, revertCount: 0, effectiveCost: 0.15, currency: "USD" }, ts: 270000 },
];

describe("cycleActivityFromEvents — AC3 agent-agnostic projection", () => {
  it("produces a stable, deterministic output from a known fixture (snapshot)", () => {
    const result = cycleActivityFromEvents(fixture, CYCLE_ID);
    // Snapshot to lock the contract.
    expect(result).toMatchSnapshot();
  });

  it("returns lifecycle events for cycle:start and cycle:end", () => {
    const result = cycleActivityFromEvents(fixture, CYCLE_ID);
    const lifecycles = result.filter((e) => e.kind === "lifecycle");
    expect(lifecycles).toHaveLength(2);
    expect(lifecycles[0]!.kind).toBe("lifecycle");
    if (lifecycles[0]!.kind === "lifecycle") {
      expect(lifecycles[0]!.payload.event).toBe("cycle:start");
      expect(lifecycles[0]!.payload.detail).toBe("US-OBS-026");
    }
    if (lifecycles[1]!.kind === "lifecycle") {
      expect(lifecycles[1]!.payload.event).toBe("cycle:end");
      expect(lifecycles[1]!.payload.detail).toBe("delivered");
    }
  });

  it("maps cycle:phase events to kind=phase", () => {
    const result = cycleActivityFromEvents(fixture, CYCLE_ID);
    const phases = result.filter((e) => e.kind === "phase");
    expect(phases).toHaveLength(2);
    if (phases[0]!.kind === "phase") expect(phases[0]!.payload.phase).toBe("execute");
    if (phases[1]!.kind === "phase") expect(phases[1]!.payload.phase).toBe("publish");
  });

  it("maps cycle:tcr and cycle:first_edit to kind=tcr", () => {
    const result = cycleActivityFromEvents(fixture, CYCLE_ID);
    const tcrs = result.filter((e) => e.kind === "tcr");
    expect(tcrs).toHaveLength(3); // 1 first_edit + 2 tcrs
    // first_edit is the first tcr entry
    if (tcrs[0]!.kind === "tcr") {
      expect(tcrs[0]!.payload.firstEdit).toBe(true);
      expect(tcrs[0]!.payload.commitHash).toBe("abc1234def");
    }
    if (tcrs[1]!.kind === "tcr") {
      expect(tcrs[1]!.payload.firstEdit).toBe(false);
      expect(tcrs[1]!.payload.message).toContain("define CycleActivityEvent");
      expect(tcrs[1]!.payload.commitTs).toBe(30000);
    }
  });

  it("maps cycle:stdout to kind=stdout", () => {
    const result = cycleActivityFromEvents(fixture, CYCLE_ID);
    const stdouts = result.filter((e) => e.kind === "stdout");
    expect(stdouts).toHaveLength(1);
    if (stdouts[0]!.kind === "stdout") {
      expect(stdouts[0]!.payload.data).toContain("heartbeat:");
    }
  });

  it("maps gate events (ci/pr/peer/attest) to kind=gate", () => {
    const result = cycleActivityFromEvents(fixture, CYCLE_ID);
    const gates = result.filter((e) => e.kind === "gate");
    // peer:gate, attest:gate, pr:open, ci:pass, pr:merge = 5 gates
    expect(gates.length).toBe(5);
    const gateTypes = gates.map((g) => (g.kind === "gate" ? g.payload.gate : ""));
    expect(gateTypes).toContain("peer");
    expect(gateTypes).toContain("attest");
    expect(gateTypes).toContain("pr");
    expect(gateTypes).toContain("ci");
  });

  it("output is chronological (sorted by ts)", () => {
    const result = cycleActivityFromEvents(fixture, CYCLE_ID);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.ts).toBeGreaterThanOrEqual(result[i - 1]!.ts);
    }
  });

  it("carries the agent field from cycle:start across all events", () => {
    const result = cycleActivityFromEvents(fixture, CYCLE_ID);
    for (const ev of result) {
      expect(ev.agent).toBe("claude");
    }
  });
});

describe("cycleActivityFromEvents — AC4 robustness", () => {
  it("returns empty array for empty input", () => {
    expect(cycleActivityFromEvents([], CYCLE_ID)).toEqual([]);
  });

  it("filters events by cycleId — only matching events are included", () => {
    const mixed: RollEvent[] = [
      { type: "cycle:start", cycleId: "other-cycle", storyId: "X", agent: "pi", model: "m", ts: 1 },
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "Y", agent: "claude", model: "m", ts: 2 },
    ];
    const result = cycleActivityFromEvents(mixed, CYCLE_ID);
    expect(result).toHaveLength(1);
    if (result[0]!.kind === "lifecycle") {
      expect(result[0]!.payload.detail).toBe("Y");
    }
  });

  it("skips unknown/unrelated event types without throwing", () => {
    const withUnknown: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "Z", agent: "pi", model: "m", ts: 1 },
      { type: "loop:fire", loop: "main", ts: 2 } as RollEvent,
      { type: "goal:created", schema: "goal.v1", scope: { kind: "all" }, status: "active", review: "auto", ts: 3 } as RollEvent,
      { type: "story:split", parentStoryId: "X", childStoryIds: [], reason: "cap", chainDepth: 2, capped: true, ts: 4 } as RollEvent,
    ];
    const result = cycleActivityFromEvents(withUnknown, CYCLE_ID);
    // Only cycle:start should be included.
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe("lifecycle");
  });

  it("handles torn/malformed fields gracefully — missing optional fields degrade without throw", () => {
    // A tcr event with no commitTs (optional) — should still produce valid output.
    const minimal: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "", agent: "", model: "", ts: 1 },
      { type: "cycle:tcr", cycleId: CYCLE_ID, commitHash: "aaa", message: "", ts: 2 },
    ];
    const result = cycleActivityFromEvents(minimal, CYCLE_ID);
    expect(result).toHaveLength(2);
    expect(result[1]!.kind).toBe("tcr");
    if (result[1]!.kind === "tcr") {
      expect(result[1]!.payload.commitHash).toBe("aaa");
      expect(result[1]!.payload.message).toBe("");
      expect(result[1]!.payload.commitTs).toBeUndefined();
    }
  });

  it("cycle with only start+end produces minimal valid output", () => {
    const skeleton: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "US-MIN", agent: "pi", model: "m", ts: 1 },
      { type: "cycle:end", cycleId: CYCLE_ID, outcome: "failed", cost: { cycleId: CYCLE_ID, agent: "pi", model: "m", tokensIn: 0, tokensOut: 0, estimatedCost: 0, revertCount: 0, effectiveCost: 0, currency: "USD" }, ts: 2 },
    ];
    const result = cycleActivityFromEvents(skeleton, CYCLE_ID);
    expect(result).toHaveLength(2);
    expect(result[0]!.kind).toBe("lifecycle");
    expect(result[1]!.kind).toBe("lifecycle");
  });
});

describe("cycleActivityFromEvents — idempotent and deterministic", () => {
  it("same input produces byte-identical output across calls", () => {
    const a = JSON.stringify(cycleActivityFromEvents(fixture, CYCLE_ID));
    const b = JSON.stringify(cycleActivityFromEvents(fixture, CYCLE_ID));
    expect(a).toBe(b);
  });

  it("output is not affected by event insertion order in same-ts edge case", () => {
    const reversed = [...fixture].reverse();
    const forward = cycleActivityFromEvents(fixture, CYCLE_ID);
    const backward = cycleActivityFromEvents(reversed, CYCLE_ID);
    // Both should produce the same sorted output.
    expect(backward).toEqual(forward);
  });
});
