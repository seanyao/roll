/**
 * US-DELIV-002 — layered reconcile-from-main: the heart of the delivery
 * reconciler epic. A PURE function that determines delivery truth from
 * layered signals (design §3.3, §4).
 *
 * Invariants:
 * - ≥1 strong signal (L1 PR-state | L2 patch-id) required to declare delivered.
 * - L3 alone (backlog Done + attest) is NEVER sufficient.
 * - When no signal hits, return `wait` — never fabricate a delivery.
 * - main is the single anchor; cycle ledger is a pure projection.
 *
 * Pure: no filesystem, no network, no clock, no side effects.
 * Idempotent: same inputs → same output.
 * Exhaustively unit-testable.
 */

import type { DeliveryState } from "@roll/spec";

// ── Input types ───────────────────────────────────────────────────────────────

/** A cycle's delivery-relevant facts, extracted from runs/events. */
export interface ReconcileCycle {
  cycleId: string;
  storyId: string;
  branch: string;
  prNumber?: number;
  /** Current deliveryState from the event projection (projectDeliveryState). */
  deliveryState: DeliveryState;
}

/** External facts gathered by the IO adapter (gh / git). */
export interface ReconcileFacts {
  /** L1: PR state from gh (undefined = gh unavailable / PR not found). */
  prState?: "OPEN" | "MERGED" | "CLOSED";
  /** L1: merge commit SHA from the PR (only when prState is MERGED). */
  prMergeCommit?: string;
  /**
   * L2: git patch-id of the diff (origin/main...branch) — the net diff the
   * cycle branch introduced. Undefined when the branch cannot be resolved
   * (deleted / never pushed).
   */
  branchNetPatchId?: string;
  /**
   * L2: set of patch-ids from main's merge commits since the branch's fork
   * point. Each entry is git-patch-id(diff of one commit on main).
   * Empty when main has no commits past the branch base (should not happen
   * for a merged PR, but handled gracefully).
   */
  mainPatchIds: ReadonlySet<string>;
  /** CI status for the PR (drives merge_now vs ci_failed). */
  ciGreen?: boolean;
  /** L3 cross-check: does the backlog row say Done? */
  backlogDone: boolean;
  /** L3 cross-check: does an attest report exist? */
  attestPresent: boolean;
}

// ── Output types ──────────────────────────────────────────────────────────────

export type ReconcileResult =
  | {
      kind: "delivered";
      via: "runner" | "external";
      signal: "pr_state" | "patch_id";
      mergeCommit?: string;
    }
  | { kind: "merge_now"; method: "squash" }
  | { kind: "ci_failed" }
  | { kind: "superseded"; reason: string }
  | { kind: "wait" };

// ── Pure decision function ────────────────────────────────────────────────────

/**
 * Determine delivery truth for one cycle from layered signals.
 *
 * Layered truth determination (design §3.3):
 *   L1 — PR state (MERGED, strongest signal, authoritative).
 *   L2 — patch-id equivalence (squash/rebase-safe, offline-capable).
 *   L3 — backlog Done + attest (weak, cross-check only; NEVER sufficient alone).
 *
 * Decision rules (priority order):
 *   1. PR MERGED → delivered (L1 authoritative; via=external unless the caller
 *      has runner context).
 *   2. branchNetPatchId ∈ mainPatchIds → delivered_external (L2, works offline).
 *      L1+L2 both hit: L1 wins, L2 is corroborating evidence.
 *   3. CI green + PR open + not merged → merge_now (drive auto-merge).
 *   4. CI red → ci_failed.
 *   5. Nothing hits → wait (never fabricate delivered). L3 alone is never
 *      sufficient.
 *
 * Guardrails:
 *   - L1/L2 "conflict": L1 MERGED always wins. L2 miss on an amend is expected.
 *   - Uncertain → wait: when prState is undefined AND branchNetPatchId is
 *     undefined, no strong signal is possible → wait.
 *
 * @param cyc - The cycle facts from the event projection.
 * @param facts - External facts gathered by the IO adapter.
 * @returns A {@link ReconcileResult} — pure, deterministic, idempotent.
 */
export function reconcileDelivery(
  cyc: ReconcileCycle,
  facts: ReconcileFacts,
): ReconcileResult {
  // ── L1: PR state is the strongest signal ──────────────────────────────────
  if (facts.prState === "MERGED") {
    return {
      kind: "delivered",
      // L1 alone does not distinguish runner vs external — the caller stamps
      // via from merge evidence context. Default to external since runner
      // self-merge is tracked via delivery:merge_attempt events.
      via: "external",
      signal: "pr_state",
      mergeCommit: facts.prMergeCommit,
    };
  }

  // ── L2: patch-id equivalence (squash/rebase safe) ─────────────────────────
  // Only triggers when L1 did NOT fire (PR not merged, or gh unavailable).
  if (
    facts.branchNetPatchId !== undefined &&
    facts.mainPatchIds.has(facts.branchNetPatchId)
  ) {
    return {
      kind: "delivered",
      via: "external",
      signal: "patch_id",
    };
  }

  // ── L1 + L2 both silent: assess CI for merge_now / ci_failed ──────────────
  // Only relevant when the cycle is awaiting_merge and the PR is OPEN.
  if (facts.prState === "OPEN") {
    if (facts.ciGreen === true) {
      return { kind: "merge_now", method: "squash" };
    }
    if (facts.ciGreen === false) {
      return { kind: "ci_failed" };
    }
  }

  // ── L3 alone: never sufficient ────────────────────────────────────────────
  // The design is explicit (§3.3, §8): L3 alone (backlog Done + attest) is NOT
  // sufficient to declare delivered. An agent can pre-write Done or symlink
  // attest (FIX-304). Only L1 or L2 (real merge evidence on main) credits
  // delivery.

  // ── All signals exhausted, no strong evidence → wait (never fabricate) ─────
  return { kind: "wait" };
}

/**
 * Build a `delivery:reconciled` event payload from a reconcile result.
 * The caller appends this event; the cycle ledger re-projects from it via
 * `projectDeliveryState`.
 *
 * Pure: result in, event payload out. No side effects.
 */
export function reconciledEventPayload(
  cyc: ReconcileCycle,
  result: Extract<ReconcileResult, { kind: "delivered" }>,
  now: number,
): {
  type: "delivery:reconciled";
  cycleId: string;
  storyId: string;
  state: "delivered" | "delivered_external";
  mergedBy: "runner" | "external";
  mergeCommit: string;
  signal: "pr_state" | "patch_id" | "backlog_attest";
  patchId?: string;
  ts: number;
} {
  return {
    type: "delivery:reconciled",
    cycleId: cyc.cycleId,
    storyId: cyc.storyId,
    state: result.via === "runner" ? "delivered" : "delivered_external",
    mergedBy: result.via,
    mergeCommit: result.mergeCommit ?? "unknown",
    signal: result.signal,
    ts: now,
  };
}
