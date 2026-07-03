import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyFailure, recordRootCauseFailure } from "../src/runner/failure-attribution.js";
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

  it("keeps unenveloped failures unknown instead of guessing from terminal alone", () => {
    expect(
      classifyFailure({
        stage: "terminal",
        source: "runner",
      }),
    ).toMatchObject({ failureClass: "unknown", rootCauseKey: "unknown:unclassified" });
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
