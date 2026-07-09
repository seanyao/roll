import { describe, expect, it } from "vitest";
import { DEFAULT_BRANCH_CANARY_MAX, branchCanaryVerdict } from "../src/index.js";

describe("branchCanaryVerdict (US-LOOP-096)", () => {
  it("under threshold → not tripped, no pause", () => {
    const v = branchCanaryVerdict({ ephemeralBranchCount: 1, worktreeCount: 1, threshold: 8, alreadyPaused: false });
    expect(v).toEqual({ total: 2, tripped: false, shouldPause: false });
  });

  it("exactly at threshold → not tripped (strict >)", () => {
    const v = branchCanaryVerdict({ ephemeralBranchCount: 5, worktreeCount: 3, threshold: 8, alreadyPaused: false });
    expect(v.total).toBe(8);
    expect(v.tripped).toBe(false);
  });

  it("over threshold, not yet paused → trip AND write pause", () => {
    const v = branchCanaryVerdict({ ephemeralBranchCount: 7, worktreeCount: 3, threshold: 8, alreadyPaused: false });
    expect(v).toEqual({ total: 10, tripped: true, shouldPause: true });
  });

  it("over threshold but ALREADY paused → trip but do NOT re-write (dedupe)", () => {
    const v = branchCanaryVerdict({ ephemeralBranchCount: 20, worktreeCount: 0, threshold: 8, alreadyPaused: true });
    expect(v.tripped).toBe(true);
    expect(v.shouldPause).toBe(false);
  });

  it("total sums both leak signals", () => {
    const v = branchCanaryVerdict({ ephemeralBranchCount: 4, worktreeCount: 6, threshold: 8, alreadyPaused: false });
    expect(v.total).toBe(10);
  });

  it("default threshold is a sane small number", () => {
    expect(DEFAULT_BRANCH_CANARY_MAX).toBe(8);
  });
});
