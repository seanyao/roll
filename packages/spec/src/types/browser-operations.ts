/**
 * US-BROW-001 — Browser operation contracts and policy boundary.
 *
 * Closed request/result contract, lane enum, and permitted action vocabulary.
 * Arbitrary script evaluation is not representable — the action vocabulary
 * is exhaustive and policy-enforced before any transport is selected.
 *
 * Domain model: Browser Operations bounded context.
 * See .roll/features/browser-automation/managed-devtools-plan.md §§3, 5.2, 6.1.
 */

// ── Lane ────────────────────────────────────────────────────────────────────

/** Managed: Roll-launched isolated Chrome (no owner cookies).
 *  Interactive: owner-approved connection to their running Chrome. */
export type BrowserLane = "managed" | "interactive";

// ── Action vocabulary (closed set) ──────────────────────────────────────────

/** Every action a browser operation can perform. Closed set — arbitrary
 *  script evaluation is NOT representable. */
export type BrowserActionKind =
  | "navigate"
  | "click"
  | "fill"
  | "press_key"
  | "snapshot"
  | "console"
  | "network"
  | "screenshot";

/** The closed set of all permitted browser actions. */
export const BROWSER_ACTION_KINDS: readonly BrowserActionKind[] = [
  "navigate",
  "click",
  "fill",
  "press_key",
  "snapshot",
  "console",
  "network",
  "screenshot",
];

// ── Caller roles ────────────────────────────────────────────────────────────

/** Who is requesting the browser operation. */
export type BrowserCaller = "builder" | "evaluator" | "supervisor" | "attest";

// ── Run state machine ───────────────────────────────────────────────────────

export type BrowserRunState =
  | "requested"
  | "authorized"
  | "running"
  | "passed"
  | "failed"
  | "denied"
  | "expired";

// ── Diagnostic artifacts ────────────────────────────────────────────────────

export type DiagnosticArtifactKind =
  | "dom-snapshot"
  | "console-summary"
  | "network-summary"
  | "devtools-screenshot";

export interface DiagnosticArtifactRef {
  artifactId: string;
  kind: DiagnosticArtifactKind;
  digest: string;
  bytes: number;
  /** Always true — diagnostic artifacts are never visual AC evidence. */
  untrusted: true;
  /** Always true — diagnostic artifacts are never visual AC evidence. */
  diagnosticOnly: true;
}

// ── Operation run (aggregate root) ──────────────────────────────────────────

/** The idempotent run identifier. Every distinct operation gets one run. */
export interface BrowserOperationRun {
  runId: string;
  /** Same idempotencyKey → same run, replayed terminal result. */
  idempotencyKey: string;
  storyId?: string;
  cycleId?: string;
  caller: BrowserCaller;
  lane: BrowserLane;
  /** The origin as requested (pre-normalization). */
  requestedOrigin: string;
  /** SHA-256 of the normalized policy JSON at authorization time. */
  policyFingerprint: string;
  /** Hash of the holder token — run recovery requires this. */
  holderTokenHash: string;
  state: BrowserRunState;
  leaseId?: string;
  startedAt?: string;
  endedAt?: string;
  diagnostics: DiagnosticArtifactRef[];
  result: "pass" | "fail" | "skipped" | "denied";
}

// ── Lease (interactive lane only) ───────────────────────────────────────────

export interface BrowserLease {
  leaseId: string;
  browser: "owner-chrome";
  storyId: string;
  origin: string;
  scope: "interactive-read-write";
  ownerApproval: {
    approvedAt: string;
    operator: string;
    reason: string;
  };
  acquiredAt: string;
  expiresAt: string;
  holderPid: number;
  /** Start-time identity used to distinguish PID reuse during recovery. */
  holderProcessIdentity: string;
  /** Hash only — raw holder tokens are never persisted. */
  holderTokenHash: string;
  endpointHash: string;
  releasedAt?: string;
}

// ── Policy (project-level, committed) ───────────────────────────────────────

export interface BrowserOperationsPolicy {
  enabled: boolean;
  devtoolsServer: string;
  managed: BrowserLanePolicy;
  interactive: BrowserLanePolicy;
}

