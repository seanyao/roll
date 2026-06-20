/**
 * US-TRUTH-015 / US-TRUTH-016 — queryStoryDelivery + deriveBacklogStatus tests.
 *
 * AC4: deterministic output for todo / in_flight / done / failed scenarios.
 * AC5: backlog display strings derived from structured truth, not markdown.
 */
import { describe, expect, it } from "vitest";
import { queryStoryDelivery, deriveBacklogStatus, type StoryDeliveryTruth } from "../src/index.js";
import type { DeliveryRecord } from "@roll/spec";
import { present, absent } from "@roll/spec";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    storyId: "US-TEST-001",
    cycleId: "cycle-20260621-0001",
    lifecycleState: "in_flight",
    prNumber: present(42),
    prUrl: present("https://github.com/example/pull/42"),
    mergedAt: absent("not_recorded"),
    mergeCommit: absent("not_recorded"),
    recordedAt: 1000,
    ...overrides,
  };
}

// ── AC1: No records → todo ─────────────────────────────────────────────────

describe("US-TRUTH-016 AC2 — queryStoryDelivery with no records", () => {
  it("returns lifecycleState: todo when no deliveries exist", () => {
    const result = queryStoryDelivery("US-UNKNOWN", []);
    expect(result.lifecycleState).toBe("todo");
    expect(result.delivered).toBe(false);
    expect(result.prNumber).toBeUndefined();
    expect(result.prUrl).toBeUndefined();
    expect(result.deliveringCycles).toEqual([]);
    expect(result.lastRecordedAt).toBe(0);
  });

  it("returns todo when no records match the storyId", () => {
    const records = [
      makeRecord({ storyId: "US-OTHER", cycleId: "c1" }),
    ];
    const result = queryStoryDelivery("US-TARGET", records);
    expect(result.lifecycleState).toBe("todo");
    expect(result.delivered).toBe(false);
  });
});

// ── AC2: Deterministic — same input → same output ──────────────────────────

describe("US-TRUTH-016 AC2 — deterministic output", () => {
  it("same input produces identical output twice", () => {
    const records = [
      makeRecord({ storyId: "US-DET", cycleId: "c1", lifecycleState: "in_flight", recordedAt: 100 }),
      makeRecord({ storyId: "US-DET", cycleId: "c1", lifecycleState: "done", recordedAt: 200 }),
    ];
    const r1 = queryStoryDelivery("US-DET", records);
    const r2 = queryStoryDelivery("US-DET", records);
    expect(r1).toEqual(r2);
  });

  it("last-wins: later recordedAt overrides same (storyId, cycleId)", () => {
    const records = [
      makeRecord({ storyId: "US-LW", cycleId: "c1", lifecycleState: "in_flight", recordedAt: 100 }),
      makeRecord({ storyId: "US-LW", cycleId: "c1", lifecycleState: "done", recordedAt: 200 }),
    ];
    const result = queryStoryDelivery("US-LW", records);
    expect(result.lifecycleState).toBe("done");
  });
});

// ── AC3: in_flight distinguished from todo ─────────────────────────────────

describe("US-TRUTH-016 AC3 — in_flight ≠ todo", () => {
  it("in_flight is clearly distinct from todo", () => {
    const records = [
      makeRecord({ storyId: "US-INF", cycleId: "c1", lifecycleState: "in_flight", recordedAt: 100 }),
    ];
    const result = queryStoryDelivery("US-INF", records);
    expect(result.lifecycleState).toBe("in_flight");
    expect(result.delivered).toBe(false);
    expect(result.prNumber).toBe(42);
  });

  it("ci_red is a sub-state of in_flight", () => {
    const records = [
      makeRecord({ storyId: "US-CIR", cycleId: "c1", lifecycleState: "ci_red", recordedAt: 100 }),
    ];
    const result = queryStoryDelivery("US-CIR", records);
    expect(result.lifecycleState).toBe("ci_red");
    expect(result.delivered).toBe(false);
  });
});

// ── Done scenario ──────────────────────────────────────────────────────────

describe("US-TRUTH-016 AC1 — done scenario", () => {
  it("returns delivered: true when a done record exists", () => {
    const records = [
      makeRecord({
        storyId: "US-DONE",
        cycleId: "c1",
        lifecycleState: "done",
        prNumber: present(99),
        prUrl: present("https://gh/pull/99"),
        mergedAt: present(3000),
        mergeCommit: present("abc123def456"),
        recordedAt: 500,
      }),
    ];
    const result = queryStoryDelivery("US-DONE", records);
    expect(result.lifecycleState).toBe("done");
    expect(result.delivered).toBe(true);
    expect(result.prNumber).toBe(99);
    expect(result.mergeCommit).toBe("abc123def456");
  });

  it("delivered: true even if the latest record is in_flight but an earlier record is done", () => {
    const records = [
      makeRecord({ storyId: "US-MULTI", cycleId: "c1", lifecycleState: "done", recordedAt: 100 }),
      makeRecord({ storyId: "US-MULTI", cycleId: "c2", lifecycleState: "in_flight", recordedAt: 200 }),
    ];
    const result = queryStoryDelivery("US-MULTI", records);
    expect(result.lifecycleState).toBe("in_flight"); // latest
    expect(result.delivered).toBe(true); // any done
    expect(result.deliveringCycles).toEqual(["c1", "c2"]);
  });

  it("extracts merge details from the done record even when a later in_flight exists", () => {
    const records = [
      makeRecord({ storyId: "US-DET", cycleId: "c1", lifecycleState: "done", prNumber: present(1), mergeCommit: present("aaa"), recordedAt: 100 }),
      makeRecord({ storyId: "US-DET", cycleId: "c2", lifecycleState: "in_flight", prNumber: present(2), recordedAt: 200 }),
    ];
    const result = queryStoryDelivery("US-DET", records);
    expect(result.lifecycleState).toBe("in_flight");
    expect(result.delivered).toBe(true);
    // Merge commit comes from the done record
    expect(result.mergeCommit).toBe("aaa");
    // PR facts come from the best (done) record
    expect(result.prNumber).toBe(1);
  });
});

