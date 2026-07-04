/**
 * Story lease — who claimed the card and when.
 *
 * FIX-1211: a lease distinguishes "the loop picked this" from "a human (or
 * another loop instance) preempted this". The picker rejects In Progress rows
 * regardless, but the UNSTICK/reclaim path consults leases:
 *
 *   1. A story WITH a loop lease and a dead PID -> eligible for death-recovery
 *      (the original starvation-prevention semantics).
 *   2. A story WITHOUT any lease -> human-preempted. The picker rejects it for
 *      24h (soft lease), after which an expiry reconcile may downgrade to Todo.
 *
 * Leases live at `.roll/loop/story-leases.json`, a gitignored runtime file.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** How long a human-preempted (leaseless) In Progress row is respected. */
export const HUMAN_SOFT_LEASE_HOURS = 24;

/** Recognised claim sources. */
export type LeaseSource = "cycle" | "human" | "supervisor";

/** A lease entry — who claimed a story and when. */
export interface LeaseEntry {
  /** Process id of the claiming agent (or undefined for human/supervisor). */
  pid?: number;
  /** Epoch ms of the claim. */
  claimedAt: number;
  /** Who claimed it. */
  source: LeaseSource;
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

/** Remove a single lease. Returns true when the key existed. */
export function removeLease(path: string, storyId: string): boolean {
  const leases = readLeases(path);
  if (!(storyId in leases)) return false;
  delete leases[storyId];
  writeLeases(path, leases);
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
