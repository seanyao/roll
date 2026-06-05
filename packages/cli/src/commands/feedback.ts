/**
 * `roll feedback` — TS port of bin/roll cmd_feedback (14257-14335) plus its
 * helpers: _feedback_origin_repo (14163-14179), _feedback_yaml_field
 * (14187-14194), _feedback_default_repo (14196-14215), _feedback_label_for_type
 * (14218-14225), _feedback_urlencode (14228-14230), _feedback_env_block
 * (14235-14255), and _project_agent (4480-4492).
 *
 * Opens a GitHub issue from the CLI. Two execution paths mirror the oracle:
 *   - --print-url OR `gh` missing → print the prefilled github.com/.../issues/new
 *     URL with title/body/labels percent-encoded (python urllib quote safe="").
 *   - otherwise → `gh issue create --repo R --title T --body B --label L`.
 *
 * The gh invocation is dispatched through a small `runGh` indirection so the
 * difftests can shim it (a PATH-installed fake `gh` records argv and returns a
 * canned URL); the composed body is byte-compared via that recording shim.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { rollVersion } from "./version.js";

function err(line: string): void {
  const noColor = (process.env["NO_COLOR"] ?? "") !== "";
  const RED = noColor ? "" : "\x1b[0;31m";
  const NC = noColor ? "" : "\x1b[0m";
  process.stderr.write(`${RED}[roll]${NC} ${line}\n`);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Port of _project_agent (4480-4492). Reads cwd-relative config then global. */
function projectAgent(): string {
  const readField = (file: string, key: RegExp): string | undefined => {
    if (!existsSync(file)) return undefined;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return undefined;
    }
    for (const line of text.split("\n")) {
      if (key.test(line)) {
        // grep "^key:" | awk '{print $2}' | tr -d '"' | head -1
        const fields = line.trim().split(/\s+/);
        return (fields[1] ?? "").replace(/"/g, "");
      }
    }
    return undefined;
  };
  const local = ".roll/local.yaml";
  if (existsSync(local) && /^agent:/m.test(safeRead(local))) {
    return readField(local, /^agent:/) ?? "claude";
  }
  if (existsSync(".roll.yaml") && /^agent:/m.test(safeRead(".roll.yaml"))) {
    return readField(".roll.yaml", /^agent:/) ?? "claude";
  }
  const cfg = rollConfig();
  if (existsSync(cfg) && /primary_agent:/.test(safeRead(cfg))) {
    return readField(cfg, /primary_agent:/) ?? "claude";
  }
  return "claude";
}

