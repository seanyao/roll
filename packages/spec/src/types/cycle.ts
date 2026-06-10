/** Cycle contracts (BC2/BC8, I11/I12). */
export type CyclePhase =
  | "pick"
  | "route"
  | "worktree"
  | "execute"
  | "publish"
  | "merge-wait"
  | "reconcile"
  | "cleanup";

/** Exit code 0 ≠ delivered — outcome is decided by reconcile (I4). */
export type CycleOutcome = "delivered" | "built" | "failed" | "blocked" | "aborted" | "reverted";

export interface CycleCost {
  cycleId: string;
  agent: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** FIX-249: cache token split (pi/claude report it) — absent = adapter had none. */
  cacheRead?: number;
  cacheWrite?: number;
  /** USD estimate from real price table; missing prices stay explicit n/a upstream. */
  estimatedCost: number;
  /** TCR revert count this cycle. */
  revertCount: number;
  /** Cost including reverts — budget guardrails gate on this, not nominal (I11). */
  effectiveCost: number;
}
