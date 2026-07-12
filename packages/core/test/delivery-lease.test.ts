/**
 * US-DELIV-005 — one-card-one-lease: deliveryLease pure decision tests.
 *
 * Evaluation contract:
 *   - card in awaiting_merge/delivered → deliveryLease returns pick:false + reason + heldBy
 *   - free card → pick:true
 *   - --race explicit opt-in → parallel allowed; first merge → siblings cancelled
 *   - fix-forward legal retry is NOT harmed: a cycle that ENDED without a
 *     terminal delivery state releases its in_flight lease (re-pick allowed).
 */
import { describe, expect, it } from "vitest";
import {
  deliveryLease,
  leaseBlockReason,
  leaseStateFor,
  projectDeliveryLeases,
  siblingCancelEvents,
} from "../src/index.js";
import type { DeliveryLease } from "@roll/spec";
import type { RollEvent } from "../src/index.js";

const lease = (storyId: string, cycleId: string, state: DeliveryLease["state"]): DeliveryLease => ({
  storyId,
  cycleId,
  state,
});

describe("leaseStateFor — DeliveryState → lease state", () => {
  it("maps a live building cycle to in_flight", () => {
    expect(leaseStateFor("building", false)).toBe("in_flight");
    expect(leaseStateFor("blocked_no_evidence", false)).toBe("in_flight");
  });

  it("releases an in_flight lease when the cycle ended (legal retry)", () => {
    expect(leaseStateFor("building", true)).toBeUndefined();
    expect(leaseStateFor("blocked_no_evidence", true)).toBeUndefined();
  });

  it("maps awaiting_merge / ci_failed / delivered states", () => {
    expect(leaseStateFor("awaiting_merge", true)).toBe("awaiting_merge");
    expect(leaseStateFor("ci_failed", true)).toBe("ci_red");
    expect(leaseStateFor("delivered", true)).toBe("delivered");
    expect(leaseStateFor("delivered_external", true)).toBe("delivered");
  });

  it("terminal superseded/abandoned hold no lease", () => {
    expect(leaseStateFor("superseded", false)).toBeUndefined();
    expect(leaseStateFor("abandoned", false)).toBeUndefined();
  });
});

describe("deliveryLease — pick decision", () => {
  it("free card → pick:true", () => {
    expect(deliveryLease("US-A-1", [])).toEqual({ pick: true });
    expect(deliveryLease("US-A-1", [lease("US-B-2", "cycle-9", "awaiting_merge")])).toEqual({ pick: true });
  });

  it("card awaiting_merge → pick:false + reason + heldBy", () => {
    const v = deliveryLease("US-A-1", [lease("US-A-1", "cycle-1", "awaiting_merge")]);
    expect(v.pick).toBe(false);
    expect(v.reason).toContain("awaiting_merge");
    expect(v.heldBy).toBe("cycle-1");
  });

  it("card delivered → pick:false", () => {
    const v = deliveryLease("US-A-1", [lease("US-A-1", "cycle-1", "delivered")]);
    expect(v.pick).toBe(false);
    expect(v.reason).toContain("delivered");
    expect(v.heldBy).toBe("cycle-1");
  });

  it("card in_flight or ci_red → pick:false", () => {
    expect(deliveryLease("US-A-1", [lease("US-A-1", "cycle-2", "in_flight")]).pick).toBe(false);
    expect(deliveryLease("US-A-1", [lease("US-A-1", "cycle-3", "ci_red")]).pick).toBe(false);
  });

  it("--race opt-in → pick:true even when held (parallel race)", () => {
    const v = deliveryLease("US-A-1", [lease("US-A-1", "cycle-1", "awaiting_merge")], { race: true });
    expect(v.pick).toBe(true);
    expect(v.heldBy).toBe("cycle-1");
  });
});

