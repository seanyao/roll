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
 * US-DELTA-003 (architecture adjudication): lease authority is a directory of
 * per-story canonical lease records, one file per story:
 *
 *   `.roll/loop/leases/<storyId>.lease`
 *
 * Each file is a single newline-terminated JSON `LeaseEntry`. The atomic claim
 * primitive is hardlink no-clobber (temp write + fdatasync + linkSync with
 * EEXIST detection + parent-dir fsync + temp unlink). There is no lock file
 * and no JSON read-modify-write. The legacy `story-leases.json` JSON map is
 * read as a fallback on first read when the directory is absent, but new
 * writes always go to the canonical records directory.
 */

import {
  existsSync,
  fdatasyncSync,
  linkSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

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
 * Lease store shape — a plain Record<storyId, LeaseEntry>.
 * The on-disk authority is a directory of per-story `.lease` files.
 */
export type LeaseMap = Record<string, LeaseEntry>;

/** File extension for per-story lease records. */
const LEASE_EXT = ".lease";

// ─── Path helpers ───────────────────────────────────────────────────────────

/** Canonical path to the leases directory. */
export function leaseDirPath(eventsDirOrLoopDir: string): string {
  // Accept either the loop dir (for legacy callers that derived path from events dir)
  // or the events dir directly. The leases directory lives next to events.ndjson.
  if (eventsDirOrLoopDir.endsWith("loop") || eventsDirOrLoopDir.endsWith("loop/")) {
    return join(eventsDirOrLoopDir, "leases");
  }
  return join(dirname(eventsDirOrLoopDir), "leases");
}

/** Legacy single-file lease path (for read-only fallback). */
export function legacyLeasePath(loopDir: string): string {
  return join(loopDir, "story-leases.json");
}

/** Per-story record file path. */
function recordPath(dirPath: string, storyId: string): string {
  return join(dirPath, `${storyId}${LEASE_EXT}`);
}

// ─── Read ───────────────────────────────────────────────────────────────────

/** Encode a single lease entry for storage. */
function encodeEntry(entry: LeaseEntry): string {
  return JSON.stringify(entry) + "\n";
}

/** Decode a single lease entry. */
function decodeEntry(raw: string): LeaseEntry | null {
  try {
    const parsed = JSON.parse(raw.trim());
    if (typeof parsed.claimedAt !== "number") return null;
    if (typeof parsed.source !== "string") return null;
    return parsed as LeaseEntry;
  } catch {
    return null;
  }
}

/**
 * Read the lease directory; returns empty map when absent or unparseable.
 *
 * The directory `.roll/loop/leases/` is the canonical authority.
 * When the directory exists, it is the sole source — legacy
 * `story-leases.json` is never merged. When the directory does NOT exist,
 * falls back to the legacy file for backward compatibility (read-only).
 *
 * BLOCK-1 fix: canonical is the sole authority. A successfully migrated
 * legacy file is retired; `readLeases` never resurrects owners from a
 * still-present legacy file after canonical records are the active store.
 */
export function readLeases(dirPath: string): LeaseMap {
  try {
    const canonicalExists = existsSync(dirPath);
    const parentDir = dirname(dirPath);
    const legacyPath = join(parentDir, "story-leases.json");

    // Canonical is the sole authority when it exists
    if (canonicalExists) {
      const map: LeaseMap = {};
      for (const entry of readdirSync(dirPath)) {
        if (!entry.endsWith(LEASE_EXT)) continue;
        const storyId = entry.slice(0, -LEASE_EXT.length);
        try {
          const raw = readFileSync(join(dirPath, entry), "utf8");
          const decoded = decodeEntry(raw);
          if (decoded !== null) {
            map[storyId] = decoded;
          }
        } catch {
          // skip unreadable entry
        }
      }
      return map;
    }

    // Canonical absent: fall back to legacy (read-only backward compat)
    if (existsSync(legacyPath)) {
      try {
        const raw = readFileSync(legacyPath, "utf8");
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null) {
          return parsed as LeaseMap;
        }
      } catch {
        // unreadable legacy — ignore
      }
    }
    return {};
  } catch {
    return {};
  }
}

/** Write the full lease map to disk as per-story record files. */
export function writeLeases(dirPath: string, leases: LeaseMap): void {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
  // Write each story lease as a separate file
  for (const [storyId, entry] of Object.entries(leases)) {
    const rp = recordPath(dirPath, storyId);
    writeFileSync(rp, encodeEntry(entry), "utf8");
    const fd = openSync(rp, "r+");
    fdatasyncSync(fd);
    closeSync(fd);
  }
  // fsync parent directory
  const dirFd = openSync(dirPath, "r");
  fdatasyncSync(dirFd);
  closeSync(dirFd);
}

