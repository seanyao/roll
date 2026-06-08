/**
 * US-PAIR-006 — `roll pair status` activity/cost render (pure helper).
 *
 * The owner's top priority is cost observability: `roll pair status` must show
 * "pairings to date: N, by peer (codex×K, kimi×J…), total cost $X, M findings".
 * The aggregation is pure in core (aggregatePairingCost, tested there); this
 * tests the thin bilingual renderer the CLI prints, including the zero-activity
 * case (never crash on an empty stream).
 */
import { describe, expect, it } from "vitest";
import type { PairingCostSummary } from "@roll/core";
import { renderPairingActivity } from "../src/commands/pair.js";

describe("renderPairingActivity", () => {
  it("renders pairings, by-peer breakdown, total cost + findings (bilingual)", () => {
    const summary: PairingCostSummary = {
      pairings: 3,
      byPeer: { codex: 2, kimi: 1 },
      totalCost: 0.035,
      totalFindings: 4,
      noneAvailable: 1,
    };
    const out = renderPairingActivity(summary, { noColor: true });
    expect(out).toContain("3"); // pairings to date
    expect(out).toContain("codex×2");
    expect(out).toContain("kimi×1");
    expect(out).toContain("$0.04"); // total cost, 2dp
    expect(out).toContain("4"); // findings
    // bilingual: English + Chinese on separate lines (project convention)
    expect(out).toMatch(/pairings to date/i);
    expect(out).toMatch(/结对/);
  });

  it("zero-activity is a clean line, not a crash", () => {
    const out = renderPairingActivity(
      { pairings: 0, byPeer: {}, totalCost: 0, totalFindings: 0, noneAvailable: 0 },
      { noColor: true },
    );
    expect(out).toMatch(/pairings to date:?\s*0/i);
    expect(out).toContain("$0.00");
  });
});
