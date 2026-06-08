/**
 * US-PAIR-003 — Cross-Agent Pairing runtime gate (MVP walking skeleton).
 *
 * After a code-stage delivery, a heterogeneous peer (chosen by the US-PAIR-001
 * rational selector) ONE-WAY reviews the diff (A produces → B checks; no tmux
 * back-and-forth — peer/kimi/codex review of EVID-010 & PAIR-001 proved a single
 * pass already catches real bugs). The verdict lands as evidence (reusing the
 * peer-gate contract `<rt>/peer/cycle-<id>.pair.json`) + `pair:*` events.
 *
 * Hard invariants (pi pair-review): pairing NEVER fails or stalls a cycle —
 *   - 30s hard timeout on the peer review (deps.reviewPeer returns null on
 *     timeout/error), then we move on;
 *   - any throw is swallowed (status "error");
 *   - the cost is recorded in pair:verdict from day one, so the budget gate is
 *     never blind to pairing spend even before US-PAIR-005.
 * The peer spawn is an injected seam (deps.reviewPeer) so this is unit-tested
 * without launching real agents; the executor wires the real agentSpawn in.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePairingConfig, selectPairingCandidates, type PairingStage } from "@roll/core";
import { assessComplexity } from "./peer-gate.js";

export interface PairReview {
  verdict: "agree" | "refine" | "object";
  findings: string[];
  cost: number;
}

export type PairEvent =
  | { type: "pair:selected"; cycleId: string; workingAgent: string; peer: string; stage: string; ts: number }
  | { type: "pair:verdict"; cycleId: string; peer: string; verdict: PairReview["verdict"]; findings: number; cost: number; ts: number }
  | { type: "pair:none-available"; cycleId: string; stage: string; reason: string; ts: number };

export interface RunPairingDeps {
  /** Installed agents (canonical), e.g. agentsInstalled(realAgentEnv()). */
  installed: string[];
  /** Liveness probe over CANONICAL agent names. */
  isAvailable: (agent: string) => boolean;
  /** One-way review: the peer reads the diff and returns a structured verdict,
   *  or null on timeout/error. The 30s hard timeout lives in the implementation. */
  reviewPeer: (peer: string, diff: string, timeoutMs: number) => Promise<PairReview | null>;
  /** Changed files of the cycle (defaults to peer-gate's cycleChangedFiles). */
  changedFiles: (worktreeCwd: string) => Promise<string[]>;
  /** Full cycle diff the peer reviews. */
  diff: (worktreeCwd: string) => Promise<string>;
  event: (e: PairEvent) => void;
  now: () => number;
  /** Override the 30s default (tests). */
  timeoutMs?: number;
}

export interface RunPairingResult {
  status: "off" | "not-required" | "none-available" | "reviewed" | "timeout" | "error";
  peer?: string;
  verdict?: PairReview["verdict"];
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Run one pairing for a cycle. Returns a status (callers/tests assert on it);
 * all side-effects go through the injected event sink + evidence file. Never
 * throws — pairing is an enhancement, never a cycle blocker.
 */
export async function runPairing(
  projectDir: string,
  worktreeCwd: string,
  runtimeDir: string,
  cycleId: string,
  workingAgent: string,
  deps: RunPairingDeps,
): Promise<RunPairingResult> {
  const stage: PairingStage = "code"; // MVP: code only; other stages are US-PAIR-004.
  try {
    const cfgPath = join(projectDir, ".roll", "pairing.yaml");
    if (!existsSync(cfgPath)) return { status: "off" }; // file absent = pairing off
    const cfg = parsePairingConfig(readFileSync(cfgPath, "utf8"));
    if (!cfg.enabled || !cfg.stages.includes(stage)) return { status: "off" };

    // Only pair a delivery worth a second pair of eyes (align with peer-gate).
    const files = await deps.changedFiles(worktreeCwd);
    if (!assessComplexity(files).high) return { status: "not-required" };

    const candidates = selectPairingCandidates({
      installed: deps.installed,
      isAvailable: deps.isAvailable,
      workingAgent,
      stage,
      cfg,
      cycleId,
    });
    if (candidates.length === 0) {
      // fail-loud: no silent skip — the absence is itself an audited event.
      deps.event({ type: "pair:none-available", cycleId, stage, reason: "no qualified heterogeneous peer", ts: deps.now() });
      return { status: "none-available" };
    }

    const peer = candidates[0] as string;
    const diff = await deps.diff(worktreeCwd);
    // empty diff → nothing to review; don't waste a peer or emit a selected event (pi pair-review).
    if (diff.trim() === "") return { status: "not-required" };
    deps.event({ type: "pair:selected", cycleId, workingAgent, peer, stage, ts: deps.now() });

    const review = await deps.reviewPeer(peer, diff, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (review === null) return { status: "timeout", peer }; // non-blocking: move on

    const dir = join(runtimeDir, "peer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `cycle-${cycleId}.pair.json`),
      JSON.stringify({ cycleId, workingAgent, peer, stage, ...review }, null, 2),
      "utf8",
    );
    deps.event({ type: "pair:verdict", cycleId, peer, verdict: review.verdict, findings: review.findings.length, cost: review.cost, ts: deps.now() });
    return { status: "reviewed", peer, verdict: review.verdict };
  } catch {
    return { status: "error" }; // never throw — pairing must not fail the cycle
  }
}
