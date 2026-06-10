/**
 * US-TRUTH-006 AC2 — the live change-point guard: rows built by the REAL
 * production builder must carry only registered fields. Add a field to
 * buildRunRow without registering it in truth-registry.ts and THIS test reds
 * with the how-to pointer — that is the guardrail working, not a flake.
 */
import { describe, expect, it } from "vitest";
import { registrationHint, unregisteredFields } from "@roll/spec";
import { buildRunRow } from "../src/runner/index.js";

describe("US-TRUTH-006 — buildRunRow output is fully registered", () => {
  it("a maximal real row (cost + cache + merge-window fields) has no unregistered keys", () => {
    const row = buildRunRow(
      { kind: "append_run", status: "published", outcome: "delivered", cycleId: "C-1" },
      {
        cycleId: "C-1",
        branch: "loop/cycle-C-1",
        loop: "ci" as never,
        storyId: "US-G-001",
        agent: "pi",
        startSec: 1_781_000_000,
        tcrCount: 3,
        prUrl: "https://github.com/o/r/pull/1",
        cost: {
          cycleId: "C-1",
          agent: "pi",
          model: "deepseek-v4-pro",
          tokensIn: 10,
          tokensOut: 5,
          cacheRead: 100,
          cacheWrite: 20,
          estimatedCost: 0.01,
          revertCount: 0,
          effectiveCost: 0.01,
        },
      },
      1_781_000_600,
    );
    // the bus upsert adds the dedupe keys the registry also covers
    const keys = [...Object.keys(row), "story_id", "cycle_id"];
    const missing = unregisteredFields("runs", keys);
    expect(missing, registrationHint("runs", missing)).toEqual([]);
  });
});
