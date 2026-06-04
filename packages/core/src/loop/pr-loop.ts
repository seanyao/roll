/**
 * PR Loop — pure decision layer for the dedicated 5-min PR-loop tick
 * (US-LOOP-003 / v2 US-AUTO-034 + US-AUTO-044, FIX-159/146/141).
 *
 * ─── What this is (and the v2 archaeology behind it) ────────────────────────
 * v2 retired the standalone ci/alert loops (FIX-194/195): CI self-heal lives
 * INSIDE the PR loop, and ALERT is a file+notify mechanism, not a scheduled
 * loop. The v3 cards re-establish ci/alert as separate loop services, but the
 * PR-LOOP BEHAVIOUR this module mirrors is the v2 `_loop_pr_inbox` tick — the
 * sole driver of the `com.roll.pr.<slug>` launchd service (bin/roll 9671-9709,
 * `_write_pr_loop_runner_script` 8299-8330: a no-agent, no-tmux, 5-min runner
 * with a single-flight 15-min-stale lock that just runs `roll _loop_pr_inbox`).
 *
 * The tick pipeline (`_loop_pr_inbox`, bin/roll 11964-12055):
 *   1. resolve repo slug; gh-unavailable / list-fail / empty → idle tick.
 *   2. `gh pr list --state open --json number,headRefName,author,title`.
 *   3. for each open PR, fetch `--json reviews,mergeStateStatus,statusCheckRollup`:
 *        - bot review APPROVED + CI green + mergeable → merge directly (12007).
 *        - bot review CHANGES_REQUESTED → dedup ALERT, skip (12013).
 *        - else classify (`_loop_pr_classify`, 11748) → per-class action:
 *            ci_red → heal-self (delegated to the CI loop — ci-loop.ts);
 *            stale  → rebase circuit budget → rebase → re-check → eager merge;
 *            ready  → eager self-merge (`_loop_pr_merge_self_eager`, 11948).
 *   4. terminal `acted` tick.
 *
 * This module is PURE: the classify decision, the CI-state rollup reduction, the
 * merge-eligibility gate, the 24h rebase circuit-breaker budget, the per-PR
 * action selection, and the tick-state shape are all data→decision functions.
 * Every gh/git probe result is injected; the orchestration (the gh fan-out, the
 * rebase git commands, the heal dispatch) is the adapter's job. The publish
 * fallback ladder (B-group AC) reuses delivery/pr.ts {@link decidePublishOutcome}
 * — NOT re-declared here; see the re-export note at the bottom.
 *
 * Purity: no spawn, no sleep, no clock, no fs. `now`/timestamps are injected.
 */
import {
  type PublishOutcome,
  type PublishStatus,
  decidePublishOutcome,
} from "../delivery/pr.js";

// ── tick state shape (mirrors _loop_write_tick, bin/roll 8008-8035) ──────────

/**
 * One PR-loop tick outcome label. v2 stamps `idle` (nothing to do, with a note)
 * or `acted` (walked ≥1 PR) via `_loop_write_tick "pr" <outcome> <note>`
 * (bin/roll 11965-12053). Modelled as a discriminant so the adapter can append
 * the JSONL row verbatim.
 */
export type PrTickOutcome = "idle" | "acted";

/** The idle-tick `note` strings the inbox emits, 1:1 with the oracle call sites. */
export type PrIdleNote =
  | "gh_unavailable" // 11965: `_gh_resolve` failed.
  | "gh_error" // 11969: `gh pr list` non-zero.
  | "empty_response" // 11970: empty stdout.
  | "no_open_prs" // 11971: stdout == "[]".
  | "zero_prs"; // 11974: jq length 0.

/** A PR-loop tick row, as `_loop_write_tick` would serialize it (sans ts). */
export interface PrTick {
  loop: "pr";
  outcome: PrTickOutcome;
  note: string;
}

/** Build the idle tick for one of the early-return gates (bin/roll 11965-11974). */
export function prIdleTick(note: PrIdleNote): PrTick {
  return { loop: "pr", outcome: "idle", note };
}

