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
import { agentCanReviewHeadless, canonicalAgentName, isHeterogeneous, parsePairingConfig, parseResizeSignal, selectPairingCandidates, type PairingHistory, type PairingStage, type ResizeSignal } from "@roll/core";
import { writeReviewScoreNote } from "../lib/review-score.js";
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
  | { type: "pair:selected"; cycleId: string; workingAgent: string; peer: string; stage: string; timeoutMs?: number; ts: number }
  | { type: "pair:verdict"; cycleId: string; peer: string; verdict: PairReview["verdict"]; findings: number; cost: number; stage: string; ts: number }
  | { type: "pair:score"; cycleId: string; peer: string; score: number; verdict: PairScore["verdict"]; cost: number; stage: "score" | "design"; ts: number }
  | { type: "pair:none-available"; cycleId: string; stage: string; reason: string; ts: number }
  /** FIX-910 — per-attempt score-stage failure attribution. Every null return
   *  from a scorer is now diagnosed (unparseable / timeout / auth-block /
   *  exit-error) and emitted so the loop can observe WHY a pool failed;
   *  no more silently swallowed nulls. */
  | { type: "pair:score-failure"; cycleId: string; peer: string; cause: "unparseable" | "timeout" | "auth-block" | "exit-error"; detail?: string; stage: "score" | "design"; ts: number };

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

// FIX-363: the review timeout is now data-tuned (the comment's "tuned from data,
// not guessed" promise, kept). The `pair:consult` history shows successful hetero
// reviews tail out to ~116s while ALL 55 timeouts landed EXACTLY at the 120s cap —
// i.e. 120s was CLIPPING the duration distribution, not catching genuine hangs. A
// 14-file/60K-char cross-module diff (FIX-356b) timed out all three reviewers at
// ~120004ms twice, blocking a delivery the builder had gotten right. So the budget
// scales with diff size, within the owner's ≤3min default / ≤5min complex policy:
//   • small/normal diff → 180s (3min) — the policy floor; was 120s, below policy.
//   • large/cross-module diff (≥20K chars) → 300s (5min) — the policy ceiling.
// Fail-loud is unchanged: a whole pool that still flakes within the (now adequate)
// budget BLOCKS — the gate is never weakened, reviewers are just given honest time.
const REVIEW_TIMEOUT_BASE_MS = 180_000;
const REVIEW_TIMEOUT_LARGE_MS = 300_000;
const REVIEW_LARGE_DIFF_CHARS = 20_000;

/**
 * FIX-363 — the peer-review wall-clock budget for a diff of `diffChars` length.
 * Two tiers (not three: the cycle diff is capped at 60K upstream, so finer
 * bucketing buys nothing): normal diffs get the 3min policy floor, large/
 * cross-module diffs (≥20K chars) get the 5min policy ceiling. The SCORE stage
 * does NOT use this — it scores a tiny `--stat` summary, never the full diff,
 * so it keeps its own flat budget ({@link SCORE_TIMEOUT_MS}).
 */
export function reviewTimeoutMs(diffChars: number): number {
  return diffChars >= REVIEW_LARGE_DIFF_CHARS ? REVIEW_TIMEOUT_LARGE_MS : REVIEW_TIMEOUT_BASE_MS;
}

/**
 * FIX-335 AC3 — parallel take-first: resolve with the FIRST promise that yields
 * a non-null value, discarding the rest. Preserves the serial semantics exactly,
 * just concurrently:
 *   - the FIRST non-null result wins immediately (later results are dropped, so
 *     evidence/events are only written for the winner);
 *   - a single promise REJECTING is tolerated — it must not sink a sibling that
 *     is still about to win (a flaky peer ≠ the whole consult failing);
 *   - all settled with NO winner → resolve null  → caller maps to "timeout"/block
 *     (the serial "whole pool failed" path);
 *   - …UNLESS at least one rejected → RE-THROW → caller's outer try/catch maps to
 *     status "error", matching the legacy serial behaviour where a thrown
 *     reviewPeer/scorePeer short-circuited to "error" (a broken probe is a defect,
 *     not a benign timeout).
 *
 * Why not Promise.race: race resolves on the first SETTLE, so a fast null/throw
 * would beat a slower real verdict. We want the first VALID (non-null) result.
 */
