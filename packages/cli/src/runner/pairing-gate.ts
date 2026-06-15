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
import { canonicalAgentName, isHeterogeneous, parsePairingConfig, selectPairingCandidates, type PairingHistory, type PairingStage } from "@roll/core";
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

// FIX-319: 30s was too short for a real heterogeneous review (a cold claude/kimi
// spawn that reads a diff + reasons + answers needs longer) — every hetero
// consult timed out → no peer evidence → the peer gate blocked delivery. Raised
// to 2min (owner's ≤3min peer-review policy). NOT final: pair:consult records
// each consult's real duration so this is tuned from data, not guessed.
const DEFAULT_TIMEOUT_MS = 120_000;

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

    const diff = await deps.diff(worktreeCwd);
    // empty diff → nothing to review; don't waste a peer or emit a selected event (pi pair-review).
    if (diff.trim() === "") return { status: "not-required" };

    // FIX-331: rotate through ranked candidates so one peer's transient unavailability (claude 5h limit / kimi cold-start timeout) doesn't sink the consult — upholds FIX-293 (still a real hetero verdict; whole pool failing still blocks).
    let lastTimeoutPeer: string | undefined;
    for (const candidate of candidates) {
      const peer = candidate as string;
      deps.event({ type: "pair:selected", cycleId, workingAgent, peer, stage, ts: deps.now() });
      const review = await deps.reviewPeer(peer, diff, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      if (review === null) {
        lastTimeoutPeer = peer; // non-blocking: rotate to the next candidate
        continue;
      }
      const path = evidencePath(runtimeDir, cycleId, stage);
      mkdirSync(join(runtimeDir, "peer"), { recursive: true });
      writeFileSync(
        path,
        JSON.stringify({ cycleId, workingAgent, peer, stage, ...review }, null, 2),
        "utf8",
      );
      deps.event({ type: "pair:verdict", cycleId, peer, verdict: review.verdict, findings: review.findings.length, cost: review.cost, stage, ts: deps.now() });
      return { status: "reviewed", peer, verdict: review.verdict };
    }
    // Whole candidate pool failed (timeout/error) → block (no real hetero verdict).
    return lastTimeoutPeer === undefined ? { status: "timeout" } : { status: "timeout", peer: lastTimeoutPeer };
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

    // FIX-331 (score stage): rotate through the ranked hetero candidates so a single
    // scorer's transient unavailability (e.g. kimi cold-start >120s timeout) doesn't
    // force the self-score fallback when other hetero scorers (pi/claude/…) are ready.
    // Self-score remains the FALLBACK (US-PAIR-009) ONLY when the WHOLE pool fails.
    let lastTimeoutPeer: string | undefined;
    for (const candidate of candidates) {
      const peer = candidate as string;
      deps.event({ type: "pair:selected", cycleId, workingAgent, peer, stage: "score", ts: deps.now() });

      const scored = await deps.scorePeer(peer, summary, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      if (scored === null) { lastTimeoutPeer = peer; continue; } // this scorer flaked — rotate to the next

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
    }
    // Whole scorer pool flaked (timeout/error) → self-score stands (US-PAIR-009 fallback).
    return lastTimeoutPeer === undefined ? { status: "timeout" } : { status: "timeout", peer: lastTimeoutPeer };
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

// ── FIX-293: the peer-gate retry consult ─────────────────────────────────────

export interface RetryPeerConsultDeps {
  /** Installed agents (canonical), e.g. agentsInstalled(realAgentEnv()). */
  installed: string[];
  /** The agent that did the work — its heterogeneous peer is the reviewer. */
  workingAgent: string;
  /** One-way review (the existing consult closure): the peer reads the diff and
   *  returns a verdict, or null on timeout/error. The 30s hard timeout lives in
   *  the implementation — this retry respects it (a flaky peer can't spiral). */
  reviewPeer: (peer: string, diff: string, timeoutMs: number) => Promise<PairReview | null>;
  /** Full cycle diff the peer reviews. */
  diff: (worktreeCwd: string) => Promise<string>;
  event: (e: PairEvent) => void;
  now: () => number;
  /** Override the 30s default (tests). */
  timeoutMs?: number;
}

export interface RetryPeerConsultResult {
  status: "none-available" | "reviewed" | "timeout" | "empty" | "error";
  peer?: string;
  /** true when no heterogeneous peer was installed and the reviewer fell back to
   *  a fresh SEPARATE-SESSION instance of the working agent's own type (still a
   *  distinct spawned process, never the builder's session). For diagnostics. */
  sameTypeFallback?: boolean;
}

/**
 * FIX-293 — re-attempt the peer consultation ONCE when the peer gate blocks a
 * high-complexity delivery that shipped with no peer review.
 *
 * Unlike {@link runPairing} this is NOT gated on `.roll/pairing.yaml`: the peer
 * gate is the always-on, agent-agnostic safety mechanism (pairing is the opt-in
 * enhancement), so the block-triggered retry must fire whether or not pairing is
 * configured. It runs the SAME `reviewPeer` consult path the pairing gate uses,
 * with the SAME 30s hard timeout, and on a real verdict writes the canonical
 * peer-gate evidence file (`<rt>/peer/cycle-<id>.pair.json`) so a re-run of the
 * gate sees evidence and unblocks. Never throws — the retry is a best-effort
 * rescue, not a new way to topple a cycle.
 *
 * FIX-293 follow-up (owner ruling) — reviewer allocation by the cross-agent
 * strategy, with precedence:
 *   1. Heterogeneous peer PREFERRED — the first different-vendor installed agent
 *      (registry order, so the choice is deterministic, no `if agent==='x'`).
 *   2. FALLBACK: the working agent's OWN canonical type — `reviewPeer` spawns it
 *      as a FRESH, SEPARATE-SESSION subprocess (ports.agentSpawn always forks a
 *      new process), so a single-coding-agent environment is no longer
 *      permanently blocked. A different instance of the same type is acceptable.
 *   3. THE RED LINE: the reviewer is ALWAYS a separately-spawned session — never
 *      the builder's own session self-scoring its own work. The builder is the
 *      executor process; `reviewPeer` → `ports.agentSpawn` is a distinct child,
 *      so same-type here is a separate session, never in-session self-review.
 *   4. BLOCK only when even that separate-session consult yields no evidence
 *      (timeout / error / empty diff). With the same-type fallback "no peer at
 *      all" is rare — the block becomes "the separate-session review produced no
 *      evidence", not "no heterogeneous agent installed".
 *
 * Agent-agnostic by construction: the allocation (heterogeneous-preferred,
 * same-type-fallback) lives here in the normalization layer; the gate downstream
 * keys only on "separate-session peer evidence present?", with no per-agent
 * special-casing.
 */
export async function retryPeerConsult(
  worktreeCwd: string,
  runtimeDir: string,
  cycleId: string,
  deps: RetryPeerConsultDeps,
): Promise<RetryPeerConsultResult> {
  try {
    const working = canonicalAgentName(deps.workingAgent);
    const distinct = deps.installed
      .map(canonicalAgentName)
      .filter((a, i, arr) => arr.indexOf(a) === i);
    // FIX-331 (+ codex peer-review): rotate through EVERY heterogeneous peer so one
    // peer's transient unavailability (claude 5h limit / kimi cold-start timeout)
    // doesn't sink the consult. Upholds FIX-293's HARD gate:
    //   • heterogeneous peers PREFERRED — when ANY exist we rotate through them
    //     ONLY and BLOCK if they all fail; a wholly-failing hetero pool must NOT
    //     degrade to a same-type / self review (that would weaken the gate).
    //   • the same-type SEPARATE-SESSION fallback fires ONLY when zero hetero peers
    //     are installed (single-vendor env — FIX-293's "not permanently blocked"):
    //     still a fresh distinct subprocess, never the builder's own session.
    const heteroPeers = distinct.filter((a) => a !== working && isHeterogeneous(a, working));
    const tryOrder: { peer: string; sameTypeFallback: boolean }[] =
      heteroPeers.length > 0
        ? heteroPeers.map((p) => ({ peer: p, sameTypeFallback: false }))
        : working !== ""
          ? [{ peer: working, sameTypeFallback: true }]
          : [];
    // The only true "no peer to consult" case: we don't even know the working
    // agent's type (no installed agent AND no working-agent name) — there is
    // nothing to spawn a separate session of. This is now rare (it is NOT "only
    // one vendor installed"); audited as a fail-loud absence.
    if (tryOrder.length === 0) {
      deps.event({ type: "pair:none-available", cycleId, stage: "code", reason: "peer-gate retry: no peer could be consulted (no agent to spawn a separate-session review)", ts: deps.now() });
      return { status: "none-available" };
    }
    const diff = await deps.diff(worktreeCwd);
    if (diff.trim() === "") return { status: "empty" };

    let lastPeer: string | undefined;
    let lastSameType = false;
    for (const { peer, sameTypeFallback } of tryOrder) {
      deps.event({ type: "pair:selected", cycleId, workingAgent: working, peer, stage: "code", ts: deps.now() });
      const review = await deps.reviewPeer(peer, diff, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      if (review === null) {
        lastPeer = peer; // flaky/unavailable peer — rotate to the next in the ordered pool
        lastSameType = sameTypeFallback;
        continue;
      }
      const path = evidencePath(runtimeDir, cycleId, "code");
      mkdirSync(join(runtimeDir, "peer"), { recursive: true });
      writeFileSync(path, JSON.stringify({ cycleId, workingAgent: working, peer, stage: "code", sameTypeFallback, ...review }, null, 2), "utf8");
      deps.event({ type: "pair:verdict", cycleId, peer, verdict: review.verdict, findings: review.findings.length, cost: review.cost, stage: "code", ts: deps.now() });
      return { status: "reviewed", peer, sameTypeFallback };
    }
    // Whole ordered pool failed (timeout/error) → stays blocked, no death-spiral.
    return lastPeer === undefined
      ? { status: "timeout", sameTypeFallback: lastSameType }
      : { status: "timeout", peer: lastPeer, sameTypeFallback: lastSameType };
  } catch {
    return { status: "error" }; // never throw — the retry is a rescue, not a cycle killer
  }
}

/** The score-stage prompt (shared by the loop executor and `roll pair score`). */
export function buildPairScorePrompt(summary: string): string {
  return (
    `You are a heterogeneous PAIRING scorer. A different agent delivered the cycle below; ` +
    `grade the delivery quality honestly (root-cause depth, test coverage, scope discipline, evidence). ` +
    `Reply with exactly one "SCORE: <integer 1..10>" line, one "VERDICT: good|ok|regression" line, ` +
    `and one "RATIONALE: <one sentence>" line.\n\nDELIVERY:\n` +
    summary
  );
}
