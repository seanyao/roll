/**
 * `roll slides` — TS port of bin/roll cmd_slides dispatcher + the deterministic
 * leaf commands (build / list / preview / logs / templates / delete / help).
 * The renderer + validator are reimplemented natively (./render, ./validate),
 * so `build` runs end-to-end in TS with output byte-identical to the python
 * oracle (validate → resolve template → render → write HTML → ensure gitignore).
 *
 * Oracle line ranges (bin/roll):
 *   _slides_help                4745-4780
 *   _slides_lib / template_path 4783-4822
 *   _slides_ensure_gitignore    4826-4837
 *   _slides_open_cmd            4841-4847
 *   cmd_slides_build            4849-4972
 *   _slides_frontmatter_field   4977-4991  (awk frontmatter scan)
 *   _slides_human_size          4995-5006
 *   cmd_slides_list             5008-5087
 *   cmd_slides_preview          5089-5131
 *   cmd_slides_logs             5134-5171
 *   cmd_slides_delete           5174-5224
 *   cmd_slides_templates        5227-5279
 *   _slides_topic_slug          5286-5294
 *   cmd_slides_new              5302-5458
 *   cmd_slides (dispatch)       6183-6222
 *
 * `new` (US-PORT-016, owner ruling): the TS layer TAKES OVER the launch —
 * resolve the project agent, compose the roll-deck authoring prompt, spawn the
 * agent (stdio inherit) to write deck.md, then build unless --no-build. The v2
 * progress spinner / background file-watch was UX theatre around the launch and
 * is intentionally not ported. `delete`'s interactive y/N confirm is likewise
 * native TS now (shared tty-confirm, FIX-229 blocking /dev/tty read). No
 * `roll slides` subcommand falls back to bash any more.
 *
 * BROWSER: `open`/`xdg-open` auto-launch is suppressed in tests via the same
 * triggers the oracle honours (BATS_TEST_NUMBER / ROLL_SLIDES_NO_OPEN), and the
 * difftests set ROLL_SLIDES_NO_OPEN so no real browser ever launches.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { resolveLang, t, v2Catalog, type Lang } from "@roll/spec";
import { confirmYesNo } from "../../lib/tty-confirm.js";
import { projectAgent } from "../agent-list.js";
import { readSkillBody } from "../../runner/skill-body.js";
import { onPath, rollPkgDir } from "../setup-shared.js";
import { renderDeck, ValueError } from "./render.js";
import { validateDeckFile } from "./validate.js";

// ─── bash UI helpers (bin/roll:41-56) ────────────────────────────────────────
interface Pal {
  RED: string;
  GREEN: string;
  YELLOW: string;
  CYAN: string;
  NC: string;
}
function pal(): Pal {
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
  const { CYAN, NC } = pal();
  process.stdout.write(`${CYAN}[roll]${NC} ${line}\n`);
}
function ok(line: string): void {
  const { GREEN, NC } = pal();
  process.stdout.write(`${GREEN}[roll]${NC} ${line}\n`);
}
function err(line: string): void {
  const { RED, NC } = pal();
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

// ─── help (4745-4780) ─────────────────────────────────────────────────────────
const SLIDES_HELP = `roll slides — deck.md → HTML rendering
roll slides — 幻灯片 deck.md 渲染管线

USAGE  用法
  roll slides build <slug> [--no-open]
                          Render .roll/slides/<slug>/deck.md → .roll/slides/<slug>.html
                          渲染 deck.md 为 HTML 并自动打开浏览器
  roll slides new "<topic>" [--template <name>] [--no-build]
                          Generate deck.md via AI, then auto-build + open HTML
                          通过 AI 生成 deck.md，自动渲染并打开 HTML
  roll slides list        List all decks (built / stale / failed / unbuilt)
                          列出 .roll/slides/ 下所有幻灯片（四态）
  roll slides preview <slug> [--no-open]
                          Open .roll/slides/<slug>.html in the default browser
                          在浏览器中打开已渲染的幻灯片
  roll slides logs <slug> Show the last build failure log for a deck
                          显示幻灯片上次构建失败日志
  roll slides templates   List available slide templates (built-in + project)
                          列出可用模板（内置 + 项目自定义）
  roll slides delete <slug> [--force]
                          Delete a deck (dir + HTML) with confirmation prompt
                          删除幻灯片（含目录与 HTML），需确认

OPTIONS  选项
  --no-open               Skip auto-opening the rendered HTML in a browser
                          渲染后不自动打开浏览器
  --no-build              Skip auto-build after agent completes (deck.md only)
                          仅生成 deck.md，不自动渲染
  --force                 Skip confirmation prompt (delete subcommand)
                          跳过确认提示（delete 子命令）
  --help, -h              Show this help
                          显示本帮助
`;
function slidesHelp(out: (s: string) => void): void {
  out(SLIDES_HELP);
}

// ─── path helpers ─────────────────────────────────────────────────────────────
function slidesLib(): string {
  return join(rollPkgDir(), "lib");
}

/** _slides_template_path (4789): project override wins, then builtin. */
function slidesTemplatePath(name: string): string | null {
  const projTpl = join(".roll", "slides", "templates", `${name}.html`);
  if (isFile(projTpl)) return projTpl;
  const tpl = join(rollPkgDir(), "lib", "slides", "templates", `${name}.html`);
  if (isFile(tpl)) return tpl;
  return null;
}

