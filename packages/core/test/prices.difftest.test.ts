/**
 * diff-test: @roll/core prices (computeListCost / currencyFor) vs the frozen
 * python oracle `lib/model_prices.py` (compute_list_cost / currency_for).
 *
 * The oracle loads the same versioned snapshots under `lib/prices/`, so both
 * sides read identical price data on the frozen branch. We spawn a tiny python
 * driver that imports model_prices and prints the value, then value-compare to
 * the TS port across several models — including unknown-model fallback and a
 * CNY-currency model.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeListCost, currencyFor } from "../src/index.js";

const REPO = resolve(__dirname, "../../..");
const LIB = `${REPO}/lib`;

interface Tokens {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
}

/** Spawn python: import model_prices and print compute_list_cost(model, **kw). */
function pyCost(model: string | null, t: Tokens): number {
  const py = [
    "import sys, importlib.util",
    `spec = importlib.util.spec_from_file_location('model_prices', '${LIB}/model_prices.py')`,
    "mp = importlib.util.module_from_spec(spec); spec.loader.exec_module(mp)",
    `m = ${model === null ? "None" : `'${model}'`}`,
    `print(mp.compute_list_cost(m, input_tokens=${t.input_tokens ?? 0}, ` +
      `output_tokens=${t.output_tokens ?? 0}, ` +
      `cache_creation_tokens=${t.cache_creation_tokens ?? 0}, ` +
      `cache_read_tokens=${t.cache_read_tokens ?? 0}))`,
  ].join("\n");
  const out = execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim();
  return Number(out);
}

/** Spawn python: import model_prices and print currency_for(model). */
function pyCurrency(model: string | null): string {
  const py = [
    "import sys, importlib.util",
    `spec = importlib.util.spec_from_file_location('model_prices', '${LIB}/model_prices.py')`,
    "mp = importlib.util.module_from_spec(spec); spec.loader.exec_module(mp)",
    `m = ${model === null ? "None" : `'${model}'`}`,
    "print(mp.currency_for(m))",
  ].join("\n");
  return execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim();
}

describe("diff-test: prices.computeListCost == model_prices.compute_list_cost", () => {
  const cases: { model: string | null; t: Tokens }[] = [
    { model: "claude-sonnet-4-6", t: { input_tokens: 15300, output_tokens: 3120 } },
    { model: "claude-opus-4-7", t: { input_tokens: 1_000_000, output_tokens: 500_000 } },
    {
      model: "deepseek-v4-pro",
      t: { input_tokens: 200_000, output_tokens: 80_000, cache_read_tokens: 50_000 },
    },
    { model: "kimi-k2.6", t: { input_tokens: 42_000, output_tokens: 9_000 } },
    // vendor-prefixed proxy name (pi) — exercises the `vendor/` strip path.
    { model: "deepseek/deepseek-chat", t: { input_tokens: 10_000, output_tokens: 2_000 } },
    // unknown model → snapshot default fallback (both sides must agree).
    { model: "totally-unknown-model-xyz", t: { input_tokens: 12_345, output_tokens: 678 } },
    // null model → default model rates.
    { model: null, t: { input_tokens: 5000, output_tokens: 1000 } },
    // zero tokens → 0 on both sides.
    { model: "claude-sonnet-4-6", t: {} },
  ];

  for (const c of cases) {
    it(`compute_list_cost(${c.model ?? "None"}, ${JSON.stringify(c.t)})`, () => {
      const py = pyCost(c.model, c.t);
      const ts = computeListCost(c.model, c.t);
      expect(ts).toBeCloseTo(py, 6);
    });
  }
});

describe("diff-test: prices.currencyFor == model_prices.currency_for", () => {
  const models: (string | null)[] = [
    "claude-sonnet-4-6", // USD
    "deepseek-v4-pro", // CNY (deepseek snapshot)
    "kimi-k2.6", // CNY (kimi snapshot)
    "deepseek/deepseek-chat", // CNY via vendor strip
    "totally-unknown-model-xyz", // FIX-162: unknown → USD, not the default's CNY
    null, // None → fallback default's currency
  ];
  for (const m of models) {
    it(`currency_for(${m ?? "None"})`, () => {
      expect(currencyFor(m)).toBe(pyCurrency(m));
    });
  }
});
