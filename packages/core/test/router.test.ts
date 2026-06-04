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

function routeDeps(slots: Partial<Record<string, string>>, first?: string): RouteDeps {
  return {
    readSlot: (s) => slots[s],
    firstInstalled: () => first,
  };
}

describe("resolveRoute slot chain", () => {
  it("uses the tier slot when present", () => {
    const d = routeDeps({ easy: "kimi", default: "claude" });
    expect(resolveRoute("easy", d)).toEqual({ agent: "kimi", tier: "easy" });
  });

  it("falls back to default slot when tier slot empty", () => {
    const d = routeDeps({ default: "claude" });
    expect(resolveRoute("hard", d)).toEqual({ agent: "claude", tier: "hard" });
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
    const d = routeDeps({}, "claude");
    expect(resolveRoute("default", d).agent).toBe("claude");
  });

  it("applies the nudge after slot resolution", () => {
    const d = routeDeps({ easy: "claude" });
    const hr: HitRates = {
      [hitRateKey("claude", "US")]: { hit_rate: 0.5, sample_n: 10 },
      [hitRateKey("kimi", "US")]: { hit_rate: 0.99, sample_n: 10 },
    };
    const r = resolveRoute("easy", d, { storyType: "US", candidates: ["kimi"], hitRates: hr });
    expect(r.agent).toBe("kimi");
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
