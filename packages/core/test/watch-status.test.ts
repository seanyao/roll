import { describe, expect, it } from "vitest";
import type { RollEvent } from "@roll/spec";
import { renderWatchStatusFromEventLines, summarizeWatchEvents } from "../src/loop/watch-status.js";

function line(ev: RollEvent | Record<string, unknown>): string {
  return JSON.stringify(ev);
}

describe("watch-status — default loop watch summary", () => {
  const base: RollEvent[] = [
    { type: "cycle:start", cycleId: "20260619-046-alpha", storyId: "US-LOOP-046", agent: "codex", model: "gpt-5", ts: 1_800_000_000_000 },
    { type: "cycle:phase", cycleId: "20260619-046-alpha", phase: "execute", ts: 1_800_000_060_000 },
    { type: "cycle:tcr", cycleId: "20260619-046-alpha", commitHash: "abcdef123456", message: "tcr: status summary", ts: 1_800_000_120_000 },
    { type: "cycle:stdout", cycleId: "20260619-046-alpha", data: "heartbeat: building status layer", ts: 1_800_000_180_000 },
  ];

  it("summarizes current phase, quiet time, story, agent, cycle, TCR count, and last signal", () => {
    const rendered = renderWatchStatusFromEventLines(base.map(line), 1_800_000_480_000);
    expect(rendered).toBe(
      "status  phase execute · quiet 5m · US-LOOP-046 · codex · cycle 20260619-046-a · 1 TCR · last building status layer · outcome unknown/no end event",
    );
  });

  it("explains a known cycle outcome when the stream has an end event", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        ...base.map(line),
        line({ type: "cycle:end", cycleId: "20260619-046-alpha", outcome: "delivered", cost: { usd: 0.2 }, ts: 1_800_000_240_000 }),
      ],
      1_800_000_480_000,
    );
    expect(rendered).toContain("last cycle delivered");
    expect(rendered).toContain("outcome delivered");
  });

  it("returns null for missing or fully malformed event streams", () => {
    expect(renderWatchStatusFromEventLines([], 1_800_000_480_000)).toBeNull();
    expect(renderWatchStatusFromEventLines(["", "{not json", "{\"type\":\"x\"}"], 1_800_000_480_000)).toBeNull();
  });

  it("strips terminal control sequences from status output", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line(base[0]!),
        line({ type: "cycle:stdout", cycleId: "20260619-046-alpha", data: "\u001b[31mheartbeat: building \u001b[1mred\u001b[0m", ts: 1_800_000_180_000 }),
      ],
      1_800_000_181_000,
    );
    expect(rendered).toContain("last building red");
    expect(rendered).not.toContain("\u001b");
  });

  it("updates count and last signal when later event rows arrive", () => {
    const first = summarizeWatchEvents(base.slice(0, 3).map(line));
    const second = summarizeWatchEvents([...base.map(line), line({ type: "cycle:tcr", cycleId: "20260619-046-alpha", commitHash: "123456789abc", message: "tcr: second", ts: 1_800_000_240_000 })]);
    expect(first?.tcrCount).toBe(1);
    expect(first?.lastSignal).toBe("tcr abcdef123 tcr: status summary");
    expect(second?.tcrCount).toBe(2);
    expect(second?.lastSignal).toBe("tcr 123456789 tcr: second");
  });
});
