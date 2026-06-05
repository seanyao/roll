/**
 * `roll init` — TS port of bin/roll cmd_init (2147-2210) and its scaffolding
 * helpers, plus the v2 UI renderer lib/roll-init.py (rendered natively here via
 * the shared render primitives). Mirrors the DETERMINISTIC happy path:
 *
 *   - fresh project (no AGENTS.md, not a legacy codebase) → scaffold AGENTS.md
 *     (project-type-filtered), .claude/CLAUDE.md (template), .roll/backlog.md,
 *     .roll/features/, .roll/features.md, .roll/agent-routes.yaml, .roll/.version
 *   - re-init (AGENTS.md present) → section-merge global conventions + CLAUDE.md
 *
 * Ported helpers: _merge_global_to_project (2022-2093), _merge_claude_to_project
 * (2095-2139), _write_backlog (3432-3451), _ensure_features_dir (3478-3487),
 * _write_features_md (3572-3591), _init_seed_agent_routes (3456-3476),
 * _write_version_stamp (3497-3515), scan_project_type_from_files (3387-3429),
 * _sync_conventions (1300-1303 → _sync_one_tool → _sync_convention_for_tool),
 * and _emit_init_v2_ui (2215-2276) re-implementing lib/roll-init.py.
 *
 * Sub-paths LEFT ON BASH (registered as fallback in commands/index.ts):
 *   - `roll init --apply …`            (consumes onboard-plan.yaml; agent flow)
 *   - `roll init -<flag>`              (unknown-flag error owned by bash msg)
 *   - legacy-codebase onboarding       (_init_is_legacy_project → interactive
 *                                       agent launch; never runnable from TS)
 *
 * Whitelisted divergence: cmd_init calls `_install_launchd_plists` with all
 * output redirected to /dev/null (`>/dev/null 2>&1 || true`). It contributes
 * NOTHING to init's stdout and is a darwin-only filesystem side effect, so the
 * TS port does not reproduce it — the user-visible contract (stdout + the
 * scaffolded .roll tree + AGENTS.md/CLAUDE.md) is byte-identical.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { c, renderState, row, COLS } from "../render.js";
import { repoRoot } from "../bridge.js";

// ─── bash UI helpers (bin/roll:41-56) — used only for err() here ─────────────
function err(line: string): void {
  const noColor = (process.env["NO_COLOR"] ?? "") !== "";
  const RED = noColor ? "" : "\x1b[0;31m";
  const NC = noColor ? "" : "\x1b[0m";
  process.stderr.write(`${RED}[roll]${NC} ${line}\n`);
}

// ─── env (bin/roll:7-11) ──────────────────────────────────────────────────────
function rollHome(): string {
  return process.env["ROLL_HOME"] ?? join(homedir(), ".roll");
}
function rollGlobal(): string {
  return join(rollHome(), "conventions", "global");
}
function rollTemplates(): string {
  return join(rollHome(), "conventions", "templates");
}
function rollConfig(): string {
  return join(rollHome(), "config.yaml");
}
/** bin/roll VERSION= — the frozen oracle's own version (for the .version stamp). */
function binRollVersion(): string {
  try {
    const m = /^VERSION="([^"]+)"/m.exec(readFileSync(join(repoRoot(), "bin", "roll"), "utf8"));
    return m?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

// merge-summary accumulator (mirrors _ROLL_MERGE_SUMMARY entries "action|file").
type Summary = string[];

