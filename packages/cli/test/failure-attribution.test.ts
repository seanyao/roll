import { describe, expect, it } from "vitest";
import { classifyFailure } from "../src/runner/failure-attribution.js";

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
});
