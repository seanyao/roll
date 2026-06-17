/**
 * CycleOrchestrator — TS port of the v2 loop "inner cycle runner" (US-LOOP-001).
 *
 * This is the COMPOSITION card: nearly every building block already exists as a
 * pure module (backlog/picker, agent/router, delivery/{pr,tcr}, reconcile/engine,
 * events/bus, loop/recovery). This module is the conductor — a PURE
 * state machine that walks the {@link CyclePhase} ladder, deciding at each step
 * WHICH building-block command to run next and WHAT terminal {@link TerminalOutcome}
 * the cycle lands on. It NEVER spawns a process, sleeps, or reads a clock; every
 * I/O result (story pick, route, worktree create, agent exit, publish status,
 * merge poll, reconcile evidence) is fed back in as an {@link CycleEvent}, and the
 * stepper returns the next state + an ordered list of {@link CycleCommand}s for an
 * injected executor (the CLI/infra adapter) to perform.
 *
 * ── v2 oracle phase map (bin/roll, frozen; read FULLY before any change) ──────
 * The inner runner heredoc spans bin/roll:8391-9380. Phase-by-phase line ranges:
 *
 *   PHASE              v2 _phase_begin/_phase_end  oracle lines   v3 CyclePhase
 *   ─────────────────  ──────────────────────────  ─────────────  ─────────────
 *   startup            startup                     8835-8836      (pre-pick env/lock/heartbeat — recovery.ts)
 *   preflight          preflight                   8837-8907      (preflightPlan + orphan recovery — recovery.ts)
 *   worktree_setup     worktree_setup              8908-9008      worktree
 *     ├─ create/sync   _worktree_create/sync_meta  8909-8917
 *     ├─ pick story    _loop_pick_next_story       8938          pick   (picker.ts)
 *     ├─ TOCTOU repick FIX-146                      8941-8956     pick   (picker re-eligibility)
 *     ├─ route         _loop_pick_agent_for_story  8957-8964     route  (router.ts resolveRoute)
 *     └─ fallback      _loop_resolve_fallback_agent 8965-8983     route  (router.ts resolveFallback)
 *   agent_invoke       agent_invoke                9026-9078      execute
 *     ├─ watchdog arm  FIX-057/068 sleep+SIGTERM   9044-9052      (watchdogVerdict)
 *     ├─ spawn+TCR     claude -p | loop-fmt        9053-9062      execute (agent runs, commits TCR)
 *     └─ retry 1..3    `for _attempt in 1 2 3`     9032-9072      execute (retryPlan)
 *   (timeout abort)    _CYCLE_TIMED_OUT short-circ 9120-9125      → blocked (watchdog breach)
 *   (capture facts)    git rev-list/log count      9127-9157      reconcile (six-state classify)
 *   publish_push       publish_push                9227-9356      publish
 *     ├─ idle (0 ahd)  _worktree_cleanup + idle    9180-9198      → idle outcome
 *     ├─ status 0      _loop_publish_pr ok         9239-9265      merge-wait→done
 *     ├─ status 2      gh missing → merge_back     9266-9318      → done | orphan | failed
 *     └─ status other  PR-fail → orphan push       9319-9356      → orphan | failed
 *   merge-wait         (US-AUTO-044: async PR Loop) 9241-9250      merge-wait (handed off; see note)
 *   cleanup            cleanup                     9251-9265      cleanup
 *   (EXIT trap)        _inner_cleanup              8665-8772      (terminal-event invariant I8)
 *
 * Two phases the spec names but v2 folds differently:
 *   - "merge-wait": v2 (US-AUTO-044, bin/roll:9241-9250) HANDS the merged PR to a
 *     separate async PR Loop rather than blocking the cycle. The pre-AUTO-044
 *     SYNCHRONOUS wait (`_loop_wait_pr_merge`, bin/roll:13580-13599) is already
 *     ported as delivery/pr.ts {@link nextWaitAction}. This orchestrator models
 *     merge-wait as an OPTIONAL phase (driven by {@link nextWaitAction}) so a
 *     caller can choose the synchronous shape (the card's "等真合并") OR the
 *     hand-off shape; the default walk hands off (v2 today) and treats `done` as
 *     "published, merge handed to PR Loop", with reconcile crediting built→merged
 *     on real evidence (reconcile/engine.ts {@link reconcileMergeEvidence}, I4).
 *   - "reconcile": v2 does the per-cycle status capture inline (bin/roll:9127-9157)
 *     and the real merge backfill in a SEPARATE pass (`_loop_backfill_merged`).
 *     Here `reconcile` is the phase that classifies the six-state terminal from
 *     the captured facts ({@link classifyCaptured}) and, when synchronous, folds
 *     merge evidence.
 *
 * ── Terminal outcome model ────────────────────────────────────────────────────
 * v2 stamps one of SIX runs.jsonl statuses (idle/built/failed/orphan/aborted/done)
 * — see _runs_append callers + the EXIT trap. {@link classifyCaptured} and
 * {@link captureToSpecOutcome} map v2 runner rows to TerminalOutcome. The
 * {@link V2CycleStatus} internal vocabulary is kept for byte-faithful runs-row
 * parity; emitted cycle:end events and new row `outcome` fields use the closed
 * terminal vocabulary.
 *
 * ── Hard timeout (B-group AC) ─────────────────────────────────────────────────
 * v2 LOOP_CYCLE_TIMEOUT_SEC=2700 (bin/roll:8473). The watchdog (bin/roll:9044-9052)
 * SIGTERMs the inner script at the breach, SIGKILLs after a 5s grace; the EXIT
 * trap then writes cycle_end `blocked` + ALERT and releases the inner lock WITHOUT
 * cleaning the worktree (preserved for audit, bin/roll:9122). {@link watchdogVerdict}
 * is the pure breach decision; {@link timeoutTeardownCommands} renders the clean
 * teardown command sequence (kill → terminal event → lock release), order-asserted
 * in tests. The OUTER guard (bin/roll:9562, timeout+300) is the adapter's; this
 * module owns the INNER decision.
 *
 * ── Transient retry / backoff (B-group AC, I6) ────────────────────────────────
 * v2's `for _attempt in 1 2 3` (bin/roll:9032-9072) is a PROCESS-EXIT retry: any
 * non-zero agent exit (that is not a timeout) retries up to 3 times with a FIXED
 * 30s sleep (bin/roll:9070), then falls through to `failed`. It does NOT classify
 * transient-vs-permanent and does NOT swap agents on failure (I6: in-cycle bounded
 * retry is SEPARATE from the loop-level consecutive-failure PAUSE — agent swap is a
 * PRE-SPAWN availability fallback only, router.ts {@link resolveFallback}).
 * {@link retryPlan} mirrors v2's 3-attempt budget and adds an EXPONENTIAL backoff
 * schedule (NEW v3: the AC+ asks for "退避"; v2 uses a flat 30s, kept as the base).
 * Exhaustion → `failed` (NEVER agent-swap — I6). The timeout breach short-circuits
 * the retry loop (bin/roll:9066 `break`), so a timed-out attempt is NOT retried.
 *
 * ── No cost gate (budget control removed) ─────────────────────────────────────
 * v2 had NO cost gate in the runner, and v3 no longer adds one: the dollar
 * ceiling was a lagging, gameable proxy for "this run is wasting resources".
 * route_resolved now transitions straight to the agent spawn. Runaway-spend
 * protection moved to the DIRECT progress guardrails in loop-go.ts (the
 * per-cycle productivity floor + the cross-session dead-loop breaker), which
 * stop the loop on NO PROGRESS — earlier and deterministically. Per-cycle
 * token/cost is still fully RECORDED (cost/tracker.ts → runs.jsonl); only the
 * CONTROL was removed, not the observability.
 *
 * Purity: no spawn, no sleep, no clock, no fs. The stepper is a referentially
 * transparent `(state, event) → { state, commands }`. Callers thread the returned
 * state back in with the next observed event; the {@link CycleCommand}s name the
 * existing ports/plans so the adapter dispatches them 1:1.
 */
