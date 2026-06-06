import { describe, expect, it } from "vitest";
import { computeNextVersion, parseVersion, planRelease } from "../src/release/plan.js";

describe("parseVersion", () => {
  it("parses the 3.<MMDD>.<seq> calver shape", () => {
    expect(parseVersion("3.606.2")).toEqual({ major: 3, mid: 606, seq: 2 });
    expect(parseVersion("3.1205.1")).toEqual({ major: 3, mid: 1205, seq: 1 });
  });

  it("returns null for a non-conforming version", () => {
    expect(parseVersion("garbage")).toBeNull();
    expect(parseVersion("3.606")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("computeNextVersion", () => {
  it("bumps the seq when releasing again the same day", () => {
    expect(computeNextVersion("3.606.2", { year: 2026, month: 6, day: 6 })).toBe("3.606.3");
  });

  it("resets the seq to 1 on a new day", () => {
    expect(computeNextVersion("3.605.4", { year: 2026, month: 6, day: 6 })).toBe("3.606.1");
  });

  it("zero-pads the day into the middle segment (MMDD)", () => {
    expect(computeNextVersion("3.605.1", { year: 2026, month: 12, day: 5 })).toBe("3.1205.1");
    expect(computeNextVersion("3.605.1", { year: 2026, month: 6, day: 9 })).toBe("3.609.1");
  });

  it("preserves the current major when bumping", () => {
    expect(computeNextVersion("4.101.7", { year: 2026, month: 1, day: 1 })).toBe("4.101.8");
  });

  it("falls back to seq 1 on today when the current version is malformed", () => {
    expect(computeNextVersion("garbage", { year: 2026, month: 6, day: 6 })).toBe("3.606.1");
  });
});

describe("planRelease", () => {
  it("derives the tag, echoes current, and reflects changelog readiness", () => {
    const plan = planRelease({
      currentVersion: "3.606.2",
      date: { year: 2026, month: 6, day: 6 },
      changelogReady: true,
    });
    expect(plan.currentVersion).toBe("3.606.2");
    expect(plan.nextVersion).toBe("3.606.3");
    expect(plan.tag).toBe("v3.606.3");
    expect(plan.changelogReady).toBe(true);
  });

  it("marks changelog not ready when there is nothing under Unreleased", () => {
    const plan = planRelease({
      currentVersion: "3.606.2",
      date: { year: 2026, month: 6, day: 6 },
      changelogReady: false,
    });
    expect(plan.changelogReady).toBe(false);
  });
});
