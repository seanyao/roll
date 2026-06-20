/**
 * US-OBS-026 — CycleActivityEvent type + parse helper tests (AC4, AC5).
 *
 * AC4: deterministic parse; torn/unknown lines skipped without crash;
 *      missing fields degrade without throw.
 * AC5: full round-trip JSON serialize/deserialize stable; no diff/patch
 *      fields (contract is full event stream, not incremental protocol).
 */
import { describe, expect, it } from "vitest";
import {
  parseCycleActivityLine,
  type CycleActivityEvent,
} from "../src/types/cycle-activity.js";

// ════════════════════════════════════════════════════════════════════════════
// AC4 — parse helper tolerates torn / unknown / missing input without crash.
// ════════════════════════════════════════════════════════════════════════════

describe("parseCycleActivityLine — AC4 robustness", () => {
  it("parses a lifecycle event", () => {
    const e = parseCycleActivityLine(
      JSON.stringify({
        kind: "lifecycle",
        cycle_id: "c1",
        ts: 1000,
        agent: "claude",
        payload: { event: "cycle:start", detail: "US-OBS-026" },
      }),
    );
    expect(e).not.toBeNull();
    expect(e?.kind).toBe("lifecycle");
    if (e?.kind === "lifecycle") {
      expect(e.payload.event).toBe("cycle:start");
      expect(e.payload.detail).toBe("US-OBS-026");
    }
  });

  it("parses a phase event", () => {
    const e = parseCycleActivityLine(
      JSON.stringify({
        kind: "phase",
        cycle_id: "c1",
        ts: 2000,
        agent: "",
        payload: { phase: "execute" },
      }),
    );
    expect(e).not.toBeNull();
    expect(e?.kind).toBe("phase");
    if (e?.kind === "phase") {
      expect(e.payload.phase).toBe("execute");
    }
  });

  it("parses a tcr event", () => {
    const e = parseCycleActivityLine(
      JSON.stringify({
        kind: "tcr",
        cycle_id: "c1",
        ts: 3000,
        agent: "claude",
        payload: {
          commitHash: "abc1234",
          message: "tcr: add thing",
          commitTs: 2999,
          firstEdit: true,
        },
      }),
    );
    expect(e).not.toBeNull();
    expect(e?.kind).toBe("tcr");
    if (e?.kind === "tcr") {
      expect(e.payload.commitHash).toBe("abc1234");
      expect(e.payload.firstEdit).toBe(true);
    }
  });

  it("parses a gate event", () => {
    const e = parseCycleActivityLine(
      JSON.stringify({
        kind: "gate",
        cycle_id: "c1",
        ts: 4000,
        agent: "",
        payload: { gate: "ci", verdict: "fail", detail: "3 tests failed", ref: "#42" },
      }),
    );
    expect(e).not.toBeNull();
    expect(e?.kind).toBe("gate");
    if (e?.kind === "gate") {
      expect(e.payload.gate).toBe("ci");
      expect(e.payload.verdict).toBe("fail");
      expect(e.payload.ref).toBe("#42");
    }
  });

  it("parses a stdout event", () => {
    const e = parseCycleActivityLine(
      JSON.stringify({
        kind: "stdout",
        cycle_id: "c1",
        ts: 5000,
        agent: "",
        payload: { data: "heartbeat: building..." },
      }),
    );
    expect(e).not.toBeNull();
    expect(e?.kind).toBe("stdout");
    if (e?.kind === "stdout") {
      expect(e.payload.data).toContain("heartbeat");
    }
  });

  it("returns null for blank / whitespace lines", () => {
    expect(parseCycleActivityLine("")).toBeNull();
    expect(parseCycleActivityLine("   ")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseCycleActivityLine("{not json")).toBeNull();
    expect(parseCycleActivityLine("garbage")).toBeNull();
  });

  it("returns null for JSON missing required fields (kind / cycle_id / ts)", () => {
    expect(parseCycleActivityLine('{"kind":"lifecycle"}')).toBeNull();
    expect(parseCycleActivityLine('{"cycle_id":"c1","ts":1}')).toBeNull();
    expect(parseCycleActivityLine('{"kind":"lifecycle","cycle_id":"c1"}')).toBeNull();
  });

  it("returns null for non-object JSON (string, number, array)", () => {
    expect(parseCycleActivityLine('"just a string"')).toBeNull();
    expect(parseCycleActivityLine("42")).toBeNull();
    expect(parseCycleActivityLine("[1,2,3]")).toBeNull();
  });

  it("never throws on any input", () => {
    const inputs = ["", "   ", "{", "null", '{"kind":}', "\x00\x01", "undefined"];
    for (const raw of inputs) {
      expect(() => parseCycleActivityLine(raw)).not.toThrow();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AC5 — round-trip: serialize → deserialize is stable, no fields lost.
// ════════════════════════════════════════════════════════════════════════════

describe("CycleActivityEvent — AC5 round-trip stability", () => {
  const roundTrip = (ev: CycleActivityEvent): CycleActivityEvent | null =>
    parseCycleActivityLine(JSON.stringify(ev));

  it("lifecycle round-trip preserves all fields", () => {
    const ev: CycleActivityEvent = {
      kind: "lifecycle",
      cycle_id: "cycle-20260620-1",
      ts: 1_780_000_000_000,
      agent: "claude",
      payload: { event: "cycle:start", detail: "US-OBS-026 标准契约" },
    };
    const rt = roundTrip(ev);
    expect(rt).toEqual(ev);
  });

  it("phase round-trip preserves all fields", () => {
    const ev: CycleActivityEvent = {
      kind: "phase",
      cycle_id: "cycle-20260620-1",
      ts: 1_780_000_001_000,
      agent: "",
      payload: { phase: "execute" },
    };
    expect(roundTrip(ev)).toEqual(ev);
  });

  it("tcr round-trip preserves all fields including optional commitTs and firstEdit", () => {
    const ev: CycleActivityEvent = {
      kind: "tcr",
      cycle_id: "cycle-20260620-1",
      ts: 1_780_000_010_000,
      agent: "claude",
      payload: {
        commitHash: "deadbeef",
        message: "tcr: define CycleActivityEvent type",
        commitTs: 1_780_000_009_000,
        firstEdit: false,
      },
    };
    expect(roundTrip(ev)).toEqual(ev);

    // without optional fields
    const minimal: CycleActivityEvent = {
      kind: "tcr",
      cycle_id: "c1",
      ts: 1,
      agent: "",
      payload: { commitHash: "abc", message: "fix" },
    };
    expect(roundTrip(minimal)).toEqual(minimal);
  });

  it("gate round-trip preserves all fields including optional detail and ref", () => {
    const full: CycleActivityEvent = {
      kind: "gate",
      cycle_id: "cycle-20260620-1",
      ts: 1_780_000_020_000,
      agent: "",
      payload: { gate: "peer", verdict: "consulted", detail: "kimi → claude", ref: "kimi" },
    };
    expect(roundTrip(full)).toEqual(full);

    const minimal: CycleActivityEvent = {
      kind: "gate",
      cycle_id: "c1",
      ts: 1,
      agent: "",
      payload: { gate: "ci", verdict: "pass" },
    };
    expect(roundTrip(minimal)).toEqual(minimal);
  });

  it("stdout round-trip preserves all fields", () => {
    const ev: CycleActivityEvent = {
      kind: "stdout",
      cycle_id: "cycle-20260620-1",
      ts: 1_780_000_030_000,
      agent: "",
      payload: { data: "heartbeat: building · still working (3) · 6m quiet · 5 tcr so far" },
    };
    expect(roundTrip(ev)).toEqual(ev);
  });

  it("tool_call round-trip preserves all fields (forward-compat)", () => {
    const ev: CycleActivityEvent = {
      kind: "tool_call",
      cycle_id: "cycle-20260620-1",
      ts: 1_780_000_040_000,
      agent: "claude",
      payload: { tool: "Bash", input: { command: "pnpm test" } },
    };
    expect(roundTrip(ev)).toEqual(ev);
  });

  it("tool_result round-trip preserves all fields (forward-compat)", () => {
    const ev: CycleActivityEvent = {
      kind: "tool_result",
      cycle_id: "cycle-20260620-1",
      ts: 1_780_000_041_000,
      agent: "claude",
      payload: { tool: "Bash", isError: false, summary: "5 passed" },
    };
    expect(roundTrip(ev)).toEqual(ev);
  });

  it("state_change round-trip preserves all fields", () => {
    const ev: CycleActivityEvent = {
      kind: "state_change",
      cycle_id: "cycle-20260620-1",
      ts: 1_780_000_050_000,
      agent: "",
      payload: { from: "building", to: "publishing", reason: "all tcr green" },
    };
    expect(roundTrip(ev)).toEqual(ev);
  });

  it("discriminated union narrows correctly on kind (compile-time + runtime)", () => {
    const ev: CycleActivityEvent = {
      kind: "lifecycle",
      cycle_id: "c1",
      ts: 1,
      agent: "",
      payload: { event: "cycle:start" },
    };
    // Runtime narrowing
    if (ev.kind === "lifecycle") {
      expect(ev.payload.event).toBe("cycle:start");
    } else if (ev.kind === "tcr") {
      expect.unreachable("should not be tcr");
    }
  });

  it("no diff/patch fields present in any variant (AC5)", () => {
    // The contract is a full event stream — serialize each variant and
    // verify no field named "diff", "patch", "delta", or "changes" exists
    // at the top level or in payload.
    const events: CycleActivityEvent[] = [
      { kind: "lifecycle", cycle_id: "c1", ts: 1, agent: "", payload: { event: "cycle:start" } },
      { kind: "phase", cycle_id: "c1", ts: 1, agent: "", payload: { phase: "execute" } },
      { kind: "tcr", cycle_id: "c1", ts: 1, agent: "", payload: { commitHash: "a", message: "m" } },
      { kind: "gate", cycle_id: "c1", ts: 1, agent: "", payload: { gate: "ci", verdict: "pass" } },
      { kind: "stdout", cycle_id: "c1", ts: 1, agent: "", payload: { data: "x" } },
      { kind: "tool_call", cycle_id: "c1", ts: 1, agent: "", payload: { tool: "Bash" } },
      { kind: "tool_result", cycle_id: "c1", ts: 1, agent: "", payload: { tool: "Bash" } },
      { kind: "state_change", cycle_id: "c1", ts: 1, agent: "", payload: { from: "a", to: "b" } },
    ];
    for (const ev of events) {
      const json = JSON.stringify(ev);
      const forbid = ["diff", "patch", "delta", "changes"];
      for (const key of forbid) {
        expect(json).not.toContain(`"${key}"`);
      }
    }
  });
});
