/**
 * `roll doctor` — TS port of bin/roll cmd_doctor (1700-1705) and its four
 * sections, IN ORDER:
 *   1. _doctor_agent_section          (1727-1757)
 *   2. _doctor_pr_section             (1792-1827) + hints (1530-1550, 1860-1873)
 *   3. _doctor_skills_catalog_section (1710-1722)
 *   4. _doctor_launchd_stale_section  (1765-1790)  (Darwin only)
 *
 * Every probe honors the same env overrides bash uses (HOME, ROLL_HOME via
 * ROLL_CONFIG, ROLL_PKG_DIR, _LAUNCHD_DIR, PATH, gh/git availability) so
 * difftests can fabricate both healthy and broken fixtures. Bilingual section
 * headers come from `ROLL_LANG_RESOLVED=en msg` / `=zh msg` in bash — i.e. the
 * EN line then the ZH line of the same key, regardless of locale.
 */
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { resolveLang, t, v2Catalog, type Lang } from "@roll/spec";
import { repoRoot } from "../bridge.js";
import { generateCatalog } from "./skills.js";

interface Palette {
  GREEN: string;
  YELLOW: string;
  CYAN: string;
  RED: string;
  NC: string;
}
function palette(): Palette {
  const noColor = (process.env["NO_COLOR"] ?? "") !== "";
  return noColor
    ? { GREEN: "", YELLOW: "", CYAN: "", RED: "", NC: "" }
    : { GREEN: "\x1b[0;32m", YELLOW: "\x1b[0;33m", CYAN: "\x1b[0;36m", RED: "\x1b[0;31m", NC: "\x1b[0m" };
}

function rollConfigPath(): string {
  const rollHome = process.env["ROLL_HOME"] ?? join(homedir(), ".roll");
  return join(rollHome, "config.yaml");
}
function pkgDir(): string {
  return process.env["ROLL_PKG_DIR"] ?? repoRoot();
}

function msgLang(): Lang {
  return resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });
}

/** EN line + ZH line of `key` (bash `ROLL_LANG_RESOLVED=en/zh msg`). */
function bilingual(key: string): string[] {
  return [t(v2Catalog, "en", key), t(v2Catalog, "zh", key)];
}

const out: { lines: string[] } = { lines: [] };
function emit(line: string): void {
  out.lines.push(line);
}

// ── _agent_bin_names / _agent_installed_by_name (137-169, 98-109) ────────────
function agentBinNames(agent: string): string[] | null {
  switch (agent) {
    case "claude":
      return ["claude"];
    case "codex":
    case "openai":
      return ["codex"];
    case "agy":
    case "gemini":
      return ["agy", "gemini"];
    case "kimi":
      return ["kimi-code", "kimi-cli", "kimi"];
    case "deepseek":
      return ["deepseek"];
    case "qwen":
      return ["qwen"];
    case "pi":
      return ["pi"];
    default:
      return null;
  }
}
function commandOnPath(bin: string): boolean {
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    try {
      const st = statSync(join(dir, bin));
      if (!st.isFile()) continue;
      accessSync(join(dir, bin), constants.X_OK);
      return true;
    } catch {
      /* keep scanning */
    }
  }
  return false;
}
/** Faithful port of bin/roll _agent_installed_by_name(name, dir) (137-169). */
function agentInstalledByName(agent: string, dir: string): boolean {
  const home = homedir();
  switch (agent) {
    case "trae":
      return existsSync(join(home, "Library", "Application Support", "Trae")) || existsSync(join(home, ".config", "Trae"));
    case "opencode": {
      const p = join(home, ".opencode", "bin", "opencode");
      try {
        accessSync(p, constants.X_OK);
        return statSync(p).isFile();
      } catch {
        return false;
      }
    }
    case "cursor":
      return commandOnPath("cursor") || existsSync(join(home, ".cursor"));
    case "openclaw":
      return existsSync(join(home, ".openclaw", "workspace"));
    default: {
      const bins = agentBinNames(agent);
      if (bins !== null) return bins.some(commandOnPath);
      return dir !== "" && existsSync(dir) && safeIsDir(dir); // unknown → dir presence
    }
  }
}
function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// bash printf `%-Ns` left-justifies to N BYTES (not chars) — a CJK string
// consumes its UTF-8 byte width, so it gets fewer trailing spaces. Mirror that.
const padEnd = (s: string, w: number): string => {
  const bytes = Buffer.byteLength(s, "utf8");
  return bytes >= w ? s : s + " ".repeat(w - bytes);
};