async function firstValid<T>(promises: Promise<T | null>[]): Promise<T | null> {
  if (promises.length === 0) return null;
  return new Promise<T | null>((resolve, reject) => {
    let pending = promises.length;
    let settled = false;
    let lastError: unknown;
    let threw = false;
    const onNonResult = (): void => {
      pending -= 1;
      if (pending === 0 && !settled) {
        settled = true;
        // No winner anywhere: a thrown probe ⇒ "error" (re-throw), else a clean
        // all-null pool ⇒ "timeout" (resolve null).
        if (threw) reject(lastError);
        else resolve(null);
      }
    };
    for (const p of promises) {
      p.then(
        (value) => {
          if (settled) return;
          if (value !== null) {
            settled = true;
            resolve(value); // first valid wins; siblings are discarded
            return;
          }
          onNonResult();
        },
        (err) => {
          // a rejected probe never sinks a sibling that may still win — only the
          // wholly-failing pool surfaces the error.
          if (settled) return;
          threw = true;
          lastError = err;
          onNonResult();
        },
      );
    }
  });
}

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

    // FIX-335 AC3: PARALLEL take-first. Fire every ranked candidate's review at
    // once and use the FIRST that returns a non-null verdict; the rest are
    // discarded. Upholds FIX-293/FIX-331 semantics (still a real hetero verdict;
    // the WHOLE pool failing still blocks) — only the dispatch is now concurrent
    // instead of serial, so claude+pi+kimi reviews overlap rather than stack.
    // FIX-363: budget scales with the diff the peer must actually read.
    const timeoutMs = deps.timeoutMs ?? reviewTimeoutMs(diff.length);
    const probes = candidates.map(async (candidate) => {
      const peer = candidate as string;
      // Each candidate still emits a selected event (now possibly several in
      // flight — acceptable per FIX-335: one selected per consult, one verdict
      // for the winner). Tag the result with its peer so the winner is known.
      // FIX-363: record the budget this consult was given so it stays data-tunable.
      deps.event({ type: "pair:selected", cycleId, workingAgent, peer, stage, timeoutMs, ts: deps.now() });
      const review = await deps.reviewPeer(peer, diff, timeoutMs);
      return review === null ? null : { peer, review };
    });
    const winner = await firstValid(probes);
    if (winner === null) {
      // Whole candidate pool failed (timeout/error) → block (no real hetero verdict).
      return { status: "timeout" };
    }
    const { peer, review } = winner;
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

/** A peer Reviewer's structured score for a finished cycle (the Review Score note shape). */
export interface PairScore {
  score: number;
  verdict: "good" | "ok" | "regression";
  rationale: string;
  cost: number;
  /** US-AGENT-041: the reviewer's optional "scope too large" signal — present
   *  only when the delivery is incomplete because the SCOPE exceeds one cycle
   *  (uncovered AC/coverage gaps), not a pure quality problem. Drives the
   *  post-cycle review-triggered self-downgrade. */
  resize?: ResizeSignal;
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
  /** Note-writer seam (tests); defaults to {@link writeReviewScoreNote}. */
  writeNote?: typeof writeReviewScoreNote;
  /**
   * FIX-344 — the label the `pair:score` event, the reviewer session-id prefix,
   * and the evidence filename carry. Defaults to `"score"` (a build/fix loop
   * cycle's Review Score). `"design"` marks the roll-design peer Review Score
   * path: roll-design has NO loop cycle, so its independent score is triggered at
   * skill wrap-up and stamped `stage: "design"` so it is distinguishable in the
   * shared event stream. Candidate SELECTION is unchanged — both routes use the
   * mandatory same-vendor-fallback `"score"` selector (independence = a fresh
   * separately-spawned session, never vendor heterogeneity), so the design path
   * is NOT a new selection mode, only a distinct label + scoring prompt.
   */
  scoreStage?: "score" | "design";
}

