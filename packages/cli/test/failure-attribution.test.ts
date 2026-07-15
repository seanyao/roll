import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyCorrectionFailure, classifyCycleFailure, classifyFailure, recordRootCauseFailure } from "../src/runner/failure-attribution.js";
import { readSkipCards, recordCardFailure } from "../src/runner/skip-cards.js";

describe("failure attribution envelopes", () => {
  it("classifies pre-spawn sandbox dirty as env using phase + source, with zero tokens only corroborating", () => {
    expect(
      classifyFailure({
        stage: "pre-spawn",
        source: "sandbox:main_dirty",
        tokensIn: 0,
        tokensOut: 0,
        tcrCount: 0,
      }),
    ).toEqual({
      failureClass: "env",
      rootCauseKey: "env:main_dirty",
      confidence: "envelope",
    });
  });

  it("classifies agent CLI launch errors as env when spawn exits before any agent stream", () => {
    expect(
      classifyFailure({
        stage: "agent-spawn",
        source: "agent-cli",
        exitCode: 127,
        stderr: "codex: command not found",
        sawAgentOutput: false,
      }),
    ).toMatchObject({ failureClass: "env", rootCauseKey: "env:agent_cli_spawn" });
  });

  it("classifies score parser failures as harness", () => {
    expect(
      classifyFailure({
        stage: "score",
        source: "pair:score-failure",
        tcrCount: 0,
      }),
    ).toMatchObject({ failureClass: "harness", rootCauseKey: "harness:score_parse" });
  });

  it("does not classify loose source substrings like scoreboard as score parser failures", () => {
    expect(
      classifyFailure({
        stage: "terminal",
        source: "scoreboard:render",
      }),
    ).toMatchObject({ failureClass: "unknown", rootCauseKey: "unknown:unclassified" });
  });

  it("classifies post-build failures with tokens as card failures when no higher envelope matches", () => {
    expect(
      classifyFailure({
        stage: "build",
        source: "agent",
        tokensIn: 100,
        tokensOut: 12,
        tcrCount: 0,
      }),
    ).toMatchObject({ failureClass: "card", rootCauseKey: "card:agent_after_build" });
  });

  it("classifies post-build failures with TCR attempts as card failures when tokens are unavailable", () => {
    expect(
      classifyFailure({
        stage: "build",
        source: "agent",
        tcrCount: 1,
      }),
    ).toMatchObject({ failureClass: "card", rootCauseKey: "card:agent_after_build" });
  });

  it("attributes cycles with TCR evidence and only a mainDirty flag to the card", () => {
    expect(
      classifyCycleFailure({
        cycleId: "cycle-main-dirty-after-work",
        terminal: "failed",
        mainDirty: true,
        tcrCount: 1,
      }),
    ).toMatchObject({ failureClass: "card", rootCauseKey: "card:agent_after_build" });
  });

  it("keeps unenveloped failures unknown with a no-evidence fallback source", () => {
    expect(
      classifyFailure({
        stage: "terminal",
        source: "fallback:no_evidence",
      }),
    ).toMatchObject({ failureClass: "unknown", rootCauseKey: "unknown:unclassified" });
  });

  it("classifies zero-output timed-out build as env:agent_stall instead of card (FIX-1213)", () => {
    // Agent consumed prompt tokens but produced ZERO output — vendor stall, not card fault.
    expect(
      classifyCycleFailure({
        cycleId: "cycle-stall",
        terminal: "blocked",
        tokensIn: 4500,
        tokensOut: 0,
        tcrCount: 0,
        agentExecuted: true,
        agentTimedOut: true,
      }),
    ).toMatchObject({ failureClass: "env", rootCauseKey: "env:agent_stall" });
  });

  // FIX-1218: builder:boundary_violation → env:main_dirty instead of generic env:sandbox
  it("classifies builder:boundary_violation as env:main_dirty with playbook", () => {
    const result = classifyCycleFailure({
      cycleId: "cycle-boundary",
      terminal: "failed",
      tcrCount: 0,
      events: [{ type: "builder:boundary_violation", cycleId: "cycle-boundary", storyId: "FIX-1218", agent: "pi", kind: "main_checkout_dirty", files: [], ts: 0, worktreePath: "." }],
    });
    expect(result).toMatchObject({ failureClass: "env", rootCauseKey: "env:main_dirty" });
  });

  it("classifies timed-out build WITH output as card (agent genuinely struggled)", () => {
    expect(
      classifyCycleFailure({
        cycleId: "cycle-real-work",
        terminal: "blocked",
        tokensIn: 4500,
        tokensOut: 120,
        tcrCount: 0,
        agentExecuted: true,
        agentTimedOut: true,
      }),
    ).toMatchObject({ failureClass: "card", rootCauseKey: "card:agent_after_build" });
  });

  it("classifies build failure with no output but NOT timed-out as card", () => {
    expect(
      classifyCycleFailure({
        cycleId: "cycle-no-output-no-timeout",
        terminal: "failed",
        tokensIn: 4500,
        tokensOut: 0,
        tcrCount: 0,
        agentExecuted: true,
        agentTimedOut: false,
      }),
    ).toMatchObject({ failureClass: "card", rootCauseKey: "card:agent_after_build" });
  });

  it("classifies zero-output timed-out via classifyFailure directly", () => {
    expect(
      classifyFailure({
        stage: "build",
        source: "agent",
        tokensIn: 100,
        tokensOut: 0,
        tcrCount: 0,
        agentTimedOut: true,
      }),
    ).toMatchObject({ failureClass: "env", rootCauseKey: "env:agent_stall" });
  });

  it("aggregates env/harness failures by root cause and writes a diagnostic snapshot at threshold", () => {
    const dir = mkdtempSync(join(tmpdir(), "roll-root-cause-"));
    const attribution = { failureClass: "env" as const, rootCauseKey: "env:main_dirty", confidence: "envelope" as const };
    expect(recordRootCauseFailure(dir, "cycle-1", attribution, [], 3).paused).toBe(false);
    expect(recordRootCauseFailure(dir, "cycle-2", attribution, [], 3).paused).toBe(false);
    const third = recordRootCauseFailure(dir, "cycle-3", attribution, [{ type: "sandbox:main_dirty", cycleId: "cycle-3", phase: "pre-spawn", files: ["x"], ts: 3 } as never], 3);
    expect(third).toMatchObject({ paused: true, count: 3, rootCauseKey: "env:main_dirty" });
    expect(existsSync(third.snapshotPath ?? "")).toBe(true);
    const snapshot = readFileSync(third.snapshotPath ?? "", "utf8");
    expect(snapshot).toContain("env:main_dirty");
    expect(snapshot).toContain("main checkout");
    expect(snapshot).not.toContain("split the card");
  });

  it("resets corrupt root-cause state and emits an alert event", () => {
    const dir = mkdtempSync(join(tmpdir(), "roll-root-cause-corrupt-"));
    writeFileSync(join(dir, "failure-attribution.json"), "{bad json", "utf8");
    const attribution = { failureClass: "env" as const, rootCauseKey: "env:main_dirty", confidence: "envelope" as const };

    const result = recordRootCauseFailure(dir, "cycle-corrupt", attribution, [], 3, { nowMs: 1000 });

    expect(result).toMatchObject({ count: 1, paused: false, rootCauseKey: "env:main_dirty" });
    const events = readFileSync(join(dir, "events.ndjson"), "utf8");
    expect(events).toContain('"type":"alert:notify"');
    expect(events).toContain("failure-attribution state reset");
  });

  it("emits an alert event when root-cause state cannot be written", () => {
    const dir = mkdtempSync(join(tmpdir(), "roll-root-cause-write-fail-"));
    mkdirSync(join(dir, "failure-attribution.json"));
    const attribution = { failureClass: "env" as const, rootCauseKey: "env:main_dirty", confidence: "envelope" as const };

    const result = recordRootCauseFailure(dir, "cycle-write-fail", attribution, [], 3, { nowMs: 1000 });

    expect(result).toMatchObject({ count: 1, paused: false, rootCauseKey: "env:main_dirty" });
    const events = readFileSync(join(dir, "events.ndjson"), "utf8");
    expect(events).toContain('"type":"alert:notify"');
    expect(events).toContain("failure-attribution state write failed");
  });

  it("ignores root-cause failures outside the rolling window", () => {
    const dir = mkdtempSync(join(tmpdir(), "roll-root-cause-window-"));
    const attribution = { failureClass: "env" as const, rootCauseKey: "env:main_dirty", confidence: "envelope" as const };
    const hour = 60 * 60 * 1000;

    expect(recordRootCauseFailure(dir, "cycle-old-1", attribution, [], 3, { nowMs: 0, windowMs: 24 * hour })).toMatchObject({ count: 1, paused: false });
    expect(recordRootCauseFailure(dir, "cycle-old-2", attribution, [], 3, { nowMs: hour, windowMs: 24 * hour })).toMatchObject({ count: 2, paused: false });
    const fresh = recordRootCauseFailure(dir, "cycle-fresh", attribution, [], 3, { nowMs: 26 * hour, windowMs: 24 * hour });

    expect(fresh).toMatchObject({ count: 1, paused: false, rootCauseKey: "env:main_dirty" });
    const state = JSON.parse(readFileSync(join(dir, "failure-attribution.json"), "utf8")) as {
      causes: { "env:main_dirty": { timestamps?: unknown; count?: unknown } };
    };
    expect(state.causes["env:main_dirty"].timestamps).toEqual([26 * hour]);
    expect(state.causes["env:main_dirty"].count).toBeUndefined();
  });

  it("still pauses when root-cause failures repeat inside the rolling window", () => {
    const dir = mkdtempSync(join(tmpdir(), "roll-root-cause-window-pause-"));
    const attribution = { failureClass: "harness" as const, rootCauseKey: "harness:score_parse", confidence: "envelope" as const };
    const hour = 60 * 60 * 1000;

    recordRootCauseFailure(dir, "cycle-1", attribution, [], 3, { nowMs: 0, windowMs: 24 * hour });
    recordRootCauseFailure(dir, "cycle-2", attribution, [], 3, { nowMs: hour, windowMs: 24 * hour });
    const third = recordRootCauseFailure(dir, "cycle-3", attribution, [], 3, { nowMs: 2 * hour, windowMs: 24 * hour });

    expect(third).toMatchObject({ count: 3, paused: true, rootCauseKey: "harness:score_parse" });
  });

  it("replays roll-capture-style pre-spawn dirty failures without poisoning card accounting", () => {
    const dir = mkdtempSync(join(tmpdir(), "roll-capture-replay-"));
    const attribution = { failureClass: "env" as const, rootCauseKey: "env:main_dirty", confidence: "envelope" as const };
    for (const storyId of ["US-CAPTURE-005", "US-CAPTURE-006", "US-CAPTURE-007", "US-CAPTURE-005", "US-CAPTURE-006", "US-CAPTURE-007", "US-CAPTURE-006", "US-CAPTURE-007"]) {
      recordRootCauseFailure(dir, `cycle-${storyId}`, attribution, [], 3);
      recordCardFailure(dir, storyId, 3, attribution.failureClass);
    }
    expect(readSkipCards(dir).size).toBe(0);
  });
});

