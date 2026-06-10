/**
 * US-TRUTH-001 — the Terminal Event schema (versioned, complete-or-reasoned).
 *
 * The cycle's old terminal records (cycle:end + runs row) mixed
 * failed/aborted/delivered/unknown and let a missing usage read as $0 — every
 * consumer guessed. A TerminalEvent makes incompleteness EXPLICIT: every fact
 * field is either present with a full value or carries an enumerated
 * absentReason. The truth anchor for cycle outcome stays the runs row
 * (truth.ts `cycle_outcome`); this event is its append-only, self-describing
 * twin in the event stream — written at the same moment, from the same facts.
 *
 * Grandfather policy (AC5): events written before this schema existed stay
 * untouched and are read under the legacy rules ("grandfathered" in audits);
 * from the version that ships this module, every cycle MUST append one
 * cycle:terminal event — the audit (US-TRUTH-002) flags new cycles without it.
 */

/** Bump on breaking shape changes; consumers branch on it. */
export const TERMINAL_EVENT_SCHEMA_VERSION = 1 as const;

/** The moment schema v1 SHIPPED (PR #586 merged 2026-06-10 ~17:10Z; pinned
 *  17:30Z). Cycles/rows before it are grandfathered in audits and selectors;
 *  everything after owes the complete-or-reasoned terminal twin. ONE home —
 *  the audit gatherer and the truth adapter import this, never re-declare. */
export const TERMINAL_SCHEMA_EPOCH_SEC = Date.UTC(2026, 5, 10, 17, 30) / 1000;

/** AC2 — the closed outcome vocabulary. `idle_no_work` is the honest name for
 *  an exit-0 zero-commit cycle (the spec's minimum eight + idle). */
export const TERMINAL_OUTCOMES = [
  "delivered",
  "published_pending_merge",
  "failed",
  "blocked",
  "aborted_no_delivery",
  "aborted_with_delivery",
  "orphan_timeout",
  "idle_no_work",
  "unknown",
] as const;
export type TerminalOutcome = (typeof TERMINAL_OUTCOMES)[number];

/** AC3 — why a fact field has no value. Closed enum; "we don't know" is a
 *  reason, never a zero. */
export const ABSENT_REASONS = [
  "no_publish_attempted",
  "no_commits",
  "not_rendered",
  "acmap_missing",
  "no_parseable_usage",
  "probe_failed",
  "killed_before_capture",
  "killed_before_publish",
  "not_applicable",
  "not_recorded",
] as const;
export type AbsentReason = (typeof ABSENT_REASONS)[number];

/** A fact that is either fully present or explicitly reasoned-absent. */
export type FactOr<T> = { present: true; value: T } | { present: false; reason: AbsentReason };

export function present<T>(value: T): FactOr<T> {
  return { present: true, value };
}

export function absent<T = never>(reason: AbsentReason): FactOr<T> {
  return { present: false, reason };
}

export interface TerminalPrFact {
  url: string;
  state: string;
  number?: number;
}

export interface TerminalAttestFact {
  reportPath: string;
  acMap: boolean;
}

export interface TerminalUsageFact {
  model: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface TerminalCostFact {
  estimatedUsd: number;
  effectiveUsd: number;
}

/** The versioned terminal record (AC1) — one per cycle, append-only. */
export interface TerminalEvent {
  type: "cycle:terminal";
  schema: typeof TERMINAL_EVENT_SCHEMA_VERSION;
  cycleId: string;
  storyId: string;
  agent: string;
  /** Epoch seconds. */
  startedAt: number;
  endedAt: number;
  outcome: TerminalOutcome;
  pr: FactOr<TerminalPrFact>;
  branch: FactOr<string>;
  commit: FactOr<string>;
  tcr: FactOr<number>;
  attest: FactOr<TerminalAttestFact>;
  usage: FactOr<TerminalUsageFact>;
  cost: FactOr<TerminalCostFact>;
  /** RollEvent stream timestamp (epoch seconds) — equals endedAt by default. */
  ts: number;
}

export interface TerminalEventInput {
  cycleId: string;
  storyId: string;
  agent: string;
  startedAt: number;
  endedAt: number;
  outcome: TerminalOutcome;
  pr: FactOr<TerminalPrFact>;
  branch: FactOr<string>;
  commit: FactOr<string>;
  tcr: FactOr<number>;
  attest: FactOr<TerminalAttestFact>;
  usage: FactOr<TerminalUsageFact>;
  cost: FactOr<TerminalCostFact>;
  ts?: number;
}

/** The one constructor — stamps type/schema so a hand-rolled object can't ship
 *  a missing field or a stale version. */
export function buildTerminalEvent(input: TerminalEventInput): TerminalEvent {
  return {
    type: "cycle:terminal",
    schema: TERMINAL_EVENT_SCHEMA_VERSION,
    cycleId: input.cycleId,
    storyId: input.storyId,
    agent: input.agent,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    outcome: input.outcome,
    pr: input.pr,
    branch: input.branch,
    commit: input.commit,
    tcr: input.tcr,
    attest: input.attest,
    usage: input.usage,
    cost: input.cost,
    ts: input.ts ?? input.endedAt,
  };
}

/** Inputs for the orphan/killed-cycle verdict (AC4) — the residue a dead or
 *  runaway cycle leaves: a lock pid, a branch, an age. */
export interface OrphanResidue {
  /** Is the lock-owning pid still alive? */
  pidAlive: boolean;
  /** Commits ahead on the cycle branch; null = probe unavailable. */
  commitsAhead: number | null;
  /** Seconds since cycle start. */
  ageSec: number;
  /** The hard cycle timeout (LOOP_CYCLE_TIMEOUT_SEC class). */
  timeoutSec: number;
}

/**
 * Derive a terminal verdict for a cycle that never wrote one (AC4): a killed
 * process or runaway orphan must yield a DERIVABLE outcome instead of a hole
 * the dashboard guesses around.
 *
 *   dead pid + commits     → aborted_with_delivery (work exists — rescue it)
 *   dead pid + none        → aborted_no_delivery
 *   dead pid + no probe    → unknown (never a guessed no-delivery)
 *   live pid past timeout  → orphan_timeout
 *   live pid within budget → null (still legitimately running)
 */
export function deriveOrphanVerdict(residue: OrphanResidue): TerminalOutcome | null {
  if (residue.pidAlive) {
    return residue.ageSec >= residue.timeoutSec ? "orphan_timeout" : null;
  }
  if (residue.commitsAhead === null) return "unknown";
  return residue.commitsAhead > 0 ? "aborted_with_delivery" : "aborted_no_delivery";
}
