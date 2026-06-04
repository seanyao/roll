/**
 * Unit tests for the Alert-loop pure decision layer (alert-loop.ts).
 * Covers: file-name derivation, dedup-aware append, worktree alert line,
 * consume actions (list/ack/resolve/log/unknown), log-count parse, alert-log
 * record render + tail parse, notify gate ladder, tick shape + rotation caps.
 */
import { describe, expect, it } from "vitest";
import {
  ALERT_LOG_RELATIVE_PATH,
  ALERT_TICK_MAX_LINES,
  DEFAULT_TICK_MAX_LINES,
  alertAppendDecision,
  alertConsumeAction,
  alertFileName,
  alertTick,
  notifyVerdict,
  parseAlertLogTail,
  parseLogCount,
  renderAlertLogRow,
  worktreeAlertLine,
} from "../src/loop/alert-loop.js";

describe("alertFileName / paths (bin/roll 8808 / 12247)", () => {
  it("file name is ALERT-<slug>.md", () => {
    expect(alertFileName("seanyao-roll")).toBe("ALERT-seanyao-roll.md");
  });
  it("history path", () => {
    expect(ALERT_LOG_RELATIVE_PATH).toBe(".roll/state/alert-log.jsonl");
  });
});

describe("alertAppendDecision — dedup gate (US-LOOP-062a, bin/roll 11455)", () => {
  it("key absent → append", () => {
    expect(alertAppendDecision("", "[TYPE:loop-pr-ci-red] PR #1 ", "line")).toEqual({
      kind: "append",
      line: "line",
    });
  });
  it("key present → skip duplicate", () => {
    const contents = "[2026] [error] [TYPE:loop-pr-ci-red] PR #1 head: msg\n";
    expect(alertAppendDecision(contents, "[TYPE:loop-pr-ci-red] PR #1 ", "line")).toEqual({
      kind: "skip",
      reason: "duplicate",
    });
  });
  it("different PR key not deduped", () => {
    const contents = "[TYPE:loop-pr-ci-red] PR #1 \n";
    expect(alertAppendDecision(contents, "[TYPE:loop-pr-ci-red] PR #2 ", "line").kind).toBe("append");
  });
});

describe("worktreeAlertLine (bin/roll 12748)", () => {
  it("formats timestamped worktree line", () => {
    expect(worktreeAlertLine("2026-06-05T00:00:00Z", "preserved at /wt")).toBe(
      "[2026-06-05T00:00:00Z] worktree: preserved at /wt",
    );
  });
});

describe("alertConsumeAction — cmd_alert (bin/roll 14060-14104)", () => {
  const ts = "2026-06-05 00:00:00";
  it("list present → show", () => {
    expect(alertConsumeAction("list", true, "BODY", ts)).toEqual({ kind: "show", contents: "BODY" });
  });
  it("list absent → show_none", () => {
    expect(alertConsumeAction("list", false, "", ts)).toEqual({ kind: "show_none" });
  });
  it("'' behaves as list", () => {
    expect(alertConsumeAction("", true, "B", ts)).toEqual({ kind: "show", contents: "B" });
  });
  it("ack present → append footer", () => {
    expect(alertConsumeAction("ack", true, "", ts)).toEqual({
      kind: "ack_append",
      footer: `\n**Acknowledged**: ${ts}`,
    });
  });
  it("ack absent → ack_none", () => {
    expect(alertConsumeAction("ack", false, "", ts)).toEqual({ kind: "ack_none" });
  });
  it("resolve present → remove", () => {
    expect(alertConsumeAction("resolve", true, "", ts)).toEqual({ kind: "remove" });
  });
  it("clear is an alias for resolve", () => {
    expect(alertConsumeAction("clear", true, "", ts)).toEqual({ kind: "remove" });
  });
  it("resolve absent → show_none", () => {
    expect(alertConsumeAction("resolve", false, "", ts)).toEqual({ kind: "show_none" });
  });
  it("log → log N", () => {
    expect(alertConsumeAction("log", false, "", ts, "5")).toEqual({ kind: "log", n: 5 });
    expect(alertConsumeAction("log", false, "", ts)).toEqual({ kind: "log", n: 10 });
  });
  it("unknown subcommand", () => {
    expect(alertConsumeAction("bogus", true, "", ts)).toEqual({ kind: "unknown", subcommand: "bogus" });
  });
});

