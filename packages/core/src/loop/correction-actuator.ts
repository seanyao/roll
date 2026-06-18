import type { RollEvent } from "@roll/spec";

export type CorrectionActuatorMode = "conservative" | "auto";
export type CorrectionAction = "alert_only" | "open_fix" | "return_story" | "route_adjust";

export interface CorrectionAttribution {
  source: "attest:gate" | "acceptance-report" | "review-score" | "ci" | "unknown";
  layer: "acceptance" | "retrospective" | "ci" | "unknown";
  summary: string;
  evidence: string[];
}

export interface CorrectionDecisionInput {
  storyId: string;
  cycleId?: string;
  reasons: readonly string[];
  mode: CorrectionActuatorMode;
  events?: readonly RollEvent[];
}

export interface CorrectionDecision {
  mode: CorrectionActuatorMode;
  action: CorrectionAction;
  plannedAction: CorrectionAction;
  storyId: string;
  cycleId?: string;
  signal: string;
  reason: string;
  source: CorrectionAttribution["source"];
  attribution: CorrectionAttribution;
  priorCorrections: number;
}

function compact(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function reasonText(reasons: readonly string[]): string {
  const text = compact(reasons.filter((r) => r.trim() !== "").join("; "));
  return text === "" ? "correction comparator failed without a reason" : text;
}

function classifyAttribution(storyId: string, reasons: readonly string[]): {
  signal: string;
  plannedAction: CorrectionAction;
  attribution: CorrectionAttribution;
} {
  const text = reasonText(reasons);
  const lower = text.toLowerCase();
  if (/review[-\s]?score.*regression|regression.*review[-\s]?score/.test(lower)) {
    return {
      signal: "review_score_regression",
      plannedAction: "return_story",
      attribution: {
        source: "review-score",
        layer: "retrospective",
        summary: text,
        evidence: ["events.ndjson", "attest:gate skipped", `.roll/features/<epic>/${storyId}/notes/`],
      },
    };
  }
  if (/empty[-\s]?shell|no ac content|no ac-map|without ac-map/.test(lower)) {
    return {
      signal: "empty_acceptance_report",
      plannedAction: "open_fix",
      attribution: {
        source: "acceptance-report",
        layer: "acceptance",
        summary: text,
        evidence: [
          "events.ndjson",
          "attest:gate skipped",
          `.roll/features/<epic>/${storyId}/latest/${storyId}-report.html`,
          "ac-map.json",
        ],
      },
    };
  }
  if (/no fresh acceptance report|without a fresh acceptance report|missing acceptance report/.test(lower)) {
    return {
      signal: "missing_acceptance_report",
      plannedAction: "open_fix",
      attribution: {
        source: "attest:gate",
        layer: "acceptance",
        summary: text,
        evidence: [
          "events.ndjson",
          "attest:gate skipped",
          `.roll/features/<epic>/${storyId}/latest/${storyId}-report.html`,
          "ac-map.json",
        ],
      },
    };
  }
  if (/\bci\b.*fail|check.*fail|red ci/.test(lower)) {
    return {
      signal: "ci_failed",
      plannedAction: "open_fix",
      attribution: {
        source: "ci",
        layer: "ci",
        summary: text,
        evidence: ["events.ndjson: ci:fail", "runs.jsonl: cycle row"],
      },
    };
  }
  return {
    signal: "unknown_failure",
    plannedAction: "alert_only",
    attribution: {
      source: "unknown",
      layer: "unknown",
      summary: text,
      evidence: ["events.ndjson"],
    },
  };
}

function priorCorrectionCount(events: readonly RollEvent[], storyId: string, signal: string): number {
  let n = 0;
  for (const ev of events) {
    if (ev.type !== "correction:action") continue;
    if (ev.storyId !== storyId) continue;
    if (ev.signal !== signal) continue;
    n += 1;
  }
  return n;
}

export function decideCorrectionAction(input: CorrectionDecisionInput): CorrectionDecision {
  const classified = classifyAttribution(input.storyId, input.reasons);
  const priorCorrections = priorCorrectionCount(input.events ?? [], input.storyId, classified.signal);
  let plannedAction =
    priorCorrections > 0 && classified.plannedAction !== "alert_only"
      ? "route_adjust"
      : classified.plannedAction;
  // FIX-332: a repeated empty-shell acceptance report for the same story means the
  // resume-evidence bridge (or the agent) failed to produce content twice. Stop
  // minting endless autofix cards and return the story to Todo so the loop's
  // cross-session dead-loop breaker can pause the goal instead of burning cycles.
  if (priorCorrections > 0 && classified.signal === "empty_acceptance_report") {
    plannedAction = "return_story";
  }
  const action = input.mode === "conservative" ? "alert_only" : plannedAction;
  return {
    mode: input.mode,
    action,
    plannedAction,
    storyId: input.storyId,
    ...(input.cycleId !== undefined ? { cycleId: input.cycleId } : {}),
    signal: classified.signal,
    reason: classified.attribution.summary,
    source: classified.attribution.source,
    attribution: classified.attribution,
    priorCorrections,
  };
}
