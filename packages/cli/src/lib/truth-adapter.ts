/**
 * US-TRUTH-004 — the ONE adapter between persisted fact rows and the truth
 * selectors (US-TRUTH-003). dashboard / status / dossier consume THESE
 * functions instead of each re-parsing runs rows with their own literals —
 * the per-consumer guessing is exactly what drifted (FIX-248's 0-vs-14,
 * the dossier's triple-check, the agents line's `built`-only success).
 *
 * Contract (AC5): any NEW consumer of cycle/story/evidence facts goes through
 * this module; adding a parallel parser is the regression this epic closes.
 * The adapter is read-side only — it never writes (selectors are not a
 * fact source).
 */
import {
  deriveCycleTruth,
  deriveEvidenceTruth,
  deriveStoryTruth,
  type CycleTruth,
  type EvidenceTruth,
  type AuditPrEvidence,
  type StoryTruth,
  type TruthState,
} from "@roll/core";
import { TERMINAL_SCHEMA_EPOCH_SEC, type TerminalOutcome } from "@roll/spec";

/** US-TRUTH-001 schema epoch — single home in @roll/spec (terminal.ts). */
export const TRUTH_SCHEMA_EPOCH_SEC = TERMINAL_SCHEMA_EPOCH_SEC;

/** Grace for read-side convergence judgments (anchor default). */
const GRACE_SEC = 3600;

/** A lenient runs row — the adapter owns the field-name knowledge. */
export type TruthRunRow = Record<string, unknown>;

function str(row: TruthRunRow, k: string): string {
  const v = row[k];
  return typeof v === "string" ? v : "";
}

function tsSec(row: TruthRunRow): number | null {
  const ts = str(row, "ts");
  if (ts === "") return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

/**
 * Derive one cycle's truth from its runs row (+ optionally the cycle's
 * terminal-twin outcome from the event stream). No GitHub probes here — the
 * interactive panel must not fan out; merge corrections arrive via the
 * backfill (FIX-243) and surface as `hasMergeStamp`.
 */
export function cycleTruthFromRow(
  row: TruthRunRow,
  opts: { terminalOutcome?: TerminalOutcome; branchEvidence?: AuditPrEvidence; nowSec: number },
): CycleTruth {
  return deriveCycleTruth({
    cycleId: str(row, "cycle_id") !== "" ? str(row, "cycle_id") : str(row, "run_id"),
    runStatus: str(row, "status"),
    runOutcome: str(row, "outcome"),
    hasMergeStamp: str(row, "merge_commit") !== "",
    hasCost: typeof row["cost_usd"] === "number",
    ...(opts.terminalOutcome !== undefined ? { terminalOutcome: opts.terminalOutcome } : {}),
    ...(opts.branchEvidence !== undefined ? { branchEvidence: opts.branchEvidence } : {}),
    tsSec: tsSec(row),
    nowSec: opts.nowSec,
    graceSec: GRACE_SEC,
    schemaEpochSec: TRUTH_SCHEMA_EPOCH_SEC,
  });
}

/** Did this runs row really deliver? The selector-backed replacement for the
 *  open-coded `status==="done"||"merged"||outcome==="delivered"` triple-check
 *  (story-dossier, morning report, …). */
export function rowDelivered(row: TruthRunRow, nowSec: number = Math.floor(Date.now() / 1000)): boolean {
  const t = cycleTruthFromRow(row, { nowSec });
  return t.outcome === "delivered" || t.outcome === "published_pending_merge";
}

/** Story truth for presentation consumers. The caller owns evidence gathering;
 *  absence stays unknown/grandfathered per the selector, never guessed here. */
export function storyTruthFromBacklog(
  storyId: string,
  backlogStatus: string,
  opts: { prEvidence?: AuditPrEvidence; nowSec?: number } = {},
): StoryTruth {
  return deriveStoryTruth({
    storyId,
    backlogStatus,
    ...(opts.prEvidence !== undefined ? { prEvidence: opts.prEvidence } : {}),
    deliveringCycles: [],
    nowSec: opts.nowSec ?? Math.floor(Date.now() / 1000),
    graceSec: GRACE_SEC,
    schemaEpochSec: TRUTH_SCHEMA_EPOCH_SEC,
  });
}

/** Evidence truth for a story straight from artifact probes (delegates). */
export function evidenceTruth(storyId: string, report: boolean, acMap: boolean, delivered: boolean): EvidenceTruth {
  return deriveEvidenceTruth({ storyId, report, acMap, delivered });
}

/** Fold a TerminalOutcome onto the dashboard's classification vocabulary.
 *  `unknown` STAYS unknown — AC4: never silently rendered as success. */
export function outcomeToPanel(outcome: CycleTruth["outcome"], state: TruthState): string {
  if (state === "unknown" && outcome === "unknown") return "unknown";
  switch (outcome) {
    case "delivered":
    case "published_pending_merge":
      return "done";
    case "idle_no_work":
      return "idle";
    case "failed":
    case "blocked":
    case "aborted_no_delivery":
    case "aborted_with_delivery":
    case "orphan_timeout":
      return "fail";
    default:
      return "unknown";
  }
}
