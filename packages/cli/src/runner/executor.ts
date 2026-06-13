/**
 * Runner adapter — the executable glue that lets the pure {@link cycleStep}
 * orchestrator actually drive a cycle (prerequisite for US-LOOP-006 v2-vs-v3
 * parallel verification).
 *
 * ── Architectural home (the card asked me to pick + justify) ─────────────────
 * The card suggests `packages/infra/src/runner/executor.ts` ("command EXECUTION
 * is infra"). I place it in `packages/cli/src/runner/` instead. Justification —
 * the established package arrow is strictly one-directional:
 *     @roll/spec  ←  @roll/core
 *     @roll/spec  ←  @roll/infra
 *     @roll/core + @roll/infra  ←  @roll/cli
 * `@roll/infra`'s package.json depends ONLY on `@roll/spec` (verified), and the
 * git/github/process modules document that the arrow into core stays
 * one-directional ("core already depends on no infra; keeping the arrow
 * one-directional", github.ts:531). The dispatcher MUST import BOTH the
 * orchestrator's {@link CycleCommand} vocabulary (lives in @roll/core) AND the
 * infra executors. Putting it in infra would force `@roll/infra → @roll/core`,
 * inverting the layer arrow and creating a core↔infra coupling the whole port
 * was designed to avoid. The cli is the one package that already sees both, so
 * the adapter belongs here. The CLI command handler stays a thin one-liner
 * (commands/index.ts) that delegates to {@link runCycleOnce}; all logic is in
 * this module — "cli stays thin" is honoured at the command layer.
 *
 * ── What this module is ──────────────────────────────────────────────────────
 * {@link executeCommand} is the 1:1 dispatcher: every {@link CycleCommand} the
 * orchestrator emits maps onto an existing infra call / core plan, via an
 * injectable {@link Ports} bundle (git / github / process / events / agentSpawn /
 * clock) so tests fake every execution layer (PATH shims + file:// remotes; no
 * real network / agent / PR side effects). `*_run`-style commands return a
 * {@link CycleEvent} to feed back into the next {@link cycleStep}.
 */
import {
  BacklogStore,
  agentsInstalled,
  type CapturedFacts,
  type CycleCommand,
  type CycleContext,
  type CycleEvent,
  EventBus,
  type PublishResult,
  type ReconcileRunRow,
  type RouteDeps,
  type RunKey,
  type Tier,
  budgetVerdict,
  classifyComplexity,
  decideClaimReconcile,
  latestDeliveringCycle,
  parseClaimedIdsFromBacklog,
  parseBacklog,
  pickStory,
  planPublishDocPr,
  planPublishPr,
  reconcileBranchName,
  resolveRoute,
  resolveFallback,
  extractUsage,
  sumClaudeStream,
  toCycleCost,
  pairingHistory,
  peerReviewCost,
} from "@roll/core";
import {
  parseEventLine,
  STATUS_MARKER,
  absent,
  buildTerminalEvent,
  present,
  type CycleCost,
  type FactOr,
  type RollEvent,
  type TerminalAttestFact,
  type TerminalEvent,
  type TerminalOutcome,
  type TerminalUsageFact,
} from "@roll/spec";
import {
  type Clock,
  acquireLock,
  ghRepoSlug,
  prViewState,
  releaseLock,
  remoteUrl,
  captureFromMarker,
  openEvidenceFrame,
  parseCaptureMarker,
  runPublishPlan,
  systemClock,
  writeHeartbeat,
  worktreeAdd,
  worktreeFetchOrigin,
  worktreeRemove,
  push as gitPush,
  type CaptureMarker,
  type ScreenshotResult,
} from "@roll/infra";
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  type AgentSpawn,
  realAgentSpawn,
} from "./agent-spawn.js";
import { cycleChangedFiles, runPeerGate } from "./peer-gate.js";
import { readAttestGateMode, runAttestGate, verificationReportPath } from "./attest-gate.js";
import { recoverPiUsage } from "./usage-recovery.js";
import { realBudgetCheck } from "./budget-check.js";
import { ACMAP_REMEDIATION_TIMEOUT_MS, acMapPath, buildAcMapRemediationPrompt, needsAcMapRemediation } from "./attest-remediation.js";
import { applyCorrectionAction } from "./correction-actuator.js";
import { buildPairScorePrompt, enabledPairingStages, parsePairScoreOutput, runPairing, runScorePairing, type PairEvent, type PairReview } from "./pairing-gate.js";
import { realAgentEnv } from "../commands/agent-list.js";
import { attestCommand } from "../commands/attest.js";
import { refreshAggregates } from "../commands/index-gen.js";
import { cardArchiveDir, mountExecutionAtPublish } from "../lib/archive.js";

const execFileAsync = promisify(execFile);

/** The injectable wall clock (epoch seconds) — infra's {@link Clock}. */
export type ProcessClock = Clock;

// ── Ports bundle (the injectable execution surface) ───────────────────────────

/**
 * Git operations the executor needs — a thin facet of @roll/infra's git module
 * so tests can fake worktree create/cleanup, push, and the rev-list count behind
 * an in-memory double without spawning git.
 */
export interface GitPort {
  /** FIX-209: `_worktree_fetch_origin` — refresh `origin/<branch>` before the
   *  cycle branches its worktree off it, so a just-merged PR is visible locally.
   *  LENIENT: never throws; `fetched:false` on a network blip / missing remote
   *  so the cycle proceeds on the (stale) baseline rather than toppling. */
  fetchOrigin(repoCwd: string, branch: string): Promise<{ fetched: boolean }>;
  /** `_worktree_create` — STRICT add (exit code propagated). */
  worktreeAdd(repoCwd: string, path: string, branch: string, base: string): Promise<{ code: number }>;
  /** `_worktree_cleanup` — tolerant remove (always code 0). */
  worktreeRemove(repoCwd: string, path: string, branch: string): Promise<{ code: number }>;
  /** `git push origin <branch>` (orphan push safety net). */
  push(repoCwd: string, branch: string): Promise<{ code: number }>;
  /** `git rev-list --count origin/main..HEAD` in the worktree → commits ahead. */
  commitsAhead(worktreeCwd: string): Promise<number>;
  /** FIX-252: `git rev-list --count origin/main..main` in the main checkout. */
  mainAhead(repoCwd: string): Promise<number>;
  /** FIX-208: count `tcr:` commits ahead of origin/main (v2口径:
   *  `git log --oneline origin/main..HEAD | grep -c ' tcr:'`) in the worktree. */
  tcrCount(worktreeCwd: string): Promise<number>;
}

/** GitHub facet — the publish-plan executor + slug resolution. */
export interface GithubPort {
  /** Resolve `owner/repo` from the repo's origin remote (undefined ⇒ no gh). */
  repoSlug(repoCwd: string): Promise<string | undefined>;
  /** Execute a publish PLAN (core planPublishPr/DocPr) → publish status. */
  runPublishPlan(
    plan: ReadonlyArray<{ kind: string; tool: "git" | "gh"; argv: string[] }>,
  ): Promise<{ status: 0 | 1 | 2; prUrl: string; ok: boolean }>;
  /** Poll a PR's merge state (sync merge-wait). Returns the gh state string. */
  prState(repoCwd: string, branch: string): Promise<string>;
}

/** Process facet — lock + heartbeat (infra/process.ts). */
export interface ProcessPort {
  acquireLock(lockPath: string, opts?: { staleSec?: number }): { acquired: boolean; heldByPid: number | undefined };
  releaseLock(lockPath: string): void;
  writeHeartbeat(path: string): void;
}

/** Events facet — append + upsert (events/bus.ts). */
export interface EventsPort {
  ensureEventFiles(eventsPath: string, runsPath: string): void;
  appendEvent(eventsPath: string, event: RollEvent): void;
  upsertRun(runsPath: string, key: RunKey, row: Record<string, unknown>): void;
  appendAlert(alertsPath: string, message: string): void;
}

/** Backlog facet — read the project backlog and pick a story (picker.ts). */
export interface BacklogPort {
  /** Read backlog rows from the worktree's `.roll/backlog.md`. */
  read(worktreeCwd: string): { id: string; desc: string; status: string }[];
  /** Mark a story id to a status (e.g. 🔨 In Progress) in the worktree backlog. */
  /**
   * Flip a story row's status in the MAIN project's backlog (`<projectCwd>/
   * .roll/backlog.md`). FIX-198: state lives in the main checkout — ordinary
   * projects gitignore `.roll/` so a cycle worktree carries NO copy at all;
   * any worktree-anchored write lands in the void (the owner-observed "stuck
   * red" / "never Done" pair). For roll itself the main checkout's `.roll` IS
   * the nested meta repo — same path, both layouts correct.
   */
  markStatus?(projectCwd: string, id: string, status: string): void;
}