export interface RunScorePairingResult {
  // FIX-343 (step ④): the score stage is MANDATORY — there is no "off". A
  // non-"scored" status (none-available / timeout / error) is fail-loud and
  // BLOCKS the cycle (the attest gate then has no peer score to honor).
  status: "none-available" | "scored" | "timeout" | "error";
  peer?: string;
  score?: number;
  notePath?: string;
  /** The reviewer's fresh session/cast id recorded on the note (independence
   *  is verifiable, not asserted). Present on a "scored" result. */
  sessionId?: string;
}

/** FIX-343 (step ④): the per-attempt score timeout and the bounded retry budget
 *  (1 retry ⇒ 2 attempts max). A score-stage flake is an HONEST failure, not a
 *  fallback — the retry only reduces flake-driven false negatives.
 *  FIX-363: raised 120s → 180s to match the owner's ≤3min peer-review policy floor
 *  (the FIX-356b incident timed out the score reviewers too). This is a FLAT bump,
 *  NOT diff-scaled: the scorer reads a tiny `--stat` summary (≤4K), never the full
 *  diff, so it needs headroom for cold-spawn + reasoning, not for diff length. */
const SCORE_TIMEOUT_MS = 180_000;
const SCORE_MAX_ATTEMPTS = 2; // 1 initial + 1 bounded retry

