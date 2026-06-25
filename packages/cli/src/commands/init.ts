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
 * The legacy-codebase onboarding guide and `--apply` path are also owned here:
 * TS launches the selected agent directly, then applies `.roll/onboard-plan.yaml`
 * without entering the frozen bash engine.
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
  readSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  agentsInstalled,
  defaultPairingConfig,
  getAgentSpec,
  renderPairingConfig,
} from "@roll/core";
import { resolveLang, STATUS_MARKER, t, v2Catalog, type Lang } from "@roll/spec";
import { c, renderState, row, COLS } from "../render.js";
import { realAgentEnv } from "./agent-list.js";
import { onPath, rollPkgDir, syncConventions as sharedSyncConventions } from "./setup-shared.js";
import { rollVersion } from "./version.js";
import { resolveProjectName, shouldSelfRegister, writeProjectRow } from "../lib/projects-registry.js";
import { projectSlug } from "./dashboard.js";
import { guideExternalToolSetup, silentPreinstallChromium } from "../lib/external-tools.js";
import { detectDesignHandoff, renderDesignNudge } from "../lib/onboard-nudge.js";
import { discoverInteractiveAgents } from "../lib/interactive-agent.js";

/**
 * FIX-283 (AC4): adopting roll registers the project into `~/.roll/projects.json`
 * immediately, so it appears in the web switcher without waiting for the first
 * `roll index`. Reuses the SAME `writeProjectRow` + the SAME tmp/non-existent
 * skip rule (`shouldSelfRegister`) as `roll index`'s self-register — never a
 * second dialect, never a tmp fixture leaking into the real registry. `roll
 * index` keeps refreshing verdict/releaseTag; init seeds the row (name/slug/path
 * + lastIndexedAt) and never throws into init's main path.
 */
function registerProject(projectDir: string): void {
  try {
    if (!shouldSelfRegister(projectDir)) return;
    writeProjectRow({
      name: resolveProjectName(projectDir),
      slug: projectSlug(projectDir),
      path: projectDir,
      lastIndexedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    });
  } catch {
    /* best-effort — the registry is additive; init still succeeds */
  }
}

// ─── bash UI helpers (bin/roll:41-56) — used only for err() here ─────────────
function err(line: string): void {
  const { RED, NC } = pal();
  process.stderr.write(`${RED}[roll]${NC} ${line}\n`);
}
function info(line: string): void {
  const { CYAN, NC } = pal();
  process.stdout.write(`${CYAN}[roll]${NC} ${line}\n`);
}
function ok(line: string): void {
  const { GREEN, NC } = pal();
  process.stdout.write(`${GREEN}[roll]${NC} ${line}\n`);
}
function warn(line: string): void {
  const { YELLOW, NC } = pal();
  process.stderr.write(`${YELLOW}[roll]${NC} ${line}\n`);
}
function pal(): {
  RED: string;
  GREEN: string;
  YELLOW: string;
  CYAN: string;
  BOLD: string;
  NC: string;
} {
  const noColor = (process.env["NO_COLOR"] ?? "") !== "";
  return noColor
    ? { RED: "", GREEN: "", YELLOW: "", CYAN: "", BOLD: "", NC: "" }
    : {
        RED: "\x1b[0;31m",
        GREEN: "\x1b[0;32m",
        YELLOW: "\x1b[0;33m",
        CYAN: "\x1b[0;36m",
        BOLD: "\x1b[1m",
        NC: "\x1b[0m",
      };
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

function initMergeSummaryTitle(): string {
  return msgLang() === "zh" ? "Roll 约定同步摘要" : "Roll convention sync summary";
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

function legacyFileSummary(projectDir: string): string {
  const parts: string[] = [];
  for (const dir of ["src", "app", "lib", "pkg", "cmd"]) {
    const p = join(projectDir, dir);
    if (existsSync(p) && statSync(p).isDirectory()) {
      const count = countNonEmptyFiles(p);
      if (count >= 10) parts.push(`${count} files in ${dir}/`);
    }
  }
  const manifests = [
    "package.json", "pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "Pipfile",
    "go.mod", "Cargo.toml", "Gemfile", "pom.xml", "build.gradle", "build.gradle.kts",
    "Makefile", "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
    "app.json", "project.config.json", "mix.exs", "composer.json", "deno.json", "deno.jsonc",
  ];
  for (const man of manifests) {
    if (existsSync(join(projectDir, man))) {
      parts.push(`manifest: ${man}`);
      break;
    }
  }
  try {
    if (readdirSync(projectDir).some((name) => name.endsWith(".tf"))) parts.push("Terraform .tf files");
  } catch {
    /* ignore */
  }
  if (
    parts.length === 0 &&
    existsSync(join(projectDir, ".git")) &&
    spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: projectDir, stdio: "ignore" }).status === 0
  ) {
    parts.push("git history present");
  }
  return `no AGENTS.md, ${parts.join(" ")}`;
}

