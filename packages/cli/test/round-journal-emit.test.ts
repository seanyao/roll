/**
 * US-CYCLE-004 — the runner emit hook (recordSpawnRound) and the readout CLI
 * (roll cycle journal). recordSpawnRound auto-writes a role turn into the card's
 * round-journal (no manual step) and is guaranteed non-blocking.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CycleContext } from "@roll/core";
import { readRoundEntries } from "@roll/core";
import { afterEach, describe, expect, it } from "vitest";
import { recordSpawnRound } from "../src/runner/round-journal-emit.js";
import { cycleCommand } from "../src/commands/cycle.js";
import type { Ports } from "../src/runner/ports.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function proj(): string {
  const d = mkdtempSync(join(tmpdir(), "roll-rj-emit-"));
  dirs.push(d);
  return d;
}
// cardArchiveDir(proj, id) with no index.json → .roll/features/uncategorized/<id>
function cardDirOf(project: string, id: string): string {
  return join(project, ".roll", "features", "uncategorized", id);
}
/** recordSpawnRound defers the write via setImmediate (non-blocking) — flush it. */
function flush(): Promise<void> {
  return new Promise((r) => setImmediate(() => setImmediate(() => r())));
}

describe("recordSpawnRound (US-CYCLE-004 auto-write)", () => {
  it("writes a builder turn into the card's round-journal, numbering rounds by append order", async () => {
    const project = proj();
    const ports = { repoCwd: project } as unknown as Ports;
    const ctx = { storyId: "US-X-1", model: "glm-5.2", cycleId: "c1" } as unknown as CycleContext;
    recordSpawnRound(ports, ctx, { role: "builder", start: 1_000, durMs: 60_000, outcome: "delivered" });
    await flush();
    recordSpawnRound(ports, ctx, { role: "builder", start: 70_000, durMs: 30_000, outcome: "failed", gateTimeMs: 5_000 });
    await flush();
    const { entries } = readRoundEntries(cardDirOf(project, "US-X-1"));
    expect(entries.map((e) => e.round)).toEqual([1, 2]);
    expect(entries[0]).toMatchObject({ role: "builder", model: "glm-5.2", cycleId: "c1", outcome: "delivered" });
    expect(entries[1]).toMatchObject({ outcome: "failed", gateTimeMs: 5_000 });
  });

  it("returns synchronously (non-blocking) — the write is deferred off the hot path", () => {
    const project = proj();
    const ports = { repoCwd: project } as unknown as Ports;
    const ctx = { storyId: "US-X-3", cycleId: "c1" } as unknown as CycleContext;
    recordSpawnRound(ports, ctx, { role: "builder", start: 1, durMs: 1, outcome: "delivered" });
    // Nothing written yet in the same tick — proves the caller isn't blocked on I/O.
    expect(existsSync(join(cardDirOf(project, "US-X-3"), "round-journal.jsonl"))).toBe(false);
  });

  it("is a no-op for a story-less cycle (nothing to journal into)", async () => {
    const project = proj();
    const ports = { repoCwd: project } as unknown as Ports;
    const ctx = { storyId: "", cycleId: "c1" } as unknown as CycleContext;
    recordSpawnRound(ports, ctx, { role: "builder", start: 1, durMs: 1, outcome: "delivered" });
    await flush();
    expect(existsSync(join(project, ".roll", "features"))).toBe(false);
  });

  it("never throws even if the repo path is unusable (best-effort, non-blocking)", async () => {
    const ports = { repoCwd: "/nonexistent/\0bad" } as unknown as Ports;
    const ctx = { storyId: "US-X-9" } as unknown as CycleContext;
    expect(() => recordSpawnRound(ports, ctx, { role: "builder", start: 1, durMs: 1, outcome: "delivered" })).not.toThrow();
    await flush();
  });
});

describe("roll cycle journal (US-CYCLE-004 readout)", () => {
  function runJournal(project: string, args: string[]): { code: number; out: string } {
    const save = { cwd: process.cwd(), NC: process.env["NO_COLOR"], LG: process.env["ROLL_LANG"] };
    process.chdir(project);
    process.env["NO_COLOR"] = "1";
    process.env["ROLL_LANG"] = "en";
    const out: string[] = [];
    const rOut = process.stdout.write.bind(process.stdout);
    // @ts-expect-error capture-only
    process.stdout.write = (x: string | Uint8Array): boolean => (out.push(String(x)), true);
    let code: number | Promise<number>;
    try {
      code = cycleCommand(args);
    } finally {
      process.stdout.write = rOut;
      process.chdir(save.cwd);
      if (save.NC === undefined) delete process.env["NO_COLOR"]; else process.env["NO_COLOR"] = save.NC;
      if (save.LG === undefined) delete process.env["ROLL_LANG"]; else process.env["ROLL_LANG"] = save.LG;
    }
    return { code: code as number, out: out.join("") };
  }

  it("prints the aggregate readout for a card with entries", async () => {
    const project = proj();
    const ports = { repoCwd: project } as unknown as Ports;
    const ctx = { storyId: "US-X-2", model: "glm", cycleId: "c1" } as unknown as CycleContext;
    recordSpawnRound(ports, ctx, { role: "builder", start: 1_000, durMs: 60_000, outcome: "delivered", gateTimeMs: 6_000 });
    await flush();
    const r = runJournal(project, ["journal", "US-X-2"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("US-X-2 round-journal");
    expect(r.out).toContain("overall:");
    expect(r.out).toContain("median=60.0s");
  });

  it("reports empty for a card with no journal, and errors with no card id", () => {
    const project = proj();
    expect(runJournal(project, ["journal", "US-NONE"]).out).toContain("no round-journal entries");
    expect(runJournal(project, ["journal"]).code).toBe(1);
  });
});
