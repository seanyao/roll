/**
 * US-OBS-020 — DossierFrame wire contract.
 *
 * The ONE typed envelope shared by the daemon (emitter) and web (consumer),
 * built ON the existing RollEvent and TruthSnapshot — never redefining either.
 * A discriminated union of heavy `snapshot` frames (full TruthSnapshot + ETag,
 * debounced ~30s) and light `heartbeat` frames (liveness only, timer-driven).
 * No diff/patch protocol — the contract is full-snapshot + heartbeat only.
 */

import type { RollEvent } from "./events.js";
import type { TruthSnapshot } from "./truth-snapshot.js";

/** Project identity carried in every frame so consumers know who this is about. */
export interface ProjectIdentity {
  /** Stable git-remote slug (remote→normalize→lowercase→md5[:6], path fallback). */
  slug: string;
  /** Absolute project path (the runtime-dir root). */
  path: string;
  /** reachableProjects() applied AT SERVE TIME (FIX-376 killer). */
  reachable: boolean;
}

/** Per-collector degradation note when a surface couldn't be collected. */
export interface DegradedNote {
  surface: string;
  reason: string;
}

/**
 * Heavy: the full derived projection.
 * Pushed on-change, debounced (~30s TTL) so clients aren't spammed on every file write.
 */
export interface DossierSnapshotFrame {
  kind: "snapshot";
  project: ProjectIdentity;
  /** The EXACT shape baked into index.html / truth.json — verbatim TruthSnapshot. */
  snapshot: TruthSnapshot;
  /** Epoch ms — drives the freshness banner on the consumer. */
  collectedAt: number;
  /** hash(snapshot) — client skips re-render if the ETag is unchanged. */
  etag: string;
  /** Per-collector failures (status: 'paused' / 'unknown'), absent when all collectors succeeded. */
  degraded?: DegradedNote[];
}

/**
 * Light: liveness only, pushed frequently on a timer.
 * NEVER carries heavy snapshot state — the heartbeat is cheap by construction.
 */
export interface DossierHeartbeatFrame {
  kind: "heartbeat";
  project: ProjectIdentity;
  /**
   * Computed from live.log mtime using existing liveness constants
   * (LIVE_FEED_FRESH_SEC=300, ActivitySignal beat=45s, cycle-observer beat=180s).
   * No fourth constant invented.
   */
  liveness: "live" | "idle" | "paused" | "not-configured";
  /** Epoch ms of live.log mtime, or null when no live.log exists. */
  liveFeedMtime: number | null;
  /** Optional small tail of raw RollEvents since last frame. Agent-agnostic
   *  normalization boundary stays at the web layer (normalizerFor()). */
  recentEvents?: RollEvent[];
  /** Epoch ms, timer-driven (45s) — alive-but-silent ≠ dead. */
  ts: number;
}

/** Discriminated union: every frame carries a `kind` discriminant. */
export type DossierFrame = DossierSnapshotFrame | DossierHeartbeatFrame;

/**
 * Deep-sort object keys for deterministic serialization.
 * Recursively sorts keys at every level so structurally equal objects
 * produce byte-identical JSON regardless of property insertion order.
 */
function deepSortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(deepSortKeys);
  const rec = obj as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(rec).sort()) {
    sorted[key] = deepSortKeys(rec[key]);
  }
  return sorted;
}

/**
 * Deterministic hash of a TruthSnapshot for ETag-based change detection.
 *
 * Stable across two serializations of an equal snapshot; differs when the
 * snapshot changes. Uses deep-sorted-key JSON serialization so structurally
 * equal snapshots produce the same ETag regardless of property order.
 */
export function hashSnapshot(snapshot: TruthSnapshot): string {
  // Deep-sort keys for determinism across structurally-equal objects.
  const stable = JSON.stringify(deepSortKeys(snapshot));
  // djb2 hash — sufficient for ETag change detection, portable across runtimes.
  let hash = 5381;
  for (let i = 0; i < stable.length; i++) {
    hash = ((hash << 5) + hash + stable.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Type guard: narrows a DossierFrame to DossierSnapshotFrame via `kind`. */
export function isSnapshotFrame(frame: DossierFrame): frame is DossierSnapshotFrame {
  return frame.kind === "snapshot";
}

/** Type guard: narrows a DossierFrame to DossierHeartbeatFrame via `kind`. */
export function isHeartbeatFrame(frame: DossierFrame): frame is DossierHeartbeatFrame {
  return frame.kind === "heartbeat";
}
