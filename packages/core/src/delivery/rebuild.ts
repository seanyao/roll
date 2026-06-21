/**
 * FIX-389a — Projection engine: rebuild deliveries.jsonl from runs+git facts.
 *
 * deliveries.jsonl is a REBUILDABLE CACHE — never independently authoritative.
 * The authoritative sources are:
 *   - git merges on main = `done` truth
 *   - runs.jsonl rows = `pending_merge` / intent truth
 *
 * This module provides:
 *   1. {@link RunFact} / {@link MergeFact} — the two fact types.
 *   2. {@link extractRunFact} / {@link parseMergeCommitMessages} — fact parsers.
 *   3. {@link rebuildDeliveriesFromFacts} — the pure, deterministic projection.
 *
 * AC1: rebuild is deterministic and idempotent.
 * AC2: delete deliveries.jsonl → rebuild → same result.
 * AC4: no separate backfill script needed; first rebuild covers all history.
 * AC7: genuinely not-delivered cards stay todo (no false positives).
 */
import type { DeliveryRecord, FactOr } from "@roll/spec";
import { present, absent } from "@roll/spec";
import type { RunRow } from "../events/bus.js";

// ── Fact types ───────────────────────────────────────────────────────────────

/** One run row's delivery-relevant fields, extracted from runs.jsonl. */
export interface RunFact {
  storyId: string;
  cycleId: string;
  /** Raw status field from the run row (e.g. "built", "published", "merged"). */
  status: string;
  /** Terminal outcome field (e.g. "delivered", "published_pending_merge", "failed"). */
  outcome: string;
  /** PR number, when the run published one. */
  prNumber?: number;
  /** Merge commit SHA, when the backfill already stamped it. */
  mergeCommit?: string;
  /** Merge timestamp (epoch ms), when the backfill stamped it. */
  mergedAt?: number;
  /** When this run was recorded (epoch ms). */
  recordedAt: number;
}

/** One PR merge on main, extracted from git log. */
export interface MergeFact {
  /** PR number (parsed from "Merge pull request #N …" or "(#N)"). */
  prNumber: number;
  /** Merge commit SHA on main. */
  mergeCommit: string;
  /** Merge timestamp (epoch seconds from git commit date). */
  mergedAt: number;
}

// ── Fact extractors ──────────────────────────────────────────────────────────

/**
 * Extract a {@link RunFact} from a lenient runs.jsonl row.
 *
 * Reads `story_id`/`routed_story`, `cycle_id`, `status`, `outcome`,
 * `pr_number`, `merge_commit`, `merged_at`, and `ts`. Returns `null` when
 * the row lacks a story+cycle identity.
 */
export function extractRunFact(row: RunRow): RunFact | null {
  const storyId = (row["story_id"] ?? row["routed_story"] ?? row["storyId"]) as string | undefined;
  const cycleId = (row["cycle_id"] ?? row["cycleId"]) as string | undefined;
  if (typeof storyId !== "string" || storyId.trim() === "") return null;
  if (typeof cycleId !== "string" || cycleId.trim() === "") return null;

  const prNum = row["pr_number"] ?? row["prNumber"];
  const mergeCommit = row["merge_commit"] ?? row["mergeCommit"];

  // mergedAt: number (epoch ms) or ISO string (from older backfill stamps)
  const mergedAtRaw = row["merged_at"] ?? row["mergedAt"];
  let mergedAt: number | undefined;
  if (typeof mergedAtRaw === "number" && Number.isFinite(mergedAtRaw)) {
    mergedAt = mergedAtRaw;
  } else if (typeof mergedAtRaw === "string") {
    const ms = Date.parse(mergedAtRaw);
    if (Number.isFinite(ms)) mergedAt = ms;
  }

  const ts = row["ts"] ?? row["recordedAt"];
  let recordedAt = 0;
  if (typeof ts === "string") {
    const ms = Date.parse(ts);
    if (Number.isFinite(ms)) recordedAt = ms;
  } else if (typeof ts === "number" && Number.isFinite(ts)) {
    recordedAt = ts;
  }

  return {
    storyId: storyId.trim(),
    cycleId: cycleId.trim(),
    status: typeof row["status"] === "string" ? row["status"] : "",
    outcome: typeof row["outcome"] === "string" ? row["outcome"] : "",
    prNumber: typeof prNum === "number" ? prNum : undefined,
    mergeCommit: typeof mergeCommit === "string" && mergeCommit !== "" ? mergeCommit : undefined,
    mergedAt,
    recordedAt,
  };
}