import type { AgentId, CycleCost, CyclePhase, ModelId, TerminalOutcome } from "@roll/spec";
import { cycleCurrency } from "../cost/tracker.js";
import type { RollEvent } from "@roll/spec";
import { nextWaitAction, type WaitAction } from "../delivery/pr.js";

// ── v2 terminal vocabulary (six-state model) ─────────────────────────────────

/**
 * The SIX runs.jsonl statuses the v2 runner stamps (the EXIT trap + every
 * `_runs_append` call site). Kept as an explicit internal vocabulary so the
 * runs-row parity stays byte-faithful (diff-tested in outcome.difftest):
 *   - idle    : exit 0, zero commits ahead of origin/main (bin/roll:9197).
 *   - built   : exit 0, ≥1 commit ahead, claimed-but-unconfirmed (bin/roll:9142).
 *   - done    : published / ff-merged — the only success the dashboard credits
 *               (bin/roll:9261/9275; reconcile later promotes built→merged).
 *   - orphan  : publish failed but branch+tag pushed for audit (bin/roll:9293/9308/9331/9346).
 *   - failed  : agent non-zero after retry, guard/test-gate fail (a GATE failed)
 *               (bin/roll:9133/9209/9219).
 *   - local   : FIX-351 — gates PASSED (a `built` capture: exit 0, ≥1 commit, no
 *               attest/peer block) but the publish could NOT complete and no
 *               orphan branch was pushed. The work is sound + locally committed,
 *               it just never left the machine. A neutral non-failure terminal,
 *               distinct from `failed` (a gate genuinely failed) and `orphan`
 *               (publish failed but the branch WAS pushed for audit).
 *   - aborted : EXIT-trap catch-all — SIGKILL / set -e fire, no explicit terminal
 *               (bin/roll:8756).
 *   - blocked : hard-timeout breach (bin/roll:8679).
 */
export type V2CycleStatus = "idle" | "gave_up" | "built" | "done" | "published" | "orphan" | "local" | "failed" | "aborted" | "blocked";

/**
 * Bridge v2's runs.jsonl status onto the closed {@link TerminalOutcome}
 * vocabulary. This is a write-side projection for new events/rows:
 *   - idle    → "idle_no_work"              : exit-0 no-op.
 *   - built   → "published_pending_merge"  : claimed, pending merge evidence.
 *   - done    → "delivered"                : confirmed merged / locally ff-merged.
 *   - published → "published_pending_merge": PR open, merge pending.
 *   - orphan  → "aborted_with_delivery"    : pushed for audit but not delivered.
 *   - local   → "unpublished"   : FIX-351 — gates passed, work committed locally,
 *               publish could not complete (no orphan push). A neutral terminal.
 *   - failed  → "failed".
 *   - aborted → "aborted_no_delivery".
 *   - blocked → "blocked"   : hard-timeout breach.
 */
export function mapV2Status(status: V2CycleStatus): TerminalOutcome {
  switch (status) {
    case "done":
      return "delivered";
    case "published":
    case "built":
      return "published_pending_merge";
    case "idle":
      return "idle_no_work";
    case "gave_up":
      // Hook 1: an agent EXECUTED but produced nothing — a failed-class terminal,
      // NOT a silent idle. Distinct outcome so the dashboard/ledger and the
      // dead-loop breaker can tell a give-up from a genuine no-op.
      return "gave_up";
    case "orphan":
      return "aborted_with_delivery";
    case "local":
      // FIX-351: gates passed + work committed locally, but the publish could not
      // complete (push / PR-create failed before any orphan branch was pushed).
      // A NEUTRAL non-failure terminal — the dashboard renders it as "ran
      // locally, not published", never red.
      return "unpublished";
    case "failed":
      return "failed";
    case "aborted":
      return "aborted_no_delivery";
    case "blocked":
      return "blocked";
  }
}

// ── Six-state classification from captured facts (mirrors bin/roll:9127-9356) ─

