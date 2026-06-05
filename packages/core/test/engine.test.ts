/**
 * Unit tests for ReconcileEngine (US-CORE-008): merge-evidence backfill (I4:
 * built ≠ merged) + 进行中 TTL detection (loop_unstick mirror).
 */
import { describe, expect, it } from "vitest";
import {
  type MergeEvidence,
  type ReconcileRunRow,
  type UnstickEvent,
  applyStuckReverts,
  cycleEndForPick,
  decideClaimReconcile,
  detectStuckStories,
  inProgressStories,
  latestDeliveringCycle,
  reconcileBranchName,
  reconcileMergeEvidence,
  reconcileStuckBacklog,
} from "../src/index.js";

const HOUR = 3_600_000;

describe("reconcileMergeEvidence — built ≠ merged (I4)", () => {
  const lookup = (table: Record<string, MergeEvidence>) => (branch: string) => table[branch];

  it("credits a built row only on real MERGED evidence", () => {
    const rows: ReconcileRunRow[] = [{ status: "built", cycle_id: "c1", story_type: "US" }];
    const res = reconcileMergeEvidence(
      rows,
      lookup({ [reconcileBranchName("c1")]: { state: "MERGED", mergedAt: "2026-01-01T00:00:00Z", mergeCommit: "abc" } }),
    );
    expect(res.rows[0]).toMatchObject({ status: "merged", merged_at: "2026-01-01T00:00:00Z", merge_commit: "abc" });
    expect(res.rows[0]?.story_type).toBe("US"); // other fields preserved
    expect(res.credited).toEqual([{ cycleId: "c1", mergedAt: "2026-01-01T00:00:00Z", mergeCommit: "abc" }]);
  });

  it("leaves a built row untouched when PR not MERGED (Done ≠ merged)", () => {
    const rows: ReconcileRunRow[] = [{ status: "built", cycle_id: "c1" }];
    const res = reconcileMergeEvidence(rows, lookup({ [reconcileBranchName("c1")]: { state: "OPEN" } }));
    expect(res.rows[0]).toEqual({ status: "built", cycle_id: "c1" });
    expect(res.credited).toHaveLength(0);
  });

  it("passes through non-built rows and empty cycle ids verbatim", () => {
    const rows: ReconcileRunRow[] = [
      { status: "merged", cycle_id: "c0" },
      { status: "built", cycle_id: "" },
      { status: "idle" },
    ];
    const res = reconcileMergeEvidence(rows, lookup({}));
    expect(res.rows).toEqual(rows);
    expect(res.credited).toHaveLength(0);
  });

  it("missing evidence (unknown branch) leaves the row built", () => {
    const rows: ReconcileRunRow[] = [{ status: "built", cycle_id: "c9" }];
    const res = reconcileMergeEvidence(rows, lookup({}));
    expect(res.rows[0]?.status).toBe("built");
  });
});

describe("cycleEndForPick — latest pick → its cycle_end", () => {
  it("pairs the latest pick to the first cycle_end whose label ends with the pick label", () => {
    const events: UnstickEvent[] = [
      { stage: "pick_todo", detail: "US-1", label: "cyc-a", ts: 1 },
      { stage: "cycle_end", label: "cyc-a", outcome: "failed", ts: 2 },
    ];
    expect(cycleEndForPick(events, "US-1")).toEqual({ endTs: 2, outcome: "failed" });
  });

  it("returns null when the story was never picked", () => {
    expect(cycleEndForPick([{ stage: "pick_todo", detail: "US-2", label: "x", ts: 1 }], "US-1")).toBeNull();
  });

  it("returns null when the picked cycle is still running (no cycle_end)", () => {
    expect(cycleEndForPick([{ stage: "pick_todo", detail: "US-1", label: "x", ts: 1 }], "US-1")).toBeNull();
  });

  it("uses the LATEST pick when a story was picked twice", () => {
    const events: UnstickEvent[] = [
      { stage: "pick_todo", detail: "US-1", label: "old", ts: 1 },
      { stage: "cycle_end", label: "old", outcome: "failed", ts: 2 },
      { stage: "pick_todo", detail: "US-1", label: "new", ts: 3 },
      { stage: "cycle_end", label: "new", outcome: "aborted", ts: 4 },
    ];
    expect(cycleEndForPick(events, "US-1")).toEqual({ endTs: 4, outcome: "aborted" });
  });
});

