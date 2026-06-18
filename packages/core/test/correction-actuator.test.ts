import { describe, expect, it } from "vitest";
import { decideCorrectionAction, parsePolicy } from "../src/index.js";
import type { RollEvent } from "@roll/spec";

describe("US-EVID-014 correction actuator decisions", () => {
  it("defaults to conservative mode: missing acceptance evidence only alerts", () => {
    const decision = decideCorrectionAction({
      storyId: "US-EVID-014",
      cycleId: "cycle-1",
      reasons: ["no fresh acceptance report for US-EVID-014 (checked card archive + legacy verification paths)"],
      mode: parsePolicy("").loopSafety.correctionActuator,
      events: [],
    });

    expect(decision).toMatchObject({
      mode: "conservative",
      action: "alert_only",
      plannedAction: "open_fix",
      signal: "missing_acceptance_report",
      source: "attest:gate",
    });
  });

  it("auto mode opens a FIX for missing/empty acceptance evidence", () => {
    const decision = decideCorrectionAction({
      storyId: "US-EVID-014",
      cycleId: "cycle-1",
      reasons: ["acceptance report at .roll/features/<epic>/US-EVID-014/latest/US-EVID-014-report.html is an empty shell (no AC content / no ac-map)"],
      mode: "auto",
      events: [],
    });

    expect(decision).toMatchObject({
      mode: "auto",
      action: "open_fix",
      plannedAction: "open_fix",
      signal: "empty_acceptance_report",
      source: "acceptance-report",
    });
    expect(decision.attribution.evidence).toContain("events.ndjson");
    expect(decision.attribution.evidence).toContain("ac-map.json");
  });

  it("auto mode returns regression review-score stories to Todo/Hold", () => {
    const decision = decideCorrectionAction({
      storyId: "US-EVID-014",
      cycleId: "cycle-1",
      reasons: ["review-score regression 3/10 blocks Done"],
      mode: "auto",
      events: [],
    });

    expect(decision).toMatchObject({
      action: "return_story",
      signal: "review_score_regression",
      source: "review-score",
    });
  });

  it("FIX-332: repeated empty-shell signal returns the story to Todo instead of duplicating autofix work", () => {
    const events: RollEvent[] = [
      {
        type: "correction:action",
        cycleId: "cycle-old",
        storyId: "US-EVID-014",
        action: "open_fix",
        signal: "empty_acceptance_report",
        reason: "first empty shell",
        ts: 10,
      },
    ];
    const decision = decideCorrectionAction({
      storyId: "US-EVID-014",
      cycleId: "cycle-2",
      reasons: ["acceptance report at .roll/features/<epic>/US-EVID-014/latest/US-EVID-014-report.html is an empty shell (no AC content / no ac-map)"],
      mode: "auto",
      events,
    });
    expect(decision).toMatchObject({
      action: "return_story",
      plannedAction: "return_story",
      signal: "empty_acceptance_report",
    });
  });

  it("repeated same-story signals route-adjust instead of duplicating work", () => {
    const events: RollEvent[] = [
      {
        type: "correction:action",
        cycleId: "cycle-old",
        storyId: "US-EVID-014",
        action: "open_fix",
        signal: "missing_acceptance_report",
        reason: "first correction",
        ts: 10,
      },
    ];
    const decision = decideCorrectionAction({
      storyId: "US-EVID-014",
      cycleId: "cycle-2",
      reasons: ["no fresh acceptance report for US-EVID-014"],
      mode: "auto",
      events,
    });

    expect(decision).toMatchObject({
      action: "route_adjust",
      plannedAction: "route_adjust",
      signal: "missing_acceptance_report",
    });
  });
});
