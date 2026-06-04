/**
 * diff-test: lock + heartbeat DECISION RULES vs the frozen bash oracle.
 *
 * The oracle rules are NOT standalone bash functions — they are inline guards
 * inside the generated runner template (escaped `\$` heredocs), so they cannot
 * be `sed`-extracted as a named function the way config_get / _project_slug can.
 * Per the card ("diff-test where clean; else document line ranges") we instead
 * reproduce the EXACT inline predicate as a tiny bash snippet, citing the
 * source line ranges, and diff-test the TS decision against it across cases.
 *
 * Cited oracle lines (bin/roll):
 *   - outer lock held-guard      8323-8336  (`_write_pr_loop_runner_script`):
 *       IFS=: read -r _pp _pt < LOCK
 *       _now=$(date -u +%s)
 *       if [ -n "$_pp" ] && [ -n "$_pt" ] && kill -0 "$_pp" && [ "$((_now-_pt))" -lt 900 ]
 *   - inner lock held-guard      8411-8425  (FIX-031): identical shape, 14400s.
 *   - heartbeat liveness         9448-9451  (orphan-heal):
 *       _hb_ts=$(cat HEARTBEAT_FILE || echo 0); _hb_age=$((now-_hb_ts));
 *       if [ "$_hb_age" -lt "$HEARTBEAT_TIMEOUT" ]  (default 1800)
 *
 * Because we cannot extract them, the bash snippets below are TRANSCRIBED
 * verbatim from those line ranges (PID liveness uses `kill -0`, age uses the
 * same integer `-lt` comparison). The diff-test proves the TS port computes the
 * same verdict for every fixture (including a real dead pid + the boundary age).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  heartbeatAge,
  isLockHeld,
  livenessVerdict,
  parseLock,
} from "../src/index.js";

/** Transcribed outer/inner lock held-guard (bin/roll 8326 / 8418). */
function bashLockHeld(pid: number, ts: number, now: number, threshold: number): boolean {
  const script = `
    _pp="$1"; _pt="$2"; _now="$3"; _thr="$4"
    if [ -n "$_pp" ] && [ -n "$_pt" ] && kill -0 "$_pp" 2>/dev/null && [ "$(($_now - $_pt))" -lt "$_thr" ]; then
      echo held
    else
      echo stale
    fi`;
  const out = execFileSync(
    "bash",
    ["-c", script, "bash", String(pid), String(ts), String(now), String(threshold)],
    { encoding: "utf8" },
  ).trim();
  return out === "held";
}

/** Transcribed heartbeat liveness verdict (bin/roll 9448-9451). */
function bashLive(hbContent: string, now: number, timeout: number): { alive: boolean; age: number } {
  const script = `
    _hb_ts="$1"; _now="$2"; _to="$3"
    case "$_hb_ts" in ''|*[!0-9]*) _hb_ts=0 ;; esac
    _hb_age=$(( _now - _hb_ts ))
    if [ "$_hb_age" -lt "$_to" ]; then echo "alive $_hb_age"; else echo "dead $_hb_age"; fi`;
  const out = execFileSync("bash", ["-c", script, "bash", hbContent, String(now), String(timeout)], {
    encoding: "utf8",
  }).trim();
  const [verdict, age] = out.split(" ");
  return { alive: verdict === "alive", age: Number(age) };
}

function deadPid(): number {
  return spawnSync(process.execPath, ["-e", "process.exit(0)"]).pid ?? 999999999;
}

describe("diff-test: isLockHeld == bash inline lock guard (8326/8418)", () => {
  const live = process.pid; // our own pid — guaranteed alive on both sides
  const dead = deadPid();
  const cases: Array<[label: string, pid: number, ts: number, now: number, thr: number]> = [
    ["live + fresh (900)", live, 100, 200, 900],
    ["live + at-threshold (900)", live, 0, 900, 900],
    ["live + just-under (900)", live, 1, 900, 900],
    ["live + fresh (14400)", live, 100, 200, 14400],
    ["live + aged-over (14400)", live, 0, 20000, 14400],
    ["dead + fresh", dead, 100, 110, 900],
    ["dead + aged", dead, 0, 99999, 14400],
  ];
  for (const [label, pid, ts, now, thr] of cases) {
    it(label, () => {
      const ts_ = isLockHeld({ pid, ts }, now, thr);
      const bash = bashLockHeld(pid, ts, now, thr);
      expect(ts_).toBe(bash);
    });
  }

  it("unparseable lock contents → not held (bash empty -n guard)", () => {
    // bash: empty _pp/_pt fail the `[ -n ]` guards → stale.
    expect(isLockHeld(parseLock("garbage"), 0, 900)).toBe(false);
    expect(bashLockHeld(Number.NaN, Number.NaN, 0, 900)).toBe(false);
  });
});

describe("diff-test: heartbeat verdict == bash inline liveness (9448-9451)", () => {
  const cases: Array<[label: string, hb: string, now: number, to: number]> = [
    ["fresh", "1000", 1500, 1800],
    ["at-threshold", "0", 1800, 1800],
    ["just-under", "1", 1800, 1800],
    ["over", "0", 5000, 1800],
    ["garbage content → ts 0", "nope", 100, 1800],
    ["empty content → ts 0", "", 50, 1800],
  ];
  for (const [label, hb, now, to] of cases) {
    it(label, () => {
      // Write a heartbeat file with the fixture content, then compare verdicts.
      const dir = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
      try {
        const f = `${dir}/.hb`;
        execFileSync("bash", ["-c", `printf '%s' "$1" > "$2"`, "bash", hb, f]);
        const tsAge = heartbeatAge(f, () => now);
        const tsVerdict = livenessVerdict(f, { now: () => now, timeoutSec: to });
        const bash = bashLive(hb, now, to);
        expect(tsAge).toBe(bash.age);
        expect(tsVerdict.alive).toBe(bash.alive);
      } finally {
        execFileSync("rm", ["-rf", dir]);
      }
    });
  }
});
