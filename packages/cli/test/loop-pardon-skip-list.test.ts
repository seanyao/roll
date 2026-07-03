import { describe, expect, it } from "vitest";
import { rebuildSkipStateFromEvidence } from "../src/commands/loop-pardon-skip-list.js";

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
});