/** The terminal tick after the inbox walks ≥1 PR (bin/roll 12053). */
export function prActedTick(): PrTick {
  return { loop: "pr", outcome: "acted", note: "inbox_done" };
}

// ── early-gate inventory decision (mirrors bin/roll 11965-11974) ─────────────

/** The raw facts the adapter gathers before walking PRs. */
export interface PrInboxInventory {
  /** True iff `_gh_resolve` produced a slug (bin/roll 11965). */
  ghAvailable: boolean;
  /** True iff `gh pr list` exited 0 (bin/roll 11969). */
  listOk: boolean;
  /** The trimmed stdout of `gh pr list` ("" / "[]" are the empty cases). */
  listStdout: string;
  /** The parsed open-PR count (jq length, bin/roll 11973). */
  openCount: number;
}

/**
 * Decide whether the tick has any PRs to walk, mirroring the gate ladder at
 * bin/roll 11965-11974 IN ORDER. Returns an idle {@link PrTick} (with the exact
 * oracle note) when the tick short-circuits, or `undefined` when there is work.
 */
export function prInboxGate(inv: PrInboxInventory): PrTick | undefined {
  if (!inv.ghAvailable) return prIdleTick("gh_unavailable");
  if (!inv.listOk) return prIdleTick("gh_error");
  const out = inv.listStdout.trim();
  if (out === "") return prIdleTick("empty_response");
  if (out === "[]") return prIdleTick("no_open_prs");
  if (inv.openCount <= 0) return prIdleTick("zero_prs");
  return undefined;
}

// ── CI-state rollup reduction (mirrors the jq in bin/roll 11996-12000) ───────

/** The reduced CI verdict the classifier consumes. "" = no checks (unknown). */
export type CiRollupState = "failure" | "success" | "pending" | "";

/** One statusCheckRollup entry's conclusion (the field the jq inspects). */
export type CheckConclusion =
  | "SUCCESS"
  | "FAILURE"
  | "SKIPPED"
  | "CANCELLED"
  | "NEUTRAL"
  | "ACTION_REQUIRED"
  | "TIMED_OUT"
  | "STARTUP_FAILURE"
  | null
  | string;

/**
 * Reduce a PR's `statusCheckRollup` conclusions to a single CI verdict —
 * mirrors the jq at bin/roll 11996-12000 EXACTLY:
 *   - empty rollup                                → "" (no checks reported).
 *   - ANY conclusion == "FAILURE"                 → "failure".
 *   - ALL conclusions ∈ {SUCCESS, SKIPPED}        → "success".
 *   - else (some pending/null/neutral/…)          → "pending".
 * The any-FAILURE check has priority over the all-success check (matching the
 * `if/elif` order). A `null` conclusion (still running) lands in "pending".
 */
export function reduceCiRollup(conclusions: readonly CheckConclusion[]): CiRollupState {
  if (conclusions.length === 0) return "";
  if (conclusions.some((c) => c === "FAILURE")) return "failure";
  if (conclusions.every((c) => c === "SUCCESS" || c === "SKIPPED")) return "success";
  return "pending";
}

// ── classify (mirrors _loop_pr_classify, bin/roll 11748-11763) ───────────────

/** The `mergeStateStatus` enum the classifier branches on (bin/roll 11754). */
export type MergeStateStatus =
  | "CLEAN"
  | "BEHIND"
  | "DIRTY"
  | "CONFLICTING"
  | "BLOCKED"
  | "UNKNOWN"
  | "UNSTABLE"
  | string;

/** The classify verdict — picks the per-class action in the inbox. */
export type PrClass = "ci_red" | "stale" | "ready";

/**
 * Pure routing decision — mirrors `_loop_pr_classify` (bin/roll 11748-11763).
 * Check order is load-bearing:
 *   1. mergeable ∈ {BEHIND, DIRTY, CONFLICTING}  → "stale" (rebase needed FIRST).
 *   2. ci_state == "failure"                      → "ci_red" (heal).
 *   3. else                                       → "ready" (merge).
 * Human review is intentionally IRRELEVANT — CI is the only gate (oracle
 * comment 11746-11747). The 2nd positional arg (`human_review`) is unused by
 * the oracle too; omitted here.
 */
