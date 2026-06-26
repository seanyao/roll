/**
 * `roll loop run-once` — TS-first single-cycle runner (US-LOOP runner adapter,
 * prerequisite for US-LOOP-006 v2-vs-v3 parallel verification).
 *
 * Two modes:
 *   - `--dry-run` : print the command PLAN the cycle would execute (the
 *     orchestrator's command→executor mapping), WITHOUT touching git / gh / the
 *     agent. Used by the parallel-verification protocol to preview the walk.
 *   - default     : acquire the inner lock, walk the orchestrator to terminal via
 *     {@link runCycleOnce}, executing each command through the real Node ports.
 *
 * The handler stays thin: it resolves the project identity + runtime paths and
 * delegates the entire walk to the runner adapter (packages/cli/src/runner).
 */
import { EventBus, assessBacklog, cycleEndEvent, firstInstalledAgent, mapV2Status, markStatus, parseBacklog, parsePolicy, readSlotFromText, shouldResize, shouldSuppressDormancy, type AgentSlot, type BacklogItem, type RouteDeps, type RouteSlot } from "@roll/core";
import { STATUS_MARKER, absent, buildTerminalEvent, deriveOrphanVerdict, present, type BacklogReason } from "@roll/spec";
import { createScheduler, launchdLabel, projectIdentity, readLockOwner, releaseLock } from "@roll/infra";
import { dormantMarkerPath, resolveLoopRunState, writeDormantMarker } from "./loop-sched.js";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type RunnerPaths, buildRunRow, dryRunPlan, killLiveAgents, nodePorts, realAgentSpawn, runCycleOnce } from "../runner/index.js";
import { clearCardFailure, recordCardFailure } from "../runner/skip-cards.js";
import { addPendingPublish, removePendingPublish } from "../runner/pending-publish.js";
import { autoRecoverEnabled, clearSelfHeal, selfHealBudget } from "../runner/selfheal-budget.js";
import { maybeSwitchAgent } from "../runner/selfheal-switch.js";
import { loopExhaustionSplitCommand } from "./loop-exhaustion-split.js";
import { routerEstMin } from "../runner/executor.js";
import { readBacklogRow } from "./attest.js";
import { warnIfBinaryStale } from "../runner/binary-staleness.js";
import { rollVersion } from "./version.js";
import { rollHome } from "./setup-shared.js";
import { applyCorrectionCircuitBreaker } from "../runner/correction-circuit.js";
import { readSkillBody as readSkillBodyGeneric } from "../runner/skill-body.js";
import { realAgentEnv } from "./agent-list.js";
import { cardArchiveDir, reportFileName } from "../lib/archive.js";
import { readLatestResizeSignal } from "../lib/review-score.js";
import { loopReviewResizeCommand } from "./loop-review-resize.js";
import { filterByAllowedCards, parseAllowedCardsEnv } from "../lib/goal-progress.js";
import { writeLatestMorningReport } from "../lib/morning-report.js";
import { backfillMergedRuns } from "../lib/runs-backfill.js";
import { requireNetwork, tcpConnect } from "../lib/require-network.js";
import { gcCommand } from "./gc.js";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { resolveLang, t, v3Catalog } from "@roll/spec";

/** US-PORT-011: after a delivered cycle, surface the acceptance report —
 *  print its path always; auto-open in the browser unless the project is
 *  muted (mute-<slug> flag, same gate as the popup). Best-effort. */
export function announceReport(
  projectPath: string,
  slug: string,
  storyId: string,
  opener: (p: string) => void = (p) => {
    try {
      spawn("open", [p], { stdio: "ignore", detached: true }).unref();
    } catch {
      /* best-effort */
    }
  },
): string | null {
  if (storyId === "") return null;
  // US-META-002c: the card folder is the single home for the attest report.
  const report = join(cardArchiveDir(projectPath, storyId), "latest", reportFileName(storyId));
  if (!existsSync(report)) return null;
  process.stdout.write(`evidence: ${report}\n验收报告: ${report}\n`);
  const muted =
    existsSync(join(projectPath, ".roll", "loop", `mute-${slug}`)) ||
    existsSync(
      join(process.env["ROLL_SHARED_ROOT"] || join(process.env["HOME"] ?? "", ".shared", "roll"), "loop", `mute-${slug}`),
    );
  if (!muted) opener(report);
  return report;
}

/** FIX-237 — anchor the observation window to THIS cycle: truncate live.log
 *  and stamp the new cycle's header so a tail can never replay the previous
 *  cycle's transcript. Best-effort (observation must not block the cycle). */
export function resetLiveLog(runtimeDirPath: string, cycleId: string): void {
  try {
    writeFileSync(join(runtimeDirPath, "live.log"), `=== cycle ${cycleId} ===\n`, "utf8");
  } catch {
    /* best-effort */
  }
}

// ─── FIX-204D — signal teardown ───────────────────────────────────────────────

/** Injectable seams for {@link cycleSignalTeardown} (tests must not exit). */
export interface SignalTeardownDeps {
  killAgents?: (sig: NodeJS.Signals) => number;
  exit?: (code: number) => void;
  pid?: number;
  now?: () => number;
}

const SIGNUM: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };

/**
 * The I8 invariant ("a terminal cycle:end + runs row exists on EVERY exit
 * path") has a hole the 2026-06-06 first live run fell through: SIGTERM kills
 * the process without running `finally` — no terminal event, no runs row, a
 * dead-pid lock, an orphan worktree, and `loop status` swearing nothing ever
 * ran. This handler closes the hole for TERM/INT/HUP:
 *
 *   kill the in-flight agent → (iff WE own the inner lock) write the aborted
 *   cycle:end + runs row, release the lock → exit 128+signum.
 *
 * The lock-ownership guard matters twice over: a signal during the
 * skip-on-contention path must not touch the LIVE cycle's state, and a signal
 * after a clean terminal (lock already released) must not double-write.
 */
export function cycleSignalTeardown(
  paths: Pick<RunnerPaths, "eventsPath" | "runsPath" | "lockPath">,
  cycleId: string,
  branch: string,
  sig: NodeJS.Signals,
  deps: SignalTeardownDeps = {},
): void {
  const kill = deps.killAgents ?? killLiveAgents;
  const exit = deps.exit ?? ((c: number): void => process.exit(c));
  const pid = deps.pid ?? process.pid;
  const now = deps.now ?? ((): number => Math.floor(Date.now() / 1000));

  try {
    kill("SIGKILL");
  } catch {
    /* no agent in flight */
  }

  let owned = false;
  try {
    owned = existsSync(paths.lockPath) && readLockOwner(paths.lockPath)?.pid === pid;
  } catch {
    owned = false;
  }
  if (owned) {
    const bus = new EventBus();
    const tctx = { cycleId, branch, agent: "", model: "" };
    const terminalSec = now();
    try {
      bus.appendEvent(paths.eventsPath, { ...cycleEndEvent(tctx, "aborted"), ts: terminalSec * 1000 });
    } catch {
      /* best-effort: the exit below still happens */
    }
    try {
      bus.upsertRun(
        paths.runsPath,
        { storyId: "", cycleId },
        buildRunRow(
          { kind: "append_run", status: "aborted", outcome: mapV2Status("aborted"), cycleId },
          { cycleId, branch, loop: "ci" as never },
          terminalSec,
        ),
      );
    } catch {
      /* best-effort */
    }
    // US-TRUTH-001 AC4: the killed cycle still writes a DERIVABLE terminal
    // verdict — probe the branch for commits (best-effort; null = unknown)
    // instead of leaving a hole the dashboard guesses around.
    try {
      let commitsAhead: number | null = null;
      try {
        const raw = execFileSync("git", ["rev-list", "--count", `origin/main..${branch}`], {
          encoding: "utf8",
          timeout: 3000,
        }).trim();
        commitsAhead = Number.parseInt(raw, 10);
        if (!Number.isFinite(commitsAhead)) commitsAhead = null;
      } catch {
        commitsAhead = null;
      }
      const verdict =
        deriveOrphanVerdict({ pidAlive: false, commitsAhead, ageSec: 0, timeoutSec: 0 }) ?? "unknown";
      bus.appendEvent(
        paths.eventsPath,
        buildTerminalEvent({
          cycleId,
          storyId: "",
          agent: "",
          startedAt: terminalSec * 1000,
          endedAt: terminalSec * 1000,
          outcome: verdict,
          pr: absent("killed_before_publish"),
          branch: present(branch),
          commit: absent("killed_before_capture"),
          tcr: commitsAhead !== null ? present(commitsAhead) : absent("probe_failed"),
          attest: absent("killed_before_capture"),
          usage: absent("killed_before_capture"),
          cost: absent("killed_before_capture"),
        }),
      );
    } catch {
      /* best-effort */
    }
    try {
      releaseLock(paths.lockPath);
    } catch {
      /* best-effort */
    }
  }
  process.stderr.write(
    `loop run-once: ${sig} — aborted terminal recorded, lock released, agent killed\n` +
      `loop run-once: 收到 ${sig} — 已补 aborted 终态、释放锁、终止 agent\n`,
  );
  exit(128 + (SIGNUM[sig] ?? 15));
}

