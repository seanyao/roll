/**
 * `roll changelog` — TS port of bin/roll cmd_changelog (5655-5708) plus the
 * deterministic draft generator lib/changelog_generate.py (ported in full).
 *
 * Subcommands: generate (default) | --help/-h/help | unknown.
 *
 * generate flags:
 *   --write → write the result into CHANGELOG.md's ## Unreleased section
 *   --json  → machine-readable; passed through to the generator
 *   --no-ai → accepted as a no-op (deterministic output is now the only path)
 *   everything else → forwarded to the generator (--backlog/--changelog paths)
 *
 * AI-STYLE RETIREMENT (US-PORT-005, owner ruling "drop 倾向"):
 * v2's _changelog_ai_style shelled the configured agent (claude/kimi/…) to
 * restyle the draft, and the bash dispatch fell back to bash whenever the
 * default `generate` ran (the only way to shell that agent). That path is now
 * RETIRED: the deterministic draft is the canonical and ONLY output. The
 * default `generate` produces it natively in TS — no agent, no bash fallback,
 * and no warn noise — which also removes the reasoning-leak risk of shelling an
 * agent whose CLI has no final-only mode (see port-or-drop.md "Agent-shelling
 * 输出纪律"). `--no-ai` is kept as an accepted no-op so existing scripts/flags
 * keep working. The deterministic path stays byte-identical to the python
 * oracle (difftested).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolveLang, t, v2Catalog, type Lang } from "@roll/spec";

// ─── log helpers (mirror bin/roll info/warn/err 53-56) ──────────────────────
function palette(): { CYAN: string; YELLOW: string; RED: string; NC: string } {
  const noColor = (process.env["NO_COLOR"] ?? "") !== "";
  return noColor
    ? { CYAN: "", YELLOW: "", RED: "", NC: "" }
    : { CYAN: "\x1b[0;36m", YELLOW: "\x1b[0;33m", RED: "\x1b[0;31m", NC: "\x1b[0m" };
}
function info(line: string): void {
  const p = palette();
  process.stdout.write(`${p.CYAN}[roll]${p.NC} ${line}\n`);
}
function err(line: string): void {
  const p = palette();
  process.stderr.write(`${p.RED}[roll]${p.NC} ${line}\n`);
}
function msgLang(): Lang {
  return resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Deterministic draft generator — full port of lib/changelog_generate.py.
// ═══════════════════════════════════════════════════════════════════════════

const SKIP_PATTERNS: RegExp[] = [
  /test\s+infrastructure|bats\s|fixture|teardown|isolation|CI\s+时序/i,
  /SKILL\.md|prompt\s+内部|schema\s+|contract\s+test|enum\s+强制/i,
  /内部重构|提取函数|变量改名|目录调整|死代码|消重/i,
  /发版脚本自身|release\.sh\s+逻辑|TCR\s+节奏|pre-commit|钩子/i,
  /仅开发者|只开发者|维护者可见|内部可见/i,
];

// (category, [keyword patterns]) — best-effort keyword matching.
const CATEGORIES: Array<[string, string[]]> = [
  ["新功能", ["新增", "添加", "支持", "新命令", "新功能", "引入", "上线"]],
  ["稳定性", ["修复", "崩溃", "卡死", "误报", "泄漏", "竞争", "并发", "死锁", "幽灵"]],
  ["可见性", ["显示", "dashboard", "状态", "可见", "查看", "实时", "弹窗", "日志"]],
  ["自动化流水线", ["PR\\s", "合并", "auto-merge", "loop\\s", "调度", "launchd", "定时"]],
  ["工程和测试", ["测试", "CI\\s", "重构", "提取", "优化", "提速", "并行"]],
];

const CATEGORY_ORDER = ["新功能", "稳定性", "可见性", "自动化流水线", "工程和测试", "其他"];

// Changelog lint rules (inline copy, mirroring the py module constants).
const LINT_BACKTICK_ID = /`[^`]*(_|\(\))[^`]*`/;
const LINT_FILE_SUFFIX = /\.(md|sh|yml|ts|bats)([^A-Za-z0-9]|$)/;
const LINT_INTERNAL_WORD = /(Phase|Step)\s+[0-9]+|Helper|Schema|Fixture|Refactor/;
const LINT_PATH_FRAG = /(^|[^A-Za-z0-9_])(\.roll|docs|bin|tests|scripts)\//;

type Row = { storyId: string; desc: string; source: string };
type Entry = { storyId: string; desc: string; source: string; cat: string };

/**
 * Port of _read_done_stories — PLUS the FIX-196 bare-ID fix (whitelisted
 * divergence from the frozen python oracle): the oracle only recognises the
 * markdown-link form `[FIX-196](…)`, so bare-ID rows (the v3 backlog house
 * style) lose their storyId and are silently DROPPED by the release-tag
 * filter downstream. The TS reader accepts both forms; a lowercase suffix
 * (`FIX-150b`) is part of the ID grammar.
 */
