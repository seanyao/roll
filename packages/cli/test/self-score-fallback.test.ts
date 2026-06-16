/**
 * FIX-342 — runner-side self-score fallback.
 *
 * Root cause frozen here: a real cycle (20260616-130452-42254, US-DOSSIER-042)
 * built 5 files, passed heterogeneous peer code-review, captured a screenshot,
 * and satisfied must-declare — yet failed the attest gate on "missing self-score
 * note" and went cycle-terminal failed. The working agent had skipped its own
 * `roll self-score` step (the card's notes/ dir was empty) and the score-stage
 * pairing that would have written the note was ORDERED AFTER, and GATED BY, the
 * very attest check that required it — a deadlock.
 *
 * The fix runs the score stage before the gate and, when no peer score is
 * available, derives a conservative runner-side note. These tests freeze:
 *   1. evidenced delivery + no note + no peer score → fallback note written,
 *      and the attest self-score gate then PASSES (the deadlock is broken);
 *   2. a real note already present → fallback is a no-op (never overwrites a
 *      considered assessment);
 *   3. an empty-shell delivery (no fresh report / no content) → NO fallback note
 *      (the requirement is upheld: nothing real to score still fails the gate).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateSelfScoreGate } from "../src/lib/self-score.js";
import { deriveSelfScoreFallback, FALLBACK_SCORE } from "../src/runner/self-score-fallback.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const p = mkdtempSync(join(tmpdir(), `roll-ssfb-${prefix}-`));
  dirs.push(p);
  mkdirSync(join(p, ".roll"), { recursive: true });
  return p;
}

/** A genuine, evidenced delivery: fresh content-bearing report + ac-map + a real
 *  captured screenshot ref (the FIX-309/FIX-214 content+visual floor). No note. */
function evidencedDelivery(storyId: string): string {
  const wt = tmp("wt");
  const storyDir = join(wt, ".roll", "features", "uncategorized", storyId);
  const dir = join(storyDir, "latest");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(storyDir, "ac-map.json"), "[]\n");
  const body = '<div class="ev ev-text">proof</div><figure class="shot"><img src="screenshots/p.png"></figure>';
  const p = join(dir, `${storyId}-report.html`);
  writeFileSync(p, `<html><body><section class="ac s-pass" id="${storyId}:AC1">${body}</section></body></html>\n`);
  return wt;
}

/** An empty shell: parseable report, zero AC content, no ac-map. */
function emptyShell(storyId: string): string {
  const wt = tmp("shell");
  const dir = join(wt, ".roll", "features", "uncategorized", storyId, "latest");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${storyId}-report.html`);
  writeFileSync(p, "<html><body><h1>no ACs</h1></body></html>\n");
  utimesSync(p, 1000, 1000);
  return wt;
}

describe("deriveSelfScoreFallback (FIX-342)", () => {
  it("evidenced delivery + no note + no peer score → writes a note that PASSES the attest self-score gate", () => {
    const wt = evidencedDelivery("US-DOSSIER-042");
    // Pre-condition reproduces the bug: the gate reports the cycle's failure.
    expect(evaluateSelfScoreGate(wt, "US-DOSSIER-042").status).toBe("missing");

    const r = deriveSelfScoreFallback(wt, join(wt, ".roll"), "US-DOSSIER-042", "cyc-1", "roll-build");
    expect(r.written).toBe(true);

    // The deadlock is broken: a real, peer-reviewed, evidenced delivery now passes.
    const gate = evaluateSelfScoreGate(wt, "US-DOSSIER-042");
    expect(gate.status).toBe("pass");
    expect(gate.entry?.score).toBe(FALLBACK_SCORE);
    expect(gate.entry?.verdict).toBe("ok");
  });

  it("a considered note already present → fallback is a no-op (never overwrites)", () => {
    const wt = evidencedDelivery("FIX-500");
    const notes = join(wt, ".roll", "features", "uncategorized", "FIX-500", "notes");
    mkdirSync(notes, { recursive: true });
    writeFileSync(
      join(notes, "2026-06-16-roll-fix-FIX-500-1.md"),
      ["---", "skill: roll-fix", "story: FIX-500", "score: 9", "verdict: good", "ts: 2026-06-16T00:00:00Z", "---", "", "Considered rationale."].join("\n"),
    );
    const r = deriveSelfScoreFallback(wt, join(wt, ".roll"), "FIX-500", "cyc-2", "roll-fix");
    expect(r.written).toBe(false);
    expect(r.reason).toBe("already-present");
    // The original score is untouched.
    expect(evaluateSelfScoreGate(wt, "FIX-500").entry?.score).toBe(9);
  });

  it("empty-shell delivery (no real evidence) → NO fallback note; the gate still fails honestly", () => {
    const wt = emptyShell("FIX-501");
    const r = deriveSelfScoreFallback(wt, join(wt, ".roll"), "FIX-501", "cyc-3", "roll-fix");
    expect(r.written).toBe(false);
    expect(r.reason).toBe("no-evidenced-delivery");
    expect(evaluateSelfScoreGate(wt, "FIX-501").status).toBe("missing");
    expect(existsSync(join(wt, ".roll", "features", "uncategorized", "FIX-501", "notes"))).toBe(false);
  });
});