/** Register TERM/INT/HUP teardown for one cycle; returns the disposer. */
export function installCycleSignalTeardown(
  paths: Pick<RunnerPaths, "eventsPath" | "runsPath" | "lockPath">,
  cycleId: string,
  branch: string,
): () => void {
  const sigs: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGHUP"];
  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const sig of sigs) {
    const h = (): void => cycleSignalTeardown(paths, cycleId, branch, sig);
    handlers.set(sig, h);
    process.on(sig, h);
  }
  return (): void => {
    for (const [sig, h] of handlers) process.removeListener(sig, h);
  };
}

/** Build the cycle id `<YYYYmmdd-HHMMSS>-<pid>` (mirrors bin/roll:8828). */
function makeCycleId(now = new Date(), pid = process.pid): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  const ts =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${ts}-${pid}`;
}

/** Resolve the `.roll/loop/` runtime dir (ROLL_PROJECT_RUNTIME_DIR override). */
function runtimeDir(projectPath: string): string {
  const env = (process.env["ROLL_PROJECT_RUNTIME_DIR"] ?? "").trim();
  return env !== "" ? env : join(projectPath, ".roll", "loop");
}

// ── FIX-216b: consecutive-failure auto-PAUSE ──────────────────────────────────

const PAUSE_THRESHOLD = 3;

// FIX-363 (loop resilience): after this many failures of the SAME card, skip-list
// the poison pill (the picker skips it) + reset the global counter so the loop
// keeps delivering OTHER cards instead of auto-PAUSING the whole loop on one bad
// card. Matched to PAUSE_THRESHOLD so a single repeatedly-failing card is isolated
// at the same point the whole loop would otherwise have paused.
const CARD_SKIP_THRESHOLD = 3;

/**
 * FIX-363: a card was just skip-listed (failed K times). Write an ACTIONABLE
 * alert so the owner knows WHICH card was parked and that the loop kept going —
 * instead of the loop silently auto-pausing on it. The card stays Todo; an owner
 * fixes it (or clears `.roll/loop/skip-cards.json`) to re-arm it.
 */
function writeCardSkipAlert(
  alertsPath: string,
  eventsPath: string,
  cycleId: string,
  storyId: string,
  count: number,
): void {
  const msg =
    `# ALERT — poison-pill card parked (loop kept running)\n\n` +
    `**Cycle**: ${cycleId}\n` +
    `**Card**: ${storyId}\n` +
    `**Reason**: failed ${count}× — skip-listed so the loop keeps delivering OTHER cards instead of pausing.\n` +
    `**Action**: investigate ${storyId} (it likely needs a smaller split, a spec fix, or manual delivery). ` +
    `Once addressed, remove it from \`.roll/loop/skip-cards.json\` (or just fix the card) to re-arm it.\n`;
  try {
    appendFileSync(alertsPath, `${msg}\n`, "utf8");
  } catch {
    /* best-effort */
  }
  try {
    new EventBus().appendEvent(eventsPath, {
      type: "alert:notify",
      channel: "loop-safety",
      message: `poison-pill card ${storyId} parked after ${count} failures — loop kept running`,
      ts: Date.now(),
    });
  } catch {
    /* best-effort */
  }
  process.stderr.write(
    `loop run-once: card ${storyId} failed ${count}× — skip-listed (loop keeps delivering other cards, not paused)\n`,
  );
}

/**
 * Increment the consecutive-failure counter for a project. If threshold is
 * reached, write a PAUSE marker and an alert so the scheduler skips future
 * ticks. Idempotent: a pre-existing PAUSE marker is not overwritten.
 */
function incrementConsecutiveFails(
  projectPath: string,
  slug: string,
  alertsPath: string,
  eventsPath: string,
  cycleId: string,
  storyId: string,
  terminal: string,
): void {
  const rt = runtimeDir(projectPath);
  const counterFile = join(rt, "consecutive-fails");
  let count = 0;
  try {
    if (existsSync(counterFile)) {
      count = parseInt(readFileSync(counterFile, "utf8").trim(), 10) || 0;
    }
  } catch { /* best-effort */ }
  count += 1;
  try {
    writeFileSync(counterFile, String(count), "utf8");
  } catch { /* best-effort */ }

  const threshold = readFailurePauseThreshold(projectPath);
  if (count < threshold) return;

  const pauseMarker = join(projectPath, ".roll", "loop", `PAUSE-${slug}`);
  if (existsSync(pauseMarker)) return;
  const alertMsg =
    `# ALERT — loop auto-paused after ${count} consecutive failures\n\n` +
    `**Cycle**: ${cycleId}\n` +
    `**Story**: ${storyId}\n` +
    `**Terminal**: ${terminal}\n` +
    `**Action**: ${count} consecutive cycles failed — loop paused to prevent burn.\n` +
    `  Resolve the root cause, then: \`roll loop resume\`\n`;
  try {
    writeFileSync(pauseMarker, alertMsg, "utf8");
    appendFileSync(alertsPath, `${alertMsg}\n`, "utf8");
    const ts = Date.now();
    const bus = new EventBus();
    bus.appendEvent(eventsPath, {
      type: "policy:safety_pause",
      loop: "ci",
      reason: `consecutive failures ${count} >= ${threshold}`,
      ts,
    });
    bus.appendEvent(eventsPath, {
      type: "alert:notify",
      channel: "loop-safety",
      message: `loop auto-paused after ${count} consecutive failures`,
      ts,
    });
  } catch { /* best-effort */ }
  process.stderr.write(
    `loop run-once: auto-PAUSED after ${count} consecutive failures — PAUSE marker written\n` +
      `loop run-once: 连续 ${count} 次失败后自动暂停 — 已写 PAUSE 标记\n`,
  );
}

function readFailurePauseThreshold(projectPath: string): number {
  try {
    const policy = join(projectPath, ".roll", "policy.yaml");
    if (!existsSync(policy)) return PAUSE_THRESHOLD;
    return parsePolicy(readFileSync(policy, "utf8")).loopSafety.maxConsecutiveFailures;
  } catch {
    return PAUSE_THRESHOLD;
  }
}

/** Reset the consecutive-failure counter (called on a successful delivery). */
function resetConsecutiveFails(projectPath: string): void {
  const rt = runtimeDir(projectPath);
  try {
    writeFileSync(join(rt, "consecutive-fails"), "0", "utf8");
  } catch { /* best-effort */ }
}

/**
 * FIX-931: hand an agent-exhausted card to the auto-splitter — $roll-design mints
 * smaller sub-stories the agents CAN build, then self-downgrade parks the parent
 * 🚫 Hold (or ALERTs on an irreducible/cap-hit card for human triage). Best-effort
 * productive upgrade over the skip-list floor: a split miss is non-fatal (the
 * card stays skip-listed/isolated either way).
 */
