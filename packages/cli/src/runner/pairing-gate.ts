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
import { parsePairingConfig, selectPairingCandidates, type PairingHistory, type PairingStage } from "@roll/core";
import { writeSelfScoreNote } from "../lib/self-score.js";
import { assessComplexity } from "./peer-gate.js";

/**
 * US-PAIR-004 — the executor's stage-iteration seam. Reads `.roll/pairing.yaml`
 * and returns the stages pairing should fire at THIS cycle, in config order.
 * file-absent / disabled / malformed → `[]` (pairing off, never silent magic,
 * never throws — a broken config must not topple a cycle). Pure-ish (fs read +
 * parse) so the executor just maps `runPairing(stage, …)` over the result and
 * the iteration decision is unit-tested without a live git repo.
 */
export function enabledPairingStages(projectDir: string): PairingStage[] {
  try {
    const cfgPath = join(projectDir, ".roll", "pairing.yaml");
    if (!existsSync(cfgPath)) return [];
    const cfg = parsePairingConfig(readFileSync(cfgPath, "utf8"));
    if (!cfg.enabled) return [];
    // De-dupe (kimi pair-review): a config that repeats a stage must not fire it
    // twice — duplicate peer spawns, duplicate events, and a clobbered evidence
    // file. Keep first-seen order so the config still reads top-to-bottom.
    // US-PAIR-009 (kimi pair-review): `score` is NOT a review stage — it fires
    // post-attest via runScorePairing with its own prompt/protocol. Routing it
    // through the generic review loop would double-spawn a peer and clobber
    // the score evidence file with a pair:verdict.
    return cfg.stages.filter((s, i, arr) => arr.indexOf(s) === i && s !== "score");
  } catch {
    return []; // malformed config → pairing off, not a cycle failure
  }
}

/** Evidence path for a stage's verdict. `code` keeps the PAIR-003 legacy contract
 *  path (`cycle-<id>.pair.json`); other stages are namespaced so concurrent stages
 *  in one cycle never clobber each other. */
function evidencePath(runtimeDir: string, cycleId: string, stage: PairingStage): string {
  const dir = join(runtimeDir, "peer");
  const name = stage === "code" ? `cycle-${cycleId}.pair.json` : `cycle-${cycleId}.${stage}.pair.json`;
  return join(dir, name);
}

export interface PairReview {
  verdict: "agree" | "refine" | "object";
  findings: string[];
  cost: number;
}

export type PairEvent =
  | { type: "pair:selected"; cycleId: string; workingAgent: string; peer: string; stage: string; ts: number }
  | { type: "pair:verdict"; cycleId: string; peer: string; verdict: PairReview["verdict"]; findings: number; cost: number; stage: string; ts: number }
  | { type: "pair:score"; cycleId: string; peer: string; score: number; verdict: PairScore["verdict"]; cost: number; stage: "score"; ts: number }
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
  /**
   * US-PAIR-006 (optional): per-peer pairing track record from
   * {@link pairingHistory}. Drives the ε-greedy hit-rate preference in the
   * selector. Absent → pure seeded round-robin (US-PAIR-001 behaviour).
   */
  history?: PairingHistory;
  /** ε for the ε-greedy rotation (default 0.2). */
  epsilon?: number;
}

export interface RunPairingResult {
  status: "off" | "not-required" | "none-available" | "reviewed" | "timeout" | "error";
  peer?: string;
  verdict?: PairReview["verdict"];
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Run one pairing for a cycle AT A GIVEN STAGE. Returns a status (callers/tests
 * assert on it); all side-effects go through the injected event sink + evidence
 * file. Never throws — pairing is an enhancement, never a cycle blocker.
 *
 * US-PAIR-004: `stage` is now a parameter (was hardcoded `code`). The executor
 * iterates {@link enabledPairingStages} and calls this once per enabled stage,
 * each independently opt-out via pairing.yaml `stages`. All PAIR-003 invariants
 * (30s timeout, non-blocking, cost in events, file-absent=off) hold per stage.
 */
export async function runPairing(
  projectDir: string,
  worktreeCwd: string,
  runtimeDir: string,
  cycleId: string,
  workingAgent: string,
  stage: PairingStage,
  deps: RunPairingDeps,
): Promise<RunPairingResult> {
  try {
    if (stage === "score") return { status: "off" }; // belt-and-braces: score never routes through the review loop (US-PAIR-009)
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
      // US-PAIR-006: history-driven ε-greedy preference (no-op when absent).
      ...(deps.history !== undefined ? { history: deps.history } : {}),
      ...(deps.epsilon !== undefined ? { epsilon: deps.epsilon } : {}),
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

    const path = evidencePath(runtimeDir, cycleId, stage);
    mkdirSync(join(runtimeDir, "peer"), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ cycleId, workingAgent, peer, stage, ...review }, null, 2),
      "utf8",
    );
    deps.event({ type: "pair:verdict", cycleId, peer, verdict: review.verdict, findings: review.findings.length, cost: review.cost, stage, ts: deps.now() });
    return { status: "reviewed", peer, verdict: review.verdict };
  } catch {
    return { status: "error" }; // never throw — pairing must not fail the cycle
  }
}

// ── US-PAIR-009: score stage — the paired heterogeneous agent scores the cycle ─

/** A peer's structured score for a finished cycle (the self-score note shape). */
export interface PairScore {
  score: number;
  verdict: "good" | "ok" | "regression";
  rationale: string;
  cost: number;
}

