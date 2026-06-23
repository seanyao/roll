import { describe, expect, it } from "vitest";
import { selectGoalFinalReviewer } from "../src/index.js";

describe("US-GOAL-006 — goal final review reviewer selection", () => {
  it("auto selects a reviewer from a different provider than the worker", () => {
    expect(
      selectGoalFinalReviewer({
        mode: "auto",
        installedAgents: ["kimi", "pi", "reasonix"],
        workerAgents: ["kimi"],
      }),
    ).toMatchObject({
      status: "selected",
      effectiveMode: "hetero",
      reviewer: "pi",
      provider: "pi",
      degraded: false,
    });
  });

  it("auto degrades to self review in a single-provider pool", () => {
    expect(
      selectGoalFinalReviewer({
        mode: "auto",
        installedAgents: ["kimi"],
        workerAgents: ["kimi"],
      }),
    ).toEqual({
      status: "selected",
      effectiveMode: "self",
      reviewer: "kimi",
      provider: "moonshot",
      degraded: true,
      reason: "single_provider_available",
    });
  });

  it("explicit hetero fails closed when no heterogeneous reviewer is available", () => {
    expect(
      selectGoalFinalReviewer({
        mode: "hetero",
        installedAgents: ["kimi"],
        workerAgents: ["kimi"],
      }),
    ).toEqual({
      status: "unavailable",
      reason: "no_heterogeneous_reviewer",
    });
  });

  it("explicit self review picks the current worker provider", () => {
    expect(
      selectGoalFinalReviewer({
        mode: "self",
        installedAgents: ["kimi", "pi"],
        workerAgents: ["kimi"],
      }),
    ).toMatchObject({
      status: "selected",
      effectiveMode: "self",
      reviewer: "kimi",
      provider: "moonshot",
      degraded: false,
    });
  });
});
