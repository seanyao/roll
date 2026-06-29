/**
 * Delivery gate — pure, injectable guard that prevents false "delivered"
 * conclusions when structural preconditions are unmet.
 *
 * FIX-1032a: v4 first-trial (intel-radar US-TASK-001, cycle 20260629-112437-39253)
 * exposed two false-delivered conditions:
 *   1. PR published but no PR loop installed → cycle wrote `delivered` anyway,
 *      leaving the published PR without a merge guardian.
 *   2. PR merged but main CI red → delivery marked `delivered` on broken code
 *      that had already been merged to main.
 *
 * This gate blocks both, produces structured alerts, and is injectable
 * (zero I/O) so fixture tests can cover all three states without real network
 * calls or launchd probes.
 */

/** CI status of the main branch after merge. */
export type MainCiStatus = "green" | "red" | "unknown" | "pending";

/** Pure inputs for {@link deliveryGate} — all injectable. */
export interface DeliveryGateInput {
  /** True iff a PR loop service is installed and healthy for this project. */
  prLoopHealthy: boolean;
  /** Main CI status on the merge commit. */
  mainCiStatus: MainCiStatus;
  /** PR URL for alerting. */
  prUrl?: string;
  /** CI run URL for alerting (meaningful when CI is red). */
  ciRunUrl?: string;
}

/** The three possible delivery-gate verdicts. */
export type DeliveryGateVerdict =
  | { readonly verdict: "allowed" }
  | {
      readonly verdict: "pr_loop_unavailable";
      readonly alert: string;
      readonly prUrl?: string;
    }
  | {
      readonly verdict: "ci_red_after_merge";
      readonly alert: string;
      readonly ciRunUrl?: string;
    };

/**
 * Pure delivery gate: decide whether a published/merged cycle may be recorded
 * as delivered, or whether a structural gate (missing PR loop, red main CI)
 * blocks the delivery conclusion.
 *
 * Rules (FIX-1032a):
 *   - PR loop absent / unhealthy → `pr_loop_unavailable` (never delivered).
 *   - Main CI red after merge    → `ci_red_after_merge` (never delivered).
 *   - Both conditions satisfied   → `allowed`.
 *
 * Pure by construction: zero I/O, zero side effects. All facts are injected;
 * the caller (executor / test) resolves PR loop health and CI status.
 */
export function deliveryGate(input: DeliveryGateInput): DeliveryGateVerdict {
  if (!input.prLoopHealthy) {
    return {
      verdict: "pr_loop_unavailable",
      alert:
        "PR loop not installed or not healthy; delivery blocked — published PR has no merge guardian. " +
        "Install the PR loop service (`roll loop on --pr`) or manually merge and confirm delivery.",
      prUrl: input.prUrl,
    };
  }
  if (input.mainCiStatus === "red") {
    return {
      verdict: "ci_red_after_merge",
      alert:
        "main CI red after merge; delivery blocked — merged code has failing CI. Fix-forward or revert required.",
      ciRunUrl: input.ciRunUrl,
    };
  }
  return { verdict: "allowed" };
}
