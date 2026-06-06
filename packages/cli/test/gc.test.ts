/**
 * US-META-001 — `roll gc`: discovers run dirs across both archive layouts and
 * really deletes the old surplus tail (fixture-verified), keeping freshest N +
 * recent runs; --dry-run touches nothing.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectStoryArchives, gcCommand } from "../src/commands/gc.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

const NOW = new Date("2026-06-06T00:00:00Z");
const NOW_SEC = Math.floor(NOW.getTime() / 1000);
const DAY = 86400;

/** Make a run dir whose mtime is `ageDays` old. */
function run(storyDir: string, runId: string, ageDays: number): string {
  const p = join(storyDir, runId);
  mkdirSync(p, { recursive: true });
  const t = NOW_SEC - ageDays * DAY;
  utimesSync(p, t, t);
  return p;
}

function project(): string {
  const proj = mkdtempSync(join(tmpdir(), "roll-gc-"));
  dirs.push(proj);
  return proj;
}

function silenced<T>(fn: () => T): T {
  const o = process.stdout.write.bind(process.stdout);
  // @ts-expect-error capture-only
  process.stdout.write = (): boolean => true;
  try {
    return fn();
  } finally {
    process.stdout.write = o;
  }
}

describe("collectStoryArchives", () => {
  it("finds run dirs under both card and legacy layouts", () => {
    const proj = project();
    run(join(proj, ".roll", "features", "alpha", "US-A-1"), "2026-06-01T00-00-00", 5);
    run(join(proj, ".roll", "verification", "FIX-B-2"), "2026-05-01T00-00-00", 36);
    const found = collectStoryArchives(proj).map((s) => s.storyId).sort();
    expect(found).toEqual(["FIX-B-2", "US-A-1"]);
  });
});

describe("gcCommand", () => {
  it("really deletes old surplus runs, keeps freshest N + recent", () => {
    const proj = project();
    const card = join(proj, ".roll", "features", "alpha", "US-A-1");
    run(card, "2026-06-05T00-00-00", 1); // recent
    run(card, "2026-03-01T00-00-00", 97); // old #1
    run(card, "2026-02-01T00-00-00", 125); // old #2
    const save = process.cwd();
    process.chdir(proj);
    try {
      expect(silenced(() => gcCommand(["--keep-latest", "1", "--keep-days", "30"], { now: () => NOW }))).toBe(0);
    } finally {
      process.chdir(save);
    }
    expect(existsSync(join(card, "2026-06-05T00-00-00"))).toBe(true); // kept (freshest)
    expect(existsSync(join(card, "2026-03-01T00-00-00"))).toBe(false); // deleted
    expect(existsSync(join(card, "2026-02-01T00-00-00"))).toBe(false); // deleted
  });

  it("--help never sweeps (safety)", () => {
    const proj = project();
    const card = join(proj, ".roll", "features", "alpha", "US-A-1");
    run(card, "2026-01-01T00-00-00", 156); // very old surplus
    const save = process.cwd();
    process.chdir(proj);
    try {
      expect(silenced(() => gcCommand(["--help"], { now: () => NOW }))).toBe(0);
    } finally {
      process.chdir(save);
    }
    expect(existsSync(join(card, "2026-01-01T00-00-00"))).toBe(true); // untouched
  });

  it("--dry-run deletes nothing", () => {
    const proj = project();
    const card = join(proj, ".roll", "features", "alpha", "US-A-1");
    run(card, "2026-01-01T00-00-00", 156); // very old
    const save = process.cwd();
    process.chdir(proj);
    try {
      expect(silenced(() => gcCommand(["--dry-run", "--keep-latest", "0", "--keep-days", "30"], { now: () => NOW }))).toBe(0);
    } finally {
      process.chdir(save);
    }
    expect(existsSync(join(card, "2026-01-01T00-00-00"))).toBe(true); // untouched
  });
});
