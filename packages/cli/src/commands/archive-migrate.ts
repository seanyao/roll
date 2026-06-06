/**
 * US-META-002a — `roll archive migrate`: move the legacy run-store
 * (`.roll/verification/<ID>/`) into the card-folder layout
 * (`.roll/features/<epic>/<ID>/`) introduced by US-META-001.
 *
 * The plan is computed by {@link buildArchiveMigratePlan} (pure, reads FS only);
 * this command renders it (`--dry-run`) or executes it via `git mv` (history
 * preserved), rebuilding the `latest` symlink and GC-pre-cleaning old surplus
 * runs. It does NOT auto-commit — high blast radius (live roll-meta shared with
 * the loop), so the operator reviews `git status` and commits after a real run
 * (manifest §0: dry-run-first + human review). Re-entrant: a second run after a
 * partial/interrupted migration converges to a no-op.
 */
import {
  ARCHIVE_GC_DEFAULT_KEEP_DAYS,
  ARCHIVE_GC_DEFAULT_KEEP_LATEST,
  resolveKeepDays,
} from "@roll/core";
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import {
  buildArchiveMigratePlan,
  summarizePlan,
  type ArchiveMigratePlan,
  type CardMigratePlan,
} from "../lib/archive-migrate.js";

function git(args: string[], cwd: string): { status: number; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

/**
 * FIX-215 — the repo that actually tracks `.roll/`, and how to address paths
 * within it. In real projects `.roll` is an INDEPENDENT nested roll-meta repo
 * (gitignored by the project root), so a `git mv` issued from the project root
 * silently fails — the file lives in a different repo. Ask git which toplevel
 * owns `.roll`: its own nested repo if present, otherwise the project repo.
 *
 *   - nested form  → gitCwd = realpath(.roll); strip the leading `.roll/` from
 *                    project-root-relative op paths (they become repo-relative).
 *   - main form    → gitCwd = projectPath; op paths are already repo-relative.
 *
 * Nested-ness is detected by realpath equality (symlink-safe: cycle worktrees
 * reach `.roll` through a symlink), and path translation is a plain prefix
 * strip — no realpath on the moving paths, so a not-yet-existing destination
 * never trips it.
 */
interface MetaRepo {
  gitCwd: string;
  rel(projRel: string): string;
}

function metaRepo(projectPath: string): MetaRepo {
  const rollDir = join(projectPath, ".roll");
  const top = spawnSync("git", ["-C", rollDir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  const gitCwd = top.status === 0 && (top.stdout ?? "").trim() !== "" ? top.stdout.trim() : projectPath;
  let rollReal: string | undefined;
  try {
    rollReal = realpathSync(rollDir);
  } catch {
    rollReal = undefined;
  }
  const nested = rollReal !== undefined && rollReal === gitCwd;
  return {
    gitCwd,
    rel: (projRel) => (nested ? projRel.replace(/^\.roll[/\\]/, "") : projRel),
  };
}

const USAGE = [
  "Usage: roll archive migrate [--dry-run] [--keep-latest N] [--keep-days M]",
  "  Migrate legacy .roll/verification/<ID>/ trees into the card layout",
  "  .roll/features/<epic>/<ID>/ (epic from .roll/index.json). Runs are git-mv'd",
  "  (history preserved), report.html is renamed to <ID>-report.html, the latest",
  "  symlink is rebuilt, and old surplus runs are GC-pre-cleaned before the move.",
  "  --dry-run        print the full move plan without touching disk",
  "  --keep-latest N  keep the N freshest runs per card (default 10)",
  "  --keep-days M    keep runs younger than M days regardless of rank (default 30)",
  "  Re-entrant: safe to re-run after an interrupted migration (it converges).",
  "  Does NOT commit — review `git status` and commit after a real run.",
].join("\n");

function flagNum(args: string[], name: string): number | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) ? n : undefined;
}

/** The actual outcome of a real run — what landed (for an honest summary) and
 *  what failed (so the operator is never told a swallowed error succeeded). */
interface ExecOutcome {
  /** Per-card ops that ACTUALLY executed — summarized for the report. */
  applied: CardMigratePlan[];
  /** Human-readable failure lines (each already written to stderr). */
  failures: string[];
}

function printOps(plan: ArchiveMigratePlan): void {
  for (const card of plan.cards) {
    process.stdout.write(`\n  ${card.storyId}  →  ${card.cardDir}\n`);
    for (const op of card.ops) {
      if (op.kind === "mv") process.stdout.write(`    mv      ${op.src}  →  ${op.dst}\n`);
      else if (op.kind === "gc-rm") process.stdout.write(`    gc-rm   ${op.path}\n`);
      else if (op.kind === "symlink") process.stdout.write(`    latest  ${op.link}  →  ${op.target}\n`);
      else if (op.kind === "rmdir") process.stdout.write(`    rmdir   ${op.path}\n`);
    }
  }
  for (const name of plan.exempt) {
    process.stdout.write(`\n  (exempt, left in place) .roll/verification/${name}\n`);
  }
  for (const c of plan.conflicts) {
    process.stderr.write(`\n  ⚠ conflict (${c.storyId}): ${c.path}\n    ${c.reason}\n`);
  }
}

/** One-glance tally line. `summaryOf` is the plan (dry-run) or the applied ops
 *  (real run) — the real run summarizes what ACTUALLY landed, never the plan. */
function printSummary(plan: ArchiveMigratePlan, summaryOf: ArchiveMigratePlan, dryRun: boolean): void {
  const s = summarizePlan(summaryOf);
  process.stdout.write(
    `\n  ${dryRun ? "would migrate" : "migrated"}: ${s.cards} card(s), ${s.runsMoved} run(s), ` +
      `${s.reportsRenamed} report(s) renamed, ${s.cardFilesMoved} card file(s), ` +
      `${s.latestRebuilt} latest rebuilt, ${s.gcDeleted} run(s) GC-pre-cleaned\n`,
  );
  process.stdout.write(
    `  ${dryRun ? "将迁移" : "已迁移"}：${s.cards} 张卡，${s.runsMoved} 个 run，` +
      `${s.reportsRenamed} 份报告改名，${s.cardFilesMoved} 个卡级文件，` +
      `${s.latestRebuilt} 个 latest 重建，${s.gcDeleted} 个 run 预清理\n`,
  );
  if (plan.conflicts.length > 0) {
    process.stdout.write(
      `\n  ⚠ ${plan.conflicts.length} conflict(s) left for manual review — see stderr\n` +
        `  ⚠ ${plan.conflicts.length} 处冲突待人工核对（见 stderr）\n`,
    );
  }
  if (dryRun && summarizePlan(plan).totalOps > 0) {
    process.stdout.write("\n  run without --dry-run to execute\n  去掉 --dry-run 执行迁移\n");
  }
}

function execPlan(plan: ArchiveMigratePlan, projectPath: string): ExecOutcome {
  const meta = metaRepo(projectPath);
  const applied: CardMigratePlan[] = [];
  const failures: string[] = [];
  for (const card of plan.cards) {
    const done: typeof card.ops = [];
    for (const op of card.ops) {
      if (op.kind === "mv") {
        const srcAbs = join(projectPath, op.src);
        const dstAbs = join(projectPath, op.dst);
        if (!existsSync(srcAbs) || existsSync(dstAbs)) continue; // idempotent re-run
        mkdirSync(dirname(dstAbs), { recursive: true });
        const r = git(["mv", meta.rel(op.src), meta.rel(op.dst)], meta.gitCwd);
        if (r.status !== 0) {
          // FIX-215: never swallow — record the failure (it counts toward the
          // non-zero exit) and surface it; keep going so the report lists all.
          const line = `[roll] git mv failed: ${op.src} → ${op.dst}`;
          process.stderr.write(`${line}\n${r.stderr}`);
          failures.push(line);
          continue;
        }
        done.push(op);
      } else if (op.kind === "gc-rm") {
        const abs = join(projectPath, op.path);
        if (!existsSync(abs)) continue;
        // Prefer a staged git removal; fall back to a plain unlink for untracked.
        if (git(["rm", "-r", "-q", "-f", "--", meta.rel(op.path)], meta.gitCwd).status !== 0) {
          rmSync(abs, { recursive: true, force: true });
        }
        done.push(op);
      } else if (op.kind === "symlink") {
        const linkAbs = join(projectPath, op.link);
        mkdirSync(dirname(linkAbs), { recursive: true });
        rmSync(linkAbs, { force: true });
        symlinkSync(op.target, linkAbs);
        git(["add", "--", meta.rel(op.link)], meta.gitCwd); // best-effort staging
        done.push(op);
      } else if (op.kind === "rmdir") {
        const abs = join(projectPath, op.path);
        let entries: string[];
        try {
          entries = readdirSync(abs);
        } catch {
          continue; // already gone
        }
        // Drop the now-dangling legacy `latest` symlink (its target moved away,
        // so existsSync would lie — detect it by name, remove with force).
        if (entries.includes("latest")) {
          const stale = join(op.path, "latest");
          if (git(["rm", "-q", "-f", "--", meta.rel(stale)], meta.gitCwd).status !== 0) {
            rmSync(join(projectPath, stale), { force: true });
          }
        }
        try {
          if (readdirSync(abs).length === 0) rmSync(abs, { recursive: true, force: true });
        } catch {
          /* non-empty / unreadable: leave it for the next run */
        }
        done.push(op);
      }
    }
    if (done.length > 0) applied.push({ ...card, ops: done });
  }
  return { applied, failures };
}

/** `roll archive migrate [--dry-run] [--keep-latest N] [--keep-days M]` */
export function archiveMigrateCommand(args: string[], deps: { now?: () => Date } = {}): number {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  const dryRun = args.includes("--dry-run") || args.includes("-n");
  const keepLatest = flagNum(args, "--keep-latest") ?? ARCHIVE_GC_DEFAULT_KEEP_LATEST;
  const keepDays =
    flagNum(args, "--keep-days") ??
    resolveKeepDays(process.env.ROLL_LOOP_GC_RETENTION_DAYS, undefined) ??
    ARCHIVE_GC_DEFAULT_KEEP_DAYS;
  const nowSec = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
  const projectPath = process.cwd();

  const plan = buildArchiveMigratePlan(projectPath, { keepLatest, keepDays, nowSec });
  const head = dryRun
    ? "roll archive migrate (dry-run)\nroll archive migrate（预演）"
    : "roll archive migrate\nroll archive migrate（档案迁移）";
  process.stdout.write(head + "\n");
  printOps(plan);

  if (dryRun) {
    printSummary(plan, plan, true);
    return 0;
  }

  // Real run: report what ACTUALLY landed (not the plan), and fail loudly if
  // any move was swallowed by a wrong-repo / missing-repo git error (FIX-215).
  const outcome = execPlan(plan, projectPath);
  printSummary(plan, { cards: outcome.applied, exempt: [], conflicts: plan.conflicts }, false);
  if (outcome.failures.length > 0) {
    process.stdout.write(
      `\n  ✗ ${outcome.failures.length} operation(s) failed — migration incomplete (see stderr)\n` +
        `  ✗ ${outcome.failures.length} 个操作失败——迁移未完成（见 stderr）\n`,
    );
    return 1;
  }
  return 0;
}
