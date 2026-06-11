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
    const created: RollEvent = { type: "goal:created", schema: "goal.v1", scope: { kind: "epic", epic: "goal-mode" }, status: "active", ts: 1 };
    const state: RollEvent = { type: "goal:state", schema: "goal.v1", from: "active", to: "paused", actor: "system", reason: "owner_pause", ts: 2 };
    expect(created.type).toBe("goal:created");
    expect(state.to).toBe("paused");
  });
});