/** The cycle facts captured post-agent, before publish (bin/roll:9127-9157). */
export interface CapturedFacts {
  /** Worktree isolation succeeded (`_USE_WORKTREE=1`). */
  usedWorktree: boolean;
  /**
   * Hook 1 (productivity floor): did an agent actually EXECUTE this cycle? True
   * when the agent slot was non-empty AND its spend/duration was above a tiny
   * no-op epsilon (the executor reuses the `rowSpentZeroNoExecution` semantics).
   * Distinguishes a `gave_up` (agent ran, 0 output) from a genuine no-op idle.
   * Absent ⇒ treated as "executed" for back-compat with the v2 accept path
   * (capture is only reached after an agent spawn, so a captured cycle ran one).
   */
  agentExecuted?: boolean;
  /** Agent process exit code (0 = clean). bin/roll:9063 `_exit`. */
  agentExit: number;
  /** Watchdog fired this cycle (`_CYCLE_TIMED_OUT=1`). bin/roll:9074. */
  timedOut: boolean;
  /** Commits ahead of origin/main in the worktree (bin/roll:9139). */
  commitsAhead: number;
  /** FIX-252: commits on local main that are not on origin/main. */
  mainAhead?: number;
  /** FIX-244: PR state for the cycle branch ("OPEN"/"MERGED"/...), probed by the
   *  capture step ONLY when the exit is non-zero with commits ahead — the
   *  phantom-failure check. Absent = not probed / no PR. */
  prState?: string;
}

/**
 * Classify the PRE-publish terminal status from captured facts, mirroring the
 * inline capture block (bin/roll:9127-9157):
 *   - timed out                       → blocked (the watchdog path owns teardown).
 *   - worktree-setup failed           → failed (bin/roll:9000-9007).
 *   - agent exit ≠ 0                  → failed (bin/roll:9132-9133).
 *   - exit 0, commitsAhead === 0 and local main not ahead:
 *       · an agent EXECUTED (Hook 1 productivity floor) → gave_up (failed-class,
 *         alerted on cycle 1 — an agent that burned tokens/time but produced
 *         nothing is NOT a silent idle).
 *       · no agent executed (genuine no_story/no-op $0) → idle (bin/roll:9180).
 *   - exit 0, commitsAhead > 0        → built (bin/roll:9141-9142; refined by the
 *                                       publish ladder to done/orphan/failed).
 * Returns the status BEFORE the publish ladder runs; {@link classifyPublish}
 * refines a `built` capture per the publish status.
 */
export function classifyCaptured(facts: CapturedFacts): V2CycleStatus {
  if (facts.timedOut) return "blocked";
  if (!facts.usedWorktree) return "failed";
  if (facts.agentExit !== 0) {
    // FIX-244: a non-zero capture whose work is ALREADY out as a PR (observed
    // 2026-06-10: attest-blocked cycles whose PR merged minutes later) is not a
    // no-output failure — classify "published"; the merge-evidence backfill
    // (FIX-243) arbitrates the final credit.
    if (facts.commitsAhead > 0 && (facts.prState === "OPEN" || facts.prState === "MERGED"))
      return "published";
    return "failed";
  }
  if (facts.commitsAhead === 0 && (facts.mainAhead ?? 0) > 0) return "failed";
  if (facts.commitsAhead === 0) {
    // Hook 1 (productivity floor): split the commit-count-only idle. An agent
    // that EXECUTED but left 0 commits and no delivery gave_up (a failed-class
    // terminal); a cycle where no agent ran is a genuine idle no-op. `undefined`
    // ⇒ executed (back-compat: capture is only reached after an agent spawn).
    return facts.agentExecuted === false ? "idle" : "gave_up";
  }
  return "built";
}

/** A publish ladder outcome (refines a `built` capture). The three tiers mirror
 *  the cycle-end ladder branching (bin/roll:9239-9356). */
export interface PublishResult {
  /** `_publish_status`: 0 ok / 2 gh-missing / other PR-fail (bin/roll:9238). */
  status: number;
  /** Human merge required: PR may open, but no local merge-back may count done. */
  manualMerge?: boolean;
  /** Did the gh-missing ff `_worktree_merge_back` succeed? (bin/roll:9272). */
  mergedBack?: boolean;
  /** Did the orphan branch+tag push succeed? (bin/roll:9303-9305 etc). */
  orphanPushed?: boolean;
}

/**
 * Refine a `built` capture through the publish ladder, mirroring bin/roll:9239-9356:
 *   - status 0                         → done   (PR published; merge → PR Loop).
 *   - status 2 + mergedBack            → done   (gh missing; ff merge_back, 9275).
 *   - status 2 + orphanPushed          → orphan (gh missing; orphan push, 9293).
 *   - status 2 + neither               → local  (FIX-351: gates passed, no publish).
 *   - status other + orphanPushed      → orphan (PR-fail; orphan push, 9331/9346).
 *   - status other + not pushed        → local  (FIX-351: gates passed, no publish).
 *
 * FIX-351 — the publish ladder is only ever reached from a `built` capture, i.e.
 * a cycle whose GATES ALREADY PASSED (exit 0, ≥1 commit, no attest/peer block).
 * If its publish cannot complete and no orphan branch was pushed, the WORK is
 * sound and locally committed — it just never left the machine. That is NOT a
 * gate failure; it is `local` (→ TerminalOutcome `unpublished`), rendered
 * neutrally. A genuine GATE failure is classified `failed` BEFORE this ladder
 * (classifyCaptured: timed-out/worktree-fail/agent-exit≠0/gave_up), so reusing
 * `local` here never masks a real failure. (Pre-FIX-351 these branches returned
 * `failed`, which painted sound gate-passed cycles red — FIX-313's case.)
 *
 * Only call on a `built` capture; idle/failed/blocked never reach the ladder.
 */
