import { describe, expect, it } from "vitest";
import type { RollEvent } from "@roll/spec";
import {
  renderCompactWatchEvent,
  renderCompactWatchLines,
  watchRenderEventFromLine,
  watchRenderEventFromRollEvent,
  type WatchRenderEvent,
} from "../src/loop/watch-render.js";

/** Scrub the volatile HH:MM:SS timestamp prefix (8 chars) from watch render output
 *  so snapshots are TZ-portable (difftest paradigm). */
function scrubTime(out: string[]): string[] {
  return out.map((line) => line.replace(/^\d{2}:\d{2}:\d{2}/, "HH:MM:SS"));
}

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
    expect(scrubTime(renderCompactWatchLines(events.map(line)))).toMatchInlineSnapshot(`
      [
        "HH:MM:SS  cycle:start            20260619-044 · US-LOOP-044 · codex",
        "HH:MM:SS  phase                  execute",
        "HH:MM:SS  heartbeat              building · still working (1) · 3m quiet · 2 tcr so far",
        "HH:MM:SS  tcr                    abcdef123 · tcr: add renderer",
        "HH:MM:SS  visual:gate            ok · terminal",
        "HH:MM:SS  evidence:frame-opened  /tmp/run",
        "HH:MM:SS  pr:open                #850 · US-LOOP-044",
        "HH:MM:SS  pr:merge               #850 · US-LOOP-044",
        "HH:MM:SS  pr:rebase              #850",
        "HH:MM:SS  pr:close               #850 · superseded",
        "HH:MM:SS  ci:pass                #850",
        "HH:MM:SS  ci:fail                #850 · lint failed",
        "HH:MM:SS  ci:rerun               #850",
        "HH:MM:SS  peer:gate              consulted",
        "HH:MM:SS  attest:gate            produced",
        "HH:MM:SS  alert:notify           loop · stuck",
      ]
    `);
  });

  it("never crashes on malformed or unknown rows", () => {
    const out = renderCompactWatchLines([
      "{not-json",
      line({ type: "future:event", ts: 16, payload: "x" }),
      line({ type: "future:no-ts" }),
    ]);
    expect(scrubTime(out)).toMatchInlineSnapshot(`
      [
        "HH:MM:SS  malformed              {not-json",
        "HH:MM:SS  future:event",
        "HH:MM:SS  malformed              {"type":"future:no-ts"}",
      ]
    `);
  });

  it("strips terminal control sequences from compact status/events rendering", () => {
    const rendered = renderCompactWatchLines([
      line({ type: "cycle:tcr", cycleId: "c", commitHash: "abc123456", message: "\u001b[31mtcr: red\u001b[0m\u001b[A", ts: 1 }),
    ]);
    expect(scrubTime(rendered)).toEqual(["HH:MM:SS  tcr                    abc123456 · tcr: red"]);
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
    expect(renderCompactWatchEvent(ev!)).toMatch(/^\d{2}:\d{2}:\d{2}\s+visual:gate\s+flagged · missing$/);
  });

  // ── FIX-385: timezone & unsupported event rendering ──────────────────────

  it("renders timestamps in device-local time, not UTC (AC1)", () => {
    const ev = watchRenderEventFromRollEvent({ type: "cycle:start", cycleId: "c", storyId: "s", agent: "a", model: "m", ts: 0 });
    const rendered = renderCompactWatchEvent(ev!);
    const localHour = new Date(0).getHours();
    const utcHour = new Date(0).getUTCHours();
    // The rendered hour (first two chars) must equal local hour, not UTC
    const match = rendered.match(/^(\d{2}):/);
    expect(match).not.toBeNull();
    const renderedHour = parseInt(match![1], 10);
    expect(renderedHour).toBe(localHour);
    if (localHour !== utcHour) {
      expect(renderedHour).not.toBe(utcHour);
    }
  });

  it("renders cycle:terminal meaningfully, not 'unsupported event' (AC3)", () => {
    const ev = watchRenderEventFromRollEvent({
      type: "cycle:terminal",
      schema: 1 as const,
      cycleId: "cy-1",
      storyId: "US-X",
      agent: "codex",
      model: "gpt-5",
      startedAt: 1000,
      endedAt: 5000,
      outcome: "delivered",
      pr: { present: false, reason: "no_publish_attempted" },
      branch: { present: false, reason: "not_applicable" },
      commit: { present: false, reason: "no_commits" },
      tcr: { present: false, reason: "no_commits" },
      attest: { present: false, reason: "not_rendered" },
      usage: { present: false, reason: "no_parseable_usage" },
      cost: { present: false, reason: "no_parseable_usage" },
      ts: 100,
    });
    expect(ev).not.toBeNull();
    expect(ev!.kind).toBe("cycle");
    expect(ev!.summary).toBe("cycle:terminal");
    expect(ev!.detail).toContain("delivered");
    expect(ev!.detail).toContain("codex");
    expect(ev!.severity).toBe("good");
    const rendered = renderCompactWatchEvent(ev!);
    expect(rendered).not.toContain("unsupported event");
    expect(rendered).toContain("cycle:terminal");
    expect(rendered).toContain("delivered");
  });

  it("renders report:morning meaningfully, not 'unsupported event' (AC3)", () => {
    const ev = watchRenderEventFromRollEvent({
      type: "report:morning",
      path: "/tmp/report.html",
      windowStart: 1000,
      windowEnd: 5000,
      cycles: 3,
      corrections: 0,
      paused: false,
      ts: 200,
    });
    expect(ev).not.toBeNull();
    expect(ev!.summary).toBe("report:morning");
    expect(ev!.detail).toContain("/tmp/report.html");
    const rendered = renderCompactWatchEvent(ev!);
    expect(rendered).not.toContain("unsupported event");
    expect(rendered).toContain("report:morning");
    expect(rendered).toContain("/tmp/report.html");
  });

  it("TZ-sticky: renders timestamps by device TZ, never hardcoded UTC or +8 (AC2)", () => {
    // Pick a ts where local != UTC in any non-UTC TZ
    const ts = 0; // epoch
    const localHour = new Date(ts).getHours();
    const utcHour = new Date(ts).getUTCHours();
    const ev = watchRenderEventFromRollEvent({ type: "cycle:start", cycleId: "c", storyId: "s", agent: "a", model: "m", ts });
    const rendered = renderCompactWatchEvent(ev!);
    const match = rendered.match(/^(\d{2}):/);
    expect(match).not.toBeNull();
    const renderedHour = parseInt(match![1], 10);
    // Must equal device-local hour, not UTC (proves getHours not getUTCHours)
    expect(renderedHour).toBe(localHour);
    // Document the expectation: if local != UTC, rendered must differ from UTC
    if (localHour !== utcHour) {
      expect(renderedHour).not.toBe(utcHour);
    }
  });

  it("unknown event types show clean degradation (no 'unsupported event') (AC3)", () => {
    const ev = watchRenderEventFromRollEvent({ type: "future:event" } as unknown as RollEvent);
    expect(ev).not.toBeNull();
    expect(ev!.detail).toBe("");
    const rendered = renderCompactWatchEvent(ev!);
    expect(rendered).not.toContain("unsupported event");
    expect(rendered).toContain("future:event");
  });
});