async function autoSplitOnExhaustion(storyId: string, failCount: number): Promise<void> {
  process.stdout.write(
    `loop run-once: ${storyId} — agents exhausted (${failCount} failed cycles) → auto-split (FIX-931)\n` +
      `loop run-once: ${storyId} — 代理全部耗尽(${failCount} 次失败)→ 自动拆卡(FIX-931)\n`,
  );
  try {
    await loopExhaustionSplitCommand([storyId, `${failCount} failed cycles`]);
  } catch {
    /* best-effort: the skip-list floor already isolated the card */
  }
}

// ── US-LOOP-079h1: consecutive-idle counter ───────────────────────────────────

/** Consecutive-idle counter file path (per-project, per-slug suffix). */
export function idleCounterPath(projectPath: string, slug: string): string {
  return join(runtimeDir(projectPath), `consecutive-idle-${slug}`);
}

/**
 * Increment the consecutive-idle counter. Returns the new count.
 * AC3: corrupt / unreadable / non-numeric → treated as 0.
 */
export function incrementConsecutiveIdle(projectPath: string, slug: string): number {
  const file = idleCounterPath(projectPath, slug);
  let count = 0;
  try {
    if (existsSync(file)) {
      count = parseInt(readFileSync(file, "utf8").trim(), 10) || 0;
    }
  } catch {
    /* AC3: corrupt / unreadable → 0 */
  }
  count += 1;
  try {
    writeFileSync(file, String(count), "utf8");
  } catch {
    /* best-effort */
  }
  return count;
}

/**
 * Reset the consecutive-idle counter to 0 (called on non-idle terminal).
 * AC1: any non-idle terminal (delivered/failed/blocked) resets the counter.
 */
export function resetConsecutiveIdle(projectPath: string, slug: string): void {
  const file = idleCounterPath(projectPath, slug);
  try {
    writeFileSync(file, "0", "utf8");
  } catch {
    /* best-effort */
  }
}

// ─── US-LOOP-079h2: enter-dormancy decision ──────────────────────────────────

/** Consecutive-idle count that triggers DORMANT. Mirrors PAUSE_THRESHOLD. */
const DORMANCY_THRESHOLD = 3;

/**
 * Backlog reasons that DO enter DORMANT: no eligible work AND the idle is not
 * temporary. These all have todoCount === 0 (every "stay active" reason —
 * blocked-by-deps / awaiting-merge / merged-pending / skip-listed — has
 * todoCount > 0), so `assessBacklog` returns one of these via the histogram
 * regardless of the open-PR/merged/skip predicates. That is WHY run-once can
 * call `assessBacklog` with DEFAULT opts here: when any todo exists, default
 * opts make it look eligible → hasWork=true → we stay ACTIVE (the conservative
 * behaviour US-LOOP-079k wants); only a genuinely drained backlog dorms.
 */
const DEEP_SLEEP_REASONS: ReadonlySet<BacklogReason> = new Set<BacklogReason>([
  "all_done",
  "backlog_empty",
  "all_in_progress",
]);

export type DormancyOutcome = "active" | "dormant" | "dormant_failed";

/**
 * The dormancy decision (US-LOOP-079h2). PURE over its injected deps so the AC
 * matrix is deterministic (no real launchctl / clock / fs). On `>= threshold`
 * consecutive idles with a deep-sleep reason it bootouts the loop lane, writes
 * the DORMANT marker + `loop:dormant` event, and upserts a `dormant_entered`
 * run row (which supersedes the cycle's `idle_no_work` row via readRuns
 * last-wins by (story_id, cycle_id)). A bootout failure degrades to a PAUSE
 * marker + observable `loop:dormant_failed` event and writes NO
 * `dormant_entered` row (never a "row says dormant but lane still armed" split).
 * The wake-epoch guard (AC7) is satisfied without a separate marker: US-LOOP-079i
 * resets the idle counter on rearm, so the first post-wake idle cycle sits below
 * the threshold and cannot re-dorm in the same epoch.
 */
export async function maybeEnterDormancy(deps: {
  slug: string;
  count: number;
  threshold?: number;
  resolveState: () => "PAUSED" | "DORMANT" | "ACTIVE";
  readBacklog: () => string;
  assess?: (items: BacklogItem[]) => { hasWork: boolean; reason: BacklogReason };
  scheduler: { dormant: (label: string) => Promise<boolean> };
  loopLabel: string;
  now: () => string;
  emit: (event: Record<string, unknown>) => void;
  writeDormant: (body: { since: string; reason: BacklogReason }) => void;
  upsertDormantRun: () => void;
  writePause: (reason: string) => void;
}): Promise<DormancyOutcome> {
  const threshold = deps.threshold ?? DORMANCY_THRESHOLD;
  if (deps.count < threshold) return "active"; // anti-flap: need N consecutive idles
  if (deps.resolveState() !== "ACTIVE") return "active"; // already PAUSED/DORMANT (precedence)
  const assess = deps.assess ?? ((items: BacklogItem[]) => assessBacklog(items));
  const { hasWork, reason } = assess(parseBacklog(deps.readBacklog()));
  if (hasWork) return "active";
  if (shouldSuppressDormancy(reason)) return "active"; // e.g. all_awaiting_merge — PR will merge
  if (!DEEP_SLEEP_REASONS.has(reason)) return "active"; // e.g. all_blocked_by_deps — deps may complete
  const since = deps.now();
  let ok = false;
  try {
    ok = await deps.scheduler.dormant(deps.loopLabel);
  } catch {
    ok = false;
  }
  if (!ok) {
    // §8 bootout failure → PAUSE fallback + observable alert; NO dormant_entered.
    deps.writePause(`dormancy bootout failed (reason=${reason})`);
    deps.emit({ type: "loop:dormant_failed", loop: deps.slug, reason, error: "bootout_failed", ts: Date.parse(since) });
    return "dormant_failed";
  }
  deps.writeDormant({ since, reason });
  deps.emit({ type: "loop:dormant", loop: deps.slug, reason, since, ts: Date.parse(since) });
  deps.upsertDormantRun(); // supersedes idle_no_work (readRuns last-wins by key)
  return "dormant";
}

export function shouldSuppressGoalChildFailureCounter(input: {
  isGoalChild: boolean;
  terminal: string | undefined;
  tcrCount: number | undefined;
}): boolean {
  return input.isGoalChild && (input.terminal === "failed" || input.terminal === "blocked") && input.tcrCount === 0;
}

/**
 * FIX-363/FIX-404: scan THIS cycle's events for an external agent block
 * (`agent:blocked` auth/network, emitted by build/review/score paths). A failed
 * cycle caused by such a block is an EXTERNAL failure — not logged in / network
 * down — not slow or buggy code, so it must NOT feed the consecutive-CODE-failure
 * auto-PAUSE (which tells the owner to hunt a phantom bug). AUTH wins over NETWORK
 * (the more actionable, non-self-healing cause).
 */
export function readExternalBlock(
  eventsPath: string,
  cycleId: string,
): { cause: "auth" | "network"; agents: string[]; details: string[] } | null {
  const auth: string[] = [];
  const network: string[] = [];
  const authDetails: string[] = [];
  const networkDetails: string[] = [];
  try {
    if (!existsSync(eventsPath)) return null;
    for (const line of readFileSync(eventsPath, "utf8").split("\n")) {
      if (line.trim() === "" || !line.includes("agent:blocked")) continue;
      let e: { type?: string; cycleId?: string; agent?: string; cause?: string; detail?: string };
      try {
        e = JSON.parse(line) as typeof e;
      } catch {
        continue;
      }
      if (e.type !== "agent:blocked" || e.cycleId !== cycleId || e.agent === undefined) continue;
      if (e.cause === "auth") {
        auth.push(e.agent);
        if (e.detail !== undefined && e.detail.trim() !== "") authDetails.push(e.detail.trim());
      } else if (e.cause === "network") {
        network.push(e.agent);
        if (e.detail !== undefined && e.detail.trim() !== "") networkDetails.push(e.detail.trim());
      }
    }
  } catch {
    return null;
  }
  const uniq = (xs: string[]): string[] => [...new Set(xs)];
  if (auth.length > 0) return { cause: "auth", agents: uniq(auth), details: uniq(authDetails) };
  if (network.length > 0) return { cause: "network", agents: uniq(network), details: uniq(networkDetails) };
  return null;
}

