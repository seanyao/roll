/**
 * Frozen-expectation test: CycleOrchestrator six-state classification.
 *
 * Two pure decisions were proven byte-equal to the bash oracle (conditions
 * lifted verbatim from bin/roll) under diff-test across exhaustive matrices. Per
 * US-PORT-009b the oracle is retired: the `bash` spawns are dropped and each
 * matrix row asserts against the frozen verdict captured while the oracle agreed.
 *
 *   1. the PRE-publish status capture cascade (bin/roll:9127-9157) vs
 *      {@link classifyCaptured}.
 *   2. the publish ladder (bin/roll:9239-9356) vs {@link classifyPublish}.
 *
 * The full inner runner is too entangled with worktree/event side effects to
 * byte-diff end-to-end (documented in orchestrator.ts header).
 */
import { describe, expect, it } from "vitest";
import { classifyCaptured, classifyPublish, type V2CycleStatus } from "../src/index.js";

describe("frozen: capture cascade == classifyCaptured (bin/roll:9127-9157)", () => {
  // (usedWorktree × agentExit × timedOut × commitsAhead) in nested-loop order.
  const FROZEN: V2CycleStatus[] = [
    "idle", "built", "built", "blocked", "blocked", "blocked",
    "failed", "failed", "failed", "blocked", "blocked", "blocked",
    "failed", "failed", "failed", "blocked", "blocked", "blocked",
    "failed", "failed", "failed", "blocked", "blocked", "blocked",
    "failed", "failed", "failed", "blocked", "blocked", "blocked",
    "failed", "failed", "failed", "blocked", "blocked", "blocked",
  ];
  let i = 0;
  for (const usedWorktree of [true, false]) {
    for (const agentExit of [0, 1, 130]) {
      for (const timedOut of [false, true]) {
        for (const commitsAhead of [0, 1, 5]) {
          const expected = FROZEN[i++];
          it(`wt=${usedWorktree} exit=${agentExit} timed=${timedOut} commits=${commitsAhead} → ${expected}`, () => {
            expect(classifyCaptured({ usedWorktree, agentExit, timedOut, commitsAhead })).toBe(expected);
          });
        }
      }
    }
  }
});

describe("frozen: publish ladder == classifyPublish (bin/roll:9239-9356)", () => {
  // (status × mergedBack × orphanPushed) in nested-loop order.
  const FROZEN: V2CycleStatus[] = [
    "published", "published", "published", "published",
    "failed", "orphan", "failed", "orphan",
    "failed", "orphan", "done", "done",
    "failed", "orphan", "failed", "orphan",
  ];
  let i = 0;
  for (const status of [0, 1, 2, 127]) {
    for (const mergedBack of [false, true]) {
      for (const orphanPushed of [false, true]) {
        const expected = FROZEN[i++];
        it(`status=${status} mergedBack=${mergedBack} orphanPushed=${orphanPushed} → ${expected}`, () => {
          expect(classifyPublish({ status, mergedBack, orphanPushed })).toBe(expected);
        });
      }
    }
  }
});
