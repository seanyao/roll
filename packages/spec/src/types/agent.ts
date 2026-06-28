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
