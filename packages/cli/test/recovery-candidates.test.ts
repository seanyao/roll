import { describe, expect, it } from "vitest";
import type { RollEvent } from "@roll/spec";
import { pendingRecoveryCandidateIds } from "../src/runner/recovery-candidates.js";

const recovery = (storyId: string, decision: "allowed" | "denied" = "allowed"): RollEvent =>
  ({ type: "goal:recovery", decision, actor: "owner", storyId, reason: "repair evidence", noProgressCycles: 0, ts: 1 } as never);

const cycleStart = (storyId: string): RollEvent =>
  ({ type: "cycle:start", cycleId: "cycle-1", storyId, agent: "kimi" as never, model: "", ts: 2 } as RollEvent);

describe("pendingRecoveryCandidateIds", () => {
  it("exposes only an allowed recovery that has not started a replacement cycle", () => {
    expect(pendingRecoveryCandidateIds([recovery("US-RECOVER"), recovery("US-DENIED", "denied")])).toEqual(new Set(["US-RECOVER"]));
  });

  it("consumes the recovery permission when its replacement cycle starts", () => {
    expect(pendingRecoveryCandidateIds([recovery("US-RECOVER"), cycleStart("US-RECOVER")])).toEqual(new Set());
  });

  it("does not consume a different card's recovery permission", () => {
    expect(pendingRecoveryCandidateIds([recovery("US-RECOVER"), cycleStart("US-OTHER")])).toEqual(new Set(["US-RECOVER"]));
  });
});