/** Routing facet — resolve tier→agent for a story (router.ts). */
export interface RoutePort {
  resolve(storyId: string, estMin: number | undefined): { agent: string; model: string };
}

/** Budget facet — the I11 gate verdict at route→execute boundary. */
export interface BudgetPort {
  check(storyId: string): "ok" | "downgrade" | "pause_and_notify";
}

/** Evidence frame facet — opens `.roll/features/<epic>/<ID>/<run-id>/`. */
export interface EvidencePort {
  openFrame(projectCwd: string, storyId: string, runId: string): string;
}

/** Screenshot marker facet — executes agent-emitted capture requests. */
export interface CapturePort {
  fromMarker(marker: CaptureMarker, runDir: string): Promise<ScreenshotResult>;
}

/** Acceptance evidence facet — renders the final report into a run frame. */
export interface AttestPort {
  render(projectCwd: string, storyId: string, runDir: string): Promise<number>;
}

/**
 * The full injectable Ports bundle. The runtime wiring ({@link nodePorts})
 * binds these to the real infra; tests pass fakes for every facet so NO real
 * network / agent / PR side effects occur (PATH shims + file:// remotes only).
 */
export interface Ports {
  git: GitPort;
  github: GithubPort;
  process: ProcessPort;
  events: EventsPort;
  backlog: BacklogPort;
  route: RoutePort;
  budget: BudgetPort;
  evidence: EvidencePort;
  capture: CapturePort;
  attest: AttestPort;
  agentSpawn: AgentSpawn;
  depsExec?: DepsExec;
  clock: ProcessClock;
  /** Runtime paths the executor writes to. */
  paths: RunnerPaths;
  /** The repo (main tree) the worktree commands run against. */
  repoCwd: string;
  /** The skill body the agent runs (the loop hands the agent SKILL.md). */
  skillBody: string;
}

/** Resolved runtime file paths under `<project>/.roll/loop/`. */
export interface RunnerPaths {
  eventsPath: string;
  runsPath: string;
  alertsPath: string;
  lockPath: string;
  heartbeatPath: string;
  /** The cycle worktree path. */
  worktreePath: string;
}

// ── Command dispatch ──────────────────────────────────────────────────────────

/** What {@link executeCommand} returns: an optional feedback event for the next
 *  step, plus side-effect flags the driver needs (lock released, terminal). */
export interface ExecuteResult {
  /** Event to feed back into the orchestrator (undefined ⇒ pure side effect). */
  event?: CycleEvent;
  /** True iff this command released the inner lock (driver stops re-releasing). */
  lockReleased?: boolean;
  /** FIX-208: live-context enrichment the orchestrator never owns (it is pure
   *  and clock/spawn-free) — real tcr count + parsed cost. The driver folds
   *  this into liveCtx so the later append_run / cycle:end carry truthful data. */
  ctxPatch?: Partial<CycleContext>;
}

function createCaptureMarkerSink(runDir: string, capture: CapturePort): { onChunk(chunk: Buffer): void; flush(): Promise<void> } {
  let buf = "";
  const pending: Promise<void>[] = [];
  const logPath = join(runDir, "evidence", "capture-markers.log");
  const record = (marker: CaptureMarker, result: ScreenshotResult): void => {
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, JSON.stringify({ marker, result }) + "\n", "utf8");
    } catch {
      /* evidence logging is best-effort */
    }
  };
  const runMarker = (line: string): void => {
    const marker = parseCaptureMarker(line);
    if (marker === null) return;
    pending.push(
      capture
        .fromMarker(marker, runDir)
        .then((result) => record(marker, result))
        .catch((e: unknown) =>
          record(marker, {
            kind: marker.kind,
            out: join(runDir, "screenshots", `${marker.phase}-${marker.stem}.png`),
            taken: false,
            skipped: `capture errored: ${String(e)}`,
          }),
        ),
    );
  };
  return {
    onChunk(chunk) {
      buf += chunk.toString("utf8");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) runMarker(line);
    },
    async flush() {
      if (buf.trim() !== "") runMarker(buf);
      buf = "";
      await Promise.allSettled(pending);
    },
  };
}

/**
 * Dispatch ONE {@link CycleCommand} to the matching infra call / core plan via
 * {@link Ports}. The mapping table (command → executor) is documented inline.
 * Commands whose result the orchestrator consumes return a {@link CycleEvent};
 * pure side-effect commands return `{}`.
 *
 * `ctx` is the live cycle context (branch/agent/model/storyId) the orchestrator
 * threads; the executor reads it to parameterize publish/spawn calls.
 */