/**
 * FIX-343 (step ④) — the score stage is the SOLE, MANDATORY producer of the
 * cycle's Review Score: a fresh-session peer reads the delivery summary and
 * writes the `scoring: pair` Review Score note. The working agent NEVER grades its own work.
 *
 *   • MANDATORY: NOT gated on `.roll/pairing.yaml` (enabled / stages⊇score). A
 *     delivery always owes a Review Score; the executor calls this every cycle.
 *   • SAME-VENDOR fresh session qualifies (selectPairingCandidates stage="score"
 *     drops the heterogeneity filter) — independence = a separately spawned
 *     fresh session (ports.agentSpawn forks a distinct subprocess), incl. a
 *     fresh instance of the builder's own type. NOT vendor heterogeneity.
 *   • FAIL-LOUD: no-winner / timeout / error → a non-"scored" status that
 *     BLOCKS (no synthesized fallback note). The attest gate then fails on
 *     "missing peer review score" and the cycle honestly fails.
 *   • The note records `scoring: pair` + `scored-by` + a unique `session-id`
 *     (the reviewer's fresh session/cast id) so independence is VERIFIABLE.
 *   • 1 bounded retry @ 120s/attempt to shave flake-driven honest failures.
 *
 * Validation is delegated to the FIX-274 writer (score 1..10 integer, verdict
 * whitelist): the note is written BEFORE the evidence file, so a malformed peer
 * score aborts with nothing on disk (status "error"). Once the note IS written
 * the pairing counts as scored — the evidence file + event are best-effort.
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
    // FIX-344: the OBSERVABILITY label (event/session-id/evidence file). Defaults
    // to "score" (a loop cycle's Review Score); "design" marks the no-cycle
    // roll-design path. Candidate SELECTION below is unchanged — it always uses
    // the mandatory "score" selector, so the design path reuses FIX-343's
    // independence machinery verbatim (fresh separate session, same-vendor
    // fallback), only the label differs.
    const scoreStage = deps.scoreStage ?? "score";
    // FIX-343 (step ④): MANDATORY — read pairing.yaml only for history/epsilon
    // nuance; its enabled/stages flags NO LONGER gate scoring. The "score"
    // selector ignores cfg gating anyway (it is stage-aware), so a synthesized
    // minimal cfg is sufficient when no config exists.
    const cfgPath = join(projectDir, ".roll", "pairing.yaml");
    const cfg = existsSync(cfgPath)
      ? parsePairingConfig(readFileSync(cfgPath, "utf8"))
      : { enabled: true, stages: ["score"] as PairingStage[], capability: {} };

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
      // Fail-loud: no scorer to spawn a fresh session of → BLOCK (no fallback).
      deps.event({ type: "pair:none-available", cycleId, stage: scoreStage, reason: "no scorer available to spawn a fresh review session", ts: deps.now() });
      return { status: "none-available" };
    }

    const timeoutMs = deps.timeoutMs ?? SCORE_TIMEOUT_MS;
    // FIX-343 (② BOUNDED hetero preference): selectPairingCandidates already
    // ranks hetero-first, but at RUNTIME firstValid takes the FIRST responder, so
    // a same-vendor scorer that replies before a live hetero peer would win — the
    // hetero-first ordering was decorative. Make the preference REAL: split the
    // pool by vendor and run firstValid over the HETERO subset FIRST; only when
    // hetero is EMPTY or wholly fails (all-null/throw) within the SAME bounded
    // budget do we FALL BACK to the same-vendor subset. Prefer hetero → fall back
    // to same-vendor-fresh → NEVER hang (each round is bounded by the per-attempt
    // timeout + the 1-retry cap). Same-vendor-fresh still PASSES the gate (owner
    // minimum). A single-vendor install has an EMPTY hetero subset → it goes
    // straight to the same-vendor round (no wasted hetero wait).
    // C2 (FIX-343): guard the empty workingAgent label split so the bucketing
    // matches core/agent/pairing.ts selectPairingCandidates (which buckets ALL
    // candidates as same-vendor when `working === ""` — heterogeneity is
    // undefined without a known builder). `isHeterogeneous(c, "")` would
    // otherwise mark every real-vendor candidate "hetero", mislabeling the
    // telemetry round. Empty builder ⇒ everything is the same-vendor round.
    const builder = workingAgent.trim();
    const heteroPool = builder === "" ? [] : candidates.filter((c) => isHeterogeneous(c as string, builder));
    const sameVendorPool = builder === "" ? candidates : candidates.filter((c) => !isHeterogeneous(c as string, builder));

    // 1 bounded retry PER ROUND. Each attempt fires the round's pool in PARALLEL
    // (FIX-335 take-first) and uses the FIRST non-null score; the rest are
    // discarded. A wholly-flaking round retries ONCE (no death-spiral). The
    // reviewer's fresh session/cast id is minted per attempt so independence is
    // recorded on the note, not asserted.
    //
    // C1 (FIX-343): `coerceThrowToNull` makes a round's all-throw degrade to a
    // null (no winner) INSTEAD of propagating. The HETERO round is run with
    // coercion ON so a throwing hetero scorePeer falls THROUGH to the same-vendor
    // round (matching the comment "hetero EMPTY or wholly fails (all-null/throw) →
    // FALL BACK to same-vendor"). The TERMINAL (same-vendor) round keeps coercion
    // OFF: there is nothing left to fall back to, so a broken probe stays a defect
    // (firstValid re-throws → outer catch → status "error"), per FIX-335.
    type ScoreWinner = { peer: string; scored: PairScore; sessionId: string };
    const runRound = async (pool: string[], coerceThrowToNull: boolean): Promise<ScoreWinner | null> => {
      if (pool.length === 0) return null; // empty pool → no winner (no spawn, no wait)
      let w: ScoreWinner | null = null;
      for (let attempt = 1; attempt <= SCORE_MAX_ATTEMPTS && w === null; attempt++) {
        const probes = pool.map(async (candidate) => {
          const peer = candidate;
          // FIX-344: the session-id prefix carries the score-stage label so a
          // design score's session is `${cycleId}:design:...` (distinguishable
          // from a cycle's `${cycleId}:score:...`); both remain a unique,
          // verifiably-independent fresh session id on the note.
          const sessionId = `${cycleId}:${scoreStage}:${peer}:a${attempt}:${deps.now()}`;
          deps.event({ type: "pair:selected", cycleId, workingAgent, peer, stage: scoreStage, timeoutMs, ts: deps.now() });
          const scored = await deps.scorePeer(peer, summary, timeoutMs);
          return scored === null ? null : { peer, scored, sessionId };
        });
        if (coerceThrowToNull) {
          try {
            w = await firstValid(probes);
          } catch {
            w = null; // a wholly-throwing hetero round → fall through to same-vendor
          }
        } else {
          w = await firstValid(probes);
        }
      }
      return w;
    };

    // Hetero FIRST (throws coerced → fall through); fall back to same-vendor only
    // when hetero is absent or wholly fails.
    let winner = await runRound(heteroPool, true);
    if (winner === null) winner = await runRound(sameVendorPool, false);
    if (winner === null) {
      // FIX-911 — pool-level escalation: before giving up, try ANY reachable
      // reviewer that was NOT in the candidate pool (excluded by isAvailable
      // probe) but IS installed + headless-capable. The probe can miss a
      // genuinely reachable peer (transient timeout, stale auth state); this
      // escalation gives them one more chance with a hard budget cap to avoid
      // death-spiralling on genuinely dead peers.
      const triedPeers = new Set([...heteroPool, ...sameVendorPool].map(canonicalAgentName));
      const allHeadless = deps.installed
        .map(canonicalAgentName)
        .filter((a, i, arr) => arr.indexOf(a) === i)
        .filter((a) => agentCanReviewHeadless(a));
      const escalationPool = allHeadless.filter((a) => !triedPeers.has(a));
      if (escalationPool.length > 0) {
        // Serial dispatch — we are budget-conscious and only need ONE score.
        // Parallel firstValid here would burn all candidates at once with no
        // budget awareness, and a fast-failing auth-block would waste a slot.
        const ESCALATION_MAX_ROUNDS = 2; // hard cap on escalation attempts
        const rounds = Math.min(ESCALATION_MAX_ROUNDS, escalationPool.length);
        for (let i = 0; i < rounds && winner === null; i++) {
          const peer = escalationPool[i] as string;
          // Single-peer round (escalation is serial, not parallel). Reuse the
          // same SCORE_MAX_ATTEMPTS budget per peer so a single flake doesn't
          // kill the round, but a dead peer doesn't spiral either.
          const singlePool = [peer];
          // coerceThrowToNull=false: the escalation is the last resort, so a
          // broken probe (throw) is a defect → status "error", per FIX-335.
          winner = await runRound(singlePool, false);
        }
      }
    }
    if (winner === null) {
      // All rounds (hetero, same-vendor, escalation) exhausted → honest timeout, BLOCK.
      return { status: "timeout" };
    }
    const { peer, scored, sessionId } = winner;

    // Note first (the writer is the validator): a bad peer payload throws here
    // and leaves NOTHING on disk — no evidence, no event, status "error".
    const note = (deps.writeNote ?? writeReviewScoreNote)(projectDir, {
      skill,
      story: storyId,
      score: scored.score,
      verdict: scored.verdict,
      rationale: scored.rationale,
      scoredBy: peer,
      scoring: "pair",
      sessionId,
      // US-AGENT-041: persist the reviewer's scope-resize signal (if any) so the
      // post-cycle review-resize trigger can act on it.
      ...(scored.resize !== undefined ? { resize: scored.resize } : {}),
    });

    try {
      const path = evidencePath(runtimeDir, cycleId, scoreStage);
      mkdirSync(join(runtimeDir, "peer"), { recursive: true });
      writeFileSync(
        path,
        JSON.stringify({ cycleId, workingAgent, peer, stage: scoreStage, score: scored.score, verdict: scored.verdict, rationale: scored.rationale, cost: scored.cost, sessionId }, null, 2),
        "utf8",
      );
      deps.event({ type: "pair:score", cycleId, peer, score: scored.score, verdict: scored.verdict, cost: scored.cost, stage: scoreStage, ts: deps.now() });
    } catch {
      /* evidence/event are auxiliaries — the note is the product */
    }
    return { status: "scored", peer, score: scored.score, notePath: note.path, sessionId };
  } catch {
    return { status: "error" }; // never throw — scoring must not fail the cycle
  }
}

