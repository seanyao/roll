/**
 * Frozen-expectation test: TS AgentRouter pure logic.
 *
 * classifyComplexity + nudgeWithinTier were proven equal to the python oracle
 * `lib/loop_pick_agent.py` (tier classification + the audit rationale text the
 * loop logs verbatim) under diff-test. Per US-PORT-009b the oracle is retired:
 * the `python3` spawn is dropped and each case asserts against the frozen value
 * captured while the oracle agreed.
 */
import { describe, expect, it } from "vitest";
import { classifyComplexity, hitRateKey, nudgeWithinTier, type HitRates } from "../src/index.js";

describe("frozen: classifyComplexity == python --est-min", () => {
  // Boundaries + illegal/missing (python defaults to "default").
  const CASES: Array<[string, string]> = [
    ["0", "easy"],
    ["8", "easy"],
    ["9", "default"],
    ["20", "default"],
    ["21", "hard"],
    ["100", "hard"],
    ["-3", "default"],
    ["foo", "default"],
    ["", "default"],
  ];
  for (const [est, expected] of CASES) {
    it(`est_min='${est}' → ${expected}`, () => {
      expect(classifyComplexity(est)).toBe(expected);
    });
  }
});

describe("frozen: nudgeWithinTier == python --nudge (agent + rationale bytes)", () => {
  const k = hitRateKey;
  const CASES: Array<{
    name: string;
    slot: string;
    storyType: string;
    candidates: string[];
    hitRates: HitRates;
    disabled: boolean;
    expected: { agent: string; rationale: string };
  }> = [
    {
      name: "disabled identity",
      slot: "claude", storyType: "US", candidates: ["kimi"], hitRates: {}, disabled: true,
      expected: { agent: "claude", rationale: "nudge disabled; keeping est_min slot claude" },
    },
    {
      name: "below sample floor → keep slot",
      slot: "claude", storyType: "US", candidates: ["kimi"],
      hitRates: { [k("kimi", "US")]: { hit_rate: 0.99, sample_n: 3 } }, disabled: false,
      expected: { agent: "claude", rationale: "n<8 for all US candidates in this tier; keeping slot claude" },
    },
    {
      name: "candidate wins",
      slot: "claude", storyType: "US", candidates: ["kimi"],
      hitRates: { [k("claude", "US")]: { hit_rate: 0.8, sample_n: 10 }, [k("kimi", "US")]: { hit_rate: 0.95, sample_n: 12 } }, disabled: false,
      expected: { agent: "kimi", rationale: "kimi in-tier hit_rate 0.95 (n=12) > slot claude 0.80 (n=10) for US -> prefer kimi" },
    },
    {
      name: "tie → slot kept",
      slot: "claude", storyType: "FIX", candidates: ["kimi", "qwen"],
      hitRates: { [k("claude", "FIX")]: { hit_rate: 0.9, sample_n: 10 }, [k("kimi", "FIX")]: { hit_rate: 0.9, sample_n: 10 }, [k("qwen", "FIX")]: { hit_rate: 0.9, sample_n: 10 } }, disabled: false,
      expected: { agent: "claude", rationale: "claude best for FIX in-tier (hit_rate 0.90, n=10); slot kept" },
    },
    {
      name: "slot best in-tier",
      slot: "claude", storyType: "US", candidates: ["kimi"],
      hitRates: { [k("claude", "US")]: { hit_rate: 0.97, sample_n: 9 }, [k("kimi", "US")]: { hit_rate: 0.5, sample_n: 9 } }, disabled: false,
      expected: { agent: "claude", rationale: "claude best for US in-tier (hit_rate 0.97, n=9); slot kept" },
    },
    {
      name: "empty hit-rates → keep slot",
      slot: "pi", storyType: "REFACTOR", candidates: [], hitRates: {}, disabled: false,
      expected: { agent: "pi", rationale: "n<8 for all REFACTOR candidates in this tier; keeping slot pi" },
    },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      const ts = nudgeWithinTier(c.slot, c.candidates, c.storyType, c.hitRates, { enabled: !c.disabled });
      expect(ts.agent).toBe(c.expected.agent);
      expect(ts.rationale).toBe(c.expected.rationale);
    });
  }
});