export async function executeCommand(
  cmd: CycleCommand,
  ports: Ports,
  ctx: CycleContext,
): Promise<ExecuteResult> {
  switch (cmd.kind) {
    // recovery.ts preflightPlan + orphan recovery. The pure plan is consulted by
    // the driver before the loop; here we just acknowledge readiness (the driver
    // already healed orphan state / verified hooks). Feeds back preflight_done.
    case "preflight": {
      // FIX-198/FIX-112/FIX-211 — PR-aware claim reconcile. The inner lock
      // guarantees a single live cycle per project, so a 🔨 In Progress row is
      // from a PRIOR cycle. It is NOT always a dead claim (FIX-211): a cycle
      // that delivered — opened a PR and handed merge to the async PR loop
      // (US-AUTO-044) — legitimately rests at 🔨 until the PR merges; blindly
      // resetting it to 📋 Todo would re-pick and duplicate the work. Reconcile
      // each claim against REAL merge evidence (decideClaimReconcile):
      //   MERGED      → ✅ Done  (补翻 the async-merged delivery — Done ≡ merged),
      //   CLOSED/no-PR→ 📋 Todo  (genuine dead claim / abandoned — re-pickable),
      //   OPEN/unknown→ leave 🔨 (delivered, pending merge; TTL unstick is the
      //                          safety net for a claim that never resolves).
      try {
        const rows = ports.backlog.read(ports.repoCwd) as Array<{ id: string; status?: string }>;
        const claims = rows.filter((r) => (r.status ?? "").includes("🔨"));
        if (claims.length > 0) {
          const runRows = readRunsRows(ports.paths.runsPath);
          const slug = await ports.github.repoSlug(ports.repoCwd).catch(() => undefined);
          for (const claim of claims) {
            const cycle = latestDeliveringCycle(runRows, claim.id);
            let prState: string | undefined;
            if (cycle !== undefined && slug !== undefined) {
              prState = await ports.github
                .prState(ports.repoCwd, reconcileBranchName(cycle))
                .catch(() => undefined);
            }
            const decision = decideClaimReconcile({ hasDeliveringCycle: cycle !== undefined, prState });
            if (decision === "done") ports.backlog.markStatus?.(ports.repoCwd, claim.id, STATUS_MARKER.done);
            else if (decision === "todo") ports.backlog.markStatus?.(ports.repoCwd, claim.id, STATUS_MARKER.todo);
            // "keep" → leave 🔨 (delivered, pending merge).
          }
        }
      } catch {
        /* heal is best-effort */
      }
      // FIX-209: refresh origin/main BEFORE the worktree branches off it. The
      // worktree is created with base `origin/main` (create_worktree below);
      // without this fetch a PR merged on the remote since the last fetch is
      // invisible locally and the cycle opens on a stale baseline → conflicts.
      // LENIENT (mirrors v2 `_worktree_fetch_origin`): a fetch failure leaves a
      // WARN trace and the cycle proceeds on the existing baseline.
      try {
        const { fetched } = await ports.git.fetchOrigin(ports.repoCwd, "main");
        if (!fetched) {
          ports.events.appendAlert(
            ports.paths.alertsPath,
            `[WARN] cycle ${ctx.cycleId}: preflight fetch origin main failed; proceeding on existing baseline`,
          );
        }
      } catch {
        /* fetch is lenient — never topple the cycle on a network blip */
      }
      return { event: { type: "preflight_done" } };
    }

    // infra/git _worktree_create (STRICT). worktree_created on success, else
    // worktree_failed (→ failed terminal, bin/roll:9000).
    case "create_worktree": {
      const r = await ports.git.worktreeAdd(
        ports.repoCwd,
        ports.paths.worktreePath,
        cmd.branch,
        "origin/main",
      );
      if (r.code !== 0) return { event: { type: "worktree_failed" } };
      // FIX-204C: `.roll/` is a nested gitignored repo — a fresh worktree has
      // NONE of it, while the loop skill promises CWD-relative `.roll/*`. The
      // 2026-06-06 first live run showed the failure mode: the agent went
      // hunting, found the MAIN checkout's .roll, and edited THERE — worktree
      // captured zero commits and the cycle idled. Symlink the main .roll into
      // the worktree so the contract holds (single source of truth; the inner
      // lock already guarantees one cycle at a time).
      await linkRollIntoWorktree(ports.repoCwd, ports.paths.worktreePath);
      // FIX-268 root cause: a fresh worktree has NO node_modules, and the
      // agent sandbox has no network — its own install dies on ENOTFOUND,
      // tests never run, the TCR gate never passes, and the whole cycle can
      // evaporate as idle_no_work. Install HERE, in the runner (outside the
      // sandbox, with network). If that fails, fail the worktree setup before
      // the agent spawns so the terminal reason is the dependency bootstrap.
      const depsOk = await bootstrapWorktreeDeps(
        ports.paths.worktreePath,
        ports.paths.alertsPath,
        ports.events,
        ports.depsExec,
      );
      if (!depsOk) return { event: { type: "worktree_failed" } };
      return { event: { type: "worktree_created" } };
    }

    // backlog/picker pickStory (read backlog INSIDE the worktree, bin/roll:8938).
    case "pick_story": {
      // Read from the MAIN project (FIX-198): ordinary projects gitignore
      // .roll/, so the worktree has no backlog at all — a worktree read picks
      // nothing and the loop silently idles.
      const items = ports.backlog.read(ports.repoCwd);
      const story = pickStory(items as never);
      if (story === undefined) return { event: { type: "no_story" } };
      // Claim immediately on the MAIN backlog: 🔨 In Progress is the
      // anti-duplicate-pick signal and must be visible to `roll backlog`/brief
      // the moment the story is taken (owner观察: 行一直红着不动 = 此处之前
      // 写在 worktree 的虚空里，且真实 ports 从未绑定 markStatus).
      ports.backlog.markStatus?.(ports.repoCwd, story.id, STATUS_MARKER.in_progress);
      const evidenceRunDir = ports.evidence.openFrame(ports.repoCwd, story.id, ctx.cycleId);
      ports.events.appendEvent(ports.paths.eventsPath, {
        type: "evidence:frame-opened",
        cycleId: ctx.cycleId,
        storyId: story.id,
        runDir: evidenceRunDir,
        ts: ports.clock(),
      });
      return { event: { type: "story_picked", storyId: story.id }, ctxPatch: { evidenceRunDir } };
    }

    // agent/router resolveRoute (+ pre-spawn availability fallback).
    case "resolve_route": {
      const items = ports.backlog.read(ports.repoCwd);
      const story = items.find((i) => i.id === cmd.storyId);
      const estMin = story === undefined ? undefined : parseEstMin(story.desc);
      const r = ports.route.resolve(cmd.storyId, estMin);
      return { event: { type: "route_resolved", agent: r.agent, model: r.model } };
    }

    // cost/budget budgetVerdict (I11) at the route→execute boundary.
    case "budget_check": {
      const verdict = ports.budget.check(cmd.storyId);
      if (verdict === "pause_and_notify") {
        return { event: { type: "budget_halt", reason: `budget gate: ${cmd.storyId}` } };
      }
      // downgrade is advisory (no auto-mutation) → proceed as ok.
      return { event: { type: "budget_ok" } };
    }

    // budget downgrade signal (advisory) — record an alert, no mutation.
    case "budget_downgrade":
      ports.events.appendAlert(ports.paths.alertsPath, `budget downgrade: ${cmd.reason}`);
      return {};

    // halt the cycle before spawning (fail-closed). Side effect only.
    case "halt_cycle":
      ports.events.appendAlert(ports.paths.alertsPath, `cycle halted: ${cmd.reason}`);
      return {};

    // execute: spawn the agent (TCR commits happen inside the worktree). The
    // exit code + timeout feed back as agent_exited; usage is captured for cost.
    case "spawn_agent": {
      // US-PORT-011: the live observation file — one stable path per project,
      // truncated at each agent start, fed every chunk in real time. The popup
      // (runner template) and any `tail -f` watcher read THIS, not buffers.
      const livePath = join(dirname(ports.paths.eventsPath), "live.log");
      try {
        writeFileSync(
          livePath,
          `── cycle ${ctx.cycleId ?? "?"} · ${ctx.storyId ?? "?"} · agent ${cmd.agent} ──\n`,
        );
      } catch {
        /* observation is best-effort */
      }
      const captureSink =
        ctx.evidenceRunDir !== undefined && ctx.evidenceRunDir !== ""
          ? createCaptureMarkerSink(ctx.evidenceRunDir, ports.capture)
          : undefined;
      const res = await ports.agentSpawn(cmd.agent, {
        cwd: ports.paths.worktreePath,
        skillBody: ports.skillBody,
        ...(ctx.evidenceRunDir !== undefined ? { runDir: ctx.evidenceRunDir } : {}),
        writableRoots: agentWritableRoots(ports.repoCwd, ports.paths.alertsPath),
        env: {
          ...process.env,
          ROLL_LOOP_ALERT: ports.paths.alertsPath,
        },
        // FIX-204B: pin the executor-picked story into the agent prompt — the
        // claim (pick_story → 🔨) and the work must be the same story.
        ...(ctx.storyId !== undefined && ctx.storyId !== "" ? { storyId: ctx.storyId } : {}),
        onChunk: (d: Buffer) => {
          captureSink?.onChunk(d);
          try {
            appendFileSync(livePath, d);
          } catch {
            /* best-effort */
          }
        },
      });
      await captureSink?.flush();
      persistWorktreeAlerts(ports.paths.worktreePath, ports.paths.alertsPath, ports.events);
      // F4 lesson (信号成对/可观测不归零): persist the agent's full output as a
      // per-cycle log next to events/runs — v2 keeps cycle logs; without this
      // an agent that "ran but delivered nothing" is undiagnosable.
      try {
        const logDir = join(dirname(ports.paths.eventsPath), "cycle-logs");
        mkdirSync(logDir, { recursive: true });
        writeFileSync(
          join(logDir, `${ctx.cycleId ?? "cycle"}.agent.log`),
          `# exit=${res.exitCode} timedOut=${res.timedOut}\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}\n`,
        );
      } catch {
        /* logging must never fail the cycle */
      }
      // FIX-208/FIX-249: fold the agent's real usage into a per-cycle cost,
      // trying every adapter lane in order:
      //   1. claude stream-json (per-turn usage + final total_cost_usd);
      //   2. stdout-scrape footer agents (openai/gemini/kimi/qwen, REGISTRY);
      //   3. pi session-store recovery (pi prints no usage; its session files
      //      under ~/.pi/agent/sessions/<encoded-cwd>/ are authoritative,
      //      scoped to this cycle's worktree + start time).
      // Best-effort: a miss on every lane leaves cost absent (n/a, never a
      // fake zero) — usage accounting must never fail the cycle.
      let costPatch: CycleCost | undefined;
      try {
        const agentName = ctx.agent ?? cmd.agent;
        const lines = res.stdout.split("\n");
        let usage = sumClaudeStream(lines);
        if (usage === null) usage = extractUsage(agentName, lines);
        if (usage === null && agentName === "pi") {
          const rootOverride = (process.env["ROLL_PI_SESSIONS_ROOT"] ?? "").trim();
          usage = recoverPiUsage(
            ports.paths.worktreePath,
            ctx.startSec,
            ...(rootOverride !== "" ? [rootOverride] : []),
          );
        }
        if (usage !== null) {
          costPatch = toCycleCost(usage, {
            cycleId: ctx.cycleId,
            agent: agentName,
            // TCR reverts are not tracked at this layer yet; nominal == effective.
            revertCount: 0,
          });
        }
      } catch {
        /* usage parse is best-effort */
      }
      return {
        event: { type: "agent_exited", exit: res.exitCode, timedOut: res.timedOut },
        ...(costPatch !== undefined ? { ctxPatch: { cost: costPatch } } : {}),
      };
    }

    // watchdog teardown — SIGKILL is owned by the spawn-local timeout; here the
    // command is a structural marker (the kill already happened at the spawn
    // layer). No feedback event (the orchestrator already transitioned).
    case "kill_agent":
      return {};

    // retry backoff (the adapter sleeps). Honour the schedule via the clock-free
    // setTimeout; the orchestrator already advanced attempt, so re-spawn follows.
    case "sleep_backoff":
      await sleep(cmd.seconds * 1000);
      return {};

    // capture facts: git rev-list/log count (bin/roll:9127-9157). worktree used
    // (we created it), agent exit (carried by the prior agent_exited — the driver
    // tracks it), commits ahead from git. timedOut is false here (timeout path
    // short-circuits before capture).
    case "capture_facts": {
      const commitsAhead = await ports.git.commitsAhead(ports.paths.worktreePath);
      let mainAhead = 0;
      try {
        mainAhead = await ports.git.mainAhead(ports.repoCwd);
      } catch {
        /* drift probe is best-effort */
      }
      // FIX-208: count real `tcr:` commits while the worktree is still alive
      // (the done/cleanup path removes it before the runs row is written). Folded
      // into liveCtx so buildRunRow stops hardcoding 0. Best-effort → 0 on error.
      let tcrCount = 0;
      try {
        tcrCount = await ports.git.tcrCount(ports.paths.worktreePath);
      } catch {
        /* count is best-effort; a git miss must not fail the cycle */
      }
      // FIX-150b peer hard-trigger gate: agent-agnostic, runs in EVERY cycle's
      // capture step. High-complexity delivery without peer evidence → ALERT +
      // `peer:gate` event (auditable); soft by default — the gate records, it
      // never fails the cycle (unattended deliveries must not deadlock on a
      // flaky peer; a policy.yaml escalation can consume the same verdict later).
      await runPeerGate(
        ports.paths.worktreePath,
        dirname(ports.paths.eventsPath),
        ctx.cycleId ?? "",
        {
          alert: (m) => ports.events.appendAlert(ports.paths.alertsPath, m),
          event: (p) =>
            ports.events.appendEvent(ports.paths.eventsPath, {
              type: "peer:gate",
              cycleId: p.cycleId,
              verdict: p.verdict as "consulted" | "skipped",
              reasons: p.reasons,
              ts: ports.clock(),
            }),
        },
      );
      // US-PAIR-003 cross-agent pairing: after the peer gate, a heterogeneous
      // peer ONE-WAY reviews the diff. file-absent (.roll/pairing.yaml) = OFF, so
      // this is inert until the owner opts in via `roll pair init` — no behavior
      // change for repos without the config. NEVER blocks the cycle (30s hard
      // timeout in reviewPeer; runPairing swallows all errors).
      //
      // US-PAIR-004 multi-stage: pairing fires at EVERY enabled stage
      // (design/test/code/cycle), each independently opt-out via pairing.yaml
      // `stages`. MVP-pragmatic: all enabled stages are invoked from this single
      // capture hook — a true per-phase pre-code hook for design/test is a larger
      // refactor (the loop has no distinct design/test phase boundary yet), so the
      // diff a design-stage peer sees is the same cycle diff. The stage plumbing is
      // real (each stage selects its own peer, writes its own evidence, stamps its
      // own events); narrowing the per-stage context/diff is a future refinement.
      // Every stage preserves the PAIR-003 invariants (timeout / non-blocking /
      // cost / file-absent=off) since they all route through runPairing.
      {
        const reviewPeer = async (peer: string, diff: string, timeoutMs: number): Promise<PairReview | null> => {
          const prompt =
            `You are a heterogeneous PAIRING reviewer. A different agent wrote the diff below; ` +
            `give it a terse second-pair-of-eyes review (correctness, edge cases, quality). ` +
            `End with exactly one line "VERDICT: agree|refine|object" and one "FINDING: <issue>" line per concrete issue.\n\nDIFF:\n` +
            diff;
          let res;
          try {
            // Belt-and-braces hard timeout (pi pair-review): race the spawn against
            // a wall clock so 30s is enforced even if an agent's spawn path ignores
            // its own timeoutMs. Whichever loses, the cycle is never stalled.
            res = await Promise.race([
              ports.agentSpawn(peer, {
                cwd: ports.paths.worktreePath,
                skillBody: prompt,
                timeoutMs,
                ...(ctx.evidenceRunDir !== undefined ? { runDir: ctx.evidenceRunDir } : {}),
              }),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs).unref()),
            ]);
          } catch {
            return null;
          }
          if (res === null || res.timedOut || res.exitCode !== 0) return null;
          const vm = /VERDICT:\s*(agree|refine|object)/i.exec(res.stdout);
          const verdict = (vm?.[1]?.toLowerCase() ?? "agree") as PairReview["verdict"];
          const findings = [...res.stdout.matchAll(/^\s*FINDING:\s*(.+)$/gim)].map((m) => (m[1] ?? "").trim());
          // US-PAIR-006 cost observability (owner's top priority "至少知道花了多少钱"):
          // the pair:verdict cost is now the peer's REAL list cost, parsed from its
          // own stdout (claude stream-json or the per-agent stdout-scrape extractors).
          // Best-effort by contract — an unparseable peer records 0, never throws.
          const cost = peerReviewCost(peer, res.stdout);
          return { verdict, findings, cost };
        };
        // US-PAIR-006: per-peer track record from the event stream drives the
        // ε-greedy hit-rate preference. Best-effort: an unreadable/absent events
        // file → no history → pure seeded round-robin (US-PAIR-001 behaviour).
        let pairHistory;
        try {
          if (existsSync(ports.paths.eventsPath)) {
            const events = readFileSync(ports.paths.eventsPath, "utf8")
              .split("\n")
              .map(parseEventLine)
              .filter((e): e is RollEvent => e !== null);
            pairHistory = pairingHistory(events);
          }
        } catch {
          /* history is best-effort — a read miss must not affect the cycle */
        }
        // US-PAIR-004: build the deps once, then run each enabled stage.
        const pairingDeps = {
          installed: agentsInstalled(realAgentEnv()),
          isAvailable: () => true, // MVP: `installed` is the hard gate; a dead peer → reviewPeer null (non-blocking). Real probe is a refinement.
          reviewPeer,
          ...(pairHistory !== undefined ? { history: pairHistory } : {}),
          changedFiles: cycleChangedFiles,
          diff: async (cwd: string) => {
            try {
              // Baseline mirrors peer-gate's cycleChangedFiles (origin/main...HEAD):
              // roll's loop always targets main (Done ≡ merged to main), so this is
              // the cycle's net change. Kept identical to peer-gate for consistency.
              const { stdout } = await execFileAsync("git", ["diff", "origin/main...HEAD"], { cwd, encoding: "utf8" });
              return stdout.slice(0, 60_000);
            } catch {
              return "";
            }
          },
          event: (e: PairEvent) => ports.events.appendEvent(ports.paths.eventsPath, e as RollEvent),
          now: () => ports.clock(),
        };
        // Iterate the enabled stages (config order). file-absent/disabled → [] →
        // the loop body never runs, so a repo without pairing.yaml is untouched.
        for (const stage of enabledPairingStages(ports.repoCwd)) {
          await runPairing(ports.repoCwd, ports.paths.worktreePath, dirname(ports.paths.eventsPath), ctx.cycleId ?? "", ctx.agent ?? "", stage, pairingDeps);
        }
      }
      const storyId = ctx.storyId ?? "";
      if (commitsAhead > 0 && storyId !== "" && ctx.evidenceRunDir !== undefined && ctx.evidenceRunDir !== "") {
        // FIX-246: ac-map omission remediation. Agents deliver real work yet
        // consistently skip skill step 10.6 (write ac-map.json) — the hard gate
        // then kills every cycle as an empty shell. Before rendering, give the
        // SAME agent ONE surgical second pass to write the ac-map (honest
        // statuses only — the prompt and the render-layer red line both forbid
        // fabricated passes). One retry structurally: capture runs once.
        if (needsAcMapRemediation(ports.paths.worktreePath, storyId)) {
          let outcome: "written" | "still-missing" | "spawn-failed";
          try {
            await ports.agentSpawn(ctx.agent ?? "claude", {
              cwd: ports.paths.worktreePath,
              skillBody: buildAcMapRemediationPrompt(ports.paths.worktreePath, storyId, ctx.evidenceRunDir),
              storyId,
              timeoutMs: ACMAP_REMEDIATION_TIMEOUT_MS,
              runDir: ctx.evidenceRunDir,
            });
            outcome = needsAcMapRemediation(ports.paths.worktreePath, storyId) ? "still-missing" : "written";
          } catch {
            outcome = "spawn-failed";
          }
          ports.events.appendEvent(ports.paths.eventsPath, {
            type: "attest:remediation",
            cycleId: ctx.cycleId ?? "",
            storyId,
            agent: ctx.agent ?? "",
            outcome,
            ts: ports.clock(),
          });
        }
        const rc = await ports.attest.render(ports.paths.worktreePath, storyId, ctx.evidenceRunDir);
        if (rc !== 0) {
          ports.events.appendAlert(
            ports.paths.alertsPath,
            `attest render failed for ${storyId} in cycle ${ctx.cycleId ?? ""} (exit ${rc})`,
          );
        }
      }
      // FIX-207 attest gate: a delivery (commits ahead + a real story) that ships
      // with no FRESH acceptance report leaves an auditable ALERT + `attest:gate`
      // event. HARD by default; `loop_safety.attest_gate: soft` in policy.yaml
      // records without blocking for explicit migration windows. A hard-blocked
      // delivery is captured as a failed agent exit so the story is NOT marked
      // Done without acceptance evidence.
      // Scoped to actual deliveries: an idle cycle has nothing to attest.
      let attestBlocked = false;
      if (commitsAhead > 0 && storyId !== "") {
        const mode = readAttestGateMode(ports.repoCwd);
        const res = runAttestGate(
          ports.paths.worktreePath,
          storyId,
          ctx.cycleId ?? "",
          mode,
          ctx.startSec,
          {
            alert: (m) => ports.events.appendAlert(ports.paths.alertsPath, m),
            event: (p) =>
              ports.events.appendEvent(ports.paths.eventsPath, {
                type: "attest:gate",
                cycleId: p.cycleId,
                verdict: p.verdict,
                reasons: p.reasons,
                ts: ports.clock(),
              }),
          },
        );
        if (res.verdict === "skipped") {
          applyCorrectionAction({
            projectPath: ports.repoCwd,
            eventsPath: ports.paths.eventsPath,
            alertsPath: ports.paths.alertsPath,
            storyId,
            cycleId: ctx.cycleId ?? "",
            reasons: res.reasons,
            nowSec: ports.clock(),
          });
        }
        attestBlocked = res.blocked;
      }
      // US-PAIR-009 score stage: AFTER the attest gate passes (a real, evidenced
      // delivery), the heterogeneous paired agent produces the cycle's score
      // note — the agent's own self-score note stays as the fallback (any
      // non-"scored" outcome leaves it the effective score). Same invariants as
      // every pairing: never throws, never blocks, absences audited.
      if (!attestBlocked && commitsAhead > 0 && storyId !== "") {
        const scorePeer = async (peer: string, summary: string, timeoutMs: number): Promise<import("./pairing-gate.js").PairScore | null> => {
          const prompt = buildPairScorePrompt(summary);
          let res;
          try {
            res = await Promise.race([
              ports.agentSpawn(peer, {
                cwd: ports.paths.worktreePath,
                skillBody: prompt,
                timeoutMs,
                ...(ctx.evidenceRunDir !== undefined ? { runDir: ctx.evidenceRunDir } : {}),
              }),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs).unref()),
            ]);
          } catch {
            return null;
          }
          if (res === null || res.timedOut || res.exitCode !== 0) return null;
          const parsed = parsePairScoreOutput(res.stdout);
          if (parsed === null) return null;
          return { ...parsed, cost: peerReviewCost(peer, res.stdout) };
        };
        let diffStat = "";
        try {
          const { stdout } = await execFileAsync("git", ["diff", "--stat", "origin/main...HEAD"], { cwd: ports.paths.worktreePath, encoding: "utf8" });
          diffStat = stdout.slice(0, 4_000);
        } catch {
          /* summary degrades gracefully */
        }
        const summary = `Story: ${storyId}\nAttest gate: pass\nDiff stat:\n${diffStat}`;
        const skill = storyId.startsWith("FIX-") || storyId.startsWith("BUG-") ? "roll-fix" : "roll-build";
        await runScorePairing(ports.repoCwd, dirname(ports.paths.eventsPath), ctx.cycleId ?? "", ctx.agent ?? "", storyId, skill, summary, {
          installed: agentsInstalled(realAgentEnv()),
          isAvailable: () => true,
          scorePeer,
          event: (e: PairEvent) => ports.events.appendEvent(ports.paths.eventsPath, e as RollEvent),
          now: () => ports.clock(),
        });
      }
      // FIX-244: phantom-failure probe. A hard-blocked delivery whose work is
      // ALREADY out as a PR (agent self-published, observed 2026-06-10: cycles
      // judged failed whose PRs merged minutes later) is "published", not a
      // no-output failure. Probe the cycle branch's PR state into the facts so
      // classifyCaptured can see it; a failed probe degrades to plain failed.
      let prState: string | undefined;
      if (attestBlocked && commitsAhead > 0) {
        prState = await ports.github.prState(ports.repoCwd, ctx.branch).catch(() => undefined);
      }
      const facts: CapturedFacts = {
        usedWorktree: true,
        // accept-path reaches capture at exit 0; a HARD attest block fails the
        // capture (classifyCaptured: exit ≠ 0 → failed) so Done is withheld —
        // unless the PR-state probe reclassifies it "published" (FIX-244).
        agentExit: attestBlocked ? 1 : 0,
        timedOut: false,
        commitsAhead,
        ...(mainAhead > 0 ? { mainAhead } : {}),
        ...(prState !== undefined ? { prState } : {}),
      };
      return { event: { type: "facts_captured", facts }, ctxPatch: { tcrCount } };
    }

    // delivery/pr planPublishPr → github.runPublishPlan → published result.
    case "publish_pr": {
      const manualMerge = storyRequiresManualMerge(ports.repoCwd, ctx.storyId);
      const slug = await ports.github.repoSlug(ports.repoCwd);
      if (slug === undefined) {
        // gh unavailable / no github remote → status 2 (gh-missing tier).
        const pub: PublishResult = { status: 2, mergedBack: false, orphanPushed: false, manualMerge };
        return { event: { type: "published", result: pub } };
      }
      // FIX-245 AC2: an agent that opened its own PR inside the cycle bypassed
      // every runner gate (observed: PR #578, single un-prefixed commit). The
      // runner detects it at publish time, ADOPTS the registration (the PR is
      // real — the books must say published) and logs the discipline breach.
      const preState = await ports.github.prState(ports.repoCwd, cmd.branch).catch(() => "UNKNOWN");
      if (preState === "OPEN" || preState === "MERGED") {
        ports.events.appendAlert(
          ports.paths.alertsPath,
          `discipline: agent self-published a PR for ${cmd.branch} (cycle ${ctx.cycleId}) — runner adopted it; gates ran post-hoc (FIX-245)`,
        );
        const pub: PublishResult = { status: 0, manualMerge };
        return { event: { type: "published", result: pub } };
      }
      const plan = cmd.docOnly
        ? planPublishDocPr({ branch: cmd.branch, slug, body: publishBody(ctx), manualMerge })
        : planPublishPr({ branch: cmd.branch, slug, body: publishBody(ctx), manualMerge });
      const r = await ports.github.runPublishPlan(plan);
      // US-DOSSIER-007 AC2: mount the execution section onto the story dossier at
      // PR-open with the fact known now (the PR link), not reconstructed later
      // from squash-flattened history. Best-effort; never blocks the cycle.
      if (r.status === 0 && r.prUrl !== "" && !cmd.docOnly && ctx.storyId !== undefined) {
        mountExecutionAtPublish(ports.repoCwd, ctx.storyId, r.prUrl);
      }
      const pub: PublishResult = { status: r.status, manualMerge };
      return {
        event: { type: "published", result: pub },
        // US-TRUTH-001: thread the PR url into the cycle context so the
        // terminal event records the publish fact instead of guessing.
        ...(r.status === 0 && r.prUrl !== "" ? { ctxPatch: { prUrl: r.prUrl } } : {}),
      };
    }

    // _worktree_merge_back (gh-missing ff tier). Drive a push + ff; report via a
    // published refinement is not needed (the orchestrator handles status 2 in
    // classifyPublish), so this is a structural side effect. The driver routes
    // the gh-missing path through publish_pr's status-2 result already.
    case "merge_back": {
      const r = await ports.git.push(ports.repoCwd, cmd.branch);
      ports.events.appendAlert(
        ports.paths.alertsPath,
        `merge_back ${cmd.branch}: push ${r.code === 0 ? "ok" : "failed"}`,
      );
      return {};
    }

    // FIX-039 orphan branch+tag push (audit safety net, C2).
    case "push_orphan": {
      const r = await ports.git.push(ports.repoCwd, cmd.branch);
      ports.events.appendAlert(
        ports.paths.alertsPath,
        `orphan push ${cmd.branch}: ${r.code === 0 ? "ok" : "failed"}`,
      );
      return {};
    }

    // delivery/pr nextWaitAction sync merge-wait poll. Re-poll the gh state and
    // feed merge_polled back so the orchestrator's nextWaitAction drives it.
    case "wait_merge": {
      const state = await ports.github.prState(ports.repoCwd, cmd.branch);
      return { event: { type: "merge_polled", state, elapsedSec: cmd.elapsedSec } };
    }

    // reconcile/engine reconcileMergeEvidence — terminal bookkeeping only here
    // (the six-state classification already happened); ack with reconciled.
    case "reconcile":
      return { event: { type: "reconciled" } };

    // _worktree_cleanup (tolerant). Side effect; no feedback (terminal path).
    case "cleanup_worktree":
      // FIX-204C: drop OUR .roll symlink first — `git worktree remove` refuses
      // untracked entries in repos that don't gitignore .roll, and removing the
      // LINK explicitly (never the target) keeps the main .roll untouchable.
      try {
        const dst = join(ports.paths.worktreePath, ".roll");
        if (lstatSync(dst, { throwIfNoEntry: false })?.isSymbolicLink() === true) unlinkSync(dst);
      } catch {
        /* tolerant cleanup, mirrors _worktree_cleanup */
      }
      await ports.git.worktreeRemove(ports.repoCwd, ports.paths.worktreePath, cmd.branch);
      return {};

    // events/bus appendEvent (I8 — terminal event written unconditionally).
    case "emit_event":
      // FIX-208: the orchestrator is pure (no clock/spawn) so it builds cycle:end
      // with a zero-cost placeholder. Enrich it here with the real per-cycle cost
      // folded into liveCtx after spawn_agent, so the terminal event and the runs
      // row report the SAME cost. Other events pass through untouched.
      ports.events.appendEvent(
        ports.paths.eventsPath,
        stampTs(withRealCost(cmd.event, ctx), ports.clock()),
      );
      return {};

    // events/bus upsertRun — the dashboard terminal record (v2 runs.jsonl shape).
    case "append_run": {
      const key: RunKey = { storyId: ctx.storyId ?? "", cycleId: cmd.cycleId };
      ports.events.upsertRun(ports.paths.runsPath, key, buildRunRow(cmd, ctx, ports.clock()));
      // US-TRUTH-001: the versioned complete-or-reasoned terminal record —
      // written at the same moment, from the same facts, as the runs row.
      // Best-effort: the truth twin must never fail the cycle terminal.
      try {
        ports.events.appendEvent(
          ports.paths.eventsPath,
          buildTerminalRecord(cmd, ctx, ports.paths.worktreePath, ports.clock()),
        );
      } catch {
        /* the runs row above already landed; audit flags the missing twin */
      }
      // FIX-211: Done ≡ merged (backlog.md:4) — no publish-time 抢跑. A
      // publish-status-0 `done` terminal means the PR was OPENED and merge
      // handed to the async PR loop (US-AUTO-044), NOT that it merged. FIX-198
      // wrongly flipped the MAIN backlog ✅ the moment the PR opened, so a card
      // read Done while its PR was still open (the conductor merged minutes
      // later). Flip ✅ Done ONLY on confirmed MERGED evidence; otherwise the row
      // rests at 🔨 In Progress (delivered, pending merge) and a later
      // preflight reconcile (decideClaimReconcile) flips it once the async PR
      // loop merges. The runs row keeps `done` for v2/dashboard parity — only
      // the backlog flip waits for the merge evidence.
      if ((cmd.status === "done" || cmd.status === "published") && (ctx.storyId ?? "") !== "") {
        const state = await ports.github.prState(ports.repoCwd, ctx.branch).catch(() => "UNKNOWN");
        if (state === "MERGED") {
          ports.backlog.markStatus?.(ports.repoCwd, ctx.storyId ?? "", STATUS_MARKER.done);
        }
      } else if (cmd.status === "idle" && (ctx.storyId ?? "") !== "") {
        ports.backlog.markStatus?.(ports.repoCwd, ctx.storyId ?? "", STATUS_MARKER.todo);
      }
      // FIX-290 AC5: a failed/idle cycle is first-class — refresh the dossier
      // aggregates on EVERY cycle terminal so the cycle surfaces on the web #loop
      // ledger immediately, not only after the next delivery (which mounted the
      // execution section at publish) or a manual `roll index`. Best-effort: a
      // refresh failure WARNs and never fails the cycle terminal.
      refreshAggregates(ports.repoCwd);
      return {};
    }

    // _worktree_alert.
    case "append_alert":
      ports.events.appendAlert(ports.paths.alertsPath, cmd.message);
      return {};

    // infra/process releaseLock.
    case "release_lock":
      ports.process.releaseLock(ports.paths.lockPath);
      return { lockReleased: true };

    default: {
      // Exhaustiveness guard — an unmapped command is a hard error (report, don't
      // silently swallow). If a new CycleCommand kind appears, this throws.
      const _exhaustive: never = cmd;
      throw new Error(`executeCommand: unmapped command ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Stamp `ts` onto an event the orchestrator built with ts=0 (it owns no clock). */
function stampTs(event: RollEvent, ts: number): RollEvent {
  return { ...event, ts } as RollEvent;
}

/** FIX-208: replace a cycle:end event's zero-cost placeholder with the real cost
 *  folded into liveCtx after spawn_agent. Non-cycle:end events pass through; a
 *  cycle with no parsed usage (`ctx.cost` absent) keeps the placeholder. */
function withRealCost(event: RollEvent, ctx: CycleContext): RollEvent {
  if (event.type !== "cycle:end" || ctx.cost === undefined) return event;
  return { ...event, cost: ctx.cost };
}

/** Build the v2-shaped runs.jsonl row (keys verified against the dashboard
 *  difftest fixture: project/run_id/ts/tcr_count/built[]/status/agent/duration_sec).
 *  The bus upsert adds story_id + cycle_id for the dedupe key. FIX-208: tcr_count
 *  is the real captured count (was hardcoded 0); cost fields are added from the
 *  same liveCtx cost the cycle:end event carries, so the two records agree. */
export function buildRunRow(
  cmd: Extract<CycleCommand, { kind: "append_run" }>,
  ctx: CycleContext,
  nowSec?: number,
): Record<string, unknown> {
  const built =
    cmd.status === "done" || cmd.status === "published" || cmd.status === "built"
      ? [ctx.storyId ?? ""].filter(Boolean)
      : [];
  const row: Record<string, unknown> = {
    run_id: cmd.cycleId,
    status: cmd.status,
    agent: ctx.agent ?? "",
    built,
    tcr_count: ctx.tcrCount ?? 0,
    outcome: cmd.outcome,
  };
  // FIX-213: stamp the cycle's terminal time (same clock the cycle:end event
  // uses) as a canonical ISO-8601 UTC string + the cycle duration. Without
  // these the dashboard could not bucket the row by day — the runs row was the
  // only record of a real delivery yet read as "0 cycles / 72h". `nowSec` is
  // epoch seconds (the runner's `ports.clock()`); millis are dropped to match
  // the v2 `…Z` schema.
  if (nowSec !== undefined) {
    row["ts"] = new Date(nowSec * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    if (ctx.startSec !== undefined) {
      const dur = nowSec - ctx.startSec;
      if (dur >= 0) row["duration_sec"] = dur;
    }
  }
  // FIX-290 AC2: `model` is fixed by the ROUTING decision (ctx.model), known the
  // moment the agent is dispatched — it is NEVER blank, even on a failed/idle
  // cycle whose usage could not be parsed. Record it unconditionally (fall back
  // to the agent id when the router left model empty, e.g. claude default).
  const routedModel = (ctx.model ?? "").trim() !== "" ? (ctx.model as string) : (ctx.agent ?? "");
  if (routedModel !== "") row["model"] = routedModel;
  // Additive cost fields (v2 runs rows omit cost — the dashboard reads it from
  // the cycle:end event; surfacing it here keeps the human-facing 可回溯链 row
  // truthful too, sourced from the SAME ctx.cost as cycle:end → consistent).
  if (ctx.cost !== undefined) {
    row["cost_usd"] = ctx.cost.estimatedCost;
    // FIX-249: budget guardrails gate on EFFECTIVE cost (I11) — persist it so
    // the ledger can be rebuilt from rows; plus model + the cache split for
    // dashboard truth (tokens were "—", cost $0, guardrail blind).
    row["cost_effective_usd"] = ctx.cost.effectiveCost;
    // The parsed usage carries the authoritative model — prefer it over the
    // routed fallback when present.
    if (ctx.cost.model !== "") row["model"] = ctx.cost.model;
    row["tokens_in"] = ctx.cost.tokensIn;
    row["tokens_out"] = ctx.cost.tokensOut;
    if (ctx.cost.cacheRead !== undefined) row["tokens_cache_read"] = ctx.cost.cacheRead;
    if (ctx.cost.cacheWrite !== undefined) row["tokens_cache_write"] = ctx.cost.cacheWrite;
  } else {
    // FIX-290 AC3: usage could not be read (e.g. usage_credentials_missing). The
    // tokens/cost are UNKNOWN, not zero — mark it so the ledger renders "?" with
    // an unknown marker instead of a misleading "$0.00 · 0/0". model + duration
    // above are still present (failure ≠ empty record).
    row["usage_unknown"] = true;
  }
  return row;
}

/**
 * US-TRUTH-001 — fold the terminal command + cycle context into the versioned
 * complete-or-reasoned TerminalEvent. Every fact is present with a value or
 * carries an enumerated absent reason; a missing usage can never read as $0.
 */
export function buildTerminalRecord(
  cmd: Extract<CycleCommand, { kind: "append_run" }>,
  ctx: CycleContext,
  worktreePath: string,
  nowSec: number,
): TerminalEvent {
  const storyId = ctx.storyId ?? "";
  // v2 six-state → closed terminal vocabulary. `orphan` (publish failed,
  // branch+tag pushed for audit) is an abort WITH delivery by definition.
  const OUTCOME: Record<string, TerminalOutcome> = {
    done: "delivered",
    published: "published_pending_merge",
    built: "published_pending_merge",
    idle: "idle_no_work",
    failed: "failed",
    blocked: "blocked",
    aborted: "aborted_no_delivery",
    orphan: "aborted_with_delivery",
  };
  let attest: FactOr<TerminalAttestFact>;
  if (storyId === "") {
    attest = absent("not_applicable");
  } else {
    const report = verificationReportPath(worktreePath, storyId);
    const hasReport = existsSync(report);
    const hasMap = existsSync(acMapPath(worktreePath, storyId));
    if (hasReport) attest = present({ reportPath: report, acMap: hasMap });
    else attest = absent(hasMap ? "not_rendered" : "acmap_missing");
  }
  let usage: FactOr<TerminalUsageFact>;
  if (ctx.cost !== undefined) {
    usage = present({
      model: ctx.cost.model,
      tokensIn: ctx.cost.tokensIn,
      tokensOut: ctx.cost.tokensOut,
      ...(ctx.cost.cacheRead !== undefined ? { cacheRead: ctx.cost.cacheRead } : {}),
      ...(ctx.cost.cacheWrite !== undefined ? { cacheWrite: ctx.cost.cacheWrite } : {}),
    });
  } else {
    usage = absent("no_parseable_usage");
  }
  // FIX-294 (FIX-290 follow-up): the terminal-event twin must ALSO always carry
  // the routed model — same rule as buildRunRow above. Model is fixed by the
  // ROUTING decision (ctx.model), known the moment the agent is dispatched, so
  // it is present even on a failed/idle cycle whose usage could not be parsed.
  // Prefer the authoritative model from parsed usage when present, else the
  // routed model, else fall back to the agent id (claude default leaves model
  // empty). The `usage` fact stays present-or-reasoned so a true-0 is still
  // distinguishable from unknown — but WHICH model ran is never lost.
  const routedModel = (ctx.model ?? "").trim() !== "" ? (ctx.model as string) : (ctx.agent ?? "");
  const model =
    ctx.cost !== undefined && ctx.cost.model !== "" ? ctx.cost.model : routedModel;
  return buildTerminalEvent({
    cycleId: cmd.cycleId,
    storyId,
    agent: ctx.agent ?? "",
    model,
    startedAt: ctx.startSec ?? nowSec,
    endedAt: nowSec,
    outcome: OUTCOME[cmd.status] ?? "unknown",
    pr:
      ctx.prUrl !== undefined && ctx.prUrl !== ""
        ? present({ url: ctx.prUrl, state: "OPEN" })
        : absent("no_publish_attempted"),
    branch: present(ctx.branch),
    // the runner does not track the head sha at this layer — reasoned, not faked.
    commit: absent("not_recorded"),
    tcr: ctx.tcrCount !== undefined ? present(ctx.tcrCount) : absent("not_recorded"),
    attest,
    usage,
    cost:
      ctx.cost !== undefined
        ? present({ estimatedUsd: ctx.cost.estimatedCost, effectiveUsd: ctx.cost.effectiveCost })
        : absent("no_parseable_usage"),
  });
}

/** Read runs.jsonl as {@link ReconcileRunRow}[] for the preflight claim
 *  reconcile (FIX-211). Tolerant: missing file / malformed lines → skipped, so
 *  a corrupt row never topples the cycle's orphan-recovery pass. */
function readRunsRows(runsPath: string): ReconcileRunRow[] {
  try {
    if (!existsSync(runsPath)) return [];
    return readFileSync(runsPath, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => {
        try {
          return JSON.parse(l) as ReconcileRunRow;
        } catch {
          return undefined;
        }
      })
      .filter((r): r is ReconcileRunRow => r !== undefined);
  } catch {
    return [];
  }
}

/** Compose the gh pr-create body (commit-count-style; kept simple + pure). */
function publishBody(ctx: CycleContext): string {
  return `loop cycle ${ctx.cycleId}${ctx.storyId !== undefined ? ` — ${ctx.storyId}` : ""}`;
}

function storyRequiresManualMerge(repoCwd: string, storyId: string | undefined): boolean {
  if (storyId === undefined || storyId.trim() === "") return false;
  const needles = ["manual_merge", "manual-merge", "[roll:manual-merge]", "autofix"];
  const containsMarker = (text: string): boolean => {
    const lower = text.toLowerCase();
    return needles.some((n) => lower.includes(n));
  };
  try {
    const backlog = readFileSync(join(repoCwd, ".roll", "backlog.md"), "utf8");
    const row = parseBacklog(backlog).find((it) => it.id === storyId);
    if (row !== undefined && containsMarker(row.desc)) return true;
  } catch {
    /* absent backlog */
  }
  try {
    return containsMarker(readFileSync(join(cardArchiveDir(repoCwd, storyId), "spec.md"), "utf8"));
  } catch {
    return false;
  }
}

/** Parse an `est_min:<n>` tag from a backlog desc (router input). */
export function parseEstMin(desc: string): number | undefined {
  const m = /est[_-]?min:\s*(\d+)/i.exec(desc);
  return m === null ? undefined : Number(m[1]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function agentWritableRoots(repoCwd: string, alertsPath: string): string[] {
  const roots: string[] = [];
  const add = (p: string): void => {
    if (p.trim() === "") return;
    const real = existsSync(p) ? realpathSync(p) : p;
    if (!roots.includes(real)) roots.push(real);
  };
  const rollDir = join(repoCwd, ".roll");
  if (existsSync(rollDir)) add(rollDir);
  add(dirname(alertsPath));
  return roots;
}

function persistWorktreeAlerts(worktreePath: string, alertsPath: string, events: EventsPort): void {
  let names: string[];
  try {
    names = readdirSync(worktreePath).filter((n) => /^ALERT.*\.md$/i.test(n));
  } catch {
    return;
  }
  for (const name of names) {
    try {
      const path = join(worktreePath, name);
      if (!lstatSync(path).isFile()) continue;
      const body = readFileSync(path, "utf8").trim();
      if (body === "") continue;
      events.appendAlert(
        alertsPath,
        `# worktree alert persisted: ${name}\n\n${body}`,
      );
    } catch {
      /* alert salvage is best-effort */
    }
  }
}

