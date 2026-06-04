/** Agent routing contracts (BC3, I10). */
export type AgentId = string;
export type ModelId = string;

/** Result of a pre-spawn liveness probe (seconds-level, cached). */
export interface Availability {
  available: boolean;
  checkedAt: number;
  reason?: string;
}

/** A resolved route — deterministic for identical inputs (I10). */
export interface Route {
  agent: AgentId;
  model: ModelId;
  /** The policy rule that matched — auditability anchor. */
  matchedRule: string;
}
