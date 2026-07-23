/**
 * US-DELTA-001 — Shared Delta Team types: orthogonal trigger, topology, quality
 * profile, and the derived visible-mode projection.
 *
 * The design separates HOW a delivery request originates, HOW MANY execution
 * actors it has, and HOW STRICT its quality gates are. These are distinct axes;
 * no profile implies a topology and no topology implies a trigger.
 */

// ── Orthogonal dimensions ────────────────────────────────────────────────────

/** How a delivery request originates. */
export const DELEGATION_TRIGGERS = ["host-guided", "loop-autonomous"] as const;
export type DelegationTrigger = (typeof DELEGATION_TRIGGERS)[number];

/** Delivery actor shape, independent of trigger and quality profile. */
export const DELIVERY_TOPOLOGIES = ["solo", "delta-team", "full-delta-team"] as const;
export type DeliveryTopology = (typeof DELIVERY_TOPOLOGIES)[number];

/** Verification rigor — never a topology synonym. */
export const QUALITY_PROFILES = ["standard", "verified", "designed"] as const;
export type QualityProfile = (typeof QUALITY_PROFILES)[number];

// ── Derived visible mode ─────────────────────────────────────────────────────

/**
 * User-visible mode derived from trigger + topology. Never stored as a hidden
 * fourth state — it is always computed from the orthogonal shape.
 */
export const VISIBLE_DELIVERY_MODES = [
  "autonomous-loop",
  "full-delta-team",
  "delta-team",
  "solo-skill",
] as const;
export type VisibleDeliveryMode = (typeof VISIBLE_DELIVERY_MODES)[number];

// ── Delivery shape ────────────────────────────────────────────────────────────

/** The immutable composition that produces a visible mode. */
export interface DeliveryShape {
  readonly trigger: DelegationTrigger;
  readonly topology: DeliveryTopology;
  readonly qualityProfile: QualityProfile;
}

/** Type guard: is every field within its valid literal set? */
export function isValidDeliveryShape(s: unknown): s is DeliveryShape {
  if (typeof s !== "object" || s === null) return false;
  const r = s as Record<string, unknown>;
  return (
    (DELEGATION_TRIGGERS as readonly string[]).includes(r.trigger as string) &&
    (DELIVERY_TOPOLOGIES as readonly string[]).includes(r.topology as string) &&
    (QUALITY_PROFILES as readonly string[]).includes(r.qualityProfile as string)
  );
}

// ── Roles ────────────────────────────────────────────────────────────────────

export const DELTA_ROLES = ["designer", "builder", "evaluator", "peer"] as const;
export type DeltaRole = (typeof DELTA_ROLES)[number];

// ── Model resolution (host-neutral contract) ─────────────────────────────────

export type ResolutionSource = "user-pin" | "preset-preference" | "availability-fallback";

/** Opaque host model descriptor — Roll never queries a host. */
export interface HostModelDescriptor {
  readonly id: string;
  readonly available: boolean;
  readonly capabilityTags: readonly string[];
  readonly costClass?: "low" | "medium" | "high" | "unknown";
}

export interface HostModelInventory {
  readonly hostId: string;
  readonly observedAt: string;
  readonly models: readonly HostModelDescriptor[];
}

export interface RoleModelPreference {
  readonly preferredModelIds: readonly string[];
  readonly requiredTags?: readonly string[];
  readonly preferredCostClass?: "low" | "medium" | "high";
  readonly diversity: "allow" | "prefer" | "require";
}

export interface MachineDeltaPreset {
  readonly schema: "roll-delta-preset/v1";
  readonly id: string;
  readonly hostId: string;
  readonly roles: Readonly<Record<"designer" | "builder" | "evaluator", RoleModelPreference>>;
  readonly peer?: RoleModelPreference;
}

export interface ResolvedRoleAssignment {
  readonly role: DeltaRole;
  readonly roleInstanceId: string;
  readonly hostId: string;
  readonly modelId: string;
  readonly source: ResolutionSource;
  readonly reasons: readonly string[];
}

export interface DelegationResolution {
  readonly schema: "roll-delta-resolution/v1";
  readonly delegationId: string;
  readonly storyId: string;
  readonly trigger: DelegationTrigger;
  readonly topology: DeliveryTopology;
  readonly qualityProfile: QualityProfile;
  readonly presetId: string;
  readonly presetSha256: string;
  readonly inventoryObservedAt: string;
  readonly inventorySha256: string;
  readonly instructionSha256?: string;
  readonly roles: readonly ResolvedRoleAssignment[];
}

// ── Identity provenance ──────────────────────────────────────────────────────

/** Provenance of an identity claim — structural validation only, never proof. */
export type IdentityProvenance = "host-attested" | "adapter-observed";

// ── Artifact manifest v2 compatibility types ──────────────────────────────────

export interface DeltaArtifactManifest {
  readonly schemaVersion: 2;
  readonly delegationId: string;
  readonly storyId: string;
  readonly cycleId?: string;
  readonly role: DeltaRole;
  readonly trigger: DelegationTrigger;
  readonly topology: DeliveryTopology;
  readonly qualityProfile: QualityProfile;
  readonly executionIdentity: {
    readonly kind: "host-native" | "roll-adapter";
    readonly hostId: string;
    readonly roleInstanceId: string;
    readonly modelId: string;
    readonly adapter?: string;
  };
  readonly sessionId: string;
  readonly hostAttestation?: {
    readonly schema: "roll-delta-host-attestation/v1";
    readonly hostId: string;
    readonly role: DeltaRole;
    readonly roleInstanceId: string;
    readonly modelId: string;
    readonly sessionId: string;
    readonly assertedAt: string;
  };
  readonly worktreeAccess: "read-only" | "builder-write";
  readonly inputs: readonly import("./agent.js").ArtifactRef[];
  readonly outputs: readonly import("./agent.js").ArtifactRef[];
  readonly createdAt: string;
}

// ── Block reasons ────────────────────────────────────────────────────────────

export const DELTA_BLOCK_REASONS = [
  "host_supervisor_required",
  "model_unavailable",
  "invalid_preset",
  "invalid_resolution",
  "artifact_invalid",
  "identity_collision",
  "host_attestation_invalid",
  "role_write_violation",
  "builder_lease_conflict",
  "host_spawn_failed",
  "evaluation_repair_required",
  "terminal_path_unselected",
  "uncommitted_delegation_frame",
] as const;
export type DeltaBlockReason = (typeof DELTA_BLOCK_REASONS)[number];

// ── Terminal outcome ─────────────────────────────────────────────────────────

export type DeltaTerminalOutcome = "handoff_ready" | "blocked" | "abandoned";
export type TerminalBinding = "cycle_adoption" | "manual_host_bridge" | "handoff_only";
export type DeliveryDisposition = "owner_continue" | "owner_hold" | "owner_redelegate";
