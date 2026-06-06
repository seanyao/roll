/** US-META-001 — archive GC verdict: keep freshest N OR recent; cut the old surplus tail. */
import { describe, expect, it } from "vitest";
import { archiveGcVerdict, type ArchiveRun } from "../src/attest/gc.js";

const DAY = 86400;
const NOW = 1_000_000_000; // fixed clock

function run(runId: string, ageDays: number): ArchiveRun {
  return { runId, mtimeSec: NOW - ageDays * DAY };
}

describe("archiveGcVerdict", () => {
  it("always keeps the freshest N runs even when they are old", () => {
    const runs = [run("r1", 100), run("r2", 200), run("r3", 300)];
    const v = archiveGcVerdict(runs, { keepLatest: 3, keepDays: 30, nowSec: NOW });
    expect(v.delete).toEqual([]);
    expect(v.keep.sort()).toEqual(["r1", "r2", "r3"]);
  });

  it("deletes runs that are BOTH beyond keep-N AND older than keepDays", () => {
    const runs = [run("new", 1), run("mid", 10), run("old1", 100), run("old2", 200)];
    const v = archiveGcVerdict(runs, { keepLatest: 2, keepDays: 30, nowSec: NOW });
    // freshest 2 (new, mid) kept; old1/old2 beyond N AND >30d → deleted
    expect(v.keep.sort()).toEqual(["mid", "new"]);
    expect(v.delete.sort()).toEqual(["old1", "old2"]);
  });

  it("keeps recent runs even when beyond keep-N (age <= keepDays)", () => {
    const runs = [run("a", 1), run("b", 2), run("c", 3), run("d", 4)];
    const v = archiveGcVerdict(runs, { keepLatest: 1, keepDays: 30, nowSec: NOW });
    expect(v.delete).toEqual([]); // all within 30 days
    expect(v.keep.length).toBe(4);
  });

  it("keepLatest 0 + all old → everything deletable", () => {
    const runs = [run("x", 90), run("y", 120)];
    const v = archiveGcVerdict(runs, { keepLatest: 0, keepDays: 30, nowSec: NOW });
    expect(v.keep).toEqual([]);
    expect(v.delete.sort()).toEqual(["x", "y"]);
  });
});
