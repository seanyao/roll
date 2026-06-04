/**
 * Unit tests for the v3 Budget guardrails (US-CORE-011, no bash oracle —
 * built to I11 + architecture §6). Every verdict branch, day/week rollover at
 * the UTC+8 boundary, approach/breach edges, and the suggest_upgrade trigger.
 */
import type { BudgetPolicy, CycleCost } from "@roll/spec";
import { describe, expect, it } from "vitest";
import {
  BudgetLedger,
  DEFAULT_APPROACH_RATIO,
  budgetVerdict,
  dayKey,
  upgradeHint,
  weekKey,
} from "../src/index.js";

const policy: BudgetPolicy = {
  dailyUsd: 20,
  weeklyUsd: 100,
  metric: "effective_cost",
  onApproach: "downgrade",
  onBreach: "pause_and_notify",
};

/** Build a CycleCost with a given effective cost (and matching estimate). */
function cost(effective: number, estimated = effective, revertCount = 0): CycleCost {
  return {
    cycleId: "c",
    agent: "a",
    model: "m",
    tokensIn: 0,
    tokensOut: 0,
    estimatedCost: estimated,
    revertCount,
    effectiveCost: effective,
  };
}

/** Epoch ms for a UTC+8 wall-clock date/time. */
function sh(iso: string): number {
  // iso is a UTC+8 wall clock; subtract 8h to get the real UTC epoch.
  return Date.parse(`${iso}Z`) - 8 * 3600 * 1000;
}

describe("UTC+8 day/week keys", () => {
  it("dayKey is the UTC+8 calendar date", () => {
    // 2026-06-05 01:00 UTC+8 == 2026-06-04 17:00 UTC.
    const t = sh("2026-06-05T01:00:00");
    expect(dayKey(t)).toBe("2026-06-05");
  });

  it("day boundary: 23:59 vs 00:01 UTC+8 are different days", () => {
    expect(dayKey(sh("2026-06-05T23:59:00"))).toBe("2026-06-05");
    expect(dayKey(sh("2026-06-06T00:01:00"))).toBe("2026-06-06");
  });

  it("ISO week rolls over at Monday 00:00 UTC+8", () => {
    // 2026-06-07 is a Sunday; 2026-06-08 is a Monday.
    const sun = weekKey(sh("2026-06-07T23:00:00"));
    const mon = weekKey(sh("2026-06-08T01:00:00"));
    expect(sun).not.toBe(mon);
  });
});

describe("BudgetLedger accumulation", () => {
  it("sums effective cost into the right UTC+8 day bucket", () => {
    const l = new BudgetLedger();
    l.record(cost(5), sh("2026-06-05T10:00:00"));
    l.record(cost(3), sh("2026-06-05T22:00:00"));
    l.record(cost(7), sh("2026-06-06T00:30:00")); // next day
    expect(l.dailyEffective(sh("2026-06-05T12:00:00"))).toBe(8);
    expect(l.dailyEffective(sh("2026-06-06T12:00:00"))).toBe(7);
  });

  it("gates on effective, not nominal — reverts count", () => {
    const l = new BudgetLedger();
    l.record(cost(12, 4, 2), sh("2026-06-05T10:00:00")); // effective 12, nominal 4
    expect(l.dailyEffective(sh("2026-06-05T11:00:00"))).toBe(12);
    expect(l.dailyEstimated(sh("2026-06-05T11:00:00"))).toBe(4);
    expect(l.dailyReverts(sh("2026-06-05T11:00:00"))).toBe(2);
  });

  it("weekly accumulates across days in the same ISO week", () => {
    const l = new BudgetLedger();
    l.record(cost(10), sh("2026-06-08T10:00:00")); // Monday
    l.record(cost(15), sh("2026-06-10T10:00:00")); // Wednesday, same week
    expect(l.weeklyEffective(sh("2026-06-10T12:00:00"))).toBe(25);
  });
});