/**
 * Parse a peer's score reply (the executor/manual command's stdout contract):
 * one `SCORE: <1..10>` line, one `VERDICT: good|ok|regression` line, one
 * `RATIONALE: <text>` line — anything missing/malformed → null (the round
 * treats it as no-score; a peer that can't follow the protocol never writes a note).
 */
export function parsePairScoreOutput(stdout: string): Omit<PairScore, "cost"> | null {
  const sm = /^\s*SCORE:\s*(\d{1,2})\s*$/im.exec(stdout);
  const vm = /^\s*VERDICT:\s*(good|ok|regression)\s*$/im.exec(stdout);
  const rm = /^\s*RATIONALE:\s*(.+)$/im.exec(stdout);
  if (sm?.[1] === undefined || vm?.[1] === undefined || rm?.[1] === undefined) return null;
  const score = Number(sm[1]);
  if (!Number.isInteger(score) || score < 1 || score > 10) return null;
  // US-AGENT-041: capture an optional RESIZE/GAPS signal (scope-too-large). The
  // low-score floor is applied later by `shouldResize`; here we just carry it.
  const resize = parseResizeSignal(stdout);
  return {
    score,
    verdict: vm[1].toLowerCase() as PairScore["verdict"],
    rationale: rm[1].trim(),
    ...(resize !== null ? { resize } : {}),
  };
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
      .filter((a, i, arr) => arr.indexOf(a) === i)
      .filter((a) => agentCanReviewHeadless(a));
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

    // FIX-335 AC3: PARALLEL take-first over the ordered pool. The pool is ALWAYS
    // homogeneous in fallback class — it is EITHER every heterogeneous peer OR a
    // single same-type fallback (built above), never mixed — so firing the whole
    // pool concurrently and taking the first non-null verdict preserves FIX-293's
    // hard gate exactly: a wholly-failing hetero pool still BLOCKS (timeout) and
    // never silently degrades to a same-type review. Only the dispatch is now
    // concurrent. `sameTypeFallback` is uniform across the pool, so the all-fail
    // status can carry it directly.
    // FIX-363: the peer-gate retry reads the SAME full diff as the pairing review,
    // so it gets the SAME diff-scaled budget (the FIX-356b block fired here too).
    const timeoutMs = deps.timeoutMs ?? reviewTimeoutMs(diff.length);
    const poolSameType = tryOrder.every((c) => c.sameTypeFallback);
    const probes = tryOrder.map(async ({ peer, sameTypeFallback }) => {
      deps.event({ type: "pair:selected", cycleId, workingAgent: working, peer, stage: "code", timeoutMs, ts: deps.now() });
      const review = await deps.reviewPeer(peer, diff, timeoutMs);
      return review === null ? null : { peer, sameTypeFallback, review };
    });
    const winner = await firstValid(probes);
    if (winner === null) {
      // Whole ordered pool failed (timeout/error) → stays blocked, no death-spiral.
      return { status: "timeout", sameTypeFallback: poolSameType };
    }
    const { peer, sameTypeFallback, review } = winner;
    const path = evidencePath(runtimeDir, cycleId, "code");
    mkdirSync(join(runtimeDir, "peer"), { recursive: true });
    writeFileSync(path, JSON.stringify({ cycleId, workingAgent: working, peer, stage: "code", sameTypeFallback, ...review }, null, 2), "utf8");
    deps.event({ type: "pair:verdict", cycleId, peer, verdict: review.verdict, findings: review.findings.length, cost: review.cost, stage: "code", ts: deps.now() });
    return { status: "reviewed", peer, sameTypeFallback };
  } catch {
    return { status: "error" }; // never throw — the retry is a rescue, not a cycle killer
  }
}

