import { describe, expect, it } from "vitest";
import { parseBacklog, pickStory } from "@roll/core";
import {
  GOAL_ALLOWED_CARDS_ENV,
  GOAL_GUIDED_ENV,
  filterByAllowedCards,
  isGuidedRunOnce,
  parseAllowedCardsEnv,
  runAttemptFromRow,
  scopeBacklogForAllowedCards,
} from "../src/lib/goal-progress.js";

describe("goal progress helpers", () => {
  it("parses an explicitly empty allowed-card env as no eligible cards", () => {
    expect(parseAllowedCardsEnv({ [GOAL_ALLOWED_CARDS_ENV]: "" })).toEqual(new Set());
    expect(parseAllowedCardsEnv({})).toBeUndefined();
  });

  it("filters backlog rows only when the goal allowed-card env is present", () => {
    const rows = [{ id: "US-A" }, { id: "US-B" }];
    expect(filterByAllowedCards(rows, undefined)).toEqual(rows);
    expect(filterByAllowedCards(rows, new Set(["US-B"]))).toEqual([{ id: "US-B" }]);
    expect(filterByAllowedCards(rows, new Set())).toEqual([]);
  });

  it("scopes pickable cards without erasing Done dependency rows", () => {
    const rows = parseBacklog(
      [
        "| ID | Description | Status |",
        "|---|---|---|",
        "| [FIX-1032a](x) | delivery gate | ✅ Done (PR#1079 · merged 00df763) |",
        "| [FIX-OTHER](x) | unrelated ready fix | 📋 Todo |",
        "| [FIX-1032b](x) | display truth depends-on:FIX-1032a chain_depth:1 | 📋 Todo |",
        "",
      ].join("\n"),
    );

    expect(pickStory(filterByAllowedCards(rows, new Set(["FIX-1032b"])))).toBeUndefined();
    expect(pickStory(scopeBacklogForAllowedCards(rows, new Set(["FIX-1032b"])))?.id).toBe("FIX-1032b");
  });

  it("detects zero-delivery attempts only when tcr_count is known and no delivery evidence exists", () => {
    expect(runAttemptFromRow({ story_id: "US-A", cycle_id: "c1", tcr_count: 0, status: "failed" })).toMatchObject({
      storyId: "US-A",
      cycleId: "c1",
      zeroDelivery: true,
      known: true,
    });
    expect(runAttemptFromRow({ story_id: "US-A", tcr_count: 0, built: ["US-A"] })).toMatchObject({
      zeroDelivery: false,
      known: true,
    });
    expect(runAttemptFromRow({ story_id: "US-A", status: "failed" })).toMatchObject({
      zeroDelivery: false,
      known: false,
    });
  });

  // The spin-hole inputs: rows the per-card progress loop CANNOT attribute. A row
  // with no tcr_count and no delivery evidence is `known:false`; a row with no
  // story_id is `undefined`. Both are SKIPPED by the per-card streak loop in
  // updateProgressFromRows — so the GLOBAL dead-loop breaker must count them by
  // row presence alone (rows.length), or a cycle that keeps appending them spins
  // forever. This locks in the shapes the airtight breaker has to cover.
  it("returns an unattributable attempt for rows the per-card path cannot use", () => {
    // No tcr_count + no evidence (but has a story_id) → known:false → skipped.
    expect(runAttemptFromRow({ story_id: "US-SPIN", cycle_id: "c1", status: "failed" })).toMatchObject({
      storyId: "US-SPIN",
      known: false,
    });
    // No story_id at all → undefined → the per-card loop has nothing to key on.
    expect(runAttemptFromRow({ cycle_id: "c1", status: "failed" })).toBeUndefined();
  });

  describe("FIX-1472 — guided one-shot detection (fail closed)", () => {
    it("is guided only when the guided env is set AND a non-empty scope was handed down", () => {
      expect(isGuidedRunOnce(new Set(["FIX-007"]), { [GOAL_GUIDED_ENV]: "1" })).toBe(true);
    });

    it("is NOT guided without the explicit guided env flag (autonomous tick keeps honoring pause)", () => {
      expect(isGuidedRunOnce(new Set(["FIX-007"]), {})).toBe(false);
      expect(isGuidedRunOnce(new Set(["FIX-007"]), { [GOAL_GUIDED_ENV]: "0" })).toBe(false);
    });

    it("fails closed on a missing/empty scope even when the guided env is set", () => {
      expect(isGuidedRunOnce(undefined, { [GOAL_GUIDED_ENV]: "1" })).toBe(false);
      expect(isGuidedRunOnce(new Set(), { [GOAL_GUIDED_ENV]: "1" })).toBe(false);
    });
  });
});
