import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  DEFAULT_MAX_REPAIR_ROUNDS,
  EventBus,
  agentsInstalled,
  cycleActivityFromEvents,
  decideRepair,
  heteroAvailable,
  initialRepairState,
  pairingHistory,
  peerReviewCost,
  type CapturedFacts,
  type CycleCommand,
  type CycleContext,
} from "@roll/core";
import { parseEventLine, type CycleActivityEvent, type RollEvent } from "@roll/spec";
import { realAgentEnv } from "../commands/agent-list.js";
import { cardArchiveDir } from "../lib/archive.js";
import { formatEvaluationContractForScorer, parseEvaluationContract } from "../lib/evaluation-contract.js";
import { blockIfAgentCredentialsMissing, projectAllowedAgents } from "./agent-routing.js";
import { readAttestGateMode, runAttestGate, storySpecPath, verificationReportHasContent } from "./attest-gate.js";
import {
  ACMAP_REMEDIATION_TIMEOUT_MS,
  acMapPath,
  autoAttachScreenshotToAcMap,
  buildAcMapRemediationPrompt,
  generateAcMapDraft,
  needsAcMapRemediation,
  writeAcMapDraftEvidenceFiles,
  type DraftEvidence,
} from "./attest-remediation.js";
import { applyCorrectionAction } from "./correction-actuator.js";
import { writeEvaluatorArtifact } from "./execution-profile.js";
import { checkMainDirty } from "./main-checkout-guard.js";
import {
  buildPairScorePrompt,
  diagnosePairScoreOutput,
  enabledPairingStages,
  retryPeerConsult,
  runPairing,
  runScorePairing,
  type PairEvent,
  type PairScore,
} from "./pairing-gate.js";
import { cycleChangedFiles, peerEvidencePresent, readPeerGateMode, runPeerGate } from "./peer-gate.js";
import { createCapturePeerHelpers } from "./capture-peer-helpers.js";
import type { ExecuteResult, Ports } from "./ports.js";
import { eventTs } from "./runner-time.js";
import { quarantineMainCheckoutForCycle } from "./sandbox-boundary.js";

const execFileAsync = promisify(execFile);

type CaptureFactsCommand = Extract<CycleCommand, { kind: "capture_facts" }>;

export async function executeCaptureFactsCommand(
  cmd: CaptureFactsCommand,
  ports: Ports,
  ctx: CycleContext,
): Promise<ExecuteResult> {
  void cmd;
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
      const { attributeBlockCause, savePeerRawOutput, peerAvailable, reviewPeer, cycleDiff } = createCapturePeerHelpers({
        ports,
        ctx,
        commitsAhead,
        tcrCount,
      });
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
          | { outcome: "parsed"; parsed: PairScore }
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
        const scorePeer = async (peer: string, summary: string, timeoutMs: number): Promise<PairScore | null> => {
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
