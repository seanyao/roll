/**
 * FIX-1060 — attribution recovery helper tests.
 */
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readCycleAttributionFromEvents } from "../src/lib/cycle-attribution.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) {
    try {
      import("node:child_process").then(({ execFileSync }) => execFileSync("rm", ["-rf", d]));
    } catch {
      /* best effort */
    }
  }
});

function tmpEvents(lines: string[]): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "roll-attr-")));
  dirs.push(d);
  const p = join(d, "events.ndjson");
  writeFileSync(p, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8");
  return p;
}

describe("readCycleAttributionFromEvents", () => {
  it("returns empty when the events file is missing", () => {
    expect(readCycleAttributionFromEvents("/nonexistent/events.ndjson", "c1")).toEqual({});
  });

  it("picks story/agent from cycle:start", () => {
    const p = tmpEvents([
      JSON.stringify({ type: "cycle:start", cycleId: "c1", storyId: "US-1", agent: "claude", model: "", ts: 1 }),
    ]);
    expect(readCycleAttributionFromEvents(p, "c1")).toEqual({ storyId: "US-1", agent: "claude" });
  });

  it("falls back to evidence:frame-opened for storyId when no cycle:start exists", () => {
    const p = tmpEvents([
      JSON.stringify({ type: "evidence:frame-opened", cycleId: "c1", storyId: "FIX-2", runDir: "/tmp", ts: 1 }),
    ]);
    expect(readCycleAttributionFromEvents(p, "c1")).toEqual({ storyId: "FIX-2" });
  });

  it("ignores events for other cycles", () => {
    const p = tmpEvents([
      JSON.stringify({ type: "cycle:start", cycleId: "c2", storyId: "US-2", agent: "pi", ts: 1 }),
      JSON.stringify({ type: "cycle:start", cycleId: "c1", storyId: "US-1", agent: "claude", ts: 2 }),
    ]);
    expect(readCycleAttributionFromEvents(p, "c1")).toEqual({ storyId: "US-1", agent: "claude" });
  });

  it("skips malformed lines and empty values", () => {
    const p = tmpEvents([
      "not-json",
      JSON.stringify({ type: "cycle:start", cycleId: "c1", storyId: "", agent: "", ts: 1 }),
      JSON.stringify({ type: "agent:stall", cycleId: "c1", agent: "kimi", idleSec: 1, ts: 2 }),
    ]);
    expect(readCycleAttributionFromEvents(p, "c1")).toEqual({ agent: "kimi" });
  });
});