// ── Failed scenario ────────────────────────────────────────────────────────

describe("US-TRUTH-016 AC1 — failed scenario", () => {
  it("lifecycleState: failed, delivered: false", () => {
    const records = [
      makeRecord({
        storyId: "US-FAIL",
        cycleId: "c1",
        lifecycleState: "failed",
        prNumber: absent("no_publish_attempted"),
        prUrl: absent("no_publish_attempted"),
        recordedAt: 100,
      }),
    ];
    const result = queryStoryDelivery("US-FAIL", records);
    expect(result.lifecycleState).toBe("failed");
    expect(result.delivered).toBe(false);
    expect(result.prNumber).toBeUndefined();
  });
});

// ── Missing fields with reasons ────────────────────────────────────────────

describe("US-TRUTH-015 AC1 — missing prNumber on publish", () => {
  it("sets missingReason when in_flight record has no prNumber", () => {
    const records = [
      makeRecord({
        storyId: "US-NOPR",
        cycleId: "c1",
        lifecycleState: "in_flight",
        prNumber: absent("pr_number_unparseable"),
        prUrl: present("https://gh/pull/unknown"),
        recordedAt: 100,
      }),
    ];
    const result = queryStoryDelivery("US-NOPR", records);
    expect(result.lifecycleState).toBe("in_flight");
    expect(result.prNumber).toBeUndefined();
    expect(result.missingReason).toBe("pr_number_pr_number_unparseable");
  });

  it("sets missingReason when done record has no mergeCommit", () => {
    const records = [
      makeRecord({
        storyId: "US-NOMC",
        cycleId: "c1",
        lifecycleState: "done",
        prNumber: present(1),
        mergeCommit: absent("not_recorded"),
        recordedAt: 100,
      }),
    ];
    const result = queryStoryDelivery("US-NOMC", records);
    expect(result.lifecycleState).toBe("done");
    expect(result.delivered).toBe(true);
    expect(result.mergeCommit).toBeUndefined();
    expect(result.missingReason).toBe("merge_commit_not_recorded");
  });
});

// ── deriveBacklogStatus (US-TRUTH-015 AC3) ─────────────────────────────────

