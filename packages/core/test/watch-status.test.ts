import { describe, expect, it } from "vitest";
import type { RollEvent } from "@roll/spec";
import { renderStoryTransition, renderWatchStatusFromEventLines, summarizeWatchEvents, type WatchStatusSummary } from "../src/loop/watch-status.js";

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
      "status  phase execute · active · quiet 5m · US-LOOP-046 · codex · cycle 20260619-046-a · 1 TCR · last building status layer · outcome unknown/no end event",
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
    expect(rendered).toContain("ended");
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

  it("renders accepted pair:score as a dedicated score segment", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "US-X", agent: "codex", model: "m", ts: 1_000 }),
        line({ type: "pair:score", cycleId: "c1", peer: "kimi", score: 8, verdict: "good", cost: 0.05, stage: "score", ts: 2_000 }),
      ],
      3_000,
    );
    expect(rendered).toContain("score kimi 8/good");
  });

  it("keeps accepted score visible when a later pair:consult arrives", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "FIX-1050", agent: "kimi", model: "m", ts: 1_000 }),
        line({ type: "pair:score", cycleId: "c1", peer: "pi", score: 9, verdict: "good", cost: 0.05, stage: "score", ts: 2_000 }),
        line({ type: "pair:consult", cycleId: "c1", peer: "claude", durationMs: 45_000, outcome: "reviewed", ts: 3_000 }),
      ],
      4_000,
    );
    expect(rendered).toContain("score pi 9/good");
    expect(rendered).toContain("last pair claude reviewed 45.0s");
  });

  it("renders attest:gate verdict and the score-related reason", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "FIX-1050", agent: "kimi", model: "m", ts: 1_000 }),
        line({ type: "pair:score", cycleId: "c1", peer: "pi", score: 9, verdict: "good", cost: 0.05, stage: "score", ts: 2_000 }),
        line({
          type: "attest:gate",
          cycleId: "c1",
          verdict: "produced",
          reasons: ["fresh acceptance report present", "review-score good 9/10 present"],
          ts: 3_000,
        }),
      ],
      4_000,
    );
    expect(rendered).toContain("attest produced");
    expect(rendered).toContain("review-score good 9/10 present");
    expect(rendered).toContain("score pi 9/good");
  });

  it("shows score failures as last signal, distinct from accepted score", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "US-X", agent: "codex", model: "m", ts: 1_000 }),
        line({ type: "pair:score-failure", cycleId: "c1", peer: "claude", cause: "unparseable", stage: "score", ts: 2_000 }),
      ],
      3_000,
    );
    expect(rendered).toContain("last pair claude unparseable");
    expect(rendered).not.toContain("score claude");
  });

  it("replaces unknown outcome with terminal outcome and PR state when cycle:end arrives", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "FIX-1050", agent: "kimi", model: "m", ts: 1_000 }),
        line({ type: "pr:open", prNumber: 1111, storyId: "FIX-1050", ts: 2_000 }),
        line({ type: "cycle:end", cycleId: "c1", outcome: "published_pending_merge", cost: { cycleId: "c1", agent: "kimi", model: "m", tokensIn: 0, tokensOut: 0, estimatedCost: 0, revertCount: 0, effectiveCost: 0 }, ts: 3_000 }),
      ],
      4_000,
    );
    expect(rendered).toContain("outcome published_pending_merge");
    expect(rendered).toContain("PR #1111 open");
    expect(rendered).not.toContain("outcome unknown/no end event");
  });

  it("recognizes cycle:terminal as a terminal outcome", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "US-X", agent: "codex", model: "m", ts: 1_000 }),
        line({ type: "cycle:terminal", schema: 1, cycleId: "c1", storyId: "US-X", agent: "codex", model: "m", startedAt: 1_000, endedAt: 2_000, outcome: "delivered", pr: { present: false, reason: "not_applicable" }, branch: { present: false, reason: "not_applicable" }, commit: { present: false, reason: "not_applicable" }, tcr: { present: true, value: 1 }, attest: { present: false, reason: "not_applicable" }, usage: { present: false, reason: "not_applicable" }, cost: { present: true, value: { estimatedUsd: 0.1, effectiveUsd: 0.1 } }, ts: 2_000 }),
      ],
      3_000,
    );
    expect(rendered).toContain("outcome delivered");
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

  // ── FIX-1054: serial-dispatch policy signals ──────────────────────────────

  it("shows pair:skipped as a policy skip signal", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "US-X", agent: "codex", model: "m", ts: 1_000 }),
        line({ type: "pair:skipped", cycleId: "c1", peers: ["reasonix", "kimi"], reason: "accepted_score", stage: "score", ts: 2_000 }),
      ],
      3_000,
    );
    expect(rendered).toContain("last pair skipped reasonix,kimi (accepted_score)");
  });

  it("shows pair:fanout with its bounded reason and limit", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "US-X", agent: "codex", model: "m", ts: 1_000 }),
        line({ type: "pair:fanout", cycleId: "c1", stage: "score", reason: "high_risk_truth_or_release_gate", limit: 3, peers: ["pi", "reasonix", "kimi"], ts: 2_000 }),
      ],
      3_000,
    );
    expect(rendered).toContain("last pair fanout score high_risk_truth_or_release_gate limit=3");
  });

  it("shows a fallback pair:selected with its attempt/reason tag", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        line({ type: "cycle:start", cycleId: "c1", storyId: "US-X", agent: "codex", model: "m", ts: 1_000 }),
        line({ type: "pair:selected", cycleId: "c1", workingAgent: "codex", peer: "kimi", stage: "code", attempt: 2, reason: "fallback_after_failure", ts: 2_000 }),
      ],
      3_000,
    );
    expect(rendered).toContain("last pair codex → kimi (code) [attempt 2: fallback_after_failure]");
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

