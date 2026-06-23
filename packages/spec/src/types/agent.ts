/** Agent routing contracts (BC3, I10). */
export type AgentId = string;
export type ModelId = string;

/**
 * The canonical six-agent roster (US-AGENT-043). Every first-class agent
 * identity in roll is one of these six; provider/model aliases (openai→codex,
 * deepseek→pi) are NOT agent names.
 */
export type AgentName = "claude" | "kimi" | "codex" | "pi" | "agy" | "reasonix";

/** Runtime roster array — mirrors AgentName for runtime checks (AC1 fitness gate). */
export const AGENT_NAMES: readonly AgentName[] = ["claude", "kimi", "codex", "pi", "agy", "reasonix"] as const;

/**
 * Rig = agent × model — the smallest unit of task assignment (US-AGENT-047 AC5).
 * A cycle/review is assigned to a rig; independence is judged by rig.
 * `agent` is a first-class AgentName; `model` is a free-form model id string
 * (may include `:thinking` effort suffixes).
 */
export interface Rig {
  agent: AgentName;
  model: string;
}

/** Result of a pre-spawn liveness probe (seconds-level, cached). */
export interface Availability {
  available: boolean;
  checkedAt: number;
  reason?: string;
}

/** A resolved route — deterministic for identical inputs (I10).
 *  Once canonicalized, agent/model form a {@link Rig}. */
export interface Route {
  agent: AgentId;
  model: ModelId;
  /** The policy rule that matched — auditability anchor. */
  matchedRule: string;
}