describe("US-TRUTH-015 AC3 — deriveBacklogStatus", () => {
  it("todo → 📋 Todo", () => {
    const t: StoryDeliveryTruth = {
      storyId: "US-TODO", lifecycleState: "todo", delivered: false,
      lastRecordedAt: 0, deliveringCycles: [],
    };
    expect(deriveBacklogStatus(t)).toBe("📋 Todo");
  });

  it("building → 🔨 In Progress", () => {
    const t: StoryDeliveryTruth = {
      storyId: "US-BLD", lifecycleState: "building", delivered: false,
      lastRecordedAt: 100, deliveringCycles: ["c1"],
    };
    expect(deriveBacklogStatus(t)).toBe("🔨 In Progress");
  });

  it("in_flight with PR → 🔨 In Progress · PR#42", () => {
    const t: StoryDeliveryTruth = {
      storyId: "US-INF", lifecycleState: "in_flight", delivered: false,
      prNumber: 42, prUrl: "https://gh/pull/42",
      lastRecordedAt: 100, deliveringCycles: ["c1"],
    };
    expect(deriveBacklogStatus(t)).toBe("🔨 In Progress · PR#42");
  });

  it("in_flight without PR → 🔨 In Progress (no suffix)", () => {
    const t: StoryDeliveryTruth = {
      storyId: "US-INF2", lifecycleState: "in_flight", delivered: false,
      lastRecordedAt: 100, deliveringCycles: ["c1"],
    };
    expect(deriveBacklogStatus(t)).toBe("🔨 In Progress");
  });

  it("done with merge commit → ✅ Done · merged abc123d", () => {
    const t: StoryDeliveryTruth = {
      storyId: "US-DONE", lifecycleState: "done", delivered: true,
      prNumber: 99, mergeCommit: "abc123def456",
      lastRecordedAt: 500, deliveringCycles: ["c1"],
    };
    expect(deriveBacklogStatus(t)).toBe("✅ Done · merged abc123d");
  });

  it("done without merge commit → ✅ Done · PR#99", () => {
    const t: StoryDeliveryTruth = {
      storyId: "US-DONE2", lifecycleState: "done", delivered: true,
      prNumber: 99,
      lastRecordedAt: 500, deliveringCycles: ["c1"],
    };
    expect(deriveBacklogStatus(t)).toBe("✅ Done · PR#99");
  });

  it("done without PR or merge → ✅ Done", () => {
    const t: StoryDeliveryTruth = {
      storyId: "US-DONE3", lifecycleState: "done", delivered: true,
      lastRecordedAt: 500, deliveringCycles: ["c1"],
    };
    expect(deriveBacklogStatus(t)).toBe("✅ Done");
  });

  it("failed → ❌ Failed", () => {
    const t: StoryDeliveryTruth = {
      storyId: "US-FAIL", lifecycleState: "failed", delivered: false,
      lastRecordedAt: 100, deliveringCycles: ["c1"],
    };
    expect(deriveBacklogStatus(t)).toBe("❌ Failed");
  });

  it("blocked → 🚫 Hold", () => {
    const t: StoryDeliveryTruth = {
      storyId: "US-BLK", lifecycleState: "blocked", delivered: false,
      lastRecordedAt: 100, deliveringCycles: ["c1"],
    };
    expect(deriveBacklogStatus(t)).toBe("🚫 Hold");
  });

  it("on_hold → 🚫 Hold", () => {
    const t: StoryDeliveryTruth = {
      storyId: "US-HLD", lifecycleState: "on_hold", delivered: false,
      lastRecordedAt: 100, deliveringCycles: ["c1"],
    };
    expect(deriveBacklogStatus(t)).toBe("🚫 Hold");
  });

  it("abandoned → 🗑️ Abandoned", () => {
    const t: StoryDeliveryTruth = {
      storyId: "US-ABN", lifecycleState: "abandoned", delivered: false,
      lastRecordedAt: 100, deliveringCycles: ["c1"],
    };
    expect(deriveBacklogStatus(t)).toBe("🗑️ Abandoned");
  });

  it("ci_red → 🔨 In Progress · PR#42 (still in_progress cluster)", () => {
    const t: StoryDeliveryTruth = {
      storyId: "US-CIR", lifecycleState: "ci_red", delivered: false,
      prNumber: 42,
      lastRecordedAt: 100, deliveringCycles: ["c1"],
    };
    expect(deriveBacklogStatus(t)).toBe("🔨 In Progress · PR#42");
  });
});

// ── End-to-end: query → derive ─────────────────────────────────────────────

describe("US-TRUTH-015 AC4 — end-to-end: query → derive", () => {
  it("publish → in_flight record → backlog shows 🔨 In Progress · PR#N", () => {
    const records = [
      makeRecord({
        storyId: "US-E2E",
        cycleId: "cycle-pub",
        lifecycleState: "in_flight",
        prNumber: present(878),
        prUrl: present("https://github.com/owner/repo/pull/878"),
        recordedAt: 1000,
      }),
    ];
    const truth = queryStoryDelivery("US-E2E", records);
    expect(truth.lifecycleState).toBe("in_flight");
    expect(truth.delivered).toBe(false);
    expect(truth.prNumber).toBe(878);

    const status = deriveBacklogStatus(truth);
    expect(status).toBe("🔨 In Progress · PR#878");
  });

  it("merge → done record → backlog shows ✅ Done · merged <sha>", () => {
    const records = [
      makeRecord({
        storyId: "US-E2E",
        cycleId: "cycle-pub",
        lifecycleState: "in_flight",
        prNumber: present(878),
        prUrl: present("https://github.com/owner/repo/pull/878"),
        recordedAt: 1000,
      }),
      makeRecord({
        storyId: "US-E2E",
        cycleId: "cycle-pub",
        lifecycleState: "done",
        prNumber: present(878),
        prUrl: present("https://github.com/owner/repo/pull/878"),
        mergedAt: present(2000),
        mergeCommit: present("deadbeefcafe"),
        recordedAt: 2000,
      }),
    ];
    const truth = queryStoryDelivery("US-E2E", records);
    expect(truth.lifecycleState).toBe("done");
    expect(truth.delivered).toBe(true);
    expect(truth.mergeCommit).toBe("deadbeefcafe");

    const status = deriveBacklogStatus(truth);
    expect(status).toBe("✅ Done · merged deadbee");
  });

  it("backlog status consistent with structured truth (not markdown)", () => {
    // The backlog display string is purely derived — no markdown parsing
    const records = [
      makeRecord({ storyId: "US-CONS", cycleId: "c1", lifecycleState: "in_flight", prNumber: present(5), recordedAt: 100 }),
    ];
    const truth = queryStoryDelivery("US-CONS", records);
    const status = deriveBacklogStatus(truth);
    // The status is derived from the structured record, not parsed from a
    // markdown cell — so it should be deterministic and machine-readable.
    expect(status).toContain("PR#5");
    // A machine can check the truth directly:
    expect(truth.lifecycleState).toBe("in_flight");
    expect(truth.prNumber).toBe(5);
  });
});
