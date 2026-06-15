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
  resumeCandidateBranches,
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

  // FIX-243/244 — the backfill credits ALL claim-shaped statuses, not just
  // v2's "built": "published" (publish-ok, merge pending) and "failed" (the
  // phantom-failure rows observed 2026-06-10 — cycle judged failed, its PR
  // merged minutes later). Crediting also corrects `outcome` so dashboards
  // stop reading a merged delivery as failed.
  it("FIX-244: credits a published row on MERGED evidence (status merged + outcome delivered)", () => {
    const rows: ReconcileRunRow[] = [{ status: "published", cycle_id: "c2", outcome: "delivered" }];
    const res = reconcileMergeEvidence(
      rows,
      lookup({ [reconcileBranchName("c2")]: { state: "MERGED", mergedAt: "2026-06-11T00:00:00Z", mergeCommit: "def" } }),
    );
    expect(res.rows[0]).toMatchObject({ status: "merged", outcome: "delivered", merged_at: "2026-06-11T00:00:00Z" });
    expect(res.credited).toHaveLength(1);
  });

  it("FIX-243: heals a phantom-failed row whose PR really merged (failed → merged, outcome → delivered)", () => {
    const rows: ReconcileRunRow[] = [{ status: "failed", cycle_id: "c3", outcome: "failed", story_id: "FIX-9" }];
    const res = reconcileMergeEvidence(
      rows,
      lookup({ [reconcileBranchName("c3")]: { state: "MERGED", mergedAt: "2026-06-11T01:00:00Z", mergeCommit: "ghi" } }),
    );
    expect(res.rows[0]).toMatchObject({ status: "merged", outcome: "delivered", merge_commit: "ghi" });
    expect(res.rows[0]?.story_id).toBe("FIX-9"); // other fields preserved
  });

  it("a failed row with no PR / unmerged PR stays failed (no generosity without evidence)", () => {
    const rows: ReconcileRunRow[] = [
      { status: "failed", cycle_id: "c4", outcome: "failed" },
      { status: "failed", cycle_id: "c5", outcome: "failed" },
    ];
    const res = reconcileMergeEvidence(rows, lookup({ [reconcileBranchName("c5")]: { state: "CLOSED" } }));
    expect(res.rows).toEqual(rows);
    expect(res.credited).toHaveLength(0);
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

  it("FIX-322: a `published` cycle (PR open, merge pending) IS a delivering cycle (not a dead claim)", () => {
    // Before FIX-322 this returned undefined → preflight flipped 🔨→Todo → the
    // card was re-picked and re-delivered (duplicate) before merge-backfill.
    expect(latestDeliveringCycle([{ story_id: "US-7", cycle_id: "c-pub", status: "published" }], "US-7")).toBe("c-pub");
  });
});

describe("resumeCandidateBranches — map a card to its un-merged cycle branches", () => {
  it("returns branch-pushing terminals most-recent-first (orphan/failed/built/published/done)", () => {
    const rows: ReconcileRunRow[] = [
      { story_id: "FIX-284", cycle_id: "20260614-195600-25595", status: "orphan" },
      { story_id: "FIX-285", cycle_id: "other", status: "orphan" },
      { story_id: "FIX-284", cycle_id: "20260614-204221-43478", status: "failed" },
    ];
    expect(resumeCandidateBranches(rows, "FIX-284")).toEqual([
      reconcileBranchName("20260614-204221-43478"),
      reconcileBranchName("20260614-195600-25595"),
    ]);
  });

  it("excludes idle / blocked / aborted (no branch with new work was pushed)", () => {
    const rows: ReconcileRunRow[] = [
      { story_id: "US-1", cycle_id: "c-idle", status: "idle" },
      { story_id: "US-1", cycle_id: "c-blocked", status: "blocked" },
      { story_id: "US-1", cycle_id: "c-aborted", status: "aborted" },
    ];
    expect(resumeCandidateBranches(rows, "US-1")).toEqual([]);
  });

  it("dedupes repeated cycle_id rows and keeps only the picked story", () => {
    const rows: ReconcileRunRow[] = [
      { story_id: "US-1", cycle_id: "c1", status: "built" }, // first row for c1
      { story_id: "US-2", cycle_id: "c2", status: "orphan" }, // different story
      { story_id: "US-1", cycle_id: "c1", status: "published" }, // upsert of same c1
    ];
    expect(resumeCandidateBranches(rows, "US-1")).toEqual([reconcileBranchName("c1")]);
  });

  it("returns [] for a story with no recorded cycles", () => {
    expect(resumeCandidateBranches([], "US-404")).toEqual([]);
  });
});
