/**
 * US-AGENT-049 — open-pool role casting with health-aware ranking.
 *
 * One installed agent pool feeds Designer, Builder, Evaluator, and Peer Reviewer.
 * Candidates are ranked by capability, health, recent outcomes, cost, and story
 * risk. Every candidate stays visible; no broad identity ban is applied.
 */
import type {
  AgentCapabilityProfile,
  AgentHealthSignal,
  AgentName,
  CastRoleName,
  RankedRoleCandidate,
  RoleCastRankingInput,
} from "@roll/spec";

function roleCapability(role: CastRoleName): keyof AgentCapabilityProfile {
  switch (role) {
    case "designer":
    case "builder":
      return "canExecute";
    case "evaluator":
      return "canScore";
    case "peer_reviewer":
      return "canReview";
  }
}

function latestHealth(signals: AgentHealthSignal[] | undefined): AgentHealthSignal | undefined {
  if (signals === undefined || signals.length === 0) return undefined;
  return [...signals].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
}

function recentFailureCount(outcomes: readonly ("success" | "failure" | "gave_up")[] | undefined): number {
  if (outcomes === undefined || outcomes.length === 0) return 0;
  return outcomes.slice(-5).filter((o) => o === "failure" || o === "gave_up").length;
}

function recentSuccessCount(outcomes: readonly ("success" | "failure" | "gave_up")[] | undefined): number {
  if (outcomes === undefined || outcomes.length === 0) return 0;
  return outcomes.slice(-5).filter((o) => o === "success").length;
}

/**
 * Rank every candidate in the pool for the requested role.
 *
 * The score is a deterministic heuristic, not a learned model. It is designed
 * to be inspectable: every candidate gets human-readable reasons and warnings
 * explaining why it sits where it does.
 */
export function rankRoleCandidates(input: RoleCastRankingInput): RankedRoleCandidate[] {
  const requiredCap = roleCapability(input.role);
  const riskWeight = input.storyRisk === "high" ? 1.5 : input.storyRisk === "low" ? 0.75 : 1.0;

  const ranked: RankedRoleCandidate[] = [];
  for (const agent of input.pool) {
    const profile = input.profiles[agent];
    const health = latestHealth(input.health[agent]);
    const outcomes = input.recentOutcomes[agent] ?? [];
    const failures = recentFailureCount(outcomes);
    const successes = recentSuccessCount(outcomes);

    const reasons: string[] = [];
    const warnings: string[] = [];
    let score = 50;

    if (profile === undefined) {
      warnings.push("unknown capability profile");
      score -= 10;
    } else {
      if (profile[requiredCap]) {
        reasons.push(`can ${input.role}`);
        score += 15;
      } else {
        warnings.push(`not tagged for ${input.role}`);
        score -= 20;
      }
      for (const s of profile.strengths) {
        reasons.push(s);
        score += 2;
      }
      for (const s of profile.knownShortcomings) {
        warnings.push(s);
        score -= 8;
      }
      switch (profile.costBand) {
        case "low":
          score += 5;
          reasons.push("low cost");
          break;
        case "high":
          score -= 10;
          warnings.push("high cost");
          break;
        case "unknown":
          warnings.push("unknown cost band");
          break;
      }
    }

    switch (health?.status) {
      case "healthy":
        score += 12;
        reasons.push("healthy");
        break;
      case "degraded":
        score -= 15;
        warnings.push(`${health.reason ?? "health"} degraded`);
        break;
      case "blocked":
        score -= 40;
        warnings.push(`${health.reason ?? "health"} blocked`);
        break;
      case "unknown":
      default:
        warnings.push("unknown health");
        score -= 5;
        break;
    }

    if (failures > 0) {
      score -= failures * 10;
      warnings.push(`${failures} recent failure(s)`);
    }
    if (successes > 0) {
      score += successes * 5;
      reasons.push(`${successes} recent success(es)`);
    }

    // High-risk stories penalize degraded/blocked agents more heavily.
    if ((health?.status === "degraded" || health?.status === "blocked") && riskWeight > 1) {
      score -= 10 * riskWeight;
    }

    const eligible =
      (profile?.[requiredCap] ?? false) &&
      (health === undefined || (health.status !== "blocked" && health.status !== "degraded"));

    ranked.push({ agent, eligible, score: Math.round(score), reasons: [...new Set(reasons)], warnings: [...new Set(warnings)] });
  }

  // Stable sort: higher score first; ties keep original pool order.
  return ranked.sort((a, b) => b.score - a.score || input.pool.indexOf(a.agent) - input.pool.indexOf(b.agent));
}

/** Pick the highest-scoring eligible candidate, or null if none are eligible. */
export function selectRankedCandidate(candidates: readonly RankedRoleCandidate[]): RankedRoleCandidate | null {
  const eligible = candidates.filter((c) => c.eligible);
  return eligible[0] ?? null;
}
