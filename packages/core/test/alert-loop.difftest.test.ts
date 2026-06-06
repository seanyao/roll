/**
 * Frozen-expectation test: alert-loop pure decisions.
 *
 * Two rules were proven byte-equal to the bash / python3 oracle (bin/roll) under
 * diff-test. Per US-PORT-009b the oracle is retired: the `bash`/`python3` spawns
 * are dropped and each row asserts against the frozen value captured while the
 * oracle agreed.
 *
 *   - the `_notify` gate ladder (bin/roll 10873-10875) vs {@link notifyVerdict}.
 *   - the `_alert_log` row printer (bin/roll 14138-14147, MINUS the ANSI color,
 *     which is injected presentation) vs {@link renderAlertLogRow}.
 *
 * The dedup-append / consume / file-replace side effects touch the filesystem,
 * so they stay behaviour-tested in alert-loop.test.ts.
 */
import { describe, expect, it } from "vitest";
import { type AlertLogRecord, notifyVerdict, renderAlertLogRow } from "../src/loop/alert-loop.js";

describe("frozen: notifyVerdict == _notify gate (bin/roll 10873-10875)", () => {
  // (isDarwin × muted × osascript) in nested-loop order → frozen push|<reason>.
  const FROZEN = ["muted", "muted", "push", "no_osascript", "not_darwin", "not_darwin", "not_darwin", "not_darwin"];
  let i = 0;
  for (const isDarwin of [true, false]) {
    for (const muted of [true, false]) {
      for (const osa of [true, false]) {
        const expected = FROZEN[i++];
        it(`darwin=${isDarwin} muted=${muted} osa=${osa} → ${expected}`, () => {
          const v = notifyVerdict({ isDarwin, muted, osascriptPresent: osa });
          expect(v.push ? "push" : v.reason).toBe(expected);
        });
      }
    }
  }
});

describe("frozen: renderAlertLogRow == _alert_log python (bin/roll 14138-14147)", () => {
  const CASES: Array<{ rec: AlertLogRecord; expected: string }> = [
    {
      rec: { recorded_at: "2026-06-05T08:30:00Z", notified: true, level: "error", category: "loop-pr-ci-red", message: "PR #1 red" },
      expected: "08:30  ● [error] loop-pr-ci-red — PR #1 red",
    },
    {
      rec: { recorded_at: "2026-06-05T23:59:00Z", notified: false, level: "warn", category: "x", message: "throttled" },
      expected: "23:59  ○ [warn] x — throttled",
    },
    {
      rec: { recorded_at: "short", notified: true, level: "info", category: "c", message: "m" },
      expected: "short  ● [info] c — m",
    },
  ];
  for (const { rec, expected } of CASES) {
    it(`${rec.message} (notified=${rec.notified})`, () => {
      // ANSI color is injected by the CLI; the no-color row equals this literal.
      expect(renderAlertLogRow(rec)).toBe(expected);
    });
  }
});
