/**
 * Frozen-expectation test: @roll/core prices (computeListCost / currencyFor).
 *
 * Both were proven equal to the python oracle `lib/model_prices.py`
 * (compute_list_cost / currency_for) under diff-test, reading the same versioned
 * snapshots under `lib/prices/`. Per US-PORT-009b the oracle is retired: the
 * `python3` spawn is dropped and each case asserts against the frozen value
 * captured while the oracle agreed (costs read from the frozen price snapshot,
 * so they are stable literals).
 */
import { describe, expect, it } from "vitest";
import { computeListCost, currencyFor } from "../src/index.js";

interface Tokens {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
}

describe("frozen: computeListCost == model_prices.compute_list_cost", () => {
  const cases: Array<{ model: string | null; t: Tokens; expected: number }> = [
    { model: "claude-sonnet-4-6", t: { input_tokens: 15300, output_tokens: 3120 }, expected: 0.0927 },
    { model: "claude-opus-4-7", t: { input_tokens: 1_000_000, output_tokens: 500_000 }, expected: 17.5 },
    { model: "deepseek-v4-pro", t: { input_tokens: 200_000, output_tokens: 80_000, cache_read_tokens: 50_000 }, expected: 1.0813 },
    { model: "kimi-k2.6", t: { input_tokens: 42_000, output_tokens: 9_000 }, expected: 0.516 },
    { model: "deepseek/deepseek-chat", t: { input_tokens: 10_000, output_tokens: 2_000 }, expected: 0.119 },
    { model: "totally-unknown-model-xyz", t: { input_tokens: 12_345, output_tokens: 678 }, expected: 0.0985 },
    { model: null, t: { input_tokens: 5000, output_tokens: 1000 }, expected: 0.0595 },
    { model: "claude-sonnet-4-6", t: {}, expected: 0 },
  ];

  for (const c of cases) {
    it(`compute_list_cost(${c.model ?? "None"}, ${JSON.stringify(c.t)})`, () => {
      expect(computeListCost(c.model, c.t)).toBeCloseTo(c.expected, 6);
    });
  }
});

describe("frozen: currencyFor == model_prices.currency_for", () => {
  const cases: Array<[string | null, string]> = [
    ["claude-sonnet-4-6", "USD"],
    ["deepseek-v4-pro", "CNY"],
    ["kimi-k2.6", "CNY"],
    ["deepseek/deepseek-chat", "USD"],
    ["totally-unknown-model-xyz", "USD"], // FIX-162: unknown → USD, not the default's CNY
    [null, "USD"],
  ];
  for (const [model, expected] of cases) {
    it(`currency_for(${model ?? "None"})`, () => {
      expect(currencyFor(model)).toBe(expected);
    });
  }
});
