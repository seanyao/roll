/**
 * Frozen-expectation test: @roll/core CostTracker adapters.
 *
 * The stdout-scrape extractors and the pi/kimi session summers were proven equal
 * to the python oracle `lib/agent_usage/` (per-adapter `extract`,
 * `_sum_session_file` / `_sum_wire_file`) under diff-test, with cost compared at
 * 4dp through the shared price table. Per US-PORT-009b the oracle is retired: the
 * `python3` spawns are dropped and each fixture asserts the extracted usage
 * object against the frozen value captured while the oracle agreed.
 */
import { describe, expect, it } from "vitest";
import {
  agyExtract,
  extractUsage,
  kimiExtract,
  piExtract,
  reasonixExtract,
  sumKimiWire,
  sumPiSession,
  type Extractor,
} from "../src/index.js";

type Usage = Record<string, unknown> | null;

const STDOUT_FIXTURES: Array<{ agent: string; ex: Extractor; lines: string[]; expected: Usage }> = [
  {
    agent: "kimi", ex: kimiExtract,
    lines: ["Model: kimi-k2", "Tokens: input=15300 output=3120"],
    expected: { model: "kimi-k2", input_tokens: 15300, output_tokens: 3120, cost_list_usd: 0.1837, duration_ms: null },
  },
  {
    agent: "kimi", ex: kimiExtract,
    lines: ["Input tokens:  15,300", "Output tokens:  3,120", "Total tokens:  18,420", "model: kimi-k2"],
    expected: { model: "kimi-k2", input_tokens: 15300, output_tokens: 3120, cost_list_usd: 0.1837, duration_ms: null },
  },
  { agent: "kimi", ex: kimiExtract, lines: ["hello, world", "nothing useful here"], expected: null },
  { agent: "kimi", ex: kimiExtract, lines: [], expected: null },
  // FIX-1050 / FIX-1259: reasonix footer from cycle 20260630-202133-24278. The
  // footer carries no model, so the parser leaves it EMPTY (the fold layer
  // backfills the spawn model) — no source-baked "deepseek-flash" default.
  {
    agent: "reasonix", ex: reasonixExtract,
    lines: ["some build output", "  · 166604 tok · in 165907 (165760 cached / 147 new) · out 697 (14 reasoning) · ¥0.0049"],
    expected: { model: "", input_tokens: 165907, output_tokens: 697, cost_list_usd: 0.0049, currency: "CNY", duration_ms: null },
  },
  // FIX-1050: reasonix footer without per-direction split falls back to total→input.
  {
    agent: "reasonix", ex: reasonixExtract,
    lines: ["· 1000 tok · in 0 · out 0 · ¥0.0001"],
    expected: { model: "", input_tokens: 1000, output_tokens: 0, cost_list_usd: 0.0001, currency: "CNY", duration_ms: null },
  },
  // FIX-1050: multiple reasonix footers → the LAST one is the cycle total.
  {
    agent: "reasonix", ex: reasonixExtract,
    lines: [
      "· 14641 tok · in 14314 (384 cached / 13930 new) · out 327 (155 reasoning) · ¥0.0146",
      "· 166604 tok · in 165907 (165760 cached / 147 new) · out 697 (14 reasoning) · ¥0.0049",
    ],
    expected: { model: "", input_tokens: 165907, output_tokens: 697, cost_list_usd: 0.0049, currency: "CNY", duration_ms: null },
  },
  { agent: "reasonix", ex: reasonixExtract, lines: ["no footer here"], expected: null },
  // FIX-1050: agy/gemini stdout carries no usage footer → explicit null.
  { agent: "agy", ex: agyExtract, lines: ["^D\b\b", "some output"], expected: null },
  { agent: "agy", ex: agyExtract, lines: [], expected: null },
];

/** Compare a TS usage object to the frozen expected, with cost tolerance. */
function expectUsageEqual(ts: Usage, expected: Usage): void {
  if (expected === null) {
    expect(ts).toBeNull();
    return;
  }
  expect(ts).not.toBeNull();
  const t = ts as Record<string, unknown>;
  expect(t["model"]).toBe(expected["model"]);
  expect(t["input_tokens"]).toBe(expected["input_tokens"]);
  expect(t["output_tokens"]).toBe(expected["output_tokens"]);
  if (expected["cost_list_usd"] !== undefined) {
    expect(t["cost_list_usd"] as number).toBeCloseTo(expected["cost_list_usd"] as number, 6);
  }
  if (expected["currency"] !== undefined) {
    expect(t["currency"]).toBe(expected["currency"]);
  }
}

