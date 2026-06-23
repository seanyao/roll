/**
 * Unit tests for AgentRouter: tier classification, slot resolution + fallback
 * chain, in-tier nudge, and pre-spawn availability fallback.
 */
import { describe, expect, it } from "vitest";
import {
  classifyComplexity,
  hitRateKey,
  nudgeWithinTier,
  resolveFallback,
  resolveRoute,
  type FallbackDeps,
  type HitRates,
  type RouteDeps,
  type RouteSlot,
} from "../src/index.js";

describe("classifyComplexity", () => {
  it("boundaries", () => {
    expect(classifyComplexity(8)).toBe("easy");
    expect(classifyComplexity(9)).toBe("default");
    expect(classifyComplexity(20)).toBe("default");
    expect(classifyComplexity(21)).toBe("hard");
    expect(classifyComplexity(0)).toBe("easy");
  });
  it("missing/illegal → default", () => {
    expect(classifyComplexity(undefined)).toBe("default");
    expect(classifyComplexity(null)).toBe("default");
    expect(classifyComplexity("foo")).toBe("default");
    expect(classifyComplexity(-5)).toBe("default");
    expect(classifyComplexity("12")).toBe("default");
    expect(classifyComplexity("5")).toBe("easy");
  });
});

describe("nudgeWithinTier", () => {
  it("disabled → identity", () => {
    const r = nudgeWithinTier("claude", ["kimi"], "US", {}, { enabled: false });
    expect(r.agent).toBe("claude");
    expect(r.rationale).toContain("disabled");
  });

  it("no eligible combos (below floor) → keep slot", () => {
    const hr: HitRates = { [hitRateKey("kimi", "US")]: { hit_rate: 0.99, sample_n: 3 } };
    const r = nudgeWithinTier("claude", ["kimi"], "US", hr);
    expect(r.agent).toBe("claude");
    expect(r.rationale).toContain("n<8");
  });

  it("best eligible hit-rate wins over slot", () => {
    const hr: HitRates = {
      [hitRateKey("claude", "US")]: { hit_rate: 0.8, sample_n: 10 },
      [hitRateKey("kimi", "US")]: { hit_rate: 0.95, sample_n: 12 },
    };
    const r = nudgeWithinTier("claude", ["kimi"], "US", hr);
    expect(r.agent).toBe("kimi");
    expect(r.rationale).toContain("prefer kimi");
  });

  it("tie breaks to the slot agent (index 0)", () => {
    const hr: HitRates = {
      [hitRateKey("claude", "US")]: { hit_rate: 0.9, sample_n: 10 },
      [hitRateKey("kimi", "US")]: { hit_rate: 0.9, sample_n: 10 },
    };
    const r = nudgeWithinTier("claude", ["kimi"], "US", hr);
    expect(r.agent).toBe("claude");
    expect(r.rationale).toContain("slot kept");
  });

  it("empty slot agent → skip", () => {
    expect(nudgeWithinTier("", ["kimi"], "US", {}).agent).toBe("");
  });
});

/** A slot value can be given as a bare agent string (back-compat: `{ agent }`)
 *  or a full `{ agent, model? }` for the model-carrying cases. */
type SlotInput = string | RouteSlot;

function routeDeps(slots: Partial<Record<string, SlotInput>>, first?: string): RouteDeps {
  return {
    readSlot: (s) => {
      const v = slots[s];
      if (v === undefined) return undefined;
      return typeof v === "string" ? { agent: v } : v;
    },
    firstInstalled: () => first,
  };
}

describe("resolveRoute slot chain", () => {
  it("uses the tier slot when present", () => {
    const d = routeDeps({ easy: "kimi", default: "pi" });
    expect(resolveRoute("easy", d)).toEqual({ agent: "kimi", tier: "easy" });
  });

  it("falls back to default slot when tier slot empty", () => {
    const d = routeDeps({ default: "pi" });
    expect(resolveRoute("hard", d)).toEqual({ agent: "pi", tier: "hard" });
  });

  it("falls back to firstInstalled with a warning when both empty", () => {
    const d = routeDeps({}, "pi");
    const r = resolveRoute("hard", d);
    expect(r.agent).toBe("pi");
    expect(r.warning).toContain("first installed agent 'pi'");
  });

  it("throws when nothing resolves", () => {
    expect(() => resolveRoute("hard", routeDeps({}))).toThrow(/no agent resolvable/);
  });

  it("default tier never reads the default slot twice (no double fallback)", () => {
    // tier=default with empty default slot → straight to firstInstalled.
    const d = routeDeps({}, "kimi");
    expect(resolveRoute("default", d).agent).toBe("kimi");
  });

  it("applies the nudge after slot resolution", () => {
    const d = routeDeps({ easy: "pi" });
    const hr: HitRates = {
      [hitRateKey("pi", "US")]: { hit_rate: 0.5, sample_n: 10 },
      [hitRateKey("kimi", "US")]: { hit_rate: 0.99, sample_n: 10 },
    };
    const r = resolveRoute("easy", d, { storyType: "US", candidates: ["kimi"], hitRates: hr });
    expect(r.agent).toBe("kimi");
  });
});

