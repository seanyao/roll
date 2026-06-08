import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RollEvent } from "@roll/spec";
import { renderMorningReportHtml, writeLatestMorningReport } from "../src/lib/morning-report.js";

function tempProject(): { root: string; events: string; runs: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "roll-morning-report-")));
  const loop = join(root, ".roll", "loop");
  mkdirSync(loop, { recursive: true });
  return { root, events: join(loop, "events.ndjson"), runs: join(loop, "runs.jsonl") };
}

function writeEvents(path: string, events: RollEvent[]): void {
  writeFileSync(path, events.map((ev) => JSON.stringify(ev)).join("\n") + "\n", "utf8");
}

describe("US-EVID-016 morning report renderer", () => {
  it("renders a one-screen bilingual operational summary", () => {
    const html = renderMorningReportHtml({
      windowStart: 10,
      windowEnd: 20,
      cycles: 2,
      deliveredStories: ["US-A"],
      returnedStories: ["US-B"],
      corrections: 3,
      circuitBreakers: 1,
      paused: true,
      totalCostUsd: 0.25,
      alerts: ["paused"],
    });
    expect(html).toContain("Morning Report");
    expect(html).toContain("夜间运行晨报");
    expect(html).toContain("US-A");
    expect(html).toContain("PAUSED");
    expect(html).toContain("$0.2500");
  });

  it("writes latest + dated reports and appends a report:morning event", () => {
    const p = tempProject();
    const base = Date.parse("2026-06-08T10:00:00Z") / 1000;
    writeEvents(p.events, [
      { type: "cycle:start", cycleId: "c1", storyId: "US-A", agent: "claude", model: "sonnet", ts: base },
      {
        type: "cycle:end",
        cycleId: "c1",
        outcome: "delivered",
        cost: { cycleId: "c1", agent: "claude", model: "sonnet", tokensIn: 1, tokensOut: 1, estimatedCost: 0.01, revertCount: 0, effectiveCost: 0.01 },
        ts: base + 60,
      },
    ]);
    writeFileSync(p.runs, "", "utf8");
    const latest = writeLatestMorningReport(p.root, p.events, p.runs, Date.parse("2026-06-08T12:00:00Z") / 1000);
    expect(latest).toBe(join(p.root, ".roll", "reports", "morning", "latest.html"));
    expect(existsSync(latest)).toBe(true);
    expect(existsSync(join(p.root, ".roll", "reports", "morning", "2026-06-08.html"))).toBe(true);
    expect(readFileSync(latest, "utf8")).toContain("US-A");
    expect(readFileSync(p.events, "utf8")).toContain('"type":"report:morning"');
  });
});
