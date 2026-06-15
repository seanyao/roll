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
  heteroAvailable,
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
  classifyComplexity,
  decideClaimReconcile,
  latestDeliveringCycle,
  parseClaimedIdsFromBacklog,
  parseBacklog,
  pickStory,
  planPublishDocPr,
  planPublishPr,
  reconcileBranchName,
  resumeCandidateBranches,
  resolveRoute,
  resolveFallback,
  extractUsage,
  sumClaudeStream,
  toCycleCost,
  pairingHistory,
  peerReviewCost,
  type CycleObserverState,
  type ObservedCommit,
  newCycleObserverState,
  observeBuildStart,
  observeCommits,
  maybeBuildHeartbeat,
} from "@roll/core";
import {
  parseEventLine,
  STATUS_MARKER,
  absent,
  buildTerminalEvent,
  findStatusMarker,
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
  worktreeSubmoduleInit,
  worktreeResetHard,
  fetchRemoteBranch,
  branchMergedIntoMain,
  branchCleanlyRebasesOntoMain,
  push as gitPush,
  git as gitRun,
  commit as gitCommit,
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
import { cycleChangedFiles, peerEvidencePresent, readPeerGateMode, runPeerGate } from "./peer-gate.js";
import { readAttestGateMode, runAttestGate, verificationReportPath, webCaptureTargetForStory } from "./attest-gate.js";
import { recoverCodexUsage, recoverKimiUsage, recoverPiUsage } from "./usage-recovery.js";
import { ACMAP_REMEDIATION_TIMEOUT_MS, acMapPath, autoAttachScreenshotToAcMap, buildAcMapRemediationPrompt, needsAcMapRemediation } from "./attest-remediation.js";
import { applyCorrectionAction } from "./correction-actuator.js";
import { buildPairScorePrompt, enabledPairingStages, parsePairScoreOutput, retryPeerConsult, runPairing, runScorePairing, type PairEvent, type PairReview } from "./pairing-gate.js";
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
  /** FIX-302: `_worktree_submodule_init` — `git submodule update --init
   *  --recursive` in the worktree. A fresh git worktree carries NO submodule
   *  contents (notably `skills/` is empty), so the full test can never run.
   *  STRICT: exit code propagated so the runner can fail the setup honestly. */
  worktreeSubmoduleInit(worktreePath: string): Promise<{ code: number }>;
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
  /** US-LOOP-076: the runner's OWN observation of commits on the cycle branch —
   *  `git log --format=%H%x09%ct%x09%s origin/main..HEAD` (oldest-first) in the
   *  worktree. Feeds the agent-agnostic cycle observer so the build/TCR phase
   *  emits standard signals for EVERY agent, never by parsing agent stdout.
   *  LENIENT: returns [] on any git error (observation must never fail a cycle). */
  recentCommits(worktreeCwd: string): Promise<ObservedCommit[]>;
  /** RESUME-PRIOR-WORK: fetch a candidate prior-cycle branch from origin so its
   *  ref resolves locally. LENIENT — `fetched:false` on a missing branch. */
  fetchRemoteBranch(repoCwd: string, branch: string): Promise<{ fetched: boolean }>;
  /** RESUME-PRIOR-WORK condition (a): is `origin/<branch>` already merged into
   *  origin/main? A merged branch has nothing to resume. */
  branchMergedIntoMain(repoCwd: string, branch: string): Promise<boolean>;
  /** RESUME-PRIOR-WORK condition (b): does `origin/<branch>` cleanly merge with
   *  origin/main (no conflicts)? Non-mutating `merge-tree` dry-run. */
  branchCleanlyRebasesOntoMain(repoCwd: string, branch: string): Promise<boolean>;
  /** RESUME-PRIOR-WORK re-point: fetch `<branch>` into the worktree and
   *  `git reset --hard <ref>` so the worktree's tracked tree moves onto the
   *  resume branch (called AFTER the story is picked — see `resume_worktree`).
   *  `code !== 0` ⇒ the re-point failed; the caller leaves the worktree on
   *  origin/main rather than topple the cycle. */
  resetWorktreeHard(worktreeCwd: string, ref: string, branch?: string): Promise<{ code: number }>;
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

/** Outcome of a runner-side `.roll` metadata commit. */
export interface MetadataCommitResult {
  /** A commit was created (there were staged changes). */
  committed: boolean;
  /** The commit (if any) was pushed to the metadata remote. */
  pushed: boolean;
  /** The `.roll` working tree was clean — nothing to commit (clean no-op). */
  nothingToCommit: boolean;
  /** A human-readable failure reason when a commit or push did not succeed. */
  error?: string;
}

/**
 * Metadata facet (FIX-306) — commit + push the project's `.roll` metadata repo.
 *
 * Why the RUNNER owns this, never the agent: the loop's worktree agent writes
 * `.roll` FILES (acceptance reports, evidence, ac-map, backlog marks) into the
 * symlinked `.roll`, but the GIT commit of that nested repo must be the runner's
 * job. A sandboxed agent (codex runs under `--sandbox workspace-write` with the
 * `.roll` dir passed via `--add-dir`) can write those files yet CANNOT
 * `git -C .roll commit`: the `.roll` repo's git-internal dir
 * (`.git/worktrees/roll-meta-v3/index.lock`) lives OUTSIDE the sandbox writable
 * roots, so `git add -A` fails and the cycle ends `failed` (meta-commit-blocked).
 * The runner runs unsandboxed with full FS access, so it commits uniformly for
 * EVERY agent — no per-agent special-casing (roll's normalize-agents thesis).
 */
export interface MetadataPort {
  /** Stage, commit, and push `<projectCwd>/.roll`. No-op cleanly when clean;
   *  reports a failure reason (never a silent false-success) on push failure. */
  commit(projectCwd: string, message: string): Promise<MetadataCommitResult>;
}

/** Routing facet — resolve tier→agent for a story (router.ts). */
export interface RoutePort {
  resolve(storyId: string, estMin: number | undefined): { agent: string; model: string };
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
  /** FIX-306: the runner-owned `.roll` metadata commit (never the sandboxed agent). */
  metadata: MetadataPort;
  route: RoutePort;
  evidence: EvidencePort;
  capture: CapturePort;
  attest: AttestPort;
  agentSpawn: AgentSpawn;
  /** Canonical installed agents — the heterogeneous-peer pool for the peer-gate
   *  retry (FIX-293) and the opt-in pairing stages. Injectable so tests can pin
   *  a deterministic peer pool; defaults to {@link agentsInstalled} over the real
   *  environment probe. */
  installedAgents?: () => string[];
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

/** Default poll cadence for the runner's build-phase observation (ms). Frequent
 *  enough that a new TCR commit becomes an event within a few seconds; cheap (one
 *  `git log` per tick). Overridable via ROLL_OBSERVE_POLL_MS for tests. */
const OBSERVE_POLL_MS = 5_000;

/**
 * US-LOOP-076 — start the runner's agent-agnostic cycle observer for the build
 * phase. Emits the build-start phase marker immediately, then polls the worktree
 * git log on a timer, deriving standard {@link RollEvent}s (cycle:tcr per new
 * commit, a periodic build heartbeat) into events.ndjson. Returns a handle whose
 * `stop()` clears the timer AND takes one final await'd snapshot so the last
 * commits before agent exit are never dropped.
 *
 * All meaning lives in @roll/core's pure {@link observeCommits} /
 * {@link maybeBuildHeartbeat}; this is just the I/O loop (git read + event
 * append). Best-effort throughout: observation must NEVER fail the cycle.
 */
function startCycleObserver(ports: Ports, cycleId: string): { stop(): Promise<void> } {
  if (cycleId === "") return { stop: async () => {} };
  const st: CycleObserverState = newCycleObserverState(cycleId);
  const emit = (events: RollEvent[]): void => {
    for (const ev of events) {
      try {
        ports.events.appendEvent(ports.paths.eventsPath, ev);
      } catch {
        /* observation append is best-effort */
      }
    }
  };
  const pollGapMs = Number((process.env["ROLL_OBSERVE_POLL_MS"] ?? "").trim()) || OBSERVE_POLL_MS;
  emit(observeBuildStart(st, Date.now()));
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return; // a slow git read must not stack ticks
    running = true;
    try {
      const commits = await ports.git.recentCommits(ports.paths.worktreePath);
      const now = Date.now();
      emit(observeCommits(commits, st, now));
      emit(maybeBuildHeartbeat(st, now));
    } catch {
      /* never let a probe blip topple the cycle */
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), pollGapMs);
  timer.unref?.();
  return {
    stop: async () => {
      clearInterval(timer);
      // One final synchronous snapshot — captures the TCR commits that landed
      // between the last tick and the agent exiting.
      await tick();
    },
  };
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
      // Always base the cycle worktree on origin/main (the I12 fresh-context
      // default). RESUME-PRIOR-WORK does NOT happen here: the picker reads the
      // backlog INSIDE the worktree (FIX-198/FIX-204C), so the story id is still
      // UNDEFINED at create_worktree time — resolveResumeBase would early-return
      // origin/main with no alert and resume could never engage (the FIX-284
      // bug). The resume decision is deferred to `resume_worktree`, which fires
      // AFTER pick_story with the real story id and re-points this worktree onto a
      // resumable un-merged branch when one exists. Keying purely on the runs
      // ledger + git keeps it uniform for every agent (normalize-agents thesis).
      const base = "origin/main";
      const r = await ports.git.worktreeAdd(
        ports.repoCwd,
        ports.paths.worktreePath,
        cmd.branch,
        base,
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
      // FIX-302 root cause: a git worktree carries NONE of the parent repo's
      // submodule contents — `skills/` lands EMPTY (0 files; main has 28). The
      // full `roll test`/`pnpm -r test` reads skills/, so on an empty worktree
      // the suite can never run, AC4 stays "partial", and the cycle can never
      // honestly close a card. Populate the submodule HERE, in the runner (same
      // place deps install — network + warm caches). On failure, fail the
      // worktree setup with an honest terminal reason rather than spawn the
      // agent into an env where AC4 silently goes partial.
      const skillsOk = await bootstrapWorktreeSkills(
        ports.paths.worktreePath,
        ports.paths.alertsPath,
        ports.events,
        ports.git.worktreeSubmoduleInit,
      );
      if (!skillsOk) return { event: { type: "worktree_failed" } };
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
      // Hook 3 (pre-spawn spec-truth check): the picker only returns a card whose
      // backlog row is NOT ✅ Done and that has no open PR (so by construction it
      // is NOT merged). If that card's spec.md still claims "✅ Fixed/Done / [x]
      // AC", the spec is STALE (a prior non-merged cycle left it poisoned). Reset
      // it BEFORE the agent reads it, so the agent never silently concludes "done
      // → nothing to do → idle". This is exactly the FIX-284/285 dead-end: with a
      // clean spec the re-run can deliver. A genuinely merged Done card is never
      // picked here (its row is ✅ Done), so this never touches a real Done spec.
      resetStaleSpecTruth(ports, story.id);
      // FIX-304: capture the story's PRE-cycle status BEFORE we claim it 🔨.
      // The terminal (append_run) uses it to UNDO a premature ✅ Done the agent
      // wrote into the symlinked .roll backlog (FIX-204C) when the cycle does
      // NOT merge — done ≡ merged. Read it from the freshly-read rows so the
      // captured value is the true pre-cycle state (typically 📋 Todo), not the
      // 🔨 we are about to write. Best-effort: an absent status leaves it unset
      // (no revert target — the terminal then leaves the row untouched).
      const preCycleStatus = (story as { status?: string }).status;
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
      return {
        event: { type: "story_picked", storyId: story.id },
        ctxPatch: {
          evidenceRunDir,
          ...(preCycleStatus !== undefined && preCycleStatus !== "" ? { preCycleStatus } : {}),
        },
      };
    }

    // RESUME-PRIOR-WORK re-point (post-pick) — the ONE real resume decision point.
    //
    // The worktree was created on origin/main (the fresh-context default) BEFORE
    // the story was picked; this is the FIRST step that has the real picked story
    // id (pick_story reads the backlog INSIDE the worktree, FIX-198/FIX-204C, so
    // the id is undefined at create_worktree — moving the decision here is the
    // FIX-284 wiring fix). resolveResumeBase keys purely on the runs ledger + git
    // (uniform for every agent — normalize-agents thesis):
    //   · returns origin/main → no resumable un-merged branch (or resume disabled
    //     / probe blip) → leave the worktree on origin/main (unchanged no-op).
    //   · returns origin/<branch> ≠ origin/main → a prior un-merged cycle branch
    //     cleanly rebases onto origin/main → RE-POINT this already-created worktree
    //     to it (fetch + reset --hard) so the agent RESUMES the prior product code
    //     rather than redoing it. The ALERT is already emitted by resolveResumeBase.
    // The symlinked .roll (FIX-204C) and the picker's 🔨 backlog mark are NOT part
    // of the worktree's tracked git content, so the hard reset leaves them intact.
    // Runs BEFORE resolve_route → spawn_agent (orchestrator command order), so the
    // worktree carries the resume tree by the time the agent spawns. Best-effort: a
    // reset failure leaves the worktree on origin/main rather than topple the cycle.
    case "resume_worktree": {
      const base = await resolveResumeBase(ports, cmd.storyId);
      if (base === "origin/main" || base.trim() === "") return {};
      // `origin/<branch>` → derive the bare branch name for the worktree-local
      // fetch (the resume probes fetched it into the MAIN tree, not this worktree).
      const branch = base.startsWith("origin/") ? base.slice("origin/".length) : undefined;
      try {
        const r = await ports.git.resetWorktreeHard(ports.paths.worktreePath, base, branch);
        if (r.code !== 0) {
          ports.events.appendAlert(
            ports.paths.alertsPath,
            `resume-prior-work: re-point of worktree onto ${base} for ${cmd.storyId} FAILED (git reset --hard exit ${r.code}); proceeding fresh from origin/main`,
          );
        }
      } catch {
        /* resume is an optimization — a re-point blip must never topple the cycle */
      }
      return {};
    }

    // agent/router resolveRoute (+ pre-spawn availability fallback).
    case "resolve_route": {
      const items = ports.backlog.read(ports.repoCwd);
      const story = items.find((i) => i.id === cmd.storyId);
      const estMin = story === undefined ? undefined : parseEstMin(story.desc);
      const r = ports.route.resolve(cmd.storyId, estMin);
      return { event: { type: "route_resolved", agent: r.agent, model: r.model } };
    }

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
      // US-LOOP-076 (folds in FIX-310) — the BLACK-BOX KILLER. The agent run
      // below blocks for the WHOLE build/TCR phase (37 min observed). Before this
      // the runner emitted ZERO structured events in that window for every agent,
      // and the only "key node" extraction parsed claude stream-json (codex/kimi/
      // pi build phases invisible — a core-thesis violation). The poller fixes it
      // ONE agent-agnostic way: it observes the runner's OWN view of the cycle —
      // git commits on the worktree branch + the wall clock — and DERIVES standard
      // cycle:tcr / cycle:phase / build-heartbeat events into events.ndjson. It
      // never parses the agent's stdout, so a single path serves EVERY agent.
      const observer = startCycleObserver(ports, ctx.cycleId ?? "");
      let res: Awaited<ReturnType<typeof ports.agentSpawn>>;
      try {
        res = await ports.agentSpawn(cmd.agent, {
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
      } finally {
        // Stop the timer AND take one final synchronous-await snapshot so the LAST
        // TCR commits (landed between the last tick and agent exit) are not lost.
        await observer.stop();
      }
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
      // FIX-208/FIX-249/FIX-303: fold the agent's real usage into a per-cycle
      // cost via a per-agent normalization layer onto ONE 4-component model
      // (input/output/cache-read/cache-write — the roll thesis). Lanes:
      //   1. claude stream-json (per-turn usage + final total_cost_usd);
      //   2. AUTHORITATIVE session-store recovery for the agents whose `-p`/
      //      `exec` stdout carries no parseable usage — each writes real per-turn
      //      usage to its own store, scoped here to this cycle's worktree + start:
      //        pi    → ~/.pi/agent/sessions/<encoded-cwd>/*.jsonl
      //        kimi  → ~/.kimi-code/sessions/wd_<wt>_*/.../wire.jsonl
      //        codex → ~/.codex/sessions/<date>/rollout-*.jsonl
      //   3. generic stdout-scrape footer agents (openai/gemini/kimi/qwen
      //      REGISTRY) — the lossy 2-component legacy fallback, tried LAST so a
      //      session recovery's full 4-component split always wins when present.
      // Best-effort: a miss on every lane leaves cost absent (n/a, never a fake
      // zero) — usage accounting must never fail the cycle.
      let costPatch: CycleCost | undefined;
      try {
        const agentName = ctx.agent ?? cmd.agent;
        const lines = res.stdout.split("\n");
        let usage = sumClaudeStream(lines);
        if (usage === null && agentName === "pi") {
          const rootOverride = (process.env["ROLL_PI_SESSIONS_ROOT"] ?? "").trim();
          usage = recoverPiUsage(
            ports.paths.worktreePath,
            ctx.startSec,
            ...(rootOverride !== "" ? [rootOverride] : []),
          );
        }
        if (usage === null && agentName === "kimi") {
          const rootOverride = (process.env["ROLL_KIMI_SESSIONS_DIR"] ?? "").trim();
          usage = recoverKimiUsage(
            ports.paths.worktreePath,
            ctx.startSec,
            ...(rootOverride !== "" ? [rootOverride] : []),
          );
        }
        if (usage === null && (agentName === "codex" || agentName === "openai")) {
          const rootOverride = (process.env["ROLL_CODEX_SESSIONS_DIR"] ?? "").trim();
          usage = recoverCodexUsage(
            ports.paths.worktreePath,
            ctx.startSec,
            ...(rootOverride !== "" ? [rootOverride] : []),
          );
        }
        // Legacy stdout-scrape fallback (LAST): only when no authoritative
        // session usage was found, so a 2-component footer never overrides a
        // recovered 4-component split.
        if (usage === null) usage = extractUsage(agentName, lines);
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
      // The one-way peer-consult closure, shared by the peer gate's retry
      // (FIX-293) and the opt-in pairing stages (US-PAIR-003). A different agent
      // reads the cycle diff and returns a terse verdict; 30s hard timeout
      // (belt-and-braces race) so a flaky peer (pi) never stalls the cycle.
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
      // Full cycle diff (origin/main...HEAD), shared by the gate retry + pairing.
      const cycleDiff = async (cwd: string): Promise<string> => {
        try {
          // Baseline mirrors peer-gate's cycleChangedFiles (origin/main...HEAD):
          // roll's loop always targets main (Done ≡ merged to main), so this is
          // the cycle's net change. Kept identical to peer-gate for consistency.
          const { stdout } = await execFileAsync("git", ["diff", "origin/main...HEAD"], { cwd, encoding: "utf8" });
          return stdout.slice(0, 60_000);
        } catch {
          return "";
        }
      };
      // FIX-293 peer gate: agent-agnostic, runs in EVERY cycle's capture step.
      // High-complexity delivery (>3 files / cross-module / high-risk) WITHOUT
      // peer evidence → ALERT + `peer:gate` event AND, in the default HARD mode,
      // a BLOCK: the verdict is no longer discarded. On a block we RE-ATTEMPT the
      // peer consult ONCE (existing reviewPeer path, same 30s hard timeout — no
      // death-spiral on a flaky peer). If the retry produces evidence the gate
      // re-runs green and the cycle proceeds; if it still yields none the cycle
      // ends NOT-Done (peerBlocked → facts.agentExit=1, mirroring the attest gate)
      // and an escalation alert fires. `loop_safety.peer_gate: soft` in
      // policy.yaml keeps the legacy record-only behaviour for a migration window.
      const peerGateMode = readPeerGateMode(ports.repoCwd);
      const runtimeDir = dirname(ports.paths.eventsPath);
      const cycleIdStr = ctx.cycleId ?? "";
      // FIX-312: hetero-availability drives the gate (owner ruling: "hetero
      // available → must use it; self only when hetero is truly impossible").
      // Computed uniformly by vendor through the standard model (no per-agent
      // special-casing): is there ≥1 installed agent of a DIFFERENT vendor than
      // the builder? true ⇒ a self-reviewed substantive delivery is blocked;
      // false ⇒ self-review is an allowed recorded fallback (single-agent setups).
      const peerGateInstalled = ports.installedAgents?.() ?? agentsInstalled(realAgentEnv());
      const peerGateWorker = ctx.agent ?? "claude";
      const peerHeteroAvailable = heteroAvailable(peerGateInstalled, peerGateWorker);
      const peerGateSinks = {
        alert: (m: string) => ports.events.appendAlert(ports.paths.alertsPath, m),
        event: (p: { cycleId: string; verdict: string; reasons: string[] }) =>
          ports.events.appendEvent(ports.paths.eventsPath, {
            type: "peer:gate",
            cycleId: p.cycleId,
            verdict: p.verdict as "consulted" | "skipped" | "self-review-allowed",
            reasons: p.reasons,
            ts: ports.clock(),
          }),
      };
      const peerGateOpts = { heteroAvailable: peerHeteroAvailable };
      let peerGate = await runPeerGate(ports.paths.worktreePath, runtimeDir, cycleIdStr, peerGateMode, peerGateSinks, peerGateOpts);
      let peerBlocked = peerGate.blocked;
      if (peerGate.blocked) {
        // AC-H3: bounded retry — exactly one re-attempt via the existing consult.
        const retry = await retryPeerConsult(ports.paths.worktreePath, runtimeDir, cycleIdStr, {
          installed: peerGateInstalled,
          workingAgent: peerGateWorker,
          reviewPeer,
          diff: cycleDiff,
          event: (e: PairEvent) => ports.events.appendEvent(ports.paths.eventsPath, e as RollEvent),
          now: () => ports.clock(),
        });
        if (retry.status === "reviewed" && peerEvidencePresent(runtimeDir, cycleIdStr)) {
          // Retry produced evidence → re-run the gate; it now sees `consulted`.
          peerGate = await runPeerGate(ports.paths.worktreePath, runtimeDir, cycleIdStr, peerGateMode, peerGateSinks, peerGateOpts);
          peerBlocked = peerGate.blocked;
        }
        if (peerBlocked) {
          // Still no peer evidence after the retry → escalate; cycle ends NOT-Done.
          // The retry already prefers a different-type agent and, when none is
          // installed, falls back to a fresh SEPARATE-SESSION instance of the
          // working agent's own type — so a block here means the separate-session
          // review itself produced no evidence (it timed out / errored), NOT that
          // no other agent was installed.
          const how = retry.sameTypeFallback === true ? "same-type separate-session review" : "peer review";
          ports.events.appendAlert(
            ports.paths.alertsPath,
            `peer gate (hard): high-complexity work still without peer evidence after one retry — the ${how} produced no evidence (${retry.status}) — cycle ${cycleIdStr} BLOCKED; story not marked Done`,
          );
        }
      }
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
          installed: ports.installedAgents?.() ?? agentsInstalled(realAgentEnv()),
          isAvailable: () => true, // MVP: `installed` is the hard gate; a dead peer → reviewPeer null (non-blocking). Real probe is a refinement.
          reviewPeer,
          ...(pairHistory !== undefined ? { history: pairHistory } : {}),
          changedFiles: cycleChangedFiles,
          diff: cycleDiff,
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
        // render#1 captures the screenshot + writes evidence.json + builds the
        // per-AC report from the ac-map. FIX-317: the agent wires text-only
        // evidence, so the visual floor (passAcVisualFloor) rejects pass ACs that
        // lack a per-AC screenshot ref even though a REAL screenshot was captured.
        // Bridge it in the harness — attach the captured screenshot to the pass
        // ACs (honest: only a screenshot that exists this cycle), then re-render so
        // the per-AC <figure> appears. Best-effort; never fails the cycle.
        let rc = await ports.attest.render(ports.paths.worktreePath, storyId, ctx.evidenceRunDir);
        if (rc === 0) {
          const attached = autoAttachScreenshotToAcMap(ports.paths.worktreePath, storyId, ctx.evidenceRunDir);
          if (attached !== null) {
            ports.events.appendEvent(ports.paths.eventsPath, {
              type: "attest:auto-attach",
              cycleId: ctx.cycleId ?? "",
              storyId,
              href: attached.href,
              attachedCount: attached.count,
              ts: ports.clock(),
            });
            rc = await ports.attest.render(ports.paths.worktreePath, storyId, ctx.evidenceRunDir);
          }
        }
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
      // Hook 1 (productivity floor): reaching capture means an agent WAS spawned
      // this cycle (the no_story no-op terminates idle before ever capturing). An
      // executed cycle that leaves 0 commits is therefore a `gave_up`, NOT a
      // silent idle. The signal mirrors the `rowSpentZeroNoExecution` semantics:
      // an agent slot is set, and the spawn ran (its spend/duration are recorded
      // on the runs row). A defensively-empty agent slot stays idle.
      const agentExecuted = (ctx.agent ?? "").trim() !== "";
      const facts: CapturedFacts = {
        usedWorktree: true,
        agentExecuted,
        // accept-path reaches capture at exit 0; a HARD attest OR peer block fails
        // the capture (classifyCaptured: exit ≠ 0 → failed) so Done is withheld.
        // FIX-293: a high-complexity delivery with no peer review (even after the
        // one retry) is peerBlocked → it MUST NOT self-score / flip Done. The
        // FIX-244 PR-state "published" reclassification stays scoped to the attest
        // block (a peer-blocked cycle still owes peer review; Done≡merged anyway).
        agentExit: attestBlocked || peerBlocked ? 1 : 0,
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
      const terminalStoryId = ctx.storyId ?? "";
      let terminalMerged = false;
      if ((cmd.status === "done" || cmd.status === "published") && terminalStoryId !== "") {
        const state = await ports.github.prState(ports.repoCwd, ctx.branch).catch(() => "UNKNOWN");
        if (state === "MERGED") {
          terminalMerged = true;
          ports.backlog.markStatus?.(ports.repoCwd, terminalStoryId, STATUS_MARKER.done);
        } else {
          // FIX-304: done ≡ merged. The PR did NOT merge (still OPEN / closed /
          // gh down), yet the agent may have ALREADY flipped this row ✅ Done in
          // the symlinked .roll backlog (FIX-204C → the REAL .roll). A delivered
          // row legitimately rests at 🔨 (pending merge), but a premature ✅ Done
          // is a FALSE-Done — undo it back to the pre-cycle status so the backlog
          // reflects TRUE delivery. The async PR loop's later preflight reconcile
          // (decideClaimReconcile) flips it once the PR actually merges.
          revertPrematureDone(ports, terminalStoryId, ctx.preCycleStatus);
        }
      } else if ((cmd.status === "idle" || cmd.status === "gave_up") && terminalStoryId !== "") {
        // idle / gave_up never merged → the row goes back to 📋 Todo (re-pickable).
        ports.backlog.markStatus?.(ports.repoCwd, terminalStoryId, STATUS_MARKER.todo);
      } else if (terminalStoryId !== "") {
        // FIX-304: a failed / blocked / aborted / orphan terminal NEVER merged
        // this cycle's work to main. If the agent pre-flipped the row ✅ Done
        // (the FIX-284 / FIX-285 false-Done), revert it to the pre-cycle status
        // so a non-merged cycle can never leave a premature Done in the backlog.
        revertPrematureDone(ports, terminalStoryId, ctx.preCycleStatus);
      }
      // Hook 3 (spec-truth reconciliation): on ANY non-merged terminal
      // (idle/gave_up/failed/blocked/aborted/orphan) reset a stale "✅ Fixed/Done"
      // tick and the "[x]" AC checkboxes in the card's spec.md back to unchecked.
      // The agent commits a false "done" spec into the symlinked .roll on a cycle
      // whose product work never merged (FIX-284/285); FIX-304 only fixed the
      // backlog ROW, leaving the spec poisoned so every re-run reads "done" → 0
      // commits → idles forever. Resetting it here (committed via the
      // commitRollMetadata path below) closes that permanent dead-end so a re-run
      // CAN deliver. A genuinely MERGED Done spec is left untouched.
      if (!terminalMerged && terminalStoryId !== "") {
        resetStaleSpecTruth(ports, terminalStoryId);
      }
      // FIX-290 AC5: a failed/idle cycle is first-class — refresh the dossier
      // aggregates on EVERY cycle terminal so the cycle surfaces on the web #loop
      // ledger immediately, not only after the next delivery (which mounted the
      // execution section at publish) or a manual `roll index`. Best-effort: a
      // refresh failure WARNs and never fails the cycle terminal.
      refreshAggregates(ports.repoCwd);
      // FIX-306: the RUNNER commits + pushes the `.roll` metadata repo — the
      // sandboxed agent (codex) only WROTE its files (acceptance report, evidence,
      // ac-map, backlog marks) and CANNOT git-commit `.roll` (its git-internal dir
      // is outside the sandbox writable roots → meta-commit-blocked → failed
      // cycle). Runs LAST so it captures everything this terminal wrote (the runs
      // twin's backlog flip + the refreshed aggregates) plus the agent's files.
      // Uniform for every agent (no `if codex`). This does NOT decide the Done
      // flip — that stays gated on MERGED above; it only commits whatever `.roll`
      // state exists. A push failure is surfaced as an ALERT (never a silent
      // false-success); a clean tree no-ops without noise.
      await commitRollMetadata(ports, ctx);
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

/**
 * FIX-306: the runner-side `.roll` metadata commit, invoked at cycle finalize.
 * Delegates to {@link MetadataPort.commit}; a clean tree (`nothingToCommit`) is a
 * silent no-op, while any unfinished commit/push (no `pushed`) raises an auditable
 * ALERT — the cycle never reports a silent false-success on metadata it failed to
 * land. Best-effort: a thrown port (e.g. git missing) is alerted, never fatal.
 */
async function commitRollMetadata(ports: Ports, ctx: CycleContext): Promise<void> {
  const message = `chore: loop cycle ${ctx.cycleId}${ctx.storyId !== undefined && ctx.storyId !== "" ? ` ${ctx.storyId}` : ""} metadata`;
  let res: MetadataCommitResult;
  try {
    res = await ports.metadata.commit(ports.repoCwd, message);
  } catch (e) {
    ports.events.appendAlert(
      ports.paths.alertsPath,
      `.roll metadata commit threw for cycle ${ctx.cycleId} — ${String(e)}`,
    );
    return;
  }
  if (res.nothingToCommit) return; // clean tree → quiet no-op
  if (!res.pushed) {
    ports.events.appendAlert(
      ports.paths.alertsPath,
      `.roll metadata push FAILED for cycle ${ctx.cycleId}${res.committed ? " (committed locally, not pushed)" : ""} — ${res.error ?? "unknown error"}`,
    );
  }
}

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
    gave_up: "gave_up",
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

/** RESUME-PRIOR-WORK kill switch — set `ROLL_LOOP_NO_RESUME=1` to force the I12
 *  fresh-context default (always base the worktree on origin/main). */
export const RESUME_DISABLED_ENV = "ROLL_LOOP_NO_RESUME";

/** True when resume-prior-work is disabled via {@link RESUME_DISABLED_ENV}. The
 *  feature is default-ON (serves the no-waste intent); set the env to 1 to disable. */
function resumeDisabled(): boolean {
  return (process.env[RESUME_DISABLED_ENV] ?? "").trim() === "1";
}

/**
 * RESUME-PRIOR-WORK — resolve the git base ref the cycle worktree should branch
 * off. Default-ON; the result is `origin/main` (fresh-context, byte-identical to
 * the pre-resume behaviour) UNLESS the picked card has a prior un-merged cycle
 * branch that cleanly rebases onto origin/main, in which case it returns that
 * branch (`origin/loop/cycle-<id>`) so the new cycle RESUMES the prior work.
 *
 * Selection (keys purely on the runs ledger + git — uniform for every agent):
 *   1. disabled (ROLL_LOOP_NO_RESUME=1) or no storyId → origin/main.
 *   2. {@link resumeCandidateBranches} maps the card → its branch-pushing cycle
 *      branches, MOST-RECENT-FIRST (runs ledger story_id↔cycle_id link).
 *   3. for each candidate, fetch it, then keep the first that is (a) NOT merged
 *      into origin/main AND (b) cleanly rebases onto origin/main → resume on it.
 *   4. when a resumable branch EXISTED but none cleanly rebased, emit an ALERT so
 *      the operator knows resume was skipped, then fall back to origin/main.
 *
 * Best-effort by contract: a probe that throws degrades to origin/main — the
 * resume optimization must NEVER topple a cycle that fresh-context would run.
 */
export async function resolveResumeBase(
  ports: Ports,
  storyId: string | undefined,
): Promise<string> {
  const FRESH = "origin/main";
  if (resumeDisabled()) return FRESH;
  if (storyId === undefined || storyId.trim() === "") return FRESH;
  try {
    const rows = readRunsRows(ports.paths.runsPath);
    const candidates = resumeCandidateBranches(rows, storyId);
    if (candidates.length === 0) return FRESH;
    let sawUnmergedConflict = false;
    for (const branch of candidates) {
      const { fetched } = await ports.git.fetchRemoteBranch(ports.repoCwd, branch);
      if (!fetched) continue; // branch gone from origin → nothing to resume here.
      // Condition (a): a branch already merged into origin/main has nothing to
      // resume — its work is on main; the next candidate (older) may still hold
      // un-merged work, so keep scanning.
      if (await ports.git.branchMergedIntoMain(ports.repoCwd, branch)) continue;
      // Condition (b): only a clean rebase is safe to spawn into. A conflicting
      // un-merged branch is the "resumable existed but skipped" case → ALERT.
      if (await ports.git.branchCleanlyRebasesOntoMain(ports.repoCwd, branch)) {
        ports.events.appendAlert(
          ports.paths.alertsPath,
          `resume-prior-work: cycle for ${storyId} resumes un-merged branch ${branch} (rebased onto origin/main) instead of redoing from scratch`,
        );
        return `origin/${branch}`;
      }
      sawUnmergedConflict = true;
    }
    if (sawUnmergedConflict) {
      ports.events.appendAlert(
        ports.paths.alertsPath,
        `resume-prior-work: ${storyId} has un-merged prior cycle work but it does NOT cleanly rebase onto origin/main — resume SKIPPED; starting fresh from origin/main (manual rescue needed)`,
      );
    }
    return FRESH;
  } catch {
    /* resume is an optimization — never topple the cycle on a probe blip */
    return FRESH;
  }
}

/**
 * FIX-304 — enforce done ≡ merged at the cycle terminal: undo a PREMATURE
 * ✅ Done the agent wrote into the backlog when this cycle did NOT merge.
 *
 * The roll-build / roll-fix skills instruct the agent to mark its card Done in
 * `.roll/backlog.md`, which FIX-204C SYMLINKS into the cycle worktree — so the
 * agent's edit lands in the REAL `.roll`. If the cycle never merges (it failed,
 * was blocked, or the PR is still open), that premature Done persists, showing a
 * card Done with no commit on main (the observed FIX-284 / FIX-285 false-Done).
 *
 * The undo is SCOPED to THIS cycle's own story id — it is the row this cycle
 * just claimed and (in a non-merged terminal) the agent just falsely flipped, so
 * it is distinct from a genuine pre-card-era Done (which is never this cycle's
 * picked story). We revert ONLY when the row is currently ✅ Done; a delivered
 * row that already rests at 🔨 In Progress (pending merge) is left untouched.
 * The target is the pre-cycle status captured at pick time (typically 📋 Todo);
 * when it was unread or itself Done (a re-run of an already-Done card), fall back
 * to 📋 Todo so a non-merged story is left re-pickable, never falsely Done.
 */
export function revertPrematureDone(ports: Ports, storyId: string, preCycleStatus: string | undefined): void {
  try {
    const rows = ports.backlog.read(ports.repoCwd) as Array<{ id: string; status?: string }>;
    const row = rows.find((r) => r.id === storyId);
    if (row === undefined) return;
    const current = findStatusMarker(row.status ?? "");
    // Only a ✅ Done row is a premature flip to undo; anything else is correct.
    if (current !== STATUS_MARKER.done) return;
    const captured = findStatusMarker(preCycleStatus ?? "");
    const target = captured !== undefined && captured !== STATUS_MARKER.done ? captured : STATUS_MARKER.todo;
    ports.backlog.markStatus?.(ports.repoCwd, storyId, target);
  } catch {
    /* best-effort: the terminal must never fail on a backlog read/write blip */
  }
}

/**
 * Hook 3 — the PURE spec-truth reset transform. Given a card's `spec.md` text,
 * undo a STALE "done" claim so a re-run reads an honest, workable spec:
 *   - the H1 title's trailing "✅" tick (e.g. `# FIX-167 ✅`) is dropped;
 *   - a `**Status**: ✅ Done` / `✅ Fixed` line is reset to `📋 Todo`;
 *   - every checked AC checkbox `- [x]` / `- [X]` is reset to `- [ ]`.
 * Idempotent: a spec with no ticks/checks is returned unchanged (so the caller
 * can skip a no-op commit). Pure string→string — unit-tested directly.
 */
export function resetSpecTruthText(text: string): { text: string; changed: boolean } {
  let changed = false;
  const lines = text.split("\n");
  const out = lines.map((line) => {
    // H1 title trailing tick: `# <ID> ✅` → `# <ID>`.
    if (/^#\s/.test(line) && /[✅✔]\s*$/.test(line)) {
      changed = true;
      return line.replace(/\s*[✅✔]\s*$/, "");
    }
    // Status line claiming done/fixed → reset to Todo (preserve any trailer text
    // after the marker, e.g. parenthetical PR notes, by dropping the false claim).
    if (/^\*\*Status\*\*\s*:/.test(line) && /[✅✔]\s*(Done|Fixed|Fix)\b/i.test(line)) {
      changed = true;
      return "**Status**: 📋 Todo";
    }
    // Checked AC checkbox → unchecked.
    if (/^(\s*[-*]\s+)\[[xX]\]/.test(line)) {
      changed = true;
      return line.replace(/^(\s*[-*]\s+)\[[xX]\]/, "$1[ ]");
    }
    return line;
  });
  return { text: out.join("\n"), changed };
}

/**
 * Hook 3 — apply {@link resetSpecTruthText} to the card's spec.md on disk (read
 * via the symlinked .roll inside the worktree → the REAL .roll). Best-effort: a
 * missing/unreadable spec or a no-op (no stale claim) leaves the tree untouched;
 * the actual roll-meta commit is the caller's {@link commitRollMetadata}.
 */
export function resetStaleSpecTruth(ports: Ports, storyId: string): void {
  try {
    const specPath = join(cardArchiveDir(ports.repoCwd, storyId), "spec.md");
    if (!existsSync(specPath)) return;
    const before = readFileSync(specPath, "utf8");
    const { text, changed } = resetSpecTruthText(before);
    if (!changed) return;
    writeFileSync(specPath, text);
    ports.events.appendAlert(
      ports.paths.alertsPath,
      `spec truth reset for ${storyId}: a non-merged terminal cleared a stale ✅/[x] spec claim so a re-run can deliver`,
    );
  } catch {
    /* best-effort: a spec read/write blip must never fail the cycle terminal */
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

/**
 * FIX-306 — stage, commit, and push the project's `.roll` metadata repo. This is
 * the RUNNER's job (it runs unsandboxed, with full FS + network access), NOT the
 * agent's: a sandboxed codex agent can write `.roll` files but cannot
 * `git -C .roll commit` (its git-internal dir is outside the sandbox writable
 * roots → meta-commit-blocked). The behaviour is uniform for every agent.
 *
 * Contract (mirrors {@link MetadataPort.commit}):
 *   - `.roll` absent, not a git repo, or part of the MAIN repo (a project that
 *     TRACKS `.roll` inside its own checkout) → clean no-op (`nothingToCommit`):
 *     for those projects the `.roll` content rides the delivery PR, not a
 *     separate metadata commit. Only the nested roll-meta layout is committed.
 *   - `git add -A` then a clean tree → clean no-op (`nothingToCommit`).
 *   - staged changes → commit; on commit failure report `{committed:false, error}`.
 *   - committed → push; a push failure reports `{committed:true, pushed:false,
 *     error}` so the caller can ALERT rather than claim a silent false-success.
 */
export async function commitRollMetadataRepo(
  projectCwd: string,
  message: string,
): Promise<MetadataCommitResult> {
  const rollDir = join(projectCwd, ".roll");
  if (!existsSync(rollDir)) return { committed: false, pushed: false, nothingToCommit: true };
  // `.roll` must be its OWN git repo (the nested roll-meta), NOT a `.roll` dir
  // that the MAIN repo tracks. The discriminator: `.roll`'s git toplevel must BE
  // the `.roll` dir itself. If it resolves to a parent (the main checkout), the
  // `.roll` content is delivered by the PR — committing it here would stage the
  // whole main repo. Resolve both sides through symlinks (the cycle worktree's
  // `.roll` is a symlink to the main one; FIX-204C) before comparing.
  const top = await gitRun(["rev-parse", "--show-toplevel"], rollDir);
  if (top.code !== 0) return { committed: false, pushed: false, nothingToCommit: true };
  let topReal: string;
  let rollReal: string;
  try {
    topReal = realpathSync(top.stdout.trim());
    rollReal = realpathSync(rollDir);
  } catch {
    return { committed: false, pushed: false, nothingToCommit: true };
  }
  if (topReal !== rollReal) return { committed: false, pushed: false, nothingToCommit: true };
  // Stage everything the agent + runner wrote (reports, evidence, ac-map, backlog
  // marks, dossier aggregates). `add -A` is the runner's privilege — the failing
  // step inside the sandboxed agent.
  const staged = await gitRun(["add", "-A"], rollDir);
  if (staged.code !== 0) {
    return { committed: false, pushed: false, nothingToCommit: false, error: `git add -A failed: ${staged.stderr.trim()}` };
  }
  const status = await gitRun(["status", "--porcelain"], rollDir);
  if (status.code === 0 && status.stdout.trim() === "") {
    return { committed: false, pushed: false, nothingToCommit: true };
  }
  const committed = await gitCommit(rollDir, message);
  if (committed.code !== 0) {
    return { committed: false, pushed: false, nothingToCommit: false, error: `git commit failed: ${committed.stderr.trim()}` };
  }
  const branch = (await gitRun(["rev-parse", "--abbrev-ref", "HEAD"], rollDir)).stdout.trim() || "main";
  const pushed = await gitPush(rollDir, branch);
  if (pushed.code !== 0) {
    return { committed: true, pushed: false, nothingToCommit: false, error: `git push failed: ${pushed.stderr.trim()}` };
  }
  return { committed: true, pushed: true, nothingToCommit: false };
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

/** Submodule update can clone over the network (cold) — give it the same room. */
export const SKILLS_BOOTSTRAP_TIMEOUT_MS = 600_000;

/** Count immediate entries under `<worktree>/skills` (0 ⇒ unpopulated). */
function skillsEntryCount(worktreePath: string): number {
  const dir = join(worktreePath, "skills");
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).length;
  } catch {
    return 0;
  }
}

/**
 * Populate the worktree's git SUBMODULES (notably `skills/`) BEFORE the agent
 * spawns. FIX-302 root cause: a fresh `git worktree` carries none of a parent
 * repo's submodule contents — `skills/` lands EMPTY (0 files; main has 28). The
 * full `roll test` / `pnpm -r test` reads `skills/`, so on an empty worktree the
 * suite can never run and AC4 stays "partial" forever — the cycle can never
 * honestly close a card.
 *
 * Approach: `git submodule update --init --recursive` (v2's
 * `_worktree_submodule_init`). A symlink was rejected empirically: `skills/` is a
 * TRACKED submodule path (gitlink), and git refuses a symlink there — `git
 * status` errors out (`expected submodule path 'skills' not to be a symbolic
 * link`), which would topple the whole TCR gate. The submodule init is
 * git-native, leaves `git status` clean, and pins the same SHA as main.
 *
 * Runs in the runner (network + warm caches), like {@link bootstrapWorktreeDeps}.
 * Idempotent: skips when `skills/` is already populated. Skips non-submodule
 * projects (no `.gitmodules`). STRICT on failure: a loud ALERT and a false
 * return let the caller stop before agent spawn with an honest terminal — never
 * an empty `skills/` where AC4 silently goes partial.
 */
export async function bootstrapWorktreeSkills(
  worktreePath: string,
  alertsPath: string,
  events: EventsPort,
  submoduleInit: (worktreePath: string) => Promise<{ code: number }>,
): Promise<boolean> {
  // No submodules declared → nothing to populate (ordinary projects).
  if (!existsSync(join(worktreePath, ".gitmodules"))) return true;
  // Already populated (idempotent re-entry) → skip the network round-trip.
  if (skillsEntryCount(worktreePath) > 0) return true;
  try {
    const r = await submoduleInit(worktreePath);
    if (r.code !== 0) {
      events.appendAlert(
        alertsPath,
        `[FAIL] worktree submodule init failed (git submodule update --init --recursive, code ${r.code}): skills/ would be empty → the full test cannot run; stopping before agent spawn`,
      );
      return false;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    events.appendAlert(
      alertsPath,
      `[FAIL] worktree submodule init failed (git submodule update --init --recursive): ${msg} — stopping before agent spawn`,
    );
    return false;
  }
  // Defensive verification: init reported success but skills/ is still empty
  // (e.g. a partial clone) → fail honestly rather than spawn into a broken env.
  if (skillsEntryCount(worktreePath) === 0) {
    events.appendAlert(
      alertsPath,
      `[FAIL] worktree submodule init reported success but skills/ is still empty — stopping before agent spawn`,
    );
    return false;
  }
  return true;
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
      async worktreeSubmoduleInit(worktreePath) {
        return worktreeSubmoduleInit(worktreePath);
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
      async recentCommits(worktreeCwd) {
        // The runner's OWN git observation — oldest-first so observeCommits()
        // appends events in chronological order. %ct = committer epoch seconds.
        const r = await execFileAsync(
          "git",
          ["log", "--reverse", "--format=%H%x09%ct%x09%s", "origin/main..HEAD"],
          { cwd: worktreeCwd, encoding: "utf8" },
        ).catch(() => ({ stdout: "" }));
        const out: ObservedCommit[] = [];
        for (const line of (r.stdout ?? "").split("\n")) {
          if (line.trim() === "") continue;
          const [hash, ct, ...rest] = line.split("\t");
          if (hash === undefined || hash === "") continue;
          const tsSec = Number((ct ?? "0").trim());
          out.push({
            hash,
            message: rest.join("\t"),
            tsSec: Number.isFinite(tsSec) ? tsSec : 0,
          });
        }
        return out;
      },
      // RESUME-PRIOR-WORK probes (un-merged audit-branch reuse).
      async fetchRemoteBranch(repoCwd, branch) {
        return fetchRemoteBranch(repoCwd, branch);
      },
      async branchMergedIntoMain(repoCwd, branch) {
        return branchMergedIntoMain(repoCwd, branch);
      },
      async branchCleanlyRebasesOntoMain(repoCwd, branch) {
        return branchCleanlyRebasesOntoMain(repoCwd, branch);
      },
      async resetWorktreeHard(worktreeCwd, ref, branch) {
        const r = await worktreeResetHard(worktreeCwd, ref, branch);
        return { code: r.code };
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
    // FIX-306: the runner commits + pushes the `.roll` metadata repo. See the
    // {@link MetadataPort} doc for WHY this is the runner's job, not the agent's.
    metadata: {
      async commit(projectCwd, message) {
        return commitRollMetadataRepo(projectCwd, message);
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
    evidence: {
      openFrame(projectCwd, storyId, runId) {
        return openEvidenceFrame({ runDir: join(cardArchiveDir(projectCwd, storyId), runId) }).runDir;
      },
    },
    capture: {
      fromMarker(marker, runDir) {
        // FIX-314 — force headless in the loop capture path: ROLL_ATTEST_HEADLESS=1
        // prevents the web lane from opening a real GUI browser (disruptive in
        // unattended cycles; Chrome also blocks file:// → "无法访问你的文件").
        // Playwright headless Chromium handles file:// with no GUI.
        return captureFromMarker(marker, {
          runDir,
          deps: { env: { ...process.env, ROLL_ATTEST_HEADLESS: "1" } },
        });
      },
    },
    attest: {
      async render(projectCwd, storyId, runDir) {
        const prev = process.cwd();
        try {
          process.chdir(projectCwd);
          // FIX-305: a UI/dossier card's acceptance is a RENDERED page, so its
          // evidence must be a real pixel screenshot, not a machine-skip with an
          // empty screenshots dir. Auto-drive the web self-capture lane against
          // the card's rendered dossier page (file://…/index.html), or an explicit
          // ROLL_ATTEST_WEB_URL deployed product page. The FIX-291 ladder falls
          // through to headless Chromium on a network-only loop runner (no GUI
          // needed), producing an unforgeable PNG.
          // FIX-314: pass ROLL_ATTEST_HEADLESS=1 so the web capture in attest
          // never pops a GUI browser — headless Chromium is the only web lane in
          // an unattended cycle.
          const webTarget = webCaptureTargetForStory(projectCwd, storyId, process.env["ROLL_ATTEST_WEB_URL"]);
          const webArgs = webTarget !== null ? ["--capture-web", webTarget] : [];
          return await attestCommand([storyId, "--run-dir", runDir, ...webArgs], {
            capture: { env: { ...process.env, ROLL_ATTEST_HEADLESS: "1" } },
          });
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

// Keep these referenced so resolveFallback / parseClaimedIds are not stripped by
// a too-eager tree-shaker in the test bundle (they document the available
// execution surface; nodePorts wires the common path).
export const _availableCoreSurface = {
  resolveFallback,
  parseClaimedIdsFromBacklog,
} as const;
