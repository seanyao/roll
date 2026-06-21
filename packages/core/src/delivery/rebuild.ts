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
import type { ExecPort } from "./infra-default.js";
import { RUNS_FILE } from "../events/bus.js";
import { deliveriesPath } from "./store.js";
import { join } from "node:path";

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

// ── Collection helpers (orchestration utilities) ─────────────────────────────

/**
 * Parse runs.jsonl raw text into {@link RunFact} array.
 *
 * Each line is JSON-parsed and passed to {@link extractRunFact}.
 * Bad JSON / unparseable lines and rows without story+cycle identity
 * are silently skipped.
 */
export function collectRunFacts(runsJsonlText: string): RunFact[] {
  const facts: RunFact[] = [];
  for (const line of runsJsonlText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let row: unknown;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue; // skip bad JSON silently
    }
    if (row === null || typeof row !== "object") continue;
    const fact = extractRunFact(row as RunRow);
    if (fact !== null) facts.push(fact);
  }
  return facts;
}

// ── Freshness gate + rebuild orchestration ───────────────────────────────────

/**
 * Minimal port for mtime + read/write of the two JSONL files.
 *
 * Separated from {@link DeliveryStoreInterface} because the freshness gate
 * needs overwrite semantics (rebuild replaces the cache file) while the
 * store's append-only contract intentionally does not have a delete/truncate
 * method — rebuilding is the ONE sanctioned overwrite path.
 */
export interface FreshnessPort {
  /**
   * Return the file's mtime in epoch milliseconds, or `undefined` when the
   * file does not exist or the stat fails.
   */
  mtimeMs(absPath: string): number | undefined;
  /**
   * Read the full file as UTF-8 text.
   *
   * @returns The file content, or `""` when the file does not exist.
   */
  readText(absPath: string): string;
  /**
   * Overwrite (truncate + write) the full file with `text`.
   *
   * Creates parent directories and the file itself as needed.
   */
  writeText(absPath: string, text: string): void;
}

/**
 * Ensure `deliveries.jsonl` is a fresh projection from runs+git facts.
 *
 * **AC2**: if deliveries.jsonl is older than runs.jsonl (or missing entirely),
 * rebuild it deterministically from the two authoritative sources:
 *   1. `runs.jsonl` rows (intent / `pending_merge` truth)
 *   2. `git log --first-parent --merges` on main (`done` truth)
 *
 * Otherwise the cache is fresh and this is a no-op.
 *
 * The caller must provide:
 *   - `projectRoot` — absolute path to the git working tree
 *   - `freshness` — mtime + read/write port (typically `node:fs` wrappers)
 *   - `exec` — for `git log` and `git remote` (typically `nodeExecPort`)
 *
 * @returns The (possibly rebuilt) DeliveryRecord array.
 */
export function ensureDeliveriesFresh(
  projectRoot: string,
  freshness: FreshnessPort,
  exec: ExecPort,
): DeliveryRecord[] {
  const runsPath = join(projectRoot, ".roll", "loop", RUNS_FILE);
  const delPath = deliveriesPath(projectRoot);

  // ── 1. Freshness check ──────────────────────────────────────────────────
  const runsMtime = freshness.mtimeMs(runsPath) ?? 0;
  const delMtime = freshness.mtimeMs(delPath) ?? 0;

  if (delMtime > 0 && delMtime >= runsMtime) {
    // Cache is fresh — read and return without rebuild.
    return parseDeliveriesFromText(freshness.readText(delPath));
  }

  // ── 2. Rebuild from facts ───────────────────────────────────────────────
  // 2a. Collect run facts
  const runsText = freshness.readText(runsPath);
  const runs = collectRunFacts(runsText);

  // 2b. Collect git merge facts from main (the authoritative done source).
  // Must target `main` explicitly — the worktree may be on a feature branch
  // whose history does not include the merges we need.
  //
  // Two passes:
  //   (a) `--merges` for GitHub merge-button commits ("Merge pull request #N")
  //   (b) without `--merges` for squash-merge commits with "(#N)" in subject
  let merges: MergeFact[] = [];
  const seenPrs = new Set<number>();

  // Pass (a): standard merge commits
  const gitLog = exec.run("git", [
    "-C", projectRoot,
    "log", "--first-parent", "main", "--merges",
    "--format=%H %ct %s",
  ]);
  if (gitLog.code === 0 && gitLog.stdout !== "") {
    const parsed = parseMergeCommitMessages(gitLog.stdout.split("\n"));
    for (const m of parsed) seenPrs.add(m.prNumber);
    merges.push(...parsed);
  }

  // Pass (b): squash-merge commits (any commit with "(#N)")
  const squashLog = exec.run("git", [
    "-C", projectRoot,
    "log", "--first-parent", "main",
    "--format=%H %ct %s",
  ]);
  if (squashLog.code === 0 && squashLog.stdout !== "") {
    for (const line of squashLog.stdout.split("\n")) {
      if (/\(#\d+\)/.test(line) && !/^Merge pull request #\d+/.test(line)) {
        const parsed = parseMergeCommitMessages([line]);
        for (const m of parsed) {
          if (!seenPrs.has(m.prNumber)) {
            seenPrs.add(m.prNumber);
            merges.push(m);
          }
        }
      }
    }
  }

  // 2c. Derive repo slug
  let repoSlug: string | undefined;
  const remote = exec.run("git", ["-C", projectRoot, "remote", "get-url", "origin"]);
  if (remote.code === 0 && remote.stdout !== "") {
    repoSlug = ghRepoSlugFromUrl(remote.stdout);
  }

  // 2d. Project
  const records = rebuildDeliveriesFromFacts(runs, merges, repoSlug);

  // 2e. Persist cache
  const output = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  freshness.writeText(delPath, output);

  return records;
}

/**
 * Inline slug-from-url parser — mirrors `@roll/infra` `ghRepoSlug` but keeps
 * the core rebuild module dependency-free (zero infra imports).
 */
function ghRepoSlugFromUrl(originUrl: string): string | undefined {
  let url = originUrl.trim();
  if (url.startsWith("git@github.com:")) url = url.slice("git@github.com:".length);
  else if (url.startsWith("ssh://git@github.com/")) url = url.slice("ssh://git@github.com/".length);
  else if (url.startsWith("https://github.com/")) url = url.slice("https://github.com/".length);
  else if (url.startsWith("http://github.com/")) url = url.slice("http://github.com/".length);
  else return undefined;
  if (url.endsWith(".git")) url = url.slice(0, -".git".length);
  if (url === "") return undefined;
  return url;
}

/**
 * Parse deliveries.jsonl text into {@link DeliveryRecord}[].
 *
 * Same logic as `readDeliveries` read path (last-wins by story+cycle),
 * but operates on raw text — avoids a round-trip through the store interface
 * when we already have the text from {@link FreshnessPort.readText}.
 */
function parseDeliveriesFromText(text: string): DeliveryRecord[] {
  const map = new Map<string, DeliveryRecord>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== "object") continue;
    const r = parsed as Record<string, unknown>;
    const storyId = r["storyId"];
    const cycleId = r["cycleId"];
    if (typeof storyId !== "string" || typeof cycleId !== "string") continue;
    const key = `${storyId}\t${cycleId}`;
    map.set(key, parsed as DeliveryRecord);
  }
  return [...map.values()];
}
