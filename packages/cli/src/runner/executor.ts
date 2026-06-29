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
  AGENT_REGISTRY_NAMES,
  agentsInstalled,
  appendDelivery,
  heteroAvailable,
  nodeDeliveryStore,
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
  hasMergedDelivery,
  buildHasOpenPr,
  ensureDeliveriesFresh,
  queryStoryDelivery,
  nodeExecPort,
  type FreshnessPort,
  latestDeliveringCycle,
  runRowHasPublishedPr,
  parseClaimedIdsFromBacklog,
  parseBacklog,
  parsePolicy,
  pickStory,
  planPublishDocPr,
  planPublishPr,
  reconcileBranchName,
  resumeCandidateBranches,
  resolveRoute,
  resolveRouteExcluding,
  resolveFallback,
  extractUsage,
  getAgentSpec,
  toCycleCost,
  pairingHistory,
  excludedPeers,
  peerAuthStates,
  canonicalAgentName,
  peerReviewCost,
  captureWarmSession,
  decideWarmResume,
  isWarmSessionEntry,
  sessionReuseFor,
  type WarmSessionEntry,
  type ResumeScope,
  type CycleObserverState,
  type ObservedCommit,
  baselineCommits,
  newCycleObserverState,
  observeBuildStart,
  observeCommits,
  maybeBuildHeartbeat,
  cycleTimeoutVerdict,
  stallVerdict,
  CYCLE_WALL_TIMEOUT_SEC,
  CYCLE_NO_PROGRESS_SEC,
  CYCLE_STALL_THRESHOLD_SEC,
  STALL_STARTUP_GRACE_SEC,
  newNormalizerState,
  normalizerFor,
  type ActivitySignal,
  type AgentActivityNormalizer,
  type NormalizerState,
  cycleActivityFromEvents,
  classifyStoryRisk,
  selectExecutionProfile,
  explainExecutionProfile,
  applyExecutionPolicy,
  normalizeAgentConfig,
  normalizeAgentScopeConfig,
  resolveAgentScopeRole,
  assembleEvalReport,
  renderEvalReport,
  validateEvaluatorArtifact,
  validatePlannerArtifact,
  parsePlannerContract,
  plannedVsDelivered,
  summarizePlannedVsDelivered,
  decideRepair,
  initialRepairState,
  DEFAULT_MAX_REPAIR_ROUNDS,
} from "@roll/core";
import type { AgentName, AgentScopeConfig, AgentScopeRole, AgentScopeRoleBinding, ArtifactManifest, ExecutionProfile, Rig } from "@roll/spec";
import {
  parseEventLine,
  STATUS_MARKER,
  AWAITING_REVIEW_STATUS_MARKER,
  absent,
  buildTerminalEvent,
  findStatusMarker,
  present,
  type CycleActivityEvent,
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
  prListOpenTitles,
  prNumberFromUrl,
  prViewMergeInfo,
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
import { writeCycleRoleSummaryBestEffort } from "./cycle-role-artifact-writer.js";
import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  agentCredentialReadiness,
  agentSpawnEnvironment,
  type AgentSpawn,
  killLiveAgents,
  realAgentSpawn,
} from "./agent-spawn.js";
import { classifyBlockSignature, probeAgentReachable, type ReachResult } from "./agent-liveness.js";
import { readSkipCards } from "./skip-cards.js";
import { readPendingPublish } from "./pending-publish.js";
import { readSelfHeal } from "./selfheal-budget.js";
import { cycleChangedFiles, peerEvidencePresent, readPeerGateMode, runPeerGate } from "./peer-gate.js";
import { declaresAnySurface, deliverableCmdsForStory, readAttestGateMode, rejectedDeliverableCmdsForStory, runAttestGate, screenshotExemption, storyRequiresScreenshot, storySpecPath, verificationReportHasContent, verificationReportPath, webCaptureTargetsForStory } from "./attest-gate.js";
import { recoverKimiUsage, recoverPiUsage } from "./usage-recovery.js";
import { validateStoryVisualEvidence } from "../lib/design-visual-evidence.js";
import { ACMAP_REMEDIATION_TIMEOUT_MS, acMapPath, autoAttachScreenshotToAcMap, buildAcMapRemediationPrompt, generateAcMapDraft, needsAcMapRemediation, writeAcMapDraftEvidenceFiles, type DraftEvidence } from "./attest-remediation.js";
import { applyCorrectionAction } from "./correction-actuator.js";
import { buildPairScorePrompt, buildReviewPrompt, enabledPairingStages, parsePairScoreOutput, retryPeerConsult, runPairing, runScorePairing, type PairEvent, type PairReview } from "./pairing-gate.js";
import { realAgentEnv } from "../commands/agent-list.js";
import { attestCommand } from "../commands/attest.js";
import { cardArchiveDir } from "../lib/archive.js";
import { formatEvaluationContractForScorer, parseEvaluationContract } from "../lib/evaluation-contract.js";
import { readLatestStoryReviewScore, REVIEW_SCORE_LOW_THRESHOLD, type ReviewScoreEntry } from "../lib/review-score.js";

const execFileAsync = promisify(execFile);

type MainDirtyPhase = Extract<RollEvent, { type: "sandbox:main_dirty" }>["phase"];

function parsePorcelainPath(line: string): string {
  const raw = line.length > 3 ? line.slice(3).trim() : line.trim();
  const target = raw.includes(" -> ") ? raw.split(" -> ").at(-1) ?? raw : raw;
  return target.replace(/^"|"$/g, "");
}

export async function checkMainDirty(repoCwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: repoCwd,
      encoding: "utf8",
    });
    return stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim() !== "")
      .map(parsePorcelainPath)
      .filter((path) => path !== ".roll" && !path.startsWith(".roll/"))
      .slice(0, 50);
  } catch {
    return [];
  }
}

function recordMainDirty(ports: Ports, ctx: CycleContext, phase: MainDirtyPhase, files: readonly string[]): void {
  const visible = files.slice(0, 20);
  ports.events.appendEvent(ports.paths.eventsPath, {
    type: "sandbox:main_dirty",
    cycleId: ctx.cycleId ?? "",
    phase,
    files: visible,
    ts: eventTs(ports),
  });
  ports.events.appendAlert(
    ports.paths.alertsPath,
    `cycle ${ctx.cycleId ?? "?"}: main checkout dirty at ${phase}; builder work must stay in the cycle worktree. Files: ${visible.join(", ")}`,
  );
}

export async function rescueLeakedMain(
  repoCwd: string,
  refName: string,
): Promise<{ code: number; rescuedSha: string }> {
  // FIX-903: capture the current main HEAD SHA, then create a rescue branch
  // and reset main to origin/main so the leaked commits are reachable via
  // the rescue ref but main is clean again.
  let rescuedSha = "";
  try {
    const headR = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repoCwd,
      encoding: "utf8",
    });
    rescuedSha = (headR.stdout ?? "").trim();
  } catch {
    return { code: 1, rescuedSha: "" };
  }
  let code = 0;
  try {
    await execFileAsync("git", ["branch", refName], {
      cwd: repoCwd,
      encoding: "utf8",
    });
  } catch {
    code = 1;
  }
  let backlogWorktreeContent: string | undefined;
  const backlogPath = join(repoCwd, ".roll", "backlog.md");
  try {
    const status = await execFileAsync("git", ["status", "--porcelain", "--", ".roll/backlog.md"], {
      cwd: repoCwd,
      encoding: "utf8",
    });
    if ((status.stdout ?? "").trim() !== "") {
      backlogWorktreeContent = readFileSync(backlogPath, "utf8");
    }
  } catch {
    backlogWorktreeContent = undefined;
  }
  try {
    await execFileAsync("git", ["reset", "--hard", "origin/main"], {
      cwd: repoCwd,
      encoding: "utf8",
    });
  } catch {
    code = 1;
  }
  if (backlogWorktreeContent !== undefined) {
    try {
      mkdirSync(dirname(backlogPath), { recursive: true });
      writeFileSync(backlogPath, backlogWorktreeContent, "utf8");
    } catch {
      code = 1;
    }
  }
  return { code, rescuedSha };
}

class ActivitySignalRecorder {
  private buffered = "";
  private readonly normalizer: AgentActivityNormalizer;
  private readonly state: NormalizerState;

  constructor(
    private readonly signalPath: string,
    agent: string,
    banner: string,
    private readonly nowMs: () => number,
  ) {
    this.normalizer = normalizerFor(agent);
    this.state = newNormalizerState();
    try {
      mkdirSync(dirname(signalPath), { recursive: true });
      writeFileSync(signalPath, "", "utf8");
    } catch {
      /* best-effort projection */
    }
    this.recordLine(banner);
  }

  accept(chunk: Buffer): void {
    this.buffered += chunk.toString("utf8");
    const lines = this.buffered.split(/\r?\n/);
    this.buffered = lines.pop() ?? "";
    for (const line of lines) this.recordLine(line);
  }

  flush(): void {
    if (this.buffered.trim() !== "") this.recordLine(this.buffered);
    this.buffered = "";
  }

  private recordLine(line: string): void {
    const signals = this.normalizer.normalize(line, this.state, this.nowMs());
    if (signals.length === 0) return;
    this.append(signals);
  }

  private append(signals: readonly ActivitySignal[]): void {
    try {
      appendFileSync(this.signalPath, signals.map((sig) => JSON.stringify(sig)).join("\n") + "\n", "utf8");
    } catch {
      /* best-effort projection */
    }
  }
}

/** The injectable wall clock (epoch seconds) — infra's {@link Clock}. */
export type ProcessClock = Clock;

function epochMs(ts: number): number {
  return ts >= 1_000_000_000_000 ? ts : ts * 1000;
}

function eventTs(ports: Ports): number {
  return epochMs(ports.clock());
}

function scopedCandidateAgents(
  binding: AgentScopeRoleBinding,
  layers: readonly { config: AgentScopeConfig; path: string }[],
): AgentName[] | null {
  if (binding.kind === "inherit") return null;
  if (binding.kind === "fixed") return [binding.agent];
  const declared = new Map<AgentName, readonly AgentScopeRole[]>();
  for (const layer of layers) {
    for (const [agent, spec] of Object.entries(layer.config.agents) as [AgentName, NonNullable<AgentScopeConfig["agents"][AgentName]>][]) {
      declared.set(agent, spec.capabilities);
    }
  }
  const registryAgents = AGENT_REGISTRY_NAMES as readonly AgentName[];
  const pool: readonly AgentName[] =
    binding.from !== undefined && binding.from.length > 0 ? binding.from : registryAgents.filter((agent) => declared.has(agent));
  const required = binding.require ?? [];
  return pool.filter((agent) => {
    const caps = declared.get(agent) ?? [];
    return required.every((role) => caps.includes(role));
  });
}

function scopedEvaluateAllowedAgents(layers: readonly { config: AgentScopeConfig; path: string }[]): AgentName[] | null {
  for (const layer of [...layers].reverse()) {
    const binding = layer.config.defaults["story"]?.roles.evaluate ?? layer.config.roles.evaluate;
    if (binding === undefined) continue;
    const agents = scopedCandidateAgents(binding, layers);
    if (agents !== null) return agents;
  }
  return null;
}

/**
 * Project-config allowed agents from `.roll/agents.yaml`.
 * `roll-agents/v1` story.evaluate bindings are primary. Legacy route-slot
 * allowlists are read only for projects that have not migrated yet.
 */
function projectAllowedAgents(repoCwd: string): Set<string> | undefined {
  const path = join(repoCwd, ".roll", "agents.yaml");
  const machinePath = join(process.env["ROLL_HOME"] ?? join(homedir(), ".roll"), "agents.yaml");
  const scopedLayers = [readScopedAgentLayer(machinePath), readScopedAgentLayer(path)].filter(
    (layer): layer is { config: AgentScopeConfig; path: string } => layer !== null,
  );
  if (scopedLayers.length > 0) {
    const agents = scopedEvaluateAllowedAgents(scopedLayers);
    return agents !== null ? new Set(agents) : undefined;
  }

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const parsed = normalizeAgentConfig(text);
  const legacyAgents = AGENT_REGISTRY_NAMES.filter((agent) =>
    ["easy", "default", "hard", "fallback"].some((slot) => parsed.config.routing[slot as keyof typeof parsed.config.routing]?.rig.agent === agent),
  );
  return legacyAgents.length > 0 ? new Set(legacyAgents) : undefined;
}

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
  /** FIX-903: save the current main HEAD as a rescue ref (`rescue/leaked-<cycleId>`),
   *  then reset main to origin/main. Returns the rescued SHA and exit code. */
  rescueLeaked(repoCwd: string, refName: string): Promise<{ code: number; rescuedSha: string }>;
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
  /** Poll a PR's full merge info (state, mergedAt, mergeCommit). Returns undefined on gh failure. */
  prMergeInfo(repoCwd: string, branch: string): Promise<{ state: string; mergedAt?: string; mergeCommit?: string } | undefined>;
  /** Fetch open PR titles (US-LOOP-079c). Returns [] on gh failure / no open PRs. */
  openPrTitles(repoCwd: string): Promise<string[]>;
}

