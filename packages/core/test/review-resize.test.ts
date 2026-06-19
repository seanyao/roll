/**
 * US-AGENT-041 — review-triggered resize pure core: parse the reviewer's resize
 * signal (scope vs quality), the low-score trigger decision, and heterogeneous
 * consensus (all-agree-or-escalate).
 */
import { describe, expect, it } from "vitest";
import {
  RESIZE_CONSENSUS_MIN_PEERS,
  RESIZE_SCORE_THRESHOLD,
  parseResizeSignal,
  resizeConsensus,
  shouldResize,
} from "../src/loop/review-resize.js";

describe("parseResizeSignal", () => {
  it("parses RESIZE + GAPS (semicolon-separated)", () => {
    const out = parseResizeSignal(
      [
        "SCORE: 5",
        "VERDICT: ok",
        "RATIONALE: 80% done; guide + 5 slides + tests uncovered",
        "RESIZE: scope spans guides, slides and regression tests — too big for one cycle",
        "GAPS: guide/skills.md not rewritten; 5 site slides untouched; regression too narrow",
      ].join("\n"),
    );
    expect(out).toEqual({
      reason: "scope spans guides, slides and regression tests — too big for one cycle",
      gaps: ["guide/skills.md not rewritten", "5 site slides untouched", "regression too narrow"],
    });
  });

  it("returns null for a pure quality problem (no RESIZE line)", () => {
    const out = parseResizeSignal("SCORE: 4\nVERDICT: regression\nRATIONALE: the fix has a null-deref bug");
    expect(out).toBeNull();
  });

  it("RESIZE with no GAPS line parses with empty gaps (command treats as irreducible)", () => {
    const out = parseResizeSignal("SCORE: 5\nVERDICT: ok\nRATIONALE: x\nRESIZE: just too big");
    expect(out).toEqual({ reason: "just too big", gaps: [] });
  });
});

describe("shouldResize — only on a LOW score", () => {
  const resize = { reason: "scope", gaps: ["a", "b"] };
  it("fires on score ≤ threshold with a resize signal", () => {
    expect(shouldResize(RESIZE_SCORE_THRESHOLD, resize)).toBe(true);
    expect(shouldResize(3, resize)).toBe(true);
  });
  it("does NOT fire on a high score even with a stray RESIZE", () => {
    expect(shouldResize(RESIZE_SCORE_THRESHOLD + 1, resize)).toBe(false);
    expect(shouldResize(9, resize)).toBe(false);
  });
  it("does NOT fire without a resize signal (pure quality fail)", () => {
    expect(shouldResize(2, null)).toBe(false);
  });
});

describe("resizeConsensus — all-agree-or-escalate", () => {
  it("lands when ≥minPeers all agree", () => {
    const out = resizeConsensus([
      { peer: "codex", agree: true },
      { peer: "kimi", agree: true },
    ]);
    expect(out.landed).toBe(true);
    expect(out.total).toBe(2);
    expect(out.dissenters).toEqual([]);
  });

  it("does NOT land on any objection (disagree → escalate)", () => {
    const out = resizeConsensus([
      { peer: "codex", agree: true },
      { peer: "kimi", agree: false, reason: "gap C also needs its own card" },
    ]);
    expect(out.landed).toBe(false);
    expect(out.dissenters).toEqual(["kimi"]);
    expect(out.reason).toContain("objected");
  });

  it("does NOT land with too few reviewers", () => {
    const out = resizeConsensus([{ peer: "codex", agree: true }]);
    expect(out.landed).toBe(false);
    expect(out.reason).toContain("too few");
  });

  it("min peers default is 2", () => {
    expect(RESIZE_CONSENSUS_MIN_PEERS).toBe(2);
    expect(resizeConsensus([], 2).landed).toBe(false);
  });
});