export function classifyPr(ciState: CiRollupState, mergeable: MergeStateStatus): PrClass {
  if (mergeable === "BEHIND" || mergeable === "DIRTY" || mergeable === "CONFLICTING") {
    return "stale";
  }
  if (ciState === "failure") return "ci_red";
  return "ready";
}

// ── eager merge eligibility (mirrors _loop_pr_merge_self_eager, bin/roll 11948)

/**
 * Whether a self/loop PR is eligible for an immediate `gh pr merge --squash
 * --delete-branch` — mirrors `_loop_pr_merge_self_eager` (bin/roll 11950-11955)
 * and the identical gate in `_loop_pr_merge_approved` (11576-11579):
 *   - CI must be "success" (11950);
 *   - mergeable must be MERGEABLE (GraphQL enum) OR CLEAN (mergeStateStatus,
 *     11955) — both spellings accepted because the inbox feeds mergeStateStatus
 *     so a ready PR arrives as CLEAN in production (oracle comment 11951-11954).
 * Merge FAILURE is non-fatal in the oracle (PR left open, next tick retries) —
 * the caller surfaces that, this predicate only decides "attempt the merge".
 */
export function eagerMergeEligible(ciState: CiRollupState, mergeable: MergeStateStatus): boolean {
  if (ciState !== "success") return false;
  return mergeable === "MERGEABLE" || mergeable === "CLEAN";
}

// ── bot-review gate (mirrors the inbox's bot_review branch, bin/roll 12003-12019)

/** The bot/app review state the inbox short-circuits on (bin/roll 11992-11994). */
export type BotReviewState = "APPROVED" | "CHANGES_REQUESTED" | "" | string;

/** The action the bot-review gate selects BEFORE classify runs. */
export type BotReviewAction =
  | { kind: "merge_if_clean" } // APPROVED: merge iff CI green + mergeable (12007).
  | { kind: "alert_changes_requested" } // CHANGES_REQUESTED: dedup ALERT, skip (12013).
  | { kind: "fall_through" }; // neither → proceed to classify (12021).

/**
 * Decide the bot-review short-circuit — mirrors bin/roll 12003-12019. A
 * GHA-workflow reviewer (BOT/APP) takes precedence: an APPROVED PR is merged
 * directly when its gates clear (the loop owns the decision because repo-level
 * auto-merge is unreliable, 12004-12006); a CHANGES_REQUESTED PR is rejected
 * with a dedup ALERT and skipped; anything else falls through to classify.
 */
export function botReviewAction(bot: BotReviewState): BotReviewAction {
  if (bot === "APPROVED") return { kind: "merge_if_clean" };
  if (bot === "CHANGES_REQUESTED") return { kind: "alert_changes_requested" };
  return { kind: "fall_through" };
}

// ── per-PR action plan (mirrors the case "$verdict" switch, bin/roll 12024-12048)

/**
 * The action the inbox takes for ONE open PR after the bot-gate + classify.
 * Each kind names the oracle path so the adapter dispatches it 1:1:
 *   - merge       : `gh pr merge <n> --squash --delete-branch` (eager/approved).
 *   - heal        : `_loop_pr_heal_self` (DELEGATED to ci-loop.ts — see note).
 *   - rebase      : rebase-circuit budget → `_loop_pr_rebase_stale` → re-check.
 *   - alert       : dedup ALERT row (bot CHANGES_REQUESTED).
 *   - skip        : no-op (e.g. APPROVED but not yet clean).
 */
export type PrAction =
  | { kind: "merge"; reason: "bot_approved" | "eager_ready" | "eager_after_rebase" }
  | { kind: "heal" } // ci_red → hand to the CI heal path (ci-loop.ts).
  | { kind: "rebase" } // stale → rebase-circuit + rebase + re-check.
  | { kind: "alert"; reason: "bot_changes_requested" }
  | { kind: "skip"; reason: string };

