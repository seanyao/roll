import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { extractUsage, getAgentSpec, toCycleCost, type AgentInternalFailure, type CycleCommand, type CycleContext } from "@roll/core";
import type { CycleCost } from "@roll/spec";
import { agentSpawnEnvironment, type AgentSpawnOptions } from "./agent-spawn.js";
import { classifyBlockSignature, suspendRig } from "./agent-liveness.js";
import { applyMainCheckoutWriteProtection, releaseMainCheckoutWriteProtection, repairCoreWorktreeContamination } from "./main-checkout-guard.js";
import { recoverKimiUsage, recoverPiUsage } from "./usage-recovery.js";
import { blockIfAgentCredentialsMissing, detectAgyInternalFailure } from "./agent-routing.js";
import { buildLowScoreFixForwardPrompt, injectRepositoryContext, maybeInjectProjectMap } from "./project-map.js";
import { readProjectMapEnabled } from "./runner-policy.js";
import { appendWriteProtectionEvent, quarantineMainCheckoutForCycle, startMainCheckoutLeakWatchdog } from "./sandbox-boundary.js";
import { ActivitySignalRecorder, createCaptureMarkerSink, readCycleTimeoutThresholds, readStallThreshold, startCycleObserver, startRepositoryCycleObserver, startSpawnTimeoutWatchdog, startStallDetector } from "./spawn-observers.js";
import { persistWorktreeAlerts, submoduleAgentWritableRoots } from "./worktree-bootstrap.js";
import { runDesignerStage } from "./execution-profile.js";
import { eventTs, guardRuntimeDir } from "./runner-time.js";
import { readSkillBody } from "./skill-body.js";
import { resolveExecutionCwd, resolveExecutionRepoCwd } from "./submodule-worktree.js";
import { resolveIntegrationBranch } from "@roll/infra";
import type { ExecuteResult, Ports } from "./ports.js";
import {
  RepositoryObservationError,
  observeWritableRepositoryCommitCount,
} from "./repository-observation.js";

type SpawnAgentCommand = Extract<CycleCommand, { kind: "spawn_agent" }>;

function executionSkillBody(ports: Ports, storyId: string | undefined): string {
  if (!ports.skillBody.startsWith("# Roll Loop")) return ports.skillBody;
  const skillName = storyId?.startsWith("FIX-") || storyId?.startsWith("BUG-") ? "roll-fix" : "roll-build";
  return readSkillBody(ports.repoCwd, { skillName }) ?? ports.skillBody;
}

/** Apply the repository context resolved after Story pick. The spawn port itself
 * remains context-free; only the Builder command carrying the live CycleContext
 * can select the Issue root and authoritative repository prompt. */
export function applyRepositoryBuilderContext(
  ctx: CycleContext,
  options: AgentSpawnOptions,
): AgentSpawnOptions {
  const execution = ctx.repositoryExecution;
  if (execution === undefined) return options;
  return {
    ...options,
    cwd: execution.issueRoot,
    skillBody: injectRepositoryContext(options.skillBody, execution),
  };
}

