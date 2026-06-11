/**
 * US-TRUTH-003 — Truth Selectors: pure derivation over declared snapshots.
 *
 * One conclusion per question — story delivered? cycle outcome? evidence
 * complete? — derived ONLY from authority-declared snapshot inputs
 * (US-TRUTH-000 anchor registry) and frozen on the real drift fixtures the
 * shadow audit (US-TRUTH-002) encodes. The selector layer:
 *
 *   - never reads `.roll`, git, or GitHub (inputs are injected snapshots);
 *   - never writes anything (it is NOT another fact source — the peer-review
 *     ruling that re-shaped this epic);
 *   - resolves conflicts by the anchor arbitration rules with CLOSED reason
 *     codes, so dashboards/dossier/release-gate (US-TRUTH-004/005) can consume
 *     one serializable verdict instead of each re-parsing the world.
 *
 * Truth states mirror the audit severities: truth / warn / fail / unknown /
 * grandfathered. `unknown` is a legal state (gh down, convergence window);
 * `grandfathered` marks pre-epoch history that is listed, never judged.
 */
import { TERMINAL_OUTCOMES, type TerminalOutcome } from "@roll/spec";
import type { AuditPrEvidence } from "../consistency/audit.js";

export type TruthState = "truth" | "warn" | "fail" | "unknown" | "grandfathered";

/** Closed reason vocabulary (AC4) — every verdict explains itself. */
export const TRUTH_REASONS = [
  "merge_evidence_confirms",
  "premature_done",
  "merge_evidence_unavailable",
  "lagging_view",
  "converging_within_grace",
  "pre_card_era",
  "phantom_failure_uncorrected",
  "terminal_twin_missing",
  "usage_missing",
  "evidence_complete",
  "report_missing",
  "acmap_missing",
  "not_yet_owed",
  "terminal_self_reported",
  "no_claim_no_evidence",
] as const;
export type TruthReason = (typeof TRUTH_REASONS)[number];

// ── story truth ───────────────────────────────────────────────────────────────

export interface DeliveringCycle {
  cycleId: string;
  merged: boolean;
}

/** Snapshot slice for one story — every field maps to a declared anchor:
 *  backlogStatus (derived view), prEvidence (story_delivery authority),
 *  deliveringCycles (cycle_outcome view). */
export interface StoryTruthInput {
  storyId: string;
  backlogStatus: string;
  prEvidence?: AuditPrEvidence;
  deliveringCycles: DeliveringCycle[];
  nowSec: number;
  graceSec: number;
  schemaEpochSec: number;
}

export interface StoryTruth {
  storyId: string;
  /** Is the work merged to main (the only delivery truth)? */
  delivered: boolean;
  state: TruthState;
  reason: TruthReason;
  /** Concurrent-delivery losers (AC5): cycles whose claim a merged duplicate supersedes. */
  supersededCycles?: string[];
}

export function deriveStoryTruth(input: StoryTruthInput): StoryTruth {
  const isDoneRow = input.backlogStatus.includes("✅");
  const annotated = /PR#\d+/.test(input.backlogStatus);
  const ev = input.prEvidence;
  const superseded = input.deliveringCycles.filter((c) => !c.merged).map((c) => c.cycleId);
  const withSuperseded = (t: StoryTruth): StoryTruth =>
    input.deliveringCycles.some((c) => c.merged) && superseded.length > 0 ? { ...t, supersededCycles: superseded } : t;

  if (ev === undefined) {
    if (isDoneRow && !annotated) {
      return { storyId: input.storyId, delivered: false, state: "grandfathered", reason: "pre_card_era" };
    }
    if (isDoneRow) {
      return { storyId: input.storyId, delivered: false, state: "unknown", reason: "merge_evidence_unavailable" };
    }
    return { storyId: input.storyId, delivered: false, state: "truth", reason: "no_claim_no_evidence" };
  }

  if (ev.state === "MERGED") {
    if (isDoneRow) {
      return withSuperseded({ storyId: input.storyId, delivered: true, state: "truth", reason: "merge_evidence_confirms" });
    }
    // merged but the derived view lags — converging or stale.
    const mergedAt = ev.mergedAtSec ?? 0;
    if (input.nowSec - mergedAt < input.graceSec) {
      return withSuperseded({ storyId: input.storyId, delivered: true, state: "unknown", reason: "converging_within_grace" });
    }
    return withSuperseded({ storyId: input.storyId, delivered: true, state: "warn", reason: "lagging_view" });
  }

  if (isDoneRow) {
    // Done row, evidence says NOT merged — the premature-Done family.
    return { storyId: input.storyId, delivered: false, state: "fail", reason: "premature_done" };
  }
  return { storyId: input.storyId, delivered: false, state: "truth", reason: "no_claim_no_evidence" };
}

// ── cycle truth ───────────────────────────────────────────────────────────────