/** The score-stage prompt (shared by the loop executor and `roll pair score`). */
export function buildPairScorePrompt(summary: string): string {
  return (
    `You are a heterogeneous PAIRING scorer. A different agent delivered the cycle below; ` +
    `grade the delivery quality honestly (root-cause depth, test coverage, scope discipline, evidence). ` +
    // FIX-363: grade against the STATED GOAL (the "Goal:" line). Removal / retire /
    // refactor cards are deletion-heavy BY DESIGN — a large deletion is NOT itself a
    // regression or poor scope discipline. A scorer that didn't know the goal was a
    // removal scored a clean `roll-sentinel` deletion 3/10 "regression" and blocked a
    // correct delivery (the loop then jammed on it).
    `Grade against the delivery's STATED GOAL shown on the "Goal:" line. ` +
    `If that goal is to REMOVE / RETIRE / DELETE / DROP / REFACTOR something, deletions ARE the intended ` +
    `deliverable: score whether the removal is CLEAN and COMPLETE (no dangling references, tests and docs follow, ` +
    `build stays green) — do NOT treat the deletion volume, or the absence of "replacement" code the goal never ` +
    `asked for, as a regression. ` +
    `Reply with exactly one "SCORE: <integer 1..10>" line, one "VERDICT: good|ok|regression" line, ` +
    `and one "RATIONALE: <one sentence>" line. ` +
    // US-AGENT-041: distinguish a SCOPE problem from a quality one. When the
    // delivery is incomplete because the story was simply too big for one cycle
    // (whole ACs / surfaces left uncovered, not bugs), ALSO add a "RESIZE: <why>"
    // line and a "GAPS: <gap one; gap two; ...>" line enumerating the uncovered
    // scope. The loop uses this to re-split the story (heterogeneous-consensus
    // gated), NOT to fail it. Omit RESIZE/GAPS for a pure quality problem.\n` +
    `If — and ONLY if — the low score is because the SCOPE is too large for one cycle (entire ACs or ` +
    `surfaces left uncovered, not defects), add a "RESIZE: <one line why>" line and a ` +
    `"GAPS: <gap one; gap two; ...>" line listing the uncovered scope. Do NOT add them for a quality problem.\n\nDELIVERY:\n` +
    summary
  );
}

