/**
 * US-EVID-026 — screenshot_exempt rate observability. Counts exempt vs total
 * cards overall + per epic; a naked `true` is not a real exemption.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exemptionStats, exemptionSummaryLine, renderExemptionSignal, specIsExempt } from "../src/runner/exemption-stats.js";

function project(cards: Array<{ epic: string; id: string; exemptReason?: string; naked?: boolean }>): string {
  const root = mkdtempSync(join(tmpdir(), "roll-evid026-"));
  for (const c of cards) {
    const dir = join(root, ".roll", "features", c.epic, c.id);
    mkdirSync(dir, { recursive: true });
    const line = c.naked ? "screenshot_exempt: true\n" : c.exemptReason ? `screenshot_exempt: ${c.exemptReason}\n` : "";
    writeFileSync(join(dir, "spec.md"), `---\nid: ${c.id}\ntitle: t\n${line}---\n\n# ${c.id}\n`, "utf8");
  }
  return root;
}

describe("specIsExempt", () => {
  it("real reason ⇒ exempt; naked true/absent ⇒ not exempt", () => {
    expect(specIsExempt("---\nscreenshot_exempt: backend; tests are evidence\n---\n")).toBe(true);
    expect(specIsExempt("---\nscreenshot_exempt: true\n---\n")).toBe(false);
    expect(specIsExempt("---\nid: x\n---\n")).toBe(false);
  });
});

describe("exemptionStats", () => {
  it("tallies overall + per-epic rate", () => {
    const root = project([
      { epic: "a", id: "US-1", exemptReason: "backend; tests" },
      { epic: "a", id: "US-2" },
      { epic: "b", id: "US-3", exemptReason: "infra; no surface" },
      { epic: "b", id: "US-4", naked: true }, // naked true not counted exempt
    ]);
    const s = exemptionStats(root);
    expect(s.total).toBe(4);
    expect(s.exempt).toBe(2);
    expect(s.rate).toBeCloseTo(0.5);
    expect(s.byEpic).toEqual([
      { epic: "a", total: 2, exempt: 1 },
      { epic: "b", total: 2, exempt: 1 },
    ]);
  });

  it("no features dir ⇒ zeroed (never throws)", () => {
    const s = exemptionStats(mkdtempSync(join(tmpdir(), "roll-evid026-empty-")));
    expect(s).toEqual({ total: 0, exempt: 0, rate: 0, byEpic: [] });
  });

  it("summary line renders percent + counts", () => {
    expect(exemptionSummaryLine({ total: 1117, exempt: 306, rate: 306 / 1117, byEpic: [] })).toBe(
      "screenshot_exempt: 27% (306/1117)",
    );
  });
});

describe("renderExemptionSignal (US-EVID-026 dashboard smell signal)", () => {
  it("empty corpus ⇒ no lines (nothing to surface; keeps fixture-mode dashboard byte-stable)", () => {
    expect(renderExemptionSignal({ total: 0, exempt: 0, rate: 0, byEpic: [] })).toEqual([]);
  });

  it("non-empty ⇒ first line is the overall summary", () => {
    const lines = renderExemptionSignal({
      total: 4,
      exempt: 2,
      rate: 0.5,
      byEpic: [
        { epic: "a", total: 2, exempt: 1 },
        { epic: "b", total: 2, exempt: 1 },
      ],
    });
    expect(lines[0]).toBe("screenshot_exempt: 50% (2/4)");
  });

  it("flags an epic whose exemption rate is a high outlier vs overall", () => {
    const lines = renderExemptionSignal({
      total: 10,
      exempt: 4,
      rate: 0.4,
      byEpic: [
        { epic: "hot", total: 4, exempt: 4 }, // 100% — materially above the 40% overall
        { epic: "cold", total: 6, exempt: 0 }, // 0% — nothing to flag
      ],
    });
    expect(lines.some((l) => l.includes("hot") && l.includes("100%"))).toBe(true);
    expect(lines.some((l) => l.includes("cold"))).toBe(false);
  });

  it("flags a dominant high-exempt epic even though it inflates the overall baseline", () => {
    // "big" is 100% exempt and large enough to drag the overall to 80%. Comparing
    // big's 100% against the all-in 80% is only +20% and would miss it — the very
    // drift we want to catch. The signal must compare an epic against the REST, so
    // big (100% vs the rest's 0%) is flagged.
    const lines = renderExemptionSignal({
      total: 10,
      exempt: 8,
      rate: 0.8,
      byEpic: [
        { epic: "big", total: 8, exempt: 8 },
        { epic: "rest", total: 2, exempt: 0 },
      ],
    });
    expect(lines.some((l) => l.includes("big"))).toBe(true);
  });

  it("never flags a tiny epic (min-cards floor) — one 100%-exempt card is not a signal", () => {
    const lines = renderExemptionSignal({
      total: 21,
      exempt: 1,
      rate: 1 / 21,
      byEpic: [
        { epic: "tiny", total: 1, exempt: 1 }, // 100% but only 1 card — noise, not a trend
        { epic: "bulk", total: 20, exempt: 0 },
      ],
    });
    expect(lines.some((l) => l.includes("tiny"))).toBe(false);
  });
});