/**
 * Parse `git log --first-parent --merges --format='%H %ct %s'` output into
 * {@link MergeFact} array.
 *
 * Recognises merge commit subjects:
 *   - "Merge pull request #N from …" (GitHub merge button)
 *   - Any subject with "(#N)" (squash-merge)
 *
 * Last match per prNumber wins (git log is reverse-chronological, so the
 * first occurrence is newest).
 */
export function parseMergeCommitMessages(lines: string[]): MergeFact[] {
  const map = new Map<number, MergeFact>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    // Format: "<sha> <epoch_sec> <subject>"
    const firstSpace = trimmed.indexOf(" ");
    if (firstSpace < 0) continue;
    const secondSpace = trimmed.indexOf(" ", firstSpace + 1);
    if (secondSpace < 0) continue;

    const sha = trimmed.slice(0, firstSpace);
    const tsStr = trimmed.slice(firstSpace + 1, secondSpace);
    const subject = trimmed.slice(secondSpace + 1);

    const mergedAt = Number(tsStr);
    if (!Number.isFinite(mergedAt) || mergedAt <= 0) continue;

    // "Merge pull request #N …"
    let prNum: number | undefined;
    const mergeMatch = /^Merge pull request #(\d+)/i.exec(subject);
    if (mergeMatch) {
      prNum = Number(mergeMatch[1]);
    } else {
      // Squash-merge "(#N)" anywhere in the subject
      const squashMatch = /\(#(\d+)\)/.exec(subject);
      if (squashMatch) prNum = Number(squashMatch[1]);
    }

    if (prNum === undefined || !Number.isFinite(prNum) || prNum <= 0) continue;

    // First occurrence wins (reverse-chronological input)
    if (!map.has(prNum)) {
      map.set(prNum, { prNumber: prNum, mergeCommit: sha, mergedAt });
    }
  }

  return [...map.values()];
}

// ── Projection core ──────────────────────────────────────────────────────────

/**
 * Pure, deterministic projection: runs + git merges → DeliveryRecord[].
 *
 * Rules (AC1, AC4, AC7):
 *   - Per story, latest run wins.
 *   - If ANY run's PR is merged on main → lifecycleState: "done".
 *   - Else if latest run has outcome "published_pending_merge" → "in_flight".
 *   - Else if latest run has terminal outcome → that lifecycleState.
 *   - Otherwise → no record emitted (= todo).
 *
 * @param runs - RunFact[] extracted from runs.jsonl.
 * @param merges - MergeFact[] from git log on main.
 * @param repoSlug - Optional "owner/repo" for constructing prUrl.
 * @returns Deterministic DeliveryRecord[] — one per delivered/in-flight story.
 */