export function classifyPublish(pub: PublishResult): V2CycleStatus {
  // FIX-244: publish-ok means the PR is OPEN, merge pending — "published", not
  // "done" (done ≡ merged to main, I4). Backfill flips it on merge evidence.
  if (pub.status === 0) return "published";
  if (pub.status === 2) {
    // A manual-merge story must NEVER count a local ff merge-back as `done`
    // (done ≡ a human-confirmed merge). With manualMerge the merge-back is
    // ignored: the work is committed locally but unpublished → `local` (FIX-351,
    // formerly `failed`). An orphan push still pre-empts as `orphan` (audit branch).
    if (pub.manualMerge === true) {
      return pub.orphanPushed === true ? "orphan" : "local";
    }
    if (pub.mergedBack === true) return "done";
    if (pub.orphanPushed === true) return "orphan";
    // gh missing, no merge-back, no orphan push — work committed locally but
    // unpublished (FIX-351, formerly `failed`).
    return "local";
  }
  // PR-fail tier.
  if (pub.orphanPushed === true) return "orphan";
  return "local";
}

/** Map a captured terminal straight to the closed terminal outcome vocabulary. */
export function captureToSpecOutcome(status: V2CycleStatus): TerminalOutcome {
  return mapV2Status(status);
}

// ── Hard timeout watchdog (B-group AC; mirrors bin/roll:8473 + 9044-9125) ─────

/** v2 hard cycle timeout in seconds (LOOP_CYCLE_TIMEOUT_SEC, bin/roll:8473). */
export const CYCLE_TIMEOUT_SEC = 2700;
/** SIGKILL grace after SIGTERM, seconds (bin/roll:9048 `sleep 5`). */
export const WATCHDOG_KILL_GRACE_SEC = 5;

/** The watchdog breach decision. `breached` drives the clean-teardown path. */
export type WatchdogVerdict =
  | { breached: false; remainingSec: number }
  | { breached: true; overshootSec: number };

/**
 * Pure breach decision for the cycle watchdog (bin/roll:9044 `sleep TIMEOUT`).
 * Given the elapsed seconds since `CYCLE_START` (bin/roll:8829) and the limit,
 * decide whether the hard timeout has tripped. No clock — `elapsedSec` is injected
 * (the adapter computes `now - CYCLE_START`). Breach iff `elapsed >= limit`
 * (the bash watchdog fires once the sleep completes, i.e. at the boundary).
 */
export function watchdogVerdict(
  elapsedSec: number,
  limitSec: number = CYCLE_TIMEOUT_SEC,
): WatchdogVerdict {
  if (elapsedSec >= limitSec) return { breached: true, overshootSec: elapsedSec - limitSec };
  return { breached: false, remainingSec: limitSec - elapsedSec };
}

/**
 * The clean-teardown command sequence on a hard-timeout breach, mirroring the
 * watchdog + EXIT-trap discipline (bin/roll:9044-9052, 8676-8687, 9120-9125):
 *   1. kill the agent process group (SIGTERM, then SIGKILL after the grace).
 *   2. emit the TERMINAL cycle:end event with outcome `blocked` (I8 — a terminal
 *      event is ALWAYS written, even on the abort path; bin/roll:8679).
 *   3. write the runs.jsonl `failed` row (dashboard terminal record, bin/roll:8685).
 *   4. append the timeout ALERT (bin/roll:8686).
 *   5. release the inner lock (bin/roll:8770) — the worktree is PRESERVED for
 *      audit (NOT cleaned, bin/roll:9122), so no worktree-cleanup command.
 * The order is asserted in tests; lock release comes LAST so the terminal event +
 * runs row are durably written before the lock frees the slot.
 */
export function timeoutTeardownCommands(ctx: TerminalContext): CycleCommand[] {
  return [
    { kind: "kill_agent", graceSec: WATCHDOG_KILL_GRACE_SEC },
    { kind: "emit_event", event: cycleEndEvent(ctx, "blocked") },
    { kind: "append_run", status: "blocked", outcome: "blocked", cycleId: ctx.cycleId },
    {
      kind: "append_alert",
      message: `cycle ${ctx.cycleId}: ${CYCLE_TIMEOUT_SEC}s timeout — agent killed; in-progress story marked Blocked`,
    },
    { kind: "release_lock" },
  ];
}

// ── Transient retry / backoff (B-group AC, I6; mirrors bin/roll:9032-9072) ────

/** v2 in-cycle agent-spawn retry budget (`for _attempt in 1 2 3`, bin/roll:9032). */
export const MAX_AGENT_ATTEMPTS = 3;
/** v2 flat retry sleep, seconds (bin/roll:9070 `sleep 30`). Used as the backoff
 *  BASE; v3 layers exponential growth on top (documented NEW). */
export const RETRY_BASE_BACKOFF_SEC = 30;

/** The retry decision after an agent attempt. */
export type RetryPlan =
  | { action: "accept" } // exit 0 — break the loop (bin/roll:9067).
  | { action: "abort_timeout" } // watchdog fired — break, no retry (bin/roll:9066).
  | { action: "retry"; nextAttempt: number; backoffSec: number } // bin/roll:9068-9070.
  | { action: "exhausted" }; // budget spent → fall through to `failed` (I6).

/** Inputs for {@link retryPlan}: the just-finished attempt + its result. */
export interface RetryInput {
  /** 1-based attempt number that just ran (1..{@link MAX_AGENT_ATTEMPTS}). */
  attempt: number;
  /** Agent exit code (0 = success). */
  exit: number;
  /** Watchdog fired during this attempt (`_CYCLE_TIMED_OUT`). */
  timedOut: boolean;
  /** Max attempts (default {@link MAX_AGENT_ATTEMPTS}). */
  maxAttempts?: number;
  /** Backoff base seconds (default {@link RETRY_BASE_BACKOFF_SEC}). */
  baseBackoffSec?: number;
}

/**
 * Decide the next retry action, mirroring the loop body (bin/roll:9064-9072):
 *   - timedOut         → abort_timeout (break; the timeout path owns teardown).
 *   - exit 0           → accept (break).
 *   - exit ≠ 0, attempt < max → retry at attempt+1 after a backoff sleep.
 *   - exit ≠ 0, attempt == max → exhausted (fall through to `failed`, I6 — NEVER
 *     swap agents; agent fallback is pre-spawn only, router.ts resolveFallback).
 *
 * Backoff (NEW v3, AC+ "退避"): v2 sleeps a FLAT 30s every retry; v3 keeps 30s as
 * the base and grows it EXPONENTIALLY: `base * 2^(attempt-1)` (30s, 60s, …). The
 * schedule is pure (no real sleep); the adapter sleeps `backoffSec`.
 */
