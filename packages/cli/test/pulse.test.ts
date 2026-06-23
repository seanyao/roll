/**
 * US-DEMO-001 — roll pulse unit tests.
 *
 * Covers: human-readable (EN/zh), --json machine-readable, error paths.
 * Uses fixture truth.json in a temp dir via process.chdir() so repoRoot()
 * resolves to the temp dir without mocking.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pulseCommand } from "../src/commands/pulse.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) {
    // Best-effort cleanup via rm -rf
    try {
      const { rmSync } = require("node:fs");
      rmSync(d, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
});

interface TruthJsonOpts {
  cycles3d?: number;
  merged?: number;
  attested?: number;
  spectrumDone?: number;
  spectrumTodo?: number;
  spectrumWip?: number;
  spectrumFail?: number;
  spectrumHold?: number;
  spectrumUnknown?: number;
  generatedAt?: string;
}

function writeTruthJson(dir: string, opts: TruthJsonOpts): void {
  const stories: Array<Record<string, unknown>> = [];
  // Create merged stories
  for (let i = 0; i < (opts.merged ?? 3); i++) {
    const ladder = i < (opts.attested ?? 1) ? "attested" : "merged";
    stories.push({
      id: `US-TEST-00${i + 1}`,
      epic: "test",
      ladder,
      evidence: { report: true, acMap: true, visualEvidence: ladder === "attested" },
      truthState: "done",
      truthReason: "test_fixture",
      legacy: false,
    });
  }
  // Add some non-merged stories
  stories.push(
    { id: "FIX-TEST-001", epic: "test", ladder: "none", evidence: { report: false, acMap: false, visualEvidence: false }, truthState: "todo", legacy: false },
    { id: "US-TEST-099", epic: "test", ladder: "claimed", evidence: { report: false, acMap: false, visualEvidence: false }, truthState: "fail", legacy: false },
  );

  const truth = {
    generatedAt: opts.generatedAt ?? "2026-06-24T06:00:00Z",
    collectedAt: "2026-06-24T06:00:00Z",
    story: {
      total: 100,
      spectrum: {
        done: opts.spectrumDone ?? 50,
        wip: opts.spectrumWip ?? 2,
        hold: opts.spectrumHold ?? 1,
        todo: opts.spectrumTodo ?? 20,
        fail: opts.spectrumFail ?? 5,
        unknown: opts.spectrumUnknown ?? 22,
      },
      legacy: 10,
    },
    cycle: {
      cycles3d: opts.cycles3d ?? 12,
      failed3d: 2,
      costUsd3d: 5.5,
    },
    stories,
  };

  mkdirSync(join(dir, ".roll", "features"), { recursive: true });
  writeFileSync(join(dir, ".roll", "features", "truth.json"), JSON.stringify(truth, null, 2) + "\n");
}

function mkProj(truth: TruthJsonOpts): string {
  const proj = mkdtempSync(join(tmpdir(), "roll-pulse-proj-"));
  dirs.push(proj);
  // repoRoot() walks up to find conventions/ marker — we need one in the temp dir
  // so it resolves to our fixture dir instead of the real project root.
  mkdirSync(join(proj, "conventions"));
  writeTruthJson(proj, truth);
  return proj;
}

function capturePulse(proj: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const saveNoColor = process.env["NO_COLOR"];
  const saveLang = process.env["ROLL_LANG"];
  process.env["NO_COLOR"] = "1";
  // Default to "en" — explicit env override per test
  if (!process.env["ROLL_LANG"]) process.env["ROLL_LANG"] = "en";

  const saveCwd = process.cwd();
  process.chdir(proj);

  const outC: string[] = [];
  const errC: string[] = [];
  const rOut = process.stdout.write.bind(process.stdout);
  const rErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error test capture only
  process.stdout.write = (x: string | Uint8Array): boolean => (outC.push(String(x)), true);
  // @ts-expect-error test capture only
  process.stderr.write = (x: string | Uint8Array): boolean => (errC.push(String(x)), true);

  let status: number;
  try {
    status = pulseCommand(args);
  } finally {
    process.stdout.write = rOut;
    process.stderr.write = rErr;
    process.chdir(saveCwd);
    if (saveNoColor !== undefined) process.env["NO_COLOR"] = saveNoColor;
    else delete process.env["NO_COLOR"];
    if (saveLang !== undefined) process.env["ROLL_LANG"] = saveLang;
    else delete process.env["ROLL_LANG"];
  }
  return { status, stdout: outC.join(""), stderr: errC.join("") };
}

describe("roll pulse", () => {
  it("prints human-readable pulse (EN)", () => {
    const proj = mkProj({ cycles3d: 12, merged: 3, attested: 1 });
    const r = capturePulse(proj, []);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("Today's delivery pulse");
    expect(r.stdout).toContain("cycles        12");
    expect(r.stdout).toContain("merged        3");
    expect(r.stdout).toContain("attested      1");
    expect(r.stdout).toContain("source: .roll/features/truth.json");
    // Sparkline should be present
    expect(r.stdout).toMatch(/spectrum\s+[ ▁▂▃▄▅▆▇█]+\s+done/);
  });

  it("prints human-readable pulse (ZH)", () => {
    const proj = mkProj({ cycles3d: 5, merged: 10, attested: 7 });
    process.env["ROLL_LANG"] = "zh";
    const r = capturePulse(proj, []);
    delete process.env["ROLL_LANG"];
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("今日交付脉搏");
    expect(r.stdout).toContain("周期/cycles   5");
    expect(r.stdout).toContain("已合/merged    10");
    expect(r.stdout).toContain("已验收/attested 7");
    expect(r.stdout).toContain("数据源: .roll/features/truth.json");
  });

  it("--json outputs machine-readable JSON", () => {
    const proj = mkProj({ cycles3d: 8, merged: 4, attested: 2 });
    const r = capturePulse(proj, ["--json"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    const parsed = JSON.parse(r.stdout);
    expect(parsed.cycles).toBe(8);
    expect(parsed.merged).toBe(4);
    expect(parsed.attested).toBe(2);
    expect(typeof parsed.spark).toBe("string");
    expect(parsed.spark.length).toBeGreaterThan(0);
    expect(parsed.spectrum.done).toBe(50);
    expect(typeof parsed.generatedAt).toBe("string");
  });

  it("handles missing truth.json gracefully", () => {
    const proj = mkdtempSync(join(tmpdir(), "roll-pulse-nofile-"));
    dirs.push(proj);
    // Need conventions/ marker for repoRoot() to resolve here
    mkdirSync(join(proj, "conventions"));
    // No truth.json created — deliberately missing
    const r = capturePulse(proj, []);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("cannot read truth.json");
    expect(r.stdout).toBe("");
  });

  it("handles unknown flags", () => {
    const proj = mkProj({});
    const r = capturePulse(proj, ["--bogus"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Usage:");
  });

  it("zero cycles renders correctly", () => {
    const proj = mkProj({ cycles3d: 0, merged: 0, attested: 0 });
    const r = capturePulse(proj, []);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("cycles        0");
    expect(r.stdout).toContain("merged        0");
    expect(r.stdout).toContain("attested      0");
  });
});
