/**
 * `roll idea <description>` — THE single user-facing card-capture entry point
 * (US-PORT-003 + REFACTOR-050 card-creation unification).
 *
 * Before REFACTOR-050, `roll story new` and `roll idea` were two overlapping
 * "add a card" verbs — idea handled fast capture to backlog, story new handled
 * explicit card-folder minting. REFACTOR-050 unifies them: `roll idea` is now
 * the one user-facing entry that does EVERYTHING:
 *
 *  1. 分类 — classify the text as a bug (→ FIX) or an idea (→ IDEA).
 *  2. 自动编号 — assign the next id in that family (max numeric suffix + 1).
 *  3. 过 lint 规则 — the description must clear the SAME backlog linter the
 *     toolchain enforces (≤120 chars, no code fence / filename / path / function
 *     name). A violation is reported and the row is NOT written.
 *  4. 存取同源 — read + atomic optimistic write both go through `BacklogStore`.
 *  5. 推断 epic — light keyword-matching maps the description to a known epic
 *     slug; falls back to "uncategorized" (AC3).
 *  6. 建完整卡 — creates the full card folder (spec.md + index.html) just like
 *     `story new` did (AC1).
 *  7. 刷新索引 — rebuilds .roll/index.json and dossier aggregate pages so the
 *     new card appears immediately (FIX-231).
 *
 * `roll story new` is retained as an internal/advanced explicit channel (AC2)
 * but is no longer co-advertised as a user entry point.
 *
 * Output follows the resolved locale (single-language).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BacklogStore, ConflictError, IDEA_SECTIONS, appendIdea, inferEpic, planIdea } from "@roll/core";
import { type Lang, resolveLang, t, v2Catalog, v3Catalog } from "@roll/spec";
import { generateIndex } from "../lib/archive.js";
import { UNCATEGORIZED } from "../lib/archive.js";
import { renderSpecMd, renderStoryPage } from "../lib/story-page.js";
import { refreshAggregates } from "./index-gen.js";
import { c, renderState } from "../render.js";

const BACKLOG_PATH = ".roll/backlog.md";

/** Locale label, single-language: v3 keys fall back to v2 keys then the key. */
function label(lang: Lang, key: string, ...args: ReadonlyArray<string | number>): string {
  if (v3Catalog[key] !== undefined) return t(v3Catalog, lang, key, ...args);
  return t(v2Catalog, lang, key, ...args);
}

export function ideaCommand(args: string[]): number {
  const noColor =
    args.includes("--no-color") || !process.stdout.isTTY || (process.env["NO_COLOR"] ?? "") !== "";
  renderState.useColor = !noColor;
  const lang = resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${label(lang, "ideav3.usage")}\n`);
    return 0;
  }

  const text = args.filter((a) => !a.startsWith("-")).join(" ").trim();
  if (text === "") {
    process.stderr.write(`${label(lang, "ideav3.empty")}\n${label(lang, "ideav3.usage")}\n`);
    return 1;
  }

  const RED = noColor ? "" : "\x1b[0;31m";
  const NC = noColor ? "" : "\x1b[0m";
  if (!existsSync(BACKLOG_PATH)) {
    process.stderr.write(
      `${RED}[roll]${NC} ${t(v2Catalog, lang, "backlog.roll_backlog_md_not_found_run")}\n`,
    );
    return 1;
  }

  const store = new BacklogStore();
  const snap = store.readBacklog(BACKLOG_PATH);
  const plan = planIdea(snap.items, text);

  if (plan.violations.length > 0) {
    process.stderr.write(
      `${c("amber", "✗ " + label(lang, "ideav3.lint_failed", plan.violations.join(", ")))}\n`,
    );
    process.stderr.write(`  ${c("dim", label(lang, "ideav3.lint_hint"))}\n`);
    return 1;
  }

  try {
    store.writeBacklog(BACKLOG_PATH, snap.hash, (content) =>
      appendIdea(content, plan.id, plan.kind, text).content,
    );
  } catch (e) {
    // The optimistic-write guard fired: the backlog changed between read and
    // write. Emit a clean localized message instead of a raw stack trace.
    if (e instanceof ConflictError) {
      process.stderr.write(`${RED}[roll]${NC} ${label(lang, "ideav3.conflict")}\n`);
      return 1;
    }
    throw e;
  }

  const kindLabel = label(lang, plan.kind === "bug" ? "ideav3.kind_bug" : "ideav3.kind_idea");
  const section = IDEA_SECTIONS[plan.kind].replace(/^#+\s*/, "");
  process.stdout.write(`\n${c("green", "📝 " + label(lang, "ideav3.recorded", plan.id))}\n\n`);
  process.stdout.write(`  ${c("dim", label(lang, "ideav3.type") + ":")}    ${kindLabel}\n`);
  process.stdout.write(`  ${c("dim", label(lang, "ideav3.section") + ":")} ${section}\n`);
  process.stdout.write(`  ${c("dim", label(lang, "ideav3.text") + ":")}    ${text}\n\n`);

  // REFACTOR-050 AC1/AC3: create the full story card folder, same as `story new`.
  // Epic is inferred from the description text; falls back to "uncategorized".
  const epic = inferEpic(text) ?? UNCATEGORIZED;
  const projectPath = process.cwd();
  const cardDir = join(projectPath, ".roll", "features", epic, plan.id);
  try {
    // Never overwrite an existing spec (cards are born once, same guard as `story new`).
    if (existsSync(join(cardDir, "spec.md"))) {
      process.stdout.write(
        `${c("dim", label(lang, "ideav3.card_exists", epic, plan.id))}\n`,
      );
    } else {
      mkdirSync(cardDir, { recursive: true });
      const card = {
        id: plan.id,
        title: text,
        type: plan.kind,
        epic: epic !== UNCATEGORIZED ? epic : undefined,
        created: new Date().toISOString().slice(0, 10),
      };
      writeFileSync(join(cardDir, "spec.md"), renderSpecMd(card), "utf8");
      writeFileSync(join(cardDir, "index.html"), renderStoryPage(card), "utf8");
      process.stdout.write(
        `  ${c("dim", label(lang, "ideav3.card_created", epic))}\n`,
      );
    }
  } catch {
    /* best-effort: folder creation is non-blocking */
  }

  // FIX-231: a new card changes the board's truth — refresh index and dossier
  // aggregate pages so it appears on the front page immediately.
  try {
    generateIndex(projectPath);
    refreshAggregates(projectPath);
  } catch {
    /* index refresh is best-effort; attest re-derives via live walk */
  }

  return 0;
}