/**
 * FIX-204C — make the MAIN checkout's `.roll` visible inside a cycle worktree.
 *
 * Two moves, both idempotent and best-effort (a failure here must never kill
 * the cycle — the FIX-198 main-anchored reads still work without it):
 *   1. `<wt>/.roll` → symlink to `<repo>/.roll` (only when the worktree did
 *      not check one out — projects that TRACK their whole .roll keep their
 *      real dir). FIX-206: a PARTIAL checkout — a handful of fossil paths
 *      force-committed past a `.roll/` ignore rule (e.g. a leaked
 *      `.roll/ops/release.sh`) — materializes a real `.roll` that shadows the
 *      gitignored, main-only backlog. That incomplete dir is detected (main
 *      has a backlog the worktree's dir lacks) and replaced with the link.
 *   2. one `.roll` line in the repo-common `info/exclude`: the usual
 *      `.gitignore` pattern `.roll/` is DIRECTORY-only and does NOT match a
 *      symlink, so without this the agent's `git add -A` would commit the
 *      link into the delivery PR. info/exclude is repo-local (never pushed)
 *      and covers the main checkout + every worktree.
 */
async function linkRollIntoWorktree(repoCwd: string, worktreePath: string): Promise<void> {
  try {
    const src = join(repoCwd, ".roll");
    const dst = join(worktreePath, ".roll");
    if (!existsSync(src)) return;
    const dstStat = lstatSync(dst, { throwIfNoEntry: false });
    if (dstStat) {
      // Already linked → idempotent re-entry, nothing to do.
      if (dstStat.isSymbolicLink()) return;
      // A real dir at dst is either a project that genuinely TRACKS its whole
      // .roll (keep it) or a PARTIAL fossil materialization (FIX-206). The
      // backlog is the discriminator: if the main .roll carries one and the
      // worktree's checked-out dir does NOT, the dir is an incomplete fossil
      // shadowing the source of truth → drop it and link. A fully-tracked
      // .roll carries its own backlog and is left untouched.
      const incompleteFossil = existsSync(join(src, "backlog.md")) && !existsSync(join(dst, "backlog.md"));
      if (!incompleteFossil) return;
      rmSync(dst, { recursive: true, force: true });
    }
    symlinkSync(src, dst);
    const common = (
      await execFileAsync("git", ["-C", repoCwd, "rev-parse", "--path-format=absolute", "--git-common-dir"])
    ).stdout.trim();
    if (common === "") return;
    const exclude = join(common, "info", "exclude");
    const cur = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
    if (!/^\.roll$/m.test(cur)) {
      mkdirSync(dirname(exclude), { recursive: true });
      appendFileSync(exclude, `${cur === "" || cur.endsWith("\n") ? "" : "\n"}.roll\n`, "utf8");
    }
  } catch {
    /* best-effort: the cycle must not die on an observation/layout nicety */
  }
}

