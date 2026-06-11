import { describe, expect, it } from "vitest";
import { GOAL_ALLOWED_CARDS_ENV, filterByAllowedCards, parseAllowedCardsEnv, runAttemptFromRow } from "../src/lib/goal-progress.js";

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
});