// ── FIX-387: review prompt with repo context + build/TCR trust ──────────────

export interface ReviewPromptContext {
  diff: string;
  /** Number of commits ahead of main on this cycle's branch. */
  commitsAhead: number;
  /** Number of `tcr:` commits — evidence the build/TCR passed green. */
  tcrCount: number;
}

/**
 * FIX-387 — build the peer-review prompt with REPO CONTEXT so the reviewer knows:
 * (a) the build already passed (TCR green) — don't flag imports as build regression,
 * (b) symbols imported but not defined in the diff exist on the main baseline.
 *
 * Before this fix, the reviewer saw ONLY the diff and flagged `import { X }` as
 * "missing definition / build regression" when X was defined on main (outside the
 * diff). This feeds the reviewer the build/TCR facts and an explicit instruction
 * to avoid that mis-classification.
 *
 * AC4 guarantee: the instruction does NOT weaken detection of genuinely broken
 * code — the reviewer is still told to flag real issues INSIDE the diff or real
 * build failures, just not to mistake baseline imports for missing source.
 */
export function buildReviewPrompt(ctx: ReviewPromptContext): string {
  const buildLine =
    ctx.commitsAhead > 0
      ? `BUILD STATUS: ${ctx.commitsAhead} commit(s) ahead of main, ` +
        `${ctx.tcrCount > 0 ? `${ctx.tcrCount} TCR ` : ""}green — ` +
        `the build/TCR pipeline already passed. ` +
        `Do NOT flag imports, type references, or function calls to symbols defined ` +
        `OUTSIDE this diff (on the main baseline branch) as "build regression", ` +
        `"missing source", "undefined import", or "would fail build". ` +
        `The compiler already found those definitions on main.\n`
      : "";

  return (
    `You are a heterogeneous PAIRING reviewer — a DIFFERENT agent wrote the diff below. ` +
    `Your ONLY job is a terse second-pair-of-eyes review (correctness, edge cases, quality). ` +
    `Do NOT modify files, do NOT commit, do NOT try to "complete" or deliver anything — just review. ` +
    // FIX-387: trust the build/TCR pipeline that already passed. A symbol imported
    // but defined in a file UNCHANGED by this diff exists on the `main` baseline
    // and was resolved by the compiler — do NOT flag it as a build regression.
    `REPO CONTEXT: ` +
    `The branch targets \`origin/main\`; all files NOT listed in this diff are ` +
    `UNCHANGED from main and their contents (including exported symbols, types, ` +
    `and functions) exist on the baseline. ` +
    `\n` +
    (buildLine !== "" ? `TRUST BUILD: ${buildLine}` : "") +
    `Important — judge the diff ITSELF for correctness: ` +
    `  • Flag real bugs, logic errors, missing error handling, security issues, ` +
    `    broken patterns, or inconsistent changes WITHIN the diff. ` +
    `  • BUT if the diff IMPORTS a symbol / type / function and you cannot find ` +
    `    its definition WITHIN the diff → that symbol lives on main (the baseline) ` +
    `    and the compiler already resolved it. This is NORMAL — do NOT flag it. ` +
    `  • The ONLY time a missing import is real: the import path ITSELF is newly ` +
    `    introduced in this diff AND the file it points to is also in this diff BUT ` +
    `    missing the exported symbol. ` +
    `End with exactly one line "VERDICT: agree|refine|object" and one ` +
    `"FINDING: <issue>" line per concrete issue.\n\nDIFF:\n` +
    ctx.diff
  );
}

