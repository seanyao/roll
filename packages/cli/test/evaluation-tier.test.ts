/**
 * US-CYCLE-008 — evaluation risk-tier resolution.
 *
 * The tier decides evaluation DEPTH at cycle time and is read ONLY from the
 * card's lint-validated design-contract:
 *   - low → single evaluator (default serial path);
 *   - high → parallel adversarial panel (fan-out);
 *   - new-regime card with no valid tier → fail-loud "missing" (NOT default low);
 *   - legacy card with no tier → "legacy" (default serial, byte-compatible);
 *   - NO supervisor/flag/env downgrade path (anti-Goodhart).
 */
import { describe, expect, it } from "vitest";
import { resolveEvaluationTier, tierFanoutReason } from "../src/lib/evaluation-tier.js";

/** A spec with the given frontmatter body between --- fences + a minimal contract. */
function spec(fm: string): string {
  return `---\n${fm}\n---\n\n# card\n\n## Evaluation contract\n**Expected evidence:**\n- test\n`;
}

describe("resolveEvaluationTier — tier routing (AC1)", () => {
  it("low → single-evaluator tier", () => {
    const d = resolveEvaluationTier(spec("id: US-X-001\nest_min: 10\nrisk_tier: low"), "US-X-001");
    expect(d).toEqual({ kind: "tier", tier: "low" });
  });

  it("high → panel tier", () => {
    const d = resolveEvaluationTier(spec("id: US-X-002\nest_min: 20\nrisk_tier: high"), "US-X-002");
    expect(d).toEqual({ kind: "tier", tier: "high" });
  });

  it("high tier → high_risk_tier_card fan-out reason; low → none", () => {
    expect(tierFanoutReason("high")).toBe("high_risk_tier_card");
    expect(tierFanoutReason("low")).toBeUndefined();
    expect(tierFanoutReason(undefined)).toBeUndefined();
  });
});

describe("resolveEvaluationTier — fail-loud vs legacy (AC5)", () => {
  it("new-regime card (declares est_min) with NO risk_tier → missing (fail-loud, not low)", () => {
    const d = resolveEvaluationTier(spec("id: US-X-003\nest_min: 15"), "US-X-003");
    expect(d).toEqual({ kind: "missing" });
  });

  it("new-regime card with an INVALID risk_tier value → missing (matches lint rejection)", () => {
    const d = resolveEvaluationTier(spec("id: US-X-004\nest_min: 15\nrisk_tier: medium"), "US-X-004");
    expect(d).toEqual({ kind: "missing" });
  });

  it("card created on/after the cutover with no tier → missing (mint channel closes the dodge)", () => {
    const d = resolveEvaluationTier(spec("id: US-X-005\ncreated: 2099-01-01"), "US-X-005");
    expect(d).toEqual({ kind: "missing" });
  });

  it("legacy card (old created:, no granularity fields) with no tier → legacy (default serial, not blocked)", () => {
    const d = resolveEvaluationTier(spec("id: US-OLD-001\ncreated: 2020-01-01"), "US-OLD-001");
    expect(d).toEqual({ kind: "legacy" });
  });

  it("bare hand-authored legacy spec (no created:, no granularity field) → legacy", () => {
    const d = resolveEvaluationTier(spec("id: US-OLD-002\ntitle: something"), "US-OLD-002");
    expect(d).toEqual({ kind: "legacy" });
  });

  it("IDEA-* cards are exempt from the new regime → legacy even after cutover", () => {
    const d = resolveEvaluationTier(spec("id: IDEA-9\ncreated: 2099-01-01"), "IDEA-9");
    expect(d).toEqual({ kind: "legacy" });
  });
});

describe("resolveEvaluationTier — no downgrade path (AC3, anti-Goodhart)", () => {
  it("the resolver reads ONLY the spec — no env var can downgrade a high card", () => {
    // Simulate a supervisor trying every plausible override channel.
    const originals: Record<string, string | undefined> = {};
    for (const k of ["ROLL_RISK_TIER", "ROLL_EVAL_TIER", "ROLL_TIER", "RISK_TIER", "ROLL_FANOUT"]) {
      originals[k] = process.env[k];
      process.env[k] = "low";
    }
    try {
      const highSpec = spec("id: US-X-006\nest_min: 20\nrisk_tier: high");
      // Despite every env var set to "low", a high card stays high.
      expect(resolveEvaluationTier(highSpec, "US-X-006")).toEqual({ kind: "tier", tier: "high" });
      expect(tierFanoutReason("high")).toBe("high_risk_tier_card");
    } finally {
      for (const k of Object.keys(originals)) {
        if (originals[k] === undefined) delete process.env[k];
        else process.env[k] = originals[k];
      }
    }
  });

  it("resolveEvaluationTier accepts no override argument (structural absence)", () => {
    // The signature is (spec, id?) — arity 2. There is no third override channel
    // through which a caller could inject a downgraded tier.
    expect(resolveEvaluationTier.length).toBeLessThanOrEqual(2);
  });
});