// ── US-OBS-044: story transition blocks ───────────────────────────────────────

describe("renderStoryTransition — narrated story handoffs", () => {
  const prev: WatchStatusSummary = {
    cycleId: "20260630-20335",
    storyId: "FIX-1049",
    agent: "claude",
    phase: "publish",
    tcrCount: 3,
    lastSignal: "cycle published_pending_merge",
    lastSignalAt: 1_800_000_000_000,
    hasEnd: true,
    outcome: "published_pending_merge",
    lastPr: { type: "pr:open", prNumber: 1049 },
  };

  const next: WatchStatusSummary = {
    cycleId: "20260630-21005",
    storyId: "FIX-1050",
    agent: "kimi",
    phase: "execute",
    tcrCount: 0,
    hasEnd: false,
  };

  it("renders a framed transition block when story/cycle changes", () => {
    const block = renderStoryTransition(prev, next, {
      storyBrief: (id) => (id === "FIX-1050" ? "reasonix/agy usage capture parity for cycle ledger" : undefined),
      routeReason: (id) => (id === "FIX-1050" ? { agent: "kimi", reason: "current execute pool and route policy" } : undefined),
      actionPlan: (id) => (id === "FIX-1050" ? "A1 parser fixture → A2 wiring → A3 ledger output → A4 evidence" : undefined),
    });
    expect(block).not.toBeNull();
    const text = block!;
    expect(text).toContain("↳ story transition");
    expect(text).toContain("FIX-1049");
    expect(text).toContain("published_pending_merge");
    expect(text).toContain("3 TCR");
    expect(text).toContain("builder claude");
    expect(text).toContain("PR #1049 open");
    expect(text).toContain("FIX-1050");
    expect(text).toContain("reasonix/agy usage capture parity");
    expect(text).toContain("kimi · selected by current execute pool and route policy");
    expect(text).toContain("A1 parser fixture → A2 wiring → A3 ledger output → A4 evidence");
    expect(text).toMatch(/^─{20,}/m);
  });

  it("degrades missing previous outcome to an explicit reason", () => {
    const block = renderStoryTransition({ ...prev, hasEnd: false, outcome: undefined }, next);
    expect(block).toContain("no end event recorded");
  });

  it("degrades missing route reason to an explicit unavailable reason", () => {
    const block = renderStoryTransition(prev, next, {
      storyBrief: (id) => (id === "FIX-1050" ? "next story brief" : undefined),
    });
    expect(block).toContain("kimi · route reason unavailable");
  });

  it("shows plan: pending when no action plan is available", () => {
    const block = renderStoryTransition(prev, next, {
      storyBrief: (id) => (id === "FIX-1050" ? "next story brief" : undefined),
      routeReason: (id) => (id === "FIX-1050" ? { agent: "kimi", reason: "route policy" } : undefined),
    });
    expect(block).toContain("plan:     pending");
  });

  it("returns null for repeated heartbeats on the same story/cycle", () => {
    expect(renderStoryTransition(prev, { ...prev })).toBeNull();
  });

  it("returns null when there is no previous summary (startup)", () => {
    expect(renderStoryTransition(null as unknown as WatchStatusSummary, next)).toBeNull();
  });
});

// ── US-OBS-042: TCR micro-step rhythm visibility ────────────────────────────

describe("watch-status — US-OBS-042 micro-step rhythm", () => {
  const base = (ts: number) => line({ type: "cycle:start", cycleId: "c1", storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts });

  it("renders active-zero-TCR without marking it silent", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        base(1000),
        line({ type: "cycle:stdout", cycleId: "c1", data: "tool_call: Edit · packages/core/src/parser.ts", ts: 130_000 }),
      ],
      200_000,
    );
    expect(rendered).toContain("active");
    expect(rendered).toContain("0 TCR");
    expect(rendered).not.toContain("silent");
  });

  it("renders test:red and test:green transitions", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        base(1000),
        line({ type: "cycle:stdout", cycleId: "c1", data: "test:red · parser fails", ts: 120_000 }),
      ],
      180_000,
    );
    expect(rendered).toContain("test:red");
  });

  it("renders advisory green-uncommitted state", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        base(1000),
        line({ type: "cycle:stdout", cycleId: "c1", data: "test:green · parser tests pass", ts: 120_000 }),
      ],
      180_000,
    );
    expect(rendered).toContain("green-uncommitted 1m");
  });

  it("renders bounded micro-step plan when present", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        base(1000),
        line({ type: "cycle:stdout", cycleId: "c1", data: "micro-step: A1 parser+tests · evidence: unit tests green · scope: packages/core/src/parser.ts", ts: 60_000 }),
      ],
      120_000,
    );
    expect(rendered).toContain("action A1 parser+tests");
  });

  it("renders silent classification when truly quiet", () => {
    const rendered = renderWatchStatusFromEventLines(
      [
        base(1000),
      ],
      1_000_000,
    );
    expect(rendered).toContain("silent");
  });
});
