/**
 * US-OBS-021 AC5 — Crash-isolation stress test.
 *
 * Runs a rapid O_APPEND append loop while the daemon is under watch-storm
 * / disk-contention, asserting:
 *   1. Append latency stays bounded (sub-second per append).
 *   2. Event integrity — every line written is intact.
 *   3. Daemon never writes to the watched files (read-only by construction).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFileSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileFollower } from "../src/file-follower.js";
import type { DossierFrame, DossierHeartbeatFrame } from "@roll/spec";

describe("Crash isolation stress test (AC5)", () => {
  let tmpDir: string;
  let loopDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `roll-stress-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    loopDir = join(tmpDir, ".roll", "loop");
    mkdirSync(loopDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("AC5: O_APPEND latency stays bounded under heavy daemon watch load", async () => {
    const APPEND_COUNT = 50;
    const MAX_LATENCY_MS = 500;

    // Start the daemon first.
    const frames: DossierFrame[] = [];
    const follower = new FileFollower({
      cwd: tmpDir,
      heartbeatMs: 5000,
      snapshotTtlMs: 5000,
      onFrame: (f) => frames.push(f),
    });
    follower.start();

    // Rapid O_APPEND writes to events.ndjson while daemon is watching.
    const latencies: number[] = [];
    const eventsPath = join(loopDir, "events.ndjson");

    for (let i = 0; i < APPEND_COUNT; i++) {
      const line = JSON.stringify({
        type: "loop:idle",
        loop: "backlog",
        nextFire: i,
        ts: Date.now(),
      }) + "\n";

      const start = performance.now();
      appendFileSync(eventsPath, line);
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
    }

    follower.stop();

    // Assert 1: every append was sub-MAX_LATENCY_MS.
    const maxLatency = Math.max(...latencies);
    expect(maxLatency).toBeLessThan(MAX_LATENCY_MS);

    // Assert 2: all lines are intact.
    const content = readFileSync(eventsPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBe(APPEND_COUNT);

    for (let i = 0; i < APPEND_COUNT; i++) {
      const parsed = JSON.parse(lines[i]!);
      expect(parsed.nextFire).toBe(i);
    }
  });

  it("AC5: daemon never writes to watched files (read-only by construction)", async () => {
    // Create initial watched files with known content.
    const eventsPath = join(loopDir, "events.ndjson");
    const runsPath = join(loopDir, "runs.jsonl");
    const livePath = join(loopDir, "live.log");
    const agentsPath = join(loopDir, "agents.yaml");

    const initialContent = "initial\n";
    writeFileSync(eventsPath, initialContent);
    writeFileSync(runsPath, initialContent);
    writeFileSync(livePath, initialContent);
    writeFileSync(agentsPath, initialContent);

    // Record sizes before daemon starts.
    const sizeBefore = {
      events: contentSize(eventsPath),
      runs: contentSize(runsPath),
      live: contentSize(livePath),
      agents: contentSize(agentsPath),
    };

    // Start daemon, let it run, then stop.
    const follower = new FileFollower({
      cwd: tmpDir,
      heartbeatMs: 50,
      snapshotTtlMs: 50,
      onFrame: () => {},
    });
    follower.start();
    await new Promise((r) => setTimeout(r, 300));
    follower.stop();

    // Wait for any async writes to settle.
    await new Promise((r) => setTimeout(r, 100));

    // Assert: no file grew (daemon is read-only).
    expect(contentSize(eventsPath)).toBe(sizeBefore.events);
    expect(contentSize(runsPath)).toBe(sizeBefore.runs);
    expect(contentSize(livePath)).toBe(sizeBefore.live);
    expect(contentSize(agentsPath)).toBe(sizeBefore.agents);
  });

  it("AC5: rapid writes during daemon lifetime don't corrupt event stream", async () => {
    // Mutation test: write valid JSON, then torn line, then valid JSON.
    const eventsPath = join(loopDir, "events.ndjson");

    // Pre-populate with valid lines.
    appendFileSync(
      eventsPath,
      '{"type":"cycle:start","cycleId":"c1","storyId":"s1","agent":"claude","model":"sonnet","ts":1}\n',
    );

    const follower = new FileFollower({
      cwd: tmpDir,
      heartbeatMs: 5000,
      snapshotTtlMs: 5000,
      onFrame: () => {},
    });
    follower.start();

    // Write valid line.
    appendFileSync(
      eventsPath,
      '{"type":"cycle:end","cycleId":"c1","outcome":"delivered","cost":{},"ts":2}\n',
    );
    // Write torn line (incomplete JSON — no closing brace).
    appendFileSync(eventsPath, '{"type":"cycle:start","cycleId":"c2","sto');
    // Write another valid line.
    appendFileSync(
      eventsPath,
      '{"type":"cycle:end","cycleId":"c2","outcome":"delivered","cost":{},"ts":3}\n',
    );

    await new Promise((r) => setTimeout(r, 200));
    follower.stop();

    // Read back: torn line merges with next line (no newline separator).
    // 1: pre-populated, 2: valid, 3: torn+valid merged, 4: (empty).
    const content = readFileSync(eventsPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");
    // 3 non-empty lines: pre-populated, valid, torn-merged-with-valid.
    expect(lines.length).toBe(3);
  });

  it("AC5: heartbeat continues under disk contention", async () => {
    // Rapid writes to events.ndjson while asserting heartbeat frames still arrive.
    const frames: DossierFrame[] = [];
    const follower = new FileFollower({
      cwd: tmpDir,
      heartbeatMs: 40,
      snapshotTtlMs: 5000,
      onFrame: (f) => frames.push(f),
    });
    follower.start();

    const eventsPath = join(loopDir, "events.ndjson");
    // Burst writes.
    for (let i = 0; i < 20; i++) {
      appendFileSync(
        eventsPath,
        JSON.stringify({ type: "loop:idle", loop: "backlog", nextFire: i, ts: Date.now() }) + "\n",
      );
    }

    await new Promise((r) => setTimeout(r, 250));
    follower.stop();

    const heartbeats = frames.filter((f) => f.kind === "heartbeat");
    // Should have received at least 2 heartbeats.
    expect(heartbeats.length).toBeGreaterThanOrEqual(2);

    // All heartbeats should have valid ts.
    for (const hb of heartbeats) {
      expect(typeof (hb as DossierHeartbeatFrame).ts).toBe("number");
    }
  });
});

// ── helpers ────────────────────────────────────────────────────────────────



function contentSize(path: string): number {
  try {
    return readFileSync(path).length;
  } catch {
    return -1;
  }
}