export interface BrowserLanePolicy {
  enabled: boolean;
  allowedOrigins: string[];
  allowedActions: BrowserActionKind[];
  /** Managed only: max runs per cycle. */
  maxRunsPerCycle?: number;
  /** Managed only: per-run timeout. */
  timeoutMs?: number;
  /** Interactive only: max lease duration. */
  maxLeaseMs?: number;
  /** Interactive only: require owner approval. */
  requireOwnerApproval?: boolean;
  /** Interactive only: require physical capture for visual AC. */
  requirePhysicalCaptureForVisualAc?: boolean;
}

// ── Origin normalization result ─────────────────────────────────────────────

export interface NormalizedOrigin {
  /** The normalized origin string: scheme + "://" + hostname + ":" + port. */
  normalized: string;
  /** The raw URL that was normalized. */
  raw: string;
  /** The parsed scheme (always "https" or "http" after normalization). */
  scheme: string;
  /** The normalized hostname (lowercase, punycode-decoded for display). */
  hostname: string;
  /** The effective port. */
  port: number;
  /** Whether this is a loopback address. */
  isLoopback: boolean;
}

// ── Origin validation ───────────────────────────────────────────────────────

export interface OriginValidationResult {
  /** Whether the origin is valid and allowed. */
  valid: boolean;
  /** If invalid, the structured reason. */
  reason?: BrowserDenialReason;
  /** If valid, the normalized origin. */
  normalized?: NormalizedOrigin;
}

// ── Denial reasons (structured, every denial returns one) ───────────────────

export type BrowserDenialCode =
  | "origin_not_https"
  | "origin_userinfo"
  | "origin_trailing_dot"
  | "origin_suffix_attack"
  | "origin_not_allowed"
  | "origin_wildcard_bypass"
  | "origin_invalid"
  | "lane_disabled"
  | "action_not_allowed"
  | "caller_not_allowed"
  | "interactive_no_lease"
  | "interactive_lease_expired"
  | "interactive_lease_origin_mismatch"
  | "interactive_lease_no_tty"
  | "interactive_lease_held"
  | "interactive_lease_invalid_request"
  | "policy_disabled"
  | "policy_fingerprint_tamper"
  | "transport_binding_missing"
  | "devtools_unavailable"
  | "generic_mcp_bypass_denied";

export interface BrowserDenialReason {
  code: BrowserDenialCode;
  message: string;
  /** Additional structured detail (origin, action, lane, etc.). */
  detail?: Record<string, unknown>;
}

// ── Request / result contracts ──────────────────────────────────────────────

export interface BrowserOperationRequest {
  idempotencyKey: string;
  storyId: string;
  cycleId?: string;
  caller: BrowserCaller;
  lane: BrowserLane;
  targetUrl: string;
  purpose: "test" | "diagnose" | "verify";
}

export interface BrowserActionInput {
  runId: string;
  idempotencyKey: string;
  holderToken: string;
  action: BrowserActionKind;
  payload: Record<string, string | number | boolean>;
}

export interface BrowserActionResult {
  runId: string;
  actionId: string;
  finalUrl?: string;
  status: "ok" | "denied" | "failed" | "skipped";
  diagnosticRefs: DiagnosticArtifactRef[];
  redactedSummary: string;
}

// ── Policy resolution result ────────────────────────────────────────────────

export interface BrowserPolicyDecision {
  /** Whether the operation is authorized. */
  authorized: boolean;
  /** If denied, the structured reason. Never undefined when authorized=false. */
  denial?: BrowserDenialReason;
  /** If authorized, the resolved lane policy for the operation. */
  lanePolicy?: BrowserLanePolicy;
  /** The fingerprint of the policy used for this decision. */
  policyFingerprint: string;
  /** The normalized origin (always present when authorized). */
  normalizedOrigin?: NormalizedOrigin;
}

// ── Interactive lease request ───────────────────────────────────────────────

export interface InteractiveLeaseRequest {
  storyId: string;
  origin: string;
  reason: string;
  requestedMs: number;
}

// ── Event types (for event stream) ──────────────────────────────────────────

