/**
 * FIX-389a — rebuildDeliveriesFromFacts tests (projection engine).
 *
 * AC1: Deterministic + idempotent.
 * AC2: Delete deliveries.jsonl → rebuild → same result.
 * AC4: Backfill = rebuild from existing runs+git.
 * AC7: No false positives (truly todo cards stay todo).
 */
import { describe, expect, it } from "vitest";
import {
  extractRunFact,
  parseMergeCommitMessages,
  rebuildDeliveriesFromFacts,
  type RunFact,
  type MergeFact,
} from "../src/index.js";

// ── extractRunFact ───────────────────────────────────────────────────────────

describe("extractRunFact", () => {
  it("extracts a basic built row", () => {
    const row: Record<string, unknown> = {
      story_id: "US-TEST-001",
      cycle_id: "cycle-20260621-0001",
      status: "built",
      outcome: "published_pending_merge",
      pr_number: 42,
      ts: "2026-06-21T10:00:00Z",
    };
    const f = extractRunFact(row);
    expect(f).not.toBeNull();
    expect(f!.storyId).toBe("US-TEST-001");
    expect(f!.cycleId).toBe("cycle-20260621-0001");
    expect(f!.status).toBe("built");
    expect(f!.outcome).toBe("published_pending_merge");
    expect(f!.prNumber).toBe(42);
    expect(f!.mergeCommit).toBeUndefined();
    expect(f!.mergedAt).toBeUndefined();
    expect(f!.recordedAt).toBeGreaterThan(0);
  });

  it("extracts a merged row with backfill stamps", () => {
    const row: Record<string, unknown> = {
      story_id: "US-DONE-001",
      cycle_id: "cycle-merge",
      status: "merged",
      outcome: "delivered",
      pr_number: 99,
      merge_commit: "abc123def456",
      merged_at: 1719000000000,
      ts: "2026-06-21T12:00:00Z",
    };
    const f = extractRunFact(row);
    expect(f).not.toBeNull();
    expect(f!.storyId).toBe("US-DONE-001");
    expect(f!.mergeCommit).toBe("abc123def456");
    expect(f!.mergedAt).toBe(1719000000000);
    expect(f!.prNumber).toBe(99);
  });

  it("reads routed_story as fallback for story_id", () => {
    const row: Record<string, unknown> = {
      routed_story: "US-ALT",
      cycle_id: "c1",
      status: "published",
      ts: "2026-01-01T00:00:00Z",
    };
    const f = extractRunFact(row);
    expect(f).not.toBeNull();
    expect(f!.storyId).toBe("US-ALT");
  });

  it("returns null when storyId is missing", () => {
    const row: Record<string, unknown> = {
      cycle_id: "c1",
      status: "built",
    };
    expect(extractRunFact(row)).toBeNull();
  });

  it("returns null when cycleId is missing", () => {
    const row: Record<string, unknown> = {
      story_id: "US-NO-CYCLE",
      status: "built",
    };
    expect(extractRunFact(row)).toBeNull();
  });

  it("parses merged_at as string timestamp", () => {
    const row: Record<string, unknown> = {
      story_id: "US-STRMERGED",
      cycle_id: "c1",
      status: "merged",
      outcome: "delivered",
      merge_commit: "abc123",
      merged_at: "2026-06-20T18:07:32Z",
      ts: "2026-06-21T10:00:00Z",
    };
    const f = extractRunFact(row);
    expect(f).not.toBeNull();
    expect(f!.mergedAt).toBe(1781978852000);
    expect(f!.mergeCommit).toBe("abc123");
  });

  it("parses merged_at as number", () => {
    const row: Record<string, unknown> = {
      story_id: "US-NUMMERGED",
      cycle_id: "c1",
      status: "merged",
      outcome: "delivered",
      merged_at: 1718885252000,
      ts: "2026-06-21T10:00:00Z",
    };
    const f = extractRunFact(row);
    expect(f).not.toBeNull();
    expect(f!.mergedAt).toBe(1718885252000);
  });

  it("handles numeric ts as recordedAt", () => {
    const row: Record<string, unknown> = {
      story_id: "US-NUMTS",
      cycle_id: "c1",
      status: "built",
      ts: 1719000000000,
    };
    const f = extractRunFact(row);
    expect(f).not.toBeNull();
    expect(f!.recordedAt).toBe(1719000000000);
  });

  it("uses recordedAt when ts is absent", () => {
    const row: Record<string, unknown> = {
      story_id: "US-RECAT",
      cycle_id: "c1",
      status: "built",
      recordedAt: 1700000000000,
    };
    const f = extractRunFact(row);
    expect(f).not.toBeNull();
    expect(f!.recordedAt).toBe(1700000000000);
  });
});

