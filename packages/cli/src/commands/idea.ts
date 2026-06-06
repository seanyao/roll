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
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

  // US-META-005: create story folder skeleton on card creation.
  const projectPath = process.cwd();
  const cardDir = join(projectPath, ".roll", "features", "uncategorized", plan.id);
  try {
    mkdirSync(cardDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const specMd =
      `---\n` +
      `id: ${plan.id}\n` +
      `title: ${text}\n` +
      `type: ${plan.kind}\n` +
      `created: ${today}\n` +
      `---\n\n` +
      `# ${plan.id} — ${text}\n`;
    writeFileSync(join(cardDir, "spec.md"), specMd, "utf8");

    const indexHtml =
      `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
      `<title>${plan.id} — ${text.replace(/"/g, "&quot;")}</title>\n` +
      `<style>\n` +
      `:root { color-scheme: light dark; --fg:#1f2328; --bg:#ffffff; --muted:#57606a; --line:#d0d7de; }\n` +
      `@media (prefers-color-scheme: dark) { :root { --fg:#e6edf3; --bg:#0d1117; --muted:#8b949e; --line:#30363d; } }\n` +
      `body { margin:0 auto; max-width:880px; padding:32px 20px 80px; background:var(--bg); color:var(--fg);\n` +
      `  font:15px/1.65 -apple-system, "PingFang SC", "Segoe UI", sans-serif; }\n` +
      `h1 { font-size:22px; } h2 { font-size:18px; border-bottom:1px solid var(--line); padding-bottom:6px; }\n` +
      `code { background:rgba(127,127,127,.12); padding:1px 6px; border-radius:6px; font-size:.92em; }\n` +
      `pre { background:rgba(127,127,127,.08); padding:12px; border-radius:8px; overflow-x:auto; }\n` +
      `section { border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin:14px 0; }\n` +
      `.empty { color:var(--muted); font-style:italic; }\n` +
      `footer { color:var(--muted); font-size:13px; margin-top:36px; border-top:1px solid var(--line); padding-top:12px; }\n` +
      `.phase-done { border-left:4px solid #2da44e; } .phase-pending { border-left:4px solid #d0d7de; }\n` +
      `@media print { body { max-width:none; padding:0; } section { break-inside:avoid; } }\n` +
      `</style>\n` +
      `</head>\n<body>\n` +
      `<h1>${plan.id}</h1>\n` +
      `<p class="meta"><code>${plan.kind === "bug" ? "FIX" : "IDEA"}</code> · Created ${today}</p>\n` +
      `<p>${text.replace(/"/g, "&quot;")}</p>\n` +
      `<section class="phase-pending"><h2>Design</h2><p class="empty">Not yet started</p></section>\n` +
      `<section class="phase-pending"><h2>Execution</h2><p class="empty">No cycles yet</p></section>\n` +
      `<section class="phase-pending"><h2>Delivery</h2><p class="empty">Not yet delivered</p></section>\n` +
      `<section class="phase-pending"><h2>Retrospective</h2><p class="empty">Not yet written</p></section>\n` +
      `<footer>Roll · <a href="spec.md">spec.md</a></footer>\n</body>\n</html>\n`;
    writeFileSync(join(cardDir, "index.html"), indexHtml, "utf8");
  } catch {
    /* best-effort: folder creation is non-blocking */
  }

  return 0;
}
