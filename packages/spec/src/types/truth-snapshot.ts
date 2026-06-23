/**
 * US-DOSSIER-010 — TruthSnapshot: the ONE machine-readable truth aggregate.
 *
 * Every surface (web dossier, CLI status, downstream tools) consumes
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

/**
 * US-DOSSIER-020 — the claimed→merged→attested delivery ladder.
 *
 * Replaces the binary done/not-done with a three-rung truth ladder, the core
 * interaction of the Delivery Dossier web console:
 *   - `claimed`   — the backlog says done (weakest; may be drift).
 *   - `merged`    — merge evidence on main (FIX-278 `storyHasMergeEvidence`).
 *   - `attested`  — every AC proven with appropriate evidence; observable/UI
 *                   ACs carry a real screenshot, test-shaped ACs carry test/PR
 *                   chips. "Merged but not attested" is its own honest middle
 *                   rung, never full green.
 * Consumed by the truth snapshot's per-story registry (US-DOSSIER-021) and the
 * story/epic spine + per-AC blocks (US-DOSSIER-023/024/025).
 */
export type DeliveryLadder = "claimed" | "merged" | "attested";
export const DELIVERY_LADDER: readonly DeliveryLadder[] = ["claimed", "merged", "attested"];

/**
 * US-DOSSIER-020 — per-story evidence presence flags that back the ladder's
 * `attested` rung and the per-AC evidence blocks. Presence only — never the
 * agent's claim: each flag is set from a real artifact on disk.
 */
export interface StoryEvidenceFlags {
  /** a `latest/<ID>-report.html` attest report exists. */
  report: boolean;
  /** an `ac-map.json` exists for the story. */
  acMap: boolean;
  /** at least one real-pixel screenshot / cast under `latest/` (US-ATTEST-010). */
  visualEvidence: boolean;
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
  /** FIX-361: cost separated by native currency so display never blindly sums ¥+$. */
  costByCurrency3d?: Record<string, number>;
  collectedAt?: string;
}

export type TruthSnapshotVerdict = "pass" | "warn" | "fail" | "unknown";

export interface TruthSnapshotRelease {
  latestTag?: string;
  verdict: TruthSnapshotVerdict;
  waiver?: string;
  collectedAt?: string;
}

/** One scheduled lane on this machine (US-DOSSIER-011 loop heartbeat). */
export interface TruthSnapshotLoopLane {
  name: string;
  /** Where this lane came from; additive for older snapshots. */
  source?: "launchd" | "goal";
  /** Installed and scheduled (the launchd plist exists). */
  running: boolean;
  mode?: string;
  /** Human-readable status for non-launchd lanes such as `roll loop go`. */
  status?: string;
  /** Human-readable goal scope when this lane represents a go session. */
  scope?: string;
  /** Schedule period in minutes. */
  everyMin?: number;
  lastAt?: string;
  nextAt?: string;
}

export interface TruthSnapshotLoop {
  lanes: TruthSnapshotLoopLane[];
  collectedAt?: string;
}

export interface TruthSnapshotOnDeckRow {
  id: string;
  epic: string;
  title: string;
  href: string;
}

export interface TruthSnapshotOnDeck {
  count: number;
  rows: TruthSnapshotOnDeckRow[];
}

/**
 * US-DOSSIER-021 — one per-story registry row carried by the ONE snapshot.
 *
 * The aggregate `TruthSnapshotStory` answers "how many at each spectrum state";
 * this answers "which card walked to which rung, and why" — the structured fact
 * the Delivery Dossier todo spine (claim → merged → attested) and the release
 * lane both need, written once into truth.json and embedded verbatim in
 * index.html so web and machine read the same ladder.
 *   - `ladder`   — the highest rung reached: `attested` (merged + full evidence)
 *                  > `merged` (merge truth, FIX-278) > `claimed` (backlog Done,
 *                  no merge) > `"none"` (not even claimed done).
 *   - `evidence` — the presence flags backing the `attested` rung (report /
 *                  ac-map / a real-pixel screenshot), each set from a real
 *                  artifact on disk, never the agent's claim.
 *   - `truthState` / `truthReason` — the spectrum verdict + closed reason code
 *                  (the same selector signal the aggregate folds).
 *   - `legacy`   — a pre-v3 delivery with no v3 evidence trail (US-DOSSIER-008),
 *                  per-row so the aggregate `story.legacy` sums to it.
 */
export interface TruthSnapshotStoryEntry {
  id: string;
  epic: string;
  ladder: DeliveryLadder | "none";
  evidence: StoryEvidenceFlags;
  truthState: TruthSpectrumState;
  truthReason?: string;
  legacy: boolean;
}

export interface TruthSnapshot {
  generatedAt: string;
  collectedAt?: string;
  story: TruthSnapshotStory;
  audit?: TruthSnapshotAudit;
  cycle?: TruthSnapshotCycle;
  release?: TruthSnapshotRelease;
  loop?: TruthSnapshotLoop;
  /** US-OBS-018 — queued picks computed from backlog Todo rows as primary truth,
   *  with story folders used only to provide card deep-links. */
  onDeck?: TruthSnapshotOnDeck;
  /** US-DOSSIER-021 — the per-story delivery-ladder + evidence registry. Optional
   *  and additive: older consumers and snapshots minted before this story stay
   *  valid (a snapshot without it serializes byte-identically to before). */
  stories?: TruthSnapshotStoryEntry[];
}

/** The ONE serialization both index.html's embed and truth.json carry. */
export function serializeTruthSnapshot(s: TruthSnapshot): string {
  return `${JSON.stringify(s, null, 2)}\n`;
}