export interface CycleTruthInput {
  cycleId: string;
  /** runs row terminal status/outcome (cycle_outcome anchor's view pair). */
  runStatus: string;
  runOutcome: string;
  /** merge stamps already backfilled onto the row? */
  hasMergeStamp: boolean;
  /** cycle-branch PR evidence (pr_merge anchor). */
  branchEvidence?: AuditPrEvidence;
  /** US-TRUTH-001 terminal twin outcome when one was written. */
  terminalOutcome?: TerminalOutcome;
  /** does the row carry cost fields (usage_cost anchor view)? undefined = not asked. */
  hasCost?: boolean;
  tsSec: number | null;
  nowSec: number;
  graceSec: number;
  schemaEpochSec: number;
}

export interface CycleTruth {
  cycleId: string;
  /** The derived outcome in the US-TRUTH-001 vocabulary (best knowledge). */
  outcome: TerminalOutcome | "";
  state: TruthState;
  reason: TruthReason;
}

const TERMINAL_OUTCOME_SET: ReadonlySet<string> = new Set<string>(TERMINAL_OUTCOMES);

// Historical runs-row boundary only. New row writes already carry TerminalOutcome
// in `outcome` and must pass through before this table is consulted.
const ROW_TO_TERMINAL: Record<string, TerminalOutcome> = {
  done: "delivered",
  merged: "delivered",
  delivered: "delivered",
  published: "published_pending_merge",
  built: "published_pending_merge",
  idle: "idle_no_work",
  failed: "failed",
  blocked: "blocked",
  aborted: "aborted_no_delivery",
  interrupted: "aborted_no_delivery",
  orphan: "aborted_with_delivery",
};

export function deriveCycleTruth(input: CycleTruthInput): CycleTruth {
  const pre = input.tsSec !== null && input.tsSec < input.schemaEpochSec;

  // The branch's MERGED evidence outranks the row terminal (anchor arbitration).
  if (!input.hasMergeStamp && input.branchEvidence?.state === "MERGED") {
    const mergedAt = input.branchEvidence.mergedAtSec ?? 0;
    if (input.nowSec - mergedAt < input.graceSec) {
      return { cycleId: input.cycleId, outcome: "delivered", state: "unknown", reason: "converging_within_grace" };
    }
    // judged by MERGE time vs grace, not the row's epoch: the backfill exists
    // NOW, so an uncorrected phantom row is live drift however old the cycle.
    return { cycleId: input.cycleId, outcome: "delivered", state: "fail", reason: "phantom_failure_uncorrected" };
  }

  // A terminal twin is the self-reported truth for non-merge questions.
  if (input.terminalOutcome !== undefined) {
    return { cycleId: input.cycleId, outcome: input.terminalOutcome, state: "truth", reason: "terminal_self_reported" };
  }

  if (input.runStatus === "") {
    // No row, no twin — the orphan hole.
    return {
      cycleId: input.cycleId,
      outcome: "unknown",
      state: pre ? "grandfathered" : "unknown",
      reason: "terminal_twin_missing",
    };
  }

  const mappedStatus = ROW_TO_TERMINAL[input.runStatus];
  const terminalOutcome = TERMINAL_OUTCOME_SET.has(input.runOutcome)
    ? (input.runOutcome as TerminalOutcome)
    : undefined;
  const outcome = terminalOutcome === undefined || (mappedStatus !== undefined && terminalOutcome !== mappedStatus)
    ? mappedStatus ?? ROW_TO_TERMINAL[input.runOutcome] ?? "unknown"
    : terminalOutcome;
  if (input.hasCost === false && outcome === "delivered" && !pre) {
    return { cycleId: input.cycleId, outcome, state: "warn", reason: "usage_missing" };
  }
  return {
    cycleId: input.cycleId,
    outcome,
    state: pre && (input.runStatus === "failed" || input.runStatus === "aborted") ? "grandfathered" : "truth",
    reason: "merge_evidence_confirms",
  };
}

// ── evidence truth ────────────────────────────────────────────────────────────

export interface EvidenceTruthInput {
  storyId: string;
  report: boolean;
  acMap: boolean;
  /** Evidence is owed only once the story delivered (attest anchor unknownPolicy). */
  delivered: boolean;
}

export interface EvidenceTruth {
  storyId: string;
  state: TruthState;
  reason: TruthReason;
}

export function deriveEvidenceTruth(input: EvidenceTruthInput): EvidenceTruth {
  if (!input.delivered) return { storyId: input.storyId, state: "unknown", reason: "not_yet_owed" };
  if (input.report && input.acMap) return { storyId: input.storyId, state: "truth", reason: "evidence_complete" };
  if (input.report) return { storyId: input.storyId, state: "fail", reason: "acmap_missing" };
  return { storyId: input.storyId, state: "fail", reason: "report_missing" };
}