/**
 * FIX-363/FIX-404: act on an agent external block by CAUSE (the owner's "decide what to
 * do by the cause, don't just keep burning"):
 *   • AUTH    → PAUSE with an actionable "re-login" — it will NOT self-heal, so
 *               continuing to spin only burns cycles on a doomed review.
 *   • NETWORK → alert only, keep breathing — it self-heals when the VPN/proxy
 *               returns (mirrors the IDEA-001 offline degrade).
 * Either way the consecutive-CODE-failure counter is NOT ticked.
 */
function writeReviewerBlockedAlert(
  projectPath: string,
  slug: string,
  alertsPath: string,
  eventsPath: string,
  cycleId: string,
  block: { cause: "auth" | "network"; agents: string[]; details?: string[] },
): void {
  const agents = block.agents.join(", ");
  const details = (block.details ?? []).filter((d) => d.trim() !== "");
  const fix =
    block.cause === "auth"
      ? `Re-login the blocked agent(s): ${agents} (run each agent once interactively to re-authenticate), then: \`roll loop resume\``
      : `Check network / VPN / proxy (HTTP(S)_PROXY) — agent(s) ${agents} could not reach their API. The loop keeps breathing and recovers automatically once connectivity returns.`;
  const title =
    block.cause === "auth"
      ? "loop paused — agent credential/auth block (not a code bug)"
      : "agent network-blocked (not a code bug) — loop still breathing";
  const msg =
    `# ALERT — ${title}\n\n` +
    `**Cycle**: ${cycleId}\n` +
    `**Cause**: ${block.cause}\n` +
    `**Agent(s)**: ${agents}\n` +
    (details.length > 0 ? `**Detail**: ${details.join("; ")}\n` : "") +
    `**Action**: ${fix}\n`;
  try {
    appendFileSync(alertsPath, `${msg}\n`, "utf8");
  } catch {
    /* best-effort */
  }
  const bus = new EventBus();
  const ts = Date.now();
  try {
    bus.appendEvent(eventsPath, { type: "alert:notify", channel: "loop-safety", message: title, ts });
  } catch {
    /* best-effort */
  }
  if (block.cause === "auth") {
    const pauseMarker = join(projectPath, ".roll", "loop", `PAUSE-${slug}`);
    if (!existsSync(pauseMarker)) {
      try {
        writeFileSync(pauseMarker, msg, "utf8");
        bus.appendEvent(eventsPath, { type: "policy:safety_pause", loop: "ci", reason: `agent auth block: ${agents}`, ts });
      } catch {
        /* best-effort */
      }
    }
  }
  process.stderr.write(
    `loop run-once: agent ${block.cause} block (${agents}) — ${block.cause === "auth" ? "PAUSED (re-login then resume)" : "breathing (self-heals on reconnect)"}\n`,
  );
}

/**
 * Resolve + read the loop SKILL.md body the agent runs, frontmatter stripped.
 * Thin wrapper over the shared {@link readSkillBodyGeneric} pinned to the
 * `roll-loop` skill + the `ROLL_LOOP_SKILL` env override (FIX-204A lineage —
 * resolution order documented there).
 */
export function readSkillBody(projectPath: string): string | null {
  return readSkillBodyGeneric(projectPath, {
    skillName: "roll-loop",
    envOverride: process.env["ROLL_LOOP_SKILL"],
  });
}

/**
 * Build route deps mirroring bash `_loop_pick_agent_for_story`: the per-tier
 * slot comes from agents.yaml ONLY (the router walks tier → default →
 * firstInstalled). `local.yaml agent:` is NOT a tier override — in v2 it is
 * the single-agent default for non-loop contexts and the cold-start seed for
 * the `default` slot; consulting it per-slot would collapse all tiers to one
 * agent (FIX-223). `ROLL_LOOP_AGENT` is likewise routing OUTPUT consumed by
 * loop-fmt/dream, never a selection input.
 *
 * Exported for tests.
 */
export function buildLoopRouteDeps(projectPath: string): RouteDeps {
  function readSlot(slot: AgentSlot): RouteSlot | undefined {
    const agentsYaml = join(projectPath, ".roll", "agents.yaml");
    try {
      // readSlotFromText already returns `{ agent, model? }` — the router's
      // RouteSlot shape — so the model rides through unchanged.
      return readSlotFromText(readFileSync(agentsYaml, "utf8"), slot);
    } catch {
      return undefined; // agents.yaml missing — router falls through.
    }
  }

  function firstInstalled(): string | undefined {
    // Project single-agent default (only reached when agents.yaml gave the
    // router nothing for tier AND default), then the real installed-agent
    // scan (core mirrors bash `_first_installed_agent` order + probes).
    // undefined when nothing is installed — the router throws, like bash.
    const fromLocal = readField(join(projectPath, ".roll", "local.yaml"), /^agent:/);
    if (fromLocal !== undefined) return fromLocal;
    return firstInstalledAgent(realAgentEnv());
  }

  return { readSlot, firstInstalled };
}

/** Read the first matching field value from a YAML/text file. */
function readField(path: string, re: RegExp): string | undefined {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(re);
      if (m !== null) {
        const v = line.slice((m.index ?? 0) + m[0].length).trim();
        if (v !== "") return v.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // file missing — ok.
  }
  return undefined;
}

/** `roll loop run-once --help` usage. Bilingual on separate lines (EN then ZH). */
export const RUN_ONCE_USAGE =
  "Usage: roll loop run-once [--dry-run]\n" +
  "  Run ONE loop cycle now: pick a Todo card, build it through TCR, run the\n" +
  "  gates (attest + peer), and publish a PR. Exits when the cycle terminates.\n" +
  "  --dry-run   Print the command plan only — no git / gh / agent side effects.\n" +
  "立即跑一个 loop 周期:选一张 Todo 卡,经 TCR 建造,过闸(验收+同行评审),发 PR。\n" +
  "  --dry-run   只打印命令计划——不动 git / gh / agent。";

/**
 * The `loop run-once` entry. Returns a process exit code (0 ok).
 */