export interface RunScorePairingDeps {
  /** Installed agents (canonical). */
  installed: string[];
  /** Liveness probe over CANONICAL agent names. */
  isAvailable: (agent: string) => boolean;
  /** The peer reads the delivery summary and returns a structured score, or
   *  null on timeout/error (the hard timeout lives in the implementation). */
  scorePeer: (peer: string, summary: string, timeoutMs: number) => Promise<PairScore | null>;
  event: (e: PairEvent) => void;
  now: () => number;
  timeoutMs?: number;
  history?: PairingHistory;
  epsilon?: number;
  /** Note-writer seam (tests); defaults to {@link writeSelfScoreNote}. */
  writeNote?: typeof writeSelfScoreNote;
}

export interface RunScorePairingResult {
  status: "off" | "none-available" | "scored" | "timeout" | "error";
  peer?: string;
  score?: number;
  notePath?: string;
}

/**
 * Run the score stage for a delivered cycle: a heterogeneous peer (US-PAIR-001
 * selector, stage "score") reads the delivery summary and produces the cycle's
 * score note — self-score is the FALLBACK, not the default (owner ruling
 * 2026-06-13: an agent grading its own delivery is a conflict of interest).
 *
 * All PAIR-003 invariants hold: never throws, never blocks the cycle, hard
 * timeout in scorePeer, absences are audited (`pair:none-available`). On any
 * non-"scored" status the caller's self-score path proceeds as before — the
 * note the working agent already wrote stays the effective score.
 *
 * Validation is delegated to the FIX-274 writer (score 1..10 integer, verdict
 * whitelist): the note is written BEFORE the evidence file, so a malformed peer
 * score aborts with nothing on disk (status "error"). Once the note IS written
 * the pairing counts as scored — the evidence file + event are best-effort
 * auxiliaries (kimi pair-review: a post-note evidence failure must not report
 * "error" with a live note on disk).
 */
export async function runScorePairing(
  projectDir: string,
  runtimeDir: string,
  cycleId: string,
  workingAgent: string,
  storyId: string,
  skill: string,
  summary: string,
  deps: RunScorePairingDeps,
): Promise<RunScorePairingResult> {
  try {
    const cfgPath = join(projectDir, ".roll", "pairing.yaml");
    if (!existsSync(cfgPath)) return { status: "off" }; // file absent = pairing off
    const cfg = parsePairingConfig(readFileSync(cfgPath, "utf8"));
    if (!cfg.enabled || !cfg.stages.includes("score")) return { status: "off" };

    const candidates = selectPairingCandidates({
      installed: deps.installed,
      isAvailable: deps.isAvailable,
      workingAgent,
      stage: "score",
      cfg,
      cycleId,
      ...(deps.history !== undefined ? { history: deps.history } : {}),
      ...(deps.epsilon !== undefined ? { epsilon: deps.epsilon } : {}),
    });
    if (candidates.length === 0) {
      deps.event({ type: "pair:none-available", cycleId, stage: "score", reason: "no qualified heterogeneous scorer", ts: deps.now() });
      return { status: "none-available" };
    }

    const peer = candidates[0] as string;
    deps.event({ type: "pair:selected", cycleId, workingAgent, peer, stage: "score", ts: deps.now() });

    const scored = await deps.scorePeer(peer, summary, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (scored === null) return { status: "timeout", peer }; // non-blocking: self-score stands

    // Note first (the writer is the validator): a bad peer payload throws here
    // and leaves NOTHING on disk — no evidence, no event, status "error".
    const note = (deps.writeNote ?? writeSelfScoreNote)(projectDir, {
      skill,
      story: storyId,
      score: scored.score,
      verdict: scored.verdict,
      rationale: scored.rationale,
      scoredBy: peer,
      scoring: "pair",
    });

    try {
      const path = evidencePath(runtimeDir, cycleId, "score");
      mkdirSync(join(runtimeDir, "peer"), { recursive: true });
      writeFileSync(
        path,
        JSON.stringify({ cycleId, workingAgent, peer, stage: "score", score: scored.score, verdict: scored.verdict, rationale: scored.rationale, cost: scored.cost }, null, 2),
        "utf8",
      );
      deps.event({ type: "pair:score", cycleId, peer, score: scored.score, verdict: scored.verdict, cost: scored.cost, stage: "score", ts: deps.now() });
    } catch {
      /* evidence/event are auxiliaries — the note is the product */
    }
    return { status: "scored", peer, score: scored.score, notePath: note.path };
  } catch {
    return { status: "error" }; // never throw — scoring must not fail the cycle
  }
}

/**
 * Parse a peer's score reply (the executor/manual command's stdout contract):
 * one `SCORE: <1..10>` line, one `VERDICT: good|ok|regression` line, one
 * `RATIONALE: <text>` line — anything missing/malformed → null (caller falls
 * back to self-score; a peer that can't follow the protocol never writes a note).
 */
export function parsePairScoreOutput(stdout: string): Omit<PairScore, "cost"> | null {
  const sm = /^\s*SCORE:\s*(\d{1,2})\s*$/im.exec(stdout);
  const vm = /^\s*VERDICT:\s*(good|ok|regression)\s*$/im.exec(stdout);
  const rm = /^\s*RATIONALE:\s*(.+)$/im.exec(stdout);
  if (sm?.[1] === undefined || vm?.[1] === undefined || rm?.[1] === undefined) return null;
  const score = Number(sm[1]);
  if (!Number.isInteger(score) || score < 1 || score > 10) return null;
  return { score, verdict: vm[1].toLowerCase() as PairScore["verdict"], rationale: rm[1].trim() };
}
