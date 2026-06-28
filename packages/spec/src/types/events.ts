/**
 * RollEvent — the published language (BC7, I8): every loop appends these to
 * events.ndjson; all state is rebuilt from this stream, no separate cache.
 * Schema per specs/architecture §3 (v2-aligned).
 */
import type { AgentId, ExecutionProfile } from "./agent.js";
import type { CycleCost, CyclePhase } from "./cycle.js";
import type { GoalReviewMode, GoalSafetyGate, GoalScope, GoalStatus, GoalTransitionActor } from "./goal.js";
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
  // US-LOOP-079e: dormant/wake/failed state transitions
  | { type: "loop:dormant"; loop: LoopType; ts: number; reason: string; since: number }
  | { type: "loop:woke"; loop: LoopType; ts: number; trigger: "roll-cmd" | "dream" | "pr" | "manual"; picked?: string; wakeEpoch: number }
  | { type: "loop:dormant_failed"; loop: LoopType; ts: number; reason: string; error: string }
  // Cycle (BC2) — cycle:end anchors reconcile + cost accounting
  | { type: "cycle:start"; cycleId: string; storyId: string; agent: AgentId; model: string; ts: number }
  // US-V4-004: the selected Story execution profile, recorded once per cycle at
  // route-resolve (before execute). standard = builder only (current behavior).
  | { type: "execution:profile"; cycleId: string; storyId: string; profile: ExecutionProfile; reason: string; ts: number }
  | { type: "cycle:phase"; cycleId: string; phase: CyclePhase; ts: number }
  | { type: "cycle:stdout"; cycleId: string; data: string; ts: number }
  | { type: "cycle:tcr"; cycleId: string; commitHash: string; message: string; ts: number; commitTs?: number }
  | { type: "cycle:first_edit"; cycleId: string; commitHash: string; ts: number }
  // FIX-929 — agent stall detection: the builder produced zero token output for
  // a configurable threshold (default 10 min). This is a SIGNAL, not a kill —
  // fire BEFORE the hard timeout watchdog. A 2-min startup grace prevents false
  // positives during agent initialization. The signal feeds the recovery layer
  // (FIX-930) so it can switch agents before hitting the hard timeout kill.
  | { type: "agent:stall"; cycleId: string; agent: string; idleSec: number; thresholdSec: number; ts: number }
  // FIX-907 — the per-cycle HARD TIMEOUT tripped: a builder hung (process alive,
  // 0% CPU, no new commits/events) or a runaway exceeded the wall-clock ceiling.
  // `reason` is the criterion that fired — `wall` (total cycle time > ceiling) or
  // `no-progress` (no new commit/stdout for the idle window; NOT pure elapsed
  // time, so a slow-but-still-emitting deepseek call never trips it). The agent
  // process tree was killed, the inflight lock released, and the worktree branch
  // PRESERVED (work salvageable). `elapsedSec`/`idleSec` make the trip auditable.
  | { type: "cycle:timeout"; cycleId: string; reason: "wall" | "no-progress"; elapsedSec: number; idleSec: number; ts: number }
  | { type: "cycle:end"; cycleId: string; outcome: TerminalOutcome; cost: CycleCost; ts: number }
  // FIX-903: leaked main commits were saved to a rescue ref before reset.
  | { type: "cycle:rescue"; cycleId: string; ref: string; rescuedSha: string; ts: number }
  | {
      type: "warm-session:resume-selected";
      cycleId: string;
      storyId: string;
      agent: AgentId;
      sessionId: string;
      sourceCycleId: string;
      sourceStoryId: string;
      reason: "selected";
      ts: number;
    }
  | {
      type: "warm-session:resume-skipped";
      cycleId: string;
      storyId: string;
      agent: AgentId;
      reason: "policy_off" | "agent_unsupported" | "no_prior_session" | "scope_mismatch" | "stale_session";
      sourceCycleId?: string;
      sourceStoryId?: string;
      ts: number;
    }
  | {
      type: "warm-session:capture";
      cycleId: string;
      storyId: string;
      agent: AgentId;
      sessionId: string;
      rolloutPath?: string;
      spawnedWarm: boolean;
      ts: number;
    }
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
  | { type: "goal:created"; schema: "goal.v1"; scope: GoalScope; status: "active"; review: GoalReviewMode; ts: number }
  | { type: "goal:state"; schema: "goal.v1"; from: GoalStatus; to: GoalStatus; actor: GoalTransitionActor; reason: string; ts: number }
  | { type: "goal:session_start"; sessionId: string; scope: GoalScope; ts: number }
  | { type: "goal:session_end"; sessionId: string; status: GoalStatus; reason: string; cycles: number; ts: number }
  | { type: "goal:tick_skipped"; sessionId?: string; reason: "go_session_lock"; heldByPid?: number; ts: number }
  // FIX-269: the session is parked while a scheduled cycle holds the inner lock.
  | { type: "goal:waiting_inner_lock"; sessionId: string; heldByPid: number; ts: number }
  | { type: "goal:evaluated"; sessionId: string; status: "continue" | "complete"; total: number; delivered: number; reason: string; blockers: string[]; ts: number }
  | { type: "goal:card_skipped"; sessionId: string; storyId: string; reason: "zero_delivery_streak" | "no_progress_streak"; zeroDeliveries: number; cycleId?: string; ts: number }
  | {
      type: "goal:gate_tripped";
      sessionId: string;
      gate: GoalSafetyGate;
      action: "audit" | "paused";
      reason: string;
      reading: Record<string, string | number | boolean>;
      waitUntilSec?: number;
      ts: number;
    }
  | {
      type: "goal:final_review";
      sessionId: string;
      mode: GoalReviewMode;
      effectiveMode: "hetero" | "self" | "off";
      reviewer: string;
      provider: string;
      verdict: "APPROVE" | "REQUEST_CHANGES" | "TIMEOUT" | "ERROR" | "SKIPPED";
      reason: string;
      findings: string[];
      commandFamily?: string;
      durationMs?: number;
      transcriptPath?: string;
      evidencePath?: string;
      ts: number;
    }
  | {
      type: "goal:review_degraded";
      sessionId: string;
      from: "auto";
      to: "self";
      reviewer: string;
      provider: string;
      reason: string;
      ts: number;
    }
  // Peer gate (FIX-150b) — the hard-trigger audit trail: every gated delivery
  // records whether peer review happened ("consulted") or was skipped. FIX-312
  // adds "self-review-allowed": a substantive delivery shipped with no peer
  // evidence BECAUSE no heterogeneous peer was available (recorded fallback, not
  // a block — distinct from a "skipped" violation where hetero WAS available).
  | { type: "peer:gate"; cycleId: string; verdict: "consulted" | "skipped" | "self-review-allowed"; reasons: string[]; ts: number }
  // Cross-Agent Pairing (US-PAIR-003) — a heterogeneous peer one-way reviews a
  // delivery. `pair:*` is deliberately distinct from `peer:gate` (decoupled audit).
  | { type: "pair:selected"; cycleId: string; workingAgent: string; peer: string; stage: string; ts: number }
  // US-PAIR-004: `stage` is optional for back-compat with PAIR-003 (code-only)
  // logs; multi-stage pairing stamps it so verdicts are distinguishable per stage.
  | { type: "pair:verdict"; cycleId: string; peer: string; verdict: "agree" | "refine" | "object"; findings: number; cost: number; stage?: string; ts: number }
  // US-PAIR-009: the score stage's outcome — a heterogeneous peer scored the cycle.
  // FIX-344: `stage` widens to `"design"` for the roll-design peer Review Score
  // path. roll-design has NO loop cycle (no commitsAhead/worktree), so its
  // independent peer score is triggered at skill wrap-up via `roll pair score
  // --design` and stamped `stage: "design"` so the design score is distinguishable
  // from a build/fix cycle's `stage: "score"` in the same event stream.
  | { type: "pair:score"; cycleId: string; peer: string; score: number; verdict: "good" | "ok" | "regression"; cost: number; stage: "score" | "design"; ts: number }
  | { type: "pair:none-available"; cycleId: string; stage: string; reason: string; ts: number }
  // FIX-910 — per-attempt score-stage failure attribution (unparseable / timeout /
  // auth-block / exit-error), emitted from the executor's scorePeer closure so
  // every null return from a scorer is observable (no more silently swallowed nulls).
  // The "unparseable" cause additionally triggers ONE retry with a stricter format
  // reminder; a second failure is also recorded.
  | { type: "pair:score-failure"; cycleId: string; peer: string; cause: "unparseable" | "timeout" | "auth-block" | "exit-error"; detail?: string; stage: "score" | "design"; ts: number }
  // FIX-346 — a peer was REMOVED from the candidate pool after repeated headless
  // AUTH failures (expired/unavailable creds it cannot refresh non-interactively:
  // agy's Google OAuth, claude's macOS keychain/auth-daemon cooldown, …). The loop
  // must NEVER pop an interactive login or pull the owner into auth for an
  // unattended cycle, so once an agent has failed auth `failures` times in a row it
  // is dropped from selection (the next heterogeneous peer is swapped in) instead of
  // being re-spawned — and re-failing — every cycle. `cause` is always "auth"
  // today (network blocks are transient and not pool-excluded). Observable so the
  // owner sees WHY an agent stopped being consulted (and can re-login it offline).
  | { type: "pair:excluded"; cycleId: string; agent: string; cause: "auth"; failures: number; ts: number }
  // FIX-319 — wall-clock timing of EVERY heterogeneous peer consult (the
  // reviewPeer spawn), success or not, so the 120s hard timeout can be tuned
  // empirically from real data instead of guessed. outcome: a parsed verdict
  // (`reviewed`), the timeout fired (`timeout`), or a spawn/non-zero-exit
  // (`error`). durationMs is the real spawn wall-clock (capped near the timeout
  // when it fires).
  // FIX-363: `cause` attributes a non-`reviewed` consult to its ROOT — an
  // external block (`auth` = not logged in / 403, `network` = VPN/proxy/DNS down)
  // vs genuine slowness (absent). It lets the loop act on the real problem
  // (re-login / reconnect) instead of treating every timeout as "slow → wait
  // longer → burn → pause with a misleading code-bug hint".
  | { type: "pair:consult"; cycleId: string; peer: string; durationMs: number; outcome: "reviewed" | "timeout" | "error"; cause?: "auth" | "network"; ts: number }
  // FIX-363 — a reviewer/scorer agent was found BLOCKED by an external cause
  // (not slow): `auth` (not logged in / 403) or `network` (VPN/proxy/DNS down).
  // Emitted from the review/score failure path; loop-run-once reads it to ISOLATE
  // the failure from the consecutive-code-failure counter and raise an ACTIONABLE
  // pause ("re-login <agent>" / "check the VPN") instead of "3 failures → code bug".
  // FIX-366 — `stage: "build"` extends the SAME taxonomy to the main BUILDER spawn:
  // an unauthenticated builder prints a 403 / "Please run /login" in its first
  // seconds, so the spawn output is signature-matched the same way and folds into
  // the same isolate-from-counter + PAUSE(auth)/breathe(network) path — one block
  // taxonomy for builder/reviewer/scorer (no new precheck, no probe, no cache).
  | { type: "agent:blocked"; cycleId: string; agent: string; cause: "auth" | "network"; stage: "build" | "review" | "score"; detail: string; ts: number }
  // FIX-930 — failure-driven agent swap on a zero-TCR/stalled cycle: the loop
  // re-marks the story Todo and routes the NEXT untried agent (excluding the one
  // that just gave up). `attempt` is the 1-based self-heal attempt for the story.
  | { type: "agent:retry"; cycleId: string; storyId: string; fromAgent: string; toAgent: string; attempt: number; reason: "zero-tcr" | "stall"; ts: number }
  // Attest gate (FIX-207) — every actual delivery records whether a fresh
  // acceptance report was produced ("produced") or silently skipped ("skipped").
  | { type: "attest:gate"; cycleId: string; verdict: "produced" | "skipped"; reasons: string[]; ts: number }
  // Visual-evidence build-preflight gate (FIX-311b) — the shift-left of the
  // attest gate. BEFORE the agent spawns, the picked card's spec is checked
  // against the design-phase visual-evidence contract. `ok` ⇒ the spec can
  // satisfy the screenshot floor; `flagged` ⇒ a CONFIDENT problem (a web-surface
  // card with no declared deliverable_url, or no visual-evidence AC and no
  // exemption) — recorded loud so it is caught at the cheapest moment. NEVER
  // blocks the cycle (FIX-309 is the hard backstop at delivery); ambiguous /
  // terminal surfaces are never flagged here.
  | { type: "visual:gate"; cycleId: string; storyId: string; verdict: "ok" | "flagged"; code?: string; surface?: string; reasons: string[]; ts: number }
  // ac-map remediation (FIX-246) — a real delivery that skipped skill step 10.6
  // (no ac-map.json) gets ONE surgical same-agent second pass before attest
  // renders. The outcome is auditable; honest statuses only — never a bypass.
  | { type: "attest:remediation"; cycleId: string; storyId: string; agent: string; outcome: "written" | "still-missing" | "spawn-failed"; ts: number }
  // FIX-912 — ac-map draft auto-generation. The harness wrote an ac-map.json
  // DRAFT from cycle evidence (commits, test files, changed files) BEFORE the
  // FIX-246 remediation ran. The draft has full AC structure + evidence chain
  // with CONSERVATIVE statuses ("pass-with-evidence" only with clear test
  // signals; otherwise "needs-confirmation"). The agent only needs to confirm.
  | { type: "attest:draft-generated"; cycleId: string; storyId: string; ts: number }
  // FIX-317 — the harness bridged a REAL captured screenshot into the ac-map's
  // pass ACs (the agent wired text-only evidence; the visual floor needs a
  // per-AC screenshot ref). Auditable: `href` + `attachedCount` distinguish
  // harness-added visual baselines from agent-supplied evidence. Honest — only a
  // screenshot that exists on disk this cycle is ever attached.
  | { type: "attest:auto-attach"; cycleId: string; storyId: string; href: string; attachedCount: number; ts: number }
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
  // Self-downgrade (US-AGENT-042) — the durable record of an automatic
  // decomposition decision. A `capped: false` split parked the parent at 🚫 Hold
  // and appended `childStoryIds` as fresh 📋 Todo rows (each inheriting the
  // parent's ORIGINAL inbound deps, never the parked parent). A `capped: true`
  // event is a REFUSED split — the chain already auto-split `chainDepth` times
  // (≥ the cap) or the story was irreducible — so the parent is held with NO
  // children and an ALERT is raised for human triage (US-AGENT-009 cap). The
  // reconcile reads this so a deliberately-parked parent is NOT mistaken for a
  // premature-done to revert at the cycle terminal.
  | {
      type: "story:split";
      parentStoryId: string;
      childStoryIds: string[];
      reason: string;
      chainDepth: number;
      capped: boolean;
      ts: number;
    }
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
