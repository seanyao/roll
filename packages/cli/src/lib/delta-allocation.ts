/**
 * US-DELTA-003 — Delta delegation allocation, lease, and artifact I/O primitives.
 *
 * Extends the US-DELTA-002 preset loader with host-guided delegation frame
 * allocation, atomic no-clobber lease claim, recovery markers, and immutable
 * artifact writing. Deep artifact validation belongs to US-DELTA-004.
 */
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  rmSync,
  openSync,
  closeSync,
  fdatasyncSync,
  linkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { findFeatureFiles, liveEpicOf } from "./archive.js";
import { setLease, removeLease } from "@roll/core";
import type {
  DelegationTrigger,
  DeliveryTopology,
  QualityProfile,
  DelegationResolution,
} from "@roll/spec";

// Re-export preset loader from existing module
export { loadLocalPresets, presetPath } from "./delta-artifacts.js";

// ── ID generation ────────────────────────────────────────────────────────────

/** Seam for test injection: override CSPRNG ID generation. */
let _idGenerator: (() => string) | null = null;

/** Inject a deterministic ID generator for testing collision retry paths. */
export function injectIdGenerator(generator: (() => string) | null): void {
  _idGenerator = generator;
}

/** Generate a CSPRNG delegation ID. */
export function generateDelegationId(): string {
  if (_idGenerator) return _idGenerator();
  return randomUUID();
}

/** Canonical run ID derived from the delegation ID. */
export function runIdFromDelegationId(delegationId: string): string {
  return `delta-${delegationId}`;
}

// ── Card directory resolution ────────────────────────────────────────────────

/**
 * Resolve the single existing card archive directory for a story.
 * Must find exactly one card home; missing or ambiguous is fail-loud.
 */
export function resolveExistingUniqueCardArchiveDir(
  projectPath: string,
  storyId: string,
): string | null {
  // Strategy 1: Find feature files for this story
  const files = findFeatureFiles(projectPath, storyId);
  if (files.length === 1) {
    const epic = liveEpicOf(projectPath, storyId);
    if (epic) {
      return join(projectPath, ".roll", "features", epic, storyId);
    }
  } else if (files.length > 1) {
    return null; // ambiguous
  }

  // Strategy 2: Try direct epic resolution from existing card dirs
  const epic = liveEpicOf(projectPath, storyId);
  if (epic) {
    const cardDir = join(projectPath, ".roll", "features", epic, storyId);
    if (existsSync(cardDir)) return cardDir;
  }

  return null;
}

// ── Lease operations ─────────────────────────────────────────────────────────

export interface HostDelegationLease {
  storyId: string;
  state: "in_flight";
  ownerKind: "host-delegation";
  delegationId: string;
  runId: string;
  claimedAt: number;
}



/** Lease file path under the project's .roll/loop/host-delegation-leases/. */
export function leaseFilePath(projectPath: string, storyId: string): string {
  return join(projectPath, ".roll", "loop", "host-delegation-leases", `${storyId}.json`);
}

/**
 * Check whether a live cycle lease exists for a story in the shared
 * story-leases.json. Exported so cycle readers can also check for
 * host-delegation leases (see readHostDelegationLease below).
 *
 * Implementation note: this is the delta-side of the mutual exclusion
 * contract (plan §6.1 step 2). Full cycle-side integration (rejecting
 * a cycle claim when a host-delegation lease is live) is deferred to
 * a cross-loop integration card — the cycle code is in a different
 * domain and out of scope for US-DELTA-003.
 */
