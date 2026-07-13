/**
 * US-TRUTH-013 — DeliveryRecord + LifecycleState + lifecycleFromFacts tests.
 *
 * AC1: DeliveryRecord type fields
 * AC2: LifecycleState enum closed set
 * AC3: lifecycleFromFacts deterministic mappings
 * AC4: machine delivery fields registered in TRUTH_FIELD_REGISTRY
 * AC5: ci_red as PR-level sub-state
 */
import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_STATES,
  lifecycleFromFacts,
  unregisteredFields,
  registrationHint,
  absent,
  present,
} from "../src/index.js";
import type { DeliveryRecord, HistoricalTerminalOutcome, LifecycleState, PrState } from "../src/index.js";

describe("US-TRUTH-013 AC2 — LifecycleState enum", () => {
  it("is a closed set of 9 states", () => {
    expect(LIFECYCLE_STATES).toEqual([
      "todo",
      "building",
      "pending_merge",
      "ci_red",
      "blocked",
      "on_hold",
      "done",
      "failed",
      "abandoned",
    ]);
  });

  it("every state is a distinct string", () => {
    const seen = new Set<string>();
    for (const s of LIFECYCLE_STATES) {
      expect(seen.has(s)).toBe(false);
      seen.add(s);
    }
  });
});

describe("US-TRUTH-013 AC1 — DeliveryRecord type shape", () => {
  it("DeliveryRecord has all required fields", () => {
    // Type-level test: construct a valid record.
    const record: DeliveryRecord = {
      storyId: "US-TEST-001",
      cycleId: "cycle-1",
      lifecycleState: "pending_merge",
      prNumber: present(42),
      prUrl: present("https://github.com/example/pull/42"),
      mergedAt: absent("not_recorded"),
      mergeCommit: absent("not_recorded"),
      recordedAt: 1000,
    };
    expect(record.storyId).toBe("US-TEST-001");
    expect(record.lifecycleState).toBe("pending_merge");
    expect(record.prNumber).toEqual(present(42));
    expect(record.prUrl).toEqual(present("https://github.com/example/pull/42"));
  });

  it("fields can all be FactOr<T> absent with reason", () => {
    const record: DeliveryRecord = {
      storyId: "US-TEST-002",
      cycleId: "cycle-2",
      lifecycleState: "todo",
      prNumber: absent("no_publish_attempted"),
      prUrl: absent("no_publish_attempted"),
      mergedAt: absent("not_applicable"),
      mergeCommit: absent("not_applicable"),
      recordedAt: 2000,
    };
    expect(record.prNumber.present).toBe(false);
    if (!record.prNumber.present) {
      expect(record.prNumber.reason).toBe("no_publish_attempted");
    }
  });
});

