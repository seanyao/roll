/**
 * `roll release` — read-only release guidance (US-PORT-004, TS port).
 *
 * v2 had no `roll release` subcommand: the maintainer flow lived in the private
 * ops wrapper (`roll-meta/ops/roll-release` → release.sh) and the dashboard only
 * hinted "run: roll release". This native command makes the guidance first-class
 * and deterministic:
 *
 *  1. 版本号引导 — compute the next calver version (`<major>.<MMDD>.<seq>`) from
 *     package.json (the single source of truth, FIX-202) and today's date.
 *  2. changelog — surface whether `## Unreleased` has releasable content, and
 *     point at `roll changelog generate --write` when it does not.
 *  3. PR 与 tag 流程提示 — print the ordered commands the maintainer runs: bump,
 *     commit + PR, merge, then tag + push (which fires the release workflow).
 *  4. 发版闸已在 CI — note that release.yml's consistency-gate runs on tag push
 *     and aborts on any gap; offer `roll consistency check` for a local preview.
 *
 * AUTOMATION SCOPE (deliberate): `roll release` is READ-ONLY. It never bumps
 * package.json, commits, opens a PR, tags, or publishes — those stay manual and
 * require the maintainer's 2FA. This mirrors the loop's hard rule: a release is
 * always a human decision, never autonomous. The command's whole job is to tell
 * the human exactly what to run.
 *
 * Output follows the resolved locale (single-language, never mixed).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ReleaseDate, planRelease } from "@roll/core";
import { type Lang, resolveLang, t, v2Catalog, v3Catalog } from "@roll/spec";
import { c, renderState } from "../render.js";

/** Locale label, single-language: v3 keys fall back to v2 keys then the key. */
function label(lang: Lang, key: string, ...args: ReadonlyArray<string | number>): string {
  if (v3Catalog[key] !== undefined) return t(v3Catalog, lang, key, ...args);
  return t(v2Catalog, lang, key, ...args);
}

/** Today's release date from a Date (1-based month). */
function dateOf(d: Date): ReleaseDate {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/** Read the `version` field from `<cwd>/package.json`, or "" if unavailable. */
function currentVersion(cwd: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "";
  } catch {
    return "";
  }
}

/**
 * True when CHANGELOG.md has at least one bullet under `## Unreleased` — i.e.
 * there is something to release. An absent file or an empty section → false.
 */
function changelogReady(cwd: string): boolean {
  const path = join(cwd, "CHANGELOG.md");
  if (!existsSync(path)) return false;
  const text = readFileSync(path, "utf8");
  const idx = text.indexOf("## Unreleased");
  if (idx === -1) return false;
  // The Unreleased section runs from its heading to the next `## ` heading (or EOF).
  let section = text.slice(idx + "## Unreleased".length);
  const nextHeading = section.search(/\n## /);
  if (nextHeading !== -1) section = section.slice(0, nextHeading);
  return /^\s*-\s+\S/m.test(section);
}

export function releaseCommand(args: string[], now?: ReleaseDate): number {
  const noColor =
    args.includes("--no-color") || !process.stdout.isTTY || (process.env["NO_COLOR"] ?? "") !== "";
  renderState.useColor = !noColor;
  const lang = resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${label(lang, "releasev3.usage")}\n`);
    return 0;
  }

  const cwd = process.cwd();
  const cur = currentVersion(cwd);
  if (cur === "") {
    process.stderr.write(`${c("amber", "✗ " + label(lang, "releasev3.no_pkg"))}\n`);
    return 1;
  }

  const ready = changelogReady(cwd);
  const plan = planRelease({
    currentVersion: cur,
    date: now ?? dateOf(new Date()),
    changelogReady: ready,
  });

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return 0;
  }

  const clState = ready ? label(lang, "releasev3.changelog_ready") : label(lang, "releasev3.changelog_empty");
  const clMark = ready ? c("green", "✓") : c("amber", "•");

  const lines: string[] = [];
  lines.push("");
  lines.push(c("fg", "🚀 " + label(lang, "releasev3.title"), { bold: true }));
  lines.push("");
  lines.push(`  ${c("dim", label(lang, "releasev3.current") + ":")}  ${plan.currentVersion}`);
  lines.push(`  ${c("dim", label(lang, "releasev3.next") + ":")}   ${c("green", plan.nextVersion)}`);
  lines.push(`  ${c("dim", label(lang, "releasev3.tag") + ":")}    ${plan.tag}`);
  lines.push(`  ${c("dim", label(lang, "releasev3.changelog") + ":")}  ${clMark} ${clState}`);
  lines.push("");
  lines.push(`  ${label(lang, "releasev3.flow_title")}`);
  lines.push(`    1. ${label(lang, "releasev3.step_bump", plan.nextVersion)}`);
  lines.push(`    2. ${label(lang, "releasev3.step_commit")}`);
  lines.push(`    3. ${label(lang, "releasev3.step_merge")}`);
  lines.push(`    4. ${label(lang, "releasev3.step_tag", plan.tag)}`);
  lines.push("");
  lines.push(`  ${c("dim", label(lang, "releasev3.gate_note"))}`);
  lines.push(`  ${c("dim", label(lang, "releasev3.gate_preview"))}`);
  lines.push("");
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}