// ── 1. agent section ─────────────────────────────────────────────────────────
function agentSection(p: Palette): void {
  const cfg = rollConfigPath();
  if (!existsSync(cfg)) return; // [[ -f "$ROLL_CONFIG" ]] || return 0
  emit("");
  for (const l of bilingual("doctor.agent_detection")) emit(l);
  emit("");
  const text = readFileSync(cfg, "utf8");
  let primary = "";
  for (const line of text.split("\n")) {
    const m = /^primary_agent:\s*(.*)$/.exec(line);
    if (m !== null) primary = (m[1] ?? "").trim();
  }
  const home = homedir();
  for (const line of text.split("\n")) {
    // IFS=: read -r _key _value → split on FIRST colon, value = remainder.
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    if (!/^ai_/.test(key)) continue;
    const name = key.slice("ai_".length);
    if (name === "kimi_code") continue; // dedupe
    let dir = value.split("|")[0] ?? ""; // ${_value%%|*}
    dir = dir.replace(/^ /, ""); // ${_dir# } strip ONE leading space
    if (dir.startsWith("~")) dir = home + dir.slice(1); // ${_dir/#\~/$HOME}
    const installed = agentInstalledByName(name, dir)
      ? t(v2Catalog, msgLang(), "doctor.agent_installed")
      : t(v2Catalog, msgLang(), "doctor.agent_missing");
    const dirExists = safeIsDir(dir)
      ? t(v2Catalog, msgLang(), "doctor.agent_dir_exists")
      : t(v2Catalog, msgLang(), "doctor.agent_dir_missing");
    const tag = name === primary ? `  (${t(v2Catalog, msgLang(), "doctor.agent_primary_label")})` : "";
    // printf "  %-10s  %-14s  %s%s\n"
    emit(`  ${padEnd(name, 10)}  ${padEnd(installed, 14)}  ${dirExists}${tag}`);
  }
}