// ─── scan_project_type_from_files (3387-3429) ─────────────────────────────────
function scanProjectType(dir: string): string {
  let hasFrontend = false;
  let hasBackend = false;
  let hasCli = false;
  const pkg = join(dir, "package.json");
  const readPkg = (): string => {
    try {
      return readFileSync(pkg, "utf8");
    } catch {
      return "";
    }
  };
  if (existsSync(pkg)) {
    if (/"react"|"vue"|"next"|"nuxt"|"vite"|"svelte"/i.test(readPkg())) hasFrontend = true;
  }
  if (["src", "app", "pages", "components"].some((d) => existsSync(join(dir, d)))) hasFrontend = true;

  if (["server", "api", "backend"].some((d) => existsSync(join(dir, d)))) hasBackend = true;
  if (
    ["go.mod", "main.go", "main.py", "app.py", "Cargo.toml", "requirements.txt", "pyproject.toml"].some(
      (f) => existsSync(join(dir, f)),
    )
  )
    hasBackend = true;
  if (existsSync(pkg)) {
    if (
      /"prisma"|"@prisma\/client"|"typeorm"|"sequelize"|"mongoose"|"drizzle-orm"|"@neondatabase\/serverless"|"pg"|"mysql2"|"mongodb"|"redis"|"ioredis"|"express"|"fastify"|"koa"|"hapi"|"@hapi\/hapi"|"apollo-server"|"graphql-yoga"|"trpc"/i.test(
        readPkg(),
      )
    )
      hasBackend = true;
  }
  if (existsSync(join(dir, "prisma", "schema.prisma"))) hasBackend = true;

  if (existsSync(join(dir, "bin")) || existsSync(join(dir, "cmd"))) hasCli = true;

  if (hasFrontend && hasBackend) return "fullstack";
  if (hasFrontend && !hasBackend) return "frontend-only";
  if (hasCli && !hasFrontend) return "cli";
  if (hasBackend && !hasFrontend) return "backend-service";
  return "unknown";
}

// ─── _init_is_legacy_project (2286-2323) ──────────────────────────────────────
function countNonEmptyFiles(dir: string): number {
  // find <dir> -type f -not -empty | wc -l
  const r = spawnSync("find", [dir, "-type", "f", "-not", "-empty"], { encoding: "utf8" });
  if (r.status !== 0 || (r.stdout ?? "") === "") return 0;
  return r.stdout.split("\n").filter((l) => l !== "").length;
}
function isLegacyProject(projectDir: string): boolean {
  for (const dir of ["src", "app", "lib", "pkg", "cmd"]) {
    const p = join(projectDir, dir);
    if (existsSync(p) && statSync(p).isDirectory()) {
      if (countNonEmptyFiles(p) >= 10) return true;
    }
  }
  const manifests = [
    "package.json", "pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "Pipfile",
    "go.mod", "Cargo.toml", "Gemfile", "pom.xml", "build.gradle", "build.gradle.kts",
    "Makefile", "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
    "app.json", "project.config.json",
    "mix.exs", "composer.json", "deno.json", "deno.jsonc",
  ];
  for (const man of manifests) if (existsSync(join(projectDir, man))) return true;
  // *.tf at root
  const tf = spawnSync("bash", ["-c", `compgen -G '${projectDir.replace(/'/g, "'\\''")}/*.tf' >/dev/null 2>&1`]);
  if (tf.status === 0) return true;
  // git history
  if (existsSync(join(projectDir, ".git"))) {
    const g = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: projectDir, stdio: "ignore" });
    if (g.status === 0) return true;
  }
  return false;
}