export type BrowserOperationEvent =
  | { type: "browser:operation-requested"; runId: string; ts: string; request: BrowserOperationRequest; holderTokenHash: string }
  | { type: "browser:operation-authorized"; runId: string; ts: string; policyFingerprint: string }
  | { type: "browser:operation-denied"; runId: string; ts: string; reason: BrowserDenialReason }
  | { type: "browser:lease-granted"; leaseId: string; ts: string; storyId: string; origin: string; actionSummary: string; expiresAt: string; credentialExportDenied: boolean }
  | { type: "browser:lease-orphaned"; leaseId: string; ts: string; endpointHash: string; holderPid: number }
  | { type: "browser:lease-rejected"; ts: string; storyId: string; reason: BrowserDenialReason }
  | { type: "browser:lease-expired"; leaseId: string; ts: string }
  | { type: "browser:lease-released"; leaseId: string; ts: string }
  | { type: "browser:operation-started"; runId: string; ts: string }
  | { type: "browser:operation-step-finished"; runId: string; actionId: string; ts: string }
  | { type: "browser:diagnostic-recorded"; runId: string; ts: string; ref: DiagnosticArtifactRef }
  | { type: "browser:diagnostic-dropped"; runId: string; ts: string; failure: "redaction_failed" }
  | { type: "browser:operation-finished"; runId: string; ts: string; result: BrowserActionResult }
  | { type: "browser:mcp-bypass-denied"; ts: string; reason: BrowserDenialReason }
  | {
      type: "browser:environment-checked";
      ts: string;
      managed: BrowserLaneVerdict;
      interactive: BrowserLaneVerdict;
      capture: BrowserLaneVerdict;
    };

// ── US-BROW-010 — transport version check and atomic update ──────────────────

/** Result of a deterministic, non-mutating version check. */
export interface BrowserTransportVersionCheck {
  /** The currently pinned package version. */
  pinned: string;
  /** Available candidate version, or null when no update is available. */
  candidate: string | null;
  /** True when candidate differs from pinned and is non-null. */
  updateAvailable: boolean;
}

/** Outcome of an atomic version update attempt. */
export type BrowserTransportVersionApplyResult =
  | { kind: "applied"; from: string; to: string }
  | { kind: "no_update"; pinned: string }
  | { kind: "verification_failed"; from: string; candidate: string; reason: string }
  | { kind: "refused"; reason: string };

// ── US-BROW-003 — environment readiness ──────────────────────────────────────

/**
 * Per-lane readiness verdict. `blocked` is a hard, honest unavailable state that
 * MUST NOT be interpreted as a passing browser check; `degraded` means the lane
 * cannot run but existing Playwright / Roll Capture paths stay usable; `ready`
 * means the lane's dependencies all passed a non-mutating preflight.
 */
export type BrowserLaneVerdict = "ready" | "degraded" | "blocked";

/** The three independently-reported readiness lanes. */
export type BrowserReadinessLane = "managed" | "interactive" | "capture";

/**
 * One dependency observation. Every field is non-sensitive: probes never open
 * remote debugging, never install packages, and never write configuration.
 */
export interface BrowserDependencyObservation {
  id:
    | "node"
    | "npx"
    | "chrome"
    | "devtools_mcp"
    | "loopback_remote_debug"
    | "transport_binding"
    | "capture";
  present: boolean;
  detail: string;
  /** Optional non-sensitive value (version string, path, endpoint). */
  value?: string;
}

/** Capture readiness projected into the browser-operations vocabulary. */
export type BrowserCaptureStatus = "available" | "degraded" | "skip";

/** Raw, pre-verdict observations fed to the readiness aggregate. */
export interface BrowserEnvironmentObservations {
  node: BrowserDependencyState;
  npx: BrowserDependencyState;
  chrome: BrowserDependencyState;
  devtoolsPackage: BrowserDependencyState;
  loopbackRemoteDebug: BrowserDependencyState;
  /** Whether the project policy devtools_server matches the registry logical key. */
  transportBinding: BrowserDependencyState;
  capture: { status: BrowserCaptureStatus; detail: string };
}

export interface BrowserDependencyState {
  present: boolean;
  detail: string;
  value?: string;
}

export interface BrowserLaneReadiness {
  lane: BrowserReadinessLane;
  verdict: BrowserLaneVerdict;
  reason: string;
  /** Actionable, non-mutating repair guidance. Never an auto-run command. */
  actions: string[];
}

/**
 * BrowserEnvironmentReadiness aggregate — owns dependency observations and the
 * ready | degraded | blocked verdict for each lane. Raising it emits
 * browser:environment-checked.
 */
export interface BrowserEnvironmentReadiness {
  managed: BrowserLaneReadiness;
  interactive: BrowserLaneReadiness;
  capture: BrowserLaneReadiness;
  observations: BrowserDependencyObservation[];
}
