/** Agent routing contracts (BC3, I10). */
export const AGENT_NAMES = ["claude", "kimi", "codex", "pi", "agy", "reasonix"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
export type AgentId = string;
export type ModelId = string;

/**
 * A concrete assignment unit: a supported agent identity paired with a model id.
 *
 * US-V4-003: `model` is OPTIONAL — a v4 Rig may omit the model to run the agent's
 * own default (arch §10). A resolved {@link Route} still always carries a model.
 */
export interface Rig {
  agent: AgentName;
  model?: ModelId;
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

/** A resolved route — deterministic for identical inputs (I10). A resolved route
 *  ALWAYS carries a concrete model, even though a v4 Rig's model is optional. */
export interface Route extends Omit<Rig, "model"> {
  model: ModelId;
  /** The policy rule that matched — auditability anchor. */
  matchedRule: string;
}

// ── US-V4-003: v4 Rig routing + execution profile contracts ──────────────────
// Route slots are POLICY LABELS, not Agent/Rig types. The same Rig can be the
// `default` slot in one project and `hard` in another. `fallback` is a pre-spawn
// availability fallback, never a failure-driven retry chain.

/** A named reference into the project route profile's `rigs:` map (v4). */
export type RigRef = string;

/** The four route slots a project route profile can bind. NOT agent/rig types. */
export const ROUTE_SLOTS = ["easy", "default", "hard", "fallback"] as const;
export type RouteSlot = (typeof ROUTE_SLOTS)[number];

/** The story-level role pipeline a Story Execution Unit runs. */
export const EXECUTION_PROFILES = ["standard", "verified", "planned"] as const;
export type ExecutionProfile = (typeof EXECUTION_PROFILES)[number];

/** The roles a Story Execution Unit can run, in pipeline order. */
export const ROLE_NAMES = ["planner", "builder", "evaluator"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

/** How a role binds to an execution identity: a named rig, a route slot, or the
 *  machine default agent. */
export type RoleBinding =
  | { readonly kind: "rig"; readonly rig: RigRef }
  | { readonly kind: "routing"; readonly route: RouteSlot }
  | { readonly kind: "default-agent" };

/** A story-level execution profile spec: which roles run and how each is bound. */
export interface ExecutionProfileSpec {
  readonly profile: ExecutionProfile;
  readonly roles: Partial<Record<RoleName, RoleBinding>>;
}

/** A versioned artifact reference used for role handoff (artifact channel). */
export interface ArtifactRef {
  readonly path: string;
  readonly sha256?: string;
  readonly kind: "contract" | "evidence" | "report" | "log" | "screenshot" | "diff";
}

/** A role's input/output manifest — the artifact-only handoff contract. */
export interface ArtifactManifest {
  readonly schemaVersion: 1;
  readonly storyId: string;
  readonly cycleId: string;
  readonly role: RoleName;
  readonly rig: Rig;
  readonly sessionId: string;
  readonly worktreeCwd: string;
  readonly scoreRepoCwd: string;
  readonly inputs: readonly ArtifactRef[];
  readonly outputs: readonly ArtifactRef[];
  readonly createdAt: string;
}

/** One role execution within a Story Execution Unit. */
export interface RoleRun {
  readonly role: RoleName;
  readonly rig: Rig;
  readonly sessionId: string;
  readonly manifest: ArtifactManifest;
}

/** One execution of a Story under a chosen execution profile. */
export interface StoryExecutionRun {
  readonly storyId: string;
  readonly cycleId: string;
  readonly profile: ExecutionProfile;
  readonly roles: readonly RoleRun[];
}

/** US-V4-008 — the structured facts the Supervisor Agent reads, gathered by
 *  DETERMINISTIC selectors (no agent call needed to build them). Project-level
 *  only — never a single Story's implementation. */
export interface SupervisorInput {
  /** Backlog rows: id + raw status cell + parsed depends-on ids. */
  readonly backlog: readonly { readonly id: string; readonly status: string; readonly dependsOn?: readonly string[] }[];
  /** Story ids confirmed delivered (merge evidence on main / queryStoryDelivery). */
  readonly delivered: readonly string[];
  /** Story ids with an OPEN PR/Cycle in flight. */
  readonly openPrStories: readonly string[];
  /** Per-story consecutive-failure counts (from terminal events). */
  readonly recentFailures: readonly { readonly storyId: string; readonly consecutiveFailures: number }[];
  /** Route-profile normalizer errors (unknown rig refs / malformed bindings). */
  readonly routeConfigErrors: readonly string[];
  /** Release-consistency blockers (e.g. backlog-says-Done but main disagrees). */
  readonly releaseBlockers: readonly string[];
  /** Optional daily budget signal: spent vs cap (same unit). */
  readonly budget?: { readonly spent: number; readonly cap: number | null };
  /** Roll metadata repo state, gathered by the CLI when available. */
  readonly rollMeta?: {
    readonly state: "clean" | "dirty" | "unknown";
    readonly detail: string;
    readonly files?: readonly string[];
  };
}

/** US-V4-009 — an in-flight or candidate cycle for the parallel scheduler. */
export interface SchedulableCycle {
  readonly storyId: string;
  /** Files the story is expected to touch (for conflict serialization). */
  readonly files?: readonly string[];
}

/** US-V4-009 — inputs to the (pure) Supervisor parallel-cycle scheduler. */
export interface ScheduleInput {
  readonly maxParallelCycles: number;
  readonly active: readonly SchedulableCycle[];
  readonly candidates: readonly SchedulableCycle[];
  /** Stories already with an OPEN PR (single-PR-per-story invariant). */
  readonly openPrStories: readonly string[];
  readonly budgetOk: boolean;
  /** Merge queue depth + cap; when depth ≥ cap, new starts pause. */
  readonly mergeQueue?: { readonly depth: number; readonly cap: number };
}

/** US-V4-009 — the scheduler's decision: which stories may start now + why the
 *  rest must wait (serialized for conflict, capacity, budget, or merge queue). */
export interface ScheduleDecision {
  readonly start: readonly string[];
  readonly wait: readonly { readonly storyId: string; readonly reason: string }[];
}

/** US-V4-008 — the Supervisor's projection over {@link SupervisorInput}. */
export interface SupervisorFacts {
  readonly counts: { readonly todo: number; readonly inProgress: number; readonly blocked: number; readonly done: number };
  /** Stories the backlog claims Done that main truth does NOT confirm. */
  readonly truthDrift: readonly string[];
  readonly openPrCount: number;
  /** Stories stuck on repeated failures (≥ the stuck threshold). */
  readonly stuckStories: readonly string[];
  readonly routeConfigErrors: readonly string[];
  readonly releaseReadiness: { readonly ready: boolean; readonly blockers: readonly string[] };
  readonly budgetHealth: { readonly ok: boolean; readonly note: string };
}

/** A Supervisor Agent decision record — project-level coordination, never Story
 *  implementation. `requiresOwner` gates persistent policy changes. */
export interface SupervisorDecision {
  readonly kind:
    | "classify-risk"
    | "select-execution-profile"
    | "recommend-route-change"
    | "pause"
    | "resume"
    | "escalate"
    | "serialize-conflict"
    | "release-readiness";
  readonly reason: string;
  readonly evidence: readonly ArtifactRef[];
  readonly requiresOwner: boolean;
}

/** Execution policy: how Roll chooses a profile per story. */
export interface ExecutionPolicy {
  readonly mode: "standard" | "verified" | "planned" | "auto";
  readonly defaultProfile: ExecutionProfile;
}

/** Supervisor config (disabled by default in v4.0). */
export interface SupervisorConfig {
  readonly enabled: boolean;
  readonly mode: "observe" | "advise" | "schedule";
  readonly maxParallelCycles: number;
  readonly budgetPerDay: number | null;
}

/** A route slot resolved to its rig, plus the named ref when one was used (v4). */
export interface ResolvedSlot {
  readonly rig: Rig;
  readonly ref?: RigRef;
}

/** The normalized project route profile — the single shape both v3 and v4
 *  `.roll/agents.yaml` files load into. Pure normalizer output (US-V4-003). */
export interface NormalizedAgentConfig {
  readonly schema: "v3" | "v4";
  readonly rigs: Readonly<Record<string, Rig>>;
  readonly routing: Readonly<Partial<Record<RouteSlot, ResolvedSlot>>>;
  readonly executionProfiles: Readonly<Record<ExecutionProfile, ExecutionProfileSpec>>;
  readonly executionPolicy: ExecutionPolicy;
  readonly supervisor: SupervisorConfig;
}

/** Normalizer result: the config plus any fail-loud signals (unknown rig refs,
 *  malformed role bindings). Callers decide whether to fail closed. */
export interface AgentConfigParse {
  readonly config: NormalizedAgentConfig;
  readonly errors: readonly string[];
}

// ── US-V4-015: fractal Agent Scope / Role / Binding model ──────────────────

export const AGENT_SCOPE_SCHEMA = "roll-agents/v1" as const;
export type AgentScopeSchema = typeof AGENT_SCOPE_SCHEMA;

export const AGENT_SCOPE_KINDS = ["machine", "project", "story", "skill", "review", "score"] as const;
export type AgentScopeKind = (typeof AGENT_SCOPE_KINDS)[number];

/** Minimal Role vocabulary for the recursive Agent-domain model. */
export const AGENT_SCOPE_ROLES = ["supervise", "execute", "evaluate"] as const;
export type AgentScopeRole = (typeof AGENT_SCOPE_ROLES)[number];

export const AGENT_BINDING_STRATEGIES = ["first-available", "least-recent", "seeded-random"] as const;
export type AgentBindingStrategy = (typeof AGENT_BINDING_STRATEGIES)[number];

/** Static Agent declaration inside `~/.roll/agents.yaml`. Runtime health is not
 *  encoded here; it is supplied by the resolver/spawn path. */
export interface AgentScopeAgent {
  readonly id: AgentName;
  readonly adapter: AgentName;
  readonly home?: string;
  readonly convention?: string;
  readonly capabilities: readonly AgentScopeRole[];
  readonly models?: readonly ModelId[];
}

export interface AgentScopeModel {
  readonly id: ModelId;
  readonly provider?: string;
  readonly capabilities?: readonly string[];
  readonly contextTokens?: number;
  readonly costClass?: "low" | "medium" | "high";
}

export type AgentScopeRoleBinding =
  | { readonly kind: "inherit"; readonly from?: string }
  | { readonly kind: "fixed"; readonly agent: AgentName; readonly model?: ModelId }
  | {
      readonly kind: "select";
      readonly from?: readonly AgentName[];
      readonly require?: readonly AgentScopeRole[];
      readonly avoid?: readonly AgentScopeRole[];
      readonly strategy: AgentBindingStrategy;
    };

export interface AgentScopeDefaults {
  readonly roles: Readonly<Partial<Record<AgentScopeRole, AgentScopeRoleBinding>>>;
}

export type AgentScopeResolutionStrategy = AgentBindingStrategy | "fixed";

export interface AgentScopeSkippedCandidate {
  readonly agent: AgentName;
  readonly reason: string;
}

export interface AgentScopeResolutionTrace {
  readonly source: string;
  readonly bindingKind: AgentScopeRoleBinding["kind"];
  readonly action: "inherit" | "select" | "resolve" | "fail";
}

/** A concrete role assignment after scope inheritance, selection, and runtime
 *  availability checks have been resolved by the future resolver. */
export interface AgentScopeResolvedRole {
  readonly scope: AgentScopeKind;
  readonly role: AgentScopeRole;
  readonly agent: AgentName;
  readonly model?: ModelId;
  readonly binding: AgentScopeRoleBinding;
  readonly source: string;
  readonly selectedStrategy: AgentScopeResolutionStrategy;
  readonly candidates: readonly AgentName[];
  readonly skipped: readonly AgentScopeSkippedCandidate[];
  readonly trace: readonly AgentScopeResolutionTrace[];
}

export interface AgentScopeResolutionFailure {
  readonly scope: AgentScopeKind;
  readonly role: AgentScopeRole;
  readonly source?: string;
  readonly errors: readonly string[];
  readonly candidates: readonly AgentName[];
  readonly skipped: readonly AgentScopeSkippedCandidate[];
  readonly trace: readonly AgentScopeResolutionTrace[];
}

export type AgentScopeRoleResolution =
  | { readonly ok: true; readonly resolved: AgentScopeResolvedRole }
  | { readonly ok: false; readonly failure: AgentScopeResolutionFailure };

export interface AgentScopeConfig {
  readonly schema: AgentScopeSchema;
  readonly scope: AgentScopeKind;
  readonly inherits?: string;
  readonly agents: Readonly<Partial<Record<AgentName, AgentScopeAgent>>>;
  readonly models: Readonly<Record<ModelId, AgentScopeModel>>;
  readonly roles: Readonly<Partial<Record<AgentScopeRole, AgentScopeRoleBinding>>>;
  readonly defaults: Readonly<Record<string, AgentScopeDefaults>>;
}

export interface AgentScopeConfigParse {
  readonly config: AgentScopeConfig | null;
  readonly errors: readonly string[];
}

/** US-V4-006 — the Planner contract (`planner-contract.md`) a `planned` execution
 *  produces in a fresh session BEFORE the Builder. Builder consumes it via
 *  artifact refs; the Evaluator maps planned-vs-delivered against it. */
export interface PlannerContract {
  readonly storyId: string;
  /** What is in scope for this Story (the boundary the Builder must respect). */
  readonly scopeBoundary: readonly string[];
  /** Acceptance / evaluation contract: how the delivery will be judged. */
  readonly acceptanceContract: readonly string[];
  /** Evidence the delivery is expected to produce. */
  readonly expectedEvidence: readonly string[];
  /** Known risks the Builder should watch. */
  readonly risks: readonly string[];
  /** Explicit out-of-scope items (must NOT be done in this Story). */
  readonly outOfScope: readonly string[];
  /** Resize/split guidance when the Planner judges the Story too large. */
  readonly resizeGuidance?: string;
}

/** US-V4-006 — planned-vs-delivered mapping row: each acceptance item the planner
 *  contracted, mapped to whether the delivery satisfied it. */
export interface PlannedVsDeliveredRow {
  readonly item: string;
  readonly status: "satisfied" | "missing" | "changed";
}

/** US-V4-005 — the Evaluator's recommendation (kept SEPARATE from the score and
 *  the blocking-review verdict — three distinct contracts, never one pass/fail). */
export type EvalRecommendation = "merge" | "repair" | "resize" | "hold" | "escalate";

/** US-V4-005 — the structured Evaluator report (`eval-report.md`). Blocking
 *  findings, advisory findings, score, and attest/evidence status stay separate
 *  dimensions; `recommendation` is the Evaluator's synthesis, never the Builder's. */
export interface EvalReport {
  readonly storyId: string;
  /** Findings that BLOCK merge until repaired (the gate dimension). */
  readonly blockingFindings: readonly string[];
  /** Non-blocking advice (recorded, never gating). */
  readonly advisoryFindings: readonly string[];
  /** The independent review score (separate contract) — absent when not scored. */
  readonly score?: { readonly value: number; readonly verdict: "good" | "ok" | "regression" };
  /** Whether story-scoped acceptance evidence was produced (separate contract). */
  readonly attestStatus: "produced" | "skipped" | "unknown";
  /** Planned-vs-delivered mapping summary (present only under `planned`). */
  readonly plannedVsDelivered?: string;
  readonly recommendation: EvalRecommendation;
}

/** US-V4-004 — the risk signals that drive execution-profile selection (arch §12).
 *  All fields are derivable from a story's spec + facts; none require running it. */
export interface StoryRiskInput {
  readonly storyId: string;
  readonly storyType: "US" | "FIX" | "REFACTOR" | "IDEA";
  readonly estimatedMinutes?: number;
  readonly filesHint: readonly string[];
  readonly userVisible: boolean;
  readonly visualEvidenceRequired: boolean;
  readonly crossModule: boolean;
  readonly touchesTruthOrRelease: boolean;
  readonly touchesAgentRuntime: boolean;
  readonly acceptanceAmbiguous: boolean;
  readonly historicalEvidenceRisk: boolean;
}
