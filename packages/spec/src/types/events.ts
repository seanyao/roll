/**
 * RollEvent — the published language (BC7, I8): every loop appends these to
 * events.ndjson; all state is rebuilt from this stream, no separate cache.
 * Schema per specs/architecture §3 (v2-aligned).
 */
import type { AgentId } from "./agent.js";
import type { CycleCost, CycleOutcome, CyclePhase } from "./cycle.js";
import type { LoopType } from "./loop.js";
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
  | { type: "cycle:end"; cycleId: string; outcome: CycleOutcome; cost: CycleCost; ts: number }
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
  // Evidence lifecycle (US-EVID-001) — the runner opened the per-cycle evidence
  // frame before spawning an agent, so later phases have a durable run dir.
  | { type: "evidence:frame-opened"; cycleId: string; storyId: string; runDir: string; ts: number }
  // Policy (BC6) — governance decisions as facts
  | { type: "policy:auto_merge"; prNumber: number; rule: string; ts: number }
  | { type: "policy:flag_review"; prNumber: number; rule: string; ts: number }
  | { type: "policy:safety_pause"; loop: LoopType; reason: string; ts: number };

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