export async function loopRunOnceCommand(args: string[]): Promise<number> {
  // FIX-351: `--help`/`-h` must PRINT usage and exit — never start a cycle. This
  // guard runs BEFORE any side effect (project identity, lock, network probe,
  // agent spawn), so a help flag can never burn a cycle.
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${RUN_ONCE_USAGE}\n`);
    return 0;
  }
  const dryRun = args.includes("--dry-run");
  const id = await projectIdentity();
  const cycleId = makeCycleId();
  const branch = `loop/cycle-${cycleId}`;
  const ctx = { cycleId, branch, loop: "ci" as never };

  if (dryRun) {
    const plan = dryRunPlan(ctx);
    process.stdout.write(
      [
        `# roll loop run-once --dry-run`,
        `# project: ${id.slug}`,
        `# cycle:   ${cycleId}`,
        `# branch:  ${branch}`,
        "#",
        "# command plan (orchestrator → executor):",
        ...plan.map((l) => `  ${l}`),
        "",
        "(dry-run: nothing executed — no git / gh / agent side effects)",
        "",
      ].join("\n"),
    );
    return 0;
  }

  const rt = runtimeDir(id.path);
  // FIX-216a: alerts go to project-local .roll/loop/ALERT-<slug>.md —
  // same location `roll loop alert` reads from (FIX-052: per-project state).
  // The old `alerts.log` was a siloed file no consumer could find.
  const alertsPath = join(rt, `ALERT-${id.slug}.md`);
  mkdirSync(dirname(alertsPath), { recursive: true });

  const paths: RunnerPaths = {
    eventsPath: join(rt, "events.ndjson"),
    runsPath: join(rt, "runs.jsonl"),
    alertsPath,
    lockPath: join(rt, "inner.lock"),
    heartbeatPath: join(rt, "heartbeat"),
    worktreePath: join(rt, "worktrees", `cycle-${cycleId}`),
  };

  // FIX-1019: if a prior goal session (or the user) paused the loop, launchd
  // ticks must ALSO respect the PAUSE marker. Exit 0 so cron does not retry.
  if (isLoopPaused(id.path, id.slug)) {
    const lang = resolveLang({
      rollLang: process.env["ROLL_LANG"],
      lcAll: process.env["LC_ALL"],
      lang: process.env["LANG"],
    });
    const msg = t(v3Catalog, lang, "loop.paused_marker_present");
    process.stdout.write(`loop run-once: ${msg}\n`);
    return 0;
  }

  // FIX-298: the per-cycle network checkpoint is now the SHARED requireNetwork
  // guard (superseding the FIX-232 egress-only pre-check). As the FIRST thing a
  // cycle does — BEFORE acquiring the lock and burning agent tokens — it probes
  // connectivity; if blocked it runs the CONFIGURED proxy-enable hook and
  // re-checks. Only if it is STILL down (or nothing is configured) does the
  // cycle halt with an ALERT + clean exit. The guard's bilingual lines are
  // mirrored to both stderr and the per-cycle ALERT file (the FIX-232 behaviour).
  {
    const lang = resolveLang({
      rollLang: process.env["ROLL_LANG"],
      lcAll: process.env["LC_ALL"],
      lang: process.env["LANG"],
    });
    const guardLines: string[] = [];
    const net = await requireNetwork(`loop run-once (cycle ${cycleId})`, id.path, {
      lang,
      emit: (line) => {
        guardLines.push(line);
        process.stderr.write(`loop run-once: ${line}\n`);
      },
    });
    if (!net.ok) {
      // Preserve the per-cycle ALERT contract: write the egress-blocked headline
      // plus the guard's actionable reason to the ALERT file the dashboard reads.
      const headline = t(v3Catalog, lang, "loop.egress_blocked", cycleId);
      try {
        const ts = new Date().toISOString();
        appendFileSync(alertsPath, `[${ts}] ALERT ${headline}\n`, "utf8");
        for (const line of guardLines) appendFileSync(alertsPath, `[${ts}] ALERT ${line}\n`, "utf8");
      } catch {
        /* the stderr lines already fired */
      }
      return 1;
    }
  }

  // FIX-1019 / FIX-1020: before burning agent tokens, verify the project has a
  // pushable GitHub remote. Missing remote / unreachable repo → fast failure
  // with an actionable ALERT instead of N failed cycles.
  const repoCheck = checkRepoPushable(id.path);
  if (!repoCheck.ok) {
    writeRepoAlert(alertsPath, paths.eventsPath, cycleId, repoCheck);
    const lang = resolveLang({
      rollLang: process.env["ROLL_LANG"],
      lcAll: process.env["LC_ALL"],
      lang: process.env["LANG"],
    });
    const key =
      repoCheck.reason === "not_git"
        ? "loop.not_a_git_repo"
        : repoCheck.reason === "no_remote"
          ? "loop.no_remote"
          : "loop.repo_unreachable";
    process.stderr.write(
      `loop run-once: ${t(v3Catalog, lang, key)}\n` +
        `loop run-once: ${repoCheck.detail !== "" ? `(${repoCheck.detail})` : ""}\n`,
    );
    return 1;
  }

  // FIX-204A: an empty workflow document = a blind agent burning tokens for
  // nothing — halt loudly BEFORE any lock/worktree/agent side effect.
  const skillBody = readSkillBody(id.path);
  if (skillBody === null) {
    const msg =
      `[${new Date().toISOString()}] ALERT loop run-once: roll-loop SKILL.md not found ` +
      `(checked ROLL_LOOP_SKILL, .roll/skills/, skills/) — cycle ${cycleId} refused to start`;
    try {
      appendFileSync(alertsPath, `${msg}\n`, "utf8");
    } catch {
      /* the stderr line below still fires */
    }
    process.stderr.write(
      `loop run-once: roll-loop SKILL.md not found — refusing to spawn a blind agent (ALERT written)\n` +
        `loop run-once: 找不到 roll-loop SKILL.md — 拒绝盲开 agent(已写 ALERT)\n`,
    );
    // FIX-216b: SKILL-not-found is also a persistent failure — count it.
    incrementConsecutiveFails(id.path, id.slug, alertsPath, join(rt, "events.ndjson"), cycleId, "", "skill_missing");
    return 1;
  }

  // Resolve agent from the project's agents.yaml per tier, falling back to
  // local.yaml's single-agent default → first installed agent (the same chain
  // bash `_loop_pick_agent_for_story` walks).
  const routeDeps: RouteDeps = buildLoopRouteDeps(id.path);

  // FIX-220: manual `roll loop now` (ROLL_LOOP_FORCE=1) runs in an interactive
  // terminal — strip --verbose and --output-format stream-json so the user sees
  // readable text instead of a JSON flood.
  const isInteractive = (process.env["ROLL_LOOP_FORCE"] ?? "").trim() !== "";

  const basePorts = nodePorts({
    repoCwd: id.path,
    paths,
    skillBody,
    routeDeps,
    ...(isInteractive
      ? {
          agentSpawn: (agent: string, opts: Parameters<typeof realAgentSpawn>[1]) =>
            realAgentSpawn(agent, { ...opts, interactive: true }),
        }
      : {}),
  });
  const allowedCards = parseAllowedCardsEnv();
  const ports =
    allowedCards === undefined
      ? basePorts
      : {
          ...basePorts,
          backlog: {
            ...basePorts.backlog,
            read(projectCwd: string) {
              return filterByAllowedCards(basePorts.backlog.read(projectCwd), allowedCards);
            },
          },
        };

  // FIX-237: the observation window tails live.log — left over from the LAST
  // cycle it replays a stale transcript with old cycle ids (two misled debug
  // sessions). Reset it with this cycle's header before anything streams.
  resetLiveLog(rt, cycleId);

  // FIX-366 (part 2, optional/low-cost): if the global `roll` running the loop has
  // fallen behind the published release, emit ONE soft ALERT (the owner's shipped
  // fixes never reach an unattended-but-stale loop). Daily-cached remote check —
  // at most one network call per machine per day, fully best-effort, NEVER blocks
  // the cycle. A miss (offline / curl absent) is a silent no-op.
  try {
    await warnIfBinaryStale(rollHome(), rollVersion(), (msg) => {
      try {
        appendFileSync(alertsPath, `${msg}\n`, "utf8");
      } catch {
        /* best-effort */
      }
    });
  } catch {
    /* the staleness nudge must never topple or delay the cycle */
  }

  // FIX-204D: between here and the walk's own finally, signals get a clean
  // teardown instead of a half-state corpse.
  const disposeSignals = installCycleSignalTeardown(paths, cycleId, branch);
  let result;
  try {
    result = await runCycleOnce({ ports, ctx });
  } finally {
    disposeSignals();
  }
  if (!result.ran) {
    process.stdout.write(
      `loop run-once: another cycle holds the inner lock (pid ${result.heldByPid ?? "?"}); skipped\n`,
    );
    return 0;
  }
  process.stdout.write(`loop run-once: cycle ${cycleId} → ${result.terminal ?? "unknown"}\n`);

  // US-AGENT-041: reviewer-triggered re-split. If THIS cycle's independent
  // reviewer flagged the SCOPE as too large (a resize signal on a low score),
  // re-split the story via heterogeneous consensus instead of leaving it as a
  // low-confidence "done"/blocked. Fully ISOLATED: it fires ONLY when a resize
  // signal is present (a cheap note read; the common no-resize path is unchanged
  // and falls straight through), and when it fires it OWNS the post-cycle — it
  // parks the parent at 🚫 Hold + appends sub-stories (consensus agree) or
  // pauses + alerts (disagree), then returns. The chain-depth cap (US-AGENT-009)
  // and PR/branch close (I3) live in the reused `roll loop self-downgrade`.
  {
    const resizeStory = (result.state?.ctx?.storyId ?? "").trim();
    if (resizeStory !== "") {
      const sig = readLatestResizeSignal(id.path, resizeStory);
      if (sig !== null && shouldResize(sig.score, sig.resize)) {
        process.stdout.write(
          `loop run-once: reviewer flagged ${resizeStory} scope-too-large (score ${sig.score}) → review-resize\n` +
            `loop run-once: 评审判定 ${resizeStory} 范围过大(评分 ${sig.score})→ 触发再拆\n`,
        );
        await loopReviewResizeCommand([resizeStory]);
        return 0;
      }
    }
  }

  // US-PORT-011: delivered? surface the acceptance report (print + auto-open
  // unless muted) — the owner's "做完想看 attest html" loop closure.
  // FIX-244: "published" (PR open, merge pending) is a successful delivery for
  // loop-health purposes — announce + reset the failure streak; the merge-
  // evidence backfill (FIX-243) flips the runs row to merged once main proves it.
  if (result.terminal === "done" || result.terminal === "published") {
    const storyId = (result.state?.ctx?.storyId ?? "").trim();
    // FIX-1018: a delivered/published story is no longer pending-publish.
    if (storyId !== "") removePendingPublish(runtimeDir(id.path), storyId);
    announceReport(id.path, id.slug, storyId);
    resetConsecutiveFails(id.path);
    resetConsecutiveIdle(id.path, id.slug); // US-LOOP-079h1: delivered → reset idle counter
    clearCardFailure(runtimeDir(id.path), storyId); // FIX-363: a delivered card clears its poison-pill tally
    clearSelfHeal(runtimeDir(id.path), storyId); // FIX-930: genuine delivery resets the agent-rotation budget
  }
  if (result.terminal === "published") {
    process.stdout.write(
      "loop run-once: delivery published — PR open, merge pending (PR loop merges; backfill credits on merge evidence)\n" +
        "loop run-once: 交付已发布——PR 已开,等待合并(PR loop 负责合并;合并证据落地后由回填记账)\n",
    );
  }
  // FIX-351: a `local` cycle PASSED its gates (attest produced + peer ok, real
  // TCR commits) but its publish could not complete — the work is sound and
  // committed locally, it just never published. This is NOT a failure: surface
  // the acceptance report, reset the failure streak (sound work must clear a
  // prior streak and never accrue toward an auto-PAUSE), and exit 0.
  if (result.terminal === "local") {
    const storyId = (result.state?.ctx?.storyId ?? "").trim();
    // FIX-1018: remember that this story has sound but unpublished local work so
    // the next cycle does not re-implement it from scratch.
    if (storyId !== "") addPendingPublish(runtimeDir(id.path), storyId);
    announceReport(id.path, id.slug, storyId);
    resetConsecutiveFails(id.path);
    resetConsecutiveIdle(id.path, id.slug); // US-LOOP-079h1: delivered locally → reset idle counter
    clearCardFailure(runtimeDir(id.path), storyId); // FIX-363: sound local work clears the card's poison-pill tally
    clearSelfHeal(runtimeDir(id.path), storyId); // FIX-930: sound local delivery resets the agent-rotation budget
    process.stdout.write(
      "loop run-once: gates passed but publish did not complete — work committed locally on the branch, not published (unpublished, not a failure)\n" +
        "loop run-once: 闸已通过但未完成发布——工作已在分支上本地提交,尚未发布(未发布,非失败)\n",
    );
  }

  // US-LOOP-079d2: idle terminal passes through to run-once — explicit branch
  // provides a reachable hook for US-LOOP-079h2's dormant decision logic.
  // The runs row already carries status="idle" + outcome="idle_no_work"
  // (written by the executor's append_run). When dormant is not entered,
  // idle still ultimately lands as idle_no_work (regression on existing paths).
  if (result.terminal === "idle") {
    process.stdout.write(
      "loop run-once: idle — no work picked up this cycle\n" +
        "loop run-once: 空闲——本周期未拾取任务\n",
    );
    // idle outcomes are not failures — a no-work cycle is expected behaviour.
    // The consecutive-failure counter is NOT ticked.
    const idleCount = incrementConsecutiveIdle(id.path, id.slug); // US-LOOP-079h1: idle → increment counter
    // US-LOOP-079h2: after N consecutive idles with a drained backlog, self-unload
    // the loop lane (DORMANT) so the loop stops waking / writing idle_no_work.
    // Best-effort: dormancy must NEVER break the idle cycle.
    try {
      const bus = new EventBus();
      const backlogFile = join(id.path, ".roll", "backlog.md");
      const nowSec = Math.floor(Date.now() / 1000);
      const outcome = await maybeEnterDormancy({
        slug: id.slug,
        count: idleCount,
        resolveState: () => resolveLoopRunState(id.path, id.slug),
        readBacklog: () => (existsSync(backlogFile) ? readFileSync(backlogFile, "utf8") : ""),
        scheduler: createScheduler(process.platform, { uid: process.getuid?.() ?? 0 }),
        loopLabel: launchdLabel("loop", id.slug),
        now: () => new Date().toISOString(),
        emit: (event) => bus.appendEvent(paths.eventsPath, event as never),
        writeDormant: (body) => writeDormantMarker(dormantMarkerPath(id.path, id.slug), body),
        upsertDormantRun: () =>
          bus.upsertRun(
            paths.runsPath,
            { storyId: "", cycleId },
            buildRunRow(
              { kind: "append_run", status: "dormant", outcome: mapV2Status("dormant"), cycleId },
              { cycleId, branch, loop: "ci" as never },
              nowSec,
            ),
          ),
        writePause: (reason) => {
          const p = join(id.path, ".roll", "loop", `PAUSE-${id.slug}`);
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, `# loop paused — dormancy bootout failed\n\n${reason}\n`, "utf8");
        },
      });
      if (outcome === "dormant") {
        process.stdout.write(
          "loop run-once: backlog drained — entering DORMANT (lane unloaded; no further idle records)\n" +
            "loop run-once: backlog 抽干——进入休眠(已卸载 lane;此后不再产空转记录)\n",
        );
      }
    } catch {
      /* dormancy is best-effort — a failure here never breaks the idle cycle */
    }
    return 0;
  }

  // FIX-363/FIX-366: a cycle blocked by an EXTERNAL cause (an agent not logged in
  // / network down) is NOT a code failure — attribute it by CAUSE and act on it,
  // never tick the consecutive-CODE-failure counter (a misleading "3 failures →
  // resolve the code" pause sent the owner hunting a phantom bug when the real fix
  // is "re-login" / "reconnect the VPN"). Checked BEFORE the failure branch and
  // INDEPENDENT of the precise terminal, because an unauthenticated BUILDER (FIX-366,
  // `agent:blocked stage:build`) often exits 0 with zero commits → `gave_up`/idle,
  // NOT `failed` — yet auth MUST still PAUSE the loop (otherwise the bad login
  // re-triggers every cycle, "failed 换名继续烧"). One block taxonomy:
  // builder/reviewer/scorer auth signatures all land here. AUTH pauses; NETWORK
  // breathes (self-heals on reconnect). When present, this fully OWNS the cycle's
  // post-processing — the failure-counter path below is skipped.
  const externalBlock = readExternalBlock(paths.eventsPath, cycleId);
  const isFail = result.terminal === "failed" || result.terminal === "blocked";
  if (externalBlock !== null) {
    // FIX-366: surface an explicit auth_blocked / network_blocked outcome — a
    // RECOVERABLE block, distinct from a code `failed`.
    process.stdout.write(
      `loop run-once: cycle ${cycleId} → ${externalBlock.cause}_blocked (recoverable; ${externalBlock.cause === "auth" ? "re-login then resume" : "self-heals on reconnect"})\n` +
        `loop run-once: cycle ${cycleId} → ${externalBlock.cause}_blocked(可恢复阻塞;${externalBlock.cause === "auth" ? "重登录后 resume" : "联网后自愈"})\n`,
    );
    writeReviewerBlockedAlert(id.path, id.slug, alertsPath, paths.eventsPath, cycleId, externalBlock);
    // An auth block PAUSES (re-login needed); a network block breathes. Neither is
    // a consecutive-CODE-failure, and an auth PAUSE is the actionable terminal —
    // exit 0 so the schedule stops handing out new cards until `roll loop resume`.
    return externalBlock.cause === "auth" ? 0 : isFail ? 1 : 0;
  }

  // FIX-930: agent auto-switch on a ZERO-TCR cycle (the routed agent ran but
  // produced nothing — `gave_up` — or stalled into a no-progress `blocked`).
  // Before treating it as a failure, swap to the NEXT untried agent in the tier
  // chain: the loop must not die on a card just because the routed agent can't
  // build it (the exact trap that strands hard cards on pi overnight). Bounded by
  // the per-story self-heal budget + roster exhaustion. A managed swap re-marks
  // the story 📋 Todo (re-pickable; the route port excludes the tried agent next
  // cycle), records the tried agent, emits agent:retry, and returns 0 WITHOUT
  // ticking consecutive-fails — a self-heal is NOT a systemic failure. Placed
  // BEFORE the isFail block so a stalled `blocked` swap skips the failure tally.
  // Offline already short-circuited above is impossible (externalBlock owns auth/
  // network); a genuine offline failure is handled in the isFail block below.
  {
    const sid = (result.state?.ctx?.storyId ?? "").trim();
    const tcr = result.state?.ctx?.tcrCount ?? 0;
    const failedAgent = (result.state?.ctx?.agent ?? "").trim();
    const zeroTcr = tcr === 0 && (result.terminal === "gave_up" || result.terminal === "blocked");
    if (sid !== "" && failedAgent !== "" && zeroTcr) {
      const backlogFile = join(id.path, ".roll", "backlog.md");
      const bus = new EventBus();
      // FIX-932 kill-switch: only attempt the agent SWAP when auto-recovery is on.
      // ROLL_LOOP_NO_AUTO_RECOVER=1 skips switch + split entirely → the zero-TCR
      // cycle falls straight to the fail-fast floor (skip-list / isFail PAUSE).
      const swapped = autoRecoverEnabled()
        ? maybeSwitchAgent({
            runtimeDir: runtimeDir(id.path),
            storyId: sid,
            failedAgent,
            reason: result.terminal === "blocked" ? "stall" : "zero-tcr",
            // FIX-1026: spec frontmatter est_min drives the self-heal re-route
            // tier too, falling back to the backlog row.
            estMin: routerEstMin(id.path, sid, readBacklogRow(id.path, sid).description ?? ""),
            routeDeps,
            budget: selfHealBudget(),
            cycleId,
            now: () => Math.floor(Date.now() / 1000),
            emit: (ev) => bus.appendEvent(paths.eventsPath, ev as never),
            remarkTodo: (storyId) => {
              try {
                const content = readFileSync(backlogFile, "utf8");
                const r = markStatus(content, storyId, STATUS_MARKER.todo);
                if (r.count > 0) writeFileSync(backlogFile, r.content, "utf8");
              } catch {
                /* best-effort: a missed re-mark just leaves the row as-is */
              }
            },
          })
        : false;
      if (swapped) {
        resetConsecutiveIdle(id.path, id.slug); // a swap is activity, not idle
        process.stdout.write(
          `loop run-once: zero-TCR on ${sid} (${failedAgent}) — auto-switching agent next cycle (self-heal)\n` +
            `loop run-once: ${sid} 零产出(${failedAgent})——下一周期自动换代理(自愈)\n`,
        );
        return 0; // managed self-heal swap — never ticks consecutive-fails
      }
      // ANTI-OSCILLATION (FIX-930): the swap was NOT taken (budget/roster exhausted,
      // OR auto-recovery disabled). A `gave_up` reverts its row to 📋 Todo and the
      // route port would re-pick the same agent forever, so it MUST count toward the
      // poison-pill skip-list (FIX-363; `blocked` already gets this via isFail below).
      // The skip-list floor is the fail-fast isolation that holds whether or not
      // auto-recovery is enabled — it predates FIX-928.
      if (result.terminal === "gave_up") {
        const card = recordCardFailure(runtimeDir(id.path), sid, CARD_SKIP_THRESHOLD);
        if (card.nowSkipped) {
          writeCardSkipAlert(alertsPath, paths.eventsPath, cycleId, sid, card.count);
          resetConsecutiveFails(id.path);
          clearSelfHeal(runtimeDir(id.path), sid);
          // FIX-931/932: agents exhausted → auto-split into smaller sub-stories the
          // agents CAN build (parent → Hold), ONLY when auto-recovery is enabled.
          // Best-effort upgrade over the skip-list floor; irreducible → self-downgrade
          // ALERTs for human triage and the skip-list keeps the card isolated.
          if (autoRecoverEnabled()) await autoSplitOnExhaustion(sid, card.count);
        }
      }
    }
  }

  if (isFail) {
    // US-LOOP-079h1: any non-idle terminal resets the idle counter.
    resetConsecutiveIdle(id.path, id.slug);
    // IDEA-001: a cycle that failed while the network is unreachable is NOT a
    // delivery failure — the local work (TCR commits, green tests) is intact;
    // only push/PR could not happen. Degrade to local-only with a notice:
    // no consecutive-fails tick (offline must never accumulate into an
    // auto-PAUSE), exit 0 (the schedule keeps breathing; the next online
    // cycle's push/PR catches up naturally).
    if (await isOffline()) {
      process.stderr.write(
        "loop run-once: network unreachable — degraded to local-only delivery (commits stay on the branch; push/PR catch up when back online)\n" +
          "loop run-once: 网络不可达——已降级为本地交付（提交保留在分支上，联网后 push/PR 自然补上）\n",
      );
      return 0;
    }
    const suppressGoalZeroDelivery = shouldSuppressGoalChildFailureCounter({
      isGoalChild: (process.env["ROLL_LOOP_GO_CHILD"] ?? "") === "1",
      terminal: result.terminal,
      tcrCount: result.state?.ctx?.tcrCount,
    });
    if (!suppressGoalZeroDelivery) {
      const storyId = (result.state?.ctx?.storyId ?? "").trim();
      // FIX-363 (loop resilience): isolate a poison pill. After K failures of
      // the SAME card, skip-list it (the picker skips it next cycle) + alert +
      // RESET the global counter, so the loop keeps delivering OTHER cards
      // instead of auto-PAUSING the whole loop. The global PAUSE is now reserved
      // for genuinely SYSTEMIC failure (different cards failing in a row).
      const card = recordCardFailure(runtimeDir(id.path), storyId, CARD_SKIP_THRESHOLD);
      if (card.nowSkipped) {
        writeCardSkipAlert(alertsPath, paths.eventsPath, cycleId, storyId, card.count);
        resetConsecutiveFails(id.path);
        // FIX-931: a STALLED card (blocked = FIX-907 no-progress kill) that
        // exhausted all agents is a sizing problem the rigs can't chew → auto-split.
        // A generic `failed` (non-zero exit, a real code defect) stays skip-listed —
        // splitting won't fix a bug, only human/code investigation will.
        if (result.terminal === "blocked" && autoRecoverEnabled()) {
          clearSelfHeal(runtimeDir(id.path), storyId);
          await autoSplitOnExhaustion(storyId, card.count);
        }
      } else {
        incrementConsecutiveFails(id.path, id.slug, alertsPath, paths.eventsPath, cycleId, storyId, result.terminal ?? "unknown");
      }
    }
  }

  // FIX-243: merge-evidence backfill — claim-shaped rows (built/published/
  // failed) whose cycle branch's PR really MERGED flip to merged/delivered.
  // Best-effort + bounded (≤20 gh probes); never blocks the cycle terminal.
  try {
    const credited = await backfillMergedRuns(id.path, paths.runsPath);
    for (const c of credited) {
      process.stdout.write(
        `loop run-once: backfill credited cycle ${c.cycleId} → merged (${c.mergeCommit})\n` +
          `loop run-once: 回填记账 cycle ${c.cycleId} → 已合并 (${c.mergeCommit})\n`,
      );
    }
  } catch {
    /* backfill must never mask the cycle terminal result */
  }

  const breaker = applyCorrectionCircuitBreaker(id.path, id.slug, paths.eventsPath, alertsPath);
  if (breaker.status === "paused") {
    process.stderr.write(
      `loop run-once: correction circuit breaker paused the loop — ${breaker.verdict.reason}\n` +
        `loop run-once: 纠正熔断已暂停 loop — ${breaker.verdict.reason}\n`,
    );
  }
  try {
    writeLatestMorningReport(id.path, paths.eventsPath, paths.runsPath);
  } catch {
    /* morning report must never mask the cycle terminal result */
  }
  // REFACTOR-049 AC3: auto-gc after each loop cycle — best-effort, never blocks.
  autoGc(id.path);

  return isFail ? 1 : 0;
}

