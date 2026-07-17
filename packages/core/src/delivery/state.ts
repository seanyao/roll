/**
 * US-DELIV-001 — delivery lifecycle state projection.
 *
 * A cycle's `deliveryState` (design §3.1) is a PURE PROJECTION of the event
 * stream: `projectDeliveryState` folds one cycle's delivery events into the
 * DeliveryState vocabulary. This is the single writer of the dimension — no
 * path may hand-write a terminal delivery state without appending the event
 * that carries it (design §3.2, invariant: cycle ledger = pure projection).
 *
 * Semantics:
 *   cycle:start (or no events)            → building
 *   delivery:evidence_gate{blocked}       → blocked_no_evidence (fail-loud)
 *   delivery:published                    → awaiting_merge (SUSPENSION: the
 *                                           loop is released to pick the next
 *                                           card; nothing here blocks on merge)
 *   delivery:merge_attempt{ci_red}        → ci_failed
 *   delivery:reconciled{state}            → delivered / delivered_external /
 *                                           delivered_local / superseded
 *   delivery:abandoned                    → abandoned
 *
 * Guarantees (exhaustively unit-tested):
 * - total + pure: any event list yields a state, same input → same output;
 * - terminal stickiness: once delivered / delivered_external / superseded,
 *   later delivery events cannot regress the cycle;
 * - cycle isolation: events of other cycles never affect the projection.
 */
import type { DeliveryState, RollEvent } from "@roll/spec";

/** States a later delivery event must never regress. */
const TERMINAL: ReadonlySet<DeliveryState> = new Set<DeliveryState>([
  "delivered",
  "delivered_external",
  // E3: local-only delivery — a cycle landed on the local integration branch.
  // Sticky like every other delivered terminal.
  "delivered_local",
  "superseded",
  "abandoned",
]);

/**
 * Fold a cycle's events into its DeliveryState. Pure + total.
 *
 * @param events - The event stream (any order-consistent slice; only events
 *   whose `cycleId` matches are considered).
 * @param cycleId - The cycle to project.
 *
 * @remarks Call pattern: O(events) per call. Readers projecting MANY cycles
 * (e.g. the US-DELIV-002 reconciler) should either slice the stream per cycle
 * or fold once into a Map<cycleId, DeliveryState> — not call this per cycle
 * over the full append-only stream (that would be O(cycles × events)).
 */
export function projectDeliveryState(events: readonly RollEvent[], cycleId: string): DeliveryState {
  let state: DeliveryState = "building";
  for (const ev of events) {
    if (!("cycleId" in ev) || ev.cycleId !== cycleId) continue;
    if (TERMINAL.has(state)) break;
    switch (ev.type) {
      case "delivery:evidence_gate":
        if (ev.verdict === "blocked") state = "blocked_no_evidence";
        break;
      case "delivery:published":
        state = "awaiting_merge";
        break;
      case "delivery:merge_attempt":
        if (ev.outcome === "ci_red") state = "ci_failed";
        break;
      case "delivery:abandoned":
        state = "abandoned";
        break;
      case "delivery:reconciled":
        state = ev.state;
        break;
      default:
        break;
    }
  }
  return state;
}
