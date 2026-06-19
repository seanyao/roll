/**
 * US-AGENT-041 — review-triggered resize orchestrator: the reviewer's
 * scope-too-large signal drives a $roll-design split that is gated by
 * heterogeneous consensus (all-agree → self-downgrade; disagree → pause+alert,
 * backlog unchanged), reusing US-AGENT-042's self-downgrade. Driven with
 * injected deps so no real agents spawn. Also covers the resize parse/persist
 * round-trip and the consensus-reply parser.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildResizeConsensusPrompt,
  loopReviewResizeCommand,
  parseConsensusReply,
  type ReviewResizeDeps,
} from "../src/commands/loop-review-resize.js";
import { parsePairScoreOutput } from "../src/runner/pairing-gate.js";
import { writeReviewScoreNote, readLatestResizeSignal } from "../src/lib/review-score.js";

let dir: string;
const savedEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string): void {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  process.env[k] = v;
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "review-resize-"));
  mkdirSync(join(dir, ".roll", "loop"), { recursive: true });
  setEnv("ROLL_MAIN_PROJECT", dir);
  setEnv("ROLL_MAIN_SLUG", "rr-test");
  setEnv("NO_COLOR", "1");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});

function capture(fn: () => Promise<number>): Promise<{ status: number; out: string }> {
  const o: string[] = [];
  const wo = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((x: string | Uint8Array) => (o.push(String(x)), true)) as typeof process.stdout.write;
  return fn()
    .then((status) => ({ status, out: o.join("") }))
    .finally(() => {
      process.stdout.write = wo;
    });
}

function baseDeps(over: Partial<ReviewResizeDeps> = {}): ReviewResizeDeps {
  return {
    now: () => 1_780_000_000_000,
    readResize: () => ({ score: 5, resize: { reason: "scope too big", gaps: ["g1", "g2", "g3"] } }),
    design: vi.fn(async () => ["US-Z-a", "US-Z-b"]),
    peers: () => ["codex", "kimi"],
    consult: vi.fn(async (_p, peer) => ({ peer, agree: true })),
    selfDowngrade: vi.fn(async () => 0),
    alert: vi.fn(),
    ...over,
  };
}

describe("loopReviewResizeCommand — consensus lands → self-downgrade (US-AGENT-042)", () => {
  it("all agree → calls self-downgrade with the designed sub-stories", async () => {
    const selfDowngrade = vi.fn(async () => 0);
    const r = await capture(() => loopReviewResizeCommand(["US-Z"], baseDeps({ selfDowngrade })));
    expect(r.status).toBe(0);
    expect(selfDowngrade).toHaveBeenCalledWith("US-Z", expect.stringContaining("reviewer resize"), ["US-Z-a", "US-Z-b"]);
    expect(r.out).toContain("consensus reached");
  });
});

describe("loopReviewResizeCommand — disagree → pause + alert, backlog unchanged", () => {
  it("any objection blocks the auto-land (no self-downgrade), writes an alert", async () => {
    const selfDowngrade = vi.fn(async () => 0);
    const alert = vi.fn();
    const consult = vi.fn(async (_p: string, peer: string) =>
      peer === "kimi" ? { peer, agree: false, reason: "gap g3 needs its own card" } : { peer, agree: true },
    );
    const r = await capture(() => loopReviewResizeCommand(["US-Z"], baseDeps({ selfDowngrade, alert, consult })));
    expect(r.status).toBe(0);
    expect(selfDowngrade).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]?.[1]).toContain("consensus failed");
    expect(r.out).toContain("consensus FAILED");
  });
});

describe("loopReviewResizeCommand — guards", () => {
  it("no resize signal → no-op (no design, no self-downgrade)", async () => {
    const design = vi.fn(async () => ["a", "b"]);
    const selfDowngrade = vi.fn(async () => 0);
    const r = await capture(() =>
      loopReviewResizeCommand(["US-Z"], baseDeps({ readResize: () => ({ score: 8, resize: null }), design, selfDowngrade })),
    );
    expect(r.status).toBe(0);
    expect(design).not.toHaveBeenCalled();
    expect(selfDowngrade).not.toHaveBeenCalled();
    expect(r.out).toContain("no scope-resize signal");
  });

  it("high score with a stray resize → no-op (only LOW scores trigger)", async () => {
    const selfDowngrade = vi.fn(async () => 0);
    const r = await capture(() =>
      loopReviewResizeCommand(["US-Z"], baseDeps({ readResize: () => ({ score: 9, resize: { reason: "x", gaps: ["a", "b"] } }), selfDowngrade })),
    );
    expect(r.status).toBe(0);
    expect(selfDowngrade).not.toHaveBeenCalled();
  });

  it("design produced <2 sub-stories → irreducible: self-downgrade (cap path), no consensus", async () => {
    const consult = vi.fn(async (_p: string, peer: string) => ({ peer, agree: true }));
    const selfDowngrade = vi.fn(async () => 0);
    const r = await capture(() =>
      loopReviewResizeCommand(["US-Z"], baseDeps({ design: async () => ["US-Z-only"], consult, selfDowngrade })),
    );
    expect(r.status).toBe(0);
    expect(consult).not.toHaveBeenCalled();
    expect(selfDowngrade).toHaveBeenCalledWith("US-Z", expect.stringContaining("irreducible"), ["US-Z-only"]);
  });

  it("usage error on missing story id", async () => {
    const r = await capture(() => loopReviewResizeCommand([], baseDeps()));
    expect(r.status).toBe(2);
  });
});

describe("parseConsensusReply", () => {
  it("AGREE / OBJECT / ambiguous", () => {
    expect(parseConsensusReply("codex", "AGREE")).toEqual({ peer: "codex", agree: true });
    expect(parseConsensusReply("kimi", "OBJECT: gap C uncovered")).toMatchObject({ agree: false, reason: "gap C uncovered" });
    expect(parseConsensusReply("pi", "hmm not sure")).toMatchObject({ agree: false });
  });
});

describe("buildResizeConsensusPrompt", () => {
  it("includes the parent, gaps, and sub-stories", () => {
    const p = buildResizeConsensusPrompt({ parentId: "US-Z", reason: "big", gaps: ["g1", "g2"], subIds: ["US-Z-a", "US-Z-b"] });
    expect(p).toContain("US-Z");
    expect(p).toContain("g1");
    expect(p).toContain("US-Z-a, US-Z-b");
    expect(p).toContain("AGREE");
  });
});

describe("resize signal: parse from reviewer output + persist/read round-trip", () => {
  it("parsePairScoreOutput captures RESIZE + GAPS alongside the score", () => {
    const out = parsePairScoreOutput(
      "SCORE: 5\nVERDICT: ok\nRATIONALE: 80% done\nRESIZE: scope spans guides+slides+tests\nGAPS: guide missing; 5 slides; tests narrow",
    );
    expect(out).toMatchObject({
      score: 5,
      verdict: "ok",
      resize: { reason: "scope spans guides+slides+tests", gaps: ["guide missing", "5 slides", "tests narrow"] },
    });
  });

  it("pure quality reply has no resize", () => {
    const out = parsePairScoreOutput("SCORE: 4\nVERDICT: regression\nRATIONALE: null-deref bug");
    expect(out?.resize).toBeUndefined();
  });

  it("writeReviewScoreNote persists resize-reason/gaps; readLatestResizeSignal reads them back", () => {
    writeReviewScoreNote(dir, {
      skill: "roll-fix",
      story: "FIX-356c",
      score: 5,
      verdict: "ok",
      rationale: "80% done, scope too big",
      scoring: "pair",
      scoredBy: "codex",
      sessionId: "c1:score:codex",
      resize: { reason: "guides + slides + tests too big", gaps: ["guide/skills.md", "5 slides", "regression"] },
    });
    const sig = readLatestResizeSignal(dir, "FIX-356c");
    expect(sig).not.toBeNull();
    expect(sig?.score).toBe(5);
    expect(sig?.resize).toEqual({ reason: "guides + slides + tests too big", gaps: ["guide/skills.md", "5 slides", "regression"] });
  });
});