export function retryPlan(input: RetryInput): RetryPlan {
  const max = input.maxAttempts ?? MAX_AGENT_ATTEMPTS;
  const base = input.baseBackoffSec ?? RETRY_BASE_BACKOFF_SEC;
  if (input.timedOut) return { action: "abort_timeout" };
  if (input.exit === 0) return { action: "accept" };
  if (input.attempt < max) {
    const backoffSec = base * 2 ** (input.attempt - 1);
    return { action: "retry", nextAttempt: input.attempt + 1, backoffSec };
  }
  return { action: "exhausted" };
}

/** The full backoff schedule for a fresh agent run (NEW v3), useful for callers
 *  pre-computing sleeps and for tests. Length is `maxAttempts - 1` (no sleep after
 *  the final attempt). e.g. default → [30, 60]. */
export function backoffSchedule(
  maxAttempts: number = MAX_AGENT_ATTEMPTS,
  baseBackoffSec: number = RETRY_BASE_BACKOFF_SEC,
): number[] {
  const out: number[] = [];
  for (let a = 1; a < maxAttempts; a++) out.push(baseBackoffSec * 2 ** (a - 1));
  return out;
}

// ── Cycle commands (the language the stepper emits) ───────────────────────────

/**
 * One command the orchestrator asks the executor (adapter) to perform. Each
 * names an existing port/plan so dispatch is 1:1; the orchestrator never runs
 * any of these itself. `*_run` commands feed their result back as a {@link
 * CycleEvent} on the next step.
 */
export type CycleCommand =
  | { kind: "preflight" } // recovery.ts preflightPlan + orphan recovery.
  | { kind: "create_worktree"; branch: string } // infra/git _worktree_create.
  | { kind: "pick_story" } // backlog/picker pickStory.
  | { kind: "resume_worktree"; storyId: string } // RESUME-PRIOR-WORK re-point (post-pick).
  | { kind: "resolve_route"; storyId: string } // agent/router resolveRoute+Fallback.
  | { kind: "spawn_agent"; agent: AgentId; attempt: number } // execute (TCR inside).
  | { kind: "kill_agent"; graceSec: number } // watchdog teardown.
  | { kind: "sleep_backoff"; seconds: number } // retry backoff (adapter sleeps).
  | { kind: "capture_facts" } // git rev-list/log count (bin/roll:9127-9157).
  | { kind: "publish_pr"; branch: string; docOnly: boolean } // delivery/pr planPublishPr.
  | { kind: "merge_back"; branch: string } // _worktree_merge_back (gh-missing tier).
  | { kind: "push_orphan"; branch: string } // FIX-039 orphan branch+tag.
  | { kind: "wait_merge"; branch: string; elapsedSec: number } // delivery/pr nextWaitAction.
  | { kind: "reconcile" } // reconcile/engine reconcileMergeEvidence.
  | { kind: "cleanup_worktree"; branch: string } // _worktree_cleanup.
  | { kind: "emit_event"; event: RollEvent } // events/bus appendEvent (I8).
  | { kind: "append_run"; status: V2CycleStatus; outcome: TerminalOutcome; cycleId: string } // events/bus upsertRun.
  | { kind: "append_alert"; message: string } // _worktree_alert.
  | { kind: "release_lock" }; // infra/process releaseLock.

// ── Cycle state + events (the state-machine carrier) ──────────────────────────

/** Per-cycle constants the stepper threads into emitted events/commands. */
export interface CycleContext {
  cycleId: string;
  branch: string;
  loop: string;
  storyId?: string;
  agent?: AgentId;
  model?: ModelId;
  /** Cycle start (epoch seconds) — set by the driver; used by the attest gate
   *  (FIX-207) to decide whether an acceptance report was produced THIS cycle. */
  startSec?: number;
  /** FIX-208: real `tcr:` commit count, captured by the executor while the
   *  worktree is alive (capture_facts). Threaded into the runs row so the
   *  可回溯链 stops reporting a hardcoded 0. Absent ⇒ not yet captured. */
  tcrCount?: number;
  /** FIX-343 (step ①): the BUILDER's unique session id, minted ONCE at the
   *  working-agent spawn (`<cycleId>:build:<agent>:<clock>`) and reused across
   *  retries. The attest gate compares the SCORER's session id against this so
   *  "an independent fresh session (not a sub-agent sharing the builder's
   *  context) scored this delivery" is a CHECKED invariant, not asserted. Absent
   *  ⇒ the builder has not spawned yet (the gate then treats every score as a
   *  potential self-grade and demands a session-id present + distinct). */
  builderSessionId?: string;
  /** FIX-208: the real per-cycle cost folded from the agent's parsed usage
   *  (cost/tracker.ts), set by the executor after spawn_agent. Threaded into
   *  BOTH the cycle:end event and the runs row so they agree. Absent ⇒ no
   *  usage parsed (the cycle:end falls back to the zero-cost placeholder). */
  cost?: CycleCost;
  /** US-EVID-001: per-cycle acceptance evidence frame opened before agent spawn. */
  evidenceRunDir?: string;
  /** US-TRUTH-001: the cycle's published PR url, patched by the publish_pr
   *  executor — feeds the terminal event's pr fact. Absent ⇒ no publish. */
  prUrl?: string;
  /** FIX-304: the story's backlog status captured at pick time, BEFORE this
   *  cycle flipped it to 🔨 In Progress. The terminal uses it to UNDO a
   *  PREMATURE ✅ Done the agent wrote (via the symlinked .roll backlog) when
   *  the cycle did NOT merge — done ≡ merged. Absent ⇒ status unread at pick
   *  (no revert target; the terminal leaves the row untouched). */
  preCycleStatus?: string;
}

/** Minimal context for building a terminal cycle:end event + runs row. */
export interface TerminalContext {
  cycleId: string;
  branch: string;
  agent: AgentId;
  model: ModelId;
}

/**
 * The cycle state: the current {@link CyclePhase} plus the running context and a
 * tiny bit of phase-local memory (attempt counter, captured facts) the stepper
 * needs to decide the next transition. `done === true` marks a terminal state.
 */
