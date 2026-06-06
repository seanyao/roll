/**
 * diff-test (frozen): lock + heartbeat DECISION RULES vs the v2 bash oracle.
 *
 * The oracle rules are inline guards inside the generated runner template
 * (escaped `\$` heredocs), not standalone functions — they were transcribed
 * verbatim from these bin/roll line ranges and diff-tested:
 *   - outer lock held-guard      8323-8336 (`_write_pr_loop_runner_script`):
 *       `[ -n "$pp" ] && [ -n "$pt" ] && kill -0 "$pp" && [ $((now-pt)) -lt 900 ]`
 *   - inner lock held-guard      8411-8425 (FIX-031): identical shape, 14400s.
 *   - heartbeat liveness         9448-9451 (orphan-heal):
 *       `hb_age=$((now-hb_ts)); [ "$hb_age" -lt "$timeout" ]` (default 1800)
 *
 * Per the US-PORT-009a freeze paradigm (docs/difftest-freeze-paradigm.md): the
 * verdicts are pure integer comparisons (`-lt`) plus `kill -0` pid liveness — all
 * deterministic. The bash side was proven equal once and is now FROZEN as the
 * expected literal per case; the test spawns NO bash. A live pid (our own) and a
 * genuinely-dead pid exercise the `kill -0` branch without a shell.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { heartbeatAge, isLockHeld, livenessVerdict, parseLock } from "../src/index.js";

/** A pid that has already exited — `kill -0` fails for it. */
function deadPid(): number {
  return spawnSync(process.execPath, ["-e", "process.exit(0)"]).pid ?? 999999999;
}

describe("diff-test: isLockHeld == frozen bash inline lock guard (8326/8418)", () => {
  const live = process.pid; // our own pid — guaranteed alive
  const dead = deadPid();
  // [label, pid, ts, now, threshold, frozen-verdict]
  const cases: Array<[string, number, number, number, number, boolean]> = [
    ["live + fresh (900)", live, 100, 200, 900, true],
    ["live + at-threshold (900)", live, 0, 900, 900, false],
    ["live + just-under (900)", live, 1, 900, 900, true],
    ["live + fresh (14400)", live, 100, 200, 14400, true],
    ["live + aged-over (14400)", live, 0, 20000, 14400, false],
    ["dead + fresh", dead, 100, 110, 900, false],
    ["dead + aged", dead, 0, 99999, 14400, false],
  ];
  for (const [label, pid, ts, now, thr, expected] of cases) {
    it(label, () => {
      expect(isLockHeld({ pid, ts }, now, thr)).toBe(expected);
    });
  }

  it("unparseable lock contents → not held (bash empty -n guard)", () => {
    expect(isLockHeld(parseLock("garbage"), 0, 900)).toBe(false);
  });
});

describe("diff-test: heartbeat verdict == frozen bash inline liveness (9448-9451)", () => {
  // [label, hbContent, now, timeout, frozen {alive, age}]
  const cases: Array<[string, string, number, number, boolean, number]> = [
    ["fresh", "1000", 1500, 1800, true, 500],
    ["at-threshold", "0", 1800, 1800, false, 1800],
    ["just-under", "1", 1800, 1800, true, 1799],
    ["over", "0", 5000, 1800, false, 5000],
    ["garbage content → ts 0", "nope", 100, 1800, true, 100],
    ["empty content → ts 0", "", 50, 1800, true, 50],
  ];
  for (const [label, hb, now, to, alive, age] of cases) {
    it(label, () => {
      const dir = mkdtempSync(join(tmpdir(), "roll-hb-dt-"));
      try {
        const f = join(dir, ".hb");
        writeFileSync(f, hb, "utf8");
        expect(heartbeatAge(f, () => now)).toBe(age);
        expect(livenessVerdict(f, { now: () => now, timeoutSec: to }).alive).toBe(alive);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
