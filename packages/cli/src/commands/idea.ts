/**
 * `roll idea <description>` — fast backlog capture (US-PORT-003, TS port).
 *
 * v2 had no `roll idea` command: capture lived in the roll-idea skill (an agent
 * editing `.roll/backlog.md`). This port makes capture deterministic and shares
 * the backlog reader/writer with the rest of v3 (与 backlog 存取同源):
 *
 *  1. 分类 — classify the text as a bug (→ FIX) or an idea (→ IDEA).
 *  2. 自动编号 — assign the next id in that family (max numeric suffix + 1).
 *  3. 过 lint 规则 — the description must clear the SAME backlog linter the
 *     toolchain enforces (≤120 chars, no code fence / filename / path / function
 *     name). A violation is reported and the row is NOT written — the backlog
 *     never gains a card that fails lint.
 *  4. 存取同源 — read + atomic optimistic write both go through `BacklogStore`;
 *     the row lands in the kind's section (🐛 Bug Fixes / 💡 Ideas, created if
 *     absent).
 *
 * Output follows the resolved locale (single-language).
 */
import { existsSync } from "node:fs";
import { BacklogStore, ConflictError, IDEA_SECTIONS, appendIdea, planIdea } from "@roll/core";
import { type Lang, resolveLang, t, v2Catalog, v3Catalog } from "@roll/spec";
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
  return 0;
}
