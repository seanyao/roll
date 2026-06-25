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

// ── FIX-382: durable fallback ───────────────────────────────────────────────

describe("watch-status — durable cycle lookup (FIX-382)", () => {
  const durable: Record<string, { storyId: string; agent: string }> = {
    "20260622-001-alpha": { storyId: "US-OBS-027", agent: "claude" },
  };

  it("resolves story and agent from durable lookup when window has no cycle:start", () => {
    // Window with phase + tcr + heartbeat but NO cycle:start — tail-window scenario.
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:phase", cycleId: "20260622-001-alpha", phase: "execute", ts: 1_800_000_060_000 }),
        line({ type: "cycle:tcr", cycleId: "20260622-001-alpha", commitHash: "aaa111222333", message: "tcr: fix", ts: 1_800_000_120_000 }),
        line({ type: "cycle:stdout", cycleId: "20260622-001-alpha", data: "heartbeat: working", ts: 1_800_000_180_000 }),
      ],
      1_800_000_480_000,
      durable,
    );
    expect(rendered).toContain("US-OBS-027");
    expect(rendered).toContain("claude");
    expect(rendered).not.toContain("story unknown");
    expect(rendered).not.toContain("agent unknown");
  });

  it("returns unknown when cycleId is not in the durable lookup", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:phase", cycleId: "20260622-002-beta", phase: "execute", ts: 1_800_000_060_000 }),
      ],
      1_800_000_480_000,
      durable,
    );
    expect(rendered).toContain("story unknown");
    expect(rendered).toContain("agent unknown");
  });

  // ── FIX-934: pair:* signal labels in status summary ────────────────────

  it("shows pair:selected as last signal with workingAgent → peer (stage)", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "US-X", agent: "codex", model: "m", ts: 1_000 }),
        line({ type: "pair:selected", cycleId: "c1", workingAgent: "codex", peer: "kimi", stage: "code", ts: 2_000 }),
      ],
      3_000,
    );
    expect(rendered).toContain("last pair codex → kimi (code)");
  });

  it("shows pair:verdict as last signal", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "US-X", agent: "codex", model: "m", ts: 1_000 }),
        line({ type: "pair:verdict", cycleId: "c1", peer: "kimi", verdict: "refine", findings: 3, cost: 0.15, ts: 2_000 }),
      ],
      3_000,
    );
    expect(rendered).toContain("last pair kimi refine (3 findings)");
  });

  it("shows pair:score as last signal", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "US-X", agent: "codex", model: "m", ts: 1_000 }),
        line({ type: "pair:score", cycleId: "c1", peer: "kimi", score: 8, verdict: "good", cost: 0.05, stage: "score", ts: 2_000 }),
      ],
      3_000,
    );
    expect(rendered).toContain("last pair kimi 8 good");
  });

  it("shows pair:consult as last signal", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "US-X", agent: "codex", model: "m", ts: 1_000 }),
        line({ type: "pair:consult", cycleId: "c1", peer: "kimi", durationMs: 45200, outcome: "reviewed", ts: 2_000 }),
      ],
      3_000,
    );
    expect(rendered).toContain("last pair kimi reviewed 45.2s");
  });

  it("shows pair:none-available as last signal", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "US-X", agent: "codex", model: "m", ts: 1_000 }),
        line({ type: "pair:none-available", cycleId: "c1", stage: "code", reason: "no peer", ts: 2_000 }),
      ],
      3_000,
    );
    expect(rendered).toContain("last pair code none-available");
  });

  it("shows pair:score-failure as last signal", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "US-X", agent: "codex", model: "m", ts: 1_000 }),
        line({ type: "pair:score-failure", cycleId: "c1", peer: "claude", cause: "auth-block", stage: "score", ts: 2_000 }),
      ],
      3_000,
    );
    expect(rendered).toContain("last pair claude auth-block");
  });

  it("shows pair:excluded as last signal", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "US-X", agent: "codex", model: "m", ts: 1_000 }),
        line({ type: "pair:excluded", cycleId: "c1", agent: "claude", cause: "auth", failures: 3, ts: 2_000 }),
      ],
      3_000,
    );
    expect(rendered).toContain("last pair claude excluded auth (3)");
  });

  it("in-window cycle:start takes precedence over durable lookup", () => {
    // cycle:start in window says FIX-99/claude; durable says US-OBS-027/claude.
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "20260622-001-alpha", storyId: "FIX-99", agent: "codex", model: "gpt-5", ts: 1_800_000_000_000 }),
        line({ type: "cycle:phase", cycleId: "20260622-001-alpha", phase: "execute", ts: 1_800_000_060_000 }),
      ],
      1_800_000_480_000,
      durable,
    );
    expect(rendered).toContain("FIX-99");
    expect(rendered).toContain("codex");
    expect(rendered).not.toContain("US-OBS-027");
  });
});
