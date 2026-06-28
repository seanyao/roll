/**
 * US-V4-009 — pure parallel-cycle scheduling decision. Covers: safe parallel
 * starts, max-parallel cap, same-Story rejection (single-ownership), file
 * conflict serialization, budget pause, and merge-queue pause.
 */
import { describe, expect, it } from "vitest";
import { scheduleParallelCycles } from "../src/supervisor/scheduler.js";
import type { ScheduleInput } from "@roll/spec";

function input(over: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    maxParallelCycles: 2,
    active: [],
    candidates: [],
    openPrStories: [],
    budgetOk: true,
    ...over,
  };
}

describe("scheduleParallelCycles", () => {
  it("starts up to maxParallel non-conflicting candidates", () => {
    const d = scheduleParallelCycles(
      input({
        maxParallelCycles: 2,
        candidates: [
          { storyId: "US-1", files: ["a.ts"] },
          { storyId: "US-2", files: ["b.ts"] },
          { storyId: "US-3", files: ["c.ts"] },
        ],
      }),
    );
    expect(d.start).toEqual(["US-1", "US-2"]);
    expect(d.wait.find((w) => w.storyId === "US-3")?.reason).toContain("max parallel");
  });

  it("respects active cycles when counting capacity", () => {
    const d = scheduleParallelCycles(
      input({ maxParallelCycles: 2, active: [{ storyId: "US-0", files: ["x.ts"] }], candidates: [{ storyId: "US-1", files: ["a.ts"] }, { storyId: "US-2", files: ["b.ts"] }] }),
    );
    expect(d.start).toEqual(["US-1"]); // 1 active + 1 new = 2 (cap)
  });

  it("SINGLE OWNERSHIP: a story already active or with an open PR never double-starts", () => {
    const d = scheduleParallelCycles(
      input({
        active: [{ storyId: "US-1" }],
        openPrStories: ["US-2"],
        candidates: [{ storyId: "US-1" }, { storyId: "US-2" }, { storyId: "US-3" }],
      }),
    );
    expect(d.start).toEqual(["US-3"]);
    expect(d.wait.find((w) => w.storyId === "US-1")?.reason).toContain("in flight");
    expect(d.wait.find((w) => w.storyId === "US-2")?.reason).toContain("in flight");
  });

  it("FILE CONFLICT: a candidate overlapping an active cycle serializes (waits)", () => {
    const d = scheduleParallelCycles(
      input({ active: [{ storyId: "US-0", files: ["shared.ts"] }], candidates: [{ storyId: "US-1", files: ["shared.ts"] }, { storyId: "US-2", files: ["other.ts"] }] }),
    );
    expect(d.start).toEqual(["US-2"]);
    expect(d.wait.find((w) => w.storyId === "US-1")?.reason).toContain("file/path conflict");
  });

  it("FILE CONFLICT: two pending candidates touching the same file serialize against each other", () => {
    const d = scheduleParallelCycles(
      input({ maxParallelCycles: 3, candidates: [{ storyId: "US-1", files: ["shared.ts"] }, { storyId: "US-2", files: ["shared.ts"] }] }),
    );
    expect(d.start).toEqual(["US-1"]);
    expect(d.wait.find((w) => w.storyId === "US-2")?.reason).toContain("file/path conflict");
  });

  it("candidates with no declared files do not falsely conflict", () => {
    const d = scheduleParallelCycles(input({ maxParallelCycles: 3, candidates: [{ storyId: "US-1" }, { storyId: "US-2" }] }));
    expect(d.start).toEqual(["US-1", "US-2"]);
  });

  it("BUDGET PAUSE: no new starts when budget is exhausted", () => {
    const d = scheduleParallelCycles(input({ budgetOk: false, candidates: [{ storyId: "US-1" }] }));
    expect(d.start).toEqual([]);
    expect(d.wait[0]?.reason).toContain("budget exhausted");
  });

  it("MERGE QUEUE PAUSE: no new starts when the merge queue is full", () => {
    const d = scheduleParallelCycles(input({ mergeQueue: { depth: 3, cap: 3 }, candidates: [{ storyId: "US-1" }] }));
    expect(d.start).toEqual([]);
    expect(d.wait[0]?.reason).toContain("merge queue full");
  });

  it("maxParallel is clamped to at least 1", () => {
    const d = scheduleParallelCycles(input({ maxParallelCycles: 0, candidates: [{ storyId: "US-1" }, { storyId: "US-2" }] }));
    expect(d.start).toEqual(["US-1"]);
  });
});
