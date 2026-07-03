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
            markDoneGuarded(ports.repoCwd, r.id, { mergedToMain: true }, {
              markStatus: (projectCwd, id, status) => ports.backlog.markStatus?.(projectCwd, id, status),
              alert: (m) => ports.events.appendAlert(ports.paths.alertsPath, m),
            });
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
            if (decision === "done") {
              markDoneGuarded(ports.repoCwd, claim.id, { mergedToMain: true }, {
                markStatus: (projectCwd, id, status) => ports.backlog.markStatus?.(projectCwd, id, status),
                alert: (m) => ports.events.appendAlert(ports.paths.alertsPath, m),
              });
            }
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
      const eligibility: PickOptions = {
        hasOpenPr,
        hasMergedDelivery: (id) =>
          (ports.mergedDelivery?.(id) ?? false) || hasMergedDelivery(pickRunRows, id),
        shouldSkip: (id) => skipCards.has(id),
        hasPendingPublish: (id) =>
          (ports.pendingPublish?.(id) ?? false) || pendingPublish.has(id),
      };
      const semanticRanking = await resolvePickRanking(ports, ctx, items as BacklogItem[], eligibility);
      const story = pickStory(items as never, {
        ...eligibility,
        ranking: semanticRanking?.ranking,
      });
      if (story === undefined) return { event: { type: "no_story" } };
      appendPickRankedEvent(ports, ctx, story.id, semanticRanking);
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
      // verified/designed add evaluator/designer stages in later stories.
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
      await quarantineMainCheckoutForCycle(ports, ctx, "pre-spawn");
      if (blockIfAgentCredentialsMissing(cmd.agent, "build", ports, ctx) !== null) {
        return {
          event: { type: "agent_exited", exit: 1, timedOut: false },
          ctxPatch: { builderSessionId },
        };
      }
      // US-V4-006: for a `designed` cycle, run the Designer BEFORE the Builder in a
      // fresh session and FAIL CLOSED on a missing/malformed design contract —
      // the Builder never starts without a valid design. No-op for standard/verified.
      if (ctx.selectedProfile === "designed") {
        const design = await runDesignerStage(ports, ctx, cmd.agent);
        if (design.ran && !design.ok) {
          ports.events.appendAlert(
            ports.paths.alertsPath,
            `designer stage failed closed for ${ctx.storyId ?? "?"}: ${design.reasons.join("; ")} — Builder not started (cycle ${ctx.cycleId ?? "?"})`,
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
        appendWriteProtectionEvent(
          ports,
          applyMainCheckoutWriteProtection({
            repoCwd: ports.repoCwd,
            runtimeDir: guardRuntimeDir(ports),
            cycleId: ctx.cycleId ?? "",
            nowMs: () => eventTs(ports),
          }),
        );
        res = await ports.agentSpawn(cmd.agent, {
          purpose: "builder",
          cwd: ports.paths.worktreePath,
          skillBody: finalSkillBody,
          ...(ctx.evidenceRunDir !== undefined ? { runDir: ctx.evidenceRunDir } : {}),
          writableRoots: agentWritableRoots(ports.repoCwd, ports.paths.alertsPath),
          ...(ctx.model !== undefined && ctx.model !== "" ? { model: ctx.model } : {}),
          env: {
            ...process.env,
            ROLL_LOOP_ALERT: ports.paths.alertsPath,
            ...worktreeGitEnv(ports.paths.worktreePath, ports.repoCwd),
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
        appendWriteProtectionEvent(
          ports,
          releaseMainCheckoutWriteProtection({
            repoCwd: ports.repoCwd,
            runtimeDir: guardRuntimeDir(ports),
            cycleId: ctx.cycleId ?? "",
            nowMs: () => eventTs(ports),
          }),
        );
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
      await quarantineMainCheckoutForCycle(ports, ctx, "post-spawn");
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
      const agentName = ctx.agent ?? cmd.agent;
      try {
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
      // FIX-1050: when usage is genuinely absent, record an agent-specific reason
      // so debug/detail output can distinguish parser failure from agents whose
      // stdout simply carries no usage (agy/gemini). The terminal event keeps the
      // closed `no_parseable_usage` reason; the runs row carries the finer-grained
      // diagnostic.
      const usageUnknownReason: string | undefined =
        costPatch === undefined
          ? agentName === "agy"
            ? "agy_stdout_no_usage"
            : agentName === "reasonix"
              ? "reasonix_footer_unmatched"
              : "no_parseable_usage"
          : undefined;
      // FIX-1051: when agy exits 0 with no parseable usage and effectively empty
      // stdout, scan the native antigravity CLI log for the real internal error
      // (e.g. GREP_SEARCH timeout → zero trajectory) instead of collapsing the
      // cycle into a generic gave_up.
      const agentInternalFailure: AgentInternalFailure | undefined =
        agentName === "agy" &&
        costPatch === undefined &&
        res.exitCode === 0 &&
        !res.timedOut
          ? detectAgyInternalFailure({
              agent: agentName,
              stdout: res.stdout,
              stderr: res.stderr,
              exitCode: res.exitCode,
              cycleStartSec: ctx.startSec,
            }) ?? undefined
          : undefined;
      return {
        event: { type: "agent_exited", exit: res.exitCode, timedOut: res.timedOut },
        // FIX-343 (step ①): persist the builder session id on the cycle context so
        // it survives to the attest gate (the scorer≠builder-session invariant is then
        // traceable to a recorded build-session id, not asserted).
        ctxPatch: {
          builderSessionId,
          ...(costPatch !== undefined ? { cost: costPatch } : {}),
          ...(usageUnknownReason !== undefined ? { usageUnknownReason } : {}),
          ...(agentInternalFailure !== undefined ? { agentInternalFailure } : {}),
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
      await quarantineMainCheckoutForCycle(ports, ctx, "capture");
      const commitsAhead = await ports.git.commitsAhead(ports.paths.worktreePath);
      let mainAhead = 0;
      try {
        mainAhead = await ports.git.mainAhead(ports.repoCwd);
      } catch {
        /* drift probe is best-effort */
      }
      const mainDirty = (await checkMainDirty(ports.repoCwd)).length > 0;
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
      const rawArtifactAttempts = new Map<string, number>();
      const savePeerRawOutput = (peer: string, stage: "score" | "review", stdout: string, stderr: string): string => {
        const key = `${peer}:${stage}`;
        const attempt = (rawArtifactAttempts.get(key) ?? 0) + 1;
        rawArtifactAttempts.set(key, attempt);
        const peerDir = join(dirname(ports.paths.eventsPath), "cycle-logs", ctx.cycleId ?? "cycle", "peer");
        mkdirSync(peerDir, { recursive: true });
        const artifactPath = join(peerDir, `${peer}.${stage}.attempt-${attempt}.raw.txt`);
        writeFileSync(artifactPath, `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`);
        return artifactPath;
      };
      // FIX-1056: enter cooldown ONLY after a genuine same-envelope auth-failure
      // streak reaches threshold ({@link authCooldownExclusions}) — a guardrail
      // against re-prompting a genuinely auth-blocked peer every cycle, NOT the
      // primary fix (that is agy's auth-context envelope in agent-spawn.ts). The
      // streak resets on ANY later success and `network` blocks never count, so a
      // once-blocked-then-re-authenticated peer recovers automatically. Each newly
      // cooled-down peer emits a VISIBLE `pair:excluded` (agent + cause auth +
      // failure count) so the owner sees WHY it stopped being consulted; the next
      // eligible candidate is swapped in by peerAvailable below. `excludedPeers`
      // stays the V4 fair no-op — only a live auth streak benches a peer.
      const computeAuthDiagnostics = (): Set<string> => {
        try {
          if (!existsSync(ports.paths.eventsPath)) return excludedPeers([]);
          const events = readFileSync(ports.paths.eventsPath, "utf8")
            .split("\n")
            .map(parseEventLine)
            .filter((e): e is RollEvent => e !== null);
          const cooldown = authCooldownExclusions(events);
          for (const [peer, failures] of cooldown) {
            ports.events.appendEvent(ports.paths.eventsPath, {
              type: "pair:excluded",
              cycleId: ctx.cycleId ?? "",
              agent: peer,
              cause: "auth",
              failures,
              ts: eventTs(ports),
            });
          }
          return new Set(cooldown.keys());
        } catch {
          return excludedPeers([]);
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
        const emitConsult = (
          outcome: "reviewed" | "timeout" | "error",
          cause?: "auth" | "network",
          detail?: string,
          artifactPath?: string,
        ): void =>
          ports.events.appendEvent(ports.paths.eventsPath, {
            type: "pair:consult",
            cycleId: ctx.cycleId ?? "",
            peer,
            durationMs: Date.now() - t0,
            outcome,
            ...(cause !== undefined ? { cause } : {}),
            ...(detail !== undefined ? { detail: detail.slice(0, 200) } : {}),
            ...(artifactPath !== undefined ? { artifactPath } : {}),
            ts: eventTs(ports),
          });
        let res;
        const credentialBlock = blockIfAgentCredentialsMissing(peer, "review", ports, ctx);
        if (credentialBlock !== null) {
          emitConsult("error", "auth", credentialBlock);
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
          const detail = e instanceof Error ? e.message : String(e);
          const cause = await attributeBlockCause(peer, "error", detail, "review");
          emitConsult("error", cause ?? undefined, detail);
          return null;
        }
        if (res === null || res.timedOut) {
          // FIX-363: a "timeout" is not always slowness. Attribute it — a silent
          // hang with no output spends ONE cheap reachability probe to tell a
          // blocked agent (re-login / VPN) from a genuinely slow one.
          const raw = res !== null ? `${res.stdout}\n${res.stderr}` : "";
          const artifactPath = res !== null ? savePeerRawOutput(peer, "review", res.stdout, res.stderr) : undefined;
          const cause = await attributeBlockCause(peer, "timeout", raw, "review");
          emitConsult("timeout", cause ?? undefined, artifactPath !== undefined ? "timeout; raw output saved" : "timeout", artifactPath);
          return null;
        }
        if (res.exitCode !== 0) {
          const raw = `${res.stdout}\n${res.stderr}`;
          const artifactPath = savePeerRawOutput(peer, "review", res.stdout, res.stderr);
          const cause = await attributeBlockCause(peer, "error", raw, "review");
          emitConsult("error", cause ?? undefined, `exit code ${res.exitCode}; raw output saved`, artifactPath);
          return null;
        }
        const vm = /VERDICT:\s*(agree|refine|object)/i.exec(res.stdout);
        if (vm === null) {
          const artifactPath = savePeerRawOutput(peer, "review", res.stdout, res.stderr);
          emitConsult("error", undefined, "unparseable: missing or invalid VERDICT line", artifactPath);
          return null;
        }
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
            const raw = res !== null ? `${res.stdout}\n${res.stderr}` : "";
            let artifactPath: string | undefined;
            if (res !== null) {
              artifactPath = savePeerRawOutput(peer, "score", res.stdout, res.stderr);
            }
            const blockCause = await attributeBlockCause(peer, "timeout", raw, "score");
            const detail = artifactPath !== undefined ? "timeout; raw output saved" : "timeout";
            // external block (auth/network) surfaced by attributeBlockCause → auth-block;
            // genuine slowness with no block signature → timeout.
            return blockCause === "auth" || blockCause === "network"
              ? { outcome: "auth-block", detail, artifactPath }
              : { outcome: "timeout", detail, artifactPath };
          }
          if (res.exitCode !== 0) {
            const raw = `${res.stdout}\n${res.stderr}`;
            const artifactPath = savePeerRawOutput(peer, "score", res.stdout, res.stderr);
            const blockCause = await attributeBlockCause(peer, "error", raw, "score");
            const detail = `exit code ${res.exitCode}; raw output saved`;
            return blockCause === "auth" || blockCause === "network"
              ? { outcome: "auth-block", detail, artifactPath }
              : { outcome: "exit-error", detail, artifactPath };
          }
          const diag = diagnosePairScoreOutput(res.stdout);
          if (!diag.ok) {
            // The reviewer ANSWERED but the format didn't match the strict
            // SCORE:/VERDICT:/RATIONALE: protocol — this is unparseable, NOT a
            // timeout/error. Previously silently discarded; now observable.
            // FIX-1045: carry the SPECIFIC reason + category so the role summary
            // can tell "returned score-like text but not accepted" from "no score
            // content returned" (beyond the generic "unparseable").
            const artifactPath = savePeerRawOutput(peer, "score", res.stdout, res.stderr);
            const detail =
              diag.category === "no-score-content"
                ? `no score content returned: ${diag.reason}`
                : `returned score-like text but not accepted: ${diag.reason}`;
            return { outcome: "unparseable", detail, artifactPath };
          }
          return { outcome: "parsed", parsed: { ...diag.score, cost: peerReviewCost(peer, res.stdout) } };
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
            // the story's intended evidence/focus, not just generic code quality.
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
      let attestRenderExitCode = 0;
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
          attestRenderExitCode = rc;
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
      // (verified/designed) can record evidence status + blocking findings.
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
          attestRenderExitCode,
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
      // US-V4-005: for verified/designed profiles, write the Evaluator artifact
      // (eval-report.md + artifact-manifest.json) into the run dir, ASSEMBLED from
      // the cycle's separate review/score/attest signals (never one pass/fail).
      // FAIL-CLOSED (US-V4-005): a malformed/missing evaluator artifact, or one
      // whose session is the builder's (self-grade), BLOCKS the cycle — it never
      // marks Done. US-V4-007: the bounded repair DECISION (decideRepair) frames
      // the Evaluator→Builder repair signal with a structured reason; the live
      // re-spawn loop that consumes a `repair` action is v4.1.
      let evaluatorBlocked = false;
      if (
        (ctx.selectedProfile === "verified" || ctx.selectedProfile === "designed") &&
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
      // US-V4-005: a verified/designed cycle with an invalid Evaluator artifact is
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
        ...(mainAhead > 0 || mainDirty
          ? { attemptedCwd: ports.repoCwd, expectedWorktreeCwd: ports.paths.worktreePath }
          : {}),
        ...(ctx.agentInternalFailure !== undefined ? { agentInternalFailure: ctx.agentInternalFailure } : {}),
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






// ── Node-backed Ports wiring (real infra) ─────────────────────────────────────

// Keep these referenced so resolveFallback / parseClaimedIds are not stripped by
// a too-eager tree-shaker in the test bundle (they document the available
// execution surface; nodePorts wires the common path).
export const _availableCoreSurface = {
  resolveFallback,
  parseClaimedIdsFromBacklog,
} as const;
