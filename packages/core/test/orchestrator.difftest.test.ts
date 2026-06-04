/**
 * diff-test: CycleOrchestrator six-state classification vs the frozen bash oracle.
 *
 * The full inner runner (bin/roll:8391-9380) is too entangled with worktree/event
 * side effects to byte-diff end-to-end (documented in orchestrator.ts header —
 * phase-map line ranges, no silent gaps). What IS extractable as a pure decision:
 *
 *   1. the PRE-publish status capture (bin/roll:9127-9157): the `if`-cascade that
 *      maps (usedWorktree, agentExit, timedOut, commitsAhead) → idle/built/failed.
 *      We lift the EXACT conditions into a tiny bash function and diff every
 *      combination against {@link classifyCaptured}.
 *   2. the publish ladder (bin/roll:9239-9356): the top-level `_publish_status`
 *      branch (0 / 2 / other) crossed with merged_back / orphan_pushed →
 *      done/orphan/failed. Lifted into bash, diffed against {@link classifyPublish}.
 *
 * These are the v2 conditions verbatim (operators preserved), so a regression in
 * either TS function diverges from the bash on at least one row.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { classifyCaptured, classifyPublish, type V2CycleStatus } from "../src/index.js";

function bash(script: string): string {
  return execFileSync("bash", ["-c", script], { encoding: "utf8" }).trim();
}

// ── 1. pre-publish capture (bin/roll:9127-9157) ──────────────────────────────

/**
 * Bash reimplementation of the capture cascade, conditions lifted verbatim:
 *   _CYCLE_TIMED_OUT=1                    → blocked  (bin/roll:9120-class)
 *   _USE_WORKTREE != 1                    → failed   (bin/roll:9000)
 *   _exit != 0                            → failed   (bin/roll:9132-9133)
 *   _cycle_commits == 0                   → idle     (bin/roll:9180)
 *   else (commits > 0)                    → built    (bin/roll:9141-9142)
 * Args: used_wt exit timed_out commits.
 */
const CAPTURE_BASH = `
_classify_captured() {
  local _used_wt="$1" _exit="$2" _timed="$3" _commits="$4"
  if [ "$_timed" -eq 1 ]; then echo blocked; return; fi
  if [ "$_used_wt" != "1" ]; then echo failed; return; fi
  if [ "$_exit" -ne 0 ]; then echo failed; return; fi
  if [ "$_commits" -eq 0 ]; then echo idle; return; fi
  echo built
}
`;

describe("diff-test: capture cascade == classifyCaptured (bin/roll:9127-9157)", () => {
  const rows: Array<{ usedWorktree: boolean; agentExit: number; timedOut: boolean; commitsAhead: number }> = [];
  for (const used of [true, false]) {
    for (const exit of [0, 1, 130]) {
      for (const timed of [false, true]) {
        for (const commits of [0, 1, 5]) {
          rows.push({ usedWorktree: used, agentExit: exit, timedOut: timed, commitsAhead: commits });
        }
      }
    }
  }

  it("agrees on every (usedWorktree, exit, timedOut, commits) combination", () => {
    for (const r of rows) {
      const ts = classifyCaptured(r);
      const sh = bash(
        `${CAPTURE_BASH}\n_classify_captured ${r.usedWorktree ? 1 : 0} ${r.agentExit} ${r.timedOut ? 1 : 0} ${r.commitsAhead}`,
      ) as V2CycleStatus;
      expect(sh, JSON.stringify(r)).toBe(ts);
    }
  });
});

// ── 2. publish ladder (bin/roll:9239-9356) ───────────────────────────────────

/**
 * Bash reimplementation of the publish-status ladder, branches lifted verbatim:
 *   status 0                              → done    (bin/roll:9239)
 *   status 2 + merged_back                → done    (bin/roll:9275)
 *   status 2 + orphan_pushed              → orphan  (bin/roll:9293/9308)
 *   status 2 + neither                    → failed  (bin/roll:9298/9313)
 *   status other + orphan_pushed          → orphan  (bin/roll:9331/9346)
 *   status other + not pushed             → failed  (bin/roll:9336/9351)
 * Args: status merged_back orphan_pushed (booleans as 0/1).
 */
const PUBLISH_BASH = `
_classify_publish() {
  local _status="$1" _merged_back="$2" _orphan_pushed="$3"
  if [ "$_status" -eq 0 ]; then echo done; return; fi
  if [ "$_status" -eq 2 ]; then
    if [ "$_merged_back" -eq 1 ]; then echo done; return; fi
    if [ "$_orphan_pushed" -eq 1 ]; then echo orphan; return; fi
    echo failed; return
  fi
  if [ "$_orphan_pushed" -eq 1 ]; then echo orphan; return; fi
  echo failed
}
`;

describe("diff-test: publish ladder == classifyPublish (bin/roll:9239-9356)", () => {
  const statuses = [0, 1, 2, 127];
  const bools = [false, true];

  it("agrees on every (status, mergedBack, orphanPushed) combination", () => {
    for (const status of statuses) {
      for (const mergedBack of bools) {
        for (const orphanPushed of bools) {
          const ts = classifyPublish({ status, mergedBack, orphanPushed });
          const sh = bash(
            `${PUBLISH_BASH}\n_classify_publish ${status} ${mergedBack ? 1 : 0} ${orphanPushed ? 1 : 0}`,
          ) as V2CycleStatus;
          expect(sh, JSON.stringify({ status, mergedBack, orphanPushed })).toBe(ts);
        }
      }
    }
  });
});