describe("detectStuckStories — conservative TTL gate", () => {
  const events = (outcome: string, endTsHoursAgo: number, now: number): UnstickEvent[] => [
    { stage: "pick_todo", detail: "US-1", label: "c", ts: now - endTsHoursAgo * HOUR - 1 },
    { stage: "cycle_end", label: "c", outcome, ts: now - endTsHoursAgo * HOUR },
  ];

  it("reverts a stuck-and-stale failed story (> TTL)", () => {
    const now = 1_000 * HOUR;
    const reverts = detectStuckStories({ inProgress: [{ id: "US-1" }], events: events("failed", 6, now), now });
    expect(reverts).toHaveLength(1);
    expect(reverts[0]).toMatchObject({ storyId: "US-1", outcome: "failed" });
    expect(reverts[0]?.ageHours).toBeCloseTo(6, 5);
  });

  it("leaves a stuck-but-fresh failure alone (< TTL)", () => {
    const now = 1_000 * HOUR;
    expect(detectStuckStories({ inProgress: [{ id: "US-1" }], events: events("failed", 2, now), now })).toHaveLength(0);
  });

  it("ignores a non-failed latest cycle", () => {
    const now = 1_000 * HOUR;
    expect(detectStuckStories({ inProgress: [{ id: "US-1" }], events: events("delivered", 6, now), now })).toHaveLength(0);
  });

  it("ignores a story with no cycle record", () => {
    const now = 1_000 * HOUR;
    expect(detectStuckStories({ inProgress: [{ id: "US-1" }], events: [], now })).toHaveLength(0);
  });

  it("honours a custom ttlHours", () => {
    const now = 1_000 * HOUR;
    expect(detectStuckStories({ inProgress: [{ id: "US-1" }], events: events("blocked", 6, now), now, ttlHours: 8 })).toHaveLength(0);
    expect(detectStuckStories({ inProgress: [{ id: "US-1" }], events: events("blocked", 6, now), now, ttlHours: 4 })).toHaveLength(1);
  });
});

describe("inProgressStories + applyStuckReverts", () => {
  it("scans only 🔨 In Progress rows with an id", () => {
    const backlog = [
      "| US-1 | a | 🔨 In Progress |",
      "| US-2 | b | 📋 Todo |",
      "| no-id | c | 🔨 In Progress |",
      "",
    ].join("\n");
    expect(inProgressStories(backlog).map((s) => s.id)).toEqual(["US-1"]);
  });

  it("flips only reverted rows' marker, preserving the rest byte-for-byte", () => {
    const backlog = ["| US-1 | a | 🔨 In Progress |", "| US-2 | b | 🔨 In Progress |", ""].join("\n");
    const out = applyStuckReverts(backlog, [{ storyId: "US-1", outcome: "failed", ageHours: 6 }]);
    expect(out).toBe(["| US-1 | a | 📋 Todo |", "| US-2 | b | 🔨 In Progress |", ""].join("\n"));
  });

  it("reconcileStuckBacklog wires scan → gate end to end", () => {
    const now = 1_000 * HOUR;
    const backlog = "| US-1 | a | 🔨 In Progress |\n";
    const events: UnstickEvent[] = [
      { stage: "pick_todo", detail: "US-1", label: "c", ts: now - 6 * HOUR - 1 },
      { stage: "cycle_end", label: "c", outcome: "failed", ts: now - 6 * HOUR },
    ];
    expect(reconcileStuckBacklog(backlog, events, now).map((r) => r.storyId)).toEqual(["US-1"]);
  });
});

describe("decideClaimReconcile — FIX-211: Done ≡ merged (no publish-time抢跑)", () => {
  it("flips ✅ Done only on MERGED evidence", () => {
    expect(decideClaimReconcile({ hasDeliveringCycle: true, prState: "MERGED" })).toBe("done");
  });

  it("leaves an OPEN (delivered, pending merge) claim at 🔨", () => {
    expect(decideClaimReconcile({ hasDeliveringCycle: true, prState: "OPEN" })).toBe("keep");
  });

  it("treats unknown/unprobed PR state as pending — keep, never premature Done", () => {
    expect(decideClaimReconcile({ hasDeliveringCycle: true })).toBe("keep");
    expect(decideClaimReconcile({ hasDeliveringCycle: true, prState: "UNKNOWN" })).toBe("keep");
  });

  it("reverts a CLOSED (abandoned, unmerged) claim to 📋 Todo for re-pick", () => {
    expect(decideClaimReconcile({ hasDeliveringCycle: true, prState: "CLOSED" })).toBe("todo");
  });

  it("reverts a dead claim with no delivering cycle to 📋 Todo (orphan recovery)", () => {
    expect(decideClaimReconcile({ hasDeliveringCycle: false })).toBe("todo");
    expect(decideClaimReconcile({ hasDeliveringCycle: false, prState: "MERGED" })).toBe("todo");
  });
});

describe("latestDeliveringCycle — map a 🔨 story to the cycle that delivered it", () => {
  const rows: ReconcileRunRow[] = [
    { story_id: "US-1", cycle_id: "c-early", status: "failed" },
    { story_id: "US-1", cycle_id: "c-built", status: "built" },
    { story_id: "US-2", cycle_id: "c-other", status: "done" },
    { story_id: "US-1", cycle_id: "c-done", status: "done" },
  ];

  it("returns the newest delivering (done|built|merged) cycle for the story", () => {
    expect(latestDeliveringCycle(rows, "US-1")).toBe("c-done");
    expect(latestDeliveringCycle(rows, "US-2")).toBe("c-other");
  });

  it("ignores non-delivering rows (failed/aborted) — undefined when none deliver", () => {
    expect(latestDeliveringCycle([{ story_id: "US-9", cycle_id: "c", status: "failed" }], "US-9")).toBeUndefined();
  });

  it("returns undefined for a story with no runs row (dead claim, no PR)", () => {
    expect(latestDeliveringCycle(rows, "US-404")).toBeUndefined();
  });
});