/**
 * Upsert a single lease. Writes a per-story record file.
 * Only for batch/non-atomic use (setup, test fixtures). For concurrent
 * atomic claims, use `claimStoryLease`.
 */
export function setLease(dirPath: string, storyId: string, entry: LeaseEntry): void {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
  const rp = recordPath(dirPath, storyId);

  // Atomic write via temp + fsync + rename (not hardlink — this is the
  // non-contended batch writer; concurrent claims must use claimStoryLease).
  const tmpPath = join(dirPath, `${storyId}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`);
  writeFileSync(tmpPath, encodeEntry(entry), "utf8");
  const tmpFd = openSync(tmpPath, "r+");
  fdatasyncSync(tmpFd);
  closeSync(tmpFd);

  // Use rename (overwrite) — setLease is for test fixtures and batch init,
  // not concurrent atomic claim. No-clobber claims use claimStoryLease.
  try {
    // Remove old record if present (setLease is upsert, not claim)
    if (existsSync(rp)) unlinkSync(rp);
  } catch {
    // ok if absent
  }
  try {
    linkSync(tmpPath, rp);
  } catch {
    // If link fails (directory/perms), fallback to rename
    writeFileSync(rp, readFileSync(tmpPath, "utf8"), "utf8");
    const fd = openSync(rp, "r+");
    fdatasyncSync(fd);
    closeSync(fd);
  }
  try { unlinkSync(tmpPath); } catch { /* best-effort */ }

  const dirFd = openSync(dirPath, "r");
  fdatasyncSync(dirFd);
  closeSync(dirFd);
}

// ─── Atomic claim / release (US-DELTA-003 hardlink no-clobber) ──────────────

/** Outcome of an atomic story lease claim. */
export type ClaimResult =
  | { status: "claimed" }
  | { status: "conflict"; existingSource: LeaseSource }
  | { status: "exists"; existingSource: LeaseSource; existingDelegationId?: string };

// ─── Filesystem operations seam (BLOCK-3: operation-level product proof) ──

/** Narrow filesystem operations used by the claim protocol.
 *  Each maps to exactly one durable step in the hardlink no-clobber sequence.
 *  Production default uses real node:fs. Tests inject a spy that records
 *  operations + paths and can throw at any step to simulate I/O failure. */
export interface ClaimStepOps {
  /** Write complete owner record to a unique temp file. */
  writeTempFile(path: string, data: string): void;
  /** Open a file or directory for fsync. flags: "r+" for file, "r" for dir. */
  openFile(path: string, flags: string): number;
  /** fdatasync an open file descriptor. */
  fsyncFile(fd: number): void;
  /** Close an open file descriptor. */
  closeFile(fd: number): void;
  /** Hard-link temp to final record path (no-clobber; EEXIST = conflict). */
  hardLink(existingPath: string, newPath: string): void;
  /** Remove a temp file after successful claim or on conflict cleanup. */
  unlinkFile(path: string): void;
  /** Create a directory (recursive). Used during migration staging. */
  mkdir(path: string): void;
  /** Atomically rename a file. Used to retire legacy authority. */
  renameFile(oldPath: string, newPath: string): void;
}

const defaultClaimOps: ClaimStepOps = {
  writeTempFile: (path, data) => writeFileSync(path, data, "utf8"),
  openFile: (path, flags) => openSync(path, flags),
  fsyncFile: (fd) => fdatasyncSync(fd),
  closeFile: (fd) => closeSync(fd),
  hardLink: (src, dest) => linkSync(src, dest),
  unlinkFile: (path) => unlinkSync(path),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  renameFile: (oldPath, newPath) => renameSync(oldPath, newPath),
};

let _injectedClaimOps: ClaimStepOps | null = null;

function claimOps(): ClaimStepOps {
  return _injectedClaimOps ?? defaultClaimOps;
}

/** Inject a filesystem operations seam for testing the claim protocol.
 *  Call with null to reset to production defaults. */
export function injectClaimOps(ops: ClaimStepOps | null): void {
  _injectedClaimOps = ops;
}