function discoverOnboardAgents(): { installed: string[]; missing: string[] } {
  return discoverInteractiveAgents();
}

function readLineFromStdin(): string | null {
  const chunks: number[] = [];
  const buf = Buffer.alloc(1);
  while (true) {
    let n = 0;
    try {
      n = readSync(0, buf, 0, 1, null);
    } catch {
      return null;
    }
    if (n === 0) return chunks.length === 0 ? null : Buffer.from(chunks).toString("utf8");
    const b = buf[0] ?? 0;
    if (b === 10) break;
    if (b !== 13) chunks.push(b);
  }
  return Buffer.from(chunks).toString("utf8");
}

function selectOnboardAgent(candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  const forced = process.env["ROLL_ONBOARD_AGENT"] ?? "";
  if (forced !== "") {
    if (candidates.includes(forced)) return forced;
    err(`ROLL_ONBOARD_AGENT='${forced}' is not in installed agents.`);
    return null;
  }
  if (candidates.length === 1) return candidates[0] ?? null;

  process.stderr.write(`${m("init.pick_an_agent")}\n`);
  candidates.forEach((candidate, index) => {
    process.stderr.write(`    ${index + 1}) ${candidate}\n`);
  });
  process.stderr.write(`  Enter number [1-${candidates.length}]: `);
  const choice = readLineFromStdin();
  if (choice === null) {
    err(m("init.no_input_received_aborting_onboard"));
    return null;
  }
  const n = Number(choice);
  if (!Number.isInteger(n) || n < 1 || n > candidates.length) {
    err(m("init.invalid_choice", choice));
    return null;
  }
  return candidates[n - 1] ?? null;
}

function readOnboardPrompt(): string | null {
  const skillFile = join(rollPkgDir(), "skills", "roll-onboard", "SKILL.md");
  if (!existsSync(skillFile)) {
    err(`Skill file missing: ${skillFile}`);
    return null;
  }
  const body = readFileSync(skillFile, "utf8").replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  return `Run the $roll-onboard skill below for this project. Follow it end-to-end and write .roll/onboard-plan.yaml when done.\n\n${body}`;
}

function kimiBin(): string {
  if (onPath("kimi-code")) return "kimi-code";
  if (onPath("kimi-cli")) return "kimi-cli";
  return "kimi";
}

function interactiveAgentCommand(agent: string, prompt: string): { bin: string; args: string[] } | null {
  const canonical = getAgentSpec(agent.trim().toLowerCase())?.name ?? agent;
  switch (canonical) {
    case "claude":
      return { bin: "claude", args: [prompt] };
    case "kimi":
      return { bin: kimiBin(), args: [prompt] };
    case "codex":
      return { bin: "codex", args: ["exec", prompt] };
    case "pi":
      return { bin: "pi", args: [prompt] };
    case "agy":
      return { bin: "agy", args: [prompt] };
    case "reasonix":
      return { bin: "reasonix", args: [prompt] };
    default:
      return null;
  }
}

function onboardFailureHint(agent: string, code: number): void {
  process.stderr.write("\n");
  if (code === 130) err(m("init.onboard_cancelled"));
  else err(m("init.onboard_agent_exited", agent, code));
  process.stderr.write("\n");
  process.stderr.write(`  ${m("init.onboard_next_step")}\n`);
  process.stderr.write(`    - ${m("init.onboard_retry")}\n`);
  process.stderr.write(`    - ${m("init.onboard_retry_en")}\n`);
  process.stderr.write(`    - ${m("init.onboard_switch")}\n`);
  process.stderr.write(`    - ${m("init.onboard_switch_en")}\n`);
  process.stderr.write("\n");
}