// ─── _merge_global_to_project (2022-2093) ─────────────────────────────────────
function mergeGlobalToProject(projectDir: string, summary: Summary): void {
  const src = join(rollGlobal(), "AGENTS.md");
  const dst = join(projectDir, "AGENTS.md");
  if (!existsSync(src)) {
    // warn() output is captured-then-discarded inside the `{ … } >/dev/null`
    // block in cmd_init, so it never reaches init's stdout. Skip silently.
    return;
  }
  const projectType = scanProjectType(projectDir);
  const skipFrontend = ["cli", "backend-service", "unknown"].includes(projectType);
  const FRONTEND_HEAD = "## 7. Frontend Default Stack";

  const srcText = readFileSync(src, "utf8");
  const srcLines = srcText.split("\n");
  // bash `read -r` drops a trailing newline-less final line only if empty; the
  // file is read line-by-line. We mirror by iterating split lines but must not
  // emit a phantom trailing empty element.
  const lines = srcText.endsWith("\n") ? srcLines.slice(0, -1) : srcLines;

  if (!existsSync(dst)) {
    // Fresh create: write sections filtered by project type.
    let out = "";
    let fcH = "";
    let fcB = "";
    let fcPre = true;
    let fcWant = true;
    const flush = (): void => {
      if (fcH !== "" && fcWant) out += `${fcH}\n${fcB}`;
    };
    for (const line of lines) {
      if (/^## /.test(line)) {
        flush();
        fcH = line;
        fcB = "";
        fcPre = false;
        fcWant = true;
        if (skipFrontend && fcH === FRONTEND_HEAD) fcWant = false;
      } else if (fcPre) {
        out += `${line}\n`;
      } else {
        fcB += `${line}\n`;
      }
    }
    flush();
    writeFileSync(dst, out);
    summary.push("created|AGENTS.md");
    return;
  }

  // Section-merge: append any ## sections from global missing in project.
  const dstText = readFileSync(dst, "utf8");
  let added = 0;
  let curH = "";
  let curB = "";
  const tryAppend = (): void => {
    if (curH !== "" && !dstText.includes(curH)) {
      let skipSec = false;
      if (skipFrontend && curH === FRONTEND_HEAD) skipSec = true;
      if (!skipSec) {
        // NOTE: reads the ORIGINAL dst snapshot for the grep -qF check, matching
        // bash (which greps the file but only appends after the loop) — appends
        // accumulate; the grep target is the on-disk file which we update below.
        appendBuffer += `\n${curH}\n${curB}`;
        added += 1;
      }
    }
  };
  let appendBuffer = "";
  for (const line of lines) {
    if (/^## /.test(line)) {
      tryAppend();
      curH = line;
      curB = "";
    } else if (curH !== "") {
      curB += `${line}\n`;
    }
  }
  tryAppend();
  if (appendBuffer !== "") writeFileSync(dst, dstText + appendBuffer);

  if (added > 0) summary.push("merged|AGENTS.md");
  else summary.push("unchanged|AGENTS.md");
}

// ─── _merge_claude_to_project (2095-2139) ─────────────────────────────────────
function mergeClaudeToProject(projectDir: string, summary: Summary): void {
  const projectType = scanProjectType(projectDir);
  const tplFile = join(rollTemplates(), projectType, "CLAUDE.md");
  if (!existsSync(tplFile)) return; // No template for this project type.
  const claudeDir = join(projectDir, ".claude");
  const outFile = join(claudeDir, "CLAUDE.md");
  mkdirSync(claudeDir, { recursive: true });

  if (!existsSync(outFile)) {
    copyFileSync(tplFile, outFile);
    summary.push("created|.claude/CLAUDE.md");
    return;
  }

  const tplText = readFileSync(tplFile, "utf8");
  const lines = tplText.endsWith("\n") ? tplText.split("\n").slice(0, -1) : tplText.split("\n");
  const outText = readFileSync(outFile, "utf8");
  let added = 0;
  let curH = "";
  let curB = "";
  let appendBuffer = "";
  const tryAppend = (): void => {
    if (curH !== "" && !outText.includes(curH)) {
      appendBuffer += `\n${curH}\n${curB}`;
      added += 1;
    }
  };
  for (const line of lines) {
    if (/^## /.test(line)) {
      tryAppend();
      curH = line;
      curB = "";
    } else if (curH !== "") {
      curB += `${line}\n`;
    }
  }
  tryAppend();
  if (appendBuffer !== "") writeFileSync(outFile, outText + appendBuffer);

  if (added > 0) summary.push("merged|.claude/CLAUDE.md");
  else summary.push("unchanged|.claude/CLAUDE.md");
}

// ─── _write_backlog (3432-3451) ───────────────────────────────────────────────
const BACKLOG_TEMPLATE = `# Project Backlog

## Epic: Initial Setup
| Story | Description | Status |
|-------|-------------|--------|

## Bug Fixes
| ID | Problem | Status |
|----|---------|--------|
`;
function writeBacklog(path: string, summary: Summary): void {
  if (existsSync(path)) {
    summary.push("unchanged|.roll/backlog.md");
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, BACKLOG_TEMPLATE);
  summary.push("created|.roll/backlog.md");
}