/**
 * Atomically claim a story lease using hardlink no-clobber.
 *
 * Protocol (plan §6.1 step 2, architecture adjudication):
 *   1. Write complete owner record to same-directory unique temp file
 *   2. fdatasync temp file
 *   3. linkSync(temp, final) — EEXIST means another owner won (no overwrite)
 *   4. fdatasync parent directory
 *   5. unlink temp file
 *
 * No lock file. No JSON read-modify-write. The hardlink is the sole
 * mutual-exclusion primitive — EEXIST = conflict.
 *
 * Host-delegation claims MUST carry delegationId for match-only release.
 *
 * @param dirPath  Path to the leases directory (e.g. `.roll/loop/leases`)
 * @param storyId  The story id to claim
 * @param entry    The lease entry (pid, source, claimedAt, delegationId, runId)
 */
export function claimStoryLease(
  dirPath: string,
  storyId: string,
  entry: LeaseEntry,
): ClaimResult {
  // Host-delegation claims MUST carry delegationId for match-only release
  if (entry.source === "host-delegation" && !entry.delegationId) {
    throw new Error("claimStoryLease: host-delegation source requires delegationId");
  }

  // ═══ Helper: validate legacy root + every entry (BLOCK-2) ═══
  function validateLegacyEntries(raw: unknown, path: string): LeaseMap {
    if (typeof raw !== "object" || raw === null) {
      throw new Error(`Legacy lease file ${path} is not a valid JSON object (got ${raw === null ? "null" : typeof raw})`);
    }
    const map = raw as LeaseMap;
    for (const [id, entry] of Object.entries(map)) {
      if (typeof entry !== "object" || entry === null) {
        throw new Error(`Legacy lease file ${path} has invalid entry for "${id}": not an object`);
      }
      const e = entry as LeaseEntry;
      if (typeof e.source !== "string") {
        throw new Error(`Legacy lease file ${path} has invalid entry for "${id}": missing source`);
      }
      if (typeof e.claimedAt !== "number") {
        throw new Error(`Legacy lease file ${path} has invalid entry for "${id}": missing claimedAt`);
      }
    }
    return map;
  }

  // ═══ Legacy migration: when canonical dir is absent, check legacy first ═══
  // One-time controlled migration: if legacy exists, either reject (same-story)
  // or migrate all entries to canonical records (different stories). This
  // prevents dual-ownership when a legacy lease exists for the same story.
  //
  // BLOCK-3 fix: migration uses claimOps() seam for every fs operation.
  // Staging + publish + retire: write all temps, link all, fsync dir,
  // then atomically retire the legacy file. Any failure rolls back.
  if (!existsSync(dirPath)) {
    const parentDir = dirname(dirPath);
    const legacyPath = join(parentDir, "story-leases.json");
    if (existsSync(legacyPath)) {
      const raw = readFileSync(legacyPath, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Legacy lease file ${legacyPath} contains invalid JSON`);
      }
      const legacyMap = validateLegacyEntries(parsed, legacyPath);

      // Check for same-story conflict FIRST
      if (legacyMap[storyId] !== undefined) {
        const existing = legacyMap[storyId] as LeaseEntry;
        return {
          status: "exists",
          existingSource: existing.source,
          existingDelegationId: existing.delegationId,
        };
      }

      // Different stories: one-time atomic migration of ALL legacy entries
      // to canonical directory before claiming the new story.
      // All-or-fail staging: write+fsync all temps, then link all, then
      // fsync dir, then retire legacy. Any failure rolls back completely.
      const ops = claimOps();
      ops.mkdir(dirPath);
      const staged: Array<{ tmpPath: string; finalPath: string }> = [];
      try {
        // Phase 1: Stage — write and fsync all temp files
        for (const [legacyStoryId, legacyEntry] of Object.entries(legacyMap)) {
          const entry = legacyEntry as LeaseEntry;
          const tmpPath = join(dirPath, `${legacyStoryId}.migrate.${randomUUID().slice(0, 8)}.tmp`);
          const finalPath = recordPath(dirPath, legacyStoryId);
          staged.push({ tmpPath, finalPath });
          ops.writeTempFile(tmpPath, encodeEntry(entry));
          const tmpFd = ops.openFile(tmpPath, "r+");
          ops.fsyncFile(tmpFd);
          ops.closeFile(tmpFd);
        }

        // Phase 2: Publish — link all temp files (no-clobber)
        for (const { tmpPath, finalPath } of staged) {
          ops.hardLink(tmpPath, finalPath);
        }

        // Phase 3: fsync directory + cleanup temps
        const dirFd = ops.openFile(dirPath, "r");
        ops.fsyncFile(dirFd);
        ops.closeFile(dirFd);
        for (const { tmpPath } of staged) {
          try { ops.unlinkFile(tmpPath); } catch { /* best-effort */ }
        }

        // Phase 4: Retire legacy authority (BLOCK-1)
        // Rename to non-authoritative backup; parent-dir fsync.
        ops.renameFile(legacyPath, legacyPath + ".retired");
        const parentFd = ops.openFile(parentDir, "r");
        ops.fsyncFile(parentFd);
        ops.closeFile(parentFd);
      } catch (err) {
        // Rollback: unlink all successfully linked final paths + all temps + any residue
        for (const { finalPath } of staged) {
          try { if (existsSync(finalPath)) ops.unlinkFile(finalPath); } catch { /* best-effort */ }
        }
        for (const { tmpPath } of staged) {
          try { if (existsSync(tmpPath)) ops.unlinkFile(tmpPath); } catch { /* best-effort */ }
        }
        // Clean any residual temp files in the directory
        try {
          for (const e of readdirSync(dirPath)) {
            if (e.endsWith(".tmp")) {
              try { ops.unlinkFile(join(dirPath, e)); } catch { /* best-effort */ }
            }
          }
        } catch { /* best-effort */ }
        try { if (existsSync(dirPath)) rmdirSync(dirPath); } catch { /* best-effort */ }
        throw err;
      }
    } else {
      claimOps().mkdir(dirPath);
    }
  } else {
    // ═══ BLOCK-1: canonical dir exists — detect legacy coexistence ═══
    // If the legacy story-leases.json still exists alongside the canonical
    // directory, it's a split-brain / data-integrity condition. Fail-loud
    // and refuse any new claim until the legacy file is reconciled.
    const parentDir = dirname(dirPath);
    const legacyPath = join(parentDir, "story-leases.json");
    if (existsSync(legacyPath)) {
      const raw = readFileSync(legacyPath, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // BLOCK-2: malformed JSON in coexistence → fail-loud, no claim
        throw new Error(
          `Legacy lease file ${legacyPath} coexists with canonical lease directory ${dirPath} ` +
          `but contains invalid JSON. Manual reconciliation required.`,
        );
      }
      // BLOCK-2: validate root + every entry — null/scalar/array/invalid entry
      // all fail-loud rather than silently admitting a new claim
      const legacyMap = validateLegacyEntries(parsed, legacyPath);
      if (legacyMap[storyId] !== undefined) {
        const existing = legacyMap[storyId] as LeaseEntry;
        return {
          status: "exists",
          existingSource: existing.source,
          existingDelegationId: existing.delegationId,
        };
      }
      // Legacy has different stories — still fail-loud: coexistence is a
      // data integrity error requiring manual reconciliation.
      throw new Error(
        `Legacy lease file ${legacyPath} coexists with canonical lease directory ${dirPath}. ` +
        `Manual reconciliation required before new claims can proceed.`,
      );
    }
  }

  const rp = recordPath(dirPath, storyId);
  const tmpPath = join(dirPath, `${storyId}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`);
  const ops = claimOps();

  // Step 1: Write complete owner record to unique temp file
  ops.writeTempFile(tmpPath, encodeEntry(entry));

  // Step 2: fdatasync temp file (open with "r+" → file fsync, not directory)
  const tmpFd = ops.openFile(tmpPath, "r+");
  ops.fsyncFile(tmpFd);
  ops.closeFile(tmpFd);

  // Step 3: Hardlink — EEXIST means someone beat us
  try {
    ops.hardLink(tmpPath, rp);
  } catch (err: unknown) {
    // Clean up temp on any error
    try { ops.unlinkFile(tmpPath); } catch { /* best-effort */ }

    const code = (err as { code?: string }).code;
    if (code === "EEXIST") {
      // Another owner's hardlink exists — read their record for conflict info
      try {
        const existing = decodeEntry(readFileSync(rp, "utf8"));
        if (existing) {
          return {
            status: "exists",
            existingSource: existing.source,
            existingDelegationId: existing.delegationId,
          };
        }
      } catch {
        // Unreadable — treat as exists with unknown source
      }
      return { status: "exists", existingSource: "cycle" };
    }
    throw err;
  }

  // Step 4: fdatasync parent directory (open with "r" → directory fsync)
  const dirFd = ops.openFile(dirPath, "r");
  ops.fsyncFile(dirFd);
  ops.closeFile(dirFd);

  // Step 5: Remove temp file
  try { ops.unlinkFile(tmpPath); } catch { /* best-effort — the lease is already claimed */ }

  return { status: "claimed" };
}

/**
 * Release a story lease with identity match.
 *
 * Match-only contract:
 * - `source` must match the lease entry's source.
 * - For `host-delegation` source: `delegationId` AND `runId` must all match.
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
  dirPath: string,
  storyId: string,
  identity: ReleaseIdentity,
): boolean {
  const rp = recordPath(dirPath, storyId);
  if (!existsSync(rp)) return false;

  let existing: LeaseEntry;
  try {
    const raw = readFileSync(rp, "utf8");
    const decoded = decodeEntry(raw);
    if (decoded === null) return false;
    existing = decoded;
  } catch {
    return false;
  }

  // Source must match
  if (existing.source !== identity.source) return false;

  // For host-delegation: delegationId AND runId must both be non-empty and match.
  if (identity.source === "host-delegation") {
    if (!identity.delegationId || !identity.runId ||
        existing.delegationId !== identity.delegationId ||
        existing.runId !== identity.runId) {
      return false;
    }
  }

  // For cycle: pid is REQUIRED and must match
  if (identity.source === "cycle") {
    if (identity.pid === undefined) return false;
    if (existing.pid !== identity.pid) return false;
  }

  // Match confirmed — remove the record
  try {
    unlinkSync(rp);
    return true;
  } catch {
    // Unlink failed (permissions, already removed) — fail-loud
    return false;
  }
}

/**
 * Remove a single lease. Returns true when the key existed (and matched).
 *
 * `onlySource` scopes the removal: a terminating cycle passes "cycle" so it
 * can never wipe a HUMAN/supervisor claim that preempted the story mid-flight
 * — the soft-lease protection must survive the original cycle's terminal.
 */
export function removeLease(dirPath: string, storyId: string, onlySource?: LeaseSource): boolean {
  const rp = recordPath(dirPath, storyId);
  if (!existsSync(rp)) return false;

  if (onlySource !== undefined) {
    try {
      const existing = decodeEntry(readFileSync(rp, "utf8"));
      if (existing === null || existing.source !== onlySource) return false;
    } catch {
      return false;
    }
  }

  try {
    unlinkSync(rp);
    return true;
  } catch {
    return false;
  }
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
 * Clean dead PID leases from the lease directory.
 *
 * A lease whose pid is set but the process is no longer alive is stale — the
 * cycle that claimed it crashed or was killed without running its terminal
 * cleanup. Remove the lease so the story is not permanently blocked.
 *
 * Host-delegation leases are persistent host protocol leases (no pid)
 * and are NEVER cleaned by this function. Human/supervisor leases also
 * have no pid and are never cleaned.
 *
 * Returns the list of storyIds whose dead leases were cleaned (for alerting).
 */
export function cleanDeadLeases(dirPath: string): string[] {
  if (!existsSync(dirPath)) {

    // Try legacy fallback
    const parentDir = dirname(dirPath);
    const legacyPath = join(parentDir, "story-leases.json");
    if (existsSync(legacyPath)) {
      try {
        const raw = readFileSync(legacyPath, "utf8");
        const leases = JSON.parse(raw) as LeaseMap;
        const cleaned: string[] = [];
        for (const [id, entry] of Object.entries(leases)) {
          if (entry.pid !== undefined && entry.source !== "host-delegation" && !isPidAlive(entry.pid)) {
            delete leases[id];
            cleaned.push(id);
          }
        }
        if (cleaned.length > 0) {
          // Write back to legacy file AND migrate to directory
          if (Object.keys(leases).length === 0) {
            try { unlinkSync(legacyPath); } catch { /* best-effort */ }
          } else {
            writeFileSync(legacyPath, JSON.stringify(leases, null, 2) + "\n", "utf8");
          }
          // Also migrate surviving entries to directory
          mkdirSync(dirPath, { recursive: true });
          for (const [id, entry] of Object.entries(leases)) {
            setLease(dirPath, id, entry);
          }
        }
        return cleaned;
      } catch {
        return [];
      }
    }
    return [];
  }

  const cleaned: string[] = [];
  try {
    for (const entry of readdirSync(dirPath)) {
      if (!entry.endsWith(LEASE_EXT)) continue;
      const storyId = entry.slice(0, -LEASE_EXT.length);
      const rp = join(dirPath, entry);
      try {
        const raw = readFileSync(rp, "utf8");
        const decoded = decodeEntry(raw);
        if (decoded === null) continue;
        // Only clean cycle leases with dead PIDs.
        if (decoded.pid !== undefined && decoded.source !== "host-delegation" && !isPidAlive(decoded.pid)) {
          unlinkSync(rp);
          cleaned.push(storyId);
        }
      } catch {
        continue;
      }
    }
  } catch {
    return [];
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
