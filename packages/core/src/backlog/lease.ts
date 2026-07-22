/**
 * Story lease — who claimed the card and when.
 *
 * FIX-1211: a lease distinguishes "the loop picked this" from "a human (or
 * another loop instance) preempted this". The picker rejects In Progress rows
 * regardless, but the UNSTICK/reclaim path consults leases:
 *
 *   1. A story WITH a loop lease and a dead PID -> eligible for death-recovery
 *      (the original starvation-prevention semantics).
 *   2. A human/supervisor preemption is explicit: either this file carries a
 *      human-style lease, or legacy backlog text carries a claim timestamp.
 *      A story WITHOUT any lease or annotation is still a dead-claim candidate
 *      during preflight reclaim.
 *
 * Leases live at `.roll/loop/story-leases.json`, a gitignored runtime file.
 */

import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";

/** How long an explicit human/supervisor In Progress claim is respected. */
export const HUMAN_SOFT_LEASE_HOURS = 24;

/** Recognised claim sources. */
export type LeaseSource = "cycle" | "human" | "supervisor" | "host-delegation";

/** A lease entry — who claimed a story and when. */
export interface LeaseEntry {
  /** Process id of the claiming agent (or undefined for human/supervisor). */
  pid?: number;
  /** Epoch ms of the claim. */
  claimedAt: number;
  /** Who claimed it. */
  source: LeaseSource;
  /** Host delegation identity — only meaningful when source === "host-delegation". */
  delegationId?: string;
  /** Run ID for host delegation — only meaningful when source === "host-delegation". */
  runId?: string;
}

/**
 * Lease store shape on disk — a plain Record<storyId, LeaseEntry>.
 * File path: `<projectRoot>/.roll/loop/story-leases.json`
 */
export type LeaseMap = Record<string, LeaseEntry>;

// ─── Read / Write ───────────────────────────────────────────────────────────

/** Read the lease file; returns empty map when absent or unparseable. */
export function readLeases(path: string): LeaseMap {
  try {
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as LeaseMap;
  } catch {
    return {};
  }
}

/** Write the full lease map to disk. */
export function writeLeases(path: string, leases: LeaseMap): void {
  writeFileSync(path, JSON.stringify(leases, null, 2) + "\n", "utf8");
}

/** Upsert a single lease. */
export function setLease(path: string, storyId: string, entry: LeaseEntry): void {
  const leases = readLeases(path);
  leases[storyId] = entry;
  writeLeases(path, leases);
}

// ─── Atomic claim / release (US-DELTA-003) ──────────────────────────────────

/** Outcome of an atomic story lease claim. */
export type ClaimResult =
  | { status: "claimed" }
  | { status: "conflict"; existingSource: LeaseSource }
  | { status: "exists"; existingSource: LeaseSource; existingDelegationId?: string };

/** Maximum time (ms) to wait for a stale lock before failing. */
const LOCK_TIMEOUT_MS = 5_000;

/** Poll interval (ms) when waiting for lock. */
const LOCK_POLL_MS = 50;

/** Stale lock age threshold (ms) — after this, check if lock owner PID is alive. */
const STALE_LOCK_MS = 30_000;

function lockPathFor(leasePath: string): string {
  return `${leasePath}.lock`;
}

/**
 * Acquire a short-life advisory lock file for the lease store.
 * Returns a cleanup function; call it to release the lock.
 *
 * The lock file is NOT state — it is purely a synchronisation mechanism.
 * The single lease truth is `story-leases.json`.
 *
 * On stale lock (age > STALE_LOCK_MS with a dead PID), the lock is broken
 * and re-acquired. This is fail-loud: a live PID's lock is never broken.
 */