// ── parseMergeCommitMessages ─────────────────────────────────────────────────

describe("parseMergeCommitMessages", () => {
  it("parses 'Merge pull request #N' lines", () => {
    // git log is newest-first, so line 1 is newer
    const lines = [
      "def456 1719000100 Merge pull request #99 from other/fix",
      "abc123 1719000000 Merge pull request #42 from branch/feature",
    ];
    const facts = parseMergeCommitMessages(lines);
    expect(facts).toHaveLength(2);
    expect(facts[0].prNumber).toBe(99); // first occurrence wins (reverse-chron)
    expect(facts[0].mergeCommit).toBe("def456");
    expect(facts[1].prNumber).toBe(42);
    expect(facts[1].mergeCommit).toBe("abc123");
  });

  it("parses squash-merge '(#N)' in subject", () => {
    const lines = [
      "ghi789 1719000200 feat: add projection engine (#55)",
    ];
    const facts = parseMergeCommitMessages(lines);
    expect(facts).toHaveLength(1);
    expect(facts[0].prNumber).toBe(55);
    expect(facts[0].mergeCommit).toBe("ghi789");
  });

  it("skips non-merge lines", () => {
    const lines = [
      "jkl012 1719000300 regular commit without PR",
    ];
    const facts = parseMergeCommitMessages(lines);
    expect(facts).toHaveLength(0);
  });

  it("first occurrence wins for duplicate PR numbers", () => {
    // git log is newest-first, so the newer merge appears first
    const lines = [
      "bbb222 1719000500 Merge pull request #10 from second",
      "aaa111 1719000400 Merge pull request #10 from first",
    ];
    const facts = parseMergeCommitMessages(lines);
    expect(facts).toHaveLength(1);
    expect(facts[0].mergeCommit).toBe("bbb222"); // newer, first in reversed output
  });

  it("handles empty input", () => {
    expect(parseMergeCommitMessages([])).toHaveLength(0);
  });
});

// ── rebuildDeliveriesFromFacts (AC1, AC4, AC7) ───────────────────────────────

function makeRun(overrides: Partial<RunFact> = {}): RunFact {
  return {
    storyId: "US-TEST",
    cycleId: "cycle-default",
    status: "built",
    outcome: "published_pending_merge",
    prNumber: 42,
    recordedAt: 1000,
    ...overrides,
  };
}

function makeMerge(overrides: Partial<MergeFact> = {}): MergeFact {
  return {
    prNumber: 42,
    mergeCommit: "abc123def456",
    mergedAt: 2000,
    ...overrides,
  };
}

describe("rebuildDeliveriesFromFacts — AC1: done when PR merged", () => {
  it("emits done record when a run's PR matches a git merge", () => {
    const runs = [makeRun({ storyId: "US-DONE", prNumber: 42 })];
    const merges = [makeMerge({ prNumber: 42 })];
    const result = rebuildDeliveriesFromFacts(runs, merges);
    expect(result).toHaveLength(1);
    expect(result[0].storyId).toBe("US-DONE");
    expect(result[0].lifecycleState).toBe("done");
    expect(result[0].prNumber).toEqual({ present: true, value: 42 });
    expect(result[0].mergeCommit).toEqual({ present: true, value: "abc123def456" });
  });

  it("emits done when run already has backfill merge stamps", () => {
    const runs = [makeRun({
      storyId: "US-BACKFILLED",
      mergeCommit: "deadbeef",
      mergedAt: 3000000,
      prNumber: 10,
    })];
    const result = rebuildDeliveriesFromFacts(runs, []);
    expect(result).toHaveLength(1);
    expect(result[0].lifecycleState).toBe("done");
    expect(result[0].mergeCommit).toEqual({ present: true, value: "deadbeef" });
  });

  it("includes repoSlug in prUrl when provided", () => {
    const runs = [makeRun({ storyId: "US-SLUG", prNumber: 42 })];
    const merges = [makeMerge({ prNumber: 42 })];
    const result = rebuildDeliveriesFromFacts(runs, merges, "owner/repo");
    expect(result[0].prUrl).toEqual({
      present: true,
      value: "https://github.com/owner/repo/pull/42",
    });
  });

  it("prUrl absent when repoSlug not provided", () => {
    const runs = [makeRun({ storyId: "US-NOSLUG", prNumber: 42 })];
    const merges = [makeMerge({ prNumber: 42 })];
    const result = rebuildDeliveriesFromFacts(runs, merges);
    expect(result[0].prUrl).toEqual({ present: false, reason: "not_recorded" });
  });
});