describe("budgetVerdict branches", () => {
  it("ok when well under both ceilings", () => {
    const l = new BudgetLedger();
    l.record(cost(5), sh("2026-06-05T10:00:00"));
    const v = budgetVerdict(l, policy, sh("2026-06-05T11:00:00"));
    expect(v.action).toBe("ok");
  });

  it("downgrade at exactly the approach threshold (80% of daily)", () => {
    const l = new BudgetLedger();
    l.record(cost(16), sh("2026-06-05T10:00:00")); // 16 == 0.8 * 20
    const v = budgetVerdict(l, policy, sh("2026-06-05T11:00:00"));
    expect(v.action).toBe("downgrade");
    if (v.action === "downgrade") {
      expect(v.window).toBe("daily");
      expect(v.ratio).toBeCloseTo(0.8, 6);
    }
  });

  it("just under approach stays ok", () => {
    const l = new BudgetLedger();
    l.record(cost(15.99), sh("2026-06-05T10:00:00"));
    expect(budgetVerdict(l, policy, sh("2026-06-05T11:00:00")).action).toBe("ok");
  });

  it("pause_and_notify at exactly the ceiling", () => {
    const l = new BudgetLedger();
    l.record(cost(20), sh("2026-06-05T10:00:00"));
    const v = budgetVerdict(l, policy, sh("2026-06-05T11:00:00"));
    expect(v.action).toBe("pause_and_notify");
    if (v.action === "pause_and_notify") {
      expect(v.window).toBe("daily");
      expect(v.spent).toBe(20);
      expect(v.ceiling).toBe(20);
    }
  });

  it("pause_and_notify over the ceiling", () => {
    const l = new BudgetLedger();
    l.record(cost(25), sh("2026-06-05T10:00:00"));
    expect(budgetVerdict(l, policy, sh("2026-06-05T11:00:00")).action).toBe("pause_and_notify");
  });

  it("weekly breach trips even when daily is ok", () => {
    const l = new BudgetLedger();
    // spread across the week (Mon 06-08 .. Sun 06-14, all ISO week 24) so no
    // single day breaches the 20 daily cap. Days are zero-padded — ISO 8601
    // requires it (Date.parse("2026-06-8…") is NaN).
    for (let d = 8; d <= 14; d++) {
      const dd = d < 10 ? `0${d}` : `${d}`;
      l.record(cost(15), sh(`2026-06-${dd}T10:00:00`));
    }
    const now = sh("2026-06-14T12:00:00");
    expect(l.dailyEffective(now)).toBe(15); // under 20 daily
    expect(l.weeklyEffective(now)).toBe(105); // 7 × 15, over 100 weekly
    const v = budgetVerdict(l, policy, now);
    expect(v.action).toBe("pause_and_notify");
    if (v.action !== "ok") expect(v.window).toBe("weekly");
  });

  it("returns the most severe window (breach beats approach)", () => {
    const l = new BudgetLedger();
    l.record(cost(20), sh("2026-06-08T10:00:00")); // daily breach AND weekly approach
    const v = budgetVerdict(l, policy, sh("2026-06-08T11:00:00"));
    expect(v.action).toBe("pause_and_notify");
  });

  it("a non-positive ceiling disables that window (no instant breach)", () => {
    const l = new BudgetLedger();
    l.record(cost(50), sh("2026-06-05T10:00:00"));
    const zeroDaily: BudgetPolicy = { ...policy, dailyUsd: 0 };
    const v = budgetVerdict(l, zeroDaily, sh("2026-06-05T11:00:00"));
    // daily disabled; weekly 50 < 100*0.8=80 → ok.
    expect(v.action).toBe("ok");
  });

  it("custom approachRatio is honoured", () => {
    const l = new BudgetLedger();
    l.record(cost(10), sh("2026-06-05T10:00:00")); // 50% of 20
    expect(budgetVerdict(l, policy, sh("2026-06-05T11:00:00")).action).toBe("ok");
    const v = budgetVerdict(l, policy, sh("2026-06-05T11:00:00"), { approachRatio: 0.5 });
    expect(v.action).toBe("downgrade");
  });

  it("DEFAULT_APPROACH_RATIO is 0.8", () => {
    expect(DEFAULT_APPROACH_RATIO).toBe(0.8);
  });
});

describe("upgradeHint", () => {
  it("no suggestion below threshold", () => {
    const h = upgradeHint({ cycles: 10, reverts: 3 }); // 0.3 <= 0.4
    expect(h.suggest).toBe(false);
    expect(h.revertRate).toBeCloseTo(0.3, 6);
  });

  it("no suggestion exactly at threshold (strictly greater required)", () => {
    expect(upgradeHint({ cycles: 10, reverts: 4 }).suggest).toBe(false); // 0.4 not > 0.4
  });

  it("suggest_upgrade above threshold", () => {
    const h = upgradeHint({ cycles: 10, reverts: 5 }); // 0.5 > 0.4
    expect(h.suggest).toBe(true);
    if (h.suggest) {
      expect(h.signal).toBe("suggest_upgrade");
      expect(h.revertRate).toBeCloseTo(0.5, 6);
      expect(h.reason).toContain("revert rate");
    }
  });

  it("zero cycles never suggests", () => {
    expect(upgradeHint({ cycles: 0, reverts: 0 }).suggest).toBe(false);
  });

  it("custom threshold honoured", () => {
    expect(upgradeHint({ cycles: 10, reverts: 3, threshold: 0.2 }).suggest).toBe(true);
  });
});
