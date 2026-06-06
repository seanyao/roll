/**
 * US-META-002a — `roll archive migrate`: plans the move of legacy
 * `verification/<ID>/` trees into `features/<epic>/<ID>/` (git mv preserving
 * history, report renamed, latest rebuilt, GC pre-clean), with a dry-run that
 * touches nothing and a re-entrant real run that converges.
 */
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { archiveMigrateCommand } from "../src/commands/archive-migrate.js";
import { buildArchiveMigratePlan, summarizePlan } from "../src/lib/archive-migrate.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

const NOW = new Date("2026-06-06T00:00:00Z");
const NOW_SEC = Math.floor(NOW.getTime() / 1000);
const DAY = 86400;

/** Touch a file (creating parents), optionally aging the parent run dir. */
function file(path: string, body = "x"): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
}
function age(dir: string, ageDays: number): void {
  const t = NOW_SEC - ageDays * DAY;
  utimesSync(dir, t, t);
}

/** Build a project with an index.json (ID→epic) and a backlog. */
function project(index: Record<string, string>): string {
  const proj = mkdtempSync(join(tmpdir(), "roll-amig-"));
  dirs.push(proj);
  mkdirSync(join(proj, ".roll"), { recursive: true });
  writeFileSync(join(proj, ".roll", "backlog.md"), "| Story | Description | Status |\n|---|---|---|\n");
  writeFileSync(join(proj, ".roll", "index.json"), JSON.stringify({ stories: index }, null, 2) + "\n");
  return proj;
}

/** A legacy verification card with one run (report + evidence + screenshot) and
 *  a card-level ac-map.json + a `latest` symlink to the run. */
function legacyCard(proj: string, id: string, runId: string, ageDays = 1): void {
  const card = join(proj, ".roll", "verification", id);
  const run = join(card, runId);
  file(join(run, "report.html"), `<html>${id}</html>`);
  file(join(run, "evidence.json"), "{}");
  file(join(run, "screenshots", "shot.png"), "png");
  age(run, ageDays);
  file(join(card, "ac-map.json"), "[]");
  symlinkSync(runId, join(card, "latest"));
}

const OPTS = { keepLatest: 10, keepDays: 30, nowSec: NOW_SEC };

function withCwd<T>(dir: string, fn: () => T): T {
  const save = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(save);
  }
}

