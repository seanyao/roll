/**
 * diff-test: alert-loop pure decisions vs the frozen oracle (bin/roll).
 *
 * Byte-diffable rules transcribed VERBATIM and run against bash / python3:
 *   - the `_notify` gate ladder (bin/roll 10873-10875) vs {@link notifyVerdict}.
 *   - the `_alert_log` row printer (bin/roll 14138-14147, MINUS the ANSI color,
 *     which is injected presentation) vs {@link renderAlertLogRow}.
 *
 * The dedup-append / consume / file-replace side effects touch the filesystem,
 * so they stay behaviour-tested in alert-loop.test.ts. python3 is the same
 * interpreter the oracle invokes for `_alert_log`.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { type AlertLogRecord, notifyVerdict, renderAlertLogRow } from "../src/loop/alert-loop.js";

/** Transcribed `_notify` gate (bin/roll 10873-10875): prints push|<skip-reason>. */
function bashNotify(isDarwin: boolean, muted: boolean, osascript: boolean): string {
  const script = `
    uname_out="$1"; muted="$2"; osa="$3"
    [ "$uname_out" = "Darwin" ] || { echo "not_darwin"; exit 0; }
    [ "$muted" = "1" ] && { echo "muted"; exit 0; }
    [ "$osa" = "1" ] || { echo "no_osascript"; exit 0; }
    echo "push"`;
  return execFileSync(
    "bash",
    ["-c", script, "bash", isDarwin ? "Darwin" : "Linux", muted ? "1" : "0", osascript ? "1" : "0"],
    { encoding: "utf8" },
  ).trim();
}

/**
 * Transcribed `_alert_log` python printer (bin/roll 14138-14147) with the ANSI
 * env vars set to empty (no color) so the output is the plain row our TS
 * renderer produces.
 */
function pyAlertRow(rec: AlertLogRecord): string {
  const py = `
import json, sys, os
G=os.environ.get("ROLL_GREEN",""); Y=os.environ.get("ROLL_YELLOW","")
R=os.environ.get("ROLL_RED",""); NC=os.environ.get("ROLL_NC","")
r=json.loads(sys.argv[1])
ts=r.get("recorded_at") or r.get("ts") or ""
hhmm=ts[11:16] if len(ts)>=16 else ts
notified=str(r.get("notified")) in ("1","True","true")
glyph=(G+"●"+NC) if notified else (Y+"○"+NC)
level=r.get("level","")
lc={"error":R,"warn":Y,"info":""}.get(level,"")
cat=r.get("category","")
msg=r.get("message","")
print(f"  {hhmm}  {glyph} {lc}[{level}]{NC} {cat} — {msg}")`;
  // The oracle prefixes two spaces; our renderer omits the leading indent (CLI
  // presentation). Compare on the trimmed-leading form.
  const out = execFileSync("python3", ["-c", py, JSON.stringify(rec)], { encoding: "utf8" }).replace(/\n$/, "");
  return out.replace(/^ {2}/, ""); // drop the oracle's leading two-space indent
}

describe("diff-test: notifyVerdict == _notify gate (bin/roll 10873-10875)", () => {
  for (const isDarwin of [true, false]) {
    for (const muted of [true, false]) {
      for (const osa of [true, false]) {
        it(`darwin=${isDarwin} muted=${muted} osa=${osa} agrees`, () => {
          const expected = bashNotify(isDarwin, muted, osa);
          const v = notifyVerdict({ isDarwin, muted, osascriptPresent: osa });
          const actual = v.push ? "push" : v.reason;
          expect(actual).toBe(expected);
        });
      }
    }
  }
});

describe("diff-test: renderAlertLogRow == _alert_log python (bin/roll 14138-14147)", () => {
  const recs: AlertLogRecord[] = [
    { recorded_at: "2026-06-05T08:30:00Z", notified: true, level: "error", category: "loop-pr-ci-red", message: "PR #1 red" },
    { recorded_at: "2026-06-05T23:59:00Z", notified: false, level: "warn", category: "x", message: "throttled" },
    { recorded_at: "short", notified: true, level: "info", category: "c", message: "m" },
  ];
  for (const r of recs) {
    it(`${r.message} (notified=${r.notified}) agrees`, () => {
      // ANSI color is injected by the CLI; the oracle's no-color output (env
      // unset) equals our plain row.
      expect(renderAlertLogRow(r)).toBe(pyAlertRow(r));
    });
  }
});
