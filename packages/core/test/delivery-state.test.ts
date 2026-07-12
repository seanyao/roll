/**
 * US-DELIV-001 — delivery lifecycle state model + AWAITING_MERGE suspension.
 *
 * The cycle's `deliveryState` is a PURE PROJECTION of the event stream
 * (design .roll/features/delivery-reconciler/delivery-reconciler-design.md
 * §3.1/§3.2): no path may hand-write a terminal delivery state without
 * appending the event that carries it.
 *
 * AC1 (goal 1/3): the projection is exhaustive over the delivery vocabulary —
 *   cycle:start → building; delivery:evidence_gate{blocked} → blocked_no_evidence;
 *   delivery:published → awaiting_merge; delivery:merge_attempt{ci_red} → ci_failed;
 *   delivery:reconciled → delivered / delivered_external / superseded.
 * AC2 (goal 2): awaiting_merge is a real suspension — nothing in the model
 *   forces a merge-wait; the fold leaves the cycle in awaiting_merge until a
 *   reconciled/merge_attempt event arrives (never blocks).
 * AC3 (goal 3): the fold is pure + total — any event list yields a state;
 *   terminal states are sticky; foreign-cycle events are ignored; re-folding
 *   is idempotent.
 */
import { describe, expect, it } from "vitest";
import { projectDeliveryState } from "../src/index.js";
import { DELIVERY_STATES, type RollEvent } from "@roll/spec";

const TS = 1_750_000_000_000;
const CYCLE = "cycle-A";

function ev(event: RollEvent): RollEvent {
  return event;
}

const start: RollEvent = { type: "cycle:start", cycleId: CYCLE, storyId: "US-X-001", agent: "kimi", model: "m", ts: TS };