// ─── _ensure_features_dir (3478-3487) ─────────────────────────────────────────
function ensureFeaturesDir(path: string, summary: Summary): void {
  if (existsSync(path) && statSync(path).isDirectory()) {
    summary.push("unchanged|.roll/features/");
    return;
  }
  mkdirSync(path, { recursive: true });
  summary.push("created|.roll/features/");
}

// ─── _write_features_md (3572-3591) ───────────────────────────────────────────
const FEATURES_TEMPLATE = `# Features

> 产品视角的功能索引。每次发版时更新，使之与 BACKLOG 保持一致。

---

## Features by Epic

<!-- Add feature entries here as epics are completed -->
`;
function writeFeaturesMd(path: string, summary: Summary): void {
  if (existsSync(path)) {
    summary.push("unchanged|.roll/features.md");
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, FEATURES_TEMPLATE);
  summary.push("created|.roll/features.md");
}

// ─── _init_seed_agent_routes (3456-3476) ──────────────────────────────────────
function initSeedAgentRoutes(templateName: string, projectDir: string, summary: Summary): number {
  const dest = join(projectDir, ".roll", "agent-routes.yaml");
  if (existsSync(dest)) {
    summary.push("unchanged|.roll/agent-routes.yaml");
    return 0;
  }
  const src = join(rollTemplates(), "agent-routes", `${templateName}.yaml`);
  if (!existsSync(src)) {
    // err() here is inside the discarded `{ … } >/dev/null` block in cmd_init,
    // and the call is `… || true` — so a missing template is swallowed.
    return 1;
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  summary.push("created|.roll/agent-routes.yaml");
  return 0;
}

// ─── _write_version_stamp (3497-3515) ─────────────────────────────────────────
function writeVersionStamp(projectDir: string, summary: Summary): void {
  const stampPath = join(projectDir, ".roll", ".version");
  if (existsSync(stampPath)) {
    summary.push("unchanged|.roll/.version");
    return;
  }
  mkdirSync(join(projectDir, ".roll"), { recursive: true });
  const installedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  writeFileSync(
    stampPath,
    `# Roll project version stamp — written by \`roll init\` (US-ONBOARD-019).
# Used by \`_check_structure\` to recognise a previously-onboarded Roll project
# without depending on directory-name heuristics.
roll_version: "${binRollVersion()}"
installed_at: "${installedAt}"
`,
  );
  summary.push("created|.roll/.version");
}

// ─── _sync_conventions (1300-1303) → per-tool convention copy ─────────────────
/** _get_ai_tools: ai_* entries from ROLL_CONFIG, ~→HOME expanded. */
function getAiTools(): string[] {
  const cfg = rollConfig();
  if (!existsSync(cfg)) return [];
  const out: string[] = [];
  for (const line of readFileSync(cfg, "utf8").split("\n")) {
    if (/^ai_[a-z]+:/.test(line)) {
      let entry = line.replace(/^[^:]*:[ \t]*/, "");
      entry = entry.replace(/^~/, homedir());
      out.push(entry);
    }
  }
  return out;
}
function aiField(entry: string, idx: number): string {
  return entry.split("|")[idx] ?? "";
}
/** Port of _sync_convention_for_tool — copies roll.md + ensures @roll.md include. */
function syncConventionForTool(src: string, mainDst: string, force: boolean): void {
  if (!existsSync(src)) return;
  const dstDir = dirname(mainDst);
  // Claude (always) or the convention dir already exists. (_is_ai_installed is a
  // PATH probe we conservatively treat as false here; an existing dir suffices.)
  if (dstDir !== join(homedir(), ".claude") && !existsSync(dstDir)) return;
  mkdirSync(dstDir, { recursive: true });
  const wkFile = join(dstDir, "roll.md");
  const same = existsSync(wkFile) && readFileSync(wkFile, "utf8") === readFileSync(src, "utf8");
  if (force || !same) copyFileSync(src, wkFile);
  if (!existsSync(mainDst)) {
    writeFileSync(mainDst, "@roll.md\n");
  } else if (!readFileSync(mainDst, "utf8").includes("@roll.md")) {
    writeFileSync(mainDst, readFileSync(mainDst, "utf8") + "\n@roll.md\n");
  }
}
/** Returns "ok" unless a sync op throws (mirrors `_sync_conventions || fail`). */
function syncConventions(): "ok" | "fail" {
  try {
    for (const entry of getAiTools()) {
      const aiDir = aiField(entry, 0);
      const cfgName = aiField(entry, 1);
      const src = aiField(entry, 2);
      syncConventionForTool(join(rollGlobal(), src), join(aiDir, cfgName), false);
    }
    return "ok";
  } catch {
    return "fail";
  }
}

// ─── _emit_init_v2_ui (2215-2276) — re-implements lib/roll-init.py ────────────
type StepStatus = "ok" | "skip" | "fail";
interface Step {
  num: number;
  label: string;
  status: StepStatus;
  files?: Array<[string, string]>;
  note?: string;
}
const STATUS_MAP: Record<string, StepStatus> = {
  created: "ok",
  merged: "ok",
  unchanged: "skip",
  overwritten: "ok",
  kept: "skip",
};
const OP_MAP: Record<string, string> = {
  created: "+",
  merged: "~",
  unchanged: "·",
  overwritten: "~",
  kept: "·",
};

function opMarker(op: string): string {
  if (op === "+") return c("green", "+", { bold: true });
  if (op === "~") return c("amber", "~", { bold: true });
  if (op === "·") return c("dim", "·");
  if (op === "✗") return c("red", "✗", { bold: true });
  return c("dim", op);
}
function stepIcon(status: string): string {
  if (status === "ok") return c("green", "✓");
  if (status === "skip") return c("amber", "↷");
  if (status === "fail") return c("red", "✗", { bold: true });
  return c("dim", "·");
}
function fileColor(op: string): string {
  if (op === "+") return "green";
  if (op === "~") return "amber";
  if (op === "✗") return "red";
  return "dim";
}
function divider(char = "─"): string {
  return c("dim", char.repeat(Math.min(COLS, 80)));
}

function emitInitUi(
  projectDir: string,
  hasAgents: boolean,
  syncStatus: StepStatus,
  summary: Summary,
): void {
  const headerLabel = hasAgents ? "REINIT" : "INIT";
  const subtitle = hasAgents ? "重新合并约定" : "项目初始化";
  const footerLabel = hasAgents ? "Re-merged" : "Initialized";

  const byFile = new Map<string, string>();
  for (const entry of summary) {
    const idx = entry.indexOf("|");
    if (idx < 0) continue;
    const action = entry.slice(0, idx);
    const fname = entry.slice(idx + 1);
    if (fname !== "") byFile.set(fname, action);
  }
  const step = (num: number, label: string, fname: string): Step => {
    const act = byFile.get(fname);
    if (act === undefined) return { num, label, status: "skip", note: "not modified" };
    return { num, label, status: STATUS_MAP[act] ?? "ok", files: [[OP_MAP[act] ?? "·", fname]] };
  };
  const steps: Step[] = [
    { num: 1, label: "Detect project type", status: "ok" },
    step(2, "Create AGENTS.md", "AGENTS.md"),
    step(3, "Create .roll/backlog.md", ".roll/backlog.md"),
    step(4, "Create .roll/features/", ".roll/features/"),
    step(5, "Merge existing CLAUDE.md", ".claude/CLAUDE.md"),
    { num: 6, label: "Link skills to AI clients", status: syncStatus },
  ];
  const footerStatus: StepStatus = steps.some((s) => s.status === "fail") ? "fail" : "ok";

  const lines: string[] = [];
  const left =
    "  " + c("blue", headerLabel, { bold: true }) + c("dim", "  ·  ") + c("dim", subtitle);
  const right = c("dim", projectDir) + "  ";
  lines.push(row(left, right));
  lines.push(divider());
  lines.push("");

  for (const s of steps) {
    const num = c("dim", `  ${s.num}.`);
    const icon = stepIcon(s.status);
    lines.push(`${num} ${icon}  ${s.label}`);
    for (const [op, fname] of s.files ?? []) {
      lines.push("       " + opMarker(op) + "  " + c(fileColor(op), fname));
    }
    const note = s.note;
    if (note !== undefined && note !== "") {
      const tone = s.status === "fail" ? "red" : "dim";
      lines.push("       " + c(tone, note));
    }
  }

  lines.push("");
  lines.push(divider());

  const fStatus = footerStatus;
  const fLabel = fStatus === "ok" ? footerLabel : "Init incomplete";
  const iconColor = fStatus === "ok" ? "green" : "red";
  const icon = fStatus === "ok" ? "✓" : "✗";
  lines.push("  " + c(iconColor, icon) + " " + c(iconColor, fLabel, { bold: true }));

  const nextItems: Array<[string, string]> = [
    ["Edit .roll/backlog.md", "open the backlog and add your first US"],
    ["Run roll loop now", "execute one cycle manually to test the flow"],
    ["Enable loop scheduling", "roll loop on  — let it run hourly"],
  ];
  lines.push("");
  lines.push("  " + c("pink", "NEXT", { bold: true }) + c("dim", "  ·  下一步"));
  nextItems.forEach(([label, hint], i) => {
    const num = c("dim", `  ${i + 1}.`);
    lines.push(`${num} ${c("fg", label, { bold: true })}`);
    if (hint !== "") lines.push("     " + c("dim", hint));
  });
  lines.push(divider("═"));

  process.stdout.write(lines.join("\n") + "\n");
}

// ─── cmd_init (2147-2210) ─────────────────────────────────────────────────────
/**
 * Returns the exit code, or `null` to signal the caller it must fall back to
 * bash (legacy onboarding, --apply, and unknown -flags are bash-owned).
 */
export function initCommand(args: string[]): number | null {
  if (args[0] === "--apply") return null; // bash owns _init_apply.
  if (args[0] !== undefined && args[0].startsWith("-")) return null; // bash owns the flag-error msg.

  if (!existsSync(rollTemplates())) return null; // bash owns the no-templates msg.

  let projectDir: string;
  try {
    projectDir = realpathSync(process.cwd());
  } catch {
    projectDir = process.cwd();
  }
  let hasAgents = false;
  const summary: Summary = [];

  if (existsSync(join(projectDir, "AGENTS.md"))) {
    hasAgents = true;
  } else if (isLegacyProject(projectDir)) {
    // Legacy codebase onboarding launches an interactive agent — bash-owned.
    return null;
  }

  // Suppressed step echoes (the `{ … } >/dev/null` block) — outcomes captured
  // into the summary and rendered through the UI below.
  mergeGlobalToProject(projectDir, summary);
  mergeClaudeToProject(projectDir, summary);
  writeBacklog(join(projectDir, ".roll", "backlog.md"), summary);
  ensureFeaturesDir(join(projectDir, ".roll", "features"), summary);
  writeFeaturesMd(join(projectDir, ".roll", "features.md"), summary);
  const routesTemplate = process.env["ROLL_AGENT_ROUTES_TEMPLATE"] ?? "default";
  initSeedAgentRoutes(routesTemplate, projectDir, summary); // `|| true`
  writeVersionStamp(projectDir, summary);

  const syncStatus = syncConventions();

  // _install_launchd_plists: output discarded; darwin side effect not reproduced
  // (see the file header's whitelisted-divergence note).

  // Color decision mirrors _emit_init_v2_ui: NO_COLOR or non-TTY → no color.
  const noColor = (process.env["NO_COLOR"] ?? "") !== "" || !process.stdout.isTTY;
  renderState.useColor = !noColor;
  emitInitUi(projectDir, hasAgents, syncStatus, summary);

  void err;
  return 0;
}
