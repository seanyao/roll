/**
 * FIX-1058 — evidence-repair recovery for green PRs missing acceptance reports.
 *
 * When a loop PR is CI green and has an accepted evaluator result but lacks a
 * fresh acceptance report, the supervisor blocks on a manual merge gate. This
 * module provides the detection and classification functions so the recovery
 * command can identify reparable PRs and, after repair, the supervisor can
 * recognise them as merge-ready rather than blocked.
 *
 * Pure by construction — zero I/O. All facts are injected; the caller resolves
 * PR state, CI state, evaluator state, and event stream.
 */

/** The possible evidence-repair classifications for an open PR. */
export type EvidenceRepairClassification =
  | { verdict: "reparable"; reason: string }
  | { verdict: "already_repaired"; reason: string }
  | { verdict: "not_reparable"; reason: string }
  | { verdict: "no_gap"; reason: string };

/** Inputs for {@link classifyEvidenceRepair}. */
export interface EvidenceRepairInput {
  /** The PR's CI status — "success", "failure", "pending", or "unknown". */
  ciState: string;
  /** The PR's evaluator review state — "APPROVED", "CHANGES_REQUESTED", etc. */
  reviewState: string;
  /** Whether the PR's merge is clean ("CLEAN", "BEHIND", "DIRTY", "CONFLICTING"). */
  mergeable: string;
  /** Whether the PR is a draft. */
  isDraft: boolean;
  /** True iff the PR's associated story has a fresh acceptance report. */
  hasFreshReport: boolean;
  /** True iff an `evidence:repaired` event already exists for this PR. */
  alreadyRepaired: boolean;
}

/**
 * Classify a PR's evidence-repair eligibility.
 *
 * A PR is REPARABLE when:
 *   - CI is green (success)
 *   - Evaluator has approved (APPROVED)
 *   - Merge is clean (CLEAN)
 *   - BUT no fresh acceptance report exists
 *   - AND repair hasn't already been done
 *
 * A PR is ALREADY_REPAIRED when all conditions above are met and an
 * `evidence:repaired` event exists — the supervisor should show merge_ready.
 *
 * A PR has NO_GAP when it has a fresh report — nothing to repair.
 *
 * A PR is NOT_REPARABLE when CI is red, evaluator hasn't approved, merge is
 * dirty, or any other condition that means evidence alone won't make it ready.
 */
export function classifyEvidenceRepair(input: EvidenceRepairInput): EvidenceRepairClassification {
  // Structural preconditions: only green + approved + clean PRs are candidates.
  if (input.ciState !== "success") {
    return { verdict: "not_reparable", reason: `CI is not green (${input.ciState}); evidence repair cannot fix CI` };
  }
  if (input.reviewState !== "APPROVED") {
    return { verdict: "not_reparable", reason: `evaluator has not approved (${input.reviewState}); evidence repair cannot replace evaluator review` };
  }
  if (input.mergeable !== "CLEAN") {
    return { verdict: "not_reparable", reason: `merge is not clean (${input.mergeable}); evidence repair cannot resolve merge conflicts` };
  }

  // Already repaired — the supervisor should show merge_ready.
  if (input.alreadyRepaired) {
    return { verdict: "already_repaired", reason: "evidence already repaired; PR is merge-ready" };
  }

  // Has fresh report — no gap to fill.
  if (input.hasFreshReport) {
    return { verdict: "no_gap", reason: "fresh acceptance report exists; no evidence gap to repair" };
  }

  // Reparable: green PR, approved evaluator, clean merge, but no fresh report.
  return {
    verdict: "reparable",
    reason: input.isDraft
      ? "draft PR is CI green + evaluator approved + merge clean but lacks a fresh acceptance report"
      : "PR is CI green + evaluator approved + merge clean but lacks a fresh acceptance report",
  };
}

/**
 * The action string the supervisor should show for a PR after evidence repair
 * (replacing the previous `draft_manual_merge_waiting` or similar block).
 */
export const EVIDENCE_REPAIRED_ACTION = "merge_ready" as const;

/**
 * Determine whether a manual-merge gate should be reclassified as merge-ready
 * because evidence has been repaired for this PR.
 *
 * Called by the supervisor when building the manual merge gate list.
 */
export function isEvidenceRepaired(
  prNumber: number,
  repairedPrs: ReadonlySet<number>,
): boolean {
  return repairedPrs.has(prNumber);
}

/**
 * Scan events for `evidence:repaired` records and return the set of PR numbers
 * that have been repaired.
 */
export function repairedPrNumbers(events: ReadonlyArray<{ type: string; prNumber?: number }>): Set<number> {
  const repaired = new Set<number>();
  for (const ev of events) {
    if (ev.type === "evidence:repaired" && typeof ev.prNumber === "number") {
      repaired.add(ev.prNumber);
    }
  }
  return repaired;
}