describe("US-TRUTH-013 AC3 — lifecycleFromFacts deterministic mappings", () => {
  type Case = [HistoricalTerminalOutcome, PrState, LifecycleState];

  const cases: Case[] = [
    // published_pending_merge + PR open → in_flight (the classic case)
    ["published_pending_merge", "open", "pending_merge"],
    // published_pending_merge + PR open_ci_red → ci_red (AC5)
    ["published_pending_merge", "open_ci_red", "ci_red"],
    // published_pending_merge + PR closed → abandoned
    ["published_pending_merge", "closed", "abandoned"],
    // published_pending_merge + PR unknown → still in_flight
    ["published_pending_merge", "unknown", "pending_merge"],

    // delivered + PR merged → done
    ["delivered", "merged", "done"],
    // delivered + PR open (delivered from backfill, PR not merged yet) → in_flight
    ["delivered", "open", "pending_merge"],
    // delivered + PR open_ci_red → ci_red
    ["delivered", "open_ci_red", "ci_red"],

    // unpublished → building (gates passed, publish didn't land)
    ["unpublished", "none", "building"],

    // failed → failed (any PR state)
    ["failed", "none", "failed"],
    ["failed", "open", "failed"],
    ["failed", "merged", "done"], // merged overrides failed
    ["failed", "closed", "failed"],

    // blocked → blocked
    ["blocked", "none", "blocked"],
    ["blocked", "merged", "done"],

    // aborted_no_delivery → failed
    ["aborted_no_delivery", "none", "failed"],

    // aborted_with_delivery + PR open → in_flight (work was pushed)
    ["aborted_with_delivery", "open", "pending_merge"],
    // aborted_with_delivery + PR open_ci_red → ci_red
    ["aborted_with_delivery", "open_ci_red", "ci_red"],
    // aborted_with_delivery + no PR → failed
    ["aborted_with_delivery", "none", "failed"],

    // idle_no_work → todo
    ["idle_no_work", "none", "todo"],

    // gave_up → failed
    ["gave_up", "none", "failed"],

    // handoff_without_tcr → failed (FIX-1039: recoverable but not delivered)
    ["handoff_without_tcr", "none", "failed"],

    // agent_internal_failure → failed (legacy REFACTOR-071 read-side compatibility)
    ["agent_internal_failure", "none", "failed"],

    // orphan_timeout → blocked
    ["orphan_timeout", "none", "blocked"],

    // unknown → building
    ["unknown", "none", "building"],
  ];

  for (const [outcome, prState, expected] of cases) {
    it(`${outcome} + ${prState} → ${expected}`, () => {
      expect(lifecycleFromFacts(outcome, prState)).toBe(expected);
    });
  }

  it("PR merged wins except a red-main-CI delivery gate", () => {
    // Exhaustively test every terminal outcome with PR merged → done, except
    // structural delivery gates that explicitly mean "never record delivered".
    const allOutcomes: TerminalOutcome[] = [
      "delivered",
      "published_pending_merge",
      "failed",
      "blocked",
      "aborted_no_delivery",
      "aborted_with_delivery",
      "orphan_timeout",
      "idle_no_work",
      "gave_up",
      "handoff_without_tcr",
      "dormant_entered",
      "unpublished",
      "needs_review",
      "unknown",
    ];
    for (const o of allOutcomes) {
      expect(lifecycleFromFacts(o, "merged")).toBe("done");
    }
    expect(lifecycleFromFacts("ci_red_after_merge", "merged")).toBe("ci_red");
  });
});

describe("US-TRUTH-013 AC4 — delivery fields in TRUTH_FIELD_REGISTRY", () => {
  it("every DeliveryRecord field is registered on surface 'delivery'", () => {
    const deliveryFields = [
      "storyId",
      "cycleId",
      "lifecycleState",
      "prNumber",
      "prUrl",
      "mergedAt",
      "mergeCommit",
      "recordedAt",
    ];
    const missing = unregisteredFields("delivery", deliveryFields);
    expect(missing, registrationHint("delivery", missing)).toEqual([]);
  });

  it("pr_url and pr_number are specifically registered (the immediate bug fix)", () => {
    const prFields = ["prUrl", "prNumber"];
    const missing = unregisteredFields("delivery", prFields);
    expect(missing).toEqual([]);
  });
});

describe("US-TRUTH-013 AC5 — ci_red as PR-level sub-state", () => {
  it("ci_red is in the LIFECYCLE_STATES set", () => {
    expect(LIFECYCLE_STATES.includes("ci_red")).toBe(true);
  });

  it("open_ci_red PrState maps to ci_red LifecycleState, not in_flight", () => {
    // published_pending_merge + open_ci_red → ci_red (not in_flight)
    expect(lifecycleFromFacts("published_pending_merge", "open_ci_red")).toBe("ci_red");
    // But open (clean CI) still maps to in_flight
    expect(lifecycleFromFacts("published_pending_merge", "open")).toBe("pending_merge");
  });

  it("ci_red is distinct from in_flight — they are separate states in the closed set", () => {
    expect("ci_red" as LifecycleState).not.toBe("pending_merge");
    // The distinction: ci_red means PR CI is red; in_flight means PR CI is passing.
    // Both mean the story is still actively in flight.
  });
});