describe("resolveRoute carries the slot model (US: explicit --model wiring)", () => {
  it("threads the tier slot's model into RouteDecision", () => {
    const d = routeDeps({ hard: { agent: "pi", model: "bailian/glm-5.2" } });
    expect(resolveRoute("hard", d)).toEqual({
      agent: "pi",
      tier: "hard",
      model: "bailian/glm-5.2",
    });
  });

  it("preserves the effort suffix (`:thinking`) in the model string verbatim", () => {
    const d = routeDeps({ default: { agent: "pi", model: "deepseek/deepseek-v4-pro:high" } });
    expect(resolveRoute("default", d).model).toBe("deepseek/deepseek-v4-pro:high");
  });

  it("a model-less slot carries NO model (back-compat: omitted, not empty)", () => {
    const d = routeDeps({ easy: "kimi" });
    const r = resolveRoute("easy", d);
    expect(r.model).toBeUndefined();
    expect(r).toEqual({ agent: "kimi", tier: "easy" });
  });

  it("fallback chain carries the DEFAULT slot's model when the tier slot is empty", () => {
    const d = routeDeps({ default: { agent: "pi", model: "bailian/glm-5.2" } });
    const r = resolveRoute("hard", d);
    expect(r.agent).toBe("pi");
    expect(r.model).toBe("bailian/glm-5.2");
  });

  it("the tier slot's model wins over the default slot's model (no cross-contamination)", () => {
    const d = routeDeps({
      hard: { agent: "pi", model: "bailian/glm-5.2" },
      default: { agent: "kimi", model: "moonshot/kimi-k2" },
    });
    expect(resolveRoute("hard", d).model).toBe("bailian/glm-5.2");
  });

  it("firstInstalled last-resort carries no model (it has no slot config)", () => {
    const d = routeDeps({}, "pi");
    expect(resolveRoute("hard", d).model).toBeUndefined();
  });

  it("a nudge to a DIFFERENT agent drops the original slot's model", () => {
    const d = routeDeps({ easy: { agent: "pi", model: "bailian/glm-5.2" } });
    const hr: HitRates = {
      [hitRateKey("pi", "US")]: { hit_rate: 0.5, sample_n: 10 },
      [hitRateKey("kimi", "US")]: { hit_rate: 0.99, sample_n: 10 },
    };
    const r = resolveRoute("easy", d, { storyType: "US", candidates: ["kimi"], hitRates: hr });
    expect(r.agent).toBe("kimi");
    expect(r.model).toBeUndefined();
  });

  it("a nudge that KEEPS the slot agent preserves its model", () => {
    const d = routeDeps({ easy: { agent: "pi", model: "bailian/glm-5.2" } });
    const hr: HitRates = {
      [hitRateKey("pi", "US")]: { hit_rate: 0.99, sample_n: 10 },
      [hitRateKey("kimi", "US")]: { hit_rate: 0.1, sample_n: 10 },
    };
    const r = resolveRoute("easy", d, { storyType: "US", candidates: ["kimi"], hitRates: hr });
    expect(r.agent).toBe("pi");
    expect(r.model).toBe("bailian/glm-5.2");
  });

  it("purity: same inputs → same decision; readSlot is the ONLY model source", () => {
    let calls = 0;
    const deps: RouteDeps = {
      readSlot: (s) => {
        calls += 1;
        return s === "hard" ? { agent: "pi", model: "bailian/glm-5.2" } : undefined;
      },
      firstInstalled: () => undefined,
    };
    const a = resolveRoute("hard", deps);
    const b = resolveRoute("hard", deps);
    expect(a).toEqual(b);
    expect(a).toEqual({ agent: "pi", tier: "hard", model: "bailian/glm-5.2" });
    expect(calls).toBeGreaterThan(0); // model came through the injected port only.
  });
});

function fbDeps(avail: Record<string, boolean>, fallback?: string): FallbackDeps {
  return {
    isAvailable: (a) => avail[a] ?? false,
    fallbackSlot: () => fallback,
  };
}

describe("resolveFallback (pre-spawn availability)", () => {
  it("primary available → primary", () => {
    expect(resolveFallback("claude", fbDeps({ claude: true }, "pi"))).toEqual({
      kind: "primary",
      agent: "claude",
    });
  });

  it("primary down + fallback up → fallback with fallbackFrom", () => {
    expect(resolveFallback("claude", fbDeps({ claude: false, pi: true }, "pi"))).toEqual({
      kind: "fallback",
      agent: "pi",
      fallbackFrom: "claude",
    });
  });

  it("primary down + fallback down → exhausted (with fallback name)", () => {
    expect(resolveFallback("claude", fbDeps({ claude: false, pi: false }, "pi"))).toEqual({
      kind: "exhausted",
      primary: "claude",
      fallback: "pi",
    });
  });

  it("primary down + no fallback slot → exhausted (no fallback name)", () => {
    expect(resolveFallback("claude", fbDeps({ claude: false }))).toEqual({
      kind: "exhausted",
      primary: "claude",
    });
  });

  it("empty primary throws", () => {
    expect(() => resolveFallback("", fbDeps({}))).toThrow(/primary agent required/);
  });
});
