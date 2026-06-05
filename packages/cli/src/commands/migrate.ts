/**
 * `roll migrate` — TS port of bin/roll cmd_migrate (3175-3258) plus its helpers
 * _migrate_build_moves (3263-3289), _migrate_preview (3291-3304),
 * _migrate_execute (3306-3336), and _migrate_help (3338-3363).
 *
 * One-shot migration from the old project layout (BACKLOG.md, docs/…) into the
 * .roll/ structure via `git mv`, with three-state idempotency:
 *   - old-only   → execute (single atomic commit)
 *   - new-only   → no-op "already migrated"
 *   - both       → error with conflict list
 *   - neither    → no-op "nothing to migrate"
 *
 * Mirrors every transformation, skip condition, stdout/stderr, and exit code of
 * the frozen bash oracle. Uses the shared bash UI helpers' exact byte output
 * (info/ok/warn/err with the colored `[roll]` prefix, honoring NO_COLOR).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveLang, t, v2Catalog, type Lang } from "@roll/spec";

// ─── bash UI helpers (bin/roll:41-56) ────────────────────────────────────────
function colors(): { RED: string; GREEN: string; YELLOW: string; CYAN: string; NC: string } {
  const noColor = (process.env["NO_COLOR"] ?? "") !== "";
  return noColor
    ? { RED: "", GREEN: "", YELLOW: "", CYAN: "", NC: "" }
    : {
        RED: "\x1b[0;31m",
        GREEN: "\x1b[0;32m",
        YELLOW: "\x1b[0;33m",
        CYAN: "\x1b[0;36m",
        NC: "\x1b[0m",
      };
}
function info(line: string): void {
  const { CYAN, NC } = colors();
  process.stdout.write(`${CYAN}[roll]${NC} ${line}\n`);
}
function ok(line: string): void {
  const { GREEN, NC } = colors();
  process.stdout.write(`${GREEN}[roll]${NC} ${line}\n`);
}
function warn(line: string): void {
  const { YELLOW, NC } = colors();
  process.stdout.write(`${YELLOW}[roll]${NC} ${line}\n`);
}
function err(line: string): void {
  const { RED, NC } = colors();
  process.stderr.write(`${RED}[roll]${NC} ${line}\n`);
}

function msgLang(): Lang {
  return resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });
}
function m(key: string, ...args: Array<string | number>): string {
  return t(v2Catalog, msgLang(), key, ...args);
}

// ─── git ──────────────────────────────────────────────────────────────────────
function git(args: string[]): { status: number; stdout: string } {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

/**
 * Port of _migrate_build_moves — the canonical "src|target" plan. Order matters
 * (directory renames precede moves whose target_dir is the same dir).
 */
function buildMoves(): string[] {
  return [
    "BACKLOG.md|.roll/backlog.md",
    "PROPOSALS.md|.roll/proposals.md",
    "docs/features.md|.roll/features.md",
    "docs/features|.roll/features",
    "docs/briefs|.roll/briefs",
    "docs/dream|.roll/dream",
    "docs/design|.roll/design",
    "docs/domain|.roll/domain",
    "docs/practices/loop-autorun-verification.md|.roll/verification/loop-autorun-verification.md",
    "docs/site|site",
    "docs/intro|site/slides",
    "docs/guide/en|guide/en",
    "docs/guide/zh|guide/zh",
    "docs/practices/engineering-common-sense.md|guide/en/practices/engineering-common-sense.md",
  ];
}

function srcOf(move: string): string {
  return move.replace(/\|.*$/, ""); // ${m%%|*}
}
function tgtOf(move: string): string {
  return move.replace(/^.*\|/, ""); // ${m##*|}
}

const HELP = `Usage: roll migrate [--dry-run]

Migrate this project's process artifacts (.roll/backlog.md, .roll/proposals.md,
.roll/features/, .roll/briefs/, .roll/dream/, .roll/design/, .roll/domain/)
into a .roll/ directory. Also relocates guide/ → guide/,
site/ → site/, site/slides/ → site/slides/.

Options:
  --dry-run, -n   Show what would be moved without modifying files
  --help, -h      Show this help

Three-state idempotency:
  - Only old paths present  → migration executes (single atomic commit)
  - Only .roll/ present     → no-op (already migrated)
  - Both present            → error with conflict list (manual review)
  - Neither                 → no-op (nothing to migrate)

Preconditions:
  - Current directory is a git repository
  - Working tree is clean (commit or stash changes first)

Uses git mv to preserve file history. On success, produces a single commit.
`;