describe("rebuildDeliveriesFromFacts — AC1: in_flight when published not merged", () => {
  it("emits in_flight for published_pending_merge with no matching merge", () => {
    const runs = [makeRun({
      storyId: "US-FLIGHT",
      outcome: "published_pending_merge",
      prNumber: 42,
    })];
    const result = rebuildDeliveriesFromFacts(runs, []);
    expect(result).toHaveLength(1);
    expect(result[0].lifecycleState).toBe("in_flight");
    expect(result[0].prNumber).toEqual({ present: true, value: 42 });
    expect(result[0].mergeCommit).toEqual({ present: false, reason: "not_recorded" });
  });

  it("emits in_flight with prUrl when repoSlug provided", () => {
    const runs = [makeRun({
      storyId: "US-FLIGHT2",
      outcome: "published_pending_merge",
      prNumber: 88,
    })];
    const result = rebuildDeliveriesFromFacts(runs, [], "o/r");
    expect(result[0].prUrl).toEqual({
      present: true,
      value: "https://github.com/o/r/pull/88",
    });
  });
});

describe("rebuildDeliveriesFromFacts — AC1: other outcomes", () => {
  it("failed outcome → failed lifecycle", () => {
    const runs = [makeRun({
      storyId: "US-FAIL",
      outcome: "failed",
      prNumber: undefined,
    })];
    const result = rebuildDeliveriesFromFacts(runs, []);
    expect(result).toHaveLength(1);
    expect(result[0].lifecycleState).toBe("failed");
  });

  it("blocked outcome → blocked lifecycle", () => {
    const runs = [makeRun({
      storyId: "US-BLOCK",
      outcome: "blocked",
      prNumber: undefined,
    })];
    const result = rebuildDeliveriesFromFacts(runs, []);
    expect(result).toHaveLength(1);
    expect(result[0].lifecycleState).toBe("blocked");
  });

  it("idle_no_work → no record (todo)", () => {
    const runs = [makeRun({
      storyId: "US-IDLE",
      outcome: "idle_no_work",
    })];
    const result = rebuildDeliveriesFromFacts(runs, []);
    expect(result).toHaveLength(0);
  });

  it("gave_up → failed lifecycle", () => {
    const runs = [makeRun({
      storyId: "US-GAVEUP",
      outcome: "gave_up",
      prNumber: undefined,
    })];
    const result = rebuildDeliveriesFromFacts(runs, []);
    expect(result).toHaveLength(1);
    expect(result[0].lifecycleState).toBe("failed");
  });

  it("aborted_with_delivery → in_flight", () => {
    const runs = [makeRun({
      storyId: "US-ABORTED",
      outcome: "aborted_with_delivery",
      prNumber: 77,
    })];
    const result = rebuildDeliveriesFromFacts(runs, []);
    expect(result).toHaveLength(1);
    expect(result[0].lifecycleState).toBe("in_flight");
  });
});

describe("rebuildDeliveriesFromFacts — AC7: no false positives", () => {
  it("truly todo story (no runs, no merges) → empty result", () => {
    const result = rebuildDeliveriesFromFacts([], []);
    expect(result).toHaveLength(0);
  });

  it("unknown outcome → no record", () => {
    const runs = [makeRun({
      storyId: "US-UNKNOWN",
      outcome: "unknown",
    })];
    const result = rebuildDeliveriesFromFacts(runs, []);
    expect(result).toHaveLength(0);
  });

  it("run with no outcome and no merge → no record", () => {
    const runs = [makeRun({
      storyId: "US-NOOUT",
      outcome: "",
    })];
    const result = rebuildDeliveriesFromFacts(runs, []);
    expect(result).toHaveLength(0);
  });
});

