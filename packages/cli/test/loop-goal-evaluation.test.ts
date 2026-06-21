/**
 * FIX-337 (AC5) — the goal evaluation's `delivered` reading must credit OPEN-PR
 * IN-FLIGHT cards (the cycle-ledger `delivered + pending_merge` figure) AND merged
 * cards, while `completion` still waits for EVERY scoped card to really merge.
 */
import { describe, expect, it } from "vitest";
import type { AuditPrEvidence, StoryDeliveryTruth } from "@roll/core";
import { goalEvaluationFromTruth, isCardInFlight } from "../src/commands/loop-go.js";
import { storyTruthFromBacklog } from "../src/lib/truth-adapter.js";

const NOW = Math.floor(Date.parse("2026-06-13T00:00:00Z") / 1000);

function truth(id: string, status: string, pr?: AuditPrEvidence) {
  return storyTruthFromBacklog(id, status, { ...(pr !== undefined ? { prEvidence: pr } : {}), nowSec: NOW });
}

function dt(overrides: Partial<StoryDeliveryTruth> = {}): StoryDeliveryTruth {
  return {
    storyId: "US-TEST",
    lifecycleState: "in_flight",
    delivered: false,
    prNumber: 42,
    lastRecordedAt: Date.now(),
    deliveringCycles: ["C-A"],
    ...overrides,
  };
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

describe("US-TRUTH-017 AC2 — isCardInFlight with structured deliveryTruth", () => {
  it("deliveryTruth in_flight → true (picker skips, AC4)", () => {
    expect(isCardInFlight("📋 Todo", undefined, dt({ lifecycleState: "in_flight" }))).toBe(true);
  });

  it("deliveryTruth ci_red → true (also in-flight, CI-red sub-state)", () => {
    expect(isCardInFlight("📋 Todo", undefined, dt({ lifecycleState: "ci_red" }))).toBe(true);
  });

  it("deliveryTruth done → false (delivered card, not in-flight)", () => {
    expect(isCardInFlight("✅ Done", undefined, dt({ lifecycleState: "done", delivered: true, prNumber: 10 }))).toBe(false);
  });

  it("deliveryTruth done + stale OPEN prEvidence → false (structured done wins over a lagging PR probe — codex review)", () => {
    expect(
      isCardInFlight("🔨 In Progress · PR#42", { state: "OPEN" }, dt({ lifecycleState: "done", prNumber: 10 })),
    ).toBe(false);
  });

  it("deliveryTruth in_flight but no prNumber → false (half-written state, not handed to the PR lane — codex review)", () => {
    expect(isCardInFlight("🔨 In Progress", undefined, dt({ lifecycleState: "in_flight", prNumber: undefined }))).toBe(false);
  });

  it("deliveryTruth todo → false (never picked up)", () => {
    expect(isCardInFlight("📋 Todo", undefined, dt({ lifecycleState: "todo", prNumber: undefined }))).toBe(false);
  });

  it("deliveryTruth building → false (in progress locally, not in-flight with PR)", () => {
    expect(isCardInFlight("🔨 In Progress", undefined, dt({ lifecycleState: "building", prNumber: undefined }))).toBe(false);
  });

  it("deliveryTruth in_flight + prEvidence MERGED → false (merge is delivery, not in-flight, AC2)", () => {
    // PR evidence showing MERGED takes priority over deliveryTruth lifecycle
    expect(
      isCardInFlight("✅ Done", { state: "MERGED", mergedAtSec: NOW - 60 }, dt({ lifecycleState: "in_flight" })),
    ).toBe(false);
  });

  it("deliveryTruth in_flight + prEvidence OPEN → true (PR open confirms in-flight)", () => {
    expect(
      isCardInFlight("🔨 In Progress", { state: "OPEN" }, dt({ lifecycleState: "in_flight" })),
    ).toBe(true);
  });

  it("AC4 — no consumer reads backlog PR# regex when deliveryTruth present (string ignored)", () => {
    // A backlogStatus with "PR#99" but deliveryTruth says "todo" → NOT in-flight.
    // The /PR#\d+/ regex is NEVER consulted when deliveryTruth is present.
    expect(isCardInFlight("📋 Todo · PR#99", undefined, dt({ lifecycleState: "todo", prNumber: undefined }))).toBe(false);
  });

  it("no deliveryTruth → falls back to regex (deprecated path, backward compat)", () => {
    // Legacy: when deliveryTruth is absent, the old regex path still works.
    expect(isCardInFlight("🔨 In Progress · PR#42", undefined)).toBe(true);
    expect(isCardInFlight("📋 Todo", undefined)).toBe(false);
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

describe("FIX-388 — storyTruthFromBacklog with deliveryTruth (structured path wins)", () => {
  it("AC3: deliveryTruth todo with real records → backlogStatus '✅ Done' ignored, returns truth/no_claim_no_evidence", () => {
    // A card whose delivery record says "todo" but whose backlog says "✅ Done"
    // → structured truth wins, the markdown ✅ is NOT read.
    // (deliveringCycles non-empty signals real records exist)
    const t = storyTruthFromBacklog("FIX-388", "✅ Done", {
      nowSec: NOW,
      deliveryTruth: dt({ lifecycleState: "todo", delivered: false, prNumber: undefined, deliveringCycles: ["c1"] }),
    });
    // If markdown were parsed, "✅ Done" would be isDoneRow=true → grandfathered.
    // With deliveryTruth todo, isDoneRow=false → no_claim_no_evidence.
    expect(t.state).toBe("truth");
    expect(t.reason).toBe("no_claim_no_evidence");
    expect(t.delivered).toBe(false);
  });

  it("AC3: deliveryTruth done + no prEvidence → unknown (structured), NOT reading '📋 Todo'", () => {
    // deliveryTruth says done, backlogStatus says "📋 Todo". If the old markdown
    // parser ran, it would report no_claim_no_evidence. The structured path gives
    // unknown (done but no merge evidence) — a DIFFERENT outcome, proving the
    // structured path was used.
    const t = storyTruthFromBacklog("FIX-388", "📋 Todo", {
      nowSec: NOW,
      deliveryTruth: dt({ lifecycleState: "done", delivered: true, prNumber: 42 }),
    });
    expect(t.state).toBe("unknown"); // structured: done but no merge evidence
    expect(t.state).not.toBe("no_claim_no_evidence"); // NOT reading backlogStatus
  });

  it("AC3: isCardInFlight with deliveryTruth done → false even if backlogStatus says PR#99", () => {
    // BacklogStatus contains "PR#99" but delivery says done → structured wins.
    expect(
      isCardInFlight("🔨 In Progress · PR#99", undefined, dt({ lifecycleState: "done", delivered: true, prNumber: 42 })),
    ).toBe(false);
  });

  it("AC4: no deliveryTruth → falls back to markdown parsing (backward compat)", () => {
    // When deliveryTruth is undefined, the markdown fallback still works.
    expect(isCardInFlight("🔨 In Progress · PR#42", undefined)).toBe(true);
    // A todo card without a PR annotation reads as not-in-flight.
    expect(isCardInFlight("📋 Todo", undefined)).toBe(false);
  });

  it("AC3: deliveryTruth in_flight with prNumber → true regardless of backlogStatus", () => {
    // Even if backlog says "🚫 Hold", structured truth says in_flight → is in-flight.
    expect(
      isCardInFlight("🚫 Hold", undefined, dt({ lifecycleState: "in_flight", delivered: false, prNumber: 88 })),
    ).toBe(true);
  });
});
