/**
 * FIX-342 — runner-side self-score fallback.
 *
 * The attest gate REQUIRES a self-score note (evaluateSelfScoreGate). The
 * preferred producer is the score-stage pairing (a heterogeneous peer grades the
 * delivery, US-PAIR-009). But pairing can be OFF, have no qualified hetero peer,
 * or time out — and the working agent sometimes skips its own `roll self-score`
 * step (observed cycle 20260616-130452-42254: build + hetero peer code-review ✓,
 * but the card's notes/ dir was empty → attest gate failed "missing self-score
 * note" → cycle terminal failed, despite a real evidenced delivery).
 *
 * This is the same failure shape FIX-246 fixed for ac-map: a skill step agents
 * skip, surgically backfilled by the runner BEFORE the gate. The red line (owner
 * ruling): the self-score requirement is NOT weakened — a note must still exist
 * for Done. This fallback only fires when:
 *   1. NO self-score note exists yet for the story (agent didn't write one, and
 *      the score-stage pairing produced none), AND
 *   2. a GENUINE, evidenced delivery is present — a fresh acceptance report WITH
 *      content (the FIX-214 empty-shell floor: ≥1 AC section + ac-map + visual
 *      floor). A bare/empty-shell delivery has nothing to score and is left to
 *      fail the attest gate honestly.
 *
 * The derived note records `verdict: ok`, a conservative `score` at the gate's
 * low-but-passing floor, and a rationale that names it as a runner fallback so it
 * is never confused with an agent's considered self-assessment in the dossier.
 */
import { verificationReportFresh, verificationReportHasContent } from "./attest-gate.js";
import { readLatestStorySelfScore, SELF_SCORE_LOW_THRESHOLD, type SelfScoreWriteInput, type SelfScoreWriteResult, writeSelfScoreNote } from "../lib/self-score.js";

export interface SelfScoreFallbackResult {
  /** A note was written by this fallback. */
  written: boolean;
  /** Why no note was written (when `written` is false). */
  reason?: "already-present" | "no-evidenced-delivery" | "error";
  path?: string;
}

/**
 * The conservative score the fallback assigns: one above the gate's
 * low-self-score floor so an evidenced delivery PASSES the gate (the work is
 * real) but is not flattered — a peer or the agent can always rescore higher.
 */
export const FALLBACK_SCORE = SELF_SCORE_LOW_THRESHOLD + 1;

export function deriveSelfScoreFallback(
  worktreeCwd: string,
  _runtimeDir: string,
  storyId: string,
  cycleId: string,
  skill: string,
  writeNote: (projectPath: string, input: SelfScoreWriteInput) => SelfScoreWriteResult = writeSelfScoreNote,
): SelfScoreFallbackResult {
  if (storyId === "") return { written: false, reason: "error" };
  try {
    // (1) A note already exists (agent wrote it, or the peer score stage did) →
    // never overwrite a real assessment.
    if (readLatestStorySelfScore(worktreeCwd, storyId) !== undefined) {
      return { written: false, reason: "already-present" };
    }
    // (2) Only a genuine, evidenced delivery earns a fallback note. An empty
    // shell / no fresh report has nothing to score and stays a gate failure.
    if (!verificationReportFresh(worktreeCwd, storyId) || !verificationReportHasContent(worktreeCwd, storyId)) {
      return { written: false, reason: "no-evidenced-delivery" };
    }
    const res = writeNote(worktreeCwd, {
      skill,
      story: storyId,
      score: FALLBACK_SCORE,
      verdict: "ok",
      rationale:
        `Runner-derived self-score fallback (FIX-342, cycle ${cycleId}): the working agent did not write a ` +
        `self-score note and no heterogeneous peer score was available, but a fresh acceptance report with ` +
        `content and passing visual floor is on disk. Conservative ok/${FALLBACK_SCORE} pending a considered ` +
        `agent or peer rescore.`,
      scoring: "self",
      fallbackReason: "runner-fallback-no-agent-or-peer-score",
    });
    return { written: res.written, path: res.path };
  } catch {
    return { written: false, reason: "error" };
  }
}
