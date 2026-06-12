/**
 * `roll status` — TS port of lib/roll-status.py (US-CLI-001).
 *
 * One-screen sync health: global conventions, AI clients table (with drift
 * fix hints), project templates, and this-project metrics. Byte-aligned with
 * the python oracle (fixture + live diff-tests).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { c, COLS, hr, pad, renderState, row, sectionHead } from "../render.js";

// ── Paths ────────────────────────────────────────────────────────────────────
function rollHome(): string {
  return process.env["ROLL_HOME"] ?? join(homedir(), ".roll");
}
const globalDir = (): string => join(rollHome(), "conventions", "global");
const templatesDir = (): string => join(rollHome(), "conventions", "templates");
const configPath = (): string => join(rollHome(), "config.yaml");

/** Python-side slug (path-based only — used for launchd label lookup). */
function projectSlugPy(): string {
  let path = realpathSync(process.cwd());
  try {
    const common = execFileSync("git", ["-C", path, "rev-parse", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (common.endsWith("/.git")) path = common.slice(0, -5);
  } catch {
    /* not a git repo */
  }
  const base = basename(path)
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const h = createHash("md5").update(path).digest("hex").slice(0, 6);
  return `${base}-${h}`;
}

// ── Data loaders (mirror the python loaders 1:1) ─────────────────────────────
const CONVENTION_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursor-rules", "project_rules.md"];
const TEMPLATES = ["fullstack", "frontend-only", "backend-service", "cli"];

type Conventions = Array<[string, boolean]>;

interface AiClient {
  name: string;
  cfg_file: string;
  path: string;
  sync: "sync" | "out-of-sync" | "missing";
  skills: number;
}

interface StatusData {
  conventions: Conventions;
  ai_clients: AiClient[];
  templates: Array<[string, number]>;
  skills_installed: number;
  project_has_agents: boolean;
  project_has_backlog: boolean;
  project_features_count: number;
  loop_state: string;
  dream_state: string;
}

function globalConventions(): Conventions {
  return CONVENTION_FILES.map((f) => [f, existsSync(join(globalDir(), f))]);
}

export interface AiEntry {
  name: string;
  ai_dir: string;
  cfg_file: string;
  src_file: string;
}

export function parseAiEntries(): AiEntry[] {
  const cfg = configPath();
  if (!existsSync(cfg)) return [];
  const entries: AiEntry[] = [];
  for (const line of readFileSync(cfg, "utf8").split("\n")) {
    const m = /^ai_[a-z]+:\s*(.+)/.exec(line);
    if (m === null) continue;
    const val = (m[1] ?? "").trim().replaceAll("~", homedir());
    const parts = val.split("|");
    if (parts.length < 3) continue;
    const aiDir = (parts[0] ?? "").trim();
    const cfgFile = (parts[1] ?? "").trim();
    const srcFile = (parts[2] ?? "").trim();
    let name = basename(aiDir).replace(/^\.+/, "");
    if (name === "workspace" || name === "agent") {
      name = basename(dirname(aiDir)).replace(/^\.+/, "");
    }
    entries.push({ name, ai_dir: aiDir, cfg_file: cfgFile, src_file: srcFile });
  }
  return entries;
}

export function aiSyncStatus(e: AiEntry): AiClient["sync"] {
  const cfgFile = join(e.ai_dir, e.cfg_file);
  const rollMd = join(e.ai_dir, "roll.md");
  const src = join(globalDir(), e.src_file);
  if (!existsSync(cfgFile)) return "missing";
  if (!existsSync(rollMd)) return "out-of-sync";
  try {
    if (existsSync(src) && !readFileSync(rollMd).equals(readFileSync(src))) return "out-of-sync";
  } catch {
    return "out-of-sync";
  }
  try {
    if (!readFileSync(cfgFile, "utf8").includes("@roll.md")) return "out-of-sync";
  } catch {
    return "out-of-sync";
  }
  return "sync";
}

function aiSkillCount(e: AiEntry): number {
  const skillsDir = join(e.ai_dir, "skills");
  if (!existsSync(skillsDir)) return 0;
  try {
    let n = 0;
    for (const name of readdirSync(skillsDir)) {
      if (!name.startsWith("roll-")) continue;
      const p = join(skillsDir, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink() || st.isDirectory()) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

function countFilesRecursive(dir: string): number {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) n += countFilesRecursive(p);
    else if (st.isFile()) n++;
  }
  return n;
}

function templateCount(tpl: string): number {
  const d = join(templatesDir(), tpl);
  if (!existsSync(d)) return 0;
  try {
    return countFilesRecursive(d);
  } catch {
    return 0;
  }
}

function skillsInstalled(): number {
  const sd = join(rollHome(), "skills");
  if (!existsSync(sd)) return 0;
  try {
    return readdirSync(sd).filter((n) => statSync(join(sd, n)).isDirectory()).length;
  } catch {
    return 0;
  }
}

function launchdState(service: string, slug: string): string {
  const label = `com.roll.${service}.${slug}`;
  const plist = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
  if (!existsSync(plist)) return "not-installed";
  try {
    const out = execFileSync("launchctl", ["list", label], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() !== "" ? "enabled" : "installed-off";
  } catch {
    return "installed-off";
  }
}

// ── Fixture data (test-only; opt in via ROLL_RENDER_FIXTURE=1) ──────────────
function fixtureData(): StatusData {
  return {
    conventions: [
      ["AGENTS.md", true],
      ["CLAUDE.md", true],
      ["GEMINI.md", false],
      [".cursor-rules", true],
      ["project_rules.md", false],
    ],
    ai_clients: [
      { name: "claude", cfg_file: "CLAUDE.md", path: "~/.claude/CLAUDE.md", sync: "sync", skills: 12 },
      { name: "cursor", cfg_file: "AGENTS.md", path: "~/.cursor/AGENTS.md", sync: "out-of-sync", skills: 12 },
      { name: "agy", cfg_file: "GEMINI.md", path: "~/.gemini/GEMINI.md", sync: "missing", skills: 0 },
    ],
    templates: [
      ["fullstack", 14],
      ["frontend-only", 9],
      ["backend-service", 11],
      ["cli", 7],
    ],
    skills_installed: 12,
    project_has_agents: true,
    project_has_backlog: true,
    project_features_count: 23,
    loop_state: "enabled",
    dream_state: "not-installed",
  };
}

// ── Render (mirrors the python renderers; collects lines, prints once) ──────
function renderHealth(out: string[], d: StatusData): void {
  const clients = d.ai_clients;
  const synced = clients.filter((x) => x.sync === "sync").length;
  const total = clients.length;
  const skills = d.skills_installed;
  const tpls = d.templates.filter((t) => t[1] > 0).length;

  let dot: string, word: string, detail: string;
  if (synced < total) {
    dot = c("amber", "!");
    word = c("amber", "drift", { bold: true });
    detail =
      c("dim", `  ${synced}/${total} AI clients in sync`) + c("muted", " · ") +
      c("dim", `${skills} skills`) + c("muted", " · ") +
      c("dim", `${tpls} templates`);
  } else {
    dot = c("green", "●");
    word = c("green", "healthy", { bold: true });
    detail =
      c("dim", `  ${synced}/${total} AI clients in sync`) + c("muted", " · ") +
      c("dim", `${skills} skills mounted`) + c("muted", " · ") +
      c("dim", `${tpls} templates present`);
  }
  out.push("", "  " + dot + " " + word + detail, "", hr(), "");
}

function renderGlobalConventions(out: string[], conventions: Conventions): void {
  out.push(sectionHead("GLOBAL CONVENTIONS", "全局约定", "~/.roll/conventions/global/"), "");
  for (const [fname, exists] of conventions) {
    if (exists) out.push("  " + c("green", "+") + " " + c("fg", fname));
    else out.push("  " + c("red", "−") + " " + c("dim", fname) + "  " + c("red", "missing"));
  }
  out.push("", hr(), "");
}

function renderAiClients(out: string[], clients: AiClient[]): void {
  out.push(sectionHead("AI CLIENTS", "AI 客户端同步", "convention · path · sync · skills"), "");
  out.push(
    "  " + pad(c("dim", "name"), 14) + pad(c("dim", "convention"), 14) +
      pad(c("dim", "sync"), 14) + c("dim", "skills"),
  );
  out.push("  " + c("faint", "─".repeat(COLS - 4)));

  for (const cl of clients) {
    let syncCol: string, nameCol: string;
    if (cl.sync === "sync") {
      syncCol = c("green", "✓ in sync");
      nameCol = c("fg", cl.name);
    } else if (cl.sync === "out-of-sync") {
      syncCol = c("amber", "~ out of sync");
      nameCol = c("amber", cl.name);
    } else {
      syncCol = c("red", "− missing");
      nameCol = c("red", cl.name);
    }
    out.push(
      "  " + pad(nameCol, 14) + pad(c("dim", cl.cfg_file), 14) + pad(syncCol, 14) +
        c("dim", String(cl.skills)),
    );
    if (cl.sync === "out-of-sync" || cl.sync === "missing") {
      out.push("       " + c("dim", "fix: ") + c("blue", `roll setup -f ${cl.name}`));
    }
  }
  out.push("", hr(), "");
}

function renderTemplates(out: string[], templates: Array<[string, number]>): void {
  out.push(sectionHead("PROJECT TEMPLATES", "项目模板", "~/.roll/conventions/templates/"), "");
  const parts = templates.map(([tpl, count]) =>
    count > 0
      ? c("fg", tpl) + c("dim", ` ${count}f`)
      : c("red", "−") + " " + c("dim", tpl + " missing"),
  );
  out.push("  " + parts.join(c("muted", "  ·  ")));
  out.push("", hr(), "");
}

function renderThisProject(out: string[], d: StatusData): void {
  out.push(sectionHead("THIS PROJECT", "本项目", basename(process.cwd())), "");

  const fileRow = (label: string, exists: boolean, detail = ""): void => {
    let line: string;
    if (exists) {
      line = "  " + c("green", "+") + " " + c("fg", label);
      if (detail !== "") line += c("dim", `  ${detail}`);
    } else {
      line = "  " + c("red", "−") + " " + c("dim", label) + "  " + c("red", "missing");
    }
    out.push(line);
  };

  fileRow("AGENTS.md", d.project_has_agents);
  fileRow(".roll/backlog.md", d.project_has_backlog);
  fileRow(".roll/features/", d.project_features_count > 0, `${d.project_features_count} feature docs`);

  for (const [svc, state] of [
    ["loop", d.loop_state],
    ["dream", d.dream_state],
  ] as const) {
    let dot: string, word: string;
    if (state === "enabled") {
      dot = c("green", "●");
      word = c("green", `${svc} · launchd enabled`);
    } else if (state === "installed-off") {
      dot = c("amber", "⚠");
      word = c("amber", `${svc} · launchd off`);
    } else {
      dot = c("red", "○");
      word = c("dim", `${svc} · launchd not installed`);
    }
    out.push("  " + dot + " " + word);
  }
  out.push("");
}

// ── Live data collection ─────────────────────────────────────────────────────
function liveData(): StatusData {
  const slug = projectSlugPy();
  const home = homedir();
  const aiClients: AiClient[] = parseAiEntries().map((e) => ({
    name: e.name,
    cfg_file: e.cfg_file,
    path: join(e.ai_dir, e.cfg_file).replaceAll(home, "~"),
    sync: aiSyncStatus(e),
    skills: aiSkillCount(e),
  }));
  const featDir = ".roll/features";
  let featCount = 0;
  if (existsSync(featDir)) {
    featCount = readdirSync(featDir).filter((n) => n.endsWith(".md")).length;
  }
  return {
    conventions: globalConventions(),
    ai_clients: aiClients,
    templates: TEMPLATES.map((t) => [t, templateCount(t)]),
    skills_installed: skillsInstalled(),
    project_has_agents: existsSync("AGENTS.md"),
    project_has_backlog: existsSync(".roll/backlog.md"),
    project_features_count: featCount,
    loop_state: launchdState("loop", slug),
    dream_state: launchdState("dream", slug),
  };
}

// ── Entry ────────────────────────────────────────────────────────────────────
export function statusCommand(args: string[]): number {
  const noColor = args.includes("--no-color");
  if (noColor || (process.env["NO_COLOR"] ?? "") !== "" || !process.stdout.isTTY) {
    renderState.useColor = false;
  }
  const d = (process.env["ROLL_RENDER_FIXTURE"] ?? "") !== "" ? fixtureData() : liveData();
  const out: string[] = [];
  renderHealth(out, d);
  renderGlobalConventions(out, d.conventions);
  renderAiClients(out, d.ai_clients);
  renderTemplates(out, d.templates);
  renderThisProject(out, d);
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}
