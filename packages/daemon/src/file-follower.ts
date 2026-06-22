/**
 * US-OBS-021 AC2/AC4 — FileFollower: watches loop event files and emits
 * DossierFrame snapshots (debounced ~30s) and heartbeats (45s timer).
 *
 * Tail semantics: watches the loop dir for changes to watched files,
 * re-reads on rotation (new inode / shrink). Tolerant of torn lines
 * (parseEventLine returns null → skipped) and collector throws
 * (surface marked degraded, frame still pushed).
 */
import { watch, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { FSWatcher } from "node:fs";
import type {
  DossierFrame,
  DossierSnapshotFrame,
  DossierHeartbeatFrame,
  DegradedNote,
  ProjectIdentity,
  TruthSnapshot,
} from "@roll/spec";
import { hashSnapshot } from "@roll/spec";
import { collectDossierState } from "@roll/core";

export interface FileFollowerOptions {
  /** Project root directory (cwd). */
  cwd: string;
  /** Snapshot debounce interval in ms. Default 30_000. */
  snapshotTtlMs?: number;
  /** Heartbeat interval in ms. Default 45_000. */
  heartbeatMs?: number;
  /** Callback invoked for every frame to broadcast. */
  onFrame: (frame: DossierFrame) => void;
}

/** Files watched in the loop runtime dir. */
const WATCHED_FILES = [
  "events.ndjson",
  "runs.jsonl",
  "agents.yaml",
  "live.log",
] as const;

export class FileFollower {
  private readonly cwd: string;
  private readonly loopDir: string;
  private readonly snapshotTtlMs: number;
  private readonly heartbeatMs: number;
  private readonly onFrame: (frame: DossierFrame) => void;
  private readonly projectIdentity: ProjectIdentity;

  private watcher: FSWatcher | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEtag: string | null = null;
  private running = false;

  constructor(opts: FileFollowerOptions) {
    this.cwd = opts.cwd;
    this.loopDir = join(opts.cwd, ".roll", "loop");
    this.snapshotTtlMs = opts.snapshotTtlMs ?? 30_000;
    this.heartbeatMs = opts.heartbeatMs ?? 45_000;
    this.onFrame = opts.onFrame;
    this.projectIdentity = {
      slug: this.computeSlug(),
      path: opts.cwd,
      reachable: true,
    };
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  /** Start watching files and begin emitting frames. Emits initial snapshot before accepting. */
  start(): void {
    if (this.running) return;
    this.running = true;

    // AC3: rebuild snapshot from event files on every daemon start, never persisted.
    this.emitSnapshot();

    // Watch the loop directory for file changes (tail -F semantics).
    // Gracefully handle missing loop dir — emit degraded snapshot, don't crash.
    try {
      this.watcher = watch(
        this.loopDir,
        { persistent: true },
        (_eventType, filename) => {
          if (
            filename &&
            (WATCHED_FILES as readonly string[]).includes(filename)
          ) {
            this.onFileChange();
          }
        },
      );
      this.watcher.on("error", () => {
        // Watcher error (e.g. directory deleted) — silently tolerate;
        // the heartbeat timer still runs so clients see liveness change.
      });
    } catch {
      // Loop dir does not exist yet — heartbeat still runs.
      // Snapshot is emitted once on start regardless.
    }

    // AC2: periodic heartbeat (45s timer-driven).
    this.heartbeatTimer = setInterval(() => {
      this.emitHeartbeat();
    }, this.heartbeatMs);
    // Fire an immediate heartbeat so a freshly-started daemon broadcasts liveness.
    this.emitHeartbeat();
  }

  /** Stop watching and clear all timers. */
  stop(): void {
    this.running = false;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // ── private ────────────────────────────────────────────────────────────

  private computeSlug(): string {
    const parts = this.cwd.split("/");
    return parts[parts.length - 1] ?? "unknown";
  }

  private onFileChange(): void {
    if (!this.running) return;
    // Debounce snapshot emission (~30s TTL, AC2).
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.emitSnapshot();
    }, this.snapshotTtlMs);
  }

  /** AC3: in-memory snapshot rebuilt from event files, never persisted to disk. */
  private emitSnapshot(): void {
    try {
      const snapshot = collectDossierState(this.cwd);
      const etag = hashSnapshot(snapshot);

      // AC2: suppress unchanged etag pushes.
      if (etag === this.lastEtag) return;
      this.lastEtag = etag;

      const frame: DossierSnapshotFrame = {
        kind: "snapshot",
        project: this.projectIdentity,
        snapshot,
        collectedAt: Date.now(),
        etag,
      };
      this.onFrame(frame);
    } catch (err) {
      // AC4: single collector throw → surface marked degraded, frame still pushed.
      const degraded: DegradedNote[] = [
        {
          surface: "collectDossierState",
          reason: err instanceof Error ? err.message : String(err),
        },
      ];
      const snapshot = this.emptySnapshot();
      const frame: DossierSnapshotFrame = {
        kind: "snapshot",
        project: this.projectIdentity,
        snapshot,
        collectedAt: Date.now(),
        etag: `degraded-${Date.now()}`,
        degraded,
      };
      this.onFrame(frame);
    }
  }

  private emitHeartbeat(): void {
    if (!this.running) return;
    const liveness = this.computeLiveness();
    const frame: DossierHeartbeatFrame = {
      kind: "heartbeat",
      project: this.projectIdentity,
      liveness,
      liveFeedMtime: this.getLiveLogMtime(),
      ts: Date.now(),
    };
    this.onFrame(frame);
  }

  /** Compute liveness from live.log mtime using existing constants. */
  private computeLiveness(): DossierHeartbeatFrame["liveness"] {
    try {
      const livePath = join(this.loopDir, "live.log");
      if (!existsSync(livePath)) return "not-configured";
      const stat = statSync(livePath);
      const age = Date.now() - stat.mtimeMs;
      // LIVE_FEED_FRESH_SEC=300, ActivitySignal beat=45s, cycle-observer beat=180s.
      if (age < 45_000) return "live";
      if (age < 180_000) return "idle";
      return "paused";
    } catch {
      return "not-configured";
    }
  }

  private getLiveLogMtime(): number | null {
    try {
      const livePath = join(this.loopDir, "live.log");
      if (!existsSync(livePath)) return null;
      return statSync(livePath).mtimeMs;
    } catch {
      return null;
    }
  }

  private emptySnapshot(): TruthSnapshot {
    return {
      generatedAt: new Date().toISOString(),
      story: {
        total: 0,
        spectrum: { done: 0, wip: 0, hold: 0, todo: 0, fail: 0, unknown: 0 },
        legacy: 0,
      },
    };
  }
}