/**
 * REFACTOR-049 AC3 — auto-gc: age out old surplus attest runs after each
 * loop cycle. Silently best-effort; a failed gc write NEVER blocks the cycle
 * or increments the failure counter. Uses the default keep-latest/keep-days
 * strategy (the same as `roll gc` with no flags).
 */
function autoGc(projectPath: string): void {
  const save = process.cwd();
  try {
    process.chdir(projectPath);
    // Trap stdout so gc chatter doesn't leak into the cycle's cron.log.
    const realOut = process.stdout.write.bind(process.stdout);
    process.stdout.write = (): boolean => true;
    try {
      gcCommand([]);
    } finally {
      process.stdout.write = realOut;
    }
  } catch {
    /* gc is best-effort — a missing dir / permissions blip must never fail the cycle */
  } finally {
    try { process.chdir(save); } catch { /* best-effort */ }
  }
}

/**
 * IDEA-001 — offline probe: can we resolve github.com within 1.5s? DNS lookup
 * is the cheapest universal signal for "the network is gone" (a captive
 * portal can still fool it — acceptable for a degrade-notice heuristic).
 * The resolver is injectable for tests.
 */
export async function isOffline(
  resolve: (host: string) => Promise<unknown> = (h) => lookup(h),
): Promise<boolean> {
  try {
    await Promise.race([
      resolve("github.com"),
      new Promise((_, rej) => {
        const t = setTimeout(() => rej(new Error("dns timeout")), 1500);
        // Don't hold the process open for the probe timer.
        if (typeof t === "object") t.unref();
      }),
    ]);
    return false;
  } catch {
    return true;
  }
}