/** The per-PR facts the action selector consumes (already reduced). */
export interface PrFacts {
  bot: BotReviewState;
  ciState: CiRollupState;
  mergeable: MergeStateStatus;
}

/**
 * Select the action for ONE open PR — composes {@link botReviewAction},
 * {@link classifyPr}, and {@link eagerMergeEligible} exactly as the inbox body
 * does (bin/roll 12003-12048):
 *   - bot APPROVED          → merge iff eager-eligible, else skip (12007-12011).
 *   - bot CHANGES_REQUESTED → alert, skip (12013-12018).
 *   - else classify:
 *       ci_red → heal (12025-12026);
 *       stale  → rebase (12028-12044, the re-check/eager-merge is the SECOND
 *                phase the adapter drives via {@link rebaseRecheckAction});
 *       ready  → merge iff eager-eligible, else skip (12046-12047 / 11950).
 */
export function selectPrAction(f: PrFacts): PrAction {
  const bot = botReviewAction(f.bot);
  if (bot.kind === "merge_if_clean") {
    return eagerMergeEligible(f.ciState, f.mergeable)
      ? { kind: "merge", reason: "bot_approved" }
      : { kind: "skip", reason: "bot_approved_not_clean" };
  }
  if (bot.kind === "alert_changes_requested") {
    return { kind: "alert", reason: "bot_changes_requested" };
  }
  const verdict = classifyPr(f.ciState, f.mergeable);
  if (verdict === "ci_red") return { kind: "heal" };
  if (verdict === "stale") return { kind: "rebase" };
  return eagerMergeEligible(f.ciState, f.mergeable)
    ? { kind: "merge", reason: "eager_ready" }
    : { kind: "skip", reason: "ready_not_mergeable" };
}

/**
 * The SECOND phase of the `stale` path — after a rebase the inbox re-fetches
 * `--json mergeStateStatus,statusCheckRollup` and eager-merges iff now clean
 * (bin/roll 12030-12043). Pure: given the re-checked facts, decide merge-or-skip.
 */
export function rebaseRecheckAction(ciState: CiRollupState, mergeable: MergeStateStatus): PrAction {
  return eagerMergeEligible(ciState, mergeable)
    ? { kind: "merge", reason: "eager_after_rebase" }
    : { kind: "skip", reason: "still_not_mergeable_after_rebase" };
}

// ── 24h rebase circuit breaker (mirrors _loop_pr_rebase_circuit, bin/roll 11770)

/** The sliding window for the rebase circuit breaker — 24h (bin/roll 11776). */
export const REBASE_CIRCUIT_WINDOW_SEC = 86400;
/** Attempts-within-window that trips the breaker (bin/roll 11807 `-ge 3`). */
export const REBASE_CIRCUIT_MAX = 3;

/** The circuit-breaker decision for one rebase attempt. */
export interface RebaseCircuitVerdict {
  /** False ⇒ tripped (≥3 attempts in 24h): block the rebase, write ALERT. */
  allowed: boolean;
  /** The pruned+(optionally)-appended timestamp list to persist (newest last).
   *  On a TRIP this is the pruned list WITHOUT the new attempt (oracle records
   *  nothing on trip — bin/roll 11807-11821 returns before the append). */
  freshTimestamps: number[];
  /** Count of in-window attempts BEFORE this one (for the ALERT message). */
  windowCount: number;
}

/**
 * Pure 24h sliding-window circuit breaker — mirrors `_loop_pr_rebase_circuit`
 * (bin/roll 11770-11827). Given the existing recorded attempt timestamps and
 * `now`:
 *   1. prune entries older than `now - 86400` (bin/roll 11791-11801).
 *   2. count survivors; ≥3 ⇒ TRIP (allowed=false, ALERT, NO append — 11807).
 *   3. else allow + append `now` (11824), to be persisted by the caller.
 * Non-numeric existing entries are dropped (bin/roll 11795-11797). The caller
 * owns the ALERT write and the `_loop_pr_state_write` persistence; this returns
 * the data both need.
 */
