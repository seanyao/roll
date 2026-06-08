import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyCorrectionCircuitBreaker } from "../src/runner/correction-circuit.js";
import type { RollEvent } from "@roll/spec";

function project(): { root: string; events: string; alerts: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "roll-correction-circuit-")));
  const loop = join(root, ".roll", "loop");
  mkdirSync(loop, { recursive: true });
  return { root, events: join(loop, "events.ndjson"), alerts: join(loop, "ALERT-test.md") };
}

function writeEvents(path: string, events: RollEvent[]): void {
  writeFileSync(path, events.map((ev) => JSON.stringify(ev)).join("\n") + "\n", "utf8");
}

describe("US-EVID-016 correction circuit runner adapter", () => {
  it("writes PAUSE, ALERT, and trace events when the correction circuit trips", () => {
    const p = project();
    writeEvents(p.events, [
      { type: "correction:action", storyId: "US-A", action: "return_story", signal: "regression", reason: "r1", ts: 10 },
      { type: "correction:action", storyId: "US-A", action: "route_adjust", signal: "regression", reason: "r2", ts: 20 },
      { type: "correction:action", storyId: "US-A", action: "return_story", signal: "regression", reason: "r3", ts: 30 },
    ]);

    const result = applyCorrectionCircuitBreaker(p.root, "test", p.events, p.alerts, 40);
    expect(result).toMatchObject({ status: "paused", pauseWritten: true });
    expect(existsSync(join(p.root, ".roll", "loop", "PAUSE-test"))).toBe(true);
    expect(readFileSync(p.alerts, "utf8")).toContain("correction circuit breaker tripped");
    const text = readFileSync(p.events, "utf8");
    expect(text).toContain('"type":"correction:circuit_breaker"');
    expect(text).toContain('"type":"policy:safety_pause"');
    expect(text).toContain('"type":"alert:notify"');
  });

  it("is idempotent for the same tripped signal", () => {
    const p = project();
    writeEvents(p.events, [
      { type: "correction:action", storyId: "US-A", action: "return_story", signal: "regression", reason: "r1", ts: 10 },
      { type: "correction:action", storyId: "US-A", action: "route_adjust", signal: "regression", reason: "r2", ts: 20 },
      { type: "correction:action", storyId: "US-A", action: "return_story", signal: "regression", reason: "r3", ts: 30 },
    ]);
    expect(applyCorrectionCircuitBreaker(p.root, "test", p.events, p.alerts, 40).status).toBe("paused");
    const once = readFileSync(p.events, "utf8");
    expect(applyCorrectionCircuitBreaker(p.root, "test", p.events, p.alerts, 41).status).toBe("already_tripped");
    expect(readFileSync(p.events, "utf8")).toBe(once);
  });

  it("honors policy.yaml thresholds", () => {
    const p = project();
    writeFileSync(join(p.root, ".roll", "policy.yaml"), "loop_safety:\n  correction_oscillation_threshold: 4\n");
    writeEvents(p.events, [
      { type: "correction:action", storyId: "US-A", action: "return_story", signal: "regression", reason: "r1", ts: 10 },
      { type: "correction:action", storyId: "US-A", action: "route_adjust", signal: "regression", reason: "r2", ts: 20 },
      { type: "correction:action", storyId: "US-A", action: "return_story", signal: "regression", reason: "r3", ts: 30 },
    ]);
    expect(applyCorrectionCircuitBreaker(p.root, "test", p.events, p.alerts, 40)).toEqual({ status: "continue" });
  });
});
