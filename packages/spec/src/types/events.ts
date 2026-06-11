/**
 * RollEvent — the published language (BC7, I8): every loop appends these to
 * events.ndjson; all state is rebuilt from this stream, no separate cache.
 * Schema per specs/architecture §3 (v2-aligned).
 */
import type { AgentId } from "./agent.js";
import type { CycleCost, CyclePhase } from "./cycle.js";
import type { GoalScope, GoalStatus, GoalTransitionActor } from "./goal.js";
import type { LoopType } from "./loop.js";
import type { TerminalEvent, TerminalOutcome } from "./terminal.js";
import type { TaskLevel } from "./story.js";

export type RollEvent =
  // Loop lifecycle (BC2)
  | { type: "loop:fire"; loop: LoopType; ts: number }
  | { type: "loop:idle"; loop: LoopType; nextFire: number; ts: number }
  | { type: "loop:error"; loop: LoopType; error: string; ts: number }
  | { type: "loop:paused"; loop: LoopType; ts: number }
  | { type: "loop:resumed"; loop: LoopType; ts: number }
  // Cycle (BC2) — cycle:end anchors reconcile + cost accounting
  | { type: "cycle:start"; cycleId: string; storyId: string; agent: AgentId; model: string; ts: number }
  | { type: "cycle:phase"; cycleId: string; phase: CyclePhase; ts: number }
  | { type: "cycle:stdout"; cycleId: string; data: string; ts: number }
  | { type: "cycle:tcr"; cycleId: string; commitHash: string; message: string; ts: number }
  | { type: "cycle:end"; cycleId: string; outcome: TerminalOutcome; cost: CycleCost; ts: number }
  // Routing (BC3) — auditable, reproducible (I10)
  | { type: "route:resolve"; storyId: string; level: TaskLevel; agent: AgentId; model: string; rule: string; ts: number }
  // Delivery (BC4)
  | { type: "pr:open"; prNumber: number; storyId: string; ts: number }
  | { type: "pr:merge"; prNumber: number; storyId: string; ts: number }
  | { type: "pr:rebase"; prNumber: number; ts: number }
  | { type: "pr:close"; prNumber: number; reason: string; ts: number }
  | { type: "ci:pass"; prNumber: number; ts: number }
  | { type: "ci:fail"; prNumber: number; failSummary: string; ts: number }
  | { type: "ci:rerun"; prNumber: number; ts: number }
  // Alert (BC2/BC6)
  | { type: "alert:notify"; channel: string; message: string; ts: number }
  // Goal mode (US-GOAL-001) — the durable goal state machine facts.
  | { type: "goal:created"; schema: "goal.v1"; scope: GoalScope; status: "active"; budgetUsd?: number; ts: number }
  | { type: "goal:state"; schema: "goal.v1"; from: GoalStatus; to: GoalStatus; actor: GoalTransitionActor; reason: string; ts: number }
  // Peer gate (FIX-150b) — the hard-trigger audit trail: every high-complexity
  // delivery records whether peer review happened ("consulted") or was skipped.
  | { type: "peer:gate"; cycleId: string; verdict: "consulted" | "skipped"; reasons: string[]; ts: number }
  // Cross-Agent Pairing (US-PAIR-003) — a heterogeneous peer one-way reviews a
  // delivery. `pair:*` is deliberately distinct from `peer:gate` (decoupled audit).
  | { type: "pair:selected"; cycleId: string; workingAgent: string; peer: string; stage: string; ts: number }
  // US-PAIR-004: `stage` is optional for back-compat with PAIR-003 (code-only)
  // logs; multi-stage pairing stamps it so verdicts are distinguishable per stage.
  | { type: "pair:verdict"; cycleId: string; peer: string; verdict: "agree" | "refine" | "object"; findings: number; cost: number; stage?: string; ts: number }
  | { type: "pair:none-available"; cycleId: string; stage: string; reason: string; ts: number }
  // Attest gate (FIX-207) — every actual delivery records whether a fresh
  // acceptance report was produced ("produced") or silently skipped ("skipped").
  | { type: "attest:gate"; cycleId: string; verdict: "produced" | "skipped"; reasons: string[]; ts: number }
  // ac-map remediation (FIX-246) — a real delivery that skipped skill step 10.6
  // (no ac-map.json) gets ONE surgical same-agent second pass before attest
  // renders. The outcome is auditable; honest statuses only — never a bypass.
  | { type: "attest:remediation"; cycleId: string; storyId: string; agent: string; outcome: "written" | "still-missing" | "spawn-failed"; ts: number }
  // Correction loop (US-EVID-014/016) — story-level negative feedback and the
  // safety brake that stops oscillation before the loop burns cycles.
  | {
      type: "correction:action";
      cycleId?: string;
      storyId: string;
      action: string;
      plannedAction?: string;
      signal: string;
      reason: string;
      mode?: string;
      source?: string;
      targetId?: string;
      ts: number;
    }
  | { type: "correction:circuit_breaker"; storyId?: string; signal: string; count: number; threshold: number; reason: string; ts: number }
  // Evidence lifecycle (US-EVID-001) — the runner opened the per-cycle evidence
  // frame before spawning an agent, so later phases have a durable run dir.
  | { type: "evidence:frame-opened"; cycleId: string; storyId: string; runDir: string; ts: number }
  // Morning report (US-EVID-016) — one fixed human-readable page is rebuilt from
  // events/runs and linked from the dossier front page.
  | { type: "report:morning"; path: string; windowStart: number; windowEnd: number; cycles: number; corrections: number; paused: boolean; ts: number }
  // Policy (BC6) — governance decisions as facts
  | { type: "policy:auto_merge"; prNumber: number; rule: string; ts: number }
  | { type: "policy:flag_review"; prNumber: number; rule: string; ts: number }
  | { type: "policy:safety_pause"; loop: LoopType; reason: string; ts: number }
  // Release gate (US-TRUTH-005) — the gate verdict and any owner waiver are
  // FACTS in the stream: a bypass with no record is itself drift, and a later
  // audit must SEE every waiver (release_verdict / release_waiver anchors).
  | { type: "release:gate"; tag: string; verdict: "pass" | "blocked" | "waived"; failCount: number; waivedRules: string[]; ts: number }
  | { type: "release:waiver"; reason: string; scope: string; expiresSec: number; operator: string; ts: number }
  // US-TRUTH-001 — the versioned complete-or-reasoned terminal record. One per
  // cycle from schema v1 on; events older than the switch are GRANDFATHERED
  // (read under legacy rules, never retro-rewritten).
  | TerminalEvent;

export type RollEventType = RollEvent["type"];

/**
 * Parse one ndjson line into a RollEvent. Returns null for blank lines,
 * malformed JSON, or objects without a string `type` and numeric `ts` —
 * readers must skip bad lines, never crash (I8: rebuild always succeeds).
 */
export function parseEventLine(line: string): RollEvent | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const rec = obj as Record<string, unknown>;
  if (typeof rec["type"] !== "string" || typeof rec["ts"] !== "number") return null;
  return obj as RollEvent;
}