function acquireLeaseLock(lockPath: string): () => void {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      return () => {
        try { unlinkSync(lockPath); } catch { /* best-effort */ }
      };
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code !== "EEXIST") throw err;

      // Lock exists — check if stale
      try {
        const st = statSync(lockPath);
        const age = Date.now() - st.mtimeMs;
        if (age > STALE_LOCK_MS) {
          const ownerPid = parseInt(readFileSync(lockPath, "utf8").trim(), 10);
          if (!isNaN(ownerPid) && !isPidAlive(ownerPid)) {
            // Stale lock from dead PID — break it
            try { unlinkSync(lockPath); } catch { /* raced */ }
            continue;
          }
        }
      } catch {
        // Lock file disappeared or is unreadable — retry
        continue;
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for lease lock: ${lockPath}`);
      }

      // Busy-wait with small poll interval (acceptable for local FS lock)
      const start = Date.now();
      while (Date.now() - start < LOCK_POLL_MS) {
        // spin
      }
    }
  }
}

/**
 * Atomically claim a story lease in `.roll/loop/story-leases.json`.
 *
 * Uses a short-life advisory lock file (`<path>.lock`) for synchronisation
 * ONLY — the lock is not state. The single lease truth is the shared
 * `story-leases.json` file.
 *
 * No-clobber contract:
 * - If the story is already claimed (any source), returns conflict/exists.
 * - Only claims when the story has no live lease entry.
 * - Host-delegation claims include `delegationId` and `runId` in the lease
 *   record so crash recovery can reconstruct ownership from the shared truth.
 *
 * The caller's identity (pid, source, delegationId, runId) is stored in the
 * lease entry so `releaseStoryLease` can match-only release.
 */
export function claimStoryLease(
  leasePath: string,
  storyId: string,
  entry: LeaseEntry,
): ClaimResult {
  // Host-delegation claims MUST carry delegationId for match-only release
  if (entry.source === "host-delegation" && !entry.delegationId) {
    throw new Error("claimStoryLease: host-delegation source requires delegationId");
  }

  const lockFile = lockPathFor(leasePath);
  const release = acquireLeaseLock(lockFile);
  try {
    const leases = readLeases(leasePath);
    const existing = leases[storyId];

    if (existing !== undefined) {
      // If the existing lease is dead (PID not alive) and from cycle source,
      // it IS still a claim — the preflight reclaim step handles death recovery.
      // We never silently overwrite here.
      return {
        status: "exists",
        existingSource: existing.source,
        existingDelegationId: existing.delegationId,
      };
    }

    // No existing claim — write ours atomically
    leases[storyId] = entry;
    writeLeases(leasePath, leases);
    return { status: "claimed" };
  } finally {
    release();
  }
}

/**
 * Release a story lease with identity match.
 *
 * Match-only contract:
 * - `source` must match the lease entry's source.
 * - For `host-delegation` source: `delegationId` must also match.
 * - For `cycle` source: `pid` must also match.
 * - Never deletes other owners' entries.
 *
 * Returns `true` if the lease was released, `false` if identity mismatch
 * or no lease existed.
 */
export interface ReleaseIdentity {
  source: LeaseSource;
  pid?: number;
  delegationId?: string;
  runId?: string;
}

export function releaseStoryLease(
  leasePath: string,
  storyId: string,
  identity: ReleaseIdentity,
): boolean {
  const lockFile = lockPathFor(leasePath);
  const release = acquireLeaseLock(lockFile);
  try {
    const leases = readLeases(leasePath);
    const existing = leases[storyId];
    if (existing === undefined) return false;

    // Source must match
    if (existing.source !== identity.source) return false;

    // For host-delegation: delegationId AND runId must be non-empty and both match.
    // runId is mandatory — omitting it does not bypass the identity check.
    if (identity.source === "host-delegation") {
      if (!identity.delegationId || !identity.runId ||
          existing.delegationId !== identity.delegationId ||
          existing.runId !== identity.runId) {
        return false;
      }
    }

    // For cycle: pid must match
    if (identity.source === "cycle" && identity.pid !== undefined) {
      if (existing.pid !== identity.pid) return false;
    }

    delete leases[storyId];

    if (Object.keys(leases).length === 0) {
      try { unlinkSync(leasePath); } catch { /* best-effort */ }
    } else {
      writeLeases(leasePath, leases);
    }
    return true;
  } finally {
    release();
  }
}

/**
 * Remove a single lease. Returns true when the key existed (and matched).
 *
 * `onlySource` scopes the removal: a terminating cycle passes "cycle" so it
 * can never wipe a HUMAN/supervisor claim that preempted the story mid-flight
 * — the soft-lease protection must survive the original cycle's terminal.
 */
export function removeLease(path: string, storyId: string, onlySource?: LeaseSource): boolean {
  const leases = readLeases(path);
  if (!(storyId in leases)) return false;
  if (onlySource !== undefined && leases[storyId]?.source !== onlySource) return false;
  delete leases[storyId];
  if (Object.keys(leases).length === 0) {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      /* best-effort cleanup — never block terminal on lease tidy */
    }
  } else {
    writeLeases(path, leases);
  }
  return true;
}

// ─── Lifetime helpers ───────────────────────────────────────────────────────

/** True when the PID in the lease is still alive on the current machine. */
export function isPidAlive(pid: number): boolean {
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
}

/** True when the lease's owning process is still running. */
export function isLeaseAlive(entry: LeaseEntry): boolean {
  if (entry.pid === undefined) return false;
  return isPidAlive(entry.pid);
}

/**
 * True when the story has a human-style soft lease that is still active —
 * claimed within HUMAN_SOFT_LEASE_HOURS ago.
 */
export function isHumanSoftLeaseActive(entry: LeaseEntry, now: number): boolean {
  return now - entry.claimedAt < HUMAN_SOFT_LEASE_HOURS * 3600_000;
}

/**
 * Clean dead PID leases from the lease file.
 *
 * A lease whose pid is set but the process is no longer alive is stale — the
 * cycle that claimed it crashed or was killed without running its terminal
 * cleanup. Remove the lease so the story is not permanently blocked.
 *
 * Returns the list of storyIds whose dead leases were cleaned (for alerting).
 */
export function cleanDeadLeases(path: string): string[] {
  const leases = readLeases(path);
  const cleaned: string[] = [];
  for (const [id, entry] of Object.entries(leases)) {
    // Only clean cycle leases with dead PIDs.
    // Host-delegation leases are persistent host protocol leases (no pid)
    // and are NEVER cleaned by this function. Human/supervisor leases also
    // have no pid and are never cleaned.
    if (entry.pid !== undefined && entry.source !== "host-delegation" && !isPidAlive(entry.pid)) {
      delete leases[id];
      cleaned.push(id);
    }
  }
  if (cleaned.length > 0) {
    if (Object.keys(leases).length === 0) {
      try {
        if (existsSync(path)) unlinkSync(path);
      } catch {
        /* best-effort cleanup — never block pick on lease tidy */
      }
    } else {
      writeLeases(path, leases);
    }
  }
  return cleaned;
}

/**
 * Build a "claimed by other?" predicate from the lease map for the picker.
 *
 * A story whose sole claimer is this PID with a live process is NOT claimed.
 * Any other case (no lease -> human-preempted, dead lease, different PID) IS.
 */
export function buildClaimedByOther(
  leases: LeaseMap,
  _now: number,
  ownPid?: number,
): (id: string) => boolean {
  return (id: string): boolean => {
    const entry = leases[id];
    if (entry === undefined) {
      // No lease entry at all — human-preempted (or lease cleaned up).
      // The picker must conservatively skip it.
      return true;
    }
    // Live lease from the current process -> NOT other.
    if (entry.pid !== undefined && ownPid !== undefined && entry.pid === ownPid && isPidAlive(entry.pid)) {
      return false;
    }
    // Dead lease, different process, or human claim -> claimed by other.
    return true;
  };
}