/** Ceiling for the worktree dependency install (cold pnpm store on first run). */
export const DEPS_BOOTSTRAP_TIMEOUT_MS = 600_000;

type DepsExec = (
  cmd: string,
  args: string[],
  opts: { cwd: string; timeout: number; maxBuffer: number },
) => Promise<unknown>;

/**
 * Install dependencies into a fresh cycle worktree BEFORE the agent spawns.
 *
 * The agent sandbox (codex `--sandbox workspace-write`) has no network, so a
 * worktree without node_modules is a worktree where tests can never run —
 * every `pnpm install` inside the cycle dies on ENOTFOUND. The runner runs
 * outside the sandbox with network and a warm package-manager store, so the
 * install belongs here. Skips non-Node projects (no package.json) and projects
 * without a recognized lockfile. Strict on install failure: a loud ALERT and a
 * false return let the caller stop before agent spawn with a failed terminal.
 */
export async function bootstrapWorktreeDeps(
  worktreePath: string,
  alertsPath: string,
  events: EventsPort,
  exec: DepsExec = execFileAsync as unknown as DepsExec,
): Promise<boolean> {
  if (!existsSync(join(worktreePath, "package.json"))) return true;
  if (existsSync(join(worktreePath, "node_modules"))) return true;
  const plan = existsSync(join(worktreePath, "pnpm-lock.yaml"))
    ? { cmd: "pnpm", args: ["install", "--prefer-offline"] }
    : existsSync(join(worktreePath, "package-lock.json"))
      ? { cmd: "npm", args: ["ci", "--prefer-offline"] }
      : undefined;
  if (plan === undefined) return true;
  try {
    await exec(plan.cmd, plan.args, {
      cwd: worktreePath,
      timeout: DEPS_BOOTSTRAP_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    events.appendAlert(
      alertsPath,
      `[FAIL] worktree deps bootstrap failed (${plan.cmd} ${plan.args.join(" ")}): ${msg} — stopping before agent spawn`,
    );
    return false;
  }
}

// ── Node-backed Ports wiring (real infra) ─────────────────────────────────────

/**
 * Build the real Node-backed {@link Ports} bundle. The agent spawn defaults to
 * {@link realAgentSpawn} (claude argv); tests override `agentSpawn` (+ the github
 * facet) with fakes so no real agent / PR side effects occur.
 */
export function nodePorts(opts: {
  repoCwd: string;
  paths: RunnerPaths;
  skillBody: string;
  routeDeps: RouteDeps;
  budget?: BudgetPort;
  agentSpawn?: AgentSpawn;
  clock?: ProcessClock;
}): Ports {
  const bus = new EventBus();
  const clock = opts.clock ?? systemClock;
  return {
    repoCwd: opts.repoCwd,
    paths: opts.paths,
    skillBody: opts.skillBody,
    clock,
    agentSpawn: opts.agentSpawn ?? realAgentSpawn,
    git: {
      async fetchOrigin(repoCwd, branch) {
        const r = await worktreeFetchOrigin(repoCwd, branch);
        return { fetched: r.fetched };
      },
      async worktreeAdd(repoCwd, path, branch, base) {
        return worktreeAdd(repoCwd, path, branch, base);
      },
      async worktreeRemove(repoCwd, path, branch) {
        return worktreeRemove(repoCwd, path, branch);
      },
      async push(repoCwd, branch) {
        return gitPush(repoCwd, branch);
      },
      async commitsAhead(worktreeCwd) {
        const r = await execFileAsync("git", ["rev-list", "--count", "origin/main..HEAD"], {
          cwd: worktreeCwd,
          encoding: "utf8",
        }).catch(() => ({ stdout: "0" }));
        const n = Number((r.stdout ?? "0").trim());
        return Number.isFinite(n) ? n : 0;
      },
      async mainAhead(repoCwd) {
        const r = await execFileAsync("git", ["rev-list", "--count", "origin/main..main"], {
          cwd: repoCwd,
          encoding: "utf8",
        }).catch(() => ({ stdout: "0" }));
        const n = Number((r.stdout ?? "0").trim());
        return Number.isFinite(n) ? n : 0;
      },
      async tcrCount(worktreeCwd) {
        // v2口径 (bin/roll:8724): git log --oneline origin/main..HEAD | grep -c ' tcr:'.
        const r = await execFileAsync("git", ["log", "--oneline", "origin/main..HEAD"], {
          cwd: worktreeCwd,
          encoding: "utf8",
        }).catch(() => ({ stdout: "" }));
        return (r.stdout ?? "")
          .split("\n")
          .filter((l) => l.includes(" tcr:")).length;
      },
    },
    github: {
      async repoSlug(repoCwd) {
        const url = await remoteUrl(repoCwd);
        return ghRepoSlug(url);
      },
      async runPublishPlan(plan) {
        const r = await runPublishPlan(plan);
        return { status: r.status, prUrl: r.prUrl, ok: r.ok };
      },
      async prState(repoCwd, branch) {
        const slug = ghRepoSlug(await remoteUrl(repoCwd));
        if (slug === undefined) return "UNKNOWN";
        return prViewState(slug, branch);
      },
    },
    process: {
      acquireLock(lockPath, o) {
        return acquireLock(lockPath, process.pid, { staleSec: o?.staleSec, now: clock });
      },
      releaseLock(lockPath) {
        releaseLock(lockPath);
      },
      writeHeartbeat(path) {
        writeHeartbeat(path, clock);
      },
    },
    events: {
      ensureEventFiles(eventsPath, runsPath) {
        bus.ensureEventFiles(eventsPath, runsPath);
      },
      appendEvent(eventsPath, event) {
        bus.appendEvent(eventsPath, event);
      },
      upsertRun(runsPath, key, row) {
        bus.upsertRun(runsPath, key, row);
      },
      appendAlert(alertsPath, message) {
        appendAlertLine(alertsPath, message);
      },
    },
    backlog: {
      read(projectCwd) {
        const p = join(projectCwd, ".roll", "backlog.md");
        if (!existsSync(p)) return [];
        return parseBacklog(readFileSync(p, "utf8"));
      },
      // FIX-198: the production binding was MISSING entirely (the optional
      // chain made every In-Progress claim a silent no-op). ID-anchored mark
      // under optimistic concurrency; best-effort — a conflict/IO failure must
      // never kill the cycle, the reconcile pass is the safety net.
      markStatus(projectCwd, id, status) {
        try {
          const p = join(projectCwd, ".roll", "backlog.md");
          if (!existsSync(p)) return;
          const store = new BacklogStore();
          const snap = store.readBacklog(p);
          store.mark(p, snap.hash, id, status);
        } catch {
          /* best-effort: reconcile owns the fallback */
        }
      },
    },
    route: opts.routeDeps
      ? {
          resolve(_storyId, estMin) {
            const tier: Tier = classifyComplexity(estMin);
            const dec = resolveRoute(tier, opts.routeDeps);
            return { agent: dec.agent, model: "" };
          },
        }
      : { resolve: () => ({ agent: "claude", model: "" }) },
    // FIX-249: the budget gate is LIVE — runs.jsonl cost rows + policy.yaml
    // `loop_safety.budget` → budgetVerdict (I11). No budget block → "ok".
    budget: opts.budget ?? { check: () => realBudgetCheck(opts.repoCwd, opts.paths.runsPath, clock() * 1000) },
    evidence: {
      openFrame(projectCwd, storyId, runId) {
        return openEvidenceFrame({ runDir: join(cardArchiveDir(projectCwd, storyId), runId) }).runDir;
      },
    },
    capture: {
      fromMarker(marker, runDir) {
        return captureFromMarker(marker, { runDir });
      },
    },
    attest: {
      async render(projectCwd, storyId, runDir) {
        const prev = process.cwd();
        try {
          process.chdir(projectCwd);
          return await attestCommand([storyId, "--run-dir", runDir]);
        } finally {
          process.chdir(prev);
        }
      },
    },
  };
}

function appendAlertLine(alertsPath: string, message: string): void {
  mkdirSync(dirname(alertsPath), { recursive: true });
  appendFileSync(alertsPath, `${message}\n`, "utf8");
}

// Keep these referenced so resolveFallback / budgetVerdict / parseClaimedIds are
// not stripped by a too-eager tree-shaker in the test bundle (they document the
// available execution surface; nodePorts wires the common path).
export const _availableCoreSurface = {
  resolveFallback,
  budgetVerdict,
  parseClaimedIdsFromBacklog,
} as const;