export function rebuildDeliveriesFromFacts(
  runs: RunFact[],
  merges: MergeFact[],
  repoSlug?: string,
): DeliveryRecord[] {
  // Index merges by prNumber AND by mergeCommit SHA for cross-reference
  const mergeByPr = new Map<number, MergeFact>();
  const mergeBySha = new Map<string, MergeFact>();
  for (const m of merges) {
    mergeByPr.set(m.prNumber, m);
    mergeBySha.set(m.mergeCommit, m);
  }

  // Group runs by storyId
  const byStory = new Map<string, RunFact[]>();
  for (const r of runs) {
    const existing = byStory.get(r.storyId);
    if (existing) {
      existing.push(r);
    } else {
      byStory.set(r.storyId, [r]);
    }
  }

  const result: DeliveryRecord[] = [];

  for (const [storyId, storyRuns] of byStory) {
    // Sort by recordedAt descending — latest first
    storyRuns.sort((a, b) => b.recordedAt - a.recordedAt);
    const latest = storyRuns[0]!;

    // 1. Check if this story has a merged PR — the authoritative done signal.
    let mergedFact: MergeFact | undefined;
    let mergedPrNumber: number | undefined;
    for (const r of storyRuns) {
      // If the run already has merge data (from backfill), treat as merged
      if (r.mergeCommit !== undefined) {
        // Try to find prNumber: from run first, then git SHA lookup
        if (r.prNumber !== undefined) {
          mergedPrNumber = r.prNumber;
        } else {
          const shaMatch = mergeBySha.get(r.mergeCommit);
          if (shaMatch) mergedPrNumber = shaMatch.prNumber;
        }
        mergedFact = {
          prNumber: mergedPrNumber ?? 0,
          mergeCommit: r.mergeCommit,
          mergedAt: r.mergedAt !== undefined ? Math.floor(r.mergedAt / 1000) : 0,
        };
        break;
      }
      // Or if the run's PR number matches a git merge
      if (r.prNumber !== undefined) {
        const m = mergeByPr.get(r.prNumber);
        if (m) {
          mergedPrNumber = r.prNumber;
          mergedFact = m;
          break;
        }
      }
    }

    // Done when: (a) merge evidence exists AND (b) either we have a prNumber or
    // we at least have a mergeCommit (done-without-PR is legal for backfilled history).
    if (mergedFact !== undefined &&
        (mergedFact.prNumber > 0 || mergedFact.mergeCommit !== "")) {
      const fact: MergeFact = mergedFact; // narrow for strict TS
      const effectivePr = fact.prNumber > 0 ? fact.prNumber : mergedPrNumber;
      const prUrl = effectivePr !== undefined && effectivePr > 0 && repoSlug !== undefined
        ? `https://github.com/${repoSlug}/pull/${effectivePr}`
        : undefined;
      result.push({
        storyId,
        cycleId: latest.cycleId,
        lifecycleState: "done",
        prNumber: effectivePr !== undefined && effectivePr > 0
          ? present(effectivePr)
          : absent("no_publish_attempted"),
        prUrl: prUrl !== undefined ? present(prUrl) : absent("not_recorded"),
        mergedAt: fact.mergedAt > 0
          ? present(fact.mergedAt * 1000)
          : absent("not_recorded"),
        mergeCommit: present(fact.mergeCommit),
        recordedAt: fact.mergedAt > 0 ? fact.mergedAt * 1000 : latest.recordedAt,
      });
      continue;
    }

    // 2. Not merged — derive lifecycle from the latest run's terminal outcome.
    const outcome = latest.outcome;
    let lifecycle: DeliveryRecord["lifecycleState"];

    if (outcome === "published_pending_merge") {
      lifecycle = "in_flight";
    } else if (outcome === "failed") {
      lifecycle = "failed";
    } else if (outcome === "blocked") {
      lifecycle = "blocked";
    } else if (outcome === "delivered") {
      // delivered without merge evidence is unusual but possible (e.g. pre-PR era)
      lifecycle = "done";
    } else if (outcome === "aborted_no_delivery" || outcome === "gave_up") {
      lifecycle = "failed";
    } else if (outcome === "aborted_with_delivery") {
      lifecycle = "in_flight";
    } else if (outcome === "orphan_timeout") {
      lifecycle = "blocked";
    } else if (outcome === "idle_no_work") {
      // idle = nothing happened, no record emitted
      continue;
    } else {
      // unknown / unrecognised outcome → skip (no record)
      continue;
    }

    const hasPr = latest.prNumber !== undefined;
    const prUrl = hasPr && repoSlug !== undefined
      ? `https://github.com/${repoSlug}/pull/${latest.prNumber}`
      : undefined;

    result.push({
      storyId,
      cycleId: latest.cycleId,
      lifecycleState: lifecycle,
      prNumber: hasPr ? present(latest.prNumber!) : absent("no_publish_attempted"),
      prUrl: prUrl !== undefined ? present(prUrl) : absent("not_recorded"),
      mergedAt: absent("not_recorded"),
      mergeCommit: absent("not_recorded"),
      recordedAt: latest.recordedAt,
    });
  }

  return result;
}
