import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RollEvent } from "@roll/spec";
import { buildLoopDigestModel, buildMorningReportModel } from "@roll/core";
import { renderLoopDigestHtml, renderMorningReportHtml, writeLatestLoopDigest, writeLatestMorningReport } from "../src/lib/morning-report.js";
import { cycleTruthFromRow, outcomeToPanel, rowDelivered } from "../src/lib/truth-adapter.js";

function tempProject(): { root: string; events: string; runs: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "roll-loop-digest-")));
  const loop = join(root, ".roll", "loop");
  mkdirSync(loop, { recursive: true });
  return { root, events: join(loop, "events.ndjson"), runs: join(loop, "runs.jsonl") };
}

function writeEvents(path: string, events: RollEvent[]): void {
  writeFileSync(path, events.map((ev) => JSON.stringify(ev)).join("\n") + "\n", "utf8");
}

describe("US-EVID-016 morning report renderer", () => {
  it("renders a one-screen bilingual operational summary with neutral Loop Digest wording", () => {
    const html = renderLoopDigestHtml({
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
      degraded: false,
      degradedReasons: [],
    });
    expect(html).toContain("Loop Digest");
    expect(html).not.toContain("Morning Report");
    expect(html).not.toContain("夜间运行晨报");
    expect(html).toContain("US-A");
    expect(html).toContain("PAUSED");
    expect(html).toContain("$0.2500");
  });

  it("renderMorningReportHtml is the same function as renderLoopDigestHtml", () => {
    expect(renderMorningReportHtml).toBe(renderLoopDigestHtml);
  });

  it("writeLatestMorningReport is the same function as writeLatestLoopDigest", () => {
    expect(writeLatestMorningReport).toBe(writeLatestLoopDigest);
  });

  it("writes primary loop digest + compatibility alias and appends a report:loop-digest event", () => {
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
    const latest = writeLatestLoopDigest(p.root, p.events, p.runs, Date.parse("2026-06-08T12:00:00Z") / 1000);
    expect(latest).toBe(join(p.root, ".roll", "reports", "loop", "latest.html"));
    expect(existsSync(latest)).toBe(true);
    expect(existsSync(join(p.root, ".roll", "reports", "loop", "2026-06-08.html"))).toBe(true);
    // Compatibility: legacy morning path also written
    expect(existsSync(join(p.root, ".roll", "reports", "morning", "latest.html"))).toBe(true);
    expect(readFileSync(latest, "utf8")).toContain("US-A");
    expect(readFileSync(latest, "utf8")).toContain("Loop Digest");
    expect(readFileSync(p.events, "utf8")).toContain('"type":"report:loop-digest"');
  });

  it("US-TRUTH-010: normal run rows still render delivered through the truth adapter", () => {
    const p = tempProject();
    const base = Date.parse("2026-06-08T10:00:00Z") / 1000;
    writeEvents(p.events, [
      {
        type: "cycle:end",
        cycleId: "C-DONE",
        outcome: "delivered",
        cost: { cycleId: "C-DONE", agent: "claude", model: "sonnet", tokensIn: 1, tokensOut: 1, estimatedCost: 0.03, revertCount: 0, effectiveCost: 0.03 },
        ts: base + 120,
      },
    ]);
    writeFileSync(
      p.runs,
      `${JSON.stringify({ cycle_id: "C-DONE", story_id: "US-DONE", status: "done", outcome: "delivered", cost_usd: 0.03, ts: "2026-06-08T10:10:00Z" })}\n`,
      "utf8",
    );

    const latest = writeLatestLoopDigest(p.root, p.events, p.runs, base + 7200);
    const html = readFileSync(latest, "utf8");
    expect(html).toContain("US-DONE");
    expect(html).toContain("$0.0300");
  });

  it("US-TRUTH-010: a failed row with MERGED PR evidence is delivered by cycle truth", () => {
    const base = Date.parse("2026-06-08T10:00:00Z") / 1000;
    const run = {
      cycle_id: "C-PHANTOM",
      story_id: "US-MERGED",
      status: "failed",
      outcome: "failed",
      cost_usd: 0.02,
      ts: "2026-06-08T10:10:00Z",
    };
    const model = buildLoopDigestModel([], [run], {
      windowStart: base,
      windowEnd: base + 7200,
      runDelivered: (row, nowSec) => {
        const truth = cycleTruthFromRow(row, {
          nowSec,
          branchEvidence: { state: "MERGED", mergedAtSec: base - 7200 },
        });
        return outcomeToPanel(truth.outcome, truth.state) === "done";
      },
    });

    expect(rowDelivered(run, base + 7200)).toBe(false);
    expect(model.deliveredStories).toEqual(["US-MERGED"]);
    expect(model.degraded).toBe(true);
    expect(model.degradedReasons).toEqual(["cycles_zero_with_delivered"]);
    expect(renderLoopDigestHtml(model)).toContain("DEGRADED");
  });

  it("FIX-1202: renders degraded digest state and appends an alert event for contradictory data", () => {
    const p = tempProject();
    const base = Date.parse("2026-07-03T12:00:00Z") / 1000;
    writeEvents(p.events, []);
    writeFileSync(
      p.runs,
      `${JSON.stringify({ cycle_id: "C-ORPHAN", story_id: "FIX-1202", status: "done", outcome: "delivered", ts: "2026-07-03T10:00:00Z" })}\n`,
      "utf8",
    );

    const latest = writeLatestLoopDigest(p.root, p.events, p.runs, base);
    const html = readFileSync(latest, "utf8");
    const events = readFileSync(p.events, "utf8");

    expect(html).toContain("DEGRADED");
    expect(html).toContain("cycles_zero_with_delivered");
    expect(html).toContain("FIX-1202");
    expect(events).toContain('"type":"alert:notify"');
    expect(events).toContain('"channel":"loop-digest"');
  });

  it("FIX-1202: does not append duplicate degraded alerts for unchanged reasons", () => {
    const p = tempProject();
    const base = Date.parse("2026-07-03T12:00:00Z") / 1000;
    writeEvents(p.events, []);
    writeFileSync(
      p.runs,
      `${JSON.stringify({ cycle_id: "C-ORPHAN", story_id: "FIX-1202", status: "done", outcome: "delivered", ts: "2026-07-03T10:00:00Z" })}\n`,
      "utf8",
    );

    writeLatestLoopDigest(p.root, p.events, p.runs, base);
    writeLatestLoopDigest(p.root, p.events, p.runs, base + 60);
    const events = readFileSync(p.events, "utf8");

    expect((events.match(/"type":"alert:notify"/g) ?? []).length).toBe(1);
    expect((events.match(/"type":"report:loop-digest"/g) ?? []).length).toBe(2);
    expect(existsSync(join(p.root, ".roll", "reports", "loop", "degraded-state.json"))).toBe(true);
  });
});