describe("rebuildDeliveriesFromFacts — constraints", () => {
  it("deterministic: same input → same output", () => {
    const runs = [
      makeRun({ storyId: "US-DET", prNumber: 1, recordedAt: 100 }),
      makeRun({ storyId: "US-DET", prNumber: 1, outcome: "published_pending_merge", recordedAt: 200 }),
    ];
    const merges = [makeMerge({ prNumber: 1 })];
    const r1 = rebuildDeliveriesFromFacts(runs, merges);
    const r2 = rebuildDeliveriesFromFacts(runs, merges);
    expect(r1).toEqual(r2);
  });

  it("idempotent: rebuild twice yields same result", () => {
    const runs = [
      makeRun({ storyId: "US-IDEM", prNumber: 5, recordedAt: 100 }),
    ];
    const merges = [makeMerge({ prNumber: 5 })];
    const first = rebuildDeliveriesFromFacts(runs, merges);
    const second = rebuildDeliveriesFromFacts(runs, merges);
    expect(first).toEqual(second);
  });

  it("latest-wins: later run overrides earlier for same story", () => {
    const runs = [
      makeRun({ storyId: "US-LW", outcome: "failed", prNumber: undefined, recordedAt: 100 }),
      makeRun({ storyId: "US-LW", outcome: "published_pending_merge", prNumber: 42, recordedAt: 200 }),
    ];
    const result = rebuildDeliveriesFromFacts(runs, []);
    expect(result).toHaveLength(1);
    expect(result[0].lifecycleState).toBe("in_flight");
  });

  it("merged beats in_flight: even if latest run is in_flight, merge wins", () => {
    const runs = [
      makeRun({ storyId: "US-MB", outcome: "published_pending_merge", prNumber: 99, recordedAt: 100 }),
      makeRun({ storyId: "US-MB", outcome: "published_pending_merge", prNumber: 99, recordedAt: 200 }),
    ];
    const merges = [makeMerge({ prNumber: 99 })];
    const result = rebuildDeliveriesFromFacts(runs, merges);
    expect(result).toHaveLength(1);
    expect(result[0].lifecycleState).toBe("done");
  });

  it("AC2: delete deliveries → rebuild → same result (simulated)", () => {
    // Rebuilding from the same facts always produces the same deliveries.
    // This simulates the "delete the file and rebuild" scenario.
    const runs = [
      makeRun({ storyId: "US-AC2A", prNumber: 10, recordedAt: 100 }),
      makeRun({ storyId: "US-AC2B", outcome: "published_pending_merge", prNumber: 20, recordedAt: 200 }),
    ];
    const merges = [
      makeMerge({ prNumber: 10 }),
    ];
    // First "build"
    const d1 = rebuildDeliveriesFromFacts(runs, merges, "o/r");
    // Delete + rebuild = same result
    const d2 = rebuildDeliveriesFromFacts(runs, merges, "o/r");
    expect(d2).toEqual(d1);
    // US-AC2A should be done
    const doneRec = d2.find((r) => r.storyId === "US-AC2A");
    expect(doneRec).toBeDefined();
    expect(doneRec!.lifecycleState).toBe("done");

    // US-AC2B should be in_flight
    const flightRec = d2.find((r) => r.storyId === "US-AC2B");
    expect(flightRec).toBeDefined();
    expect(flightRec!.lifecycleState).toBe("in_flight");
  });

  it("AC4: backfill = rebuild — no separate script needed", () => {
    // Simulate multiple stories that were delivered before deliveries.jsonl existed.
    // These should all be reconstructed from runs + git facts.
    const runs: RunFact[] = [
      { storyId: "US-OLD1", cycleId: "c1", status: "merged", outcome: "delivered", prNumber: 1, recordedAt: 10 },
      { storyId: "US-OLD2", cycleId: "c2", status: "built", outcome: "published_pending_merge", prNumber: 2, recordedAt: 20 },
      { storyId: "US-OLD3", cycleId: "c3", status: "built", outcome: "published_pending_merge", prNumber: 3, recordedAt: 30 },
      { storyId: "US-OLD4", cycleId: "c4", status: "failed", outcome: "failed", recordedAt: 40 },
    ];
    const merges: MergeFact[] = [
      { prNumber: 1, mergeCommit: "aaa", mergedAt: 15 },
      { prNumber: 3, mergeCommit: "ccc", mergedAt: 35 },
    ];

    const deliveries = rebuildDeliveriesFromFacts(runs, merges);

    // US-OLD1: merged in runs + git → done
    const d1 = deliveries.find((d) => d.storyId === "US-OLD1");
    expect(d1!.lifecycleState).toBe("done");

    // US-OLD2: published but not merged → in_flight
    const d2 = deliveries.find((d) => d.storyId === "US-OLD2");
    expect(d2!.lifecycleState).toBe("in_flight");

    // US-OLD3: published AND merged (via git) → done
    const d3 = deliveries.find((d) => d.storyId === "US-OLD3");
    expect(d3!.lifecycleState).toBe("done");
    expect(d3!.mergeCommit).toEqual({ present: true, value: "ccc" });

    // US-OLD4: failed → no record (failure emits but in failed state)
    const d4 = deliveries.find((d) => d.storyId === "US-OLD4");
    expect(d4!.lifecycleState).toBe("failed");
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("rebuildDeliveriesFromFacts — backfill mergeCommit without prNumber", () => {
  it("emits done when backfill has mergeCommit but no prNumber", () => {
    const runs = [makeRun({
      storyId: "US-NOPR",
      prNumber: undefined,
      mergeCommit: "nopr-sha",
      mergedAt: 5000000,
    })];
    const result = rebuildDeliveriesFromFacts(runs, []);
    expect(result).toHaveLength(1);
    expect(result[0].lifecycleState).toBe("done");
    expect(result[0].mergeCommit).toEqual({ present: true, value: "nopr-sha" });
    // prNumber absent when not available
    expect(result[0].prNumber.present).toBe(false);
  });

  it("cross-references git merges by SHA to find missing prNumber", () => {
    const runs = [makeRun({
      storyId: "US-SHALOOKUP",
      prNumber: undefined,
      mergeCommit: "abc123sha",
      mergedAt: 5000000,
    })];
    const merges = [
      { prNumber: 883, mergeCommit: "abc123sha", mergedAt: 2000 },
    ];
    const result = rebuildDeliveriesFromFacts(runs, merges);
    expect(result).toHaveLength(1);
    expect(result[0].lifecycleState).toBe("done");
    expect(result[0].prNumber).toEqual({ present: true, value: 883 });
    expect(result[0].mergeCommit).toEqual({ present: true, value: "abc123sha" });
  });

  it("prefers backfill prNumber over git SHA lookup", () => {
    const runs = [makeRun({
      storyId: "US-PREFER",
      prNumber: 42,
      mergeCommit: "shared-sha",
      mergedAt: 5000000,
    })];
    const merges = [
      { prNumber: 883, mergeCommit: "shared-sha", mergedAt: 2000 },
    ];
    const result = rebuildDeliveriesFromFacts(runs, merges);
    expect(result).toHaveLength(1);
    // Backfill prNumber wins
    expect(result[0].prNumber).toEqual({ present: true, value: 42 });
  });

  it("AC4: US-TRUTH-016 scenario — mergeCommit present, prNumber from git, done", () => {
    // Simulates the real US-TRUTH-016 row: mergeCommit=9efd807, no pr_number
    const runs: RunFact[] = [{
      storyId: "US-TRUTH-016",
      cycleId: "20260621-014644-46091",
      status: "merged",
      outcome: "delivered",
      prNumber: undefined,
      mergeCommit: "9efd807189ca538ccde38bfb55f461b2a5e614c9",
      mergedAt: 1718885252000,
      recordedAt: 1718885176000,
    }];
    const merges: MergeFact[] = [{
      prNumber: 883,
      mergeCommit: "9efd807189ca538ccde38bfb55f461b2a5e614c9",
      mergedAt: 1718885251,
    }];
    const result = rebuildDeliveriesFromFacts(runs, merges, "seanyao/roll");
    expect(result).toHaveLength(1);
    expect(result[0].storyId).toBe("US-TRUTH-016");
    expect(result[0].lifecycleState).toBe("done");
    expect(result[0].prNumber).toEqual({ present: true, value: 883 });
    expect(result[0].mergeCommit).toEqual({ present: true, value: "9efd807189ca538ccde38bfb55f461b2a5e614c9" });
    expect(result[0].prUrl).toEqual({ present: true, value: "https://github.com/seanyao/roll/pull/883" });
  });
});

describe("rebuildDeliveriesFromFacts — edge cases", () => {
  it("multiple runs for same story, merge found via first run's PR", () => {
    const runs = [
      makeRun({ storyId: "US-EDGE", cycleId: "c1", prNumber: 55, recordedAt: 100 }),
      makeRun({ storyId: "US-EDGE", cycleId: "c2", prNumber: undefined, outcome: "failed", recordedAt: 200 }),
    ];
    const merges = [makeMerge({ prNumber: 55 })];
    const result = rebuildDeliveriesFromFacts(runs, merges);
    expect(result).toHaveLength(1);
    expect(result[0].lifecycleState).toBe("done");
  });

  it("story with backfill merge data and git merge → uses backfill data", () => {
    const runs = [makeRun({
      storyId: "US-BF",
      mergeCommit: "backfill-sha",
      mergedAt: 5000000,
      prNumber: 7,
      recordedAt: 100,
    })];
    const merges = [makeMerge({ prNumber: 7, mergeCommit: "git-sha" })];
    const result = rebuildDeliveriesFromFacts(runs, merges);
    expect(result).toHaveLength(1);
    // Backfill data wins (checked first)
    expect(result[0].mergeCommit).toEqual({ present: true, value: "backfill-sha" });
  });

  it("empty runs → empty result", () => {
    const result = rebuildDeliveriesFromFacts([], [makeMerge({ prNumber: 1 })]);
    expect(result).toHaveLength(0);
  });
});