function runOnboardAgent(agent: string, projectDir: string): number {
  const prompt = readOnboardPrompt();
  if (prompt === null) return 1;
  const cmd = interactiveAgentCommand(agent, prompt);
  if (cmd === null) {
    err(m("init.agent_has_no_interactive_mode_wired", agent));
    return 1;
  }
  const result = spawnSync(cmd.bin, cmd.args, {
    cwd: projectDir,
    stdio: "inherit",
    env: process.env,
  });
  const rc = result.status ?? (result.signal === null ? 1 : 130);
  if (rc !== 0) {
    onboardFailureHint(agent, rc);
    return rc;
  }
  if (!existsSync(join(projectDir, ".roll", "onboard-plan.yaml"))) {
    process.stderr.write("\n");
    err("Agent exited cleanly but did not write .roll/onboard-plan.yaml.");
    err(m("init.agent"));
    process.stderr.write("  Re-run `roll init` once you've completed the conversation.\n");
    process.stderr.write(`${m("init.en_roll_init")}\n`);
    return 1;
  }
  process.stderr.write("\n");
  info(m("init.plan_written_running_apply"));
  return initApply(projectDir);
}

function legacyOnboardGuide(projectDir: string): number {
  const { GREEN, RED, NC } = pal();
  info(m("init.detected_legacy_project", legacyFileSummary(projectDir)));
  process.stdout.write("\n");
  const { installed, missing } = discoverOnboardAgents();
  process.stdout.write(`${m("init.onboarding")}\n`);
  process.stdout.write("  Onboarding requires an AI agent to read your code. Detected:\n\n");
  for (const name of installed) process.stdout.write(`    ${GREEN}✓${NC} ${name}   (installed)\n`);
  for (const name of missing) process.stdout.write(`    ${RED}✗${NC} ${name}   (not found)\n`);
  if (installed.length === 0) {
    process.stdout.write("\n");
    err("No AI agent detected. Install one (e.g., 'claude', 'kimi', 'pi') and try again.");
    err(m("init.no_ai_agent_detected_install_one"));
    return 1;
  }
  process.stdout.write("\n");
  process.stdout.write(`${m("init.the_process_will_use_your_agent")}\n`);
  process.stdout.write("  Onboarding uses your agent to call models — tokens are billed to your account.\n\n");
  process.stdout.write(`${m("init.code_and_conversations_stay_in_your")}\n`);
  process.stdout.write("  Your code and conversation stay in your agent — Roll never uploads anything.\n\n");

  const chosen = selectOnboardAgent(installed);
  if (chosen === null) return 1;
  process.stdout.write("\n");
  info(m("init.launching", chosen));
  process.stdout.write("  Conversation ends with /exit (or Ctrl-C). On exit Roll will run apply for you.\n");
  process.stdout.write(`${m("init.use_exit_to_end_or_ctrl")}\n\n`);
  return runOnboardAgent(chosen, projectDir);
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
roll_version: "${rollVersion() || "unknown"}"
installed_at: "${installedAt}"
`,
  );
  summary.push("created|.roll/.version");
}

// ─── US-PAIR-008: scaffold .roll/pairing.yaml during onboarding ──────────────
/**
 * Cross-agent pairing is a first-class quality feature, so a new project gets
 * its config at init time — no separate `roll pair init` step. Stays EXPLICIT
 * (a real, self-documenting file the user sees + the UI announces it) rather
 * than an invisible default-on. Idempotent: never clobbers an existing file.
 * A v3 divergence from the frozen v2 oracle (init.difftest accounts for it).
 */
function scaffoldPairing(projectDir: string, summary: Summary): void {
  const path = join(projectDir, ".roll", "pairing.yaml");
  if (existsSync(path)) {
    summary.push("unchanged|.roll/pairing.yaml");
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderPairingConfig(defaultPairingConfig(agentsInstalled(realAgentEnv()))));
  summary.push("created|.roll/pairing.yaml");
}

// ─── _sync_conventions (1300-1303) — shared with setup.ts ────────────────────
/**
 * Returns "ok" unless a sync op throws (mirrors `_sync_conventions || fail`).
 * Delegates to the shared port (setup-shared.ts) so init + setup run the exact
 * same per-tool copy logic the oracle does (`_sync_one_tool`). init never
 * forces.
 */
function syncConventions(): "ok" | "fail" {
  try {
    sharedSyncConventions(false);
    return "ok";
  } catch {
    return "fail";
  }
}

type ChangesetSection =
  | "scope_approved"
  | "files_created"
  | "dirs_created"
  | "gitignore_entries_added"
  | "launchd_plists_installed";

interface OnboardChangeset {
  onboardedAt: string;
  rollVersion: string;
  scopeApproved: string[];
  filesCreated: string[];
  dirsCreated: string[];
  gitignoreEntriesAdded: string[];
  launchdPlistsInstalled: string[];
}

function changesetPath(projectDir: string): string {
  return join(projectDir, ".roll", "onboard-changeset.yaml");
}

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function renderYamlList(name: string, values: string[]): string {
  if (values.length === 0) return `${name}: []\n`;
  return `${name}:\n${values.map((v) => `  - "${v.replace(/"/g, '\\"')}"`).join("\n")}\n`;
}

function renderChangeset(changeset: OnboardChangeset): string {
  return (
    "# Generated by `roll init --apply`. Used by `roll offboard` to reverse\n" +
    "# the changes onboard made. Do not edit by hand.\n" +
    `onboarded_at: "${changeset.onboardedAt}"\n` +
    `roll_version: "${changeset.rollVersion}"\n` +
    renderYamlList("scope_approved", changeset.scopeApproved) +
    renderYamlList("files_created", changeset.filesCreated) +
    renderYamlList("dirs_created", changeset.dirsCreated) +
    renderYamlList("gitignore_entries_added", changeset.gitignoreEntriesAdded) +
    renderYamlList("launchd_plists_installed", changeset.launchdPlistsInstalled)
  );
}

function writeChangeset(projectDir: string, changeset: OnboardChangeset): void {
  const path = changesetPath(projectDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderChangeset(changeset));
}

function beginChangeset(projectDir: string): OnboardChangeset {
  const changeset: OnboardChangeset = {
    onboardedAt: isoNow(),
    rollVersion: rollVersion() || "unknown",
    scopeApproved: [],
    filesCreated: [],
    dirsCreated: [],
    gitignoreEntriesAdded: [],
    launchdPlistsInstalled: [],
  };
  writeChangeset(projectDir, changeset);
  return changeset;
}

function recordChangeset(projectDir: string, changeset: OnboardChangeset, section: ChangesetSection, value: string): void {
  const target =
    section === "scope_approved"
      ? changeset.scopeApproved
      : section === "files_created"
        ? changeset.filesCreated
        : section === "dirs_created"
          ? changeset.dirsCreated
          : section === "gitignore_entries_added"
            ? changeset.gitignoreEntriesAdded
            : changeset.launchdPlistsInstalled;
  target.push(value);
  writeChangeset(projectDir, changeset);
}

interface PlanFields {
  approved: string[];
  gitignoreDotRoll: boolean;
  agentRoutesTemplate: string;
}

function readPlanFields(plan: string): PlanFields {
  const script = `
import json, sys, yaml
p = yaml.safe_load(open(sys.argv[1])) or {}
print(json.dumps({
  "approved": p.get("scope", {}).get("approved", []) or [],
  "gitignoreDotRoll": bool(p.get("privacy", {}).get("gitignore_dot_roll", False)),
  "agentRoutesTemplate": p.get("agent_routes_template", "") or "",
}))
`;
  const r = spawnSync("python3", ["-c", script, plan], { encoding: "utf8" });
  if (r.status !== 0) return { approved: [], gitignoreDotRoll: false, agentRoutesTemplate: "" };
  try {
    const parsed = JSON.parse(r.stdout) as Partial<PlanFields>;
    return {
      approved: Array.isArray(parsed.approved) ? parsed.approved.filter((v): v is string => typeof v === "string") : [],
      gitignoreDotRoll: parsed.gitignoreDotRoll === true,
      agentRoutesTemplate: typeof parsed.agentRoutesTemplate === "string" ? parsed.agentRoutesTemplate : "",
    };
  } catch {
    return { approved: [], gitignoreDotRoll: false, agentRoutesTemplate: "" };
  }
}

function runPythonScript(scriptPath: string, args: string[]): number {
  const r = spawnSync("python3", [scriptPath, ...args], { encoding: "utf8" });
  if (r.stdout !== undefined && r.stdout !== "") process.stdout.write(r.stdout);
  if (r.stderr !== undefined && r.stderr !== "") process.stderr.write(r.stderr);
  return r.status ?? 1;
}

function printMergeSummary(summary: Summary): void {
  if (summary.length === 0) return;
  const { GREEN, YELLOW, CYAN, NC } = pal();
  process.stdout.write("\n");
  process.stdout.write(`${initMergeSummaryTitle()}\n`);
  for (const entry of summary) {
    const idx = entry.indexOf("|");
    const action = idx >= 0 ? entry.slice(0, idx) : entry;
    const file = idx >= 0 ? entry.slice(idx + 1) : "";
    if (action === "merged") process.stdout.write(`  │  ${GREEN}✦ merged${NC}      ${file.padEnd(30)}│\n`);
    else if (action === "created") process.stdout.write(`  │  ${GREEN}+ created${NC}     ${file.padEnd(30)}│\n`);
    else if (action === "overwritten") process.stdout.write(`  │  ${YELLOW}↺ overwritten${NC} ${file.padEnd(30)}│\n`);
    else if (action === "kept") process.stdout.write(`  │  ${CYAN}· kept${NC}        ${file.padEnd(30)}│\n`);
    else if (action === "unchanged") process.stdout.write(`  │    unchanged    ${file.padEnd(30)}│\n`);
  }
  process.stdout.write("  └─────────────────────────────────────────────────────┘\n");
}

function seedBacklogRow(backlog: string, heading: string, row: string, id: string): boolean {
  if (!existsSync(backlog)) return false;
  const text = readFileSync(backlog, "utf8");
  if (text.includes(`| ${id} |`)) return false;
  const lines = text.split("\n");
  let seen = false;
  let inserted = false;
  const out: string[] = [];
  for (const line of lines) {
    out.push(line);
    if (line === heading) seen = true;
    else if (seen && !inserted && /^\|-+\|-+\|-+\|$/.test(line)) {
      out.push(row);
      inserted = true;
    }
  }
  if (!inserted) out.push(row);
  writeFileSync(backlog, out.join("\n"));
  return true;
}

function seedBacklogStory(backlog: string, id: string, title: string): boolean {
  return seedBacklogRow(
    backlog,
    "## Epic: Initial Setup",
    `| ${id} | ${title} | ${STATUS_MARKER.todo} |`,
    id,
  );
}

function seedBacklogFix(backlog: string, id: string, title: string): boolean {
  return seedBacklogRow(backlog, "## Bug Fixes", `| ${id} | ${title} | ${STATUS_MARKER.todo} |`, id);
}

function confirmSeed(count: number, noun: "story" | "fix", ids: string[], titles: string[]): boolean {
  process.stderr.write("\n");
  warn(noun === "fix" ? m("init.onboard_seed_preview_fix", count) : m("init.onboard_seed_preview_story", count));
  ids.forEach((id, index) => {
    process.stderr.write(`    ${id}  ${titles[index] ?? ""}\n`);
  });
  process.stderr.write("\n");
  if ((process.env["ROLL_ASSUME_TTY"] ?? "") !== "1" && process.stdin.isTTY !== true) {
    process.stderr.write(`${m("init.onboard_seed_noninteractive")}\n`);
    return false;
  }
  const { BOLD, NC } = pal();
  process.stderr.write(`  ${BOLD}${m("init.onboard_seed_prompt")}${NC} [y/N] \n`);
  const reply = readLineFromStdin() ?? "";
  return reply === "y" || reply === "Y" || reply === "yes" || reply === "YES";
}

function renderAndSeed(projectDir: string, plan: string, changeset: OnboardChangeset): void {
  const renderer = join(rollPkgDir(), "lib", "roll-onboard-render.py");
  if (!existsSync(renderer)) return;
  const r = spawnSync("python3", [renderer, plan, projectDir], { encoding: "utf8" });
  if (r.status === 2) return;
  if (r.status !== 0) {
    if (r.stderr !== undefined && r.stderr !== "") process.stderr.write(r.stderr);
    warn(m("init.onboard_render_failed"));
    return;
  }
  const seedIds: string[] = [];
  const seedTitles: string[] = [];
  const fixIds: string[] = [];
  const fixTitles: string[] = [];
  for (const raw of (r.stdout ?? "").split("\n")) {
    if (raw === "") continue;
    const [kind, a = "", b = ""] = raw.split("|");
    if (kind === "FILE") {
      recordChangeset(projectDir, changeset, "files_created", a);
      ok(m("init.onboard_rendered", a));
    } else if (kind === "SEED") {
      seedIds.push(a);
      seedTitles.push(b);
    } else if (kind === "FIX") {
      fixIds.push(a);
      fixTitles.push(b);
    }
  }
  const backlog = join(projectDir, ".roll", "backlog.md");
  if (seedIds.length > 0) {
    if (!existsSync(backlog)) info(m("init.onboard_seed_no_backlog"));
    else if (confirmSeed(seedIds.length, "story", seedIds, seedTitles)) {
      let seeded = 0;
      seedIds.forEach((id, index) => {
        if (seedBacklogStory(backlog, id, seedTitles[index] ?? "")) seeded += 1;
      });
      ok(m("init.onboard_seeded_stories", seeded));
    } else info(m("init.onboard_seed_cancelled"));
  }
  if (fixIds.length > 0) {
    if (!existsSync(backlog)) info(m("init.onboard_seed_no_backlog"));
    else if (confirmSeed(fixIds.length, "fix", fixIds, fixTitles)) {
      let seeded = 0;
      fixIds.forEach((id, index) => {
        if (seedBacklogFix(backlog, id, fixTitles[index] ?? "")) seeded += 1;
      });
      ok(m("init.onboard_seeded_fixes", seeded));
    } else info(m("init.onboard_seed_cancelled"));
  }
}

function addRollToGitignore(projectDir: string, changeset: OnboardChangeset): void {
  const gi = join(projectDir, ".gitignore");
  const current = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (current.split("\n").includes(".roll/")) return;
  writeFileSync(gi, current + (current === "" || current.endsWith("\n") ? "" : "\n") + ".roll/\n");
  recordChangeset(projectDir, changeset, "gitignore_entries_added", ".roll/");
  ok(m("init.added_roll_to_gitignore"));
}

function initApply(projectDir: string): number {
  const plan = join(projectDir, ".roll", "onboard-plan.yaml");
  const validator = join(rollPkgDir(), "lib", "roll-plan-validate.py");
  if (!existsSync(plan)) {
    err(m("init.no_onboard_plan_found_at_roll"));
    process.stderr.write("\n");
    process.stderr.write("  Run $roll-onboard in your AI agent first to generate the plan.\n");
    process.stderr.write(`${m("init.en_ai_agent_onboard_plan_ap", "$roll")}\n`);
    return 1;
  }
  if (!existsSync(validator)) {
    err(m("init.plan_validator_missing", validator));
    return 1;
  }
  if (runPythonScript(validator, [plan]) !== 0) {
    err(m("init.plan_validation_failed_see_errors_above"));
    process.stderr.write("\n");
    process.stderr.write("  If the plan is stale (>24h), regenerate by running $roll-onboard again.\n");
    return 1;
  }
  info(m("init.applying_onboard_plan"));
  const summary: Summary = [];
  const changeset = beginChangeset(projectDir);
  const fields = readPlanFields(plan);
  for (const item of fields.approved) recordChangeset(projectDir, changeset, "scope_approved", item);

  mergeGlobalToProject(projectDir, summary);
  mergeClaudeToProject(projectDir, summary);

  const stamp = join(projectDir, ".roll", ".version");
  const stampExisted = existsSync(stamp);
  writeVersionStamp(projectDir, summary);
  if (!stampExisted && existsSync(stamp)) recordChangeset(projectDir, changeset, "files_created", ".roll/.version");

  const approved = new Set(fields.approved);
  if (approved.has("backlog")) {
    writeBacklog(join(projectDir, ".roll", "backlog.md"), summary);
    recordChangeset(projectDir, changeset, "files_created", ".roll/backlog.md");
  }
  let routesTemplate = fields.agentRoutesTemplate;
  if (routesTemplate === "") routesTemplate = process.env["ROLL_AGENT_ROUTES_TEMPLATE"] ?? "default";
  if (routesTemplate !== "skip") {
    if (initSeedAgentRoutes(routesTemplate, projectDir, summary) === 0) {
      recordChangeset(projectDir, changeset, "files_created", ".roll/agent-routes.yaml");
    }
  }
  if (approved.has("features")) {
    ensureFeaturesDir(join(projectDir, ".roll", "features"), summary);
    writeFeaturesMd(join(projectDir, ".roll", "features.md"), summary);
    recordChangeset(projectDir, changeset, "dirs_created", ".roll/features");
    recordChangeset(projectDir, changeset, "files_created", ".roll/features.md");
  }
  if (approved.has("domain")) {
    mkdirSync(join(projectDir, ".roll", "domain"), { recursive: true });
    recordChangeset(projectDir, changeset, "dirs_created", ".roll/domain");
  }
  if (approved.has("briefs")) {
    mkdirSync(join(projectDir, ".roll", "briefs"), { recursive: true });
    recordChangeset(projectDir, changeset, "dirs_created", ".roll/briefs");
  }

  renderAndSeed(projectDir, plan, changeset);
  printMergeSummary(summary);

  if (fields.gitignoreDotRoll) addRollToGitignore(projectDir, changeset);

  process.stdout.write("\n");
  info(m("init.syncing_conventions_to_ai_tools"));
  syncConventions();

  // FIX-283 (AC4): the legacy-onboard adoption path also registers the project.
  registerProject(projectDir);

  process.stdout.write("\n");
  ok(m("init.onboard_apply_complete_onboard"));
  return 0;
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
  shouldNudge: boolean,
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
    step(7, "Scaffold cross-agent pairing", ".roll/pairing.yaml"),
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

  const nudgeMsg = shouldNudge ? (renderDesignNudge(msgLang())[0] ?? "") : "";
  const nudgePair: [string, string] | undefined =
    shouldNudge && nudgeMsg !== ""
      ? ((): [string, string] => {
          const sep = nudgeMsg.indexOf(" — ");
          if (sep < 0) return [nudgeMsg, ""];
          return [nudgeMsg.slice(0, sep), nudgeMsg.slice(sep + 3)];
        })()
      : undefined;
  const nextItems: Array<[string, string]> = [
    ...(nudgePair ? [nudgePair] : []),
    ["Edit .roll/backlog.md", "open the backlog and add your first US"],
    ["Run roll loop now", "execute one cycle manually to test the flow"],
    ["Enable loop scheduling", "roll loop on  — let it run hourly"],
    ["Run roll pair status", "see the cross-agent pairing pool and what it cost"],
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
 * Returns the exit code for the fully ported init surface.
 */
export function initCommand(args: string[]): number {
  if (args[0] === "--apply") {
    if (!existsSync(rollTemplates())) {
      err(m("init.no_templates_found_run_roll_setup"));
      return 1;
    }
    let projectDir: string;
    try {
      projectDir = realpathSync(process.cwd());
    } catch {
      projectDir = process.cwd();
    }
    return initApply(projectDir);
  }
  if (args[0] !== undefined && args[0].startsWith("-")) {
    // FIX-238 AC2: name the offending flag (the empty-name message was useless).
    err(`${m("init.unknown_flag_1")}${args[0]}`);
    return 1;
  }

  if (!existsSync(rollTemplates())) {
    err(m("init.no_templates_found_run_roll_setup_2"));
    return 1;
  }

  let projectDir: string;
  try {
    projectDir = realpathSync(process.cwd());
  } catch {
    projectDir = process.cwd();
  }
  guideExternalToolSetup("init");
  // FIX-394 AC2: best-effort silent Chromium pre-install so the first
  // cycle that needs a web screenshot doesn't download 100-200 MB on the
  // critical path. Never blocks init.
  silentPreinstallChromium();
  let hasAgents = false;
  const summary: Summary = [];

  if (existsSync(join(projectDir, "AGENTS.md"))) {
    hasAgents = true;
  } else if (isLegacyProject(projectDir)) {
    return legacyOnboardGuide(projectDir);
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
  scaffoldPairing(projectDir, summary); // US-PAIR-008 (v3 divergence from v2)

  const syncStatus = syncConventions();

  // _install_launchd_plists: output discarded; darwin side effect not reproduced
  // (see the file header's whitelisted-divergence note).

  // FIX-283 (AC4): register this project in the cross-project switcher registry.
  registerProject(projectDir);

  // US-ONBOARD-NUDGE-002: detect PRD + empty-backlog signal for NEXT nudge.
  const shouldNudge = detectDesignHandoff(projectDir).shouldNudge;

  // Color decision mirrors _emit_init_v2_ui: NO_COLOR or non-TTY → no color.
  const noColor = (process.env["NO_COLOR"] ?? "") !== "" || !process.stdout.isTTY;
  renderState.useColor = !noColor;
  emitInitUi(projectDir, hasAgents, syncStatus, summary, shouldNudge);

  void err;
  return 0;
}
