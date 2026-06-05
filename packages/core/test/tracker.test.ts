/**
 * Unit tests for the CostTracker pure folding logic that has no bash/py oracle:
 * `toCycleCost` (CycleCost record per spec cycle.ts, effectiveCost includes
 * reverts) and `aggregateSessions` (the SUM loop + zero-token "n/a, not fake
 * zero" rule).
 */
import { describe, expect, it } from "vitest";
import {
  type AgentUsage,
  type SessionAgg,
  aggregateSessions,
  sumClaudeStream,
  toCycleCost,
} from "../src/index.js";

describe("toCycleCost", () => {
  const usage: AgentUsage = {
    model: "gpt-4o",
    input_tokens: 100,
    output_tokens: 50,
    cost_list_usd: 0.2,
    duration_ms: null,
  };

  it("zero reverts → effectiveCost == estimatedCost", () => {
    const c = toCycleCost(usage, { cycleId: "cyc-1", agent: "openai", revertCount: 0 });
    expect(c.estimatedCost).toBe(0.2);
    expect(c.effectiveCost).toBe(0.2);
    expect(c.tokensIn).toBe(100);
    expect(c.tokensOut).toBe(50);
    expect(c.model).toBe("gpt-4o");
    expect(c.agent).toBe("openai");
    expect(c.cycleId).toBe("cyc-1");
    expect(c.revertCount).toBe(0);
  });

  it("reverts inflate effectiveCost = estimated × (reverts + 1)", () => {
    const c = toCycleCost(usage, { cycleId: "cyc-2", agent: "openai", revertCount: 3 });
    expect(c.estimatedCost).toBe(0.2);
    expect(c.effectiveCost).toBeCloseTo(0.8, 6);
    expect(c.revertCount).toBe(3);
  });

  it("negative revertCount is clamped to 0", () => {
    const c = toCycleCost(usage, { cycleId: "c", agent: "a", revertCount: -5 });
    expect(c.revertCount).toBe(0);
    expect(c.effectiveCost).toBe(0.2);
  });

  it("computes cost from tokens when adapter gave no cost_list_usd", () => {
    const noCost: AgentUsage = { model: "gpt-4o", input_tokens: 1_000_000, output_tokens: 0 };
    const c = toCycleCost(noCost, { cycleId: "c", agent: "openai", revertCount: 0 });
    // gpt-4o is unknown in the frozen snapshots → default-model fallback; just
    // assert a finite non-negative number and effective == estimated (0 reverts).
    expect(Number.isFinite(c.estimatedCost)).toBe(true);
    expect(c.estimatedCost).toBeGreaterThanOrEqual(0);
    expect(c.effectiveCost).toBe(c.estimatedCost);
  });
});

describe("aggregateSessions", () => {
  const a: SessionAgg = {
    model: "deepseek-v4-pro",
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_tokens: 10,
    cache_read_tokens: 5,
    cost_reported: 0.1,
  };
  const b: SessionAgg = {
    model: "other",
    input_tokens: 200,
    output_tokens: 80,
    cache_creation_tokens: 0,
    cache_read_tokens: 20,
    cost_reported: 0.3,
  };

  it("sums tokens, first non-null model wins, cost_reported sums", () => {
    const agg = aggregateSessions([a, b], "fallback");
    expect(agg).not.toBeNull();
    expect(agg?.model).toBe("deepseek-v4-pro");
    expect(agg?.input_tokens).toBe(300);
    expect(agg?.output_tokens).toBe(130);
    expect(agg?.cache_creation_tokens).toBe(10);
    expect(agg?.cache_read_tokens).toBe(25);
    expect(agg?.cost_reported).toBeCloseTo(0.4, 6);
  });

  it("all-null → null", () => {
    expect(aggregateSessions([null, null], "fb")).toBeNull();
  });

  it("zero tokens across all files → null (n/a, not fake zero)", () => {
    const zero: SessionAgg = {
      model: "m",
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      cost_reported: 0,
    };
    expect(aggregateSessions([zero], "fb")).toBeNull();
  });

  it("fills a still-null model with the default on success", () => {
    const noModel: SessionAgg = { ...a, model: null };
    const agg = aggregateSessions([noModel], "the-default");
    expect(agg?.model).toBe("the-default");
  });
});

describe("sumClaudeStream — claude stream-json usage accumulation", () => {
  // Mirror the real claude --output-format stream-json wire shape: assistant
  // `message.usage` per turn (result.usage is last-turn only, so loop-fmt
  // accumulates across turns) + a final `result` carrying total_cost_usd.
  const lines = [
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-8",
        usage: {
          input_tokens: 100,
          output_tokens: 40,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 5,
        },
      },
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-8",
        usage: {
          input_tokens: 50,
          output_tokens: 20,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 200,
        },
      },
    }),
    JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.1234, duration_ms: 9000 }),
  ];

  it("accumulates tokens across every assistant turn (not just the last)", () => {
    const u = sumClaudeStream(lines);
    expect(u).not.toBeNull();
    expect(u?.input_tokens).toBe(150);
    expect(u?.output_tokens).toBe(60);
    expect(u?.cache_creation_tokens).toBe(10);
    expect(u?.cache_read_tokens).toBe(205);
    expect(u?.model).toBe("claude-opus-4-8");
    // claude's self-reported cost is carried for audit (price-table cost is the
    // authoritative number toCycleCost computes downstream).
    expect(u?.cost_reported).toBeCloseTo(0.1234, 6);
  });

  it("feeds toCycleCost to a numeric, finite estimatedCost", () => {
    const u = sumClaudeStream(lines);
    expect(u).not.toBeNull();
    const c = toCycleCost(u as AgentUsage, { cycleId: "cyc-claude", agent: "claude", revertCount: 0 });
    expect(Number.isFinite(c.estimatedCost)).toBe(true);
    expect(c.tokensIn).toBe(150);
    expect(c.tokensOut).toBe(60);
    expect(c.model).toBe("claude-opus-4-8");
  });

  it("no assistant usage block → null (n/a, never fake zero)", () => {
    expect(sumClaudeStream([JSON.stringify({ type: "result", total_cost_usd: 0 })])).toBeNull();
    expect(sumClaudeStream([])).toBeNull();
    expect(sumClaudeStream(["not json", ""])).toBeNull();
  });
});
