/**
 * US-EVID-026 — screenshot_exempt rate observability. Counts exempt vs total
 * cards overall + per epic; a naked `true` is not a real exemption.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exemptionStats, exemptionSummaryLine, specIsExempt } from "../src/runner/exemption-stats.js";

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
