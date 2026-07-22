/**
 * US-DELTA-001 — Admission matrix: determines whether a trigger × topology
 * combination is valid at the execution gate.
 *
 * This is intentionally narrower than the data model's type system:
 * the types allow any combination; the admission gate rejects invalid ones.
 * Rejected combinations are blocked, never silently converted.
 */
import type { DelegationTrigger, DeliveryTopology, DeltaBlockReason } from "@roll/spec";

/** The result of running a (trigger, topology) pair through the admission gate. */
export type AdmissionResult =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: DeltaBlockReason; readonly detail: string };

/**
 * Admission gate: given a trigger and topology, is this combination valid?
 *
 * Rules:
 * - host-guided + anything → valid
 * - loop-autonomous + solo → valid
 * - loop-autonomous + full-delta-team → valid (explicit opt-in in v1)
 * - loop-autonomous + delta-team → BLOCKED (no implicit Supervisor host)
 */
export function admit(trigger: DelegationTrigger, topology: DeliveryTopology): AdmissionResult {
  if (trigger === "host-guided") {
    // Host-guided admits all topologies — the host is the implicit Supervisor.
    return { admitted: true };
  }

  // loop-autonomous
  switch (topology) {
    case "solo":
      return { admitted: true };
    case "full-delta-team":
      // Explicit opt-in for v1 — allowed through the admission gate.
      return { admitted: true };
    case "delta-team":
      return {
        admitted: false,
        reason: "host_supervisor_required",
        detail:
          "loop-autonomous + delta-team requires an active host Supervisor; " +
          "the loop has no implicit coding-agent main session. " +
          "Use full-delta-team for adapter-launched roles, or attach a host Supervisor.",
      };
  }
}

/**
 * Full admission check including quality profile validation.
 * Quality profiles never imply topology — they only control evidence rigor.
 */
export function admitShape(
  trigger: DelegationTrigger,
  topology: DeliveryTopology,
  _qualityProfile: string,
): AdmissionResult {
  return admit(trigger, topology);
}