/**
 * FIX-344 — the DESIGN score-stage prompt. roll-design produces backlog/spec
 * artifacts (INVEST stories), NOT a code diff, so the scorer grades DESIGN
 * quality, not code: INVEST story split, visual-AC completeness (every
 * user-visible story carries a visual-evidence AC or an honest `screenshot_exempt`
 * reason), deliverable declarations (`deliverable_url` points at the real product
 * surface, not the card's own dossier), and domain/spec consistency (backlog rows
 * match spec files; no jump from idea straight to stories without a worked design
 * sample). The SAME structured reply contract as {@link buildPairScorePrompt} so
 * {@link parsePairScoreOutput} parses both identically and the note shape is shared.
 */
export function buildDesignScorePrompt(summary: string): string {
  return (
    `You are an independent DESIGN Reviewer. A different agent produced the design output below ` +
    `(backlog rows + story specs from a roll-design session), NOT code. ` +
    `Grade the DESIGN quality honestly — NOT code, there is no diff to read. Judge: ` +
    `(1) INVEST story split (each story independent, negotiable, valuable, estimable, small, testable; ` +
    `right granularity — not a mega-story, not noise); ` +
    `(2) visual-AC completeness (every user-visible story carries a visual-evidence AC, or an honest ` +
    `\`screenshot_exempt: <reason>\` — a naked exemption with no reason is a defect); ` +
    `(3) deliverable declarations (\`deliverable_url\`/\`screenshot_url\` points at the REAL product surface, ` +
    `never the card's own dossier/report page); ` +
    `(4) domain & spec consistency (backlog index rows match the spec files; a concrete worked design ` +
    `precedes decomposition — no idea-straight-to-stories with shallow specs). ` +
    `Grade against the design's STATED GOAL shown on the "Goal:" line if present. ` +
    `Reply with exactly one "SCORE: <integer 1..10>" line, one "VERDICT: good|ok|regression" line, ` +
    `and one "RATIONALE: <one sentence>" line.\n\nDESIGN OUTPUT:\n` +
    summary
  );
}