export interface CycleState {
  phase: CyclePhase;
  ctx: CycleContext;
  /** 1-based agent attempt in flight (execute phase). */
  attempt: number;
  /** True once the worktree was created (distinguishes the pre-worktree pick
   *  phase, which accepts `preflight_done`, from the in-worktree pick phase,
   *  which accepts `story_picked`/`no_story`). */
  worktreeReady?: boolean;
  /** Captured post-agent facts (set entering reconcile). */
  captured?: CapturedFacts;
  /** Terminal status once decided. */
  terminal?: V2CycleStatus;
  /** True when `phase === "cleanup"` and a terminal status is stamped. */
  done: boolean;
}

/**
 * The events the stepper consumes — the OBSERVED results of the commands it
 * previously emitted. The adapter performs a command and feeds the result back.
 */
export type CycleEvent =
  | { type: "start"; ctx: CycleContext } // begin the cycle (→ preflight).
  | { type: "preflight_done" }
  | { type: "worktree_created" }
  | { type: "worktree_failed" } // isolation failed → failed terminal (bin/roll:9000).
  | { type: "story_picked"; storyId: string }
  | { type: "no_story" } // picker returned nothing → idle (bin/roll:9180-class).
  | { type: "route_resolved"; agent: AgentId; model: ModelId }
  | { type: "agent_exited"; exit: number; timedOut: boolean }
  | { type: "facts_captured"; facts: CapturedFacts }
  | { type: "published"; result: PublishResult }
  | { type: "merge_polled"; state: string; elapsedSec: number } // sync merge-wait.
  | { type: "reconciled" }
  | { type: "cleaned" };

/** The stepper result: the next state + the ordered commands to perform. */
export interface StepResult {
  state: CycleState;
  commands: CycleCommand[];
}

/**
 * The phase(s) each {@link CycleEvent} is valid IN — the resumability guard. An
 * event observed in any other phase is a no-op (stale/replayed adapter event). The
 * walk order: pick → worktree → pick → route → execute → reconcile → publish →
 * (merge-wait) → cleanup. `start` is omitted (it always applies — it resets).
 */
const EVENT_VALID_PHASES: Record<Exclude<CycleEvent["type"], "start">, CyclePhase[]> = {
  preflight_done: ["pick"],
  worktree_created: ["worktree"],
  worktree_failed: ["worktree"],
  story_picked: ["pick"],
  no_story: ["pick"],
  route_resolved: ["route"],
  agent_exited: ["execute"],
  facts_captured: ["reconcile"],
  published: ["publish"],
  merge_polled: ["merge-wait", "publish"],
  reconciled: ["reconcile"],
  cleaned: ["cleanup"],
};

/** Build a cycle:end RollEvent for a terminal status. */
export function cycleEndEvent(ctx: TerminalContext, outcome: V2CycleStatus, ts = 0): RollEvent {
  return {
    type: "cycle:end",
    cycleId: ctx.cycleId,
    outcome: mapV2Status(outcome),
    cost: zeroCost(ctx),
    ts,
  };
}

/** A zero-cost placeholder (the cost ledger is folded by cost/tracker.ts). */
function zeroCost(ctx: TerminalContext): CycleCost {
  return {
    cycleId: ctx.cycleId,
    agent: ctx.agent,
    model: ctx.model,
    tokensIn: 0,
    tokensOut: 0,
    estimatedCost: 0,
    revertCount: 0,
    effectiveCost: 0,
    // FIX-361: currency from model's price config; falls back to USD for unknown/empty.
    currency: ctx.model !== "" ? cycleCurrency(ctx.model) : "USD",
  };
}

/** Terminal context from a cycle state (best-effort defaults for unrouted cycles). */
function terminalCtx(state: CycleState): TerminalContext {
  return {
    cycleId: state.ctx.cycleId,
    branch: state.ctx.branch,
    agent: state.ctx.agent ?? "",
    model: state.ctx.model ?? "",
  };
}

/** Move to a terminal cleanup state with the given status, emitting the terminal
 *  cycle:end + runs row + (when commits exist) the cleanup command. I8: a terminal
 *  event is ALWAYS emitted exactly once on the terminal transition. */
function terminate(
  state: CycleState,
  status: V2CycleStatus,
  extra: CycleCommand[] = [],
): StepResult {
  const tctx = terminalCtx(state);
  const commands: CycleCommand[] = [
    ...extra,
    { kind: "emit_event", event: cycleEndEvent(tctx, status) },
    { kind: "append_run", status, outcome: mapV2Status(status), cycleId: state.ctx.cycleId },
  ];
  return {
    state: { ...state, phase: "cleanup", terminal: status, done: true },
    commands,
  };
}

/**
 * The pure cycle stepper — `(state, event) → { state, commands }`. Walks the
 * {@link CyclePhase} ladder in the v2 order (pick→route→worktree→execute→publish→
 * merge-wait→reconcile→cleanup), but mirrors v2's ACTUAL sequencing where the
 * worktree is created BEFORE the pick (the pick runs inside the worktree,
 * bin/roll:8938): phase `worktree` covers create→pick→route; `execute` runs the
 * agent (with the retry budget threaded via {@link retryPlan} by the caller, who
 * re-emits `agent_exited` per attempt); `reconcile` classifies + (optionally)
 * folds merge evidence; `cleanup` is terminal.
 *
 * Unhandled (phase, event) pairs are a no-op (state unchanged, no commands) so a
 * late/duplicate event from the adapter can never corrupt the walk (I8 resumable):
 * each event declares the phase(s) it is valid IN ({@link EVENT_VALID_PHASES}); an
 * event observed while the cycle is in any other phase (or already terminal) is
 * dropped. This is what makes the machine resumable from a persisted event stream
 * — a stale/replayed event from a crashed adapter is inert.
 */
