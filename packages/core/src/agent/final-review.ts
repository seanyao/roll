import type { GoalReviewMode } from "@roll/spec";
import { selectPeerReviewer } from "./peer-review.js";

export type EffectiveGoalReviewMode = "hetero" | "self";

export type GoalFinalReviewerSelection =
  | {
      status: "selected";
      effectiveMode: EffectiveGoalReviewMode;
      reviewer: string;
      provider: string;
      degraded: boolean;
      reason?: string;
    }
  | { status: "unavailable"; reason: "no_installed_reviewer" | "no_heterogeneous_reviewer" };

export interface GoalFinalReviewerInput {
  mode: Exclude<GoalReviewMode, "off">;
  installedAgents: readonly string[];
  workerAgents: readonly string[];
}

export function selectGoalFinalReviewer(input: GoalFinalReviewerInput): GoalFinalReviewerSelection {
  const selected = selectPeerReviewer({
    mode: input.mode,
    candidates: input.installedAgents,
    workerAgents: input.workerAgents,
  });
  if (selected.status === "selected") return selected;
  if (selected.reason === "no_heterogeneous_reviewer") return { status: "unavailable", reason: "no_heterogeneous_reviewer" };
  return { status: "unavailable", reason: "no_installed_reviewer" };
}