/** Process facet — lock + heartbeat (infra/process.ts). */
export interface ProcessPort {
  acquireLock(
    lockPath: string,
    opts?: { staleSec?: number; cycleId?: string },
  ): { acquired: boolean; heldByPid: number | undefined };
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
  /** Test seam for credential readiness checks; production uses process.env. */
  agentCredentialEnv?: NodeJS.ProcessEnv;
  /** Test seam for agent profile dotfile readers; production uses the OS home dir. */
  agentEnvHome?: string;
  /** FIX-363: connectivity/auth probe for a reviewer agent. Used ONLY on the
   *  review-failure path (a silent timeout with no block signature) to tell a
   *  BLOCKED agent (not logged in / network down) from a SLOW one, so the loop
   *  acts on the real cause instead of burning the budget on a doomed call.
   *  Optional + injectable: unset (the test default) → no probe, no spawn, the
   *  pre-FIX-363 behaviour; {@link nodePorts} wires the real {@link probeAgentReachable}. */
  agentReachable?: (agent: string) => Promise<ReachResult>;
  /** Canonical installed agents — the heterogeneous-peer pool for the peer-gate
   *  retry (FIX-293) and the opt-in pairing stages. Injectable so tests can pin
   *  a deterministic peer pool; defaults to {@link agentsInstalled} over the real
   *  environment probe. */
  installedAgents?: () => string[];
  depsExec?: DepsExec;
  /**
   * FIX-906: unified delivery-truth predicate — true iff this story has a
   * MERGED delivery according to the single structured projection
   * (`ensureDeliveriesFresh` → `queryStoryDelivery(id).delivered`), which reads
   * BOTH runs.jsonl AND git merges on origin/main (FIX-904/905). This sees
   * EXTERNAL / manual merges (claude salvage, PR-lane direct merge of a
   * non-loop-cycle PR) that the runs-only {@link hasMergedDelivery} is blind to.
   *
   * The picker's done eligibility and the preflight done-flip both consult this
   * so the loop never re-picks a card that already shipped on main, regardless of
   * HOW it merged. Injectable + optional: unset (the test default) → no unified
   * probe, falling back to the runs-only signal; {@link nodePorts} wires the real
   * projection. The implementation memoizes the projection per cycle so the
   * `git log` it shells out to runs at most once.
   */
  mergedDelivery?: (storyId: string) => boolean;
  /**
   * FIX-1018: true iff this story already has locally-committed-but-unpublished
   * work from a prior cycle. The runtime pending-publish set is written when a
   * cycle exits unpublished and cleared on delivery.
   */
  pendingPublish?: (storyId: string) => boolean;
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

type AgentBlockedStage = Extract<RollEvent, { type: "agent:blocked" }>["stage"];

function missingCredentialDetail(agent: string, missingEnv: readonly string[]): string {
  return `missing required credential env for ${agent}: ${missingEnv.join(", ")} (set env or the agent profile dotfile before running unattended loop)`;
}

function blockIfAgentCredentialsMissing(agent: string, stage: AgentBlockedStage, ports: Ports, ctx: CycleContext): string | null {
  const readiness = agentCredentialReadiness(agent, ports.agentCredentialEnv ?? process.env, ports.agentEnvHome);
  if (readiness.ok) return null;
  const detail = missingCredentialDetail(readiness.agent, readiness.missingEnv);
  ports.events.appendEvent(ports.paths.eventsPath, {
    type: "agent:blocked",
    cycleId: ctx.cycleId ?? "",
    agent: readiness.agent,
    cause: "auth",
    stage,
    detail,
    ts: eventTs(ports),
  });
  ports.events.appendAlert(
    ports.paths.alertsPath,
    `agent credential readiness: ${stage} agent ${readiness.agent} missing ${readiness.missingEnv.join(", ")}; set env or the agent profile dotfile, then resume the loop`,
  );
  return detail;
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
async function startCycleObserver(ports: Ports, cycleId: string): Promise<{ stop(): Promise<void> }> {
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
  try {
    baselineCommits(await ports.git.recentCommits(ports.paths.worktreePath), st);
  } catch {
    /* baseline is best-effort; observation must not block the cycle */
  }
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

// ── FIX-907: per-cycle HARD timeout watchdog (the hung-builder killer) ────────

/** Resolved per-cycle timeout thresholds (seconds). 0 / negative ⇒ DISABLED. */
export interface CycleTimeoutThresholds {
  wallSec: number;
  noProgressSec: number;
}

/** Poll cadence (ms) for the timeout watchdog. Frequent enough that a breach is
 *  acted on within a few seconds of crossing a threshold, cheap (one `git log`).
 *  Overridable via ROLL_TIMEOUT_POLL_MS for tests. */
const TIMEOUT_POLL_MS = 5_000;

/**
 * FIX-907 — resolve the per-cycle hard-timeout thresholds. Order:
 *   1. env override (ROLL_CYCLE_WALL_TIMEOUT_SEC / ROLL_CYCLE_NO_PROGRESS_SEC) —
 *      lets an operator (or a test) pin a value without editing policy.yaml;
 *   2. `<repoCwd>/.roll/policy.yaml` loop_safety.{cycle_wall_timeout_sec,
 *      cycle_no_progress_sec};
 *   3. the core defaults (45min wall / 15min no-progress).
 * A 0 / negative value DISABLES that criterion. Best-effort: an unreadable /
 * unparseable policy degrades to defaults (the watchdog must never topple a cycle
 * by failing to read config).
 */
export function readCycleTimeoutThresholds(repoCwd: string): CycleTimeoutThresholds {
  const envNum = (key: string): number | undefined => {
    const raw = (process.env[key] ?? "").trim();
    if (raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  let wallSec = CYCLE_WALL_TIMEOUT_SEC;
  let noProgressSec = CYCLE_NO_PROGRESS_SEC;
  try {
    const p = join(repoCwd, ".roll", "policy.yaml");
    if (existsSync(p)) {
      const ls = parsePolicy(readFileSync(p, "utf8")).loopSafety;
      wallSec = ls.cycleWallTimeoutSec;
      noProgressSec = ls.cycleNoProgressSec;
    }
  } catch {
    /* unreadable policy → core defaults */
  }
  return {
    wallSec: envNum("ROLL_CYCLE_WALL_TIMEOUT_SEC") ?? wallSec,
    noProgressSec: envNum("ROLL_CYCLE_NO_PROGRESS_SEC") ?? noProgressSec,
  };
}

/** FIX-929 — resolved stall-detection threshold. */
export interface StallThresholdConfig {
  thresholdSec: number;
}

/**
 * FIX-929 — resolve the stall-detection threshold. Order:
 *   1. Env override (ROLL_LOOP_STALL_THRESHOLD_MIN) — operator/test can pin a
 *      value without editing policy.yaml;
 *   2. The core default ({@link CYCLE_STALL_THRESHOLD_SEC}, 600s = 10min).
 * 0 / negative ⇒ stall detection DISABLED.
 */
export function readStallThreshold(repoCwd: string): StallThresholdConfig {
  const envNum = (key: string): number | undefined => {
    const raw = (process.env[key] ?? "").trim();
    if (raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const thresholdSec = envNum("ROLL_LOOP_STALL_THRESHOLD_MIN");
  return { thresholdSec: thresholdSec ?? CYCLE_STALL_THRESHOLD_SEC };
}

/** A live timeout-watchdog handle. `markProgress()` resets the no-progress clock
 *  (the spawn calls it on every stdout chunk); `stop()` clears the timer and
 *  returns whether the watchdog fired (so the caller can fold it into the spawn
 *  result's `timedOut`). */
export interface SpawnTimeoutWatchdog {
  markProgress(): void;
  stop(): { firedReason: "wall" | "no-progress" | null };
}

/**
 * FIX-907 — start the per-cycle HARD-timeout watchdog around a blocking agent
 * spawn. The spawn is a single `await`, so the orchestrator's between-step
 * watchdog cannot fire while a builder hangs; this poller closes that hole.
 *
 * It wakes on a timer and asks the PURE {@link cycleTimeoutVerdict} whether the
 * cycle has breached either criterion:
 *   • WALL — `now - spawnStart >= wallSec`.
 *   • NO-PROGRESS — `now - lastProgress >= noProgressSec`, where `lastProgress`
 *     is bumped by (a) a NEW commit observed on the worktree branch (a `git log`
 *     count probe each tick) and (b) every stdout chunk (`markProgress`). This
 *     dual signal is the误杀-prevention核心: a slow `deepseek` call sits at 0%
 *     CPU yet keeps emitting stdout, so its no-progress clock keeps resetting and
 *     it is NEVER killed — only a TRULY silent hang (no commit, no output) trips.
 *
 * On a breach it KILLS the agent process tree ({@link killLiveAgents} SIGKILL —
 * the same teardown FIX-204D uses, reaping the PTY-wrapped group), emits the
 * auditable `cycle:timeout` event (cycleId + reason + elapsed/idle), and records
 * the reason. The spawn's own `child.on("exit")` then resolves; the caller folds
 * `firedReason !== null` into `timedOut`, so the orchestrator runs its existing
 * clean teardown (`abort_timeout` → kill + cycle:end blocked + RELEASE LOCK; the
 * worktree branch is PRESERVED — timeoutTeardownCommands never cleans it).
 *
 * Best-effort throughout: a probe blip / append failure never crashes the
 * watchdog (it would otherwise leave the agent un-killed). Injectable seams
 * (`clock`, `commitCount`, `appendEvent`, `kill`, `pollMs`) keep it unit-testable
 * with NO real agent / git / timer.
 */
export function startSpawnTimeoutWatchdog(opts: {
  cycleId: string;
  thresholds: CycleTimeoutThresholds;
  /** Epoch SECONDS (injected — the runner's ProcessClock). */
  clock: () => number;
  /** Observe commits-ahead on the worktree branch (progress signal). */
  commitCount: () => Promise<number>;
  /** Append the cycle:timeout event (best-effort). */
  appendEvent: (ev: RollEvent) => void;
  /** Kill the in-flight agent process tree (returns count signalled). */
  kill?: () => number;
  /** Poll cadence ms (default {@link TIMEOUT_POLL_MS}; tests pin a small value). */
  pollMs?: number;
}): SpawnTimeoutWatchdog {
  const { cycleId, thresholds, clock, commitCount, appendEvent } = opts;
  const kill = opts.kill ?? ((): number => killLiveAgents("SIGKILL"));
  const pollMs = opts.pollMs ?? (Number((process.env["ROLL_TIMEOUT_POLL_MS"] ?? "").trim()) || TIMEOUT_POLL_MS);
  // Both criteria disabled → an inert handle (no timer, never fires).
  if (thresholds.wallSec <= 0 && thresholds.noProgressSec <= 0) {
    return { markProgress: () => {}, stop: () => ({ firedReason: null }) };
  }
  const startSec = clock();
  let lastProgressSec = startSec;
  let lastCommitCount = -1;
  let firedReason: "wall" | "no-progress" | null = null;
  let running = false;

  const markProgress = (): void => {
    lastProgressSec = clock();
  };

  const tick = async (): Promise<void> => {
    if (running || firedReason !== null) return; // don't stack ticks / re-fire
    running = true;
    try {
      // A NEW commit on the worktree branch is progress (bumps the idle clock).
      try {
        const n = await commitCount();
        if (n > lastCommitCount) {
          lastCommitCount = n;
          lastProgressSec = clock();
        }
      } catch {
        /* a git-probe blip is NOT progress and NOT a reason to kill — skip */
      }
      const now = clock();
      const verdict = cycleTimeoutVerdict({
        elapsedSec: now - startSec,
        idleSec: now - lastProgressSec,
        wallLimitSec: thresholds.wallSec,
        noProgressLimitSec: thresholds.noProgressSec,
      });
      if (verdict.timedOut) {
        firedReason = verdict.reason;
        clearInterval(timer);
        // Record FIRST (durable), then kill — so the trip is observable even if
        // the kill races the process exiting on its own.
        try {
          appendEvent({
            type: "cycle:timeout",
            cycleId,
            reason: verdict.reason,
            elapsedSec: verdict.elapsedSec,
            idleSec: verdict.idleSec,
            ts: epochMs(now),
          });
        } catch {
          /* event append is best-effort; the kill below is the point */
        }
        try {
          kill();
        } catch {
          /* the spawn's exit handler still settles the promise */
        }
      }
    } finally {
      running = false;
    }
  };
  // Seed the commit baseline once up front so the first real new commit counts.
  void (async () => {
    try {
      lastCommitCount = await commitCount();
    } catch {
      /* baseline best-effort */
    }
  })();
  const timer = setInterval(() => void tick(), pollMs);
  timer.unref?.();
  return {
    markProgress,
    stop: () => {
      clearInterval(timer);
      return { firedReason };
    },
  };
}

/** FIX-929 — agent stall detector. Monitors agent output (stdout token stream)
 *  and emits a SOFT `agent:stall` signal when the agent has been completely
 *  silent for ≥ threshold seconds AFTER the startup grace period. Does NOT kill
 *  the agent — it signals the recovery layer (FIX-930) to switch agents before
 *  the hard timeout watchdog (FIX-907) kills the process.
 *
 *  Distinction from {@link startSpawnTimeoutWatchdog}:
 *    • Stall detector — SOFT signal at 10min (configurable); no kill; 2min grace.
 *    • Timeout watchdog — HARD kill at 15min no-progress / 45min wall.
 */
export interface StallDetector {
  /** Bump the last-progress clock (called on every agent stdout chunk). */
  markProgress(): void;
  /** Stop the timer. Returns whether stall was detected. */
  stop(): { stalled: boolean };
}

/** FIX-929 — start the per-cycle stall detector. Emits `agent:stall` once when
 *  the agent is idle for ≥ the threshold after the startup grace. Best-effort;
 *  a probe blip never crashes the detector. Overridable via
 *  `ROLL_LOOP_STALL_THRESHOLD_MIN` env var. */
export function startStallDetector(opts: {
  cycleId: string;
  agent: string;
  /** Epoch SECONDS (injected — the runner's ProcessClock). */
  clock: () => number;
  /** Append the agent:stall event (best-effort). */
  appendEvent: (ev: RollEvent) => void;
  /** Stall threshold seconds (default {@link CYCLE_STALL_THRESHOLD_SEC}). */
  thresholdSec?: number;
  /** Startup grace seconds (default {@link STALL_STARTUP_GRACE_SEC}). */
  startupGraceSec?: number;
  /** Poll cadence ms (default 5s; tests pin a small value). */
  pollMs?: number;
}): StallDetector {
  const { cycleId, agent, clock, appendEvent } = opts;
  const thresholdSec = opts.thresholdSec ?? CYCLE_STALL_THRESHOLD_SEC;
  const startupGraceSec = opts.startupGraceSec ?? STALL_STARTUP_GRACE_SEC;
  const pollMs = opts.pollMs ?? (Number((process.env["ROLL_STALL_POLL_MS"] ?? "").trim()) || 5_000);
  // Disabled → inert handle (no timer, never fires).
  if (thresholdSec <= 0) {
    return { markProgress: () => {}, stop: () => ({ stalled: false }) };
  }
  const startSec = clock();
  let lastProgressSec = startSec;
  let fired = false;
  let running = false;

  const markProgress = (): void => {
    lastProgressSec = clock();
  };

  const tick = (): void => {
    if (running || fired) return;
    running = true;
    try {
      const now = clock();
      const verdict = stallVerdict({
        elapsedSec: now - startSec,
        idleSec: now - lastProgressSec,
        stallThresholdSec: thresholdSec,
        startupGraceSec,
        alreadyFired: fired,
      });
      if (verdict.stalled) {
        fired = true;
        clearInterval(timer);
        try {
          appendEvent({
            type: "agent:stall",
            cycleId,
            agent,
            idleSec: verdict.idleSec,
            thresholdSec: verdict.thresholdSec,
            ts: Date.now(),
          });
        } catch {
          /* event append is best-effort */
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, pollMs);
  timer.unref?.();
  return {
    markProgress,
    stop: () => {
      clearInterval(timer);
      return { stalled: fired };
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
        const runRows = readRunsRows(ports.paths.runsPath);
        // FIX-323 / FIX-906: a 📋 Todo card whose delivery already MERGED is Done
        // — its deliverable is on main (a prior gave_up reset the status text but
        // not the merge). Flip it here (cheap, local, no gh probe) so the picker
        // pool stays honest and the merged zombie is never re-picked. The merge
        // signal is the UNIFIED delivery truth ({@link mergedFromTruth}): the
        // structured projection (runs + git merges on origin/main) when wired,
        // OR'd with the runs-only `hasMergedDelivery` — so an external / manual
        // merge (claude salvage, PR-lane direct merge) flips the card too, not
        // just loop-cycle deliveries. Complements the picker's own guard.
        const mergedFromTruth = (id: string): boolean =>
          (ports.mergedDelivery?.(id) ?? false) || hasMergedDelivery(runRows, id);
        for (const r of rows) {
          if (!(r.status ?? "").includes(STATUS_MARKER.todo)) continue;
          if (mergedFromTruth(r.id)) {
            ports.backlog.markStatus?.(ports.repoCwd, r.id, STATUS_MARKER.done);
          }
        }
        const claims = rows.filter((r) => (r.status ?? "").includes("🔨"));
        if (claims.length > 0) {
          const slug = await ports.github.repoSlug(ports.repoCwd).catch(() => undefined);
          for (const claim of claims) {
            const cycle = latestDeliveringCycle(runRows, claim.id);
            let prState: string | undefined;
            if (cycle !== undefined && slug !== undefined) {
              prState = await ports.github
                .prState(ports.repoCwd, reconcileBranchName(cycle))
                .catch(() => undefined);
            }
            const decision = decideClaimReconcile({ hasDeliveringCycle: cycle !== undefined, prState, hasPublishedPr: runRowHasPublishedPr(runRows, claim.id) });
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
      // FIX-338 (Phase B 杠杆1): with deps now present, PREBUILD the workspace
      // dist so the agent finds dist/roll.mjs already built (saving the cold
      // find/build round-trips). DEFAULT-OFF (稳字纪律) — a no-op until
      // `loop_safety.prebuild_dist: true`. Agent-agnostic + best-effort: a build
      // failure never topples the cycle, so it runs AFTER the strict deps/skills
      // gates and its outcome is intentionally ignored.
      await bootstrapWorktreePrebuild(
        ports.paths.worktreePath,
        ports.paths.alertsPath,
        ports.events,
        readPrebuildDistEnabled(ports.repoCwd),
        ports.depsExec,
      );
      return { event: { type: "worktree_created" } };
    }

    // backlog/picker pickStory (read backlog INSIDE the worktree, bin/roll:8938).
    case "pick_story": {
      // Read from the MAIN project (FIX-198): ordinary projects gitignore
      // .roll/, so the worktree has no backlog at all — a worktree read picks
      // nothing and the loop silently idles.
      const items = ports.backlog.read(ports.repoCwd);
      // FIX-323 / FIX-906: feed the picker the UNIFIED merge truth. A card whose
      // deliverable already MERGED is Done — even if its backlog row was reset to
      // 📋 Todo by a prior gave_up cycle (the agent found the work on main, made
      // no commit → gave_up → status reset → re-pick → burn). The picker reads
      // only backlog text, so without this it re-picks the merged zombie forever.
      // The signal is the structured projection (`ensureDeliveriesFresh` →
      // `queryStoryDelivery(id).delivered`, which reads runs + git merges on
      // origin/main — FIX-904/905) when wired via {@link mergedDelivery}, OR'd
      // with the runs-only `hasMergedDelivery`. The projection sees EXTERNAL /
      // manual merges (claude salvage, PR-lane direct merge of a non-loop-cycle
      // PR) that runs.jsonl is blind to — the exact case that had the picker
      // re-selecting already-merged cards (FIX-903/904/390) every cycle.
      const pickRunRows = readRunsRows(ports.paths.runsPath);
      // FIX-363 (loop resilience): skip poison-pill cards (failed K times) so a
      // single un-deliverable card no longer halts the WHOLE loop — it keeps
      // delivering the rest. Runtime overlay (.roll/loop/skip-cards.json); backlog
      // truth is untouched.
      const skipCards = readSkipCards(dirname(ports.paths.eventsPath));
      // US-LOOP-079c: wire the real hasOpenPr predicate — same data source as
      // delivery/pr.ts (open PR titles from gh, no second truth source).
      const openPrTitles = await ports.github.openPrTitles(ports.repoCwd);
      const hasOpenPr = buildHasOpenPr(openPrTitles);
      const pendingPublish = readPendingPublish(dirname(ports.paths.eventsPath));
      const story = pickStory(items as never, {
        hasOpenPr,
        hasMergedDelivery: (id) =>
          (ports.mergedDelivery?.(id) ?? false) || hasMergedDelivery(pickRunRows, id),
        shouldSkip: (id) => skipCards.has(id),
        hasPendingPublish: (id) =>
          (ports.pendingPublish?.(id) ?? false) || pendingPublish.has(id),
      });
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
      // FIX-311b — the BUILD-PREFLIGHT visual-evidence gate (the shift-left of
      // the FIX-309 attest gate). Runs HERE, after the spec-truth reset and
      // BEFORE the agent spawns (pick_story → resume → resolve_route →
      // spawn_agent), so a spec that can NEVER satisfy the runtime screenshot
      // floor is flagged loud at the cheapest possible moment instead of after a
      // full build cycle honest-skips. CONSERVATIVE BY DESIGN (owner red line:
      //误杀 CLI/后端卡 = 阻断 loop, 绝不可): it ALERTs only when CONFIDENT —
      // a clear WEB-surface card that declared no `deliverable_url`, or a card
      // with NO visual-evidence AC and NO recorded exemption. A terminal/CLI/TUI
      // deliverable, an ambiguous surface, or an unreadable spec is LEFT ALONE
      // (FIX-309 backstops at delivery). It NEVER changes the cycle's control
      // flow — story_picked still returns — so a false positive cannot topple a
      // CLI/back-end card; it only raises a visible signal.
      runVisualEvidencePreflight(ports, story.id, ctx.cycleId);
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
        ts: eventTs(ports),
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
      // FIX-1026: the spec frontmatter's `est_min` (the documented escalation
      // lever) drives tier selection, falling back to the backlog row's tag.
      const estMin = routerEstMin(ports.repoCwd, cmd.storyId, story?.desc ?? "");
      const r = ports.route.resolve(cmd.storyId, estMin);
      // US-V4-004: select + RECORD the Story execution profile once, here at
      // route-resolve (before execute). Best-effort + never toppling routing: a
      // spec read/parse blip falls back to `standard` (builder-only, current
      // behavior). v4.0 records the profile but still executes standard only;
      // verified/planned add evaluator/planner stages in later stories.
      const selectedProfile = recordExecutionProfile(ports, ctx.cycleId ?? "", cmd.storyId, estMin);
      return { event: { type: "route_resolved", agent: r.agent, model: r.model }, ctxPatch: { selectedProfile } };
    }

    // execute: spawn the agent (TCR commits happen inside the worktree). The
    // exit code + timeout feed back as agent_exited; usage is captured for cost.
    case "spawn_agent": {
      // FIX-343 (step ①): mint the BUILDER's unique session id ONCE, here at the
      // working-agent spawn, and reuse it across retries (a non-empty
      // ctx.builderSessionId means a prior attempt already minted it). The attest
      // gate later compares the SCORER's session id against this so "an
      // independent fresh session (NOT a sub-agent sharing the builder's context)
      // scored this delivery" is a CHECKED invariant. Recorded on the cycle
      // context (ctxPatch below) and in the agent log header for audit.
      const builderSessionId =
        ctx.builderSessionId !== undefined && ctx.builderSessionId !== ""
          ? ctx.builderSessionId
          : `${ctx.cycleId ?? "cycle"}:build:${cmd.agent}:${ports.clock()}`;
      const preSpawnDirty = await checkMainDirty(ports.repoCwd);
      if (preSpawnDirty.length > 0) {
        recordMainDirty(ports, ctx, "pre-spawn", preSpawnDirty);
        return {
          event: { type: "agent_exited", exit: 1, timedOut: false },
          ctxPatch: { builderSessionId, mainDirty: true },
        };
      }
      if (blockIfAgentCredentialsMissing(cmd.agent, "build", ports, ctx) !== null) {
        return {
          event: { type: "agent_exited", exit: 1, timedOut: false },
          ctxPatch: { builderSessionId },
        };
      }
      // US-V4-006: for a `planned` cycle, run the Planner BEFORE the Builder in a
      // fresh session and FAIL CLOSED on a missing/malformed planner contract —
      // the Builder never starts without a valid plan. No-op for standard/verified.
      if (ctx.selectedProfile === "planned") {
        const plan = await runPlannerStage(ports, ctx, cmd.agent);
        if (plan.ran && !plan.ok) {
          ports.events.appendAlert(
            ports.paths.alertsPath,
            `planner stage failed closed for ${ctx.storyId ?? "?"}: ${plan.reasons.join("; ")} — Builder not started (cycle ${ctx.cycleId ?? "?"})`,
          );
          return { event: { type: "agent_exited", exit: 1, timedOut: false }, ctxPatch: { builderSessionId } };
        }
      }
      // US-PORT-011: the live observation file — one stable path per project,
      // truncated at each agent start, fed every chunk in real time. The popup
      // (runner template) and any `tail -f` watcher read THIS, not buffers.
      const livePath = join(dirname(ports.paths.eventsPath), "live.log");
      const liveBanner = `── cycle ${ctx.cycleId ?? "?"} · ${ctx.storyId ?? "?"} · agent ${cmd.agent} · build-session ${builderSessionId} ──`;
      try {
        writeFileSync(livePath, `${liveBanner}\n`);
      } catch {
        /* observation is best-effort */
      }
      const signalRecorder = new ActivitySignalRecorder(
        join(dirname(ports.paths.eventsPath), `cycle-${ctx.cycleId ?? "unknown"}.signals.jsonl`),
        cmd.agent,
        liveBanner,
        () => eventTs(ports),
      );
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
      const observer = await startCycleObserver(ports, ctx.cycleId ?? "");
      // FIX-907 — the HUNG-BUILDER KILLER. The agentSpawn below is a single
      // blocking await, so the orchestrator's between-step watchdog can NEVER
      // fire while a builder hangs (process alive, 0% CPU, no commits/output) —
      // it just holds the inflight lock and blocks the whole loop (实证: FIX-390
      // hung 46min). This poller races the spawn: a NEW commit OR any stdout
      // chunk is "progress" (resets the no-progress clock so a slow-but-emitting
      // deepseek is never mis-killed); a wall-clock overrun OR a truly silent
      // idle window kills the agent tree + records cycle:timeout. On a kill the
      // spawn resolves and we fold `timedOut` so the orchestrator's existing
      // abort_timeout teardown frees the lock and PRESERVES the worktree branch.
      // FIX-929 — the STALL DETECTOR. Fires a SOFT `agent:stall` signal when
      // the agent has produced zero output for ≥ threshold after startup grace.
      // Does NOT kill — it alerts the recovery layer (FIX-930) before the hard
      // timeout watchdog (below) kills the process. Threshold from env
      // ROLL_LOOP_STALL_THRESHOLD_MIN (default 10 min).
      const stallDetector = startStallDetector({
        cycleId: ctx.cycleId ?? "",
        agent: cmd.agent,
        clock: ports.clock,
        appendEvent: (ev) => ports.events.appendEvent(ports.paths.eventsPath, ev),
        thresholdSec: readStallThreshold(ports.repoCwd).thresholdSec,
      });
      const timeoutWatchdog = startSpawnTimeoutWatchdog({
        cycleId: ctx.cycleId ?? "",
        thresholds: readCycleTimeoutThresholds(ports.repoCwd),
        clock: ports.clock,
        commitCount: () => ports.git.commitsAhead(ports.paths.worktreePath),
        appendEvent: (ev) => ports.events.appendEvent(ports.paths.eventsPath, ev),
      });
      // FIX-338 (Phase B 杠杆2): when `loop_safety.project_map: true`, PREPEND a
      // concise, bounded project map into the working agent's initial context so it
      // doesn't burn execute time on sed/rg exploration. Agent-agnostic (one prompt
      // body all shapes consume) + bounded (hard char cap). DEFAULT-OFF — a no-op
      // until flipped on, in which case `ports.skillBody` is sent unchanged.
      const skillBodyForSpawn = maybeInjectProjectMap(
        ports.skillBody,
        ports.paths.worktreePath,
        readProjectMapEnabled(ports.repoCwd),
        ctx.storyId,
      );
      // FIX-386: when the story was re-picked after a low peer review score,
      // inject the reviewer's findings as a fix-forward task so the builder
      // fixes on the same resumed branch instead of starting fresh.
      const lowScoreFeedback = ctx.storyId !== undefined && ctx.storyId !== ""
        ? buildLowScoreFixForwardPrompt(ports.repoCwd, ctx.storyId)
        : "";
      const finalSkillBody =
        lowScoreFeedback !== ""
          ? `${lowScoreFeedback}\n\n${skillBodyForSpawn}`
          : skillBodyForSpawn;
      // lever-4 (cross-card warm-context): after the pool was narrowed to
      // 国产/开源 agents (kimi/pi/reasonix), NO current engine declares a
      // warm-reuse capability — every cycle runs COLD. The resume-resolution +
      // session-capture wiring (formerly codex `exec resume`) was removed with
      // codex; the cold spawn below is the only path. A future resumable engine
      // re-introduces this as registry-driven, agent-agnostic logic.
      let res: Awaited<ReturnType<typeof ports.agentSpawn>>;
      let timeoutFired: "wall" | "no-progress" | null = null;
      try {
        res = await ports.agentSpawn(cmd.agent, {
          cwd: ports.paths.worktreePath,
          skillBody: finalSkillBody,
          ...(ctx.evidenceRunDir !== undefined ? { runDir: ctx.evidenceRunDir } : {}),
          writableRoots: agentWritableRoots(ports.repoCwd, ports.paths.alertsPath),
          ...(ctx.model !== undefined && ctx.model !== "" ? { model: ctx.model } : {}),
          env: {
            ...process.env,
            ROLL_LOOP_ALERT: ports.paths.alertsPath,
            ...agentSpawnEnvironment(cmd.agent),
          },
          // FIX-204B: pin the executor-picked story into the agent prompt — the
          // claim (pick_story → 🔨) and the work must be the same story.
          ...(ctx.storyId !== undefined && ctx.storyId !== "" ? { storyId: ctx.storyId } : {}),
          onChunk: (d: Buffer) => {
            // FIX-907: any stdout chunk is PROGRESS — resets the no-progress
            // clock so a slow-but-still-emitting agent never trips the idle gate.
            timeoutWatchdog.markProgress();
            // FIX-929: bump the stall-detector's progress clock — same signal,
            // separate detector with its own (lower) threshold.
            stallDetector.markProgress();
            captureSink?.onChunk(d);
            try {
              appendFileSync(livePath, d);
            } catch {
              /* best-effort */
            }
            signalRecorder.accept(d);
          },
        });
      } finally {
        signalRecorder.flush();
        // Stop the timer AND take one final synchronous-await snapshot so the LAST
        // TCR commits (landed between the last tick and agent exit) are not lost.
        await observer.stop();
        timeoutFired = timeoutWatchdog.stop().firedReason;
        // FIX-929: stop the stall detector and capture whether it fired.
        stallDetector.stop();
      }
      // FIX-907: fold a watchdog kill into `timedOut` so the orchestrator runs
      // its clean abort_timeout teardown (kill + cycle:end blocked + lock release;
      // worktree PRESERVED). The cycle:timeout event was already emitted at the
      // breach moment (auditable reason: wall/no-progress).
      if (timeoutFired !== null) res = { ...res, timedOut: true };
      await captureSink?.flush();
      persistWorktreeAlerts(ports.paths.worktreePath, ports.paths.alertsPath, ports.events);
      const postSpawnDirty = await checkMainDirty(ports.repoCwd);
      if (postSpawnDirty.length > 0) {
        recordMainDirty(ports, ctx, "post-spawn", postSpawnDirty);
      }
      // FIX-366 — BUILDER auth/network fast-fail (extends FIX-363's taxonomy from
      // reviewer/scorer to the main working agent). An UNAUTHENTICATED builder does
      // not silently burn the whole cycle: it prints a 403 / "Please run /login" in
      // its first seconds and exits. We signature-match the output we ALREADY have
      // (zero cost — NO precheck layer, NO per-tick probe, NO TTL cache) with the
      // SAME `classifyBlockSignature`, and on auth/network emit the SAME
      // `agent:blocked` event with `stage: "build"`. loop-run-once's existing
      // `readExternalBlock`/`writeReviewerBlockedAlert` then ISOLATES it from the
      // consecutive-CODE-failure counter and acts on the cause — auth PAUSES the
      // loop (re-login then `roll loop resume`), network breathes (self-heals on
      // reconnect). One block taxonomy for builder/reviewer/scorer; a healthy
      // logged-in builder never matches, so the normal cycle is unchanged.
      //
      // FIX-401: only classify a builder block after a real failure signal.
      // Successful long-session summaries can legitimately mention login,
      // credentials, or auth features; scanning exit-0 output caused false
      // auth blocks and global PAUSEs after real deliveries.
      const builderBlock =
        res.exitCode !== 0 || res.timedOut ? classifyBlockSignature(`${res.stdout}\n${res.stderr}`) : null;
      if (builderBlock === "auth" || builderBlock === "network") {
        ports.events.appendEvent(ports.paths.eventsPath, {
          type: "agent:blocked",
          cycleId: ctx.cycleId ?? "",
          agent: cmd.agent,
          cause: builderBlock,
          stage: "build",
          detail: (`${res.stdout}\n${res.stderr}`.split("\n").find((l) => l.trim() !== "") ?? "").slice(0, 200),
          ts: eventTs(ports),
        });
      }
      // lever-4 (cross-card warm-context) capture: removed with codex from the
      // pool. No current engine (kimi/pi/reasonix) declares a warm-reuse
      // capability, so there is no resumable session id to capture here — every
      // cycle is cold-origin. A future resumable engine re-introduces capture as
      // registry-driven, agent-agnostic logic.
      // F4 lesson (信号成对/可观测不归零): persist the agent's full output as a
      // per-cycle log next to events/runs — v2 keeps cycle logs; without this
      // an agent that "ran but delivered nothing" is undiagnosable.
      try {
        const logDir = join(dirname(ports.paths.eventsPath), "cycle-logs");
        mkdirSync(logDir, { recursive: true });
        writeFileSync(
          join(logDir, `${ctx.cycleId ?? "cycle"}.agent.log`),
          // FIX-343 (step ①): the builder session id is part of the auditable
          // header — the attest gate's scorer≠builder-session invariant is then
          // traceable to a recorded build-session id, not asserted.
          `# exit=${res.exitCode} timedOut=${res.timedOut} build-session=${builderSessionId}\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}\n`,
        );
      } catch {
        /* logging must never fail the cycle */
      }
      // FIX-208/FIX-249/FIX-303: fold the agent's real usage into a per-cycle
      // cost via a per-agent normalization layer onto ONE 4-component model
      // (input/output/cache-read/cache-write — the roll thesis). Lanes:
      //   1. claude stream-json (per-turn usage + final total_cost_usd);
      //   2. AUTHORITATIVE session-store recovery for the agents whose `-p`
      //      stdout carries no parseable usage — each writes real per-turn
      //      usage to its own store, scoped here to this cycle's worktree + start:
      //        pi    → ~/.pi/agent/sessions/<encoded-cwd>/*.jsonl
      //        kimi  → ~/.kimi-code/sessions/wd_<wt>_*/.../wire.jsonl
      //   3. generic stdout-scrape footer agents (kimi REGISTRY) — the lossy
      //      2-component legacy fallback, tried LAST so a session recovery's full
      //      4-component split always wins when present.
      // Best-effort: a miss on every lane leaves cost absent (n/a, never a fake
      // zero) — usage accounting must never fail the cycle.
      let costPatch: CycleCost | undefined;
      try {
        const agentName = ctx.agent ?? cmd.agent;
        const lines = res.stdout.split("\n");
        const usageSpec = getAgentSpec(agentName)?.usage;
        let usage = usageSpec?.stdoutExtractor === "claude-stream" ? extractUsage(agentName, lines) : null;
        if (usage === null && usageSpec?.sessionRecovery === "pi") {
          const rootOverride = (process.env["ROLL_PI_SESSIONS_ROOT"] ?? "").trim();
          usage = recoverPiUsage(
            ports.paths.worktreePath,
            ctx.startSec,
            ...(rootOverride !== "" ? [rootOverride] : []),
          );
        }
        if (usage === null && usageSpec?.sessionRecovery === "kimi") {
          const rootOverride = (process.env["ROLL_KIMI_SESSIONS_DIR"] ?? "").trim();
          usage = recoverKimiUsage(
            ports.paths.worktreePath,
            ctx.startSec,
            ...(rootOverride !== "" ? [rootOverride] : []),
          );
        }
        // Stdout-scrape fallback (LAST): only when no authoritative stream or
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
        // FIX-343 (step ①): persist the builder session id on the cycle context so
        // it survives to the attest gate (the scorer≠builder-session check). Minted
        // once; reused across retries (the spawn reads ctx.builderSessionId first).
        ctxPatch: {
          builderSessionId,
          ...(postSpawnDirty.length > 0 ? { mainDirty: true } : {}),
          ...(costPatch !== undefined ? { cost: costPatch } : {}),
        },
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
      let mainDirty = ctx.mainDirty === true;
      if (!mainDirty) {
        const dirtyFiles = await checkMainDirty(ports.repoCwd);
        if (dirtyFiles.length > 0) {
          mainDirty = true;
          recordMainDirty(ports, ctx, "capture", dirtyFiles);
        }
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
      // FIX-1039: check whether the worktree has uncommitted/untracked files.
      // Best-effort → false on git error (the probe must never fail the cycle).
      let worktreeDirty = false;
      try {
        const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], {
          cwd: ports.paths.worktreePath,
          encoding: "utf8",
        });
        worktreeDirty = stdout.trim() !== "";
      } catch {
        /* probe is best-effort */
      }
      // FIX-363: attribute a reviewer/scorer failure to its CAUSE. Signature-match
      // the output we ALREADY have (zero cost); only a SILENT timeout (no output,
      // no signature) spends ONE cheap reachability probe to tell a blocked agent
      // from a slow one. On a definite external block (auth/network) emit
      // `agent:blocked` so loop-run-once isolates it from the code-failure counter
      // and raises an actionable "re-login / check VPN" pause instead of a phantom
      // code-bug hint. Heuristic by design — it only nudges a counter + an alert,
      // never drops a real delivery, so a false positive is at worst a wrong hint.
      const attributeBlockCause = async (
        peer: string,
        outcome: "timeout" | "error",
        rawOutput: string,
        stage: "review" | "score",
      ): Promise<"auth" | "network" | null> => {
        let cause = classifyBlockSignature(rawOutput);
        if (cause === null && outcome === "timeout" && ports.agentReachable !== undefined) {
          try {
            const reach = await ports.agentReachable(peer);
            if (!reach.reachable && (reach.cause === "auth" || reach.cause === "network")) cause = reach.cause;
          } catch {
            /* the probe is best-effort — it must never topple the cycle */
          }
        }
        if (cause === "auth" || cause === "network") {
          ports.events.appendEvent(ports.paths.eventsPath, {
            type: "agent:blocked",
            cycleId: ctx.cycleId ?? "",
            agent: peer,
            cause,
            stage,
            detail: (rawOutput.split("\n").find((l) => l.trim() !== "") ?? "").slice(0, 200),
            ts: eventTs(ports),
          });
        }
        return cause;
      };
      // V4 fairness: historical auth failures are observability, not static pool
      // policy. We still fold the stream so diagnostics can explain auth streaks,
      // but the returned exclusion set is intentionally empty. Current runtime
      // availability is decided by the spawn/probe for this attempt.
      const computeAuthDiagnostics = (): Set<string> => {
        try {
          if (!existsSync(ports.paths.eventsPath)) return new Set();
          const events = readFileSync(ports.paths.eventsPath, "utf8")
            .split("\n")
            .map(parseEventLine)
            .filter((e): e is RollEvent => e !== null);
          peerAuthStates(events);
          return excludedPeers(events);
        } catch {
          return new Set();
        }
      };
      const peerAvailable = (() => {
        const excluded = computeAuthDiagnostics();
        return (agent: string): boolean => !excluded.has(canonicalAgentName(agent));
      })();
      // The one-way peer-consult closure, shared by the peer gate's retry
      // (FIX-293) and the opt-in pairing stages (US-PAIR-003). A different agent
      // reads the cycle diff and returns a terse verdict; 30s hard timeout
      // (belt-and-braces race) so a flaky peer (pi) never stalls the cycle.
      const reviewPeer = async (peer: string, diff: string, timeoutMs: number): Promise<PairReview | null> => {
        // FIX-319: a REVIEW-ONLY prompt. The spawn is `bare` (no worker autorun
        // directive), so the reviewer is framed solely by this — it is NOT told to
        // "complete the delivery / don't just summarize / do the work", which made
        // reviewers try to deliver (and risk mutating the worktree) instead of
        // returning a terse verdict.
        // FIX-387: enrich with build/TCR status + main-baseline context so the
        // reviewer does NOT mistake imports of main-defined symbols as build regressions.
        const prompt = buildReviewPrompt({
          diff,
          commitsAhead,
          tcrCount,
        });
        // FIX-319: record EVERY consult's real wall-clock + outcome (pair:consult)
        // so the 120s hard timeout can be tuned from data, not guessed.
        const t0 = Date.now();
        const emitConsult = (outcome: "reviewed" | "timeout" | "error", cause?: "auth" | "network"): void =>
          ports.events.appendEvent(ports.paths.eventsPath, {
            type: "pair:consult",
            cycleId: ctx.cycleId ?? "",
            peer,
            durationMs: Date.now() - t0,
            outcome,
            ...(cause !== undefined ? { cause } : {}),
            ts: eventTs(ports),
          });
        let res;
        if (blockIfAgentCredentialsMissing(peer, "review", ports, ctx) !== null) {
          emitConsult("error", "auth");
          return null;
        }
        try {
          // Belt-and-braces hard timeout: race the spawn against a wall clock so
          // the cap is enforced even if an agent's spawn path ignores its own
          // timeoutMs. Whichever loses, the cycle is never stalled.
          res = await Promise.race([
            ports.agentSpawn(peer, {
              cwd: ports.paths.worktreePath,
              skillBody: prompt,
              timeoutMs,
              bare: true, // FIX-319: review-only framing, no worker autorun directive
              ...(ctx.evidenceRunDir !== undefined ? { runDir: ctx.evidenceRunDir } : {}),
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs).unref()),
          ]);
        } catch (e) {
          const cause = await attributeBlockCause(peer, "error", e instanceof Error ? e.message : String(e), "review");
          emitConsult("error", cause ?? undefined);
          return null;
        }
        if (res === null || res.timedOut) {
          // FIX-363: a "timeout" is not always slowness. Attribute it — a silent
          // hang with no output spends ONE cheap reachability probe to tell a
          // blocked agent (re-login / VPN) from a genuinely slow one.
          const raw = res !== null ? `${res.stdout}\n${res.stderr}` : "";
          const cause = await attributeBlockCause(peer, "timeout", raw, "review");
          emitConsult("timeout", cause ?? undefined);
          return null;
        }
        if (res.exitCode !== 0) {
          const cause = await attributeBlockCause(peer, "error", `${res.stdout}\n${res.stderr}`, "review");
          emitConsult("error", cause ?? undefined);
          return null;
        }
        const vm = /VERDICT:\s*(agree|refine|object)/i.exec(res.stdout);
        const verdict = (vm?.[1]?.toLowerCase() ?? "agree") as PairReview["verdict"];
        const findings = [...res.stdout.matchAll(/^\s*FINDING:\s*(.+)$/gim)].map((m) => (m[1] ?? "").trim());
        // US-PAIR-006 cost observability (owner's top priority "至少知道花了多少钱"):
        // the pair:verdict cost is now the peer's REAL list cost, parsed from its
        // own stdout (claude stream-json or the per-agent stdout-scrape extractors).
        // Best-effort by contract — an unparseable peer records 0, never throws.
        const cost = peerReviewCost(peer, res.stdout);
        emitConsult("reviewed");
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
      // FIX-935: agents explicitly configured in `.roll/agents.yaml` are the
      // project-config allowlist. Scoring and pairing must not auto-enable
      // machine-detected agents outside this set (e.g. codex or claude).
      const peerGateAllowedAgents = projectAllowedAgents(ports.repoCwd);
      // FIX-312: hetero-availability drives the gate (owner ruling: "hetero
      // available → must use it; self only when hetero is truly impossible").
      // Computed uniformly by vendor through the standard model (no per-agent
      // special-casing): is there ≥1 installed agent of a DIFFERENT vendor than
      // the builder? true ⇒ a self-reviewed substantive delivery is blocked;
      // false ⇒ self-review is an allowed recorded fallback (single-agent setups).
      const peerGateInstalled = ports.installedAgents?.() ?? agentsInstalled(realAgentEnv());
      const peerGateWorker = ctx.agent ?? "claude";
      const peerHeteroAvailable = heteroAvailable(peerGateInstalled, peerGateWorker, peerGateAllowedAgents);
      const peerGateSinks = {
        alert: (m: string) => ports.events.appendAlert(ports.paths.alertsPath, m),
        event: (p: { cycleId: string; verdict: string; reasons: string[] }) =>
          ports.events.appendEvent(ports.paths.eventsPath, {
            type: "peer:gate",
            cycleId: p.cycleId,
            verdict: p.verdict as "consulted" | "skipped" | "self-review-allowed",
            reasons: p.reasons,
            ts: eventTs(ports),
          }),
      };
      const peerGateOpts = { heteroAvailable: peerHeteroAvailable };
      // FIX-362: the peer-gate EXECUTION moved to AFTER the pairing loop below. The
      // hetero pairing review (runPairing) is what WRITES the peer-evidence file the
      // gate reads (peerEvidencePresent), so the gate MUST run after it. Running it
      // here (before pairing) always saw no evidence yet → it wrongly blocked EVERY
      // high-complexity / cross-module delivery (e.g. a legit 16-file currency fix)
      // as `hetero_available_self_review_violation`, even though a genuine hetero
      // review ran moments later. The peerGate* setup vars above are consumed there.
      // US-PAIR-003 legacy cross-agent pairing: a heterogeneous peer ONE-WAY
      // reviews the diff for projects that still carry .roll/pairing.yaml. New
      // projects bind story.evaluate in .roll/agents.yaml; pairing remains a
      // compatibility path. NEVER blocks the cycle (30s hard timeout in reviewPeer;
      // runPairing swallows all errors).
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
          // Historical auth streaks are diagnostics only; current availability
          // is checked by the runtime attempt.
          isAvailable: peerAvailable,
          reviewPeer,
          ...(pairHistory !== undefined ? { history: pairHistory } : {}),
          changedFiles: cycleChangedFiles,
          diff: cycleDiff,
          event: (e: PairEvent) => ports.events.appendEvent(ports.paths.eventsPath, e as RollEvent),
          now: () => eventTs(ports),
          // FIX-935: respect project-config agent allowlist.
          allowedAgents: peerGateAllowedAgents,
        };
        // Iterate the enabled stages (config order). file-absent/disabled → [] →
        // the loop body never runs, so a repo without pairing.yaml is untouched.
        for (const stage of enabledPairingStages(ports.repoCwd)) {
          await runPairing(ports.repoCwd, ports.paths.worktreePath, dirname(ports.paths.eventsPath), ctx.cycleId ?? "", ctx.agent ?? "", stage, pairingDeps);
        }
      }
      // FIX-362: peer-gate runs HERE — AFTER the pairing review wrote its evidence
      // (.pair.json), so a genuinely hetero-reviewed delivery reads as `consulted`
      // and is NOT blocked. When pairing is OFF (no pairing.yaml) no evidence exists,
      // so the gate's own retryPeerConsult fallback runs (single-agent path, unchanged).
      let peerGate = await runPeerGate(ports.paths.worktreePath, runtimeDir, cycleIdStr, peerGateMode, peerGateSinks, peerGateOpts);
      let peerBlocked = peerGate.blocked;
      if (peerGate.blocked) {
        // AC-H3: bounded retry — exactly one re-attempt via the existing consult.
        const retryInstalled = peerGateInstalled.filter((a) => peerAvailable(a));
        const retry = await retryPeerConsult(ports.paths.worktreePath, runtimeDir, cycleIdStr, {
          installed: retryInstalled.length > 0 ? retryInstalled : peerGateInstalled,
          workingAgent: peerGateWorker,
          reviewPeer,
          diff: cycleDiff,
          event: (e: PairEvent) => ports.events.appendEvent(ports.paths.eventsPath, e as RollEvent),
          now: () => eventTs(ports),
          // FIX-935: respect project-config agent allowlist.
          allowedAgents: peerGateAllowedAgents,
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
      const storyId = ctx.storyId ?? "";
      // FIX-908: the score stage's result is no longer fire-and-forget. We capture
      // whether the SOLE producer of the cycle's Review Score (runScorePairing)
      // actually produced one ("scored") or failed loud (none-available / timeout /
      // error). A failed score stage on a cycle that did REAL work is the keystone
      // signal for the `needs_review` terminal (computed at facts-capture below).
      // Default "scored" so a NON-delivery cycle (commitsAhead===0 — the score
      // stage is never run) is never mis-flagged: needs_review is gated on
      // commitsAhead>0 anyway, so the default only matters when the stage ran.
      let scoreStatus: "none-available" | "scored" | "timeout" | "error" = "scored";
      // FIX-343 (step ③) pipeline order: peer-score → report render → attest gate
      // → terminal → teardown. The score stage runs BEFORE the report render so
      // the report embeds the FRESHLY-written peer score (never a stale one). A
      // fresh-session peer Reviewer (runScorePairing) is the SOLE producer of the
      // cycle's Review Score — the working agent NEVER grades its own delivery
      // (owner ruling 2026-06-16: an agent grading its own work is a conflict of
      // interest). When no peer can score (no candidate / timeout / error) NO note is
      // written: the attest gate then fails loud (`missing peer review score`)
      // and the cycle honestly fails — there is no runner-derived fallback.
      if (commitsAhead > 0 && storyId !== "") {
        // US-OBS-035 — save raw peer output to a deterministic artifact path
        // so parse failures can be inspected post-hoc. Path scheme:
        //   cycle-logs/{cycleId}/peer/{peer}.{stage}.raw.txt
        const savePeerRawOutput = (peer: string, stage: "score" | "review", stdout: string, stderr: string): string => {
          const peerDir = join(dirname(ports.paths.eventsPath), "cycle-logs", ctx.cycleId ?? "cycle", "peer");
          mkdirSync(peerDir, { recursive: true });
          const artifactPath = join(peerDir, `${peer}.${stage}.raw.txt`);
          writeFileSync(artifactPath, `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`);
          return artifactPath;
        };
        // FIX-910 — emit a per-attempt score-stage failure event so every null
        // return from a scorer is OBSERVABLE (no more silently swallowed nulls).
        // The cause distinguishes unparseable / timeout / auth-block / exit-error.
        const emitScoreFailure = (peer: string, cause: "unparseable" | "timeout" | "auth-block" | "exit-error", detail?: string, artifactPath?: string): void => {
          ports.events.appendEvent(ports.paths.eventsPath, {
            type: "pair:score-failure",
            cycleId: ctx.cycleId ?? "",
            peer,
            cause,
            ...(detail !== undefined ? { detail: detail.slice(0, 200) } : {}),
            ...(artifactPath !== undefined ? { artifactPath } : {}),
            stage: "score",
            ts: eventTs(ports),
          });
        };
        // FIX-910 — single attempt wrapper: try spawning a scorer and parsing its
        // output. Returns the parsed score on success, or the failure cause on
        // null (after calling attributeBlockCause for auth/network detection).
        const tryScoreOnce = async (
          peer: string,
          prompt: string,
          timeoutMs: number,
        ): Promise<
          | { outcome: "parsed"; parsed: import("./pairing-gate.js").PairScore }
          | { outcome: "unparseable"; detail: string; artifactPath: string }
          | { outcome: "timeout"; detail: string; artifactPath?: string }
          | { outcome: "auth-block"; detail: string; artifactPath?: string }
          | { outcome: "exit-error"; detail: string; artifactPath: string }
        > => {
          const credentialBlock = blockIfAgentCredentialsMissing(peer, "score", ports, ctx);
          if (credentialBlock !== null) return { outcome: "auth-block", detail: credentialBlock };
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
          } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            await attributeBlockCause(peer, "error", detail, "score");
            return { outcome: "auth-block", detail };
          }
          if (res === null || res.timedOut) {
            const detail = res !== null ? `${res.stdout}\n${res.stderr}` : "";
            let artifactPath: string | undefined;
            if (res !== null) {
              artifactPath = savePeerRawOutput(peer, "score", res.stdout, res.stderr);
            }
            const blockCause = await attributeBlockCause(peer, "timeout", detail, "score");
            // external block (auth/network) surfaced by attributeBlockCause → auth-block;
            // genuine slowness with no block signature → timeout.
            return blockCause === "auth" || blockCause === "network"
              ? { outcome: "auth-block", detail, artifactPath }
              : { outcome: "timeout", detail, artifactPath };
          }
          if (res.exitCode !== 0) {
            const detail = `${res.stdout}\n${res.stderr}`;
            const artifactPath = savePeerRawOutput(peer, "score", res.stdout, res.stderr);
            const blockCause = await attributeBlockCause(peer, "error", detail, "score");
            return blockCause === "auth" || blockCause === "network"
              ? { outcome: "auth-block", detail, artifactPath }
              : { outcome: "exit-error", detail, artifactPath };
          }
          const parsed = parsePairScoreOutput(res.stdout);
          if (parsed === null) {
            // The reviewer ANSWERED but the format didn't match the strict
            // SCORE:/VERDICT:/RATIONALE: protocol — this is unparseable, NOT a
            // timeout/error. Previously silently discarded; now observable.
            const artifactPath = savePeerRawOutput(peer, "score", res.stdout, res.stderr);
            return { outcome: "unparseable", detail: res.stdout.slice(0, 500), artifactPath };
          }
          return { outcome: "parsed", parsed: { ...parsed, cost: peerReviewCost(peer, res.stdout) } };
        };
        const scorePeer = async (peer: string, summary: string, timeoutMs: number): Promise<import("./pairing-gate.js").PairScore | null> => {
          const prompt = buildPairScorePrompt(summary, evalContractFormatted);
          // First attempt
          const first = await tryScoreOnce(peer, prompt, timeoutMs);
          if (first.outcome === "parsed") return first.parsed;
          emitScoreFailure(peer, first.outcome, first.detail, first.artifactPath);
          // FIX-910 unparseable rescue: the reviewer ANSWERED but the format was
          // off. Give ONE retry with a stricter format reminder — the reviewer
          // already did the cognitive work; the harness just needs a parseable
          // reply. Only unparseable gets a retry; timeout/auth/exit-error do not
          // (they indicate a real spawn/process problem, not a format issue).
          if (first.outcome === "unparseable") {
            const retryPrompt = buildPairScorePrompt(summary, evalContractFormatted) +
              "\n\n你上次回复缺/错了 SCORE/VERDICT/RATIONALE 行，请严格只回这三行。";
            const retry = await tryScoreOnce(peer, retryPrompt, timeoutMs);
            if (retry.outcome === "parsed") return retry.parsed;
            emitScoreFailure(peer, retry.outcome, retry.detail, retry.artifactPath);
          }
          return null;
        };
        let diffStat = "";
        try {
          const { stdout } = await execFileAsync("git", ["diff", "--stat", "origin/main...HEAD"], { cwd: ports.paths.worktreePath, encoding: "utf8" });
          diffStat = stdout.slice(0, 4_000);
        } catch {
          /* summary degrades gracefully */
        }
        // FIX-363: give the scorer the story's GOAL so it grades against intent —
        // a removal card's deletions are the deliverable, not a regression (a scorer
        // blind to the goal scored a clean roll-sentinel deletion 3/10 and jammed the
        // loop). Best-effort: a missing/unreadable spec degrades to the id-only line.
        let goalLine = "";
        let evalContractFormatted = "";
        try {
          const specPath = join(cardArchiveDir(ports.repoCwd, storyId), "spec.md");
          if (existsSync(specPath)) {
            const specText = readFileSync(specPath, "utf8");
            const title = (/^title:\s*(.+)$/m.exec(specText)?.[1] ?? "").trim();
            if (title !== "") goalLine = `Goal: ${title}\n`;
            // US-SKILL-030: pass evaluation contract to scorer so it grades against
            // the planner's intended evidence/focus, not just generic code quality.
            evalContractFormatted = formatEvaluationContractForScorer(parseEvaluationContract(specText));
          }
        } catch {
          /* best-effort — the scorer still gets the diff stat */
        }
        const summary = `Story: ${storyId}\n${goalLine}Delivery: peer-reviewed cycle, scoring stage\nDiff stat:\n${diffStat}`;
        const skill = storyId.startsWith("FIX-") || storyId.startsWith("BUG-") ? "roll-fix" : "roll-build";
        // Write to the PERSISTENT .roll (repoCwd) so the peer score note survives
        // worktree teardown and the gate (reading repoCwd) finds it. FIX-343: use
        // the SAME injectable installed-agents seam as the peer gate so the
        // mandatory score stage is hermetic under test (no real-env spawns).
        // FIX-908: CONSUME the result (was fire-and-forget). A non-"scored" status
        // means the gate will fail loud on "missing peer review score"; we remember
        // it so a cycle that nonetheless did real work is classified `needs_review`
        // (work preserved) rather than plain `failed` + orphaned branch. The score
        // note itself is still written ONLY by runScorePairing — we synthesize
        // nothing here (the independence red line stands).
        const scoreResult = await runScorePairing(ports.repoCwd, dirname(ports.paths.eventsPath), ctx.cycleId ?? "", ctx.agent ?? "", storyId, skill, summary, {
          installed: ports.installedAgents?.() ?? agentsInstalled(realAgentEnv()),
          // Historical auth streaks do not shrink the fair candidate pool.
          isAvailable: peerAvailable,
          scorePeer,
          event: (e: PairEvent) => ports.events.appendEvent(ports.paths.eventsPath, e as RollEvent),
          now: () => eventTs(ports),
          // FIX-935: respect project-config agent allowlist.
          allowedAgents: peerGateAllowedAgents,
        });
        scoreStatus = scoreResult.status;
      }
      if (commitsAhead > 0 && storyId !== "" && ctx.evidenceRunDir !== undefined && ctx.evidenceRunDir !== "") {
        // FIX-912: auto-generate ac-map DRAFT from cycle evidence BEFORE the
        // FIX-246 remediation. The draft has full AC structure + evidence chain
        // (commits, test files, changed files) with CONSERVATIVE statuses:
        // "pass-with-evidence" only when a test file named after the AC exists;
        // otherwise "needs-confirmation". The honesty red line is untouched —
        // the harness NEVER auto-writes a bare "pass" without clear proof.
        if (needsAcMapRemediation(ports.paths.worktreePath, storyId)) {
          try {
            const specPath = storySpecPath(ports.paths.worktreePath, storyId);
            if (specPath !== null) {
              const specText = readFileSync(specPath, "utf8");
              // Collect git evidence (cheap — max a few hundred lines for
              // a single cycle's worth of commits + diff).
              const gitEvidence = await collectDraftEvidence(ports.paths.worktreePath);
              // US-OBS-031: also collect activity signals from the event stream
              // for richer evidence drafting (TCR commits, gate results, tool calls).
              let cycleSignals: CycleActivityEvent[] | undefined;
              try {
                const bus = new EventBus();
                const events = bus.readEvents(ports.paths.eventsPath);
                const cycleEvents = events.filter(
                  (e) => "cycleId" in e && (e as { cycleId?: string }).cycleId === ctx.cycleId,
                );
                if (cycleEvents.length > 0) {
                  cycleSignals = cycleActivityFromEvents(cycleEvents, ctx.cycleId ?? "");
                }
              } catch {
                // Signal collection is best-effort — never fail the cycle on a read blip.
              }
              const draftJson = generateAcMapDraft(specText, storyId, gitEvidence, cycleSignals);
              if (draftJson !== null) {
                writeAcMapDraftEvidenceFiles(ports.paths.worktreePath, storyId, gitEvidence);
                writeFileSync(acMapPath(ports.paths.worktreePath, storyId), draftJson);
                ports.events.appendEvent(ports.paths.eventsPath, {
                  type: "attest:draft-generated",
                  cycleId: ctx.cycleId ?? "",
                  storyId,
                  ts: eventTs(ports),
                });
              }
            }
          } catch {
            // Draft generation is best-effort — a spec-read / git blip must
            // never fail the cycle. The FIX-246 remediation still runs below.
          }
        }
        // FIX-246: ac-map omission remediation. Agents deliver real work yet
        // consistently skip skill step 10.6 (write ac-map.json) — the hard gate
        // then kills every cycle as an empty shell. Before rendering, give the
        // SAME agent ONE surgical second pass to CONFIRM/CORRECT the ac-map
        // (the harness already wrote a draft; the agent only adjusts statuses).
        // Honest statuses only — the prompt and the render-layer red line both
        // forbid fabricated passes. One retry structurally: capture runs once.
        if (needsAcMapRemediation(ports.paths.worktreePath, storyId)) {
          let outcome: "written" | "still-missing" | "spawn-failed";
          const remediationAgent = ctx.agent ?? "claude";
          try {
            if (blockIfAgentCredentialsMissing(remediationAgent, "build", ports, ctx) !== null) {
              outcome = "spawn-failed";
            } else {
              await ports.agentSpawn(remediationAgent, {
                cwd: ports.paths.worktreePath,
                skillBody: buildAcMapRemediationPrompt(ports.paths.worktreePath, storyId, ctx.evidenceRunDir),
                storyId,
                timeoutMs: ACMAP_REMEDIATION_TIMEOUT_MS,
                runDir: ctx.evidenceRunDir,
              });
              outcome = needsAcMapRemediation(ports.paths.worktreePath, storyId) ? "still-missing" : "written";
            }
          } catch {
            outcome = "spawn-failed";
          }
          ports.events.appendEvent(ports.paths.eventsPath, {
            type: "attest:remediation",
            cycleId: ctx.cycleId ?? "",
            storyId,
            agent: remediationAgent,
            outcome,
            ts: eventTs(ports),
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
              ts: eventTs(ports),
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
      // US-V4-005: capture the attest verdict + reasons so the Evaluator artifact
      // (verified/planned) can record evidence status + blocking findings.
      let attestVerdict: "produced" | "skipped" | "unknown" = "unknown";
      let attestReasons: readonly string[] = [];
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
                ts: eventTs(ports),
              }),
          },
          // FIX-343: read the peer score from the PERSISTENT .roll (repoCwd) —
          // where runScorePairing wrote it — not the ephemeral worktree; thread
          // the BUILDER SESSION ID (step ①) so the gate verifies the scorer's
          // session ≠ the builder's session (an independent fresh session scored
          // this, never the builder's own in-session/sub-agent grading). The
          // vendor-name comparison is gone — a same-vendor fresh session is valid.
          ports.repoCwd,
          ctx.builderSessionId ?? "",
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
        attestVerdict = res.verdict;
        attestReasons = res.reasons;
      }
      // US-V4-005: for verified/planned profiles, write the Evaluator artifact
      // (eval-report.md + artifact-manifest.json) into the run dir, ASSEMBLED from
      // the cycle's separate review/score/attest signals (never one pass/fail).
      // FAIL-CLOSED (US-V4-005): a malformed/missing evaluator artifact, or one
      // whose session is the builder's (self-grade), BLOCKS the cycle — it never
      // marks Done. US-V4-007: the bounded repair DECISION (decideRepair) frames
      // the Evaluator→Builder repair signal with a structured reason; the live
      // re-spawn loop that consumes a `repair` action is v4.1.
      let evaluatorBlocked = false;
      if (
        (ctx.selectedProfile === "verified" || ctx.selectedProfile === "planned") &&
        commitsAhead > 0 &&
        storyId !== ""
      ) {
        const blocking = attestBlocked || peerBlocked ? attestReasons : [];
        const ev = writeEvaluatorArtifact(ports, ctx, { attestStatus: attestVerdict, blockingFindings: blocking });
        if (ev.written && !ev.valid) {
          evaluatorBlocked = true;
          ports.events.appendAlert(
            ports.paths.alertsPath,
            `evaluator artifact (${ctx.selectedProfile}) failed closed for ${storyId}: ${ev.reasons.join("; ")} — cycle ${ctx.cycleId ?? "?"}`,
          );
        }
        const repair = decideRepair(blocking, initialRepairState(), { maxRounds: DEFAULT_MAX_REPAIR_ROUNDS });
        if (repair.action !== "done") {
          ports.events.appendAlert(
            ports.paths.alertsPath,
            `repair decision (${ctx.selectedProfile}) for ${storyId}: ${repair.action} — ${repair.reason} (live repair loop is v4.1; cycle held for review) — cycle ${ctx.cycleId ?? "?"}`,
          );
        }
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
      // US-V4-005: a verified/planned cycle with an invalid Evaluator artifact is
      // gate-blocked (fail-closed) alongside the attest/peer gates.
      const gateBlocked = attestBlocked || peerBlocked || evaluatorBlocked;
      // FIX-908: a gate-blocked cycle that did REAL work (≥1 commit AND ≥1 tcr:
      // commit) but is only missing a REQUIRED acceptance artifact — the
      // independent peer Review Score was not produced (scoreStatus ≠ "scored") OR
      // the acceptance report is an empty shell (no AC content / no ac-map) — is
      // NOT a no-output failure. The work is sound and committed; the attest gate
      // has already honestly blocked Done (no synthesized artifact). Flag it so
      // classifyCaptured returns `needs_review` (branch preserved, awaits review)
      // instead of plain `failed` + an orphaned, discarded branch. Scoped tightly:
      // ONLY when blocked, with real work, and no PR already out (the FIX-244
      // published path arbitrates that case first). NEVER set on a passing gate or
      // on a 0-commit / 0-tcr give-up — those stay `failed`/`gave_up`/`idle`.
      const missingRequiredArtifact =
        scoreStatus !== "scored" ||
        (storyId !== "" && !verificationReportHasContent(ports.paths.worktreePath, storyId));
      const needsReview =
        gateBlocked &&
        commitsAhead > 0 &&
        tcrCount > 0 &&
        missingRequiredArtifact &&
        prState !== "OPEN" &&
        prState !== "MERGED";
      const facts: CapturedFacts = {
        usedWorktree: true,
        agentExecuted,
        // The real agent process exit code (from agent_exited), NOT the
        // gate-block signal. `gateBlocked` is the separate hard-attest/peer
        // rejection channel. Non-zero agent exit + commits with no gate block
        // is now "built" (agent did real work despite a non-zero exit — e.g. pi
        // often exits ≠0 after a successful build).
        agentExit: ctx.agentExitCode ?? 0,
        timedOut: false,
        commitsAhead,
        ...(gateBlocked ? { gateBlocked: true } : {}),
        ...(needsReview ? { needsReview: true } : {}),
        ...(mainAhead > 0 ? { mainAhead } : {}),
        ...(mainDirty ? { mainDirty: true } : {}),
        ...(worktreeDirty ? { worktreeDirty: true } : {}),
        ...(prState !== undefined ? { prState } : {}),
      };
      return { event: { type: "facts_captured", facts }, ctxPatch: { tcrCount, ...(mainDirty ? { mainDirty: true } : {}) } };
    }

    // delivery/pr planPublishPr → github.runPublishPlan → published result.
    case "publish_pr": {
      const manualMerge = cmd.manualMerge === true || storyRequiresManualMerge(ports.repoCwd, ctx.storyId);
      const slug = await ports.github.repoSlug(ports.repoCwd);
      if (slug === undefined) {
        // gh unavailable / no github remote → status 2 (gh-missing tier).
        const pub: PublishResult = { status: 2, mergedBack: false, orphanPushed: false, manualMerge, ...(cmd.draft === true ? { draft: true } : {}) };
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
        const pub: PublishResult = { status: 0, manualMerge, ...(cmd.draft === true ? { draft: true } : {}) };
        return { event: { type: "published", result: pub } };
      }
      const plan = cmd.docOnly
        ? planPublishDocPr({ branch: cmd.branch, slug, body: publishBody(ctx), manualMerge, draft: cmd.draft })
        : planPublishPr({ branch: cmd.branch, slug, body: publishBody(ctx), manualMerge, draft: cmd.draft });
      const r = await ports.github.runPublishPlan(plan);
      // US-V4-001: publish no longer mounts a PR link onto a story `index.html`
      // dossier page — the global dossier/story-page refresh is not a v4 delivery
      // side effect. The PR fact lives in the DeliveryRecord + events below and is
      // surfaced by `roll cycles` / `roll truth`; render dossier pages on demand
      // with `roll index`.
      // US-TRUTH-015 AC1 + FIX-389b: write DeliveryRecord on successful publish.
      // This is now an OPTIONAL CACHE WARM — the correctness path is runs+git
      // projection (FIX-389a). The DeliveryRecord here is immediately available
      // for readers that haven't switched to the projection yet. When FIX-389a
      // is fully adopted, this block can become a no-op or be removed.
      if (r.status === 0 && r.prUrl !== "" && ctx.storyId !== undefined && ctx.cycleId !== undefined) {
        const parsedNumber = prNumberFromUrl(r.prUrl);
        try {
          appendDelivery(nodeDeliveryStore, ports.repoCwd, {
            storyId: ctx.storyId,
            cycleId: ctx.cycleId,
            lifecycleState: "pending_merge",
            prNumber: parsedNumber !== undefined
              ? present(Number(parsedNumber))
              : absent("not_recorded"),
            prUrl: present(r.prUrl),
            mergedAt: absent("not_recorded"),
            mergeCommit: absent("not_recorded"),
            recordedAt: ports.clock(),
          });
        } catch {
          // DeliveryRecord write is best-effort — never block publish on it.
          ports.events.appendAlert(
            ports.paths.alertsPath,
            `US-TRUTH-015: appendDelivery failed for ${ctx.storyId} (cycle ${ctx.cycleId})`,
          );
        }
      }
      const pub: PublishResult = { status: r.status, manualMerge, ...(cmd.draft === true ? { draft: true } : {}) };
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

    // FIX-903: save leaked main commits to a rescue ref, then reset main.
    case "rescue_leaked": {
      const refName = `rescue/leaked-${cmd.cycleId}`;
      const r = await ports.git.rescueLeaked(ports.repoCwd, refName);
      ports.events.appendAlert(
        ports.paths.alertsPath,
        `rescue_leaked ${cmd.cycleId}: saved ${r.rescuedSha.slice(0, 8)} to ${refName} ref; main reset ${r.code === 0 ? "ok" : "failed"}`,
      );
      // FIX-903 AC3: emit an audit event so the rescue is observable.
      ports.events.appendEvent(ports.paths.eventsPath, {
        type: "cycle:rescue",
        cycleId: cmd.cycleId,
        ref: refName,
        rescuedSha: r.rescuedSha,
        ts: eventTs(ports),
      });
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
    // NOTE (FIX-354): the lever-4 warm-session CAPTURE used to live here, but
    // `cleanup_worktree` is SKIPPED when the worktree is preserved (publish-fail /
    // `unpublished`), so a failed cycle never captured. The capture now fires at
    // post-agent-exit in `spawn_agent` (above), unconditionally. This branch is
    // pure worktree teardown again.
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
        stampTs(withRealCost(cmd.event, ctx), eventTs(ports)),
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
          // FIX-343 (step ③): resolve report/ac-map from the PERSISTENT .roll
          // (repoCwd), NOT the worktree — `append_run` runs at the terminal,
          // after the worktree may be torn down, so a worktree-rooted lookup
          // false-negatives `acmap_missing`/`not_rendered` even though the
          // evidence is on disk in the shared .roll.
          buildTerminalRecord(cmd, ctx, ports.repoCwd, ports.clock()),
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
        // US-TRUTH-015 AC2: use prMergeInfo for both the state check AND the
        // mergedAt/mergeCommit facts (one gh call, not two).
        const mergeInfo = await ports.github.prMergeInfo(ports.repoCwd, ctx.branch).catch(() => undefined);
        const state = mergeInfo?.state ?? "UNKNOWN";
        if (state === "MERGED") {
          terminalMerged = true;
          // Force-write a done DeliveryRecord with real mergedAt/mergeCommit.
          if (ctx.cycleId !== undefined) {
            try {
              const mergedAtVal = mergeInfo?.mergedAt !== undefined
                ? present(new Date(mergeInfo.mergedAt).getTime())
                : absent("not_recorded");
              const mergeCommitVal = mergeInfo?.mergeCommit !== undefined
                ? present(mergeInfo.mergeCommit)
                : absent("not_recorded");
              appendDelivery(nodeDeliveryStore, ports.repoCwd, {
                storyId: terminalStoryId,
                cycleId: ctx.cycleId,
                lifecycleState: "done",
                prNumber: ctx.prUrl !== undefined
                  ? present(Number(prNumberFromUrl(ctx.prUrl) ?? 0))
                  : absent("not_recorded"),
                prUrl: ctx.prUrl !== undefined
                  ? present(ctx.prUrl)
                  : absent("not_recorded"),
                mergedAt: mergedAtVal,
                mergeCommit: mergeCommitVal,
                recordedAt: ports.clock(),
              });
            } catch {
              ports.events.appendAlert(
                ports.paths.alertsPath,
                `US-TRUTH-015: appendDelivery done failed for ${terminalStoryId} (cycle ${ctx.cycleId})`,
              );
            }
          }
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
        // idle / gave_up never merged → the row goes back to 📋 Todo (re-pickable)
        // — UNLESS this cycle deliberately parked it at 🚫 Hold via self-downgrade
        // (US-AGENT-042). A too-big card runs `roll loop self-downgrade`, which
        // flips the parent to Hold and appends sub-stories, then exits with NO TCR
        // commits → an idle terminal. Blindly flipping it back to Todo would
        // clobber the authoritative Hold and re-pick the too-big card forever (the
        // harness-systemic failure FIX-364 was opened to prevent). A Hold at the
        // terminal is a deliberate park (self-downgrade or a manual hold), never a
        // premature claim to release — leave it.
        if (!isParkedAtHold(ports, terminalStoryId)) {
          ports.backlog.markStatus?.(ports.repoCwd, terminalStoryId, STATUS_MARKER.todo);
        }
        // US-TRUTH-015 AC2: write a failed DeliveryRecord when the cycle gave up
        // or idled without merging. The reason is the terminal status.
        if (ctx.cycleId !== undefined) {
          try {
            appendDelivery(nodeDeliveryStore, ports.repoCwd, {
              storyId: terminalStoryId,
              cycleId: ctx.cycleId,
              lifecycleState: "failed",
              prNumber: ctx.prUrl !== undefined
                ? present(Number(prNumberFromUrl(ctx.prUrl) ?? 0))
                : absent("no_publish_attempted"),
              prUrl: ctx.prUrl !== undefined
                ? present(ctx.prUrl)
                : absent("no_publish_attempted"),
              mergedAt: absent("not_recorded"),
              mergeCommit: absent("not_recorded"),
              recordedAt: ports.clock(),
            });
          } catch {
            // best-effort — never block the terminal on delivery record write
          }
        }
      } else if (cmd.status === "needs_review" && terminalStoryId !== "") {
        ports.backlog.markStatus?.(ports.repoCwd, terminalStoryId, AWAITING_REVIEW_STATUS_MARKER);
        if (ctx.cycleId !== undefined) {
          try {
            appendDelivery(nodeDeliveryStore, ports.repoCwd, {
              storyId: terminalStoryId,
              cycleId: ctx.cycleId,
              lifecycleState: "pending_merge",
              prNumber: ctx.prUrl !== undefined
                ? present(Number(prNumberFromUrl(ctx.prUrl) ?? 0))
                : absent("no_publish_attempted"),
              prUrl: ctx.prUrl !== undefined
                ? present(ctx.prUrl)
                : absent("no_publish_attempted"),
              mergedAt: absent("not_recorded"),
              mergeCommit: absent("not_recorded"),
              recordedAt: ports.clock(),
            });
          } catch {
            // best-effort — never block the terminal on delivery record write
          }
        }
      } else if (terminalStoryId !== "") {
        // FIX-304: a failed / blocked / aborted / orphan terminal NEVER merged
        // this cycle's work to main. If the agent pre-flipped the row ✅ Done
        // (the FIX-284 / FIX-285 false-Done), revert it to the pre-cycle status
        // so a non-merged cycle can never leave a premature Done in the backlog.
        revertPrematureDone(ports, terminalStoryId, ctx.preCycleStatus);
        // US-TRUTH-015 AC2: write a DeliveryRecord for non-success terminals
        // (failed / blocked / aborted / orphan) so the truth stream is complete.
        if (ctx.cycleId !== undefined) {
          const terminalLcs = cmd.status === "blocked" ? "blocked" as const
            : cmd.status === "aborted" || cmd.status === "orphan" ? "abandoned" as const
            : "failed" as const;
          try {
            appendDelivery(nodeDeliveryStore, ports.repoCwd, {
              storyId: terminalStoryId,
              cycleId: ctx.cycleId,
              lifecycleState: terminalLcs,
              prNumber: ctx.prUrl !== undefined
                ? present(Number(prNumberFromUrl(ctx.prUrl) ?? 0))
                : absent("no_publish_attempted"),
              prUrl: ctx.prUrl !== undefined
                ? present(ctx.prUrl)
                : absent("no_publish_attempted"),
              mergedAt: absent("not_recorded"),
              mergeCommit: absent("not_recorded"),
              recordedAt: ports.clock(),
            });
          } catch {
            // best-effort — never block the terminal on delivery record write
          }
        }
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
      // US-V4-001: a cycle terminal no longer refreshes the global dossier
      // aggregate pages as a side effect. Cycle facts are durable events
      // (events.ndjson / runs.jsonl) surfaced by `roll cycles` / `roll cycle
      // watch` / `roll truth`; render dossier pages on demand with `roll index`.
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
      // US-OBS-032: best-effort cycle role summary from the event stream
      if (ctx.cycleId !== undefined) {
        const cycleLogDir = join(dirname(ports.paths.eventsPath), "cycle-logs");
        writeCycleRoleSummaryBestEffort(ctx.cycleId, ports.paths.eventsPath, cycleLogDir);
      }
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
    // FIX-361: native currency so display/reports show ¥ vs $ correctly.
    row["cost_currency"] = ctx.cost.currency;
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
  // FIX-389b: write pr_number + pr_url onto the runs row from the publish
  // context so the projection engine (FIX-389a) can rebuild deliveries from
  // runs alone, without depending on appendDelivery correctness.
  if (ctx.prUrl !== undefined && ctx.prUrl !== "") {
    row["pr_url"] = ctx.prUrl;
    const parsed = prNumberFromUrl(ctx.prUrl);
    if (parsed !== undefined) row["pr_number"] = Number(parsed);
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
  // FIX-343 (step ③): the PERSISTENT-.roll root (repoCwd) the report/ac-map are
  // resolved from — NOT the worktree, which may already be torn down at the
  // terminal (otherwise `acmap_missing`/`not_rendered` false-negatives).
  attestCwd: string,
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
    // FIX-351: gates passed but publish could not complete (work committed
    // locally, never published) — a neutral terminal, NOT a failure.
    local: "unpublished",
    // FIX-908: real work committed + code-stage peer agreed, but a required
    // acceptance artifact is missing (no independent peer Review Score /
    // empty-shell report). Branch preserved, awaits review — NOT a failure.
    needs_review: "needs_review",
    // US-LOOP-079d — dormant_entered: 连续 N idle 后自卸;终态,此后无 idle 行.
    dormant: "dormant_entered",
  };
  let attest: FactOr<TerminalAttestFact>;
  if (storyId === "") {
    attest = absent("not_applicable");
  } else {
    const report = verificationReportPath(attestCwd, storyId);
    const hasReport = existsSync(report);
    const hasMap = existsSync(acMapPath(attestCwd, storyId));
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
    startedAt: epochMs(ctx.startSec ?? nowSec),
    endedAt: epochMs(nowSec),
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
 *  reconcile (FIX-211). US-TRUTH-019: last-wins by (story_id, cycle_id) —
 *  append-only can produce duplicate keys; the last row wins. Rows without
 *  a valid (story_id, cycle_id) token pass through unmerged.
 *  Tolerant: missing file / malformed lines → skipped, so a corrupt row
 *  never topples the cycle's orphan-recovery pass. */
function readRunsRows(runsPath: string): ReconcileRunRow[] {
  try {
    if (!existsSync(runsPath)) return [];
    const all = readFileSync(runsPath, "utf8")
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
    // last-wins: dedupe by (story_id, cycle_id)
    const lastWins = new Map<string, ReconcileRunRow>();
    const unkeyed: ReconcileRunRow[] = [];
    for (const row of all) {
      const sid = typeof row["story_id"] === "string" ? row["story_id"] : "";
      const cid = typeof row["cycle_id"] === "string" ? row["cycle_id"] : "";
      if (sid !== "" && cid !== "") {
        lastWins.set(`${sid}\t${cid}`, row);
      } else {
        unkeyed.push(row);
      }
    }
    return [...unkeyed, ...lastWins.values()];
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
      const prState = await ports.github.prState(ports.repoCwd, branch).catch(() => "UNKNOWN");
      if (prState === "CLOSED") {
        ports.events.appendAlert(
          ports.paths.alertsPath,
          `resume-prior-work: ${storyId} skips prior branch ${branch} because its PR is CLOSED — starting from origin/main unless explicitly rescued`,
        );
        continue;
      }
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
/**
 * US-AGENT-042 — is the story CURRENTLY parked at 🚫 Hold in the main backlog?
 * A self-downgrade cycle flips the picked card to Hold (and appends its
 * sub-stories) mid-cycle, then exits with no commits → an idle terminal. The
 * idle-terminal reconcile must NOT flip that authoritative Hold back to Todo, or
 * the too-big card is re-picked forever. Best-effort read (mirrors
 * {@link revertPrematureDone}); a read blip returns false so the normal release
 * still runs.
 */
export function isParkedAtHold(ports: Ports, storyId: string): boolean {
  try {
    const rows = ports.backlog.read(ports.repoCwd) as Array<{ id: string; status?: string }>;
    const row = rows.find((r) => r.id === storyId);
    if (row === undefined) return false;
    return findStatusMarker(row.status ?? "") === STATUS_MARKER.hold;
  } catch {
    return false;
  }
}

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

/**
 * FIX-311b — the BUILD-PREFLIGHT visual-evidence gate, run inside `pick_story`
 * AFTER the spec-truth reset and BEFORE the agent spawns. It is the shift-left
 * of the FIX-309 attest gate: catch a spec that can NEVER satisfy the runtime
 * screenshot floor at the cheapest possible moment (before a whole build cycle
 * honest-skips) rather than at delivery.
 *
 * CONSERVATIVE BY CONTRACT (owner red line: 误杀 CLI/后端卡 = 阻断 loop, 绝不可):
 *   - It NEVER alters control flow — the caller's `story_picked` still returns
 *     regardless. A false positive can therefore NOT topple a CLI/back-end card;
 *     it only raises a visible, auditable signal (an ALERT + a `visual:gate`
 *     event).
 *   - It fails-loud ONLY when CONFIDENT (the verdict's `ok` is false): a clear
 *     WEB-surface card with no declared `deliverable_url`
 *     (`web-surface-without-deliverable-url`), or a card with NO visual-evidence
 *     AC and NO recorded `screenshot_exempt` (`missing-visual-evidence-ac`). A
 *     TERMINAL deliverable, an AMBIGUOUS surface, an exempt card, or an
 *     unreadable/absent spec is LEFT ALONE — the surface-aware validator never
 *     forces a web url onto those, and FIX-309 remains the hard backstop at
 *     delivery for anything that slips.
 * Best-effort throughout: any read/parse blip is swallowed (a preflight signal
 * must never fail the cycle).
 */
export function runVisualEvidencePreflight(ports: Ports, storyId: string, cycleId: string): void {
  try {
    const specPath = join(cardArchiveDir(ports.repoCwd, storyId), "spec.md");
    if (!existsSync(specPath)) return; // no spec to judge → leave alone (FIX-309 backstops)
    const specText = readFileSync(specPath, "utf8");
    const v = validateStoryVisualEvidence(specText);
    if (v.ok) {
      // Record the pass too (audit: the card was checked and can satisfy the floor).
      ports.events.appendEvent(ports.paths.eventsPath, {
        type: "visual:gate",
        cycleId,
        storyId,
        verdict: "ok",
        surface: v.surface,
        reasons: v.exemptReason !== undefined ? [`exempt: ${v.exemptReason}`] : [],
        ts: eventTs(ports),
      });
      // FIX-339 (AC6) — must-declare STRUCTURAL check (WARN-only this round).
      // Fires ONLY on a card that the surface-aware validator already passed
      // (`ok`) yet declares NONE of {deliverable_url, deliverable_cmd,
      // screenshot_exempt} — i.e. a previously-SILENT card (a terminal/ambiguous
      // visual AC with no concrete capturable surface) that will honest-skip
      // forever and the future hard闸 will catch. It is a SUPPLEMENTARY signal,
      // never a duplicate of an existing validate flag, and NEVER blocks the
      // cycle (the structural hard闸 is held for a separate round post-backfill).
      // FIX-339 (复核 #5) — declaresAnySurface is PURE (specText only): it sees a
      // per-card `screenshot_exempt:` but NOT the policy epic deny-list
      // (acceptance.screenshot_exempt_epics). A card whose EPIC is recorded as
      // non-visual is legitimately exempt and declares no surface ON PURPOSE —
      // flagging it no-surface-declared误杀 a back-end card (owner red line). So
      // treat an epic-exempt card as already declaring a (null) surface here.
      const epicExempt = screenshotExemption(ports.repoCwd, storyId).reason !== undefined;
      if (!epicExempt && !declaresAnySurface(specText)) {
        ports.events.appendEvent(ports.paths.eventsPath, {
          type: "visual:gate",
          cycleId,
          storyId,
          verdict: "flagged",
          code: "no-surface-declared",
          surface: v.surface,
          reasons: ["spec declares no deliverable_url, deliverable_cmd, or screenshot_exempt — no surface to capture"],
          ts: eventTs(ports),
        });
        ports.events.appendAlert(
          ports.paths.alertsPath,
          `[WARN] visual-evidence preflight (${storyId}): no-surface-declared — the spec declares none of ` +
            `\`deliverable_url:\` / \`deliverable_cmd:\` / \`screenshot_exempt: <reason>\` — cycle ${cycleId}. ` +
            `Declare a deliverable surface (web url or CLI command) or a recorded exemption. ` +
            `NOT blocked this round — structural闸 will harden after backfill; FIX-309 still enforces declared surfaces at delivery.`,
        );
      }
      return;
    }
    // CONFIDENT problem → fail loud (ALERT + event), but DO NOT block the cycle.
    const reason = v.reason ?? "visual-evidence contract not satisfied";
    ports.events.appendEvent(ports.paths.eventsPath, {
      type: "visual:gate",
      cycleId,
      storyId,
      verdict: "flagged",
      ...(v.code !== undefined ? { code: v.code } : {}),
      surface: v.surface,
      reasons: [reason],
      ts: eventTs(ports),
    });
    ports.events.appendAlert(
      ports.paths.alertsPath,
      `[WARN] visual-evidence preflight (${storyId}): ${v.code ?? "flagged"} — ${reason} — cycle ${cycleId}. ` +
        `Add a visual-evidence AC` +
        (v.code === "web-surface-without-deliverable-url"
          ? ` AND declare \`deliverable_url:\` (alias \`screenshot_url:\`) for the web surface`
          : ` or a recorded \`screenshot_exempt: <reason>\``) +
        `. NOT blocked — FIX-309 enforces at delivery; this is the cheap early warning.`,
    );
  } catch {
    /* best-effort: a spec read/parse blip must never fail the cycle */
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

/**
 * FIX-1026 — parse `est_min:<n>` from a STORY SPEC's YAML frontmatter.
 *
 * The agents.yaml tier→rig contract (easy ≤8, default 8–20, hard >20) is driven
 * by `est_min`, and the documented escalation lever is "bump est_min to send a
 * stuck card to a harder tier". That lever lives in the spec frontmatter, which
 * was never read by the router — only the backlog row's `est_min:` tag was. A
 * spec declaring `est_min: 24` therefore still ran on the `default` tier.
 *
 * This reads ONLY the leading `--- … ---` frontmatter block (so a stray
 * `est_min:` mention in the prose body cannot hijack routing) and returns the
 * first `est_min:` integer there, or undefined when absent/unparseable. The
 * resolve_route handler prefers this over the backlog row so the spec is the
 * single source of truth for sizing.
 */
export function parseEstMinFromSpec(specText: string): number | undefined {
  const fm = /^---\n([\s\S]*?)\n---/.exec(specText);
  if (fm === null) return undefined;
  const m = /^\s*est[_-]?min:\s*(\d+)/im.exec(fm[1] ?? "");
  return m === null ? undefined : Number(m[1]);
}

/**
 * FIX-1026 — the router's est_min for a story, spec frontmatter taking
 * precedence over the backlog row. Reading the spec is best-effort: a missing,
 * unreadable, or frontmatter-less spec falls back to the backlog row's
 * `est_min:` tag (prior behavior), so routing never regresses on a parse blip.
 */
/** US-V4-004/003 — the project's `execution_policy.mode` from `.roll/agents.yaml`
 *  (default "standard" when absent/unparseable). Gates whether verified/planned
 *  stages execute; standard keeps the cycle Builder-only (no regression). */
function executionPolicyMode(repoCwd: string): "standard" | "verified" | "planned" | "auto" {
  try {
    const p = join(repoCwd, ".roll", "agents.yaml");
    if (!existsSync(p)) return "standard";
    return normalizeAgentConfig(readFileSync(p, "utf8")).config.executionPolicy.mode;
  } catch {
    return "standard";
  }
}

/**
 * US-V4-004 — select the Story execution profile from the spec's risk signals and
 * RECORD it in a durable `execution:profile` event. Pure-decision + one append;
 * never throws (a spec read blip falls back to `standard`, the current
 * builder-only path). Returns the profile so the executor can fold it into the
 * cycle context. In v4.0 only `standard` actually executes — recording the chosen
 * profile is the foundation verified/planned execution builds on (US-V4-005/006).
 */
export function recordExecutionProfile(
  ports: Ports,
  cycleId: string,
  storyId: string,
  estMin: number | undefined,
): ExecutionProfile {
  let profile: ExecutionProfile = "standard";
  let reason = "standard: spec unavailable";
  try {
    const specPath = storySpecPath(ports.repoCwd, storyId);
    if (specPath !== null && existsSync(specPath)) {
      const input = classifyStoryRisk(storyId, readFileSync(specPath, "utf8"), {
        ...(estMin !== undefined ? { estimatedMinutes: estMin } : {}),
      });
      const classified = selectExecutionProfile(input);
      // Apply execution_policy.mode (default "standard" — incl. no agents.yaml) so
      // a project that has not opted into verified/planned stays Builder-only (the
      // v4.0 no-regression guarantee). The classification still informs the reason.
      const mode = executionPolicyMode(ports.repoCwd);
      profile = applyExecutionPolicy(classified, mode);
      reason = `${explainExecutionProfile(input)} [policy:${mode} → ${profile}]`;
    }
  } catch {
    profile = "standard";
    reason = "standard: profile selection failed (fell back)";
  }
  try {
    ports.events.appendEvent(ports.paths.eventsPath, {
      type: "execution:profile",
      cycleId,
      storyId,
      profile,
      reason,
      ts: eventTs(ports),
    });
  } catch {
    /* recording is best-effort; never topple routing on an event-append blip */
  }
  return profile;
}

/**
 * US-V4-005 — write + validate the EVALUATOR artifact for a verified/planned
 * cycle. The Evaluator role is not a new monolithic gate: it ASSEMBLES the three
 * separate contracts the cycle already produced in fresh sessions — the
 * independent Review Score, the blocking review/attest findings, and the attest
 * evidence status — into `eval-report.md` + `artifact-manifest.json` under the
 * run dir, then validates fail-closed (manifest well-formed, evaluator session ≠
 * builder session). Best-effort writer: a write blip returns `valid:false` with
 * reasons; the existing attest/peer gates remain the actual cycle blockers.
 */
export function writeEvaluatorArtifact(
  ports: Ports,
  ctx: CycleContext,
  signals: { attestStatus: "produced" | "skipped" | "unknown"; blockingFindings: readonly string[]; plannedVsDelivered?: string },
): { written: boolean; valid: boolean; reasons: readonly string[] } {
  const profile = ctx.selectedProfile;
  if (profile !== "verified" && profile !== "planned") return { written: false, valid: true, reasons: [] };
  const storyId = ctx.storyId ?? "";
  const runDir = ctx.evidenceRunDir ?? "";
  if (storyId === "" || runDir === "") return { written: false, valid: false, reasons: ["no story id / run dir for evaluator artifact"] };
  const scoreEntry = readLatestStoryReviewScore(ports.repoCwd, storyId);
  const verdict: "good" | "ok" | "regression" =
    scoreEntry?.verdict === "good" || scoreEntry?.verdict === "regression" ? scoreEntry.verdict : "ok";
  // US-V4-006: when a planner contract exists (planned profile), the Evaluator
  // reports planned-vs-delivered against it.
  let plannedSummary = signals.plannedVsDelivered;
  if (plannedSummary === undefined || plannedSummary === "") {
    const contractPath = join(runDir, "role-artifacts", "planner", "planner-contract.md");
    if (existsSync(contractPath)) {
      try {
        const contract = parsePlannerContract(readFileSync(contractPath, "utf8"), storyId);
        if (contract !== null) {
          plannedSummary = summarizePlannedVsDelivered(plannedVsDelivered(contract, deliveredAcItems(ports.repoCwd, storyId)));
        }
      } catch {
        /* planned-vs-delivered is best-effort context for the report */
      }
    }
  }
  const report = assembleEvalReport({
    storyId,
    blockingFindings: signals.blockingFindings,
    ...(scoreEntry !== undefined ? { score: { value: scoreEntry.score, verdict } } : {}),
    attestStatus: signals.attestStatus,
    ...(plannedSummary !== undefined && plannedSummary !== "" ? { plannedVsDelivered: plannedSummary } : {}),
  });
  const reportMd = renderEvalReport(report);
  const manifest: ArtifactManifest = {
    schemaVersion: 1,
    storyId,
    cycleId: ctx.cycleId ?? "",
    role: "evaluator",
    rig: { agent: (scoreEntry?.scoredBy ?? "reasonix") } as Rig,
    sessionId: scoreEntry?.sessionId ?? "",
    worktreeCwd: ports.paths.worktreePath,
    scoreRepoCwd: ports.repoCwd,
    inputs: [
      { path: `${storyId}-report.html`, kind: "report" },
      { path: "ac-map.json", kind: "evidence" },
    ],
    outputs: [{ path: "role-artifacts/evaluator/eval-report.md", kind: "report" }],
    createdAt: new Date(eventTs(ports)).toISOString(),
  };
  const dir = join(runDir, "role-artifacts", "evaluator");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "eval-report.md"), reportMd);
    writeFileSync(join(dir, "artifact-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  } catch {
    return { written: false, valid: false, reasons: ["failed to write evaluator artifact files"] };
  }
  const v = validateEvaluatorArtifact({ manifest, reportMd, storyId, builderSessionId: ctx.builderSessionId ?? "" });
  return { written: true, valid: v.ok, reasons: v.reasons };
}

/** US-V4-006 — the AC items a delivery covered (ac-map entries with a positive
 *  status), used for planned-vs-delivered mapping. Best-effort + lenient. */
function deliveredAcItems(repoCwd: string, storyId: string): string[] {
  try {
    const p = join(cardArchiveDir(repoCwd, storyId), "ac-map.json");
    if (!existsSync(p)) return [];
    const arr = JSON.parse(readFileSync(p, "utf8")) as Array<{ ac?: string; status?: string }>;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e) => e.status === "pass" || e.status === "partial" || e.status === "readonly")
      .map((e) => e.ac ?? "")
      .filter((a) => a !== "");
  } catch {
    return [];
  }
}

const PLANNER_TIMEOUT_MS = 20 * 60 * 1000;

/** US-V4-006 — the Planner prompt (roll-design capability). TS owns the
 *  orchestration + the output contract; the skill does the planning. */
function buildPlannerPrompt(storyId: string, contractAbsPath: string): string {
  return [
    `You are the PLANNER for story ${storyId} in a planned execution profile.`,
    `Read the story spec under .roll/features/**/${storyId}/spec.md and produce a planner contract.`,
    `Write the contract to: ${contractAbsPath}`,
    "It MUST be markdown with these sections (use '- ' bullets):",
    "## Scope boundary",
    "## Acceptance contract",
    "## Expected evidence",
    "## Risks",
    "## Out of scope",
    "## Resize / split guidance   (optional prose)",
    "Do NOT write product code — you only plan. The Builder consumes this contract next.",
  ].join("\n");
}

/**
 * US-V4-006 — run the Planner stage BEFORE the Builder for a `planned` cycle.
 * The Planner (roll-design capability) runs in a FRESH session and writes
 * `planner-contract.md`; the runner records the planner `artifact-manifest.json`.
 * The contract is then validated FAIL-CLOSED — a missing/malformed/empty contract
 * stops the cycle before any Builder work. No-op for standard/verified. Idempotent
 * across retries (an existing valid contract is reused, not re-planned).
 */
export async function runPlannerStage(
  ports: Ports,
  ctx: CycleContext,
  plannerAgent: string,
): Promise<{ ran: boolean; ok: boolean; reasons: readonly string[] }> {
  if (ctx.selectedProfile !== "planned") return { ran: false, ok: true, reasons: [] };
  const storyId = ctx.storyId ?? "";
  const runDir = ctx.evidenceRunDir ?? "";
  if (storyId === "" || runDir === "") return { ran: false, ok: false, reasons: ["no story id / run dir for planner stage"] };
  const dir = join(runDir, "role-artifacts", "planner");
  const contractPath = join(dir, "planner-contract.md");
  const manifestPath = join(dir, "artifact-manifest.json");
  const plannerSessionId = `${ctx.cycleId ?? "cycle"}:plan:${plannerAgent}:${ports.clock()}`;
  if (!existsSync(contractPath)) {
    try {
      mkdirSync(dir, { recursive: true });
      await ports.agentSpawn(plannerAgent, {
        cwd: ports.paths.worktreePath,
        skillBody: buildPlannerPrompt(storyId, contractPath),
        storyId,
        timeoutMs: PLANNER_TIMEOUT_MS,
        runDir: dir,
      });
    } catch {
      /* a planner spawn blip → no contract → validation below fails closed */
    }
  }
  // The runner records the planner role manifest (the skill writes the contract).
  const manifest: ArtifactManifest = {
    schemaVersion: 1,
    storyId,
    cycleId: ctx.cycleId ?? "",
    role: "planner",
    rig: { agent: plannerAgent } as Rig,
    sessionId: plannerSessionId,
    worktreeCwd: ports.paths.worktreePath,
    scoreRepoCwd: ports.repoCwd,
    inputs: [{ path: `.roll/features/**/${storyId}/spec.md`, kind: "contract" }],
    outputs: [{ path: "role-artifacts/planner/planner-contract.md", kind: "contract" }],
    createdAt: new Date(eventTs(ports)).toISOString(),
  };
  try {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  } catch {
    /* best-effort manifest record */
  }
  const contractMd = existsSync(contractPath) ? readFileSync(contractPath, "utf8") : null;
  const v = validatePlannerArtifact({ manifest, contractMd, storyId });
  return { ran: true, ok: v.ok, reasons: v.reasons };
}

export function routerEstMin(worktreeCwd: string, storyId: string, backlogDesc: string): number | undefined {
  try {
    const specPath = storySpecPath(worktreeCwd, storyId);
    if (specPath !== null && existsSync(specPath)) {
      const fromSpec = parseEstMinFromSpec(readFileSync(specPath, "utf8"));
      if (fromSpec !== undefined) return fromSpec;
    }
  } catch {
    /* spec read/parse is an optimization — never topple routing on it */
  }
  return parseEstMin(backlogDesc);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * FIX-912 — collect the git evidence the ac-map draft generator needs.
 * Three cheap git calls in the worktree; each has a hard cap so they never
 * stall the cycle (a single cycle's worth of commits + diff is small).
 * Best-effort: on ANY failure returns an empty evidence structure (the draft
 * generator then produces an all-`needs-confirmation` skeleton). The cap
 * values are generous for a normal cycle but bounded for safety.
 */
async function collectDraftEvidence(worktreeCwd: string): Promise<DraftEvidence> {
  const empty: DraftEvidence = { commitLines: [], diffStatLines: [], changedFilenames: [] };
  try {
    const [commits, diffStat, changedFiles] = await Promise.all([
      execFileAsync("git", ["log", "--oneline", "origin/main..HEAD", "-n", "50"], {
        cwd: worktreeCwd,
        encoding: "utf8",
        timeout: 15_000,
      }).then((r) => r.stdout.trim().split("\n").filter((l) => l !== ""), () => [] as string[]),
      execFileAsync("git", ["diff", "--stat", "origin/main...HEAD"], {
        cwd: worktreeCwd,
        encoding: "utf8",
        timeout: 15_000,
      }).then((r) => r.stdout.trim().split("\n").filter((l) => l !== ""), () => [] as string[]),
      execFileAsync("git", ["diff", "--name-only", "origin/main...HEAD"], {
        cwd: worktreeCwd,
        encoding: "utf8",
        timeout: 15_000,
      }).then((r) => r.stdout.trim().split("\n").filter((l) => l !== ""), () => [] as string[]),
    ]);
    return { commitLines: commits, diffStatLines: diffStat, changedFilenames: changedFiles };
  } catch {
    return empty;
  }
}

/**
 * The filesystem roots a cycle's WORK needs to write — consumed by agents that
 * run under an explicit workspace sandbox (codex `--sandbox workspace-write`
 * splices these as `--add-dir`; non-sandboxing agents like claude/pi ignore
 * them). This is an agent-AGNOSTIC fact-about-the-work, not a per-agent special
 * case (the sandbox/test/acceptance behaviours that DO differ per agent belong
 * behind the agent factory — FIX-313/US-LOOP-…). The per-agent decision of
 * WHETHER and HOW to apply these roots lives in agent-spawn.
 */
export function agentWritableRoots(repoCwd: string, alertsPath: string): string[] {
  const roots: string[] = [];
  const add = (p: string): void => {
    if (p.trim() === "") return;
    const real = existsSync(p) ? realpathSync(p) : p;
    if (!roots.includes(real)) roots.push(real);
  };
  const rollDir = join(repoCwd, ".roll");
  if (existsSync(rollDir)) add(rollDir);
  add(dirname(alertsPath));
  // FIX-326: the cycle worktree's git-internal dir (the shared object store +
  // the worktree's own gitdir under <common>/worktrees/<cycle>) lives OUTSIDE
  // the worktree — under the repo's git-common-dir. Without write access there,
  // a sandboxed agent's `git write-tree` / `git commit` silently fail: no
  // test-pass proof is written and no TCR commit can be created, so a cycle that
  // produced complete, green work is discarded as gave_up (observed: FIX-285,
  // 3× $4-7 cycles, 0 commits). `git commit` needs the same dir, so granting the
  // common dir is what makes the agent's own-branch TCR commits work at all.
  try {
    const common = execFileSync("git", ["-C", repoCwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
    }).trim();
    if (common !== "") add(common);
  } catch {
    /* best-effort: if the git probe fails the agent's commits will fail loudly
       (no silent proof), surfacing the issue rather than masking it. */
  }
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
  // FIX-367: rebase-safe push. A cycle's metadata commit is built on the local
  // `.roll` HEAD captured at pick time — which is STALE the moment another actor
  // (the PR-lane's merge-time Done flip, a prior cycle's reconcile, a manual
  // rescue) pushes a backlog status change to the roll-meta remote between this
  // cycle's start and finalize. Pushing this stale commit straight to `origin
  // main` either (a) fails non-fast-forward — surfaced as an ALERT, the Done
  // landing lost from this cycle — or (b), after the loop wrapper re-syncs the
  // local `.roll`, CLOBBERS the concurrently-pushed `✅ Done` back to the pick-time
  // `📋 Todo`, re-arming the picker → the re-pick storm FIX-367 closes (FIX-364
  // re-done 3 cycles). Integrate the remote FIRST (fetch + rebase --autostash),
  // so a concurrent Done flip is preserved on top of and merged with this cycle's
  // metadata, and the subsequent push fast-forwards instead of overwriting.
  await rebaseRollMetaOntoUpstream(rollDir, branch);
  const pushed = await gitPush(rollDir, branch);
  if (pushed.code !== 0) {
    return { committed: true, pushed: false, nothingToCommit: false, error: `git push failed: ${pushed.stderr.trim()}` };
  }
  return { committed: true, pushed: true, nothingToCommit: false };
}

/**
 * FIX-367 — integrate the roll-meta remote into the local `.roll` BEFORE pushing
 * the cycle's metadata commit, so a concurrent backlog status flip (the PR-lane's
 * merge-time Done, a reconcile, a manual rescue) is never clobbered by this
 * cycle's stale pick-time snapshot.
 *
 * Best-effort + non-fatal by design: the caller already created the local commit
 * and will push next. We fetch the branch's upstream and `rebase --autostash`
 * the local commit on top of it. On a fetch failure (offline / no remote
 * tracking) or a rebase conflict we ABORT the rebase and leave the local commit
 * untouched — the push then either fast-forwards (nothing concurrent landed) or
 * fails non-fast-forward (surfaced as the existing committed-not-pushed ALERT).
 * The rebase never throws out of here: a rebase blip must not topple the cycle.
 */
async function rebaseRollMetaOntoUpstream(rollDir: string, branch: string): Promise<void> {
  try {
    const fetched = await gitRun(["fetch", "origin", branch], rollDir);
    if (fetched.code !== 0) return; // offline / no remote → push decides fast-forward.
    const upstream = `origin/${branch}`;
    // Nothing to integrate when the remote has not advanced past our local base.
    const behind = await gitRun(["rev-list", "--count", `HEAD..${upstream}`], rollDir);
    if (behind.code === 0 && behind.stdout.trim() === "0") return;
    const rebased = await gitRun(["rebase", "--autostash", upstream], rollDir);
    if (rebased.code !== 0) {
      // A conflict (e.g. the SAME backlog row edited both sides) — abort cleanly
      // and leave the local commit as-is; the push surfaces the non-fast-forward.
      await gitRun(["rebase", "--abort"], rollDir);
    }
  } catch {
    /* rebase is a safety integration — never topple the cycle on a git blip */
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

/** Incremental `pnpm -r build` is ~2.8s warm; give it generous head-room for a
 *  cold worktree (no prior tsc output) before it is treated as a non-fatal slip. */
export const PREBUILD_TIMEOUT_MS = 600_000;

/**
 * Read the FIX-338 `loop_safety.prebuild_dist` flag from
 * `<repoCwd>/.roll/policy.yaml`. DEFAULT-OFF (稳字纪律): an absent / unreadable /
 * `false` policy ⇒ `false`, so deploy is a NO-OP until `prebuild_dist: true` is
 * explicitly flipped on. Mirrors {@link readAttestGateMode} / readPeerGateMode.
 */
export function readPrebuildDistEnabled(repoCwd: string): boolean {
  try {
    const p = join(repoCwd, ".roll", "policy.yaml");
    if (!existsSync(p)) return false;
    return parsePolicy(readFileSync(p, "utf8")).loopSafety.prebuildDist === true;
  } catch {
    return false; // unreadable / unparseable policy → default OFF (no-op)
  }
}

/**
 * FIX-338 (Phase B 杠杆1) — PREBUILD the workspace `dist/` into a fresh cycle
 * worktree, right after deps install and BEFORE the agent spawns, so the working
 * agent already finds `dist/roll.mjs` instead of burning cold round-trips to
 * locate and build the entry point.
 *
 * Agent-AGNOSTIC: a plain `pnpm -r build` benefits any engine (codex/pi/kimi) —
 * NO per-agent hardcode. Does NOT break cycle isolation: the worktree is still
 * based on fresh origin/main (create_worktree) and `dist/` is a gitignored
 * artifact, not tracked content.
 *
 * BEST-EFFORT (red line): a build failure must NEVER topple the cycle — it logs a
 * WARN alert and returns, so the agent still spawns (and can build itself the old
 * way). Gated by {@link readPrebuildDistEnabled}; DEFAULT-OFF ⇒ this is a no-op
 * until explicitly enabled. Skips non-Node projects (no package.json) and
 * projects with no pnpm lockfile (the build command is pnpm-specific).
 */
export async function bootstrapWorktreePrebuild(
  worktreePath: string,
  alertsPath: string,
  events: EventsPort,
  enabled: boolean,
  exec: DepsExec = execFileAsync as unknown as DepsExec,
): Promise<void> {
  if (!enabled) return; // DEFAULT-OFF: deploy no-op until flipped on.
  if (!existsSync(join(worktreePath, "package.json"))) return;
  // The build command is `pnpm -r build`; without a pnpm lockfile this is not a
  // pnpm workspace, so there is nothing to prebuild here.
  if (!existsSync(join(worktreePath, "pnpm-lock.yaml"))) return;
  try {
    await exec("pnpm", ["-r", "build"], {
      cwd: worktreePath,
      timeout: PREBUILD_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    // BEST-EFFORT: a prebuild slip is NON-FATAL — log + continue so the cycle
    // proceeds and the agent can still build the entry point itself.
    events.appendAlert(
      alertsPath,
      `[WARN] worktree dist prebuild failed (pnpm -r build): ${msg} — continuing; agent will build on demand`,
    );
  }
}

/**
 * Read the FIX-338 `loop_safety.project_map` flag from `<repoCwd>/.roll/policy.yaml`.
 * DEFAULT-OFF (稳字纪律): an absent / unreadable / `false` policy ⇒ `false`, so
 * deploy is a NO-OP until `project_map: true` is explicitly flipped on. Mirrors
 * {@link readPrebuildDistEnabled} exactly.
 */
export function readProjectMapEnabled(repoCwd: string): boolean {
  try {
    const p = join(repoCwd, ".roll", "policy.yaml");
    if (!existsSync(p)) return false;
    return parsePolicy(readFileSync(p, "utf8")).loopSafety.projectMap === true;
  } catch {
    return false; // unreadable / unparseable policy → default OFF (no-op)
  }
}

/**
 * Read the lever-4 `loop_safety.session_reuse` flag from
 * `<repoCwd>/.roll/policy.yaml`. DEFAULT-OFF (稳字纪律): an absent / unreadable /
 * `false` policy ⇒ `false`, so deploy is a NO-OP until `session_reuse: true` is
 * explicitly flipped on. Mirrors {@link readProjectMapEnabled} exactly.
 */
export function readSessionReuseEnabled(repoCwd: string): boolean {
  try {
    const p = join(repoCwd, ".roll", "policy.yaml");
    if (!existsSync(p)) return false;
    return parsePolicy(readFileSync(p, "utf8")).loopSafety.sessionReuse === true;
  } catch {
    return false; // unreadable / unparseable policy → default OFF (no-op)
  }
}

export function readResumeScope(repoCwd: string): ResumeScope {
  try {
    const p = join(repoCwd, ".roll", "policy.yaml");
    if (!existsSync(p)) return "off";
    return parsePolicy(readFileSync(p, "utf8")).loopSafety.resumeScope ?? "off";
  } catch {
    return "off";
  }
}

/** The warm-session ledger path — under the PERSISTENT `.roll/loop` (repoCwd), NOT
 *  the cycle worktree, so a captured session survives `.roll reset` and the
 *  worktree teardown (same durability as runs.jsonl). */
export function warmSessionsLedgerPath(repoCwd: string): string {
  return join(repoCwd, ".roll", "loop", "warm-sessions.json");
}

/** Read the warm-session ledger (the captured `{storyId, sessionId, ts}` entries).
 *  Tolerant: a missing / unreadable / malformed ledger reads as `[]` — a capture
 *  store miss never resumes (cold fallback) and never fails the cycle. */
export function readWarmSessions(repoCwd: string): WarmSessionEntry[] {
  try {
    const raw = readFileSync(warmSessionsLedgerPath(repoCwd), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWarmSessionEntry);
  } catch {
    return [];
  }
}

/** Append a captured warm-session entry to the ledger (best-effort; a write slip
 *  is logged-and-tolerated, never fatal — the worst case is a cold next card). */
function appendWarmSession(repoCwd: string, entry: WarmSessionEntry): void {
  const ledger = readWarmSessions(repoCwd);
  ledger.push(entry);
  const p = warmSessionsLedgerPath(repoCwd);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(ledger, null, 2) + "\n");
}

/** Consume (single-use) every ledger entry keyed by `storyId` — remove them so a
 *  resumed session is used AT MOST once. Best-effort write. */
function consumeWarmSession(repoCwd: string, storyId: string): void {
  const ledger = readWarmSessions(repoCwd).filter((e) => e.storyId !== storyId);
  const p = warmSessionsLedgerPath(repoCwd);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(ledger, null, 2) + "\n");
}

/** Hard char cap on the injected project map — the FIX-338 prompt is already lean
 *  (~2.3KB hub); the map must stay a CONCISE orientation aid, never context bloat.
 *  Anything over this is truncated with an explicit elision marker. */
export const PROJECT_MAP_MAX_CHARS = 1800;

/** How many top-level entries to list (shallow), and how deep into a key container
 *  dir (`packages/`) to descend — one level, so it stays a map not a file dump. */
const PROJECT_MAP_MAX_TOPLEVEL = 24;
const PROJECT_MAP_MAX_RELEVANT = 12;

/** Top-level names never worth mapping (noise: deps, VCS, build caches). */
const PROJECT_MAP_SKIP = new Set([
  ".git",
  "node_modules",
  ".vite",
  "dist",
  "coverage",
  ".turbo",
  ".cache",
  ".DS_Store",
]);

/** Container dirs we descend ONE level into (the workspace's real structure). */
const PROJECT_MAP_CONTAINERS = new Set(["packages", "apps", "skills"]);

/** Read a dir's immediate Dirent children (string-named overload, never throws
 *  the Buffer variant). A thin wrapper so callers get a precise element type. */
function shallowDirents(dir: string): import("node:fs").Dirent<string>[] {
  return readdirSync(dir, { withFileTypes: true });
}

/** Read a dir's immediate child names (dirs suffixed `/`), sorted, bounded; `[]`
 *  on any error. Pure-ish: read-only inspection of the worktree. */
function shallowList(dir: string, limit: number): string[] {
  try {
    const out: string[] = [];
    for (const ent of shallowDirents(dir)) {
      if (PROJECT_MAP_SKIP.has(ent.name)) continue;
      out.push(ent.isDirectory() ? `${ent.name}/` : ent.name);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out.slice(0, limit);
  } catch {
    return [];
  }
}

/** Recursively collect (bounded) file paths whose relative PATH contains `token`
 *  (case-insensitive) — so both a card-named file AND any file under the card's
 *  `<epic>/<id>/` dir count as relevant. Skips noise dirs. Read-only; stops at
 *  `limit` hits or `maxScan` entries so a huge tree can never stall the spawn. */
function findRelevantFiles(root: string, token: string, limit: number): string[] {
  const needle = token.toLowerCase();
  const hits: string[] = [];
  let scanned = 0;
  const maxScan = 4000;
  const walk = (dir: string, rel: string): void => {
    if (hits.length >= limit || scanned >= maxScan) return;
    let ents: ReturnType<typeof shallowDirents>;
    try {
      ents = shallowDirents(dir);
    } catch {
      return;
    }
    for (const ent of ents) {
      if (hits.length >= limit || scanned >= maxScan) return;
      if (PROJECT_MAP_SKIP.has(ent.name)) continue;
      scanned += 1;
      const childRel = rel === "" ? ent.name : `${rel}/${ent.name}`;
      if (ent.isDirectory()) {
        walk(join(dir, ent.name), childRel);
      } else if (childRel.toLowerCase().includes(needle)) {
        hits.push(childRel);
      }
    }
  };
  walk(root, "");
  hits.sort((a, b) => a.localeCompare(b));
  return hits.slice(0, limit);
}

/**
 * FIX-338 (Phase B 杠杆2) — build a CONCISE, BOUNDED project map for the working
 * agent's initial context: (a) the repo's shallow top-level structure (key dirs
 * one level deep) so the agent grasps the layout without `ls`/`rg` round-trips,
 * and (b) the card's relevant files (a heuristic: files whose basename matches the
 * story-id token, plus its epic), so it lands near the work instead of grepping.
 *
 * Agent-AGNOSTIC: pure text, no per-agent shape — the caller prepends it into the
 * SAME prompt body every agent consumes ({@link buildSpawnCommand}). BOUNDED: the
 * whole map is hard-capped at {@link PROJECT_MAP_MAX_CHARS} (truncated with an
 * explicit marker) so it can never bloat the already-lean prompt. Read-only
 * inspection of the cycle worktree ⇒ does NOT break isolation.
 *
 * Returns "" when the worktree is unreadable (a missing map is harmless — the
 * agent simply explores the old way), so the spawn never fails on this aid.
 */
export function buildProjectMap(worktreePath: string, storyId?: string): string {
  const top = shallowList(worktreePath, PROJECT_MAP_MAX_TOPLEVEL);
  if (top.length === 0) return ""; // unreadable worktree → no map (harmless).
  const lines: string[] = ["[项目地图 / project map]", "结构 / structure:"];
  for (const name of top) {
    lines.push(`  ${name}`);
    const bare = name.replace(/\/$/, "");
    if (name.endsWith("/") && PROJECT_MAP_CONTAINERS.has(bare)) {
      for (const child of shallowList(join(worktreePath, bare), PROJECT_MAP_MAX_TOPLEVEL)) {
        lines.push(`    ${child}`);
      }
    }
  }
  // (b) Card-relevant files — heuristic on the story-id token (e.g. FIX-338),
  // bounded. A blank/short token is skipped (too noisy to be useful).
  const token = (storyId ?? "").trim();
  if (token.length >= 3) {
    const relevant = findRelevantFiles(worktreePath, token, PROJECT_MAP_MAX_RELEVANT);
    if (relevant.length > 0) {
      lines.push(`本卡相关文件 / files matching ${token}:`);
      for (const f of relevant) lines.push(`  ${f}`);
    }
  }
  let map = lines.join("\n");
  if (map.length > PROJECT_MAP_MAX_CHARS) {
    map = `${map.slice(0, PROJECT_MAP_MAX_CHARS - 3)}...`;
  }
  return map;
}

/**
 * FIX-338 (Phase B 杠杆2) — when ON, PREPEND the bounded project map ahead of the
 * skill body so it rides into the agent's initial context (the prompt is built as
 * autorun-directive + story-pin + skillBody, so a prefix here orients the agent
 * before it reads the workflow). DEFAULT-OFF: `enabled === false` ⇒ returns the
 * body unchanged (deploy no-op). Best-effort: an empty/unreadable map also returns
 * the body unchanged, so the aid can never fail the spawn.
 */
export function maybeInjectProjectMap(
  skillBody: string,
  worktreePath: string,
  enabled: boolean,
  storyId?: string,
): string {
  if (!enabled) return skillBody; // DEFAULT-OFF: deploy no-op until flipped on.
  const map = buildProjectMap(worktreePath, storyId);
  if (map === "") return skillBody;
  return `${map}\n\n${skillBody}`;
}

// ── FIX-386: low peer review score fix-forward context injection ────────────

/** Max chars of reviewer rationale to inject into the agent context. A short
 *  fix-forward task keeps the prompt bounded; the full note is still on disk. */
const LOW_SCORE_FEEDBACK_MAX_CHARS = 1200;

/**
 * FIX-386 — build a fix-forward task prompt from the reviewer's low-score
 * findings. Returns an empty string when there is no low score to forward, or
 * when the latest score is above the low threshold. The prompt tells the builder
 * to fix the specific reviewer findings ON THE SAME BRANCH (resumed worktree),
 * then re-submit for peer review — no fresh re-pick, no context loss.
 *
 * Reads the LATEST review score note for the story from the PERSISTENT .roll
 * (repoCwd). Best-effort: a read blip returns "" so the agent runs cold without
 * the fix-forward hint — suboptimal but never cycle-toppling.
 */
export function buildLowScoreFixForwardPrompt(
  projectPath: string,
  storyId: string,
): string {
  if (storyId === "") return "";
  let entry: ReviewScoreEntry | undefined;
  try {
    entry = readLatestStoryReviewScore(projectPath, storyId);
  } catch {
    return "";
  }
  if (entry === undefined) return "";
  if (entry.score > REVIEW_SCORE_LOW_THRESHOLD) return "";
  const verdict = entry.verdict.toLowerCase();
  if (verdict !== "ok" && verdict !== "regression") return "";

  const headline =
    verdict === "regression"
      ? `⚠️  Prior peer review REGRESSION (${entry.score}/10) — fix these findings on the SAME branch and re-submit for review. Do NOT start fresh.`
      : `⚠️  Prior peer review LOW SCORE (${entry.score}/10) — address reviewer findings on the SAME branch, then re-submit for peer review.`;

  const rationale =
    (entry.note ?? "").trim() === ""
      ? `(no detailed rationale recorded — check ${entry.sourcePath})`
      : entry.note.trim().slice(0, LOW_SCORE_FEEDBACK_MAX_CHARS);

  const who = entry.scoredBy !== undefined && entry.scoredBy !== ""
    ? ` (reviewed by ${entry.scoredBy})`
    : "";

  return [
    "## 🔧 Fix-Forward: Low Peer Review Score",
    "",
    `${headline}${who}`,
    "",
    "**Reviewer findings:**",
    rationale,
    "",
    "**Instructions:**",
    `- You are resuming the EXISTING branch for ${storyId} — all prior code is already here.`,
    "- Fix each finding above with minimal, targeted changes.",
    "- Write/update regression tests for each fix.",
    `- When done, the cycle's peer review stage will RE-SCORE this delivery.`,
    "- If the score is still low, the loop will escalate to the owner.",
    "",
  ].join("\n");
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

function readScopedAgentLayer(path: string): { config: AgentScopeConfig; path: string } | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  if (!text.includes("roll-agents/v1")) return null;
  const parsed = normalizeAgentScopeConfig(text);
  if (parsed.config === null || parsed.errors.length > 0) return null;
  return { config: parsed.config, path };
}

function scopedStoryExecuteRoute(repoCwd: string): { agent: string; model: string } | null {
  const rollHome = process.env["ROLL_HOME"] ?? join(homedir(), ".roll");
  const layers = [
    readScopedAgentLayer(join(rollHome, "agents.yaml")),
    readScopedAgentLayer(join(repoCwd, ".roll", "agents.yaml")),
  ].filter((layer): layer is { config: AgentScopeConfig; path: string } => layer !== null);
  if (layers.length === 0) return null;

  const installed = new Set(agentsInstalled(realAgentEnv()).map((name) => canonicalAgentName(name)));
  const runtimeHealth = Object.fromEntries(
    AGENT_REGISTRY_NAMES.map((agent) => [
      agent,
      installed.has(agent) ? { available: true } : { available: false, reason: "not-installed" },
    ]),
  ) as Partial<Record<AgentName, { available: boolean; reason?: string }>>;
  const resolution = resolveAgentScopeRole({
    scope: "story",
    role: "execute",
    layers,
    runtimeHealth,
  });
  if (resolution.ok) {
    return {
      agent: resolution.resolved.agent,
      model: resolution.resolved.model ?? "",
    };
  }
  const hasScopedBindingFailure = resolution.failure.source !== undefined || resolution.failure.candidates.length > 0;
  if (hasScopedBindingFailure) {
    const reason = resolution.failure.errors[0] ?? "story.execute unresolved";
    throw new Error(`scoped story.execute resolution failed: ${reason}`);
  }
  return null;
}

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
  const spawn = opts.agentSpawn ?? realAgentSpawn;

  // FIX-906: the unified delivery-truth predicate. The structured projection
  // (`ensureDeliveriesFresh`, FIX-904/905) rebuilds deliveries.jsonl from BOTH
  // runs.jsonl AND git merges on origin/main, so `queryStoryDelivery(id).delivered`
  // recognizes external / manual merges (claude salvage, PR-lane direct merge)
  // that the runs-only `hasMergedDelivery` is blind to. Memoized per cycle: the
  // projection (which may shell out to `git log`) runs at most ONCE, then every
  // story id reads the same in-memory snapshot. Wholly best-effort — a git/IO
  // failure leaves an empty snapshot and the picker/preflight fall back to the
  // runs-only signal they OR with, never toppling the cycle.
  const deliveryFreshness: FreshnessPort = {
    mtimeMs(absPath: string): number | undefined {
      try {
        return statSync(absPath).mtimeMs;
      } catch {
        return undefined;
      }
    },
    readText(absPath: string): string {
      try {
        return readFileSync(absPath, "utf8");
      } catch {
        return "";
      }
    },
    writeText(absPath: string, text: string): void {
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, text, "utf8");
    },
  };
  let deliveredCache: Set<string> | undefined;
  const mergedDelivery = (storyId: string): boolean => {
    if (deliveredCache === undefined) {
      try {
        const deliveries = ensureDeliveriesFresh(opts.repoCwd, deliveryFreshness, nodeExecPort);
        // Derive `delivered` per story via the single deterministic query so the
        // verdict matches `roll truth query` exactly (FIX-906: one truth, all
        // consumers). Group by storyId first to avoid re-querying the same id.
        const set = new Set<string>();
        const ids = new Set(deliveries.map((d) => d.storyId));
        for (const id of ids) {
          if (queryStoryDelivery(id, deliveries).delivered) set.add(id);
        }
        deliveredCache = set;
      } catch {
        deliveredCache = new Set<string>(); // best-effort: empty → fall back to runs-only
      }
    }
    return deliveredCache.has(storyId);
  };

  return {
    repoCwd: opts.repoCwd,
    paths: opts.paths,
    skillBody: opts.skillBody,
    clock,
    agentSpawn: spawn,
    // FIX-906: unified delivery-truth predicate (structured projection over
    // runs + git merges on origin/main — recognizes external/manual merges).
    mergedDelivery,
    // FIX-1018: skip stories that already have locally-committed-but-unpublished
    // work from a prior cycle. The executor reads the runtime file at pick time.
    pendingPublish: (storyId) => readPendingPublish(dirname(opts.paths.eventsPath)).has(storyId),
    // FIX-363: the real connectivity probe reuses the same spawn the reviews use.
    agentReachable: (agent) => probeAgentReachable(agent, spawn, { cwd: opts.repoCwd }),
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
      async rescueLeaked(repoCwd, refName) {
        return rescueLeakedMain(repoCwd, refName);
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
      async prMergeInfo(repoCwd, branch) {
        const slug = ghRepoSlug(await remoteUrl(repoCwd));
        if (slug === undefined) return undefined;
        return prViewMergeInfo(slug, branch);
      },
      async openPrTitles(repoCwd) {
        const slug = ghRepoSlug(await remoteUrl(repoCwd));
        if (slug === undefined) return [];
        return prListOpenTitles(slug);
      },
    },
    process: {
      acquireLock(lockPath, o) {
        return acquireLock(lockPath, process.pid, { staleSec: o?.staleSec, now: clock, cycleId: o?.cycleId });
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
          resolve(storyId, estMin) {
            const scoped = scopedStoryExecuteRoute(opts.repoCwd);
            if (scoped !== null) return scoped;
            const tier: Tier = classifyComplexity(estMin);
            const routeDeps = opts.routeDeps;
            // Compatibility fallback for legacy tier slots. FIX-930: a story
            // re-picked after a zero-TCR self-heal swap carries a tried-agent
            // set; route the NEXT untried agent (resolveRouteExcluding) so the
            // swap actually changes who builds. Empty set => plain resolveRoute.
            // The store lives at the MAIN runtime dir (repoCwd is the main
            // project; .roll is symlink-resolved either way).
            const rt = (process.env["ROLL_PROJECT_RUNTIME_DIR"] ?? "").trim() || join(opts.repoCwd, ".roll", "loop");
            const tried = storyId !== "" ? readSelfHeal(rt, storyId).triedAgents : [];
            const dec =
              tried.length > 0
                ? (resolveRouteExcluding(tier, routeDeps, tried) ?? resolveRoute(tier, routeDeps))
                : resolveRoute(tier, routeDeps);
            // Thread the legacy slot's native --model through to the spawn; absent => ""
            // (the orchestrator's `ctx.model !== ""` guard then omits --model and
            // the agent uses its own default).
            return { agent: dec.agent, model: dec.model ?? "" };
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
        return captureFromMarker(marker, {
          runDir,
          deps: { env: { ...process.env } },
        });
      },
    },
    attest: {
      async render(projectCwd, storyId, runDir) {
        const prev = process.cwd();
        try {
          process.chdir(projectCwd);
          // FIX-305: a UI/dossier card's acceptance is a RENDERED page, so its
          // evidence must be a real physical-window screenshot, not a headless,
          // transcript-rendered, or HTML-reproduction PNG. Auto-drive the web
          // self-capture lane against
          // the card's rendered dossier page (file://…/index.html), or an explicit
          // ROLL_ATTEST_WEB_URL deployed product page. On unattended/headless hosts
          // the capture records an honest skip instead of fabricating visual
          // evidence.
          // FIX-339 (AC1): capture EVERY declared deliverable_url (a card may ship
          // more than one user-visible web view). FIX-321: if a required story
          // declares none, record an HONEST web skip (no hollow dossier shot) so
          // the visual floor stays satisfiable without faking evidence. Exempt
          // stories owe no web capture at all.
          const webTargets = webCaptureTargetsForStory(projectCwd, storyId, process.env["ROLL_ATTEST_WEB_URL"]);
          const webArgs =
            webTargets.length > 0
              ? webTargets.flatMap((t) => ["--capture-web", t])
              : storyRequiresScreenshot(projectCwd, storyId) && deliverableCmdsForStory(projectCwd, storyId).length === 0
                ? ["--capture-web-skip", "no deliverable_url declared (set deliverable_url in the spec frontmatter or ROLL_ATTEST_WEB_URL)"]
                : [];
          // FIX-339 (AC2/AC3): run + capture EVERY declared deliverable_cmd (a CLI
          // deliverable's terminal output). deliverableCmdsForStory returns only
          // ALLOWLISTED commands (roll read-only) — run inside the worktree via
          // attest's `cd <worktree> && …` wrapper.
          const cmdArgs = deliverableCmdsForStory(projectCwd, storyId).flatMap((c) => ["--capture-command", c]);
          // FIX-339 (复核 #1): any deliverable_cmd the allowlist REJECTED (non-roll
          // command or a state-changing roll subcommand) is NEVER run. Record a
          // loud terminal skip fact so the report discloses the refusal and the
          // attest gate fails on it (rejectedDeliverableCmdsForStory).
          const cmdSkipArgs = rejectedDeliverableCmdsForStory(projectCwd, storyId).flatMap((c) => [
            "--capture-command-skip",
            `deliverable_cmd 非白名单(仅限 roll 只读子命令): ${c}`,
          ]);
          return await attestCommand([storyId, "--run-dir", runDir, ...webArgs, ...cmdArgs, ...cmdSkipArgs], {
            capture: { env: { ...process.env } },
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
