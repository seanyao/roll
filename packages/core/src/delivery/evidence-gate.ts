/**
 * US-DELIV-004 — push-time evidence gate (fail-loud).
 *
 * Design .roll/features/delivery-reconciler/delivery-reconciler-design.md
 * §3.2/§4/§8: BEFORE the cycle branch is pushed, verify the acceptance
 * evidence (attest report + ac-map) was actually produced this cycle.
 * Missing evidence ⇒ `{ ok:false, reasons }` ⇒ the cycle is
 * `blocked_no_evidence` and the branch is NEVER pushed — "pushed a branch
 * but opened no PR" (裸分支无 PR) stops being a normal outcome and becomes a
 * fault state, handled like the zero-TCR class.
 *
 * This gate moves the CHECKPOINT earlier (push time instead of after-the-fact
 * attest); it does NOT change the attest judgement itself (FIX-329: attest is
 * earned at delivery, never backfilled). The CLI resolves the two facts from
 * disk (report/ac-map existence in either evidence root) and injects them;
 * the verdict is pure + total so it is exhaustively unit-testable.
 */

/** Pure inputs for {@link evidenceGateBeforePush} — all injectable. */
export interface EvidenceGateFacts {
  /** True iff an acceptance report (`<ID>-report.html`) exists in an evidence root. */
  readonly attestReportPresent: boolean;
  /** True iff `ac-map.json` exists for the story in an evidence root. */
  readonly acMapPresent: boolean;
}

/** The gate verdict: push allowed, or blocked with one reason per missing artifact. */
export type EvidenceGateVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * Pure push-time evidence gate. Deterministic reason order (attest report
 * first, then ac-map) so alerts and tests are stable.
 */
export function evidenceGateBeforePush(facts: EvidenceGateFacts): EvidenceGateVerdict {
  const reasons: string[] = [];
  if (!facts.attestReportPresent) {
    reasons.push("attest report missing (no acceptance report produced this cycle)");
  }
  if (!facts.acMapPresent) {
    reasons.push("ac-map.json missing");
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
