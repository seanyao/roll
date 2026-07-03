import { describe, expect, it } from "vitest";
import { LOOP_PARDON_SKIP_LIST_USAGE, rebuildSkipStateFromEvidence } from "../src/commands/loop-pardon-skip-list.js";

describe("roll loop pardon-skip-list", () => {
  it("removes env/harness polluted skip entries and keeps real card failures", () => {
    const rebuilt = rebuildSkipStateFromEvidence({
      currentFails: { "US-CAPTURE-006": 3, "US-REAL-001": 3 },
      currentSkip: ["US-CAPTURE-006", "US-REAL-001"],
      threshold: 3,
      rows: [
        { story_id: "US-CAPTURE-006", cycle_id: "env-1", status: "failed", failure_class: "env", root_cause_key: "env:main_dirty" },
        { story_id: "US-CAPTURE-006", cycle_id: "env-2", status: "failed", failure_class: "env", root_cause_key: "env:main_dirty" },
        { story_id: "US-CAPTURE-006", cycle_id: "env-3", status: "failed", failure_class: "env", root_cause_key: "env:main_dirty" },
        { story_id: "US-REAL-001", cycle_id: "card-1", status: "failed", failure_class: "card", root_cause_key: "card:agent_after_build" },
        { story_id: "US-REAL-001", cycle_id: "card-2", status: "failed", failure_class: "card", root_cause_key: "card:agent_after_build" },
        { story_id: "US-REAL-001", cycle_id: "card-3", status: "failed", failure_class: "card", root_cause_key: "card:agent_after_build" },
      ],
      events: [],
    });
    expect(rebuilt.pardoned).toEqual(["US-CAPTURE-006"]);
    expect(rebuilt.kept).toEqual(["US-REAL-001"]);
    expect(rebuilt.fails).toEqual({ "US-REAL-001": 3 });
    expect(rebuilt.skip).toEqual(["US-REAL-001"]);
  });

  it("replays evidence instead of trusting a stale recorded failure_class", () => {
    const rebuilt = rebuildSkipStateFromEvidence({
      currentFails: { "US-MISLABELED-001": 3 },
      currentSkip: ["US-MISLABELED-001"],
      threshold: 3,
      rows: [
        { story_id: "US-MISLABELED-001", cycle_id: "c1", status: "failed", failure_class: "env", root_cause_key: "env:main_dirty", tcr_count: 1 },
        { story_id: "US-MISLABELED-001", cycle_id: "c2", status: "failed", failure_class: "env", root_cause_key: "env:main_dirty", tokens_in: 10 },
        { story_id: "US-MISLABELED-001", cycle_id: "c3", status: "failed", failure_class: "env", root_cause_key: "env:main_dirty", tcr_count: 2 },
      ],
      events: [],
    });

    expect(rebuilt.pardoned).toEqual([]);
    expect(rebuilt.kept).toEqual(["US-MISLABELED-001"]);
    expect(rebuilt.fails).toEqual({ "US-MISLABELED-001": 3 });
    expect(rebuilt.skip).toEqual(["US-MISLABELED-001"]);
  });

  it("keeps unknown no-evidence gave_up cards by default", () => {
    const rebuilt = rebuildSkipStateFromEvidence({
      currentFails: { "US-UNKNOWN-001": 3 },
      currentSkip: ["US-UNKNOWN-001"],
      threshold: 3,
      rows: [
        { story_id: "US-UNKNOWN-001", cycle_id: "u1", status: "gave_up", failure_class: "unknown", root_cause_key: "unknown:unclassified" },
        { story_id: "US-UNKNOWN-001", cycle_id: "u2", status: "gave_up", failure_class: "unknown", root_cause_key: "unknown:unclassified" },
        { story_id: "US-UNKNOWN-001", cycle_id: "u3", status: "gave_up", failure_class: "unknown", root_cause_key: "unknown:unclassified" },
      ],
      events: [],
    });

    expect(rebuilt.pardoned).toEqual([]);
    expect(rebuilt.kept).toEqual(["US-UNKNOWN-001"]);
    expect(rebuilt.fails).toEqual({ "US-UNKNOWN-001": 3 });
    expect(rebuilt.skip).toEqual(["US-UNKNOWN-001"]);
  });

  it("preserves an existing unknown skip entry even when replay rows are incomplete", () => {
    const rebuilt = rebuildSkipStateFromEvidence({
      currentFails: { "US-UNKNOWN-OLD": 3 },
      currentSkip: ["US-UNKNOWN-OLD"],
      threshold: 3,
      rows: [{ story_id: "US-UNKNOWN-OLD", cycle_id: "u1", status: "gave_up", failure_class: "unknown", root_cause_key: "unknown:unclassified" }],
      events: [],
    });

    expect(rebuilt.pardoned).toEqual([]);
    expect(rebuilt.kept).toEqual(["US-UNKNOWN-OLD"]);
    expect(rebuilt.fails).toEqual({ "US-UNKNOWN-OLD": 3 });
    expect(rebuilt.skip).toEqual(["US-UNKNOWN-OLD"]);
  });

  it("preserves an unknown skip entry even when only the skip list remains", () => {
    const rebuilt = rebuildSkipStateFromEvidence({
      currentFails: {},
      currentSkip: ["US-UNKNOWN-SKIP-ONLY"],
      threshold: 3,
      rows: [{ story_id: "US-UNKNOWN-SKIP-ONLY", cycle_id: "u1", status: "gave_up", failure_class: "unknown", root_cause_key: "unknown:unclassified" }],
      events: [],
    });

    expect(rebuilt.pardoned).toEqual([]);
    expect(rebuilt.kept).toEqual(["US-UNKNOWN-SKIP-ONLY"]);
    expect(rebuilt.fails).toEqual({ "US-UNKNOWN-SKIP-ONLY": 3 });
    expect(rebuilt.skip).toEqual(["US-UNKNOWN-SKIP-ONLY"]);
  });

  it("pardons unknown only when explicitly requested", () => {
    const rebuilt = rebuildSkipStateFromEvidence({
      currentFails: { "US-UNKNOWN-001": 3 },
      currentSkip: ["US-UNKNOWN-001"],
      threshold: 3,
      includeUnknown: true,
      rows: [
        { story_id: "US-UNKNOWN-001", cycle_id: "u1", status: "gave_up", failure_class: "unknown", root_cause_key: "unknown:unclassified" },
        { story_id: "US-UNKNOWN-001", cycle_id: "u2", status: "gave_up", failure_class: "unknown", root_cause_key: "unknown:unclassified" },
        { story_id: "US-UNKNOWN-001", cycle_id: "u3", status: "gave_up", failure_class: "unknown", root_cause_key: "unknown:unclassified" },
      ],
      events: [],
    });

    expect(rebuilt.pardoned).toEqual(["US-UNKNOWN-001"]);
    expect(rebuilt.kept).toEqual([]);
    expect(rebuilt.fails).toEqual({});
    expect(rebuilt.skip).toEqual([]);
  });

  it("documents the include-unknown risk in help", () => {
    expect(LOOP_PARDON_SKIP_LIST_USAGE).toContain("--include-unknown");
    expect(LOOP_PARDON_SKIP_LIST_USAGE).toContain("risky");
    expect(LOOP_PARDON_SKIP_LIST_USAGE).toContain("zero-usage gave_up");
  });
});
