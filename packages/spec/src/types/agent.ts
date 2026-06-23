/** Agent routing contracts (BC3, I10). */
export const AGENT_NAMES = ["claude", "kimi", "codex", "pi", "agy", "reasonix"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
export type AgentId = string;
export type ModelId = string;

/** A concrete assignment unit: a supported agent identity paired with a model id. */
export interface Rig {
  agent: AgentName;
  model: ModelId;
}

export function isAgentName(value: string): value is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(value);
}

export function rig(agent: string, model: ModelId): Rig {
  if (!isAgentName(agent)) throw new Error(`invalid agent for Rig: ${agent}`);
  return { agent, model };
}

/** Result of a pre-spawn liveness probe (seconds-level, cached). */
export interface Availability {
  available: boolean;
  checkedAt: number;
  reason?: string;
}

/** A resolved route — deterministic for identical inputs (I10). */
export interface Route extends Rig {
  /** The policy rule that matched — auditability anchor. */
  matchedRule: string;
}