describe("parseLogCount (bin/roll 14113-14114)", () => {
  it("numeric", () => {
    expect(parseLogCount("25")).toBe(25);
  });
  it("non-numeric / absent → 10", () => {
    expect(parseLogCount("abc")).toBe(10);
    expect(parseLogCount(undefined)).toBe(10);
  });
});

describe("renderAlertLogRow (bin/roll 14138-14147)", () => {
  it("● glyph when notified", () => {
    expect(
      renderAlertLogRow({
        recorded_at: "2026-06-05T08:30:00Z",
        notified: true,
        level: "error",
        category: "loop-pr-ci-red",
        message: "PR #1 red",
      }),
    ).toBe("08:30  ● [error] loop-pr-ci-red — PR #1 red");
  });
  it("○ glyph when throttled/deduped", () => {
    expect(
      renderAlertLogRow({
        recorded_at: "2026-06-05T08:30:00Z",
        notified: false,
        level: "warn",
        category: "x",
        message: "m",
      }),
    ).toBe("08:30  ○ [warn] x — m");
  });
  it("short ts falls back to whole string", () => {
    const row = renderAlertLogRow({ recorded_at: "x", notified: true, level: "info", category: "c", message: "m" });
    expect(row).toBe("x  ● [info] c — m");
  });
});

describe("parseAlertLogTail (bin/roll 14131-14138)", () => {
  const body = [
    '{"recorded_at":"2026-06-05T00:00:01Z","notified":true,"level":"error","category":"a","message":"m1"}',
    "",
    '{"ts":"2026-06-05T00:00:02Z","notified":false,"level":"warn","category":"b","message":"m2"}',
    "not json",
    '{"recorded_at":"2026-06-05T00:00:03Z","notified":"true","level":"info","category":"c","message":"m3"}',
  ].join("\n");
  it("drops blanks + unparseable, keeps order then reverses (newest-first)", () => {
    const rows = parseAlertLogTail(body, 10);
    expect(rows.map((r) => r.message)).toEqual(["m3", "m2", "m1"]);
  });
  it("ts fallback when recorded_at absent", () => {
    const rows = parseAlertLogTail(body, 10);
    expect(rows.find((r) => r.message === "m2")?.recorded_at).toBe("2026-06-05T00:00:02Z");
  });
  it("notified accepts boolean true and string 'true'", () => {
    const rows = parseAlertLogTail(body, 10);
    expect(rows.find((r) => r.message === "m1")?.notified).toBe(true);
    expect(rows.find((r) => r.message === "m3")?.notified).toBe(true);
    expect(rows.find((r) => r.message === "m2")?.notified).toBe(false);
  });
  it("tail of N", () => {
    const rows = parseAlertLogTail(body, 1);
    expect(rows.map((r) => r.message)).toEqual(["m3"]);
  });
});

describe("notifyVerdict — _notify gate (bin/roll 10873-10875)", () => {
  it("non-Darwin → skip not_darwin (first gate)", () => {
    expect(notifyVerdict({ isDarwin: false, muted: false, osascriptPresent: true })).toEqual({
      push: false,
      reason: "not_darwin",
    });
  });
  it("muted → skip muted", () => {
    expect(notifyVerdict({ isDarwin: true, muted: true, osascriptPresent: true })).toEqual({
      push: false,
      reason: "muted",
    });
  });
  it("no osascript → skip no_osascript", () => {
    expect(notifyVerdict({ isDarwin: true, muted: false, osascriptPresent: false })).toEqual({
      push: false,
      reason: "no_osascript",
    });
  });
  it("all clear → push", () => {
    expect(notifyVerdict({ isDarwin: true, muted: false, osascriptPresent: true })).toEqual({ push: true });
  });
});

describe("alertTick + rotation caps (bin/roll 8027-8028)", () => {
  it("tick shape", () => {
    expect(alertTick("acted", "consumed")).toEqual({ loop: "alert", outcome: "acted", note: "consumed" });
  });
  it("alert loop rotates at 1000 lines; default 500", () => {
    expect(ALERT_TICK_MAX_LINES).toBe(1000);
    expect(DEFAULT_TICK_MAX_LINES).toBe(500);
  });
});
