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
  type AgentInternalFailure,
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
  buildDoneIndex,
  ensureDeliveriesFresh,
  queryStoryDelivery,
  nodeExecPort,
  type FreshnessPort,
  latestDeliveringCycle,
  runRowHasPublishedPr,
  parseClaimedIdsFromBacklog,
  parsePolicy,
  buildPickRankingCacheKey,
  parsePickRankingJson,
  rankingEntryForPicked,
  pickStory,
  isEligible,
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
  authCooldownExclusions,
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
  assembleEvalReport,
  renderEvalReport,
  validateEvaluatorArtifact,
  validateDesignArtifact,
  parseDesignContract,
  designContractVsDelivered,
  summarizeDesignContractVsDelivered,
  decideRepair,
  initialRepairState,
  DEFAULT_MAX_REPAIR_ROUNDS,
  type BacklogItem,
  type PickOptions,
  type PickRankingEntry,
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
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  agentCredentialReadiness,
  agentSpawnSupportsPurpose,
  agentSpawnEnvironment,
  type AgentSpawn,
  killLiveAgents,
  realAgentSpawn,
} from "./agent-spawn.js";
import { classifyBlockSignature, probeAgentReachable, type ReachResult } from "./agent-liveness.js";
import { readSkipCards } from "./skip-cards.js";
import { readPendingPublish } from "./pending-publish.js";
import { readSelfHeal } from "./selfheal-budget.js";
import {
  applyMainCheckoutWriteProtection,
  checkMainDirty,
  quarantineEventToRollEvent,
  quarantineMainCheckout,
  releaseMainCheckoutWriteProtection,
  worktreeGitEnv,
  type QuarantineResult,
  type WriteProtectionResult,
} from "./main-checkout-guard.js";
import { cycleChangedFiles, peerEvidencePresent, readPeerGateMode, runPeerGate } from "./peer-gate.js";
import { deliverableCmdsForStory, readAttestGateMode, rejectedDeliverableCmdsForStory, runAttestGate, storyRequiresScreenshot, storySpecPath, verificationReportHasContent, verificationReportPath, webCaptureTargetsForStory } from "./attest-gate.js";
import { recoverKimiUsage, recoverPiUsage } from "./usage-recovery.js";
import { ACMAP_REMEDIATION_TIMEOUT_MS, acMapPath, autoAttachScreenshotToAcMap, buildAcMapRemediationPrompt, generateAcMapDraft, needsAcMapRemediation, writeAcMapDraftEvidenceFiles, type DraftEvidence } from "./attest-remediation.js";
import { applyCorrectionAction } from "./correction-actuator.js";
import { buildPairScorePrompt, buildReviewPrompt, diagnosePairScoreOutput, enabledPairingStages, retryPeerConsult, runPairing, runScorePairing, type PairEvent, type PairReview } from "./pairing-gate.js";
import { realAgentEnv } from "../commands/agent-list.js";
import { readScopedAgentLayer, resolveScopedStoryExecute } from "./scoped-route.js";
import { attestCommand } from "../commands/attest.js";
import { markDoneGuarded } from "./done-guard.js";
import { cardArchiveDir, reportFileName } from "../lib/archive.js";
import { formatEvaluationContractForScorer, parseEvaluationContract } from "../lib/evaluation-contract.js";
import { readLatestStoryReviewScore, REVIEW_SCORE_LOW_THRESHOLD, type ReviewScoreEntry } from "../lib/review-score.js";
import {
  applyCleanupManifest,
  CLEANUP_TIMEOUT_MS,
  resolveCleanupManifest,
  type CleanupResult,
} from "./environment-cleanup.js";
import { recordRootCauseFailure } from "./failure-attribution.js";
import { epochMs, eventTs, guardRuntimeDir } from "./runner-time.js";
import type { CapturePort, DepsExec, EventsPort, ExecuteResult, MetadataCommitResult, Ports, ProcessClock, RunnerPaths } from "./ports.js";
import {
  buildRunRow,
  buildTerminalRecord,
  commitRollMetadata,
  readRunsRows,
  stampTs,
  withRealCost,
} from "./run-records.js";
import { appendPickRankedEvent, resolvePickRanking } from "./pick-ranking.js";
import {
  parseEstMin,
  parseEstMinFromSpec,
  recordExecutionProfile,
  routerEstMin,
  runDesignerStage,
  writeEvaluatorArtifact,
} from "./execution-profile.js";
import {
  RESUME_DISABLED_ENV,
  cleanStaleEvidence,
  isParkedAtHold,
  resetStaleSpecTruth,
  resolveResumeBase,
  revertPrematureDone,
  resetSpecTruthText,
} from "./resume-truth.js";
import { nodePorts } from "./node-ports.js";
import {
  publishBodyWithEvidenceTrailer,
  runVisualEvidencePreflight,
  storyRequiresManualMerge,
} from "./publish-lifecycle.js";
import {
  agentWritableRoots,
  bootstrapWorktreeDeps,
  bootstrapWorktreePrebuild,
  bootstrapWorktreeSkills,
  linkRollIntoWorktree,
  persistWorktreeAlerts,
  readPrebuildDistEnabled,
} from "./worktree-bootstrap.js";
import {
  readProjectMapEnabled,
  readResumeScope,
  readSessionReuseEnabled,
} from "./runner-policy.js";
import {
  readWarmSessions,
  warmSessionsLedgerPath,
} from "./warm-sessions.js";
import {
  buildLowScoreFixForwardPrompt,
  buildProjectMap,
  maybeInjectProjectMap,
} from "./project-map.js";
import {
  ActivitySignalRecorder,
  createCaptureMarkerSink,
  readCycleTimeoutThresholds,
  readStallThreshold,
  startCycleObserver,
  startSpawnTimeoutWatchdog,
  startStallDetector,
} from "./spawn-observers.js";
import {
  appendCleanupEvent,
  appendWriteProtectionEvent,
  cleanupGuardResult,
  quarantineMainCheckoutForCycle,
  recordCleanupFailures,
} from "./sandbox-boundary.js";
import {
  blockIfAgentCredentialsMissing,
  detectAgyInternalFailure,
  projectAllowedAgents,
} from "./agent-routing.js";
import { executeSetupCommand } from "./setup-handlers.js";
import { executeSpawnAgentCommand } from "./spawn-agent-handler.js";
import { executeCaptureFactsCommand } from "./capture-facts-handler.js";

