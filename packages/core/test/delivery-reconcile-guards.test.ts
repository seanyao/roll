/**
 * US-DELIV-011 — reconcile side-effect idempotency guards.
 */
import { describe, expect, it } from "vitest";
import {
  cycleAlreadyCredited,
  hasCreditedReconciledEvent,
  shouldAppendDeliveredCredit,
  shouldAttemptPrMerge,
} from "../src/index.js";
import type { RollEvent } from "@roll/spec";

const CYCLE = "cycle-A";
const TS = 1_790_000_000_000;

const start: RollEvent = {
  type: "cycle:start",
  cycleId: CYCLE,
  storyId: "US-DELIV-011",
  agent: "claude",
  model: "m",
  ts: TS,
};

const published: RollEvent = {
  type: "delivery:published",
  cycleId: CYCLE,
  storyId: "US-DELIV-011",
  branch: "loop/cycle-A",
  prNumber: 42,
  prUrl: "https://github.com/o/r/pull/42",
  ts: TS + 1,
};

const credited: RollEvent = {
  type: "delivery:reconciled",
  cycleId: CYCLE,
  storyId: "US-DELIV-011",
  state: "delivered_external",
  mergedBy: "external",
  mergeCommit: "abc",
  signal: "pr_state",
  ts: TS + 2,
};

const mergeMerged: RollEvent = {
  type: "delivery:merge_attempt",
  cycleId: CYCLE,
  prNumber: 42,
  method: "squash",
  outcome: "merged",
  ts: TS + 2,
};

describe("US-DELIV-011 — reconcile guards", () => {
  it("awaiting_merge cycle may append credit and attempt merge", () => {
    const events = [start, published];
    expect(cycleAlreadyCredited(events, CYCLE)).toBe(false);
    expect(hasCreditedReconciledEvent(events, CYCLE)).toBe(false);
    expect(shouldAppendDeliveredCredit(events, CYCLE)).toBe(true);
    expect(shouldAttemptPrMerge(events, CYCLE)).toBe(true);
  });

  it("credited cycle blocks duplicate delivered append and merge", () => {
    const events = [start, published, credited];
    expect(cycleAlreadyCredited(events, CYCLE)).toBe(true);
    expect(hasCreditedReconciledEvent(events, CYCLE)).toBe(true);
    expect(shouldAppendDeliveredCredit(events, CYCLE)).toBe(false);
    expect(shouldAttemptPrMerge(events, CYCLE)).toBe(false);
  });

  it("delivered_local cycle (E3) is credited — no PR merge, no duplicate credit", () => {
    const localGate: RollEvent = {
      type: "delivery:evidence_gate",
      cycleId: CYCLE,
      storyId: "US-DELIV-011",
      verdict: "earned",
      reasons: [],
      ts: TS + 1,
    };
    const localCredit: RollEvent = {
      type: "delivery:reconciled",
      cycleId: CYCLE,
      storyId: "US-DELIV-011",
      state: "delivered_local",
      mergedBy: "runner",
      mergeCommit: "localsha",
      signal: "patch_id",
      ts: TS + 2,
    };
    const events = [start, localGate, localCredit];
    expect(cycleAlreadyCredited(events, CYCLE)).toBe(true);
    expect(hasCreditedReconciledEvent(events, CYCLE)).toBe(true);
    expect(shouldAppendDeliveredCredit(events, CYCLE)).toBe(false);
    expect(shouldAttemptPrMerge(events, CYCLE)).toBe(false);
  });

  it("successful merge_attempt blocks duplicate gh pr merge", () => {
    const events = [start, published, mergeMerged];
    expect(cycleAlreadyCredited(events, CYCLE)).toBe(false);
    expect(shouldAppendDeliveredCredit(events, CYCLE)).toBe(true);
    expect(shouldAttemptPrMerge(events, CYCLE)).toBe(false);
  });

  it("blocked merge_attempt does not block a later merge attempt", () => {
    const blocked: RollEvent = {
      type: "delivery:merge_attempt",
      cycleId: CYCLE,
      prNumber: 42,
      method: "squash",
      outcome: "blocked",
      ts: TS + 2,
    };
    const events = [start, published, blocked];
    expect(shouldAttemptPrMerge(events, CYCLE)).toBe(true);
  });

  it("re-entry after crash: merge_attempt merged without credit still allows one credit", () => {
    const events = [start, published, mergeMerged];
    expect(shouldAppendDeliveredCredit(events, CYCLE)).toBe(true);
    expect(shouldAttemptPrMerge(events, CYCLE)).toBe(false);
  });
});
