import { describe, expect, it } from "vitest";
import type { RollEvent } from "@roll/spec";
import {
  renderCompactWatchEvent,
  renderCompactWatchLines,
  watchRenderEventFromLine,
  watchRenderEventFromRollEvent,
  type WatchRenderEvent,
} from "../src/loop/watch-render.js";

function line(ev: RollEvent | Record<string, unknown>): string {
  return JSON.stringify(ev);
}

describe("watch-render — compact RollEvent observation model", () => {
  const events: RollEvent[] = [
    { type: "cycle:start", cycleId: "20260619-044", storyId: "US-LOOP-044", agent: "codex", model: "gpt-5", ts: 0 },
    { type: "cycle:phase", cycleId: "20260619-044", phase: "execute", ts: 1 },
    { type: "cycle:stdout", cycleId: "20260619-044", data: "heartbeat: building · still working (1) · 3m quiet · 2 tcr so far", ts: 2 },
    { type: "cycle:tcr", cycleId: "20260619-044", commitHash: "abcdef123456", message: "tcr: add renderer", ts: 3, commitTs: 1 },
    { type: "visual:gate", cycleId: "20260619-044", storyId: "US-LOOP-044", verdict: "ok", surface: "terminal", reasons: [], ts: 4 },
    { type: "evidence:frame-opened", cycleId: "20260619-044", storyId: "US-LOOP-044", runDir: "/tmp/run", ts: 5 },
    { type: "pr:open", prNumber: 850, storyId: "US-LOOP-044", ts: 6 },
    { type: "pr:merge", prNumber: 850, storyId: "US-LOOP-044", ts: 7 },
    { type: "pr:rebase", prNumber: 850, ts: 8 },
    { type: "pr:close", prNumber: 850, reason: "superseded", ts: 9 },
    { type: "ci:pass", prNumber: 850, ts: 10 },
    { type: "ci:fail", prNumber: 850, failSummary: "lint failed", ts: 11 },
    { type: "ci:rerun", prNumber: 850, ts: 12 },
    { type: "peer:gate", cycleId: "20260619-044", verdict: "consulted", reasons: [], ts: 13 },
    { type: "attest:gate", cycleId: "20260619-044", verdict: "produced", reasons: [], ts: 14 },
    { type: "alert:notify", channel: "loop", message: "stuck", ts: 15 },
  ];

  it("maps supported events to the shared WatchRenderEvent shape", () => {
    const mapped = events.map((ev) => watchRenderEventFromRollEvent(ev));
    expect(mapped.every((ev): ev is WatchRenderEvent => ev !== null)).toBe(true);
    expect(mapped.map((ev) => [ev.kind, ev.summary, ev.severity])).toMatchInlineSnapshot(`
      [
        [
          "cycle",
          "cycle:start",
          "normal",
        ],
        [
          "phase",
          "phase",
          "normal",
        ],
        [
          "heartbeat",
          "heartbeat",
          "muted",
        ],
        [
          "tcr",
          "tcr",
          "good",
        ],
        [
          "gate",
          "visual:gate",
          "good",
        ],
        [
          "evidence",
          "evidence:frame-opened",
          "normal",
        ],
        [
          "pr",
          "pr:open",
          "normal",
        ],
        [
          "pr",
          "pr:merge",
          "good",
        ],
        [
          "pr",
          "pr:rebase",
          "warn",
        ],
        [
          "pr",
          "pr:close",
          "warn",
        ],
        [
          "gate",
          "ci:pass",
          "good",
        ],
        [
          "gate",
          "ci:fail",
          "bad",
        ],
        [
          "gate",
          "ci:rerun",
          "warn",
        ],
        [
          "gate",
          "peer:gate",
          "good",
        ],
        [
          "gate",
          "attest:gate",
          "good",
        ],
        [
          "alert",
          "alert:notify",
          "bad",
        ],
      ]
    `);
  });

  it("renders stable compact one-line output", () => {
    expect(renderCompactWatchLines(events.map(line))).toMatchInlineSnapshot(`
      [
        "00:00:00  cycle:start            20260619-044 · US-LOOP-044 · codex",
        "00:00:01  phase                  execute",
        "00:00:02  heartbeat              building · still working (1) · 3m quiet · 2 tcr so far",
        "00:00:03  tcr                    abcdef123 · tcr: add renderer",
        "00:00:04  visual:gate            ok · terminal",
        "00:00:05  evidence:frame-opened  /tmp/run",
        "00:00:06  pr:open                #850 · US-LOOP-044",
        "00:00:07  pr:merge               #850 · US-LOOP-044",
        "00:00:08  pr:rebase              #850",
        "00:00:09  pr:close               #850 · superseded",
        "00:00:10  ci:pass                #850",
        "00:00:11  ci:fail                #850 · lint failed",
        "00:00:12  ci:rerun               #850",
        "00:00:13  peer:gate              consulted",
        "00:00:14  attest:gate            produced",
        "00:00:15  alert:notify           loop · stuck",
      ]
    `);
  });

  it("never crashes on malformed or unknown rows", () => {
    const out = renderCompactWatchLines([
      "{not-json",
      line({ type: "future:event", ts: 16, payload: "x" }),
      line({ type: "future:no-ts" }),
    ]);
    expect(out).toMatchInlineSnapshot(`
      [
        "00:00:00  malformed              {not-json",
        "00:00:16  future:event           unsupported event",
        "00:00:00  malformed              {"type":"future:no-ts"}",
      ]
    `);
  });

  it("strips terminal control sequences from compact status/events rendering", () => {
    const rendered = renderCompactWatchLines([
      line({ type: "cycle:tcr", cycleId: "c", commitHash: "abc123456", message: "\u001b[31mtcr: red\u001b[0m\u001b[A", ts: 1 }),
    ]);
    expect(rendered).toEqual(["00:00:01  tcr                    abc123456 · tcr: red"]);
  });

  it("raw-events mode preserves source lines unchanged", () => {
    const raw = line({ type: "cycle:tcr", cycleId: "c", commitHash: "abc123456", message: "\u001b[31mtcr: red\u001b[0m", ts: 1 });
    expect(renderCompactWatchLines([raw], "raw-events")).toEqual([raw]);
  });

  it("status mode skips unsupported and malformed rows", () => {
    expect(watchRenderEventFromLine("{nope", "status")).toBeNull();
    expect(watchRenderEventFromLine(line({ type: "future:event", ts: 1 }), "status")).toBeNull();
  });

  it("compact renderer can be used directly for visual terminal evidence", () => {
    const ev = watchRenderEventFromRollEvent({ type: "visual:gate", cycleId: "c", storyId: "US-X", verdict: "flagged", code: "missing", reasons: [], ts: 4 });
    expect(ev).not.toBeNull();
    expect(renderCompactWatchEvent(ev!)).toBe("00:00:04  visual:gate            flagged · missing");
  });
});