describe("frozen: stdout-scrape extractors == python adapters", () => {
  for (let i = 0; i < STDOUT_FIXTURES.length; i++) {
    const f = STDOUT_FIXTURES[i] as (typeof STDOUT_FIXTURES)[number];
    it(`${f.agent} #${i}: ${JSON.stringify(f.lines).slice(0, 50)}`, () => {
      expectUsageEqual(f.ex(f.lines) as Usage, f.expected);
    });
  }

  it("pi extract stub returns None", () => {
    expect(piExtract(["anything", "pi text mode answer"])).toBeNull();
  });

  it("extractUsage validates required fields like extract_usage", () => {
    expect(extractUsage("nope", ["input=1 output=1"])).toBeNull();
    const u = extractUsage("kimi", ["Model: kimi-k2", "input=10 output=5"]);
    expect(u).not.toBeNull();
    expect(u?.model).toBe("kimi-k2");
  });

  it("FIX-1050/FIX-1259: extractUsage routes reasonix to its footer parser; model left empty (no source-baked default)", () => {
    const u = extractUsage("reasonix", ["  · 166604 tok · in 165907 (165760 cached / 147 new) · out 697 (14 reasoning) · ¥0.0049"]);
    expect(u).not.toBeNull();
    // The footer carries no model — empty, for the fold layer to backfill the
    // spawn model. The old "deepseek-flash" hardcode is gone (FIX-1259).
    expect(u?.model).toBe("");
    expect(u?.input_tokens).toBe(165907);
    expect(u?.output_tokens).toBe(697);
    expect(u?.cost_list_usd as number).toBeCloseTo(0.0049, 6);
  });

  it("FIX-1050: extractUsage routes agy to its explicit no-usage stub", () => {
    expect(extractUsage("agy", ["anything", "^D\b\b"])).toBeNull();
  });
});

const PI_SESSION = [
  JSON.stringify({ type: "session", cwd: "/tmp/wt" }),
  JSON.stringify({ type: "message", message: { role: "assistant", model: "deepseek-v4-pro", usage: { input: 1200, output: 340, cacheRead: 800, cacheWrite: 60, cost: { total: 0.42 } } } }),
  JSON.stringify({ type: "message", message: { role: "assistant", usage: { input: 300, output: 90, cacheRead: 100, cacheWrite: 0, cost: { total: 0.1 } } } }),
  JSON.stringify({ type: "message", message: { role: "user", usage: { input: 9999 } } }),
  "{ not json",
];

const KIMI_WIRE = [
  JSON.stringify({ type: "usage.record", model: "kimi-code/kimi-for-coding", usage: { inputOther: 5000, output: 1200, inputCacheRead: 2000, inputCacheCreation: 300 }, usageScope: "turn" }),
  JSON.stringify({ type: "usage.record", usage: { inputOther: 1000, output: 200, inputCacheRead: 0, inputCacheCreation: 50 } }),
  JSON.stringify({ type: "something.else", usage: { inputOther: 9999 } }),
  "garbage",
];

describe("frozen: session summers == python _sum_*", () => {
  it("pi _sum_session_file token sum + model + cost_reported", () => {
    const ts = sumPiSession(PI_SESSION);
    expect(ts).not.toBeNull();
    expect(ts?.model).toBe("deepseek-v4-pro");
    expect(ts?.input_tokens).toBe(1500);
    expect(ts?.output_tokens).toBe(430);
    expect(ts?.cache_creation_tokens).toBe(60);
    expect(ts?.cache_read_tokens).toBe(900);
    expect(ts?.cost_reported as number).toBeCloseTo(0.52, 6);
  });

  it("kimi _sum_wire_file token sum + model", () => {
    const ts = sumKimiWire(KIMI_WIRE);
    expect(ts).not.toBeNull();
    expect(ts?.model).toBe("kimi-code/kimi-for-coding");
    expect(ts?.input_tokens).toBe(6000);
    expect(ts?.output_tokens).toBe(1400);
    expect(ts?.cache_creation_tokens).toBe(350);
    expect(ts?.cache_read_tokens).toBe(2000);
  });

  it("no usage → None", () => {
    const lines = [JSON.stringify({ type: "session", cwd: "/x" }), "nope"];
    expect(sumPiSession(lines)).toBeNull();
  });
});