// FIX-298: `tcpConnect` is the SINGLE shared connectivity primitive — it lives
// in ../lib/require-network.ts and is re-exported here for the existing
// importers (egressBlocked below + its tests). One probe implementation, no
// duplicate.
export { tcpConnect };

/**
 * FIX-232 AC2 — lightweight egress pre-check. Before a cycle acquires the
 * inner lock and spawns an agent, verify that outbound connectivity to a
 * well-known endpoint is actually working. A poisoned proxy env (e.g.
 * launchctl setenv HTTP_PROXY=127.0.0.1:7897 from a closed proxy app) makes
 * DNS resolve but TCP connect fail — this catches that signature before the
 * agent burns 45s on a timeout.
 *
 * Returns `true` if egress is blocked (the cycle should halt with an ALERT),
 * `false` if the check passed (or was skipped — offline is NOT a block;
 * a plain offline is a degrade-notice, not a poison signal).
 *
 * The check is two-tier:
 *   1. DNS resolve github.com (the `isOffline` check Idea-001 already does).
 *   2. TCP connect to github.com:443 within 3s — catches proxy-poison where
 *      DNS works but the actual TCP connect is blocked. This uses Node's
 *      native socket timeout rather than GNU `timeout`, which macOS does not
 *      ship by default.
 *
 * On Darwin only (the launchctl proxy-poison is a macOS-specific vector).
 * On other platforms, skips (returns false) to avoid false positives.
 */