export function cycleStep(state: CycleState, event: CycleEvent): StepResult {
  // Resumability guard (I2/I8): drop events that don't apply to the current phase
  // (or arrive after the cycle is terminal). `start` always applies (it RESETS).
  if (event.type !== "start") {
    if (state.done) return { state, commands: [] };
    const valid = EVENT_VALID_PHASES[event.type];
    // An unknown event type (e.g. a now-removed transition like the retired
    // `budget_ok`/`budget_check` replayed from a pre-upgrade persisted stream)
    // has no phase entry — treat it as inert, exactly like a stale/out-of-phase
    // event, rather than crashing the resumable replay.
    if (valid === undefined || !valid.includes(state.phase)) return { state, commands: [] };
    // Disambiguate the two `pick`-phase events: `preflight_done` only PRE-worktree,
    // `story_picked`/`no_story` only POST-worktree (the pick runs inside it).
    if (event.type === "preflight_done" && state.worktreeReady === true) return { state, commands: [] };
    if ((event.type === "story_picked" || event.type === "no_story") && state.worktreeReady !== true) {
      return { state, commands: [] };
    }
  }

  switch (event.type) {
    case "start":
      return {
        state: { ...state, phase: "pick", ctx: event.ctx, attempt: 0, worktreeReady: false, done: false },
        commands: [{ kind: "preflight" }],
      };

    case "preflight_done":
      return {
        state: { ...state, phase: "worktree" },
        commands: [{ kind: "create_worktree", branch: state.ctx.branch }],
      };

    case "worktree_created":
      // Worktree up → pick the next story INSIDE it (bin/roll:8938).
      return {
        state: { ...state, phase: "pick", worktreeReady: true },
        commands: [
          { kind: "emit_event", event: cycleStartEvent(state.ctx) },
          { kind: "pick_story" },
        ],
      };

    case "worktree_failed":
      // Setup failed before story pick / agent spawn. Cleanup is tolerant, so it
      // is safe for both git-worktree-add failure and post-create bootstrap
      // failure; no cycle:start was emitted, but a terminal runs row is written.
      return terminate({ ...state, phase: "worktree" }, "failed", [
        { kind: "cleanup_worktree", branch: state.ctx.branch },
      ]);

    case "no_story":
      // Nothing pickable → idle terminal (clean no-op; worktree reclaimed).
      return terminate({ ...state, phase: "pick" }, "idle", [
        { kind: "cleanup_worktree", branch: state.ctx.branch },
      ]);

    case "story_picked":
      // RESUME-PRIOR-WORK is decided HERE, not at create_worktree: the picker
      // reads the backlog INSIDE the worktree (FIX-198/FIX-204C), so the story id
      // is only known AFTER the worktree exists. The worktree was created on
      // origin/main (the fresh-context default); now that we have the picked
      // story, `resume_worktree` consults resolveResumeBase(storyId) and — only
      // when a resumable un-merged branch cleanly rebases — RE-POINTS the worktree
      // to it (fetch + reset --hard) so the agent resumes the prior product code.
      // It runs BEFORE resolve_route → spawn_agent (commands execute in order), so
      // the worktree carries the resume tree by the time the agent spawns. When no
      // resume branch exists it is a clean no-op (worktree stays on origin/main).
      return {
        state: { ...state, phase: "route", ctx: { ...state.ctx, storyId: event.storyId } },
        commands: [
          { kind: "resume_worktree", storyId: event.storyId },
          { kind: "resolve_route", storyId: event.storyId },
        ],
      };

    case "route_resolved":
      // The cost/budget gate is REMOVED — the loop no longer stops on a dollar
      // ceiling. Route resolves straight into the agent spawn (the progress
      // guardrails in loop-go now own runaway-spend protection).
      return {
        state: {
          ...state,
          phase: "execute",
          attempt: 1,
          ctx: { ...state.ctx, agent: event.agent, model: event.model },
        },
        commands: [{ kind: "spawn_agent", agent: event.agent, attempt: 1 }],
      };

    case "agent_exited": {
      const plan = retryPlan({ attempt: state.attempt, exit: event.exit, timedOut: event.timedOut });
      if (plan.action === "abort_timeout") {
        // Watchdog breach → clean teardown (worktree PRESERVED, bin/roll:9122).
        return {
          state: { ...state, phase: "execute", terminal: "blocked", done: true },
          commands: timeoutTeardownCommands(terminalCtx(state)),
        };
      }
      if (plan.action === "retry") {
        return {
          state: { ...state, phase: "execute", attempt: plan.nextAttempt },
          commands: [
            { kind: "sleep_backoff", seconds: plan.backoffSec },
            { kind: "spawn_agent", agent: state.ctx.agent ?? "", attempt: plan.nextAttempt },
          ],
        };
      }
      if (plan.action === "exhausted") {
        // Retry budget spent → failed (NEVER agent-swap, I6).
        return terminate({ ...state, phase: "execute" }, "failed", [
          { kind: "append_alert", message: `cycle ${state.ctx.cycleId}: agent exited ${event.exit} after retries; worktree preserved` },
        ]);
      }
      // accept → capture facts before publish.
      return {
        state: { ...state, phase: "reconcile" },
        commands: [{ kind: "capture_facts" }],
      };
    }

    case "facts_captured": {
      const status = classifyCaptured(event.facts);
      const next = { ...state, phase: "reconcile" as CyclePhase, captured: event.facts };
      if (status !== "built") {
        // idle → clean + terminal; failed/blocked → terminal (no publish).
        // idle: nothing to keep. published (FIX-244): branch + PR are on the
        // remote — keep the worktree too would strand it (FIX-247's lesson).
        // failed WITH commits (FIX-247 AC1): a gate-kill is not a discard —
        // push the branch so the work is reachable on the remote, and say so.
        // Ruling (AC2): the next cycle does NOT auto-reuse stranded work —
        // I12's fresh-context contract stands; rescue is a human decision on
        // an auditable branch.
        const extra: CycleCommand[] =
          status === "idle" || status === "published"
            ? [{ kind: "cleanup_worktree", branch: state.ctx.branch }]
            : status === "gave_up"
              ? // Hook 1: an agent ran but produced nothing — clean the (empty)
                // worktree AND ALERT on the FIRST occurrence (no 2-hit streak).
                // failed-class, so the terminal runs revertPrematureDone.
                [
                  { kind: "cleanup_worktree", branch: state.ctx.branch },
                  {
                    kind: "append_alert",
                    message: `cycle ${state.ctx.cycleId}: agent executed but produced 0 commits and no delivery — gave_up (productivity floor); story left re-pickable, spec truth reset`,
                  },
                ]
            : status === "failed" && (event.facts.mainAhead ?? 0) > 0
              ? [
                  {
                    kind: "append_alert",
                    message: `cycle ${state.ctx.cycleId}: local main is ahead of origin/main by ${event.facts.mainAhead} commit(s) while cycle branch has ${event.facts.commitsAhead} commit(s); leaving state untouched for rescue (FIX-252)`,
                  },
                ]
            : status === "failed" && event.facts.commitsAhead > 0
              ? [
                  { kind: "push_orphan", branch: state.ctx.branch },
                  {
                    kind: "append_alert",
                    message: `cycle ${state.ctx.cycleId}: gate-killed with ${event.facts.commitsAhead} commit(s) — branch ${state.ctx.branch} pushed for audit/rescue; next cycle starts fresh by design (FIX-247)`,
                  },
                ]
              : [];
        return terminate(next, status, extra);
      }
      // built → publish ladder.
      return {
        state: { ...next, phase: "publish" },
        commands: [{ kind: "publish_pr", branch: state.ctx.branch, docOnly: false }],
      };
    }

    case "published": {
      const status = classifyPublish(event.result);
      if (status === "published" || status === "done") {
        // Published (PR open, merge → PR Loop, US-AUTO-044) or locally
        // ff-merged (gh-missing tier → done) → clean worktree → terminal.
        return terminate({ ...state, phase: "cleanup" }, status, [
          { kind: "cleanup_worktree", branch: state.ctx.branch },
        ]);
      }
      if (status === "orphan") {
        // Commits pushed for audit; worktree cleaned (bin/roll:9333).
        return terminate({ ...state, phase: "cleanup" }, "orphan", [
          { kind: "cleanup_worktree", branch: state.ctx.branch },
          { kind: "append_alert", message: `cycle ${state.ctx.cycleId}: publish failed; orphan branch+tag pushed; worktree cleaned` },
        ]);
      }
      // FIX-351: a `built` (gates-passed) cycle whose publish could not complete
      // and whose orphan branch was not pushed is `local` (→ unpublished), NOT
      // failed — the work is sound and committed; only the publish step did not
      // land. Worktree PRESERVED (bin/roll:9337) so the local commits are
      // recoverable; the dashboard renders this neutrally, not red.
      return terminate({ ...state, phase: "publish" }, "local", [
        { kind: "append_alert", message: `cycle ${state.ctx.cycleId}: gates passed but publish did not complete — work committed locally, worktree preserved at branch ${state.ctx.branch} (unpublished, not a failure)` },
      ]);
    }

    case "merge_polled": {
      // Optional SYNCHRONOUS merge-wait (the card's "等真合并"): drive nextWaitAction.
      const action: WaitAction = nextWaitAction(event.state, event.elapsedSec);
      if (action.kind === "wait") {
        return {
          state: { ...state, phase: "merge-wait" },
          commands: [{ kind: "wait_merge", branch: state.ctx.branch, elapsedSec: event.elapsedSec + action.sleepSeconds }],
        };
      }
      if (action.kind === "merged") {
        return terminate({ ...state, phase: "reconcile" }, "done", [
          { kind: "reconcile" },
          { kind: "cleanup_worktree", branch: state.ctx.branch },
        ]);
      }
      // closed | timeout → the PR never merged; orphan-preserve (audit).
      return terminate({ ...state, phase: "merge-wait" }, "orphan", [
        { kind: "push_orphan", branch: state.ctx.branch },
      ]);
    }

    default:
      // No-op for events that don't apply to the current phase (resumable, I8).
      return { state, commands: [] };
  }
}

