/**
 * `roll agent list` — TS port of bin/roll cmd_agent `list)` arm (US-CLI-002).
 * Lists the known agent registry with installed/current markers, byte-aligned
 * with the bash oracle (colors honor NO_COLOR exactly like bin/roll does).
 */
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { type AgentEnv } from "@roll/core";
import { resolveLang, t, v2Catalog, type Lang } from "@roll/spec";

// ── i18n (mirrors bash msg/_i18n_resolve_lang inputs) ───────────────────────
function configLang(): string | undefined {
  const rollHome = process.env["ROLL_HOME"] ?? join(homedir(), ".roll");
  const cfg = join(rollHome, "config.yaml");
  if (!existsSync(cfg)) return undefined;
  for (const line of readFileSync(cfg, "utf8").split("\n")) {
    const m = /^lang:\s*(.*)$/.exec(line);
    if (m !== null) {
      const v = (m[1] ?? "").replace(/\s*#.*$/, "").trim();
      if (v !== "") return v;
    }
  }
  return undefined;
}

function appleLang(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const out = execFileSync("defaults", ["read", "-g", "AppleLanguages"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = out.split("\n").slice(0, 2);
    const second = (lines[1] ?? "").replace(/[ ",()]/g, "");
    return second !== "" ? second : undefined;
  } catch {
    return undefined;
  }
}

export function currentLang(): Lang {
  const env = process.env;
  const direct = resolveLang({
    rollLang: env["ROLL_LANG"],
    configLang: configLang(),
    lcAll: env["LC_ALL"],
    lang: env["LANG"],
  });
  if (
    (env["ROLL_LANG"] ?? "") === "" &&
    configLang() === undefined &&
    (env["LC_ALL"] ?? "") === "" &&
    (env["LANG"] ?? "") === ""
  ) {
    return resolveLang({ appleLang: appleLang() });
  }
  return direct;
}

// ── Agent registry helpers (mirror @roll/core registry) ─────────────────────
// Pool narrowed to 国产/开源 agents (kimi/pi/reasonix). claude is kept here for
// the user-facing `roll agent list` roster (harness/manual agent — roll runs
// inside Claude Code), not as an orchestrated pool member. The overseas agents
// (codex/openai, agy/antigravity/gemini, qwen) were removed.
export function canonicalAgentName(name: string): string {
  return name;
}

function agentDisplayName(a: string): string {
  return a;
}

function agentBinNames(agent: string): string[] | null {
  switch (agent) {
    case "claude":
      return ["claude"];
    case "kimi":
      return ["kimi-code", "kimi-cli", "kimi"];
    case "deepseek":
      return ["deepseek"];
    case "pi":
      return ["pi"];
    case "reasonix":
      return ["reasonix"];
    default:
      return null;
  }
}

/** Real-filesystem {@link AgentEnv} for core registry probes
 *  (`firstInstalledAgent` / core `agentInstalledByName`). */
export function realAgentEnv(): AgentEnv {
  return {
    home: homedir(),
    commandOnPath,
    dirExists: (p) => existsSync(p),
    fileExecutable: (p) => {
      try {
        accessSync(p, constants.X_OK);
        return statSync(p).isFile();
      } catch {
        return false;
      }
    },
  };
}

function commandOnPath(bin: string): boolean {
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    const p = join(dir, bin);
    try {
      const st = statSync(p);
      if (!st.isFile()) continue;
      accessSync(p, constants.X_OK);
      return true;
    } catch {
      /* keep scanning */
    }
  }
  return false;
}

export function agentInstalledByName(agent: string): boolean {
  const bins = agentBinNames(agent);
  if (bins !== null) return bins.some(commandOnPath);
  return false; // unknown without dir hint
}

/** Mirrors _project_agent: local.yaml → .roll.yaml → global config → claude. */
export function projectAgent(): string {
  const firstAgentField = (file: string, pattern: RegExp): string | undefined => {
    if (!existsSync(file)) return undefined;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (pattern.test(line)) {
        const second = line.trim().split(/\s+/)[1] ?? "";
        return second.replaceAll('"', "");
      }
    }
    return undefined;
  };
  const fromLocal = firstAgentField(".roll/local.yaml", /^agent:/);
  if (fromLocal !== undefined) return fromLocal;
  const fromRollYaml = firstAgentField(".roll.yaml", /^agent:/);
  if (fromRollYaml !== undefined) return fromRollYaml;
  const rollHome = process.env["ROLL_HOME"] ?? join(homedir(), ".roll");
  const fromGlobal = firstAgentField(join(rollHome, "config.yaml"), /primary_agent:/);
  if (fromGlobal !== undefined) return fromGlobal;
  return "claude";
}

// ── Entry ────────────────────────────────────────────────────────────────────
const AGENT_ORDER = ["claude", "kimi", "deepseek", "pi", "reasonix"];

export function agentListCommand(_args: string[]): number {
  const noColor = (process.env["NO_COLOR"] ?? "") !== "";
  const GREEN = noColor ? "" : "\x1b[0;32m";
  const YELLOW = noColor ? "" : "\x1b[0;33m";
  const NC = noColor ? "" : "\x1b[0m";
  const lang = currentLang();

  const out: string[] = [];
  out.push("", `  ${t(v2Catalog, lang, "agent.available_agents")}`, "");
  const current = canonicalAgentName(projectAgent());
  for (const a of AGENT_ORDER) {
    const disp = agentDisplayName(a);
    if (agentInstalledByName(a)) {
      out.push(
        a === current
          ? `    ${GREEN}✓ ${disp}${NC}  (current)`
          : `    ${GREEN}✓ ${disp}${NC}`,
      );
    } else {
      out.push(`    ${YELLOW}✗ ${disp}${NC}  (not installed)`);
    }
  }
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}