describe("projectDeliveryLeases — event stream projection", () => {
  const start = (cycleId: string, storyId: string, ts: number): RollEvent => ({
    type: "cycle:start",
    cycleId,
    storyId,
    agent: "claude",
    model: "m",
    ts,
  });

  it("a started cycle holds an in_flight lease", () => {
    const leases = projectDeliveryLeases([start("cycle-1", "US-A-1", 1)]);
    expect(leases).toEqual([lease("US-A-1", "cycle-1", "in_flight")]);
  });

  it("published → awaiting_merge; merge_attempt ci_red → ci_red; reconciled → delivered", () => {
    const leases = projectDeliveryLeases([
      start("cycle-1", "US-A-1", 1),
      { type: "delivery:published", cycleId: "cycle-1", storyId: "US-A-1", branch: "loop/cycle-1", prNumber: 1, prUrl: "u", ts: 2 },
      start("cycle-2", "US-B-2", 1),
      { type: "delivery:merge_attempt", cycleId: "cycle-2", prNumber: 2, method: "squash", outcome: "ci_red", ts: 2 },
      start("cycle-3", "US-C-3", 1),
      { type: "delivery:reconciled", cycleId: "cycle-3", storyId: "US-C-3", state: "delivered", mergedBy: "runner", mergeCommit: "abc", signal: "pr_state", ts: 3 },
    ]);
    expect(leases).toContainEqual(lease("US-A-1", "cycle-1", "awaiting_merge"));
    expect(leases).toContainEqual(lease("US-B-2", "cycle-2", "ci_red"));
    expect(leases).toContainEqual(lease("US-C-3", "cycle-3", "delivered"));
  });

  it("cycle:end releases an undelivered in_flight lease but keeps awaiting_merge", () => {
    const leases = projectDeliveryLeases([
      start("cycle-1", "US-A-1", 1),
      { type: "cycle:end", cycleId: "cycle-1", outcome: "gave_up", cost: { tokens: 0, usd: 0 }, ts: 5 } as RollEvent,
      start("cycle-2", "US-B-2", 1),
      { type: "delivery:published", cycleId: "cycle-2", storyId: "US-B-2", branch: "loop/cycle-2", prNumber: 2, prUrl: "u", ts: 2 },
      { type: "cycle:end", cycleId: "cycle-2", outcome: "published_pending_merge", cost: { tokens: 0, usd: 0 }, ts: 5 } as RollEvent,
    ]);
    expect(leases).toEqual([lease("US-B-2", "cycle-2", "awaiting_merge")]);
  });

  it("ignores events of no interest and superseded cycles", () => {
    const leases = projectDeliveryLeases([
      start("cycle-1", "US-A-1", 1),
      { type: "delivery:reconciled", cycleId: "cycle-1", storyId: "US-A-1", state: "superseded", mergedBy: "external", mergeCommit: "abc", signal: "patch_id", ts: 3 },
      { type: "pick:skipped", cycleId: "cycle-9", storyId: "US-A-1", reason: "r", ts: 4 } as unknown as RollEvent,
    ]);
    expect(leases).toEqual([]);
  });
});

describe("siblingCancelEvents — first merge cancels the rest", () => {
  const winner = { cycleId: "cycle-1", mergeCommit: "abc123", signal: "pr_state" as const, mergedBy: "runner" as const };

  it("cancels every non-winner sibling lease on the same story", () => {
    const events = siblingCancelEvents(
      "US-A-1",
      winner,
      [lease("US-A-1", "cycle-1", "awaiting_merge"), lease("US-A-1", "cycle-2", "in_flight"), lease("US-A-1", "cycle-3", "ci_red"), lease("US-B-9", "cycle-4", "awaiting_merge")],
      100,
    );
    expect(events.map((e) => e.cycleId)).toEqual(["cycle-2", "cycle-3"]);
    for (const e of events) {
      expect(e.type).toBe("delivery:reconciled");
      expect(e.state).toBe("superseded");
      expect(e.storyId).toBe("US-A-1");
      expect(e.mergeCommit).toBe("abc123");
      expect(e.signal).toBe("pr_state");
      expect(e.mergedBy).toBe("runner");
      expect(e.ts).toBe(100);
    }
  });

  it("no siblings → no events", () => {
    expect(siblingCancelEvents("US-A-1", winner, [lease("US-A-1", "cycle-1", "awaiting_merge")], 100)).toEqual([]);
  });
});

describe("leaseBlockReason — picker predicate adapter", () => {
  it("free card → undefined", () => {
    expect(leaseBlockReason("US-A-1", [])).toBeUndefined();
  });

  it("held card → reason with heldBy", () => {
    expect(leaseBlockReason("US-A-1", [lease("US-A-1", "cycle-1", "awaiting_merge")])).toBe(
      "card held: awaiting_merge (cycle-1)",
    );
  });

  it("race opt-in → undefined (pick allowed)", () => {
    expect(leaseBlockReason("US-A-1", [lease("US-A-1", "cycle-1", "in_flight")], { race: true })).toBeUndefined();
  });
});
