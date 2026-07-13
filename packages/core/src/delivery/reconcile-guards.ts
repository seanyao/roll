/**
 * US-DELIV-011 — reconcile side-effect idempotency guards.
 *
 * Multi-source reconcile (human / cron / CI / loop boundary) may overlap.
 * Before `gh pr merge` or a `delivery:reconciled` credit append, consult these
 * pure predicates so concurrent / re-entrant ticks converge without duplicate
 * merges or duplicate delivered events. Reuses the event projection as the
 * single source of truth (no new distributed lock in core).
 */
import type { RollEvent } from "@roll/spec";
import { projectDeliveryState } from "./state.js";

const CREDITED_STATES = new Set(["delivered", "delivered_external"]);

/** True when the cycle projection is already credited on main. */
export function cycleAlreadyCredited(events: readonly RollEvent[], cycleId: string): boolean {
  return CREDITED_STATES.has(projectDeliveryState(events, cycleId));
}

/** True when a delivery:reconciled credit event already exists for the cycle. */
export function hasCreditedReconciledEvent(events: readonly RollEvent[], cycleId: string): boolean {
  for (const ev of events) {
    if (!("cycleId" in ev) || ev.cycleId !== cycleId) continue;
    if (
      ev.type === "delivery:reconciled" &&
      (ev.state === "delivered" || ev.state === "delivered_external")
    ) {
      return true;
    }
  }
  return false;
}

/** Whether a new delivery:reconciled credit may be appended. */
export function shouldAppendDeliveredCredit(events: readonly RollEvent[], cycleId: string): boolean {
  return !hasCreditedReconciledEvent(events, cycleId);
}

/** Whether `gh pr merge` may be attempted for this cycle. */
export function shouldAttemptPrMerge(events: readonly RollEvent[], cycleId: string): boolean {
  if (cycleAlreadyCredited(events, cycleId)) return false;
  for (const ev of events) {
    if (!("cycleId" in ev) || ev.cycleId !== cycleId) continue;
    if (ev.type === "delivery:merge_attempt" && ev.outcome === "merged") return false;
  }
  return true;
}