export async function executeSpawnAgentCommand(
  cmd: SpawnAgentCommand,
  ports: Ports,
  ctx: CycleContext,
): Promise<ExecuteResult> {
  switch (cmd.kind) {
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
      // E4: a submodule cycle runs the BUILDER (and everything that observes it —
      // the cycle observer, the timeout watchdog's commit probe, the git env, the
      // post-spawn alert scoop, the session-store usage recovery) INSIDE the
      // submodule cycle worktree, where its edits/build/test/commits land and E2's
      // landing reads the HEAD. No targetSubmodule ⇒ ports.paths.worktreePath
      // (execRepoCwd ⇒ ports.repoCwd), byte-identical to today.
      const legacyExecCwd = resolveExecutionCwd(ports, ctx);
      const execCwd = ctx.repositoryExecution?.issueRoot ?? legacyExecCwd;
      const execRepoCwd = resolveExecutionRepoCwd(ports, ctx);
      // E8: the cycle observer and the timeout watchdog's commit probe count the
      // builder's commits against the EXECUTION repo's integration branch (the
      // submodule's own working branch), NOT the hardwired origin/main. A submodule
      // cycle worktree is detached off the submodule's integration branch and has
      // no origin/main, so `origin/main..HEAD` fataled → the observer saw zero
      // commits (no cycle:tcr events) and the watchdog's commitCount read 0. The
      // baseline is resolved from execRepoCwd, never the detached worktree. No
      // targetSubmodule ⇒ resolveIntegrationBranch(repoCwd) → origin/main default.
      const observeBase = ctx.repositoryExecution === undefined
        ? resolveIntegrationBranch(execRepoCwd)
        : undefined;
      await quarantineMainCheckoutForCycle(ports, ctx, "pre-spawn");
      const credentialBlock = blockIfAgentCredentialsMissing(cmd.agent, "build", ports, ctx);
      if (credentialBlock !== null) {
        const suspended = suspendRig(guardRuntimeDir(ports), cmd.agent, "auth", credentialBlock, eventTs(ports));
        ports.events.appendEvent(ports.paths.eventsPath, {
          type: "rig:suspended",
          cycleId: ctx.cycleId,
          agent: cmd.agent,
          cause: "auth",
          detail: credentialBlock,
          nextProbeAt: suspended.nextProbeAt ?? eventTs(ports),
          ts: eventTs(ports),
        });
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
      const observer = ctx.repositoryExecution === undefined
        ? await startCycleObserver(ports, ctx.cycleId ?? "", legacyExecCwd, observeBase)
        : await startRepositoryCycleObserver(ports, ctx);
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
      const repositoryPorts = ctx.repositoryExecution === undefined
        ? undefined
        : ports.repositories?.bind(ctx);
      if (ctx.repositoryExecution !== undefined && repositoryPorts === undefined) {
        throw new Error("missing_repository_ports");
      }
      const reportedCommitProbeFailures = new Set<string>();
      const timeoutWatchdog = startSpawnTimeoutWatchdog({
        cycleId: ctx.cycleId ?? "",
        thresholds: readCycleTimeoutThresholds(ports.repoCwd),
        clock: ports.clock,
        commitCount: repositoryPorts === undefined
          ? () => ports.git.commitsAhead(legacyExecCwd, observeBase)
          : () => observeWritableRepositoryCommitCount(ctx, repositoryPorts),
        ...(repositoryPorts === undefined ? {} : {
          onCommitProbeError: (error: unknown) => {
            const failure = error instanceof RepositoryObservationError ? error : undefined;
            const key = failure === undefined ? "unknown" : `${failure.repoId}:${failure.operation}`;
            if (reportedCommitProbeFailures.has(key)) return;
            reportedCommitProbeFailures.add(key);
            if (failure !== undefined) {
              repositoryPorts.events.append(failure.repoId, {
                type: "repository:observation_failed",
                operation: failure.operation,
                detail: failure.cause instanceof Error ? failure.cause.message : String(failure.cause ?? "unknown"),
                ts: Date.now(),
              });
            }
            ports.events.appendAlert(
              ports.paths.alertsPath,
              `repository_observation_failed: ${failure?.repoId ?? "unknown"}: ${failure?.operation ?? "commits_ahead"} (cycle ${ctx.cycleId ?? ""})`,
            );
          },
        }),
        appendEvent: (ev) => ports.events.appendEvent(ports.paths.eventsPath, ev),
      });
      // FIX-338 (Phase B 杠杆2): when `loop_safety.project_map: true`, PREPEND a
      // concise, bounded project map into the working agent's initial context so it
      // doesn't burn execute time on sed/rg exploration. Agent-agnostic (one prompt
      // body all shapes consume) + bounded (hard char cap). DEFAULT-OFF — a no-op
      // until flipped on, in which case `ports.skillBody` is sent unchanged.
      const skillBodyForSpawn = maybeInjectProjectMap(
        executionSkillBody(ports, ctx.storyId),
        // E4: map the tree the builder actually works in (the submodule for a
        // submodule cycle), not the superproject shell.
        execCwd,
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
      let activeMainLeak: { detected: boolean; files: string[] } = { detected: false, files: [] };
      let mainLeakWatchdog: ReturnType<typeof startMainCheckoutLeakWatchdog> | undefined;
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
        mainLeakWatchdog = startMainCheckoutLeakWatchdog(ports, ctx);
        res = await ports.agentSpawn(cmd.agent, applyRepositoryBuilderContext(ctx, {
          purpose: "builder",
          // E4: the builder runs in the submodule cycle worktree for a submodule
          // story (execCwd); its git env + writable roots target the submodule's
          // own repo/object store so its commits actually land there.
          cwd: execCwd,
          skillBody: finalSkillBody,
          ...(ctx.evidenceRunDir !== undefined ? { runDir: ctx.evidenceRunDir } : {}),
          writableRoots: submoduleAgentWritableRoots(ports.repoCwd, execRepoCwd, ports.paths.alertsPath),
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
        }));
      } finally {
        if (mainLeakWatchdog !== undefined) {
          activeMainLeak = await mainLeakWatchdog.stop();
        }
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
      // E4: scoop ALERT*.md the builder dropped in its OWN cwd (the submodule
      // cycle worktree for a submodule story).
      persistWorktreeAlerts(execCwd, ports.paths.alertsPath, ports.events);
      if (activeMainLeak.detected) {
        await quarantineMainCheckoutForCycle(ports, ctx, "active-spawn");
        res = { ...res, exitCode: res.exitCode === 0 ? 1 : res.exitCode, timedOut: true };
      } else {
        await quarantineMainCheckoutForCycle(ports, ctx, "post-spawn");
      }

      // FIX-1237: heal-at-every-boundary — repair core.worktree contamination
      // immediately after EVERY agent spawn completes, not just at pre-init
      // and terminal.  Catches any poisoning the agent did during its run so
      // sibling worktrees never see a poisoned config before the next step.
      {
        const repair = repairCoreWorktreeContamination(ports.repoCwd);
        if (repair.healed) {
          ports.events.appendEvent(ports.paths.eventsPath, {
            type: "cycle:cleanup",
            cycleId: ctx.cycleId ?? "",
            rule: "core.worktree",
            path: repair.detail,
            ok: true,
            ts: eventTs(ports),
          });
          ports.events.appendAlert(
            ports.paths.alertsPath,
            `FIX-1237: cycle ${ctx.cycleId ?? "?"} — core.worktree was pointing to "${repair.detail}" — auto-unset at post-spawn boundary`,
          );
        }
        const metaRepair = repairCoreWorktreeContamination(join(ports.repoCwd, ".roll"));
        if (metaRepair.healed) {
          ports.events.appendEvent(ports.paths.eventsPath, {
            type: "cycle:cleanup",
            cycleId: ctx.cycleId ?? "",
            rule: "roll-meta.core-worktree",
            path: metaRepair.detail,
            ok: true,
            ts: eventTs(ports),
          });
          ports.events.appendAlert(
            ports.paths.alertsPath,
            `FIX-1237: cycle ${ctx.cycleId ?? "?"} — roll-meta core.worktree was pointing to "${metaRepair.detail}" — auto-unset at post-spawn boundary`,
          );
        }
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
      if (builderBlock === "quota" || builderBlock === "auth" || builderBlock === "network") {
        const detail = (`${res.stdout}\n${res.stderr}`.split("\n").find((l) => l.trim() !== "") ?? "").slice(0, 200);
        ports.events.appendEvent(ports.paths.eventsPath, {
          type: "agent:blocked",
          cycleId: ctx.cycleId ?? "",
          agent: cmd.agent,
          cause: builderBlock,
          stage: "build",
          detail,
          ts: eventTs(ports),
        });
        const suspended = suspendRig(guardRuntimeDir(ports), cmd.agent, builderBlock, detail, eventTs(ports));
        ports.events.appendEvent(ports.paths.eventsPath, {
          type: "rig:suspended",
          cycleId: ctx.cycleId,
          agent: cmd.agent,
          cause: builderBlock,
          detail,
          nextProbeAt: suspended.nextProbeAt ?? eventTs(ports),
          ts: eventTs(ports),
        });
      } else if (activeMainLeak.detected) {
        // E7: the leak watchdog SIGKILL'd the agent for writing into the main
        // checkout. That kill folds into `res.timedOut` for teardown (above),
        // but it is NOT a timeout — report the accurate death cause so on-call
        // is not misdirected to a no-progress hunt. detail lists the leaked
        // (newDirty) paths for immediate diagnosis.
        const detail = `agent wrote outside its sandbox into the main checkout: ${activeMainLeak.files.join(", ")}`.slice(0, 200);
        const suspended = suspendRig(guardRuntimeDir(ports), cmd.agent, "main_checkout_leak", detail, eventTs(ports));
        ports.events.appendEvent(ports.paths.eventsPath, {
          type: "rig:suspended",
          cycleId: ctx.cycleId,
          agent: cmd.agent,
          cause: "main_checkout_leak",
          detail,
          nextProbeAt: suspended.nextProbeAt ?? eventTs(ports),
          ts: eventTs(ports),
        });
      } else if (res.timedOut) {
        const detail = "agent timed out with no progress";
        const suspended = suspendRig(guardRuntimeDir(ports), cmd.agent, "agent_stall", detail, eventTs(ports));
        ports.events.appendEvent(ports.paths.eventsPath, {
          type: "rig:suspended",
          cycleId: ctx.cycleId,
          agent: cmd.agent,
          cause: "agent_stall",
          detail,
          nextProbeAt: suspended.nextProbeAt ?? eventTs(ports),
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
          // E4: pi/kimi key their session store by the agent's CWD, so recover
          // from execCwd (where the builder actually ran) for a submodule cycle.
          usage = recoverPiUsage(
            execCwd,
            ctx.startSec,
            ...(rootOverride !== "" ? [rootOverride] : []),
          );
        }
        if (usage === null && usageSpec?.sessionRecovery === "kimi") {
          const rootOverride = (process.env["ROLL_KIMI_SESSIONS_DIR"] ?? "").trim();
          usage = recoverKimiUsage(
            execCwd,
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
            // FIX-1259: backfill a usage whose adapter could not read the model
            // (e.g. the reasonix footer) with the SPAWN model — the same value
            // cycle:start records — so runs.jsonl agrees with cycle:start.
            ...(ctx.model !== undefined && ctx.model !== "" ? { spawnModel: ctx.model } : {}),
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

  }
}
