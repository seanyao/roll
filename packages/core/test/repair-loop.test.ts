/**
 * US-V4-007 — bounded repair loop: success-after-repair, max-round stop, repeated
 * finding-signature stop, budget trip, timeout trip, and the repair-note contract.
 */
import { describe, expect, it } from "vitest";
import {
  advanceRepairState,
  decideRepair,
  findingSignature,
  initialRepairState,
  parseRepairNote,
  renderRepairNote,
  signatureSet,
  type RepairBounds,
} from "../src/loop/repair-loop.js";

const BOUNDS: RepairBounds = { maxRounds: 3, budgetCap: 100, timeoutMs: 60_000 };

describe("findingSignature / signatureSet", () => {
  it("normalizes wording, quotes, numbers, and whitespace", () => {
    expect(findingSignature("AC2 at line 47 has no test")).toBe(findingSignature("AC2 at line 9 has  no test"));
    expect(findingSignature('the `parser` failed')).toBe(findingSignature("the parser failed"));
  });
  it("dedupes + sorts a round's signatures (order-independent)", () => {
    expect(signatureSet(["b finding", "a finding", "a finding"])).toEqual(signatureSet(["a finding", "b finding"]));
  });
});

describe("decideRepair", () => {
  it("no blocking findings → done (evaluator satisfied)", () => {
    expect(decideRepair([], initialRepairState(), BOUNDS).action).toBe("done");
  });

  it("blocking findings within bounds → repair (next round)", () => {
    const d = decideRepair(["AC2 fails"], initialRepairState(), BOUNDS);
    expect(d.action).toBe("repair");
    expect(d.round).toBe(1);
  });

  it("success after a repair round: blocking → repair, then clears → done", () => {
    let state = initialRepairState();
    let d = decideRepair(["AC2 fails"], state, BOUNDS);
    expect(d.action).toBe("repair");
    state = advanceRepairState(state, ["AC2 fails"], { spent: 10, elapsedMs: 1000 });
    d = decideRepair([], state, BOUNDS); // builder fixed it; evaluator now clean
    expect(d.action).toBe("done");
  });

  it("MAX ROUNDS: escalates when rounds are exhausted with findings remaining", () => {
    const state = { round: 3, priorSignatures: [["x"], ["y"], ["z"]], spent: 30, elapsedMs: 3000 };
    const d = decideRepair(["still broken"], state, BOUNDS);
    expect(d.action).toBe("escalate");
    expect(d.reason).toContain("max repair rounds");
  });

  it("REPEATED SIGNATURE: escalates when the same finding set returns", () => {
    const state = { round: 1, priorSignatures: [signatureSet(["AC2 fails at line 5"])], spent: 10, elapsedMs: 1000 };
    const d = decideRepair(["AC2 fails at line 99"], state, BOUNDS); // same signature (number normalized)
    expect(d.action).toBe("escalate");
    expect(d.reason).toContain("oscillating");
  });

  it("BUDGET: escalates when the repair budget is exhausted", () => {
    const state = { round: 1, priorSignatures: [["x"]], spent: 100, elapsedMs: 1000 };
    const d = decideRepair(["new finding"], state, BOUNDS);
    expect(d.action).toBe("escalate");
    expect(d.reason).toContain("budget");
  });

  it("TIMEOUT: escalates when the repair loop times out", () => {
    const state = { round: 1, priorSignatures: [["x"]], spent: 10, elapsedMs: 60_000 };
    const d = decideRepair(["new finding"], state, BOUNDS);
    expect(d.action).toBe("escalate");
    expect(d.reason).toContain("timed out");
  });

  it("a DIFFERENT finding next round (progress) keeps repairing within bounds", () => {
    const state = { round: 1, priorSignatures: [signatureSet(["AC2 fails"])], spent: 10, elapsedMs: 1000 };
    const d = decideRepair(["AC5 missing test"], state, BOUNDS);
    expect(d.action).toBe("repair");
    expect(d.round).toBe(2);
  });

  it("never runs unbounded: with no budget/timeout bounds, maxRounds still stops it", () => {
    const minimal: RepairBounds = { maxRounds: 2 };
    const state = { round: 2, priorSignatures: [["a"], ["b"]], spent: 9999, elapsedMs: 9_999_999 };
    expect(decideRepair(["x"], state, minimal).action).toBe("escalate");
  });
});

describe("repair note", () => {
  it("renders + parses a findings→changes mapping", () => {
    const md = renderRepairNote("US-1", 1, [{ finding: "AC2 has no test", change: "added parser.test.ts case" }]);
    const parsed = parseRepairNote(md);
    expect(parsed).toEqual([{ finding: "AC2 has no test", change: "added parser.test.ts case" }]);
  });
  it("accepts ASCII arrow too", () => {
    expect(parseRepairNote("# Repair note — US-1 (round 1)\n## Findings addressed\n- a -> b\n")).toEqual([{ finding: "a", change: "b" }]);
  });
  it("fail-closed on a non-repair-note", () => {
    expect(parseRepairNote("some other doc")).toBeNull();
  });
});
