/**
 * FIX-337 (AC5) — the goal evaluation's `delivered` reading must credit OPEN-PR
 * IN-FLIGHT cards (the cycle-ledger `delivered + pending_merge` figure) AND merged
 * cards, while `completion` still waits for EVERY scoped card to really merge.
 */
import { describe, expect, it } from "vitest";
import type { AuditPrEvidence } from "@roll/core";
import { goalEvaluationFromTruth, isCardInFlight } from "../src/commands/loop-go.js";
import { storyTruthFromBacklog } from "../src/lib/truth-adapter.js";

const NOW = Math.floor(Date.parse("2026-06-13T00:00:00Z") / 1000);

function truth(id: string, status: string, pr?: AuditPrEvidence) {
  return storyTruthFromBacklog(id, status, { ...(pr !== undefined ? { prEvidence: pr } : {}), nowSec: NOW });
}

describe("FIX-337 (AC5) — isCardInFlight", () => {
  it("an OPEN PR is in-flight", () => {
    expect(isCardInFlight("🔨 In Progress · PR#42", { state: "OPEN" })).toBe(true);
    expect(isCardInFlight("📋 Todo", { state: "OPEN" })).toBe(true);
  });

  it("a MERGED PR is delivery, NOT in-flight (counted via truth.delivered instead)", () => {
    expect(isCardInFlight("✅ Done · PR#42", { state: "MERGED", mergedAtSec: NOW - 60 })).toBe(false);
  });

  it("a PR#N annotation alone (no/closed PR evidence) still reads in-flight (a PR was opened)", () => {
    expect(isCardInFlight("🔨 In Progress · PR#42", undefined)).toBe(true);
  });

  it("no PR opened → not in-flight", () => {
    expect(isCardInFlight("📋 Todo", undefined)).toBe(false);
    expect(isCardInFlight("🚫 Hold", undefined)).toBe(false);
  });
});

describe("FIX-337 (AC5) — goalEvaluationFromTruth: delivered counts in-flight, completion waits for merges", () => {
  const scope = { kind: "all" } as const;

  it("an open-PR in-flight card is counted in `delivered` but is NOT complete", () => {
    // one merged, one in-flight (PR open, not merged).
    const merged = truth("US-OK", "✅ Done · PR#10", { state: "MERGED", mergedAtSec: NOW - 7200 });
    const open = truth("US-FLIGHT", "🔨 In Progress · PR#11", { state: "OPEN" });
    const ev = goalEvaluationFromTruth([merged, open], scope, {
      allowEmptyAllComplete: true,
      inFlightIds: new Set(["US-FLIGHT"]),
    });
    expect(ev.total).toBe(2);
    // delivered = merged (1) + in-flight (1) = 2 — the loop sees progress, not "1".
    expect(ev.delivered).toBe(2);
    // but completion waits: the in-flight card is still a blocker until its merge.
    expect(ev.complete).toBe(false);
    expect(ev.blockers.some((b) => b.startsWith("US-FLIGHT"))).toBe(true);
  });

  it("without the in-flight set, the same open-PR card is NOT credited (baseline = merge-only)", () => {
    const merged = truth("US-OK", "✅ Done · PR#10", { state: "MERGED", mergedAtSec: NOW - 7200 });
    const open = truth("US-FLIGHT", "🔨 In Progress · PR#11", { state: "OPEN" });
    const ev = goalEvaluationFromTruth([merged, open], scope, { allowEmptyAllComplete: true });
    expect(ev.delivered).toBe(1); // only the merged one
    expect(ev.complete).toBe(false);
  });

  it("completion only when EVERY card is really merged (in-flight resolved)", () => {
    const a = truth("US-A", "✅ Done · PR#10", { state: "MERGED", mergedAtSec: NOW - 7200 });
    const b = truth("US-B", "✅ Done · PR#11", { state: "MERGED", mergedAtSec: NOW - 7200 });
    const ev = goalEvaluationFromTruth([a, b], scope, { allowEmptyAllComplete: true, inFlightIds: new Set() });
    expect(ev.delivered).toBe(2);
    expect(ev.complete).toBe(true);
    expect(ev.reason).toBe("all_delivered");
    expect(ev.blockers).toEqual([]);
  });

  it("an in-flight card is never double-counted against a merged one", () => {
    // a single card that is BOTH merged AND (spuriously) in the in-flight set must
    // count once: truth.delivered short-circuits the in-flight branch.
    const merged = truth("US-OK", "✅ Done · PR#10", { state: "MERGED", mergedAtSec: NOW - 7200 });
    const ev = goalEvaluationFromTruth([merged], scope, { allowEmptyAllComplete: true, inFlightIds: new Set(["US-OK"]) });
    expect(ev.delivered).toBe(1);
  });
});
