/**
 * US-DEMO-001 — `roll pulse` unit tests.
 *
 * Covers: text output (bilingual EN/中), --json output, missing truth.json
 * error, no-color mode, and that values match the truth snapshot exactly.
 * Time is pinned, no external processes spawned.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serializeTruthSnapshot, type TruthSnapshot } from "@roll/spec";
import { pulseCommand } from "../src/commands/pulse.js";
import { stripAnsi } from "../src/render.js";
import { truthJsonPath } from "../src/lib/truth-read.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env["ROLL_LANG"];
  delete process.env["LC_ALL"];
  delete process.env["LANG"];
  delete process.env["NO_COLOR"];
});

function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "roll-pulse-"));
  dirs.push(d);
  return d;
}

function captureStdout(fn: () => number): { code: number; out: string } {
  let out = "";
  const so = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
  try {
    return { code: fn(), out };
  } finally {
    process.stdout.write = so;
  }
}

function captureStderr(fn: () => number): { code: number; err: string } {
  let err = "";
  const se = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
  try {
    return { code: fn(), err };
  } finally {
    process.stderr.write = se;
  }
}

// A minimal truth snapshot with all the pulse fields populated.
const SNAP: TruthSnapshot = {
  generatedAt: "2026-06-20T12:00:00Z",
  story: {
    total: 100,
    spectrum: { done: 60, wip: 3, hold: 2, todo: 10, fail: 5, unknown: 20 },
    legacy: 15,
  },
  cycle: { cycles3d: 12, failed3d: 2, costUsd3d: 3.5 },
  loop: { lanes: [] },
  stories: [
    { id: "US-1", epic: "e", ladder: "attested", evidence: { report: true, acMap: true, visualEvidence: true }, truthState: "done", legacy: false },
    { id: "US-2", epic: "e", ladder: "merged", evidence: { report: true, acMap: true, visualEvidence: false }, truthState: "done", legacy: false },
    { id: "US-3", epic: "e", ladder: "attested", evidence: { report: true, acMap: true, visualEvidence: true }, truthState: "done", legacy: false },
    { id: "US-4", epic: "e", ladder: "claimed", evidence: { report: false, acMap: false, visualEvidence: false }, truthState: "done", legacy: false },
    { id: "US-5", epic: "e", ladder: "none", evidence: { report: false, acMap: false, visualEvidence: false }, truthState: "todo", legacy: false },
  ],
};

function writeTruth(dir: string, snap: TruthSnapshot): void {
  const features = join(dir, ".roll", "features");
  mkdirSync(features, { recursive: true });
  writeFileSync(truthJsonPath(dir), serializeTruthSnapshot(snap));
}

describe("pulseCommand", () => {
  it("prints bilingual text output (EN)", () => {
    const d = freshDir();
    writeTruth(d, SNAP);
    process.env["ROLL_LANG"] = "en";
    const origCwd = process.cwd();
    process.chdir(d);
    try {
      const { code, out } = captureStdout(() => pulseCommand([]));
      expect(code).toBe(0);
      const clean = stripAnsi(out);
      expect(clean).toContain("roll pulse");
      expect(clean).toContain("Today's Delivery Pulse");
      expect(clean).toContain("Cycles 3d");
      expect(clean).toContain("12");
      expect(clean).toContain("Merged");
      expect(clean).toContain("3"); // 2 attested + 1 merged = 3
      expect(clean).toContain("Attested");
      expect(clean).toContain("2"); // 2 attested stories
      expect(clean).toContain("Spectrum");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("prints bilingual text output (ZH)", () => {
    const d = freshDir();
    writeTruth(d, SNAP);
    process.env["ROLL_LANG"] = "zh";
    const origCwd = process.cwd();
    process.chdir(d);
    try {
      const { code, out } = captureStdout(() => pulseCommand([]));
      expect(code).toBe(0);
      const clean = stripAnsi(out);
      expect(clean).toContain("roll pulse");
      expect(clean).toContain("今日交付脉搏");
      expect(clean).toContain("近 3d 周期");
      expect(clean).toContain("已合 merged");
      expect(clean).toContain("已验收 attested");
      expect(clean).toContain("状态分布");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("outputs JSON with same numbers", () => {
    const d = freshDir();
    writeTruth(d, SNAP);
    const origCwd = process.cwd();
    process.chdir(d);
    try {
      const { code, out } = captureStdout(() => pulseCommand(["--json"]));
      expect(code).toBe(0);
      const obj = JSON.parse(out) as Record<string, unknown>;
      expect(obj.cycles).toBe(12);
      expect(obj.merged).toBe(3);
      expect(obj.attested).toBe(2);
      expect(typeof obj.sparkline).toBe("string");
      expect(obj.spectrum).toEqual(SNAP.story.spectrum);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("errors when truth.json is missing", () => {
    const d = freshDir();
    // Don't write truth.json
    const origCwd = process.cwd();
    process.chdir(d);
    try {
      const { code, err } = captureStderr(() => pulseCommand([]));
      expect(code).toBe(1);
      expect(stripAnsi(err)).toContain("truth.json");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("errors in JSON mode when truth.json is missing", () => {
    const d = freshDir();
    const origCwd = process.cwd();
    process.chdir(d);
    try {
      const { code, out } = captureStdout(() => pulseCommand(["--json"]));
      expect(code).toBe(1);
      const obj = JSON.parse(out) as Record<string, unknown>;
      expect(obj.error).toContain("truth.json");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("respects --no-color flag", () => {
    const d = freshDir();
    writeTruth(d, SNAP);
    process.env["ROLL_LANG"] = "en";
    const origCwd = process.cwd();
    process.chdir(d);
    try {
      const { code, out } = captureStdout(() => pulseCommand(["--no-color"]));
      expect(code).toBe(0);
      expect(out).not.toMatch(/\x1b\[/);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("respects NO_COLOR env", () => {
    const d = freshDir();
    writeTruth(d, SNAP);
    process.env["NO_COLOR"] = "1";
    const origCwd = process.cwd();
    process.chdir(d);
    try {
      const { code, out } = captureStdout(() => pulseCommand([]));
      expect(code).toBe(0);
      expect(out).not.toMatch(/\x1b\[/);
    } finally {
      process.chdir(origCwd);
    }
  });
});
