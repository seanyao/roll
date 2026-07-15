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

  it("first low review score → return_story with retry budget", () => {
    const decision = decideCorrectionAction({
      storyId: "FIX-386",
      cycleId: "cycle-1",
      reasons: ["low review-score ok 4/10 marks partial + Discrepancy"],
      mode: "auto",
      events: [],
    });

    expect(decision).toMatchObject({
      action: "return_story",
      plannedAction: "return_story",
      signal: "review_score_regression",
      source: "review-score",
      retryBudget: 1, // one retry remaining after this first low score
    });
  });

  it("second low review score (one prior correction) → still return_story with zero retry budget", () => {
    const events: RollEvent[] = [
      {
        type: "correction:action",
        cycleId: "cycle-1",
        storyId: "FIX-386",
        action: "return_story",
        signal: "review_score_regression",
        reason: "first low score",
        ts: 10,
      },
    ];
    const decision = decideCorrectionAction({
      storyId: "FIX-386",
      cycleId: "cycle-2",
      reasons: ["low review-score ok 4/10 marks partial + Discrepancy"],
      mode: "auto",
      events,
    });

    // FIX-386: with 1 prior correction (≤ MAX_REVIEW_SCORE_RETRIES=1), still return_story
    // giving one more fix-forward cycle before escalating.
    expect(decision).toMatchObject({
      action: "return_story",
      plannedAction: "return_story",
      signal: "review_score_regression",
      retryBudget: 0, // last retry — no more after this
    });
  });

  it("third low review score (retry budget exhausted) → route_adjust escalation", () => {
    const events: RollEvent[] = [
      {
        type: "correction:action",
        cycleId: "cycle-1",
        storyId: "FIX-386",
        action: "return_story",
        signal: "review_score_regression",
        reason: "first low score",
        ts: 10,
      },
      {
        type: "correction:action",
        cycleId: "cycle-2",
        storyId: "FIX-386",
        action: "return_story",
        signal: "review_score_regression",
        reason: "second low score",
        ts: 11,
      },
    ];
    const decision = decideCorrectionAction({
      storyId: "FIX-386",
      cycleId: "cycle-3",
      reasons: ["low review-score ok 4/10 marks partial + Discrepancy"],
      mode: "auto",
      events,
    });

    // FIX-386: with 2 prior corrections (> MAX_REVIEW_SCORE_RETRIES=1), escalate.
    // The story will be marked Hold by the CLI correction actuator.
    expect(decision).toMatchObject({
      action: "route_adjust",
      plannedAction: "route_adjust",
      signal: "review_score_regression",
      retryBudget: 0,
    });
  });

  it("regression review score (one prior) → return_story with retry budget", () => {
    const events: RollEvent[] = [
      {
        type: "correction:action",
        cycleId: "cycle-1",
        storyId: "FIX-386",
        action: "return_story",
        signal: "review_score_regression",
        reason: "regression 3/10",
        ts: 10,
      },
    ];
    const decision = decideCorrectionAction({
      storyId: "FIX-386",
      cycleId: "cycle-2",
      reasons: ["review-score regression 3/10 blocks Done"],
      mode: "auto",
      events,
    });

    expect(decision).toMatchObject({
      action: "return_story",
      signal: "review_score_regression",
      source: "review-score",
      retryBudget: 0,
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

  // FIX-1261: deterministic failure envelope — new signal patterns.
  it("classifies deliverable_cmd denial as card:deliverable_cmd_denied", () => {
    const decision = decideCorrectionAction({
      storyId: "US-BROW-010",
      cycleId: "cycle-dc",
      reasons: ["deliverable_cmd 非白名单(仅限 roll 只读子命令): npm test, npx vitest — refused (no arbitrary command execution; no state-changing roll subcommand)"],
      mode: "auto",
      events: [],
    });
    expect(decision).toMatchObject({
      signal: "card:deliverable_cmd_denied",
      source: "attest:gate",
      action: "open_fix",
    });
  });

  it("classifies surface capture missing as card:surface_not_captured", () => {
    const decision = decideCorrectionAction({
      storyId: "US-BROW-010",
      cycleId: "cycle-sc",
      reasons: ["declared surface capture missing: declared deliverable_cmd(s) not all really captured (need 2 taken terminal shots)"],
      mode: "auto",
      events: [],
    });
    expect(decision).toMatchObject({
      signal: "card:surface_not_captured",
      source: "attest:gate",
      action: "open_fix",
    });
  });

  it("classifies attest render failure as card:ac_evidence_unmergeable", () => {
    const decision = decideCorrectionAction({
      storyId: "US-BROW-010",
      cycleId: "cycle-ar",
      reasons: ["attest render failed for US-BROW-010 (exit 1)"],
      mode: "auto",
      events: [],
    });
    expect(decision).toMatchObject({
      signal: "card:ac_evidence_unmergeable",
      source: "attest:gate",
      action: "open_fix",
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
