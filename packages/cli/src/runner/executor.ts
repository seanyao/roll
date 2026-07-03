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
import { executeTerminalCommand } from "./terminal-handlers.js";

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

    // delivery/pr + terminal side effects live in the publish/terminal handler.
    case "publish_pr":
    case "merge_back":
    case "push_orphan":
    case "rescue_leaked":
    case "wait_merge":
    case "reconcile":
    case "cleanup_environment":
    case "cleanup_worktree":
    case "emit_event":
    case "append_run":
    case "append_alert":
    case "release_lock":
      return executeTerminalCommand(cmd, ports, ctx);

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