/** Byte-based left-pad to width (mirrors bash printf %-Ns, which counts bytes). */
function padBytes(s: string, width: number): string {
  const bytes = Buffer.byteLength(s, "utf8");
  if (bytes >= width) return s;
  return s + " ".repeat(width - bytes);
}

function migratePreview(activeMoves: string[]): void {
  info(m("migrate.migration_preview_dry_run"));
  process.stdout.write("\n");
  process.stdout.write(`  ${padBytes(m("migrate.old_path"), 60)} → ${m("migrate.new_path")}\n`);
  const sep = "─".repeat(100);
  process.stdout.write(`  ${sep}\n`);
  for (const move of activeMoves) {
    process.stdout.write(`  ${padBytes(srcOf(move), 60)} → ${tgtOf(move)}\n`);
  }
  process.stdout.write("\n");
  info(m("migrate.run_without_dry_run_to_execute"));
}

function migrateExecute(activeMoves: string[]): number {
  info(m("migrate.migrating_paths_via_git_mv", activeMoves.length));
  let moved = 0;
  for (const move of activeMoves) {
    const src = srcOf(move);
    const tgt = tgtOf(move);
    const targetDir = dirname(tgt);
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    const r = git(["mv", src, tgt]);
    if (r.status !== 0) {
      err(`git mv failed: ${src} → ${tgt}`);
      err(m("migrate.aborting_previous_moves_are_staged_but"));
      return 1;
    }
    moved += 1;
  }
  // Clean up empty docs/ shells.
  if (existsSync("docs")) {
    spawnSync("find", ["docs", "-type", "d", "-empty", "-delete"], { stdio: "ignore" });
  }
  // Single atomic commit.
  git([
    "commit",
    "--quiet",
    "-m",
    `Migrate project layout to .roll/ structure

Atomic migration via 'roll migrate' command. Process artifacts moved
from root and docs/ into .roll/; user docs relocated to guide/ and site/.

Paths migrated: ${moved}`,
  ]);
  ok(m("migrate.migrated_paths_in_a_single_commit", moved));
  process.stdout.write("\n");
  process.stdout.write(m("migrate.next_steps") + "\n");
  process.stdout.write("    git log -1                    # Inspect the migration commit\n");
  process.stdout.write("    roll status                   # Verify new structure\n");
  return 0;
}

export function migrateCommand(args: string[]): number {
  let dryRun = false;
  for (const a of args) {
    if (a === "--dry-run" || a === "-n") dryRun = true;
    else if (a === "-h" || a === "--help") {
      process.stdout.write(HELP);
      return 0;
    } else {
      err(m("migrate.unknown_arg_1", a));
      return 1;
    }
  }

  // Must be in a git repo (git mv preserves history).
  if (git(["rev-parse", "--git-dir"]).status !== 0) {
    err(m("migrate.not_a_git_repository_roll_migrate"));
    return 1;
  }

  const moves = buildMoves();

  // Detect state: do old paths exist? does .roll/ exist?
  let hasNew = false;
  let hasOld = false;
  if (existsSync(".roll")) hasNew = true;
  for (const move of moves) {
    if (existsSync(srcOf(move))) {
      hasOld = true;
      break;
    }
  }

  // Three-state dispatch.
  if (hasNew && hasOld) {
    err(m("migrate.both_old_and_new_structures_exist"));
    process.stderr.write("\n");
    process.stderr.write(m("migrate.conflicting_paths") + "\n");
    for (const move of moves) {
      const src = srcOf(move);
      const tgt = tgtOf(move);
      if (existsSync(src) && existsSync(tgt)) {
        process.stderr.write(`  - ${src}  AND  ${tgt}  both exist\n`);
      }
    }
    process.stderr.write("\n");
    err(m("migrate.resolve_manually_then_re_run"));
    return 1;
  }

  if (hasNew && !hasOld) {
    ok(m("migrate.already_migrated_roll_exists_no_old"));
    return 0;
  }

  if (!hasOld) {
    info(m("migrate.no_old_structure_detected_nothing_to"));
    return 0;
  }

  // State: old-only — proceed. Filter to actually existing paths.
  const activeMoves = moves.filter((move) => existsSync(srcOf(move)));

  if (activeMoves.length === 0) {
    warn(m("migrate.old_structure_markers_found_but_no"));
    return 0;
  }

  if (dryRun) {
    migratePreview(activeMoves);
    return 0;
  }

  // Real execution requires clean working tree (we'll create a single commit).
  if (git(["diff", "--quiet", "--ignore-submodules", "HEAD"]).status !== 0) {
    err(m("migrate.working_tree_not_clean_commit_or"));
    return 1;
  }

  return migrateExecute(activeMoves);
}