describe("REFACTOR-068 classifyCorrectionFailure — unified correction → failure attribution", () => {
  it("maps review_score_regression to card:review_score_regression", () => {
    expect(classifyCorrectionFailure("review_score_regression")).toEqual({
      failureClass: "card",
      rootCauseKey: "card:review_score_regression",
    });
  });

  it("aliases legacy correction signal text before classification", () => {
    expect(classifyCorrectionFailure(" review-score regression ")).toEqual({
      failureClass: "card",
      rootCauseKey: "card:review_score_regression",
    });
    expect(classifyCorrectionFailure("CI failed")).toEqual({
      failureClass: "harness",
      rootCauseKey: "harness:ci_red",
    });
  });

  it("maps empty_acceptance_report to card:empty_acceptance", () => {
    expect(classifyCorrectionFailure("empty_acceptance_report")).toEqual({
      failureClass: "card",
      rootCauseKey: "card:empty_acceptance",
    });
  });

  it("maps missing_acceptance_report to card:missing_acceptance", () => {
    expect(classifyCorrectionFailure("missing_acceptance_report")).toEqual({
      failureClass: "card",
      rootCauseKey: "card:missing_acceptance",
    });
  });

  it("maps ci_failed to harness:ci_red", () => {
    expect(classifyCorrectionFailure("ci_failed")).toEqual({
      failureClass: "harness",
      rootCauseKey: "harness:ci_red",
    });
  });

  it("maps unknown signals to unknown:unclassified", () => {
    expect(classifyCorrectionFailure("some_new_signal")).toEqual({
      failureClass: "unknown",
      rootCauseKey: "unknown:unclassified",
    });
  });

  it("maps empty string to unknown:unclassified", () => {
    expect(classifyCorrectionFailure("")).toEqual({
      failureClass: "unknown",
      rootCauseKey: "unknown:unclassified",
    });
  });

  // FIX-1261: deterministic failure envelope — new card-level signals.
  it("maps card:deliverable_cmd_denied to card:deliverable_cmd_denied", () => {
    expect(classifyCorrectionFailure("card:deliverable_cmd_denied")).toEqual({
      failureClass: "card",
      rootCauseKey: "card:deliverable_cmd_denied",
    });
  });

  it("maps card:ac_evidence_unmergeable to card:ac_evidence_unmergeable", () => {
    expect(classifyCorrectionFailure("card:ac_evidence_unmergeable")).toEqual({
      failureClass: "card",
      rootCauseKey: "card:ac_evidence_unmergeable",
    });
  });

  it("maps card:surface_not_captured to card:surface_not_captured", () => {
    expect(classifyCorrectionFailure("card:surface_not_captured")).toEqual({
      failureClass: "card",
      rootCauseKey: "card:surface_not_captured",
    });
  });
});