function readDoneStories(text: string): Row[] {
  const rows: Row[] = [];
  const ID = /([A-Z]+(?:-[A-Z0-9]+)*-\d+[a-z]?)/; // US-ATTEST-001 · FIX-196 · FIX-150b · REFACTOR-046
  for (const line of text.split("\n")) {
    if (!line.startsWith("|") || countOccurrences(line, "|") < 4) continue;
    if (!line.includes("✅ Done")) continue;
    const parts = line.split("|");
    if (parts.length < 4) continue;
    const col1 = parts[1] ?? "";
    // Link form wins when present (anchored extraction); else bare form.
    const linked = /\[([^\]]+)\]/.exec(col1);
    const idM = ID.exec(linked ? (linked[1] ?? "") : col1);
    const storyId = idM ? (idM[1] ?? "") : "";
    const desc = (parts[2] ?? "").trim();
    if (!desc || desc.toLowerCase() === "description") continue;
    const source = /US-AUTO|US-LOOP|FIX-|REFACTOR-/.test(storyId) ? "loop" : "";
    rows.push({ storyId, desc, source });
  }
  return rows;
}

function countOccurrences(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

function isInternal(desc: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(desc));
}

/** Port of _clean_description. */
function cleanDescription(input: string): string {
  let desc = input;
  desc = desc.replace(/`?depends-on:[^`|]+`?/g, "");
  desc = desc.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  desc = desc.replace(/\s+/g, " ").trim();
  desc = desc.replace(/^[—-]\s*/, "");
  return desc;
}

function detectCategory(desc: string): string {
  for (const [cat, patterns] of CATEGORIES) {
    for (const pat of patterns) {
      if (new RegExp(pat, "i").test(desc)) return cat;
    }
  }
  return "其他";
}

/** Port of _already_in_changelog. */
const STORY_ID_RE = /\b((?:US|FIX|REFACTOR|BUG|IDEA)-[A-Z0-9]+(?:-[A-Z0-9]+)*-?\d+[a-z]?)\b/g;

/** Story ids already published in a RELEASED (`## v…`) changelog section. Used to
 *  prune them from a regenerated `## Unreleased` (FIX-227): the since-tag window
 *  re-includes a version that was changelogged but never tagged, and the merge
 *  writer only ever adds — so without this, shipped stories accumulate forever. */
function releasedStoryIds(changelogText: string | null): Set<string> {
  const out = new Set<string>();
  if (changelogText === null) return out;
  const firstV = changelogText.search(/^## v/m);
  if (firstV < 0) return out;
  for (const m of changelogText.slice(firstV).matchAll(STORY_ID_RE)) out.add(m[1] as string);
  return out;
}

function alreadyInChangelog(storyId: string, desc: string, changelogText: string | null): boolean {
  if (changelogText === null) return false;
  if (storyId && changelogText.includes(storyId)) return true;
  const stub = desc.slice(0, 20).trim();
  if (stub && changelogText.includes(stub)) return true;
  return false;
}

/** Port of _lint_bullet. */
function lintBullet(bullet: string): string[] {
  const viols: string[] = [];
  const stripped = bullet.replace(/`[^`]*`/g, "");
  if (LINT_BACKTICK_ID.test(bullet)) viols.push("backtick-identifier");
  if (LINT_FILE_SUFFIX.test(stripped)) viols.push("file-suffix");
  if (LINT_INTERNAL_WORD.test(bullet)) viols.push("internal-word");
  if (stripped.trim().length > 50) viols.push("over-length");
  if (LINT_PATH_FRAG.test(stripped)) viols.push("path-fragment");
  return viols;
}

/** Port of _format_bullet. */
function formatBullet(desc: string, source: string, storyId = ""): string {
  const tag = source ? ` \`[${source}]\`` : "";
  const idref = storyId && !desc.includes(storyId) ? `（${storyId}）` : "";
  return `- ${desc}${idref}${tag}`;
}

/** Port of _build_draft. */
function buildDraft(groups: Map<string, Row[]>): string {
  const lines: string[] = ["## Unreleased", ""];
  for (const cat of CATEGORY_ORDER) {
    const g = groups.get(cat);
    if (g === undefined) continue;
    lines.push(`### ${cat}`);
    lines.push("");
    for (const { storyId, desc, source } of g) lines.push(formatBullet(desc, source, storyId));
    lines.push("");
  }
  return lines.join("\n").replace(/\s+$/, "") + "\n";
}

/** Port of _uncarded_to_entries. */
function uncardedToEntries(uncarded: Array<[string, string]>): Entry[] {
  const entries: Entry[] = [];
  for (const [prNum, title] of uncarded) {
    let tt = title.replace(
      /^\s*(Fix|tcr|docs|chore|feat|refactor|perf|test|Story\s+\d+)\s*[:：]\s*/i,
      "",
    );
    const idm = /\b(US-[A-Z]+-\d+|FIX-\d+|REFACTOR-\d+)\b/.exec(title);
    const sid = idm ? (idm[1] ?? `PR#${prNum}`) : `PR#${prNum}`;
    if (idm && idm[1]) {
      tt = tt.replace(new RegExp("\\b" + escapeRegExp(idm[1]) + "\\b\\s*[:：]?\\s*"), "").trim();
    }
    const cleaned = cleanDescription(tt) || tt.trim();
    const cat = detectCategory(cleaned);
    const src = /US-AUTO|US-LOOP|FIX-|REFACTOR-/.test(sid) ? "loop" : "";
    entries.push({ storyId: sid, desc: cleaned, source: src, cat });
  }
  return entries;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── git helpers (port of the subprocess git calls in the py module) ─────────
/**
 * Git probe signature. `null` ≡ the command FAILED (threw); an empty string ≡
 * it ran and produced no output. Keeping those two distinct is the crux of
 * FIX-199 (see SinceTagLog below).
 */
export type GitProbe = (args: string[]) => string | null;

function gitOutput(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function latestReleaseTag(git: GitProbe = gitOutput): string | null {
  const out = git(["describe", "--tags", "--abbrev=0", "--match", "v*"]);
  return out === null ? null : out.trim();
}

/**
 * FIX-199: the since-tag commit log resolved into THREE explicit states.
 *
 * The pre-fix port collapsed all three into `null`, so a TRANSIENT git failure
 * (ref/lock contention while the loop + PR loop run git concurrently during
 * release prep) was indistinguishable from "no release tag yet". The caller
 * then silently swapped the changelog filter from the tag-aware branch to the
 * no-tag dedup branch — the observed `stories_drafted` 17→2 drift, with no
 * signal to tell two consecutive runs apart.
 *
 * Now: a missing tag is `no-tag` (the legitimate first-release dedup path); a
 * present tag whose `git log` succeeds is `ok` (even when the log is empty); a
 * present tag whose probe keeps failing after bounded retries is `error` —
 * surfaced loudly by the caller instead of silently degrading. The bounded
 * retry absorbs the common transient blip so repeat runs stay byte-identical.
 */
export type SinceTagLog =
  | { kind: "no-tag" }
  | { kind: "ok"; log: string }
  | { kind: "error"; tag: string };

/** Port of _commit_log_since_last_release, hardened against transient failure. */
function commitLogSinceLastRelease(git: GitProbe = gitOutput, attempts = 3): SinceTagLog {
  const tag = latestReleaseTag(git);
  if (!tag) return { kind: "no-tag" };
  for (let i = 0; i < attempts; i++) {
    const out = git(["log", `${tag}..HEAD`, "--pretty=format:%s"]);
    if (out !== null) return { kind: "ok", log: out };
  }
  return { kind: "error", tag };
}

function ghAvailable(): boolean {
  try {
    execFileSync("gh", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Port of _merged_prs_since_tag. Returns [prNum, title, commitMsg]. */
function mergedPrsSinceTag(tag: string, git: GitProbe = gitOutput): Array<[string, string, string]> {
  const out = git(["log", `${tag}..HEAD`, "--pretty=format:%H %s"]);
  if (out === null) return [];
  const prs: Array<[string, string, string]> = [];
  const seen = new Set<string>();
  const hasGh = ghAvailable();
  for (const line of out.trim().split("\n")) {
    if (!line) continue;
    const sp = line.indexOf(" ");
    if (sp === -1) continue;
    const subject = line.slice(sp + 1);
    const m = /\(#(\d+)\)/.exec(subject);
    if (!m) continue;
    const prNum = m[1] ?? "";
    if (seen.has(prNum)) continue;
    seen.add(prNum);
    let title = subject;
    if (hasGh) {
      try {
        const ghOut = execFileSync("gh", ["pr", "view", prNum, "--json", "title"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 10000,
        });
        const data = JSON.parse(ghOut) as { title?: string };
        title = data.title ?? subject;
      } catch {
        /* json/timeout → keep subject */
      }
    }
    prs.push([prNum, title, subject]);
  }
  return prs;
}

/** Port of _pr_in_done_rows. */
function prInDoneRows(prNumber: string, backlogText: string): boolean {
  for (const line of backlogText.split("\n")) {
    if (line.includes("✅ Done") && line.includes(`#${prNumber}`)) return true;
  }
  return false;
}

/** Port of _pr_is_covered. */
function prIsCovered(
  prNumber: string,
  prTitle: string,
  commitMsg: string,
  doneStoryIds: Set<string>,
  changelogText: string,
): boolean {
  if (changelogText.includes(`#${prNumber}`)) return true;
  for (const sid of doneStoryIds) {
    if (sid && (prTitle.includes(sid) || commitMsg.includes(sid))) return true;
  }
  return false;
}

export interface GenerateOptions {
  backlog?: string;
  changelog?: string;
  write?: boolean;
  json?: boolean;
  /** FIX-199: injectable git probe (tests simulate transient/persistent failure). */
  gitProbe?: GitProbe;
}

/** Result of the deterministic generator (mirrors main()'s stdout/stderr/code). */
export interface GenerateResult {
  stdout: string;
  stderr: string;
  status: number;
}

/**
 * Full port of changelog_generate.py main(). Pure I/O-via-args + git/gh probes;
 * produces the exact stdout/stderr/exit the python oracle does. The --write
 * mutation is applied here (writeToChangelog) before returning the stdout note.
 */
export function generateDraft(opts: GenerateOptions): GenerateResult {
  const git = opts.gitProbe ?? gitOutput;
  const backlogPath = opts.backlog ?? ".roll/backlog.md";
  const changelogPath = opts.changelog ?? "CHANGELOG.md";

  if (!existsSync(backlogPath)) {
    return { stdout: "", stderr: "Error: backlog file not found\n", status: 1 };
  }
  const backlogText = readFileSync(backlogPath, "utf8");
  const changelogText: string | null = existsSync(changelogPath)
    ? readFileSync(changelogPath, "utf8")
    : null;

  let stderr = "";
  const rows = readDoneStories(backlogText);

  // FIX-199: resolve the since-tag log explicitly. A transient probe failure is
  // retried away (so repeat runs don't drift); a persistent one warns loudly and
  // degrades to the no-tag dedup branch instead of silently swapping into it.
  const since = commitLogSinceLastRelease(git);
  let sinceTagLog: string | null;
  if (since.kind === "ok") {
    sinceTagLog = since.log;
  } else {
    if (since.kind === "error") {
      stderr += `warn: 无法读取 ${since.tag}..HEAD 提交日志(git 探针重试后仍失败);本次回退为按 CHANGELOG 去重,条目可能不完整——修复 git 后重跑以恢复发布窗口过滤\n`;
    }
    sinceTagLog = null;
  }

  // FIX-227: a story already published in a `## vX` section is shipped — never
  // re-draft it into Unreleased even if the since-tag window still spans it
  // (e.g. a version that was changelogged but never tagged).
  const shipped = releasedStoryIds(changelogText);

  const filtered: Entry[] = [];
  for (const { storyId, desc, source } of rows) {
    if (storyId && shipped.has(storyId)) continue;
    if (sinceTagLog !== null) {
      if (!storyId || !sinceTagLog.includes(storyId)) continue;
    } else if (alreadyInChangelog(storyId, desc, changelogText)) {
      continue;
    }
    if (isInternal(desc)) continue;
    const cleaned = cleanDescription(desc);
    if (!cleaned) continue;
    const cat = detectCategory(cleaned);
    filtered.push({ storyId, desc: cleaned, source, cat });
  }

  // US-CL-007: gap detection.
  const uncarded: Array<[string, string]> = [];
  const tag = latestReleaseTag(git);
  if (tag && ghAvailable()) {
    const mergedPrs = mergedPrsSinceTag(tag, git);
    const doneStoryIds = new Set(rows.map((r) => r.storyId));
    const clText = changelogText ?? "";
    for (const [prNum, prTitle, commitMsg] of mergedPrs) {
      if (prInDoneRows(prNum, backlogText)) continue;
      if (prIsCovered(prNum, prTitle, commitMsg, doneStoryIds, clText)) continue;
      uncarded.push([prNum, prTitle]);
    }
  }

  if (opts.json) {
    const payload = {
      stories_found: rows.length,
      stories_drafted: filtered.length,
      draft: filtered.map((e) => ({ id: e.storyId, desc: e.desc, category: e.cat, source: e.source })),
      uncarded_merged: uncarded.map(([num, title]) => ({ pr: num, title })),
    };
    // python json.dump(indent=2, ensure_ascii=False) + a trailing print().
    return { stdout: jsonDump(payload) + "\n", stderr, status: 0 };
  }

  if (filtered.length === 0 && uncarded.length === 0) {
    return { stdout: "# No new ✅ Done stories found for CHANGELOG.\n", stderr, status: 0 };
  }

  const allEntries: Entry[] = [...filtered, ...uncardedToEntries(uncarded)];
  if (uncarded.length > 0) {
    const prList = uncarded.map(([p]) => `#${p}`).join(" ");
    stderr += `note: ${uncarded.length} 个 merged PR 未建卡,已按 PR 标题并入草稿,建议补卡: ${prList}\n`;
  }
  for (const { storyId, desc, source } of allEntries) {
    const viols = lintBullet(formatBullet(desc, source, storyId));
    if (viols.length > 0) stderr += `lint: ${storyId || "?"}: ${viols.join(", ")}\n`;
  }

  const groups = new Map<string, Row[]>();
  for (const { storyId, desc, source, cat } of allEntries) {
    const g = groups.get(cat) ?? [];
    g.push({ storyId, desc, source });
    groups.set(cat, g);
  }
  const draft = buildDraft(groups);

  if (opts.write) {
    writeToChangelog(draft, changelogPath);
    return { stdout: `Updated ${changelogPath}\n`, stderr, status: 0 };
  }
  // python `print(draft, end="")` — draft already ends with "\n".
  return { stdout: draft, stderr, status: 0 };
}

/**
 * python json.dump(payload, indent=2, ensure_ascii=False) emitter. Mirrors the
 * exact byte layout (2-space indent, ": " separators, no trailing space, no
 * ASCII escaping) for the keys/value shapes this payload uses.
 */
function jsonDump(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  const pad2 = " ".repeat(indent + 2);
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => pad2 + jsonDump(v, indent + 2));
    return "[\n" + items.join(",\n") + "\n" + pad + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return "{}";
  const items = keys.map((k) => `${pad2}${JSON.stringify(k)}: ${jsonDump(obj[k], indent + 2)}`);
  return "{\n" + items.join(",\n") + "\n" + pad + "}";
}

/** Port of _write_to_changelog (the python writer used by --write). */
function writeToChangelog(draft: string, changelogPath: string): void {
  let text = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "# Changelog\n\n";

  if (!text.includes("## Unreleased")) {
    text = text.replace(/\n+$/, "") + "\n\n" + draft;
  } else {
    const m = /^(## Unreleased\s*\n)([\s\S]*?)(?=\n## |$)/m.exec(text);
    if (!m) {
      text = text.replace(/\n+$/, "") + "\n\n" + draft;
    } else {
      const existingRaw = m[2] ?? "";
      // FIX-227: prune any existing Unreleased bullet whose story already shipped
      // in a `## vX` section — the merge writer otherwise keeps shipped entries
      // forever (over-accumulation). Non-bullet lines and PR-only/manual bullets
      // (no shipped story id) are preserved.
      const shipped = releasedStoryIds(text);
      const existing = existingRaw
        .split("\n")
        .filter((ln) => {
          if (!ln.trim().startsWith("- ")) return true;
          const ids = [...ln.matchAll(STORY_ID_RE)].map((mm) => mm[1] as string);
          return !(ids.length > 0 && ids.every((id) => shipped.has(id)));
        })
        .join("\n");
      const newLines = draft.split("\n").slice(2); // drop "## Unreleased" + blank
      let merged = existing.replace(/\n+$/, "") + "\n";
      for (const line of newLines) {
        if (line.startsWith("### ") && existing.includes(line)) continue;
        const bulletCore = line.replace(/\s*\[loop\]\s*$/, "").trim();
        if (bulletCore && !existing.includes(bulletCore)) merged += line + "\n";
      }
      const start = m.index;
      const end = m.index + m[0].length;
      text = text.slice(0, start) + "## Unreleased\n" + merged + text.slice(end);
    }
  }
  writeFileSync(changelogPath, text);
}

// ═══════════════════════════════════════════════════════════════════════════
// Command entry — mirrors cmd_changelog's case dispatch.
// ═══════════════════════════════════════════════════════════════════════════

const GENERATE_HELP = `Usage: roll changelog generate [options]

  从 backlog ✅ Done 故事 + 上次发布以来的提交,生成 ## Unreleased 发布说明。
  输出为确定性草稿(按关键词分类、过 lint),不再调用 AI 润色。

  roll changelog generate               # 预览(确定性草稿)
  roll changelog generate --write       # 写入 CHANGELOG.md
  roll changelog generate --json        # 机器可读(JSON)
`;

export function changelogCommand(args: string[]): number {
  const subcmd = args[0] ?? "generate";
  const rest = args.slice(1);

  if (subcmd === "generate") {
    let toWrite = false;
    let isJson = false;
    const genOpts: GenerateOptions = {};
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i] ?? "";
      // --no-ai: accepted as a no-op. Deterministic output is now the canonical
      // and only path (US-PORT-005), so the flag is redundant but still honored
      // so existing scripts/flags keep working.
      if (a === "--no-ai") {
        /* no-op */
      } else if (a === "--write") {
        toWrite = true;
      } else if (a === "--json") {
        isJson = true;
      } else if (a === "--backlog") {
        genOpts.backlog = rest[++i];
      } else if (a === "--changelog") {
        genOpts.changelog = rest[++i];
      }
      // unknown positionals are dropped (python argparse would error, but the
      // bash wrapper only forwards the recognized path flags in practice).
    }
    genOpts.json = isJson;

    const res = generateDraft(genOpts);
    process.stderr.write(res.stderr);
    if (res.status !== 0) return res.status;

    if (isJson) {
      process.stdout.write(res.stdout);
      return 0;
    }

    // res.stdout IS the raw deterministic draft — the canonical output.
    const draft = res.stdout;
    if (toWrite) {
      // Write through the bash-equivalent ## Unreleased splicer for byte parity
      // with v2's _changelog_write_unreleased.
      writeUnreleased(draft, genOpts.changelog ?? "CHANGELOG.md");
      info("Updated CHANGELOG.md");
      return 0;
    }
    // printf '%s\n' "$draft" — the draft already ends with exactly one "\n",
    // and bash `printf '%s\n'` on such a value yields a trailing blank line.
    process.stdout.write(draft.endsWith("\n") ? draft : draft + "\n");
    return 0;
  }

  if (subcmd === "--help" || subcmd === "-h" || subcmd === "help") {
    process.stdout.write(GENERATE_HELP);
    return 0;
  }

  const lang = msgLang();
  err(t(v2Catalog, lang, "changelog.unknown_subcommand", subcmd));
  err("Try: roll changelog generate");
  return 1;
}

/**
 * Port of _changelog_write_unreleased (bin/roll 5632-5648): replace or insert
 * the ## Unreleased section with `draft` (which begins with '## Unreleased').
 * This is the writer the bash `--write` path uses on `final` — distinct from
 * the python module's _write_to_changelog (which MERGES). cmd_changelog uses
 * the bash splicer, so --write goes through here for byte parity.
 */
function writeUnreleased(draft: string, cl: string): void {
  const dfile = draft.endsWith("\n") ? draft : draft + "\n";
  if (existsSync(cl) && /^## Unreleased/m.test(readFileSync(cl, "utf8"))) {
    const src = readFileSync(cl, "utf8").split("\n");
    const out: string[] = [];
    let done = false;
    let skip = false;
    for (const line of src) {
      if (/^## Unreleased/.test(line) && !done) {
        for (const dl of dfile.replace(/\n$/, "").split("\n")) out.push(dl);
        out.push("");
        skip = true;
        done = true;
        continue;
      }
      if (skip && /^## /.test(line)) skip = false;
      if (skip) continue;
      out.push(line);
    }
    writeFileSync(cl, out.join("\n"));
  } else {
    const head = existsSync(cl) ? (readFileSync(cl, "utf8").split("\n")[0] ?? "# Changelog") : "# Changelog";
    const parts: string[] = [head, ""];
    for (const dl of dfile.replace(/\n$/, "").split("\n")) parts.push(dl);
    parts.push("");
    if (existsSync(cl)) {
      const rest = readFileSync(cl, "utf8").split("\n").slice(1);
      for (const r of rest) parts.push(r);
    }
    writeFileSync(cl, parts.join("\n"));
  }
}
