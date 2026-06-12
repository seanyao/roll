/**
 * US-DOSSIER-010 — TruthSnapshot: the ONE machine-readable truth aggregate.
 *
 * Every surface (web dossier, CLI status, brief, downstream tools) consumes
 * the SAME aggregation: `roll index` computes one snapshot, embeds it in
 * index.html and writes it as truth.json next to it — the same object, the
 * same serialization, so a number can never differ between surfaces (the
 * FIX-248 "14 failures rendered as 0" class becomes structurally impossible).
 */

/** The story state spectrum — the index page's six-state vocabulary. */
export type TruthSpectrumState = "done" | "wip" | "hold" | "todo" | "fail" | "unknown";
export const TRUTH_SPECTRUM_STATES: readonly TruthSpectrumState[] = ["done", "wip", "hold", "todo", "fail", "unknown"];

export interface TruthSnapshotStory {
  total: number;
  /** Count per spectrum state; sums to total. */
  spectrum: Record<TruthSpectrumState, number>;
  /** Delivered pre-v3 with no v3 evidence trail (US-DOSSIER-008). */
  legacy: number;
}

export interface TruthSnapshotAudit {
  fail: number;
  warn: number;
  unknown: number;
  collectedAt?: string;
}

export interface TruthSnapshotCycle {
  cycles3d: number;
  /** Failures are first-class: failed + blocked + reverted/aborted — never swallowed. */
  failed3d: number;
  costUsd3d: number;
  collectedAt?: string;
}

export type TruthSnapshotVerdict = "pass" | "warn" | "fail" | "unknown";

export interface TruthSnapshotRelease {
  latestTag?: string;
  verdict: TruthSnapshotVerdict;
  waiver?: string;
  collectedAt?: string;
}

export interface TruthSnapshot {
  generatedAt: string;
  collectedAt?: string;
  story: TruthSnapshotStory;
  audit?: TruthSnapshotAudit;
  cycle?: TruthSnapshotCycle;
  release?: TruthSnapshotRelease;
}

/** The ONE serialization both index.html's embed and truth.json carry. */
export function serializeTruthSnapshot(s: TruthSnapshot): string {
  return `${JSON.stringify(s, null, 2)}\n`;
}