const execFileAsync = promisify(execFile);

export { checkMainDirty };
export { buildRunRow, buildTerminalRecord } from "./run-records.js";
export {
  parseEstMin,
  parseEstMinFromSpec,
  recordExecutionProfile,
  routerEstMin,
  runDesignerStage,
  writeEvaluatorArtifact,
} from "./execution-profile.js";
export {
  RESUME_DISABLED_ENV,
  cleanStaleEvidence,
  isParkedAtHold,
  resetSpecTruthText,
  resolveResumeBase,
  revertPrematureDone,
} from "./resume-truth.js";
export { nodePorts } from "./node-ports.js";
export {
  publishBodyWithEvidenceTrailer,
  runVisualEvidencePreflight,
  storyRequiresManualMerge,
} from "./publish-lifecycle.js";
export {
  DEPS_BOOTSTRAP_TIMEOUT_MS,
  PREBUILD_TIMEOUT_MS,
  SKILLS_BOOTSTRAP_TIMEOUT_MS,
  agentWritableRoots,
  bootstrapWorktreeDeps,
  bootstrapWorktreePrebuild,
  bootstrapWorktreeSkills,
  commitRollMetadataRepo,
  linkRollIntoWorktree,
  persistWorktreeAlerts,
  readPrebuildDistEnabled,
} from "./worktree-bootstrap.js";
export {
  readProjectMapEnabled,
  readResumeScope,
  readSessionReuseEnabled,
} from "./runner-policy.js";
export {
  appendWarmSession,
  consumeWarmSession,
  readWarmSessions,
  warmSessionsLedgerPath,
} from "./warm-sessions.js";
export {
  PROJECT_MAP_MAX_CHARS,
  buildLowScoreFixForwardPrompt,
  buildProjectMap,
  maybeInjectProjectMap,
} from "./project-map.js";
export {
  ActivitySignalRecorder,
  createCaptureMarkerSink,
  readCycleTimeoutThresholds,
  readStallThreshold,
  startCycleObserver,
  startSpawnTimeoutWatchdog,
  startStallDetector,
} from "./spawn-observers.js";
export {
  appendCleanupEvent,
  appendWriteProtectionEvent,
  cleanupGuardResult,
  quarantineMainCheckoutForCycle,
  recordCleanupFailures,
  rescueLeakedMain,
} from "./sandbox-boundary.js";
export {
  blockIfAgentCredentialsMissing,
  detectAgyInternalFailure,
  projectAllowedAgents,
} from "./agent-routing.js";
export type { DepsExec, EventsPort, ExecuteResult, GitPort, GithubPort, MetadataCommitResult, Ports, ProcessClock, RunnerPaths } from "./ports.js";




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
    case "preflight":
    case "create_worktree":
    case "pick_story":
    case "resume_worktree":
    case "resolve_route":
      return executeSetupCommand(cmd, ports, ctx);
    case "spawn_agent":
      return executeSpawnAgentCommand(cmd, ports, ctx);
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
      return executeCaptureFactsCommand(cmd, ports, ctx);
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
      const body = await publishBodyWithEvidenceTrailer(ports, ctx);
      if (body === null) {
        const pub: PublishResult = { status: 1, manualMerge, ...(cmd.draft === true ? { draft: true } : {}) };
        return { event: { type: "published", result: pub } };
      }
      const plan = cmd.docOnly
        ? planPublishDocPr({ branch: cmd.branch, slug, body, manualMerge, draft: cmd.draft })
        : planPublishPr({ branch: cmd.branch, slug, body, manualMerge, draft: cmd.draft });
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

    // US-LOOP-088 — post-cycle environment cleanup before the worktree is removed.
    // Side effect + observable events; no feedback into the state machine.
    case "cleanup_environment": {
      try {
        if (realpathSync(ports.repoCwd) === realpathSync(ports.paths.worktreePath)) {
          appendCleanupEvent(ports, ctx, cleanupGuardResult());
          return {};
        }
      } catch {
        /* fall through; applyCleanupManifest still enforces path boundaries */
      }
      const manifestPath = join(ports.repoCwd, ".roll", "loop", "cleanup-manifest.yaml");
      const manifest = resolveCleanupManifest(ports.paths.worktreePath, manifestPath);
      const results = applyCleanupManifest(ports.paths.worktreePath, ctx.cycleId, manifest, {
        terminalStatus: cmd.terminalStatus,
        maxDurationMs: CLEANUP_TIMEOUT_MS,
      });
      for (const r of results) {
        appendCleanupEvent(ports, ctx, r);
      }
      recordCleanupFailures(ports, ctx, results);
      return {};
    }

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
          markDoneGuarded(ports.repoCwd, terminalStoryId, { mergedToMain: true }, {
            markStatus: (projectCwd, id, status) => ports.backlog.markStatus?.(projectCwd, id, status),
            alert: (m) => ports.events.appendAlert(ports.paths.alertsPath, m),
          });
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
      // (idle/gave_up/failed/blocked/aborted/orphan/local) reset a stale "✅ Fixed/Done"
      // tick and the "[x]" AC checkboxes in the card's spec.md back to unchecked.
      // The agent commits a false "done" spec into the symlinked .roll on a cycle
      // whose product work never merged (FIX-284/285); FIX-304 only fixed the
      // backlog ROW, leaving the spec poisoned so every re-run reads "done" → 0
      // commits → idles forever. Resetting it here (committed via the
      // commitRollMetadata path below) closes that permanent dead-end so a re-run
      // CAN deliver. A genuinely MERGED Done spec is left untouched.
      if (!terminalMerged && terminalStoryId !== "") {
        resetStaleSpecTruth(ports, terminalStoryId);
        // FIX-1043: also move authoritative-looking delivery evidence (report,
        // ac-map, latest symlink) out of the gate-visible paths so a failed /
        // skipped-attest / unpublished cycle cannot leave roll-meta looking
        // delivered. Diagnostics are preserved under failed-diagnostics/.
        // FIX-1063: a published/built terminal is a gate-passing pending-merge
        // state, NOT a failure — its evidence must stay visible in the standard
        // latest/<ID>-report.html + ac-map.json paths until the PR actually merges.
        const pendingMerge = cmd.status === "published" || cmd.status === "built";
        cleanStaleEvidence(
          ports.repoCwd,
          terminalStoryId,
          ctx.cycleId ?? "",
          pendingMerge ? "published_pending_merge" : undefined,
        );
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


function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}







// ── Node-backed Ports wiring (real infra) ─────────────────────────────────────

// Keep these referenced so resolveFallback / parseClaimedIds are not stripped by
// a too-eager tree-shaker in the test bundle (they document the available
// execution surface; nodePorts wires the common path).
export const _availableCoreSurface = {
  resolveFallback,
  parseClaimedIdsFromBacklog,
} as const;
