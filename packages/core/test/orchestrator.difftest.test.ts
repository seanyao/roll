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
  // Hook 1 (productivity floor): the first row (wt=true, exit=0, commits=0) was
  // v2's commit-count-only `idle`; it is now `gave_up` because `agentExecuted` is
  // absent here and DEFAULTS to executed (capture only follows an agent spawn) —
  // an agent that ran and produced nothing is a failed-class give-up, not a
  // silent idle. A genuine no-op (agentExecuted:false) still classifies idle.
  const FROZEN: V2CycleStatus[] = [
    "gave_up", "built", "built", "blocked", "blocked", "blocked",
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
  // FIX-351: the publish ladder is only reached from a `built` (gates-passed)
  // capture, so a publish that can't complete and pushed NO orphan branch is now
  // `local` (unpublished) — a neutral terminal, NOT `failed`. The bash oracle
  // (retired) returned `failed` for these cells; the frozen verdicts below update
  // the publish-fail-without-orphan cells from `failed` → `local`. Cells that
  // pushed an orphan branch stay `orphan`; status-0 stays `published`; status-2
  // with a ff merge-back stays `done`.
  const FROZEN: V2CycleStatus[] = [
    "published", "published", "published", "published",
    "local", "orphan", "local", "orphan",
    "local", "orphan", "done", "done",
    "local", "orphan", "local", "orphan",
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