/** Build the cycle:start RollEvent (bin/roll:8929 `_loop_event cycle_start`). */
export function cycleStartEvent(ctx: CycleContext, ts = 0): RollEvent {
  return {
    type: "cycle:start",
    cycleId: ctx.cycleId,
    storyId: ctx.storyId ?? "",
    agent: ctx.agent ?? "",
    model: ctx.model ?? "",
    ts,
  };
}

/** Build a fresh initial cycle state (phase `pick`, attempt 0, not done). */
export function initialCycleState(ctx: CycleContext): CycleState {
  return { phase: "pick", ctx, attempt: 0, done: false };
}

// ── Event-sourcing fold (I8: rebuild terminal state from the event stream) ────

/** The terminal state rebuilt from a cycle's RollEvent stream. */
export interface RebuiltCycle {
  cycleId?: string;
  storyId?: string;
  agent?: AgentId;
  /** The terminal outcome from the LAST cycle:end (undefined ⇒ never ended). */
  outcome?: TerminalOutcome;
  /** Phases entered, in order (from cycle:phase events). */
  phases: CyclePhase[];
  /** True once a cycle:end was seen (terminal event written — I8). */
  ended: boolean;
}

/**
 * Fold a cycle's RollEvent stream into its terminal state (I8: all state rebuilds
 * from the published stream, no cache). A SIGKILL mid-phase leaves no cycle:end,
 * so `ended === false` — the caller's recovery layer (loop/recovery.ts) heals it.
 * The LAST cycle:end wins (idempotent re-emission is safe). Pure fold over events
 * already parsed by spec {@link parseEventLine} (the round-trip the tests assert).
 */
export function foldCycle(events: readonly RollEvent[]): RebuiltCycle {
  const out: RebuiltCycle = { phases: [], ended: false };
  for (const ev of events) {
    switch (ev.type) {
      case "cycle:start":
        out.cycleId = ev.cycleId;
        out.storyId = ev.storyId;
        out.agent = ev.agent;
        break;
      case "cycle:phase":
        out.phases.push(ev.phase);
        break;
      case "cycle:end":
        out.cycleId = ev.cycleId;
        out.outcome = ev.outcome;
        out.ended = true;
        break;
      default:
        break;
    }
  }
  return out;
}