function safeRead(p: string): string {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function rollConfig(): string {
  // bin/roll: ROLL_CONFIG = ${ROLL_HOME:-~/.roll}/config.yaml.
  const rollHome = process.env["ROLL_HOME"] ?? join(homedir(), ".roll");
  return join(rollHome, "config.yaml");
}

/** Port of _feedback_yaml_field (awk: first `key:` line, strip quotes). */
function feedbackYamlField(file: string, field: string): string {
  if (!existsSync(file)) return "";
  const text = safeRead(file);
  for (const line of text.split("\n")) {
    if (line.startsWith(`${field}:`)) {
      let v = line.replace(new RegExp(`^${escapeRegExp(field)}:[ \\t]*`), "");
      // gsub("^[\"']|[\"']$") — strip one leading and one trailing quote each.
      v = v.replace(/^["']/, "").replace(/["']$/, "");
      return v;
    }
  }
  return "";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Port of _feedback_origin_repo. */
function feedbackOriginRepo(): string {
  let url: string;
  try {
    url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
  if (url.startsWith("git@github.com:")) {
    return stripGitSuffix(url.slice("git@github.com:".length));
  }
  if (url.startsWith("https://github.com/")) {
    return stripGitSuffix(url.slice("https://github.com/".length));
  }
  return "";
}

function stripGitSuffix(s: string): string {
  return s.endsWith(".git") ? s.slice(0, -4) : s;
}

/** Port of _feedback_default_repo precedence chain. */
function feedbackDefaultRepo(): string {
  const fromEnv = process.env["ROLL_FEEDBACK_REPO"];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  let v = feedbackYamlField(".roll/local.yaml", "feedback_repo");
  if (v) return v;
  v = feedbackYamlField(join(homedir(), ".roll", "config.yaml"), "feedback_repo");
  if (v) return v;
  return feedbackOriginRepo();
}

/** Port of _feedback_label_for_type. */
function labelForType(type: string): string {
  switch (type) {
    case "bug":
      return "bug,FIX";
    case "idea":
      return "idea,enhancement,US";
    case "ux":
      return "ux,enhancement";
    default:
      return "feedback";
  }
}

/** Port of _feedback_urlencode: python urllib.parse.quote(s, safe=""). */
export function urlencode(s: string): string {
  let out = "";
  const bytes = Buffer.from(s, "utf8");
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    // Always-safe set for quote(safe=""): A-Z a-z 0-9 _ . - ~
    if (
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x61 && b <= 0x7a) ||
      (b >= 0x30 && b <= 0x39) ||
      c === "_" ||
      c === "." ||
      c === "-" ||
      c === "~"
    ) {
      out += c;
    } else {
      out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

/** Port of _feedback_env_block. The trailing newline-prefixed `---` block. */
function feedbackEnvBlock(): string {
  // FIX-202: same package.json-first probe the env block's `roll version:` line
  // now uses in the oracle ($VERSION resolved from package.json near bin/roll top).
  const rollV = rollVersion() || "unknown";
  let osName = "unknown";
  try {
    osName = execFileSync("uname", ["-srm"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "unknown";
  } catch {
    osName = "unknown";
  }
  const shellName = basename(process.env["SHELL"] ?? "/bin/sh");
  const agent = projectAgent() || "unknown";
  const lang = process.env["LANG"] ?? process.env["LC_ALL"] ?? "unknown";
  let project = "unknown";
  try {
    project = basename(execFileSync("pwd", ["-P"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {
    project = basename(process.cwd());
  }
  // bin/roll composes `body="${body}$(_feedback_env_block)"`. The heredoc body
  // is `\n---\n\n### Environment\n...\n- project: X\n`, and `$(...)` strips the
  // TRAILING newline(s) (but not the single leading one). So the appended text
  // is exactly: one leading "\n", then "---", a blank line, the section, and NO
  // trailing newline. Mirror those bytes precisely.
  return [
    "",
    "---",
    "",
    "### Environment",
    `- roll version: ${rollV}`,
    `- OS: ${osName}`,
    `- shell: ${shellName}`,
    `- current agent: ${agent}`,
    `- language: ${lang}`,
    `- project: ${project}`,
  ].join("\n");
}

const HELP = `Usage: roll feedback [options]
        roll feedback (一句话提反馈)

Open a GitHub issue from the CLI. Type auto-labels (bug → FIX label;
idea → US label; ux → ux label).

Options:
  --type <bug|idea|ux>      Classify the feedback (default: bug)
  --title <text>            Issue title (required)
  --body <text>             Issue body
  --repo <owner/repo>       Target repo (default: derived from origin)
  --no-env                  Skip the auto-attached Environment section
                            (roll version, OS, agent, language, project)
  --print-url               Print the prefilled github.com URL instead of
                            invoking \`gh\`. Falls back to this automatically
                            when \`gh\` is not installed.
`;

/** Whether gh is on PATH (command -v gh). */
function ghAvailable(): boolean {
  const r = spawnSync("gh", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

/** Indirection over `gh issue create` so tests can record argv (shim on PATH). */
function runGh(args: string[]): number {
  const r = spawnSync("gh", args, { stdio: "inherit" });
  return r.status ?? 1;
}

export function feedbackCommand(args: string[]): number {
  let type = "";
  let title = "";
  let body = "";
  let repo = "";
  let printUrl = false;
  let attachEnv = true;

  let i = 0;
  while (i < args.length) {
    const a = args[i];
    switch (a) {
      case "--type":
        type = args[i + 1] ?? "";
        i += 2;
        break;
      case "--title":
        title = args[i + 1] ?? "";
        i += 2;
        break;
      case "--body":
        body = args[i + 1] ?? "";
        i += 2;
        break;
      case "--repo":
        repo = args[i + 1] ?? "";
        i += 2;
        break;
      case "--no-env":
        attachEnv = false;
        i += 1;
        break;
      case "--print-url":
        printUrl = true;
        i += 1;
        break;
      case "--help":
      case "-h":
        process.stdout.write(HELP);
        return 0;
      default:
        err(`feedback: unknown flag ${a}`);
        return 1;
    }
  }

  if (title === "") {
    err("feedback: --title is required");
    return 1;
  }
  if (type === "") type = "bug";
  if (type !== "bug" && type !== "idea" && type !== "ux") {
    err(`feedback: unknown --type '${type}' (expected one of: bug, idea, ux)`);
    return 1;
  }

  if (repo === "") repo = feedbackDefaultRepo();
  if (repo === "") {
    err("feedback: cannot derive owner/repo from origin; pass --repo owner/repo");
    return 1;
  }

  if (attachEnv) body = `${body}${feedbackEnvBlock()}`;

  const labels = labelForType(type);

  if (printUrl || !ghAvailable()) {
    const tEnc = urlencode(title);
    const bEnc = urlencode(body);
    const lEnc = urlencode(labels);
    process.stdout.write(
      `https://github.com/${repo}/issues/new?title=${tEnc}&body=${bEnc}&labels=${lEnc}\n`,
    );
    return 0;
  }

  return runGh(["issue", "create", "--repo", repo, "--title", title, "--body", body, "--label", labels]);
}