export async function egressBlocked(
  resolve: (host: string) => Promise<unknown> = (h) => lookup(h),
  tcpProbe: () => Promise<void> = () => tcpConnect("github.com", 443, 3000),
): Promise<boolean> {
  // Only relevant on Darwin — launchctl setenv is macOS-specific.
  if (process.platform !== "darwin") return false;

  // Tier 1: DNS — if DNS fails, we're offline entirely, not poisoned.
  // isOffline already handles this; a plain offline is not a proxy-block.
  const offline = await isOffline(resolve);
  if (offline) return false; // offline is not a poison signal — degrade, don't halt.

  // Tier 2: TCP connect to github.com:443. DNS succeeded but TCP may be
  // routed to a dead proxy or blocked egress. The probe itself must never
  // stall the cycle (>5s wall).
  try {
    await tcpProbe();
    return false; // TCP connect succeeded — egress is clear.
  } catch {
    // TCP connect failed — DNS worked but the actual connection didn't.
    // This is the proxy-poison signature: the dead proxy endpoint at
    // 127.0.0.1:7897 intercepts the connection attempt.
    return true;
  }
}

// ─── FIX-1019 / FIX-1020: repo pushability + pause persistence gates ──────────

/** True iff a PAUSE marker exists for this project/slug. */
function isLoopPaused(projectPath: string, slug: string): boolean {
  return existsSync(join(projectPath, ".roll", "loop", `PAUSE-${slug}`));
}

export interface RepoPushableResult {
  ok: boolean;
  reason: "ok" | "not_git" | "no_remote" | "ls_remote_failed";
  detail: string;
}

/**
 * FIX-1019: fail fast when the loop cannot push. Verifies:
 *   1. cwd is inside a git repository
 *   2. an `origin` remote exists
 *   3. `git ls-remote origin HEAD` succeeds (repo is reachable)
 *
 * This catches the "GitHub repo not created yet" case before the cycle burns
 * agent tokens on work that can never be published.
 */
export function checkRepoPushable(projectPath: string): RepoPushableResult {
  const git = (args: string[]): { code: number; stderr: string } => {
    const r = spawnSync("git", args, { cwd: projectPath, encoding: "utf8" });
    return { code: r.status ?? 1, stderr: r.stderr ?? "" };
  };

  const inside = git(["rev-parse", "--git-dir"]);
  if (inside.code !== 0) {
    return { ok: false, reason: "not_git", detail: inside.stderr.trim() };
  }

  const remote = git(["remote", "get-url", "origin"]);
  if (remote.code !== 0) {
    return { ok: false, reason: "no_remote", detail: remote.stderr.trim() };
  }

  const ls = git(["ls-remote", "origin", "HEAD"]);
  if (ls.code !== 0) {
    return { ok: false, reason: "ls_remote_failed", detail: ls.stderr.trim() };
  }

  return { ok: true, reason: "ok", detail: "" };
}

/**
 * Write an actionable repo-unreachable ALERT and emit a matching event.
 * Mirrors the ALERT contract used by the egress/skill-missing gates.
 */
function writeRepoAlert(
  alertsPath: string,
  eventsPath: string,
  cycleId: string,
  result: RepoPushableResult,
): void {
  const lang = resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });
  const key =
    result.reason === "not_git"
      ? "loop.not_a_git_repo"
      : result.reason === "no_remote"
        ? "loop.no_remote"
        : "loop.repo_unreachable";
  const headline = t(v3Catalog, lang, key);
  const detail = result.detail !== "" ? ` (${result.detail})` : "";
  const msg = `# ALERT — ${headline}${detail}\n\n**Cycle**: ${cycleId}\n**Action**: ${t(v3Catalog, lang, "loop.no_remote")}\n`;
  try {
    appendFileSync(alertsPath, `${msg}\n`, "utf8");
  } catch {
    /* best-effort */
  }
  try {
    new EventBus().appendEvent(eventsPath, {
      type: "alert:notify",
      channel: "loop-safety",
      message: `${headline}${detail}`,
      ts: Date.now(),
    });
  } catch {
    /* best-effort */
  }
}