function silenced<T>(fn: () => T): T {
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (): boolean => true;
  // @ts-expect-error capture-only
  process.stderr.write = (): boolean => true;
  try {
    return fn();
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
}

describe("buildArchiveMigratePlan", () => {
  it("plans run move + report rename + card files + latest + legacy retire", () => {
    const proj = project({ "US-ATTEST-010": "acceptance-evidence" });
    legacyCard(proj, "US-ATTEST-010", "2026-06-05T00-00-00");
    const plan = buildArchiveMigratePlan(proj, OPTS);
    expect(plan.cards).toHaveLength(1);
    const card = plan.cards[0]!;
    expect(card.epic).toBe("acceptance-evidence");
    expect(card.cardDir).toBe(".roll/features/acceptance-evidence/US-ATTEST-010");
    const kinds = card.ops.map((o) => o.kind);
    // dir mv, report rename mv, card-level ac-map mv, symlink, rmdir
    expect(kinds).toContain("mv");
    expect(kinds).toContain("symlink");
    expect(kinds).toContain("rmdir");
    const s = summarizePlan(plan);
    expect(s.runsMoved).toBe(1);
    expect(s.reportsRenamed).toBe(1);
    expect(s.cardFilesMoved).toBe(1); // ac-map.json
    expect(s.latestRebuilt).toBe(1);
    expect(s.gcDeleted).toBe(0);
  });

  it("uncategorized fallback when the index has no epic", () => {
    const proj = project({});
    legacyCard(proj, "FIX-999", "2026-06-05T00-00-00");
    const plan = buildArchiveMigratePlan(proj, OPTS);
    expect(plan.cards[0]!.epic).toBe("uncategorized");
  });

  it("GC pre-cleans old surplus runs instead of moving them", () => {
    const proj = project({ "FIX-204": "loop-engine" });
    legacyCard(proj, "FIX-204", "2026-06-05T00-00-00", 1); // recent
    const old = join(proj, ".roll", "verification", "FIX-204", "2026-01-01T00-00-00");
    file(join(old, "report.html"));
    age(old, 156); // old surplus
    const plan = buildArchiveMigratePlan(proj, { keepLatest: 1, keepDays: 30, nowSec: NOW_SEC });
    const s = summarizePlan(plan);
    expect(s.gcDeleted).toBe(1); // the old run is deleted, not moved
    expect(s.runsMoved).toBe(1); // only the recent run migrates
  });

  it("exempts non-card files under verification/", () => {
    const proj = project({});
    file(join(proj, ".roll", "verification", "loop-autorun-verification.md"), "notes");
    const plan = buildArchiveMigratePlan(proj, OPTS);
    expect(plan.exempt).toContain("loop-autorun-verification.md");
    expect(plan.cards).toHaveLength(0);
  });

  it("no verification dir → empty plan", () => {
    const proj = project({});
    const plan = buildArchiveMigratePlan(proj, OPTS);
    expect(plan.cards).toHaveLength(0);
    expect(plan.exempt).toHaveLength(0);
  });
});

describe("archiveMigrateCommand", () => {
  it("--dry-run touches nothing", () => {
    const proj = project({ "US-ATTEST-010": "acceptance-evidence" });
    legacyCard(proj, "US-ATTEST-010", "2026-06-05T00-00-00");
    expect(withCwd(proj, () => silenced(() => archiveMigrateCommand(["--dry-run"], { now: () => NOW })))).toBe(0);
    expect(existsSync(join(proj, ".roll", "verification", "US-ATTEST-010", "2026-06-05T00-00-00"))).toBe(true);
    expect(existsSync(join(proj, ".roll", "features", "acceptance-evidence"))).toBe(false);
  });

  it("real run moves the tree, renames the report, rebuilds latest, retires legacy", () => {
    const proj = project({ "US-ATTEST-010": "acceptance-evidence" });
    execSync("git init -q", { cwd: proj });
    execSync("git config user.email a@b.c && git config user.name t", { cwd: proj });
    legacyCard(proj, "US-ATTEST-010", "2026-06-05T00-00-00");
    execSync("git add -A && git commit -q -m init", { cwd: proj });

    expect(withCwd(proj, () => silenced(() => archiveMigrateCommand([], { now: () => NOW })))).toBe(0);

    const cardRun = join(proj, ".roll", "features", "acceptance-evidence", "US-ATTEST-010", "2026-06-05T00-00-00");
    expect(existsSync(join(cardRun, "US-ATTEST-010-report.html"))).toBe(true); // renamed
    expect(existsSync(join(cardRun, "report.html"))).toBe(false); // old name gone
    expect(existsSync(join(cardRun, "evidence.json"))).toBe(true);
    expect(existsSync(join(cardRun, "screenshots", "shot.png"))).toBe(true);
    const card = join(proj, ".roll", "features", "acceptance-evidence", "US-ATTEST-010");
    expect(existsSync(join(card, "ac-map.json"))).toBe(true); // card-level moved
    expect(readlinkSync(join(card, "latest"))).toBe("2026-06-05T00-00-00"); // rebuilt
    expect(existsSync(join(proj, ".roll", "verification", "US-ATTEST-010"))).toBe(false); // retired
    // history preserved: commit the staged move, then --follow reaches the original.
    execSync("git commit -q -m migrate", { cwd: proj });
    const log = execSync("git log --follow --oneline -- '.roll/features/acceptance-evidence/US-ATTEST-010/2026-06-05T00-00-00/US-ATTEST-010-report.html'", {
      cwd: proj,
      encoding: "utf8",
    });
    expect(log).toContain("init");
  });

  it("re-entrant: a second real run is a clean no-op", () => {
    const proj = project({ "US-ATTEST-010": "acceptance-evidence" });
    execSync("git init -q", { cwd: proj });
    execSync("git config user.email a@b.c && git config user.name t", { cwd: proj });
    legacyCard(proj, "US-ATTEST-010", "2026-06-05T00-00-00");
    execSync("git add -A && git commit -q -m init", { cwd: proj });

    withCwd(proj, () => silenced(() => archiveMigrateCommand([], { now: () => NOW })));
    // Re-plan after a complete run must be empty (convergence).
    const plan = buildArchiveMigratePlan(proj, OPTS);
    expect(plan.cards).toHaveLength(0);
    // And a second invocation still exits 0 without error.
    expect(withCwd(proj, () => silenced(() => archiveMigrateCommand([], { now: () => NOW })))).toBe(0);
  });

  it("--help never migrates", () => {
    const proj = project({ "US-ATTEST-010": "acceptance-evidence" });
    legacyCard(proj, "US-ATTEST-010", "2026-06-05T00-00-00");
    expect(withCwd(proj, () => silenced(() => archiveMigrateCommand(["--help"], { now: () => NOW })))).toBe(0);
    expect(existsSync(join(proj, ".roll", "verification", "US-ATTEST-010"))).toBe(true);
  });
});