describe("projectDeliveryState — US-DELIV-001", () => {
  // ── AC1: the 8-state vocabulary is pinned verbatim (design §3.1) ───────────
  it("the DeliveryState vocabulary is exactly the 8 design states", () => {
    expect([...DELIVERY_STATES]).toEqual([
      "building",
      "blocked_no_evidence",
      "awaiting_merge",
      "ci_failed",
      "delivered",
      "delivered_external",
      "superseded",
      "abandoned",
    ]);
  });

  // ── AC1: exhaustive vocabulary ────────────────────────────────────────────
  it("no events / only cycle:start → building", () => {
    expect(projectDeliveryState([], CYCLE)).toBe("building");
    expect(projectDeliveryState([start], CYCLE)).toBe("building");
  });

  it("delivery:evidence_gate{blocked} → blocked_no_evidence; {earned} stays building", () => {
    const blocked = ev({ type: "delivery:evidence_gate", cycleId: CYCLE, storyId: "US-X-001", verdict: "blocked", reasons: ["no attest"], ts: TS });
    expect(projectDeliveryState([start, blocked], CYCLE)).toBe("blocked_no_evidence");

    const earned = ev({ type: "delivery:evidence_gate", cycleId: CYCLE, storyId: "US-X-001", verdict: "earned", reasons: [], ts: TS });
    expect(projectDeliveryState([start, earned], CYCLE)).toBe("building");
  });

  it("delivery:published → awaiting_merge", () => {
    const published = ev({ type: "delivery:published", cycleId: CYCLE, storyId: "US-X-001", branch: "loop/cycle-A", prNumber: 42, prUrl: "https://github.com/o/r/pull/42", ts: TS });
    expect(projectDeliveryState([start, published], CYCLE)).toBe("awaiting_merge");
  });

  it("delivery:merge_attempt{ci_red} → ci_failed; other outcomes stay awaiting_merge", () => {
    const published = ev({ type: "delivery:published", cycleId: CYCLE, storyId: "US-X-001", branch: "b", prNumber: 42, prUrl: "u", ts: TS });
    const ciRed = ev({ type: "delivery:merge_attempt", cycleId: CYCLE, prNumber: 42, method: "squash", outcome: "ci_red", ts: TS });
    expect(projectDeliveryState([start, published, ciRed], CYCLE)).toBe("ci_failed");

    for (const outcome of ["merged", "blocked", "gh_down"] as const) {
      const attempt = ev({ type: "delivery:merge_attempt", cycleId: CYCLE, prNumber: 42, method: "squash", outcome, ts: TS });
      expect(projectDeliveryState([start, published, attempt], CYCLE)).toBe("awaiting_merge");
    }
  });

  it("delivery:reconciled → delivered / delivered_external / superseded", () => {
    const published = ev({ type: "delivery:published", cycleId: CYCLE, storyId: "US-X-001", branch: "b", prNumber: 42, prUrl: "u", ts: TS });
    const delivered = ev({ type: "delivery:reconciled", cycleId: CYCLE, storyId: "US-X-001", state: "delivered", mergedBy: "runner", mergeCommit: "abc", signal: "pr_state", ts: TS });
    expect(projectDeliveryState([start, published, delivered], CYCLE)).toBe("delivered");

    const external = ev({ type: "delivery:reconciled", cycleId: CYCLE, storyId: "US-X-001", state: "delivered_external", mergedBy: "external", mergeCommit: "def", signal: "patch_id", ts: TS });
    expect(projectDeliveryState([start, published, external], CYCLE)).toBe("delivered_external");

    const superseded = ev({ type: "delivery:reconciled", cycleId: CYCLE, storyId: "US-X-001", state: "superseded", mergedBy: "external", mergeCommit: "999", signal: "patch_id", ts: TS });
    expect(projectDeliveryState([start, published, superseded], CYCLE)).toBe("superseded");
  });

  // ── AC2: awaiting_merge is a suspension, not a wait ───────────────────────
  it("stays awaiting_merge across unrelated events (no merge-wait, no time-based transition)", () => {
    const published = ev({ type: "delivery:published", cycleId: CYCLE, storyId: "US-X-001", branch: "b", prNumber: 42, prUrl: "u", ts: TS });
    const phase = ev({ type: "cycle:phase", cycleId: CYCLE, phase: "cleanup", ts: TS + 1 });
    const end = ev({ type: "cycle:end", cycleId: CYCLE, outcome: "published_pending_merge", cost: { usd: 0, tokensIn: 0, tokensOut: 0 }, ts: TS + 2 });
    expect(projectDeliveryState([start, published, phase, end], CYCLE)).toBe("awaiting_merge");
  });

  // ── AC3: purity / totality / stickiness ───────────────────────────────────
  it.each(["delivered", "delivered_external", "superseded"] as const)(
    "terminal state %s is sticky — later delivery events cannot regress it",
    (terminal) => {
      const published = ev({ type: "delivery:published", cycleId: CYCLE, storyId: "US-X-001", branch: "b", prNumber: 42, prUrl: "u", ts: TS });
      const reconciled = ev({ type: "delivery:reconciled", cycleId: CYCLE, storyId: "US-X-001", state: terminal, mergedBy: "runner", mergeCommit: "abc", signal: "pr_state", ts: TS });
      const ciRed = ev({ type: "delivery:merge_attempt", cycleId: CYCLE, prNumber: 42, method: "squash", outcome: "ci_red", ts: TS + 3 });
      const republished = ev({ ...published, ts: TS + 4 });
      expect(projectDeliveryState([start, published, reconciled, ciRed, republished], CYCLE)).toBe(terminal);
    },
  );

  it("ignores events belonging to other cycles", () => {
    const foreign = ev({ type: "delivery:published", cycleId: "cycle-B", storyId: "US-X-001", branch: "b", prNumber: 7, prUrl: "u", ts: TS });
    const foreignReconciled = ev({ type: "delivery:reconciled", cycleId: "cycle-B", storyId: "US-X-001", state: "delivered", mergedBy: "runner", mergeCommit: "abc", signal: "pr_state", ts: TS + 1 });
    expect(projectDeliveryState([start, foreign, foreignReconciled], CYCLE)).toBe("building");
  });

  it("is idempotent — duplicated events in the stream fold to the same state", () => {
    const published = ev({ type: "delivery:published", cycleId: CYCLE, storyId: "US-X-001", branch: "b", prNumber: 42, prUrl: "u", ts: TS });
    const reconciled = ev({ type: "delivery:reconciled", cycleId: CYCLE, storyId: "US-X-001", state: "delivered", mergedBy: "runner", mergeCommit: "abc", signal: "pr_state", ts: TS + 1 });
    // A replayed/duplicated stream (event-bus redelivery) is a fixpoint of the fold.
    expect(projectDeliveryState([start, published, published], CYCLE)).toBe("awaiting_merge");
    expect(projectDeliveryState([start, published, reconciled, published, reconciled], CYCLE)).toBe("delivered");
    // …and folding is deterministic.
    const events = [start, published];
    expect(projectDeliveryState(events, CYCLE)).toBe(projectDeliveryState(events, CYCLE));
  });

  it("a reconciled cycle without a prior published event still projects (retroactive heal, US-DELIV-002 reader)", () => {
    const external = ev({ type: "delivery:reconciled", cycleId: CYCLE, storyId: "US-X-001", state: "delivered_external", mergedBy: "external", mergeCommit: "def", signal: "patch_id", ts: TS });
    expect(projectDeliveryState([start, external], CYCLE)).toBe("delivered_external");
  });
});
