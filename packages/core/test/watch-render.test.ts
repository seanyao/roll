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

  it("renders failure class on failed cycle:end", () => {
    const rendered = watchRenderEventFromRollEvent({
      type: "cycle:end",
      cycleId: "C-env",
      outcome: "failed",
      cost: {} as never,
      failure_class: "env",
      root_cause_key: "env:main_dirty",
      ts: 1,
    });
    expect(rendered?.detail).toBe("failed · env · env:main_dirty");
    expect(rendered?.severity).toBe("bad");
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

  // ── FIX-934: pair:* event rendering ─────────────────────────────────────

  it("renders pair:selected with workingAgent → peer (stage)", () => {
    const ev = watchRenderEventFromRollEvent({
      type: "pair:selected",
      cycleId: "c1",
      workingAgent: "codex",
      peer: "kimi",
      stage: "code",
      ts: 100,
    });
    expect(ev).not.toBeNull();
    expect(ev!.summary).toBe("pair:selected");
    expect(ev!.detail).toBe("codex → kimi (code)");
    expect(ev!.kind).toBe("gate");
    expect(ev!.severity).toBe("normal");
    const rendered = renderCompactWatchEvent(ev!);
    expect(rendered).toContain("pair:selected");
    expect(rendered).toContain("codex → kimi (code)");
  });

  it("renders pair:verdict with peer + verdict + findings count", () => {
    const ev = watchRenderEventFromRollEvent({
      type: "pair:verdict",
      cycleId: "c1",
      peer: "kimi",
      verdict: "refine",
      findings: 3,
      cost: 0.15,
      stage: "code",
      ts: 200,
    });
    expect(ev).not.toBeNull();
    expect(ev!.summary).toBe("pair:verdict");
    expect(ev!.detail).toBe("kimi · refine · 3 findings · code");
    expect(ev!.kind).toBe("gate");
    expect(ev!.severity).toBe("normal");
    const rendered = renderCompactWatchEvent(ev!);
    expect(rendered).toContain("pair:verdict");
    expect(rendered).toContain("kimi · refine · 3 findings");
  });

  it("renders pair:verdict agree as good severity", () => {
    const ev = watchRenderEventFromRollEvent({
      type: "pair:verdict",
      cycleId: "c1",
      peer: "claude",
      verdict: "agree",
      findings: 0,
      cost: 0.1,
      ts: 201,
    });
    expect(ev!.severity).toBe("good");
    expect(ev!.detail).toContain("0 findings");
  });

  it("renders pair:verdict object as warn severity", () => {
    const ev = watchRenderEventFromRollEvent({
      type: "pair:verdict",
      cycleId: "c1",
      peer: "claude",
      verdict: "object",
      findings: 5,
      cost: 0.2,
      ts: 202,
    });
    expect(ev!.severity).toBe("warn");
    expect(ev!.detail).toContain("5 findings");
  });

  it("renders pair:score with peer + score + verdict", () => {
    const ev = watchRenderEventFromRollEvent({
      type: "pair:score",
      cycleId: "c1",
      peer: "kimi",
      score: 8,
      verdict: "good",
      cost: 0.05,
      stage: "score",
      ts: 300,
    });
    expect(ev).not.toBeNull();
    expect(ev!.summary).toBe("pair:score");
    expect(ev!.detail).toBe("kimi · 8 · good");
    expect(ev!.kind).toBe("gate");
    expect(ev!.severity).toBe("good");
    const rendered = renderCompactWatchEvent(ev!);
    expect(rendered).toContain("pair:score");
    expect(rendered).toContain("kimi · 8 · good");
  });

  it("renders pair:score regression as bad severity", () => {
    const ev = watchRenderEventFromRollEvent({
      type: "pair:score",
      cycleId: "c1",
      peer: "claude",
      score: 3,
      verdict: "regression",
      cost: 0.03,
      stage: "score",
      ts: 301,
    });
    expect(ev!.severity).toBe("bad");
    expect(ev!.detail).toBe("claude · 3 · regression");
  });

  it("renders pair:consult with peer + outcome + durationMs", () => {
    const ev = watchRenderEventFromRollEvent({
      type: "pair:consult",
      cycleId: "c1",
      peer: "kimi",
      durationMs: 45200,
      outcome: "reviewed",
      ts: 400,
    });
    expect(ev).not.toBeNull();
    expect(ev!.summary).toBe("pair:consult");
    expect(ev!.detail).toBe("kimi · reviewed · 45.2s");
    expect(ev!.kind).toBe("raw");
    expect(ev!.severity).toBe("good");
    const rendered = renderCompactWatchEvent(ev!);
    expect(rendered).toContain("pair:consult");
    expect(rendered).toContain("kimi · reviewed · 45.2s");
  });

  it("renders pair:consult timeout with cause tag", () => {
    const ev = watchRenderEventFromRollEvent({
      type: "pair:consult",
      cycleId: "c1",
      peer: "claude",
      durationMs: 120000,
      outcome: "timeout",
      cause: "auth",
      ts: 401,
    });
    expect(ev!.detail).toBe("claude · timeout · 120.0s (auth)");
    expect(ev!.severity).toBe("warn");
  });

  it("renders pair:consult error as bad severity", () => {
    const ev = watchRenderEventFromRollEvent({
      type: "pair:consult",
      cycleId: "c1",
      peer: "pi",
      durationMs: 500,
      outcome: "error",
      cause: "network",
      ts: 402,
    });
    expect(ev!.severity).toBe("bad");
    expect(ev!.detail).toContain("error");
    expect(ev!.detail).toContain("0.5s");
    expect(ev!.detail).toContain("(network)");
  });

  it("renders pair:none-available with stage + reason", () => {
    const ev = watchRenderEventFromRollEvent({
      type: "pair:none-available",
      cycleId: "c1",
      stage: "code",
      reason: "no qualified heterogeneous peer",
      ts: 500,
    });
    expect(ev).not.toBeNull();
    expect(ev!.summary).toBe("pair:none-available");
    expect(ev!.detail).toBe("code · no qualified heterogeneous peer");
    expect(ev!.kind).toBe("gate");
    expect(ev!.severity).toBe("warn");
    const rendered = renderCompactWatchEvent(ev!);
    expect(rendered).toContain("pair:none-available");
    expect(rendered).toContain("no qualified heterogeneous peer");
  });

  it("renders pair:score-failure with peer + cause", () => {
    const ev = watchRenderEventFromRollEvent({
      type: "pair:score-failure",
      cycleId: "c1",
      peer: "kimi",
      cause: "timeout",
      stage: "score",
      ts: 600,
    });
    expect(ev).not.toBeNull();
    expect(ev!.summary).toBe("pair:score-failure");
    expect(ev!.detail).toBe("kimi · timeout");
    expect(ev!.kind).toBe("gate");
    expect(ev!.severity).toBe("bad");
    const rendered = renderCompactWatchEvent(ev!);
    expect(rendered).toContain("pair:score-failure");
    expect(rendered).toContain("kimi · timeout");
  });

  it("renders pair:excluded with agent + cause + failures", () => {
    const ev = watchRenderEventFromRollEvent({
      type: "pair:excluded",
      cycleId: "c1",
      agent: "claude",
      cause: "auth",
      failures: 3,
      ts: 700,
    });
    expect(ev).not.toBeNull();
    expect(ev!.summary).toBe("pair:excluded");
    expect(ev!.detail).toBe("claude · auth · 3 failures");
    expect(ev!.kind).toBe("gate");
    expect(ev!.severity).toBe("warn");
    const rendered = renderCompactWatchEvent(ev!);
    expect(rendered).toContain("pair:excluded");
    expect(rendered).toContain("claude · auth · 3 failures");
  });

  it("renders pair:excluded singular failure count", () => {
    const ev = watchRenderEventFromRollEvent({
      type: "pair:excluded",
      cycleId: "c1",
      agent: "pi",
      cause: "auth",
      failures: 1,
      ts: 701,
    });
    expect(ev!.detail).toBe("pi · auth · 1 failure");
  });

  it("renders US-LOOP-089 sandbox write protection and quarantine events", () => {
    const protectedEv = watchRenderEventFromRollEvent({
      type: "sandbox:write_protected",
      cycleId: "c1",
      status: "applied",
      repoCwd: "/repo",
      markerPath: "/repo/.roll/loop/main-checkout-protection.json",
      paths: 12,
      ts: 800,
    });
    expect(protectedEv).toMatchObject({
      kind: "gate",
      summary: "sandbox:write_protected",
      detail: "applied · 12 paths",
      severity: "normal",
    });
    const quarantineEv = watchRenderEventFromRollEvent({
      type: "sandbox:quarantined",
      cycleId: "c1",
      storyId: "US-LOOP-089",
      phase: "pre-spawn",
      reason: "dirty",
      ref: "rescue/leaked-1",
      files: ["tracked.ts"],
      manifestPath: "/repo/.roll/loop/quarantine/leaked-1.json",
      restoreCommand: "git stash apply rescue/leaked-1",
      ts: 801,
    });
    expect(quarantineEv).toMatchObject({
      kind: "gate",
      summary: "sandbox:quarantined",
      detail: "pre-spawn · dirty · rescue/leaked-1 · 1 item",
      severity: "warn",
    });
    expect(renderCompactWatchEvent(quarantineEv!)).toContain("sandbox:quarantined");
  });

  it("renders all pair:* events in compact output", () => {
    const lines = [
      line({ type: "pair:selected", cycleId: "c1", workingAgent: "codex", peer: "kimi", stage: "code", ts: 100 }),
      line({ type: "pair:consult", cycleId: "c1", peer: "kimi", durationMs: 45200, outcome: "reviewed", ts: 400 }),
      line({ type: "pair:verdict", cycleId: "c1", peer: "kimi", verdict: "refine", findings: 3, cost: 0.15, stage: "code", ts: 200 }),
      line({ type: "pair:score", cycleId: "c1", peer: "kimi", score: 8, verdict: "good", cost: 0.05, stage: "score", ts: 300 }),
      line({ type: "pair:none-available", cycleId: "c2", stage: "code", reason: "no peer", ts: 500 }),
      line({ type: "pair:score-failure", cycleId: "c2", peer: "claude", cause: "auth-block", stage: "score", ts: 600 }),
      line({ type: "pair:excluded", cycleId: "c2", agent: "claude", cause: "auth", failures: 2, ts: 700 }),
    ];
    const rendered = scrubTime(renderCompactWatchLines(lines));
    expect(rendered).toMatchInlineSnapshot(`
      [
        "HH:MM:SS  pair:selected          codex → kimi (code)",
        "HH:MM:SS  pair:consult           kimi · reviewed · 45.2s",
        "HH:MM:SS  pair:verdict           kimi · refine · 3 findings · code",
        "HH:MM:SS  pair:score             kimi · 8 · good",
        "HH:MM:SS  pair:none-available    code · no peer",
        "HH:MM:SS  pair:score-failure     claude · auth-block",
        "HH:MM:SS  pair:excluded          claude · auth · 2 failures",
      ]
    `);
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
