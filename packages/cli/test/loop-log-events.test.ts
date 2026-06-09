/**
 * US-PORT-022 — `roll loop log` + `roll loop events` TS ports.
 * Pure-read viewers over .roll/cycle-logs and the shared events ndjson.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loopLogCommand } from "../src/commands/loop-log.js";
import { loopEventsCommand } from "../src/commands/loop-events.js";
import { stripAnsi } from "../src/render.js";

const dirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string): void {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  process.env[k] = v;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function capture(fn: () => number): { status: number; out: string; err: string } {
  const o: string[] = [];
  const e: string[] = [];
  const wo = process.stdout.write.bind(process.stdout);
  const we = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((x: string | Uint8Array) => (o.push(String(x)), true)) as typeof process.stdout.write;
  process.stderr.write = ((x: string | Uint8Array) => (e.push(String(x)), true)) as typeof process.stderr.write;
  try {
    const status = fn();
    return { status, out: stripAnsi(o.join("")), err: stripAnsi(e.join("")) };
  } finally {
    process.stdout.write = wo;
    process.stderr.write = we;
  }
}

describe("loop log — US-PORT-022", () => {
  function projectWithLogs(logs: Record<string, string>): string {
    const p = tmp("roll-looplog-");
    const dir = join(p, ".roll", "cycle-logs");
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(logs)) writeFileSync(join(dir, name), body);
    setEnv("ROLL_MAIN_PROJECT", p);
    return p;
  }

  it("no cycle-logs dir → friendly message, exit 0", () => {
    const p = tmp("roll-looplog-empty-");
    setEnv("ROLL_MAIN_PROJECT", p);
    const r = capture(() => loopLogCommand([]));
    expect(r.status).toBe(0);
    expect(r.out).toContain("roll");
  });

  it("no arg → shows the latest cycle with a header + the cron.log stderr steer", () => {
    projectWithLogs({
      "20260608-010000-111.log": "old cycle body\n",
      "20260609-024500-222.log": "newest cycle body\n",
    });
    const r = capture(() => loopLogCommand([]));
    expect(r.status).toBe(0);
    expect(r.out).toContain("# cycle 20260609-024500-222 · 2026-06-09 02:45");
    expect(r.out).toContain("newest cycle body");
    expect(r.out).not.toContain("old cycle body");
    expect(r.err).toContain("cron.log is a legacy aggregate");
    expect(r.err).toContain("旧的聚合日志");
  });

  it("exact cycle-id match", () => {
    projectWithLogs({ "20260609-024500-222.log": "exact body\n", "20260608-010000-111.log": "x\n" });
    const r = capture(() => loopLogCommand(["20260609-024500-222"]));
    expect(r.status).toBe(0);
    expect(r.out).toContain("exact body");
  });

  it("unique prefix match", () => {
    projectWithLogs({ "20260609-024500-222.log": "prefix body\n" });
    const r = capture(() => loopLogCommand(["20260609"]));
    expect(r.status).toBe(0);
    expect(r.out).toContain("prefix body");
  });

  it("ambiguous prefix → lists the matching cycle ids, exit 1", () => {
    projectWithLogs({ "20260609-024500-222.log": "a\n", "20260609-030000-333.log": "b\n" });
    const r = capture(() => loopLogCommand(["20260609"]));
    expect(r.status).toBe(1);
    expect(r.out).toContain("20260609-024500-222");
    expect(r.out).toContain("20260609-030000-333");
  });

  it("no match → message, exit 1", () => {
    projectWithLogs({ "20260609-024500-222.log": "a\n" });
    const r = capture(() => loopLogCommand(["nope"]));
    expect(r.status).toBe(1);
  });
});

describe("loop events — US-PORT-022", () => {
  function sharedWithEvents(slug: string, lines: object[]): void {
    const shared = tmp("roll-loopev-");
    mkdirSync(join(shared, "loop"), { recursive: true });
    if (lines.length > 0) {
      writeFileSync(join(shared, "loop", `events-${slug}.ndjson`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    }
    setEnv("ROLL_SHARED_ROOT", shared);
    setEnv("ROLL_MAIN_SLUG", slug);
  }

  it("missing event log → [monitor] message, exit 1", () => {
    setEnv("ROLL_SHARED_ROOT", tmp("roll-loopev-none-"));
    setEnv("ROLL_MAIN_SLUG", "demo-abc123");
    const r = capture(() => loopEventsCommand([]));
    expect(r.status).toBe(1);
    expect(r.out).toContain("[monitor] No event log found for project: demo-abc123");
  });

  it("tails N events, aligned columns", () => {
    sharedWithEvents("demo-abc123", [
      { ts: "2026-06-09T02:00:00Z", stage: "pick", label: "US-X-1", detail: "chose", outcome: "ok" },
      { ts: "2026-06-09T02:05:00Z", stage: "publish", label: "US-X-1", detail: "merged", outcome: "done" },
    ]);
    const r = capture(() => loopEventsCommand(["1"]));
    expect(r.status).toBe(0);
    // last 1 only
    expect(r.out).toContain("publish");
    expect(r.out).not.toContain("pick");
    // stage padded to 12, label to 20
    expect(r.out).toContain("publish".padEnd(12));
    expect(r.out).toContain("US-X-1".padEnd(20));
  });
});