export function rebaseCircuitVerdict(
  existing: readonly number[],
  nowSec: number,
): RebaseCircuitVerdict {
  const cutoff = nowSec - REBASE_CIRCUIT_WINDOW_SEC;
  const fresh = existing.filter((ts) => Number.isInteger(ts) && ts >= cutoff);
  const windowCount = fresh.length;
  if (windowCount >= REBASE_CIRCUIT_MAX) {
    return { allowed: false, freshTimestamps: fresh, windowCount };
  }
  return { allowed: true, freshTimestamps: [...fresh, nowSec], windowCount };
}

// ── pr_state.<pr>.attempts_at parse (mirrors the awk in bin/roll 11781-11788) ─

/**
 * Parse the recorded rebase-attempt timestamps for ONE pr from the loop state
 * file body — mirrors the awk at bin/roll 11781-11788, which finds the
 * `pr_state:` block, then the `"<pr>":` sub-block, then its `attempts_at: "<ts
 * ts …>"` value (a space-separated list inside double quotes). Returns the
 * numeric timestamps (non-numeric tokens dropped, matching the circuit's own
 * filter). Empty when the pr / field is absent.
 *
 * The minimal YAML the oracle writes (bin/roll 11842-11862) looks like:
 *   pr_state:
 *     "123":
 *       attempts_at: "1700000000 1700000030"
 */
export function parseRebaseAttempts(stateBody: string, pr: string): number[] {
  const lines = stateBody.split("\n");
  let inPr = false;
  let inTarget = false;
  const prKey = `"${pr}":`;
  for (const line of lines) {
    if (/^pr_state:/.test(line)) {
      inPr = true;
      continue;
    }
    if (inPr && line.includes(prKey)) {
      inTarget = true;
      continue;
    }
    if (inTarget && /attempts_at:/.test(line)) {
      // sub(/^[^"]*"/, "") then sub(/".*$/, "") — the value between the quotes.
      const open = line.indexOf('"');
      if (open < 0) return [];
      const rest = line.slice(open + 1);
      const close = rest.indexOf('"');
      const inner = close < 0 ? rest : rest.slice(0, close);
      return inner
        .split(/\s+/)
        .filter((t) => t !== "" && /^\d+$/.test(t))
        .map((t) => Number(t));
    }
    // in_target && /^[^[:space:]]/ {in_target=0} — a non-indented line ends it.
    if (inTarget && /^[^\s]/.test(line)) inTarget = false;
  }
  return [];
}

/** Render the `attempts_at` value string the oracle writes (space-joined). */
export function renderRebaseAttempts(timestamps: readonly number[]): string {
  return timestamps.join(" ");
}

// ── rebase target eligibility (mirrors fork guard, bin/roll 11891) ───────────

/**
 * Whether a stale PR is rebaseable by the loop — mirrors the fork guard at
 * `_loop_pr_rebase_stale` (bin/roll 11888-11897): a cross-repository (fork) PR
 * CANNOT be force-pushed (no write access), so the oracle writes an ALERT and
 * skips. Returns false for forks (→ alert), true otherwise (→ attempt rebase).
 */
export function rebaseable(isCrossRepository: boolean): boolean {
  return !isCrossRepository;
}

// ── publish fallback ladder (B-group AC) ─────────────────────────────────────
//
// The card's B-group AC — "合并失败多级兜底（换路径/留分支加标记，不丢成果）" — is
// the cycle-end publish ladder, ALREADY ported by delivery/pr.ts
// {@link decidePublishOutcome} (status 0 → done / 2 → merge-back / else →
// orphan-push, mirroring bin/roll 9239-9341). Per the card ("reuse delivery/pr.ts
// plans where they overlap — no duplication") we DO NOT re-implement it; the PR
// loop's publish-fallback decision IS that function. Re-exported here so a PR-loop
// caller imports the fallback from one place.
export { decidePublishOutcome };
export type { PublishOutcome, PublishStatus };
