/** Policy contracts (BC6) — human intent, read and obeyed by loops. */
import type { AgentId, ModelId, Rig } from "./agent.js";

/** A routing rule maps story characteristics → a resolved Rig (US-AGENT-047 AC5). */
export interface RoutingRule {
  match: { level?: string; type?: string };
  agent: AgentId;
  model: ModelId;
  /** Availability fallback slot (pre-spawn only — never a failure-retry chain, I6). */
  fallback?: Rig;
  rationale?: string;
}

export interface LoopSafetyPolicy {
  /** Consecutive failures before PAUSE + ALERT + human decision (I6). */
  maxConsecutiveFailures: number;
  /** Same-story failures before permanent hold (I5). */
  maxStoryFailures: number;
}