/** _slides_template_for_deck (4808): read `template:` from frontmatter; default
 * introduction-v3. Mirrors the awk that stops at the closing `---`. */
function slidesTemplateForDeck(deckPath: string): string {
  let tpl = "";
  try {
    const src = readFileSync(deckPath, "utf8");
    let d = 0;
    for (const line of src.split("\n")) {
      if (/^---[ \t]*$/.test(line)) {
        d += 1;
        if (d === 2) break;
        continue;
      }
      if (d === 1) {
        const mm = /^template:[ \t]*/.exec(line);
        if (mm) {
          let v = line.slice(mm[0].length);
          v = v.replace(/^["']|["']$/g, "");
          tpl = v;
          break;
        }
      }
    }
  } catch {
    /* awk 2>/dev/null fail-soft */
  }
  if (!tpl) tpl = "introduction-v3";
  return tpl;
}

/** _slides_ensure_gitignore (4826): idempotently append `slides/*.html`. */
function slidesEnsureGitignore(): void {
  const gi = join(".roll", ".gitignore");
  mkdirSync(".roll", { recursive: true });
  if (isFile(gi)) {
    const content = readFileSync(gi, "utf8");
    if (content.split("\n").some((l) => /^slides\/\*\.html$/.test(l))) return;
    if (content.length > 0 && !content.endsWith("\n")) {
      writeFileSync(gi, content + "\n");
    }
  }
  appendFile(gi, "slides/*.html\n");
}

function appendFile(path: string, data: string): void {
  const prev = isFile(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, prev + data);
}

/** _slides_open_cmd (4841): Darwin→open, Linux→xdg-open; else null. */
function slidesOpenCmd(): string | null {
  const sys = spawnSync("uname", ["-s"], { encoding: "utf8" });
  const os = (sys.stdout ?? "").trim();
  if (os === "Darwin" && onPath("open")) return "open";
  if (os === "Linux" && onPath("xdg-open")) return "xdg-open";
  return null;
}

function shouldOpen(noOpen: boolean): boolean {
  if (noOpen) return false;
  if ((process.env["BATS_TEST_NUMBER"] ?? "") !== "") return false;
  if ((process.env["ROLL_SLIDES_NO_OPEN"] ?? "") !== "") return false;
  return true;
}

function launchOpen(target: string): void {
  const opener = slidesOpenCmd();
  if (opener) {
    spawnSync(opener, [target], { stdio: "ignore" });
  }
}

// ─── utc timestamp (date -u +"%Y-%m-%dT%H:%M:%SZ") ───────────────────────────
function utcTs(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ─── build (4849) ─────────────────────────────────────────────────────────────
function cmdBuild(args: string[]): number {
  let slug = "";
  let noOpen = false;
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (a === "--no-open") {
      noOpen = true;
      i += 1;
    } else if (a === "--help" || a === "-h") {
      slidesHelp((s) => process.stdout.write(s));
      return 0;
    } else if (a.startsWith("--")) {
      err(m("slides_build.unknown_option_1"));
      return 1;
    } else {
      if (slug === "") {
        slug = a;
        i += 1;
      } else {
        err(m("slides_build.unexpected_argument_1"));
        return 1;
      }
    }
  }

  if (slug === "") {
    err("Usage: roll slides build <slug> [--no-open]");
    process.stderr.write(m("slides_build.usage_roll_slides_build_slug_no") + "\n");
    return 1;
  }

  const deck = join(".roll", "slides", slug, "deck.md");
  if (!isFile(deck)) {
    err(`Deck not found: ${deck}`);
    process.stderr.write(m("slides_build.en_deck", deck) + "\n");
    process.stderr.write("  Hint: run 'roll slides new \"<topic>\"' to generate a new deck.\n");
    process.stderr.write(m("slides_build.en_roll_slides_new") + "\n");
    return 1;
  }

  const libDir = slidesLib();
  const validator = join(libDir, "slides-validate.py");
  const renderer = join(libDir, "slides-render.py");
  if (!isFile(validator) || !isFile(renderer)) {
    err(m("slides_build.slides_toolchain_missing_re_run_roll"));
    return 1;
  }

  const errFile = join(".roll", "slides", slug, ".last-build.err");
  const componentsDir = join(libDir, "slides", "components");

  // 1. Validate (native). Capture stderr-equivalent lines as a combined block
  //    (the bash oracle captures `python3 validator 2>&1`).
  const valLines: string[] = [];
  const valExit = validateDeckFile(deck, (l) => valLines.push(l), componentsDir);
  const valOut = valLines.join("\n");
  if (valExit === 2) {
    process.stderr.write(`[roll] ${valOut}\n`);
  } else if (valExit !== 0) {
    const ts = utcTs();
    mkdirSync(join(".roll", "slides", slug), { recursive: true });
    writeFileSync(errFile, `[${ts}] stage=validate\n${valOut}\n`);
    if (valOut !== "") process.stderr.write(valOut + "\n");
    else process.stderr.write("\n");
    const { RED, NC } = pal();
    process.stderr.write(`${RED}[FAIL]${NC} ${m("slides_build.validation_failed_for", deck)}\n`);
    process.stderr.write("  " + m("slides_build.hint_fix_and_rerun", deck, slug) + "\n");
    return 1;
  }

  // 2. Resolve template + render.
  const tplName = slidesTemplateForDeck(deck);
  const tplPath = slidesTemplatePath(tplName);
  if (tplPath === null) {
    const ts = utcTs();
    mkdirSync(join(".roll", "slides", slug), { recursive: true });
    writeFileSync(errFile, `[${ts}] stage=template\ntemplate not found: ${tplName}\n`);
    const { RED, NC } = pal();
    process.stderr.write(`${RED}[FAIL]${NC} ${m("slides_build.template_not_found", tplName)}\n`);
    process.stderr.write("  " + m("slides_build.available_templates") + "\n");
    const builtinDir = join(rollPkgDir(), "lib", "slides", "templates");
    if (isDir(builtinDir)) {
      for (const t2 of listHtml(builtinDir)) {
        const n = basenameNoHtml(t2);
        process.stderr.write(`    ${padEnd(n, 20)} (builtin)\n`);
      }
    }
    const projDir = join(".roll", "slides", "templates");
    if (isDir(projDir)) {
      for (const t2 of listHtml(projDir)) {
        const n = basenameNoHtml(t2);
        process.stderr.write(`    ${padEnd(n, 20)} (project)\n`);
      }
    }
    process.stderr.write("  " + m("slides_build.templates_list_hint") + "\n");
    return 1;
  }

  const out = join(".roll", "slides", `${slug}.html`);
  mkdirSync(join(".roll", "slides"), { recursive: true });
  let htmlOut: string;
  try {
    const src = readFileSync(deck, "utf8");
    const template = readFileSync(tplPath, "utf8");
    htmlOut = renderDeck(src, template, { componentsDir });
  } catch (e) {
    // python renderer prints "[slides-render] render error: <e>" + zh line to
    // stderr (exit 3); the bash caller captures that as render_out 2>&1.
    const renderOut = renderErrorBlock(e);
    const ts = utcTs();
    mkdirSync(join(".roll", "slides", slug), { recursive: true });
    writeFileSync(errFile, `[${ts}] stage=render\n${renderOut}\n`);
    const { RED, NC } = pal();
    process.stderr.write(`${RED}[FAIL]${NC} ${m("slides_build.renderer_crashed_for", deck)}\n`);
    process.stderr.write("  " + m("slides_build.see_full_error_logs", slug) + "\n");
    const lastLines = tailLines(renderOut, 5);
    if (lastLines !== "") {
      process.stderr.write("  " + m("slides_build.last_5_lines_of_renderer_output") + "\n");
      process.stderr.write(lastLines + "\n");
    }
    return 1;
  }
  writeFileSync(out, htmlOut);

  // build succeeded — remove any stale .last-build.err
  try {
    rmSync(errFile, { force: true });
  } catch {
    /* ignore */
  }

  slidesEnsureGitignore();
  ok(m("slides_build.rendered", out));

  if (!shouldOpen(noOpen)) return 0;
  launchOpen(out);
  return 0;
}

/** Match python's `[slides-render] render error: <e>` + zh line on a render
 * error. Only ValueError/KeyError reach this in the oracle (exit 3). */
function renderErrorBlock(e: unknown): string {
  const msg = e instanceof ValueError ? e.message : (e as Error).message;
  return `[slides-render] render error: ${msg}\n[slides-render] 渲染错误：${msg}`;
}

function tailLines(s: string, n: number): string {
  const lines = s.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-n).join("\n");
}

// ─── frontmatter field scan (4977) ──────────────────────────────────────────
function frontmatterField(deckPath: string, field: string): string {
  try {
    const src = readFileSync(deckPath, "utf8");
    let d = 0;
    const pat = new RegExp("^" + field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[ \t]*:[ \t]*");
    for (const line of src.split("\n")) {
      if (/^---[ \t]*$/.test(line)) {
        d += 1;
        if (d === 2) break;
        continue;
      }
      if (d === 1 && pat.test(line)) {
        let v = line.replace(pat, "");
        v = v.replace(/^["']|["']$/g, "");
        return v;
      }
    }
  } catch {
    /* awk 2>/dev/null fail-soft */
  }
  return "";
}

/** _slides_human_size (4995): integer-only B/K/M formatting. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) {
    const tenth = Math.trunc((bytes * 10) / 1024);
    return `${Math.trunc(tenth / 10)}.${tenth % 10}K`;
  }
  const tenth = Math.trunc((bytes * 10) / 1048576);
  return `${Math.trunc(tenth / 10)}.${tenth % 10}M`;
}

// ─── list (5008) ──────────────────────────────────────────────────────────────
function cmdList(args: string[]): number {
  for (const a of args) {
    if (a === "--help" || a === "-h") {
      slidesHelp((s) => process.stdout.write(s));
      return 0;
    }
    if (a.startsWith("--")) {
      err(m("slides_list.unknown_option_1"));
      return 1;
    }
    err(m("slides_list.unexpected_argument_1"));
    return 1;
  }

  const slidesDir = join(".roll", "slides");
  if (!isDir(slidesDir)) {
    info(m("slides_list.no_decks_found_under_roll_slides"));
    process.stdout.write("  Hint: run 'roll slides new \"<topic>\"' to create one.\n");
    process.stdout.write(m("slides_list.en_roll_slides_new") + "\n");
    return 0;
  }

  const slugs: string[] = [];
  for (const entry of readdirSync(slidesDir)) {
    const d = join(slidesDir, entry);
    if (isDir(d) && isFile(join(d, "deck.md"))) slugs.push(entry);
  }

  if (slugs.length === 0) {
    info(m("slides_list.no_decks_found_under_roll_slides_2"));
    process.stdout.write("  Hint: run 'roll slides new \"<topic>\"' to create one.\n");
    process.stdout.write(m("slides_list.en_roll_slides_new_2") + "\n");
    return 0;
  }

  const sorted = [...slugs].sort();

  process.stdout.write(
    rowSix("slug", "template", "total_slides", "created", "built", "size") + "\n",
  );
  process.stdout.write(
    rowSix("----", "--------", "------------", "-------", "------", "----") + "\n",
  );

  for (const s of sorted) {
    const deck = join(slidesDir, s, "deck.md");
    const html = join(slidesDir, `${s}.html`);
    const errFile = join(slidesDir, s, ".last-build.err");
    let template = frontmatterField(deck, "template");
    if (template === "") template = "-";
    let total = frontmatterField(deck, "total_slides");
    if (total === "") total = "-";
    let created = frontmatterField(deck, "created");
    if (created === "") created = "-";
    let built: string;
    let size: string;
    if (isFile(errFile)) {
      built = "⚠ failed";
      size = "-";
    } else if (isFile(html)) {
      if (isNewer(deck, html)) {
        built = "≈ stale";
        size = "-";
      } else {
        built = "✓ built";
        let bytes = 0;
        try {
          bytes = statSync(html).size;
        } catch {
          bytes = 0;
        }
        size = humanSize(bytes);
      }
    } else {
      built = "✗ unbuilt";
      size = "-";
    }
    process.stdout.write(rowSix(s, template, total, created, built, size) + "\n");
  }
  return 0;
}

/** `[[ deck -nt html ]]`: deck newer than html (strictly greater mtime). */
function isNewer(a: string, b: string): boolean {
  try {
    return statSync(a).mtimeMs > statSync(b).mtimeMs;
  } catch {
    return false;
  }
}

// ─── preview (5089) ─────────────────────────────────────────────────────────
function cmdPreview(args: string[]): number {
  let slug = "";
  let noOpen = false;
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (a === "--no-open") {
      noOpen = true;
      i += 1;
    } else if (a === "--help" || a === "-h") {
      slidesHelp((s) => process.stdout.write(s));
      return 0;
    } else if (a.startsWith("--")) {
      err(m("slides_preview.unknown_option_1"));
      return 1;
    } else {
      if (slug === "") {
        slug = a;
        i += 1;
      } else {
        err(m("slides_preview.unexpected_argument_1"));
        return 1;
      }
    }
  }

  if (slug === "") {
    err("Usage: roll slides preview <slug> [--no-open]");
    process.stderr.write(m("slides_preview.usage_roll_slides_preview_slug_no") + "\n");
    return 1;
  }

  const html = join(".roll", "slides", `${slug}.html`);
  if (!isFile(html)) {
    err(`Rendered HTML not found: ${html}`);
    process.stderr.write(m("slides_preview.en_html", html) + "\n");
    process.stderr.write(`  Hint: run 'roll slides build ${slug}' first to render it.\n`);
    process.stderr.write(m("slides_preview.en_roll_slides_build", slug) + "\n");
    return 1;
  }

  ok(m("slides_preview.preview", html));

  if (!shouldOpen(noOpen)) return 0;
  launchOpen(html);
  return 0;
}

// ─── logs (5134) ──────────────────────────────────────────────────────────────
function cmdLogs(args: string[]): number {
  let slug = "";
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (a === "--help" || a === "-h") {
      slidesHelp((s) => process.stdout.write(s));
      return 0;
    } else if (a.startsWith("--")) {
      err(m("slides_logs.unknown_option_1"));
      return 1;
    } else {
      if (slug === "") {
        slug = a;
        i += 1;
      } else {
        err(m("slides_logs.unexpected_argument_1"));
        return 1;
      }
    }
  }

  if (slug === "") {
    err("Usage: roll slides logs <slug>");
    process.stderr.write(m("slides_logs.usage_roll_slides_logs_slug") + "\n");
    return 1;
  }

  const deckDir = join(".roll", "slides", slug);
  const errFile = join(deckDir, ".last-build.err");

  if (!isDir(deckDir) || !isFile(join(deckDir, "deck.md"))) {
    err(m("slides_logs.deck_not_found", slug));
    return 1;
  }

  if (!isFile(errFile)) {
    info(m("slides_logs.no_failure_records_for", slug));
    return 0;
  }

  process.stdout.write(readFileSync(errFile, "utf8"));
  return 0;
}

// ─── new (5302) ───────────────────────────────────────────────────────────────
// US-PORT-016 (owner ruling): the TS layer TAKES OVER the launch — resolve the
// project agent, compose the roll-deck prompt, spawn the agent to author
// deck.md, then build (unless --no-build). The v2 progress spinner / file-watch
// theatre is intentionally NOT ported — it was UX polish around the launch.

/** _slides_topic_slug (bin/roll): lowercase, non-alnum → single '-', trim '-'. */
export function topicSlug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** text-mode argv per agent (mirrors `_agent_argv <agent> text <prompt>`). */
export function slidesTextArgv(agent: string, prompt: string): { bin: string; args: string[] } | null {
  switch (agent) {
    case "claude":
      return { bin: "claude", args: ["-p", "--output-format", "text", prompt] };
    case "kimi": {
      const bin = onPath("kimi-code") ? "kimi-code" : onPath("kimi-cli") ? "kimi-cli" : "kimi";
      return { bin, args: ["-p", prompt] };
    }
    case "deepseek":
      return { bin: "deepseek", args: [prompt] };
    case "pi":
      return { bin: "pi", args: ["-p", prompt] };
    case "codex":
    case "openai":
      return { bin: "codex", args: ["exec", prompt] };
    case "opencode":
      return { bin: "opencode", args: ["run", prompt] };
    case "qwen":
      return { bin: "qwen", args: [prompt] };
    case "gemini":
    case "agy":
    case "antigravity":
      return { bin: "agy", args: ["-p", "--dangerously-skip-permissions", prompt] };
    default:
      return null;
  }
}

/** Compose the roll-deck authoring prompt (mirrors the v2 heredoc). */
export function composeNewPrompt(
  skillBody: string,
  topic: string,
  slug: string,
  template: string,
): string {
  const target = `.roll/slides/${slug}/deck.md`;
  return (
    `${skillBody}\n\n---\n\n# Task\n\n` +
    `topic: ${topic}\nslug: ${slug}\ntemplate: ${template}\ntarget_file: ${target}\n\n` +
    `Generate the 18-slide bilingual deck.md for the topic above, following the workflow and hard constraints in this skill. Write exactly one file: ${target}. Then print the bilingual "Next" hint.\n\n` +
    `按本 skill 的工作流和硬约束生成 18 张双语 slide 的 deck.md。只写一个文件：${target}，然后打印双语 "Next" 提示。\n`
  );
}

/** Injectable seams so tests never resolve a real skill / spawn a real agent. */
export interface SlidesNewDeps {
  agent: () => string;
  skillBody: () => string | null;
  /** Spawn the agent (stdio inherit), return its exit code. */
  spawn: (bin: string, args: string[]) => number;
  /** Build the deck after authoring (chains cmdBuild); returns exit code. */
  build: (slug: string) => number;
}
function realNewDeps(): SlidesNewDeps {
  return {
    agent: () => projectAgent(),
    skillBody: () => readSkillBody(process.cwd(), { skillName: "roll-deck" }),
    spawn: (bin, args) => spawnSync(bin, args, { stdio: "inherit" }).status ?? 1,
    build: (slug) => cmdBuild([slug]),
  };
}

export function cmdNew(args: string[], deps: SlidesNewDeps = realNewDeps()): number {
  let topic = "";
  let template = "introduction-v3";
  let noBuild = false;
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (a === "--template") {
      if (args[i + 1] === undefined) {
        err(m("slides_new.template_requires_value"));
        return 1;
      }
      template = args[i + 1]!;
      i += 2;
    } else if (a.startsWith("--template=")) {
      template = a.slice("--template=".length);
      i += 1;
    } else if (a === "--quiet") {
      i += 1; // v2 suppressed the spinner; no spinner here, so accept + ignore.
    } else if (a === "--no-build") {
      noBuild = true;
      i += 1;
    } else if (a === "--help" || a === "-h") {
      slidesHelp((s) => process.stdout.write(s));
      return 0;
    } else if (a.startsWith("--")) {
      err(m("slides_new.unknown_option_1"));
      return 1;
    } else if (topic === "") {
      topic = a;
      i += 1;
    } else {
      err(m("slides_new.unexpected_argument_1"));
      return 1;
    }
  }

  if (topic === "") {
    err('Usage: roll slides new "<topic>" [--template <name>] [--quiet] [--no-build]');
    process.stderr.write(m("slides_new.en_roll_slides_new_template") + "\n");
    return 1;
  }

  const slug = topicSlug(topic);
  if (slug === "") {
    err(`Could not derive a slug from topic: ${topic}`);
    process.stderr.write(m("slides_new.en_slug", topic) + "\n");
    return 1;
  }

  const skill = deps.skillBody();
  if (skill === null || skill === "") {
    err(`Skill not found or empty: roll-deck`);
    return 1;
  }

  const agent = deps.agent();
  const argv = slidesTextArgv(agent, composeNewPrompt(skill, topic, slug, template));
  if (argv === null) {
    err(
      `Unknown agent '${agent}'. Run: roll agent use <claude|kimi|deepseek|pi|openai|codex|opencode|qwen|antigravity>`,
    );
    return 1;
  }

  const deckDir = join(".roll", "slides", slug);
  mkdirSync(deckDir, { recursive: true });

  const rc = deps.spawn(argv.bin, argv.args);
  if (rc !== 0) {
    err(`Agent '${agent}' exited ${rc} — deck may be incomplete`);
    return rc;
  }
  if (!existsSync(join(deckDir, "deck.md"))) {
    err(`Agent finished but ${join(deckDir, "deck.md")} was not written`);
    return 1;
  }

  if (!noBuild) return deps.build(slug);
  info(`Next: roll slides build ${slug}`);
  process.stdout.write(`下一步：roll slides build ${slug}\n`);
  return 0;
}

// ─── delete (5174) ────────────────────────────────────────────────────────────
/** Interactive y/N confirm (US-PORT-016): prompt to stderr, read /dev/tty. */
export type DeleteConfirm = (prompt: string) => boolean;
const defaultDeleteConfirm: DeleteConfirm = (prompt) =>
  confirmYesNo(prompt, (s) => process.stderr.write(s));

export function cmdDelete(args: string[], confirm: DeleteConfirm = defaultDeleteConfirm): number {
  let slug = "";
  let force = false;
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (a === "--force") {
      force = true;
      i += 1;
    } else if (a === "--help" || a === "-h") {
      slidesHelp((s) => process.stdout.write(s));
      return 0;
    } else if (a.startsWith("--")) {
      err(m("slides_delete.unknown_option_1"));
      return 1;
    } else {
      if (slug === "") {
        slug = a;
        i += 1;
      } else {
        err(m("slides_delete.unexpected_argument_1"));
        return 1;
      }
    }
  }

  if (slug === "") {
    err("Usage: roll slides delete <slug> [--force]");
    process.stderr.write(m("slides_delete.usage_roll_slides_delete_slug_force") + "\n");
    return 1;
  }

  const deckDir = join(".roll", "slides", slug);
  const html = join(".roll", "slides", `${slug}.html`);

  if (!isDir(deckDir) || !isFile(join(deckDir, "deck.md"))) {
    err(m("slides_delete.deck_not_found", slug));
    return 1;
  }

  if (!force) {
    // Non-TTY must use --force (matches `[[ ! -t 0 ]]`).
    if (!process.stdin.isTTY) {
      err(m("slides_delete.non_interactive_terminal_must_use_force"));
      return 1;
    }
    // US-PORT-016: interactive confirm is now native TS — prompt to stderr and
    // read the answer from /dev/tty (shared tty-confirm; FIX-229 blocking read).
    // No more bash fallback for the live TTY prompt.
    if (!confirm(`${m("slides_delete.prompt", slug)} `)) {
      info(m("slides_delete.cancelled"));
      return 0;
    }
  }

  try {
    rmSync(deckDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    rmSync(html, { force: true });
  } catch {
    /* ignore */
  }
  ok(m("slides_delete.deleted", slug));
  return 0;
}

// ─── templates (5227) ─────────────────────────────────────────────────────────
function cmdTemplates(args: string[]): number {
  for (const a of args) {
    if (a === "--help" || a === "-h") {
      slidesHelp((s) => process.stdout.write(s));
      return 0;
    }
    if (a.startsWith("--")) {
      err(m("slides_templates.unknown_option_1"));
      return 1;
    }
    err(m("slides_templates.unexpected_argument_1"));
    return 1;
  }

  let found = false;
  process.stdout.write(rowThree("name", "source", "path") + "\n");
  process.stdout.write(rowThree("----", "------", "----") + "\n");

  const builtinDir = join(rollPkgDir(), "lib", "slides", "templates");
  if (isDir(builtinDir)) {
    for (const tpl of listHtml(builtinDir)) {
      const name = basenameNoHtml(tpl);
      process.stdout.write(rowThree(name, "builtin", tpl) + "\n");
      found = true;
    }
  }

  const projDir = join(".roll", "slides", "templates");
  if (isDir(projDir)) {
    for (const tpl of listHtml(projDir)) {
      const name = basenameNoHtml(tpl);
      const source = isFile(join(builtinDir, `${name}.html`)) ? "project (override)" : "project";
      process.stdout.write(rowThree(name, source, tpl) + "\n");
      found = true;
    }
  }

  if (!found) info(m("slides_templates.no_templates_found"));
  return 0;
}

// ─── dispatch (6183) ──────────────────────────────────────────────────────────
/**
 * Returns the exit code, or `null` to signal a bash fallback (the `new`
 * subcommand and the interactive `delete` confirm).
 */
export function slidesCommand(args: string[]): number {
  const subcmd = args[0] ?? "";
  const rest = args.slice(1);
  switch (subcmd) {
    case "build":
      return cmdBuild(rest);
    case "new":
      return cmdNew(rest); // US-PORT-016: TS takes over the agent launch.
    case "list":
      return cmdList(rest);
    case "preview":
      return cmdPreview(rest);
    case "logs":
      return cmdLogs(rest);
    case "templates":
      return cmdTemplates(rest);
    case "delete":
      return cmdDelete(rest); // US-PORT-016: interactive confirm is native TS.
    case "--help":
    case "-h":
    case "help":
      slidesHelp((s) => process.stdout.write(s));
      return 0;
    case "":
      slidesHelp((s) => process.stdout.write(s));
      return 1;
    default:
      err(m("slides.unknown_subcommand", subcmd));
      slidesHelp((s) => process.stderr.write(s));
      return 1;
  }
}

// ─── small fs/format helpers ──────────────────────────────────────────────────
function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function listHtml(dir: string): string[] {
  // bash `for t in "$dir"/*.html` expands in shell glob order (sorted) and
  // yields paths as `<dir>/<name>.html`.
  return readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .sort()
    .map((f) => join(dir, f));
}
function basenameNoHtml(path: string): string {
  const b = path.slice(path.lastIndexOf("/") + 1);
  return b.endsWith(".html") ? b.slice(0, -5) : b;
}
/** printf %-Ns: left-justify in a field of N columns. bash `printf` measures
 * the field width in BYTES (not characters), so multibyte glyphs like ✓ / ⚠ /
 * CJK consume their UTF-8 byte count — match that for byte-identical columns. */
function padEnd(s: string, width: number): string {
  const bytes = Buffer.byteLength(s, "utf8");
  return bytes >= width ? s : s + " ".repeat(width - bytes);
}
function rowSix(a: string, b: string, c: string, d: string, e: string, f: string): string {
  return `${padEnd(a, 20)}  ${padEnd(b, 20)}  ${padEnd(c, 12)}  ${padEnd(d, 12)}  ${padEnd(e, 8)}  ${f}`;
}
function rowThree(a: string, b: string, c: string): string {
  return `${padEnd(a, 24)}  ${padEnd(b, 12)}  ${c}`;
}