// ── 2. pr section ─────────────────────────────────────────────────────────────
function ghAvailable(): boolean {
  return commandOnPath("gh");
}
/** _doctor_branch_protection_state → enabled | disabled | unknown (1830-1849). */
function branchProtectionState(): "enabled" | "disabled" | "unknown" {
  if (!ghAvailable()) return "unknown";
  let slug = "";
  try {
    slug = execFileSync("gh", ["repo", "view", "--json", "owner,name", "--jq", '.owner.login + "/" + .name'], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    slug = "";
  }
  if (slug === "") return "unknown";
  let required = "";
  try {
    required = execFileSync(
      "gh",
      ["api", `repos/${slug}/branches/main/protection`, "--jq", ".required_pull_request_reviews.required_approving_review_count // 0"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    required = "";
  }
  if (required === "") return "unknown";
  return Number(required) >= 1 ? "enabled" : "disabled";
}
function eventWorkflowState(): "present" | "absent" {
  return existsSync(join(".github", "workflows", "pr-review-event.yml")) ? "present" : "absent";
}
function insideGitWorkTree(): boolean {
  try {
    return (
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() ===
      "true"
    );
  } catch {
    return false;
  }
}
/** _print_pr_pipeline_hint heredoc (1531-1549) — verbatim literal text. */
function prPipelineHint(): string[] {
  return [
    "",
    "  Optional — enable AI review as a hard merge gate (path C).",
    "  可选 —— 启用 AI 评审作为合并双门（路径 C）。",
    "",
    "  Run once per repo (requires admin token), then claude-code-review.yml",
    "  approvals become a required merge gate alongside CI:",
    "  每个仓库执行一次（需要管理员 token），之后 claude-code-review.yml 的",
    "  approve 将与 CI 一起成为合并必经的双门：",
    "",
    "      gh api -X PATCH repos/<owner>/<repo>/branches/main/protection \\",
    "        -f required_pull_request_reviews.required_approving_review_count=1",
    "",
    "  Escape hatch: add [skip-ai-review] to a PR body, or include",
    "  SKIP_AI_REVIEW in any commit message, to bypass AI review for that PR.",
    "  紧急通道：在 PR body 加 [skip-ai-review]，或在任一 commit message",
    "  里包含 SKIP_AI_REVIEW，可对该 PR 绕过 AI 评审。",
    "",
  ];
}
/** _print_pr_event_hint (1860-1873) — note _zh keys are absent → key echoed. */
function prEventHint(lang: Lang): string[] {
  return [
    "",
    `  ${t(v2Catalog, lang, "doctor.pr_event_optional")}`,
    `  ${t(v2Catalog, lang, "doctor.pr_event_optional_zh")}`,
    "",
    `  ${t(v2Catalog, lang, "doctor.pr_event_without")}`,
    `  ${t(v2Catalog, lang, "doctor.pr_event_without_zh")}`,
    "",
    "      cp templates/workflows/pr-review-event.yml .github/workflows/",
    "",
    `  ${t(v2Catalog, lang, "doctor.pr_event_secret")}`,
    `  ${t(v2Catalog, lang, "doctor.pr_event_secret_zh")}`,
    "",
  ];
}
function prSection(lang: Lang): void {
  if (!insideGitWorkTree()) return; // git rev-parse --is-inside-work-tree || return 0
  emit("");
  for (const l of bilingual("doctor.pr_review_extras")) emit(l);
  emit("");
  const protection = branchProtectionState();
  if (protection === "enabled") {
    emit(`  ${t(v2Catalog, lang, "doctor.pr_double_gate_enabled")}`);
  } else if (protection === "disabled") {
    emit(`  ${t(v2Catalog, lang, "doctor.pr_double_gate_disabled")}`);
    for (const l of prPipelineHint()) emit(l);
  } else {
    emit(`  ${t(v2Catalog, lang, "doctor.pr_double_gate_unknown")}`);
    for (const l of prPipelineHint()) emit(l);
  }
  if (eventWorkflowState() === "present") {
    emit(`  ${t(v2Catalog, lang, "doctor.pr_event_enabled")}`);
  } else {
    emit(`  ${t(v2Catalog, lang, "doctor.pr_event_disabled")}`);
    for (const l of prEventHint(lang)) emit(l);
  }
}

// ── 3. skills catalog section ────────────────────────────────────────────────
function skillsCatalogSection(lang: Lang): void {
  const skillsDir = join(pkgDir(), "skills");
  if (!safeIsDir(skillsDir)) return; // [[ -d "$ROLL_PKG_DIR/skills" ]] || return 0
  const target = join(pkgDir(), "guide", "skills.md");
  emit("");
  for (const l of bilingual("skills.doctor_heading")) emit(l);
  let drift: boolean;
  if (!existsSync(target)) {
    drift = true;
  } else {
    // diff -u target <(generate) → identical ⇒ no drift.
    const fresh = join(mkdtempSync(join(tmpdir(), "roll-doctor-")), "skills.md");
    writeFileSync(fresh, generateCatalog());
    drift = readFileSync(target, "utf8") !== readFileSync(fresh, "utf8");
  }
  emit(`  ${t(v2Catalog, lang, drift ? "skills.doctor_drift" : "skills.doctor_ok")}`);
}

// ── FIX-234 AC3: all com.roll.* lanes — target path + load state, stale red ──
export interface LaneProbe {
  /** `launchctl list <label>` last-exit, or null when the job is not loaded. */
  lastExit: (label: string) => number | null;
}

export function lanesSection(lang: Lang, probe?: LaneProbe): string[] {
  const lines: string[] = [];
  if (process.platform !== "darwin") return lines;
  const dir = process.env["_LAUNCHD_DIR"] ?? join(homedir(), "Library", "LaunchAgents");
  if (!safeIsDir(dir)) return lines;
  let plists: string[] = [];
  try {
    plists = readdirSync(dir)
      .filter((n) => n.startsWith("com.roll.") && n.endsWith(".plist"))
      .sort();
  } catch {
    return lines;
  }
  if (plists.length === 0) return lines;
  lines.push("");
  lines.push(lang === "zh" ? "launchd lanes(全部 com.roll.* 任务)" : "launchd lanes (all com.roll.* jobs)");
  lines.push("");
  for (const name of plists) {
    const label = name.replace(/\.plist$/, "");
    const wd = readWorkingDirectory(join(dir, name));
    const stale = wd !== "" && !safeIsDir(wd);
    const exit = probe?.lastExit(label);
    const state =
      exit === undefined ? "" : exit === null ? (lang === "zh" ? " · 未加载" : " · not loaded") : ` · last exit ${exit}`;
    lines.push(`  ${stale ? "✗" : "•"} ${label}${state}`);
    lines.push(`    → ${wd === "" ? "(no WorkingDirectory)" : wd}${stale ? (lang === "zh" ? "  [目录已不存在——陈旧 lane]" : "  [missing — STALE lane]") : ""}`);
  }
  for (const l of lines) emit(l);
  return lines;
}

// ── 4. launchd stale section (Darwin only) ───────────────────────────────────
function launchdStaleSection(lang: Lang): void {
  if (process.platform !== "darwin") return; // [[ "$(uname)" == "Darwin" ]] || return 0
  const dir = process.env["_LAUNCHD_DIR"] ?? join(homedir(), "Library", "LaunchAgents");
  if (!safeIsDir(dir)) return;
  let found = false;
  let plists: string[] = [];
  try {
    plists = readdirSync(dir)
      .filter((n) => n.startsWith("com.roll.") && n.endsWith(".plist"))
      .sort();
  } catch {
    plists = [];
  }
  for (const name of plists) {
    const plist = join(dir, name);
    const wd = readWorkingDirectory(plist);
    if (wd === "") continue; // [[ -n "$wd" ]] || continue
    if (safeIsDir(wd)) continue; // [[ -d "$wd" ]] && continue
    if (!found) {
      emit("");
      emit(t(v2Catalog, lang, "doctor.stale_plists"));
      emit("");
      found = true;
    }
    const label = name.replace(/\.plist$/, "");
    emit(`  ⚠ ${label}`);
    emit(`    WorkingDirectory missing: ${wd}`);
    emit(`    ${t(v2Catalog, lang, "doctor.stale_plists_cleanup")}: launchctl bootout gui/${process.getuid?.() ?? 0}/${label}; rm '${plist}'`);
  }
}
/** Real lane probe — `launchctl list <label>` parses "LastExitStatus" (Darwin). */
function realLaneProbe(): LaneProbe {
  return {
    lastExit: (label) => {
      try {
        const out = execFileSync("launchctl", ["list", label], {
          encoding: "utf8",
          timeout: 3000,
          stdio: ["ignore", "pipe", "pipe"], // swallow launchctl's stderr noise
        });
        const m2 = /"LastExitStatus"\s*=\s*(-?\d+)/.exec(out);
        return m2 ? Number.parseInt(m2[1] ?? "0", 10) : 0;
      } catch {
        return null; // not loaded
      }
    },
  };
}

/** Mirror the awk that extracts the line after <key>WorkingDirectory</key>. */
function readWorkingDirectory(plist: string): string {
  let body: string;
  try {
    body = readFileSync(plist, "utf8");
  } catch {
    return "";
  }
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? "").includes("<key>WorkingDirectory</key>")) {
      const next = lines[i + 1] ?? "";
      return next.replace(/.*<string>|<\/string>.*/g, "");
    }
  }
  return "";
}

export function doctorCommand(_args: string[]): number {
  out.lines = [];
  const p = palette();
  const lang = msgLang();
  agentSection(p);
  prSection(lang);
  skillsCatalogSection(lang);
  lanesSection(lang, realLaneProbe());
  launchdStaleSection(lang);
  process.stdout.write(out.lines.join("\n") + "\n");
  return 0;
}