export function hasLiveCycleLease(projectPath: string, storyId: string): boolean {
  const leasePath = join(projectPath, ".roll", "loop", "story-leases.json");
  if (!existsSync(leasePath)) return false;

  try {
    const raw = JSON.parse(readFileSync(leasePath, "utf8"));
    const entry = raw[storyId];
    if (!entry || typeof entry.source !== "string") return false;
    // cycle claims are authoritative — always block
    if (entry.source === "cycle") return true;
    // host-delegation claims must cross-check the per-story lease file:
    // if the per-story file is gone, the story-leases.json entry is stale and should not block
    if (entry.source === "host-delegation") {
      const hdLeasePath = leaseFilePath(projectPath, storyId);
      return existsSync(hdLeasePath);
    }
  } catch {
    // best-effort
  }
  return false;
}

/**
 * Attempt to atomically claim a host-delegation lease for a story.
 * Uses a per-story lease file with temp+fsync+hardlink protocol.
 * Rejects if a live cycle lease exists for this story (mutual exclusion).
 *
 * Returns "claimed" on success, "exists" if a lease file already exists,
 * "conflict" on concurrent write collision.
 */
export function claimHostDelegationLease(
  projectPath: string,
  lease: HostDelegationLease,
): "claimed" | "conflict" | "exists" {
  // Mutual exclusion: reject if a live cycle lease exists for this story
  if (hasLiveCycleLease(projectPath, lease.storyId)) {
    return "exists";
  }

  const leasePath = leaseFilePath(projectPath, lease.storyId);
  const dir = dirname(leasePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Check if lease file already exists
  if (existsSync(leasePath)) {
    return "exists";
  }

  // Build lease entry (host-delegation own file)
  const leaseEntry = {
    pid: process.pid,
    claimedAt: lease.claimedAt,
    storyId: lease.storyId,
    state: "in_flight",
    ownerKind: "host-delegation",
    delegationId: lease.delegationId,
    runId: lease.runId,
  };

  // Write temp file
  const tmpPath = `${leasePath}.tmp.${randomUUID()}`;
  writeFileSync(tmpPath, JSON.stringify(leaseEntry, null, 2) + "\n", "utf8");

  // fsync temp file
  const tmpFd = openSync(tmpPath, "r+");
  fdatasyncSync(tmpFd);
  closeSync(tmpFd);

  // Try hard-link (EEXIST on collision)
  try {
    linkSync(tmpPath, leasePath);
  } catch {
    try { unlinkSync(tmpPath); } catch { /* best-effort */ }
    return "conflict";
  }

  // fsync parent directory
  const dirFd = openSync(dir, "r");
  fdatasyncSync(dirFd);
  closeSync(dirFd);

  // Remove temp
  try { unlinkSync(tmpPath); } catch { /* best-effort */ }

  // Stamp the shared story-leases.json so cycle readers automatically
  // reject this story (bidirectional mutual exclusion, plan §6.1 step 2).
  // Uses source: "host-delegation" — a distinct, mutually-recognized claim type
  // that the cycle machinery respects as an active claim (fail-loud, not best-effort).
  const storyLeasesPath = join(projectPath, ".roll", "loop", "story-leases.json");
  setLease(storyLeasesPath, lease.storyId, {
    pid: process.pid,
    source: "host-delegation",
    claimedAt: lease.claimedAt,
  });

  return "claimed";
}

/**
 * Release a matching host-delegation lease. Only removes if the delegationId matches.
 */
export function releaseHostDelegationLease(
  projectPath: string,
  storyId: string,
  delegationId: string,
): boolean {
  const leasePath = leaseFilePath(projectPath, storyId);
  if (!existsSync(leasePath)) return false;

  try {
    const raw = JSON.parse(readFileSync(leasePath, "utf8"));
    if (raw.delegationId !== delegationId) return false;
    if (raw.ownerKind !== "host-delegation") return false;
  } catch {
    return false;
  }

  try { unlinkSync(leasePath); } catch { return false; }

  // Clean up the shared story-leases.json entry (fail-loud — same atomicity as claim).
  // Scoped to source: "host-delegation" so it never touches human/supervisor claims.
  const storyLeasesPath = join(projectPath, ".roll", "loop", "story-leases.json");
  removeLease(storyLeasesPath, storyId, "host-delegation");

  return true;
}

/**
 * Read host-delegation lease for a story, if present.
 */
export function readHostDelegationLease(
  projectPath: string,
  storyId: string,
): HostDelegationLease | null {
  const leasePath = leaseFilePath(projectPath, storyId);
  if (!existsSync(leasePath)) return null;

  try {
    const raw = JSON.parse(readFileSync(leasePath, "utf8"));
    if (raw.ownerKind !== "host-delegation") return null;
    return {
      storyId,
      state: "in_flight",
      ownerKind: "host-delegation",
      delegationId: raw.delegationId,
      runId: raw.runId,
      claimedAt: raw.claimedAt,
    };
  } catch {
    return null;
  }
}

// ── Atomic file write (temp + fsync + rename) ────────────────────────────────

function atomicWriteJson(filePath: string, data: unknown): void {
  // No-overwrite invariant: target must not already exist (immutable evidence)
  if (existsSync(filePath)) {
    throw new PrepareError(
      "artifact_exists",
      `Refusing to overwrite existing artifact: ${filePath}`,
    );
  }

  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp.${randomUUID()}`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf8");

  const fd = openSync(tmpPath, "r+");
  fdatasyncSync(fd);
  closeSync(fd);

  renameSync(tmpPath, filePath);

  // fsync parent dir
  const dirFd = openSync(dirname(filePath), "r");
  fdatasyncSync(dirFd);
  closeSync(dirFd);
}

// ── Error type ───────────────────────────────────────────────────────────────

export class PrepareError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PrepareError";
  }
}

// ── Prepare delegation ────────────────────────────────────────────────────────

export interface PrepareInput {
  storyId: string;
  trigger: DelegationTrigger;
  topology: DeliveryTopology;
  qualityProfile: QualityProfile;
  presetId: string;
  presetSha256: string;
  resolutionTemplate: DelegationResolution;
}

export interface PrepareResult {
  delegationId: string;
  runId: string;
  frameDir: string;
  resolutionPath: string;
  markerPath: string;
  preparationPath: string;
  eventsPath: string;
  leasePath: string;
}

/**
 * Atomically allocate a delegation frame, lease, artifacts, and events.
 * Throws PrepareError on card resolution failure, lease conflict, or I/O issues.
 * Caller must append events after this returns successfully.
 */
/** Maximum retries for frame directory collision before failing. */
const MAX_COLLISION_RETRIES = 3;

export function prepareDelegation(
  projectPath: string,
  input: PrepareInput,
): PrepareResult {
  // 1. Resolve existing card directory
  const cardDir = resolveExistingUniqueCardArchiveDir(projectPath, input.storyId);
  if (!cardDir) {
    throw new PrepareError(
      "card_not_found",
      `Story ${input.storyId}: card directory not found or ambiguous`,
    );
  }

  // Ensure loop directory exists
  const loopDir = join(projectPath, ".roll", "loop");
  if (!existsSync(loopDir)) mkdirSync(loopDir, { recursive: true });

  // 2–4. Bounded retry loop for ID generation + lease claim + frame creation.
  // Frame directory collision (statistically impossible with v4 UUIDs but
  // required by AC2) retries with a fresh CSPRNG ID and only own-lease cleanup.
  // A real other-owner lease conflict (claimHostDelegationLease returns "exists")
  // is fail-loud immediately — no retry across another owner.
  let lastError: PrepareError | null = null;

  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const delegationId = generateDelegationId();
    const runId = runIdFromDelegationId(delegationId);

    // 3. Attempt lease claim
    const leaseResult = claimHostDelegationLease(projectPath, {
      storyId: input.storyId,
      state: "in_flight",
      ownerKind: "host-delegation",
      delegationId,
      runId,
      claimedAt: Date.now(),
    });

    if (leaseResult !== "claimed") {
      // Other-owner lease exists — fail-loud, no retry
      throw new PrepareError(
        "builder_lease_conflict",
        `Story ${input.storyId}: host-delegation lease conflict (${leaseResult})`,
      );
    }

    // 4. Create frame directory
    const frameDir = join(cardDir, `delta-${delegationId}`);
    try {
      mkdirSync(frameDir);
    } catch {
      // Own-lease collision only — release our lease and retry with new ID
      releaseHostDelegationLease(projectPath, input.storyId, delegationId);
      lastError = new PrepareError(
        "builder_lease_conflict",
        `Frame directory collision for ${delegationId} (attempt ${attempt + 1}/${MAX_COLLISION_RETRIES})`,
      );
      continue;
    }

    // 5–7. Write artifacts within claimed frame (no further retry on write failure)
    try {
      // 5. Write recovery marker (delegation-open.json)
      const markerPath = join(frameDir, "delegation-open.json");
      atomicWriteJson(markerPath, {
        schema: "roll-delta-delegation-open/v1",
        delegationId,
        storyId: input.storyId,
        createdAt: new Date().toISOString(),
      });

      // 6. Bind delegation ID into resolution and persist
      const resolutionPath = join(frameDir, "role-artifacts", "delegation", "delegation-resolution.json");
      const boundResolution = {
        ...input.resolutionTemplate,
        delegationId,
      };
      atomicWriteJson(resolutionPath, boundResolution);

      // 7. Write minimal preparation metadata
      const preparationPath = join(frameDir, "preparation.json");
      atomicWriteJson(preparationPath, {
        schema: "roll-delta-preparation/v1",
        delegationId,
        runId,
        storyId: input.storyId,
        trigger: input.trigger,
        topology: input.topology,
        qualityProfile: input.qualityProfile,
        presetId: input.presetId,
        presetSha256: input.presetSha256,
        createdAt: new Date().toISOString(),
      });

      const eventsPath = join(loopDir, "events.ndjson");

      return {
        delegationId,
        runId,
        frameDir,
        resolutionPath,
        markerPath,
        preparationPath,
        eventsPath,
        leasePath: leaseFilePath(projectPath, input.storyId),
      };
    } catch (err) {
      // Cleanup on write failure
      releaseHostDelegationLease(projectPath, input.storyId, delegationId);
      try { rmSync(frameDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      throw err;
    }
  }

  // All retries exhausted — throw the last error
  throw lastError ?? new PrepareError(
    "builder_lease_conflict",
    `Story ${input.storyId}: frame directory collision after ${MAX_COLLISION_RETRIES} retries`,
  );
}

// ── Recovery marker detection ─────────────────────────────────────────────────

export interface OrphanFrameInfo {
  delegationId: string;
  frameDir: string;
  markerPath: string;
}

/**
 * Detect uncommitted delegation frames (marker with no matching `delta:prepared` event).
 * Supply the event stream so committed delegations are not falsely reported.
 */
export function detectOrphanFrames(cardDir: string, events: readonly { type: string; delegationId?: string }[]): OrphanFrameInfo[] {
  if (!existsSync(cardDir)) return [];

  // Build the set of delegationIds that have a matching `delta:prepared` event
  const committedIds = new Set<string>();
  for (const ev of events) {
    if (ev.type === "delta:prepared" && ev.delegationId) {
      committedIds.add(ev.delegationId);
    }
  }

  const orphans: OrphanFrameInfo[] = [];

  try {
    for (const entry of readdirSync(cardDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("delta-")) continue;
      const delegationId = entry.name.slice("delta-".length);
      const frameDir = join(cardDir, entry.name);
      const markerPath = join(frameDir, "delegation-open.json");

      // Only report if marker exists AND no matching `delta:prepared` event
      if (existsSync(markerPath) && !committedIds.has(delegationId)) {
        orphans.push({ delegationId, frameDir, markerPath });
      }
    }
  } catch {
    // best-effort
  }

  return orphans;
}
