import type { GoalReviewMode } from "@roll/spec";
import { agentVendor } from "./pairing.js";
import { canonicalAgentName } from "./registry.js";

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

function uniqueCanonical(agents: readonly string[]): string[] {
  const out: string[] = [];
  for (const agent of agents) {
    const canonical = canonicalAgentName(agent.trim());
    if (canonical === "" || out.includes(canonical)) continue;
    out.push(canonical);
  }
  return out;
}

function firstSelfReviewer(installed: readonly string[], workers: readonly string[]): string | undefined {
  return workers.find((agent) => installed.includes(agent)) ?? installed[0];
}

export function selectGoalFinalReviewer(input: GoalFinalReviewerInput): GoalFinalReviewerSelection {
  const installed = uniqueCanonical(input.installedAgents);
  const workers = uniqueCanonical(input.workerAgents);
  if (installed.length === 0) return { status: "unavailable", reason: "no_installed_reviewer" };

  if (input.mode === "self") {
    const reviewer = firstSelfReviewer(installed, workers);
    if (reviewer === undefined) return { status: "unavailable", reason: "no_installed_reviewer" };
    return { status: "selected", effectiveMode: "self", reviewer, provider: agentVendor(reviewer), degraded: false };
  }

  const workerProviders = new Set(workers.map(agentVendor));
  const hetero = installed.find((agent) => !workerProviders.has(agentVendor(agent)));
  if (hetero !== undefined) {
    return { status: "selected", effectiveMode: "hetero", reviewer: hetero, provider: agentVendor(hetero), degraded: false };
  }

  if (input.mode === "hetero") return { status: "unavailable", reason: "no_heterogeneous_reviewer" };

  const reviewer = firstSelfReviewer(installed, workers);
  if (reviewer === undefined) return { status: "unavailable", reason: "no_installed_reviewer" };
  return {
    status: "selected",
    effectiveMode: "self",
    reviewer,
    provider: agentVendor(reviewer),
    degraded: true,
    reason: "single_provider_available",
  };
}
