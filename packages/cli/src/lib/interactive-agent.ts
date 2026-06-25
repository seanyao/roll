/**
 * Shared primitives for interactive agent launch — used by `roll init` (legacy
 * onboard), `roll design`, and `roll setup` (US-ONBOARD-NUDGE-004/006).
 *
 * Keeps agent discovery / selection / argv mapping in one place so the
 * interactive entry points do not fork their definition of "installed".
 */
import { accessSync, constants, existsSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import {
  agentInstalledByName as coreAgentInstalledByName,
  getAgentSpec,
  type AgentEnv,
} from "@roll/core";
import { realAgentEnv } from "../commands/agent-list.js";
import { onPath, rollConfig, rollPkgDir } from "../commands/setup-shared.js";

function expandHome(path: string): string {
  const home = process.env["HOME"] ?? homedir();
  return path.replace(/^~/, home);
}

export function agentEnvFromEnv(envDict: NodeJS.ProcessEnv): AgentEnv {
  const pathEnv = envDict["PATH"] ?? "";
  function commandOnPath(bin: string): boolean {
    for (const dir of pathEnv.split(delimiter)) {
      if (dir === "") continue;
      const p = join(dir, bin);
      try {
        const st = statSync(p);
        if (!st.isFile()) continue;
        accessSync(p, constants.X_OK);
        return true;
      } catch { /* keep scanning */ }
    }
    return false;
  }
  return {
    home: envDict["HOME"] ?? homedir(),
    commandOnPath,
    dirExists: (p: string) => existsSync(p),
    fileExecutable: (p: string) => {
      try {
        accessSync(p, constants.X_OK);
        return statSync(p).isFile();
      } catch { return false; }
    },
  };
}

/**
 * Discover interactive agents from the global `~/.roll/config.yaml` `ai_*`
 * registry, probing PATH/binary-name for known agents and dir-existence for
 * unknown/operator-added entries. Mirrors `discoverOnboardAgents` in init.ts.
 *
 * Accepts an optional `AgentEnv` so tests can inject a fabricated PATH; when
 * omitted the real process environment is probed.
 */
export function discoverInteractiveAgents(agentEnv?: AgentEnv): { installed: string[]; missing: string[] } {
  const installed: string[] = [];
  const missing: string[] = [];
  const cfg = rollConfig();
  if (!existsSync(cfg)) return { installed, missing };
  const env = agentEnv ?? realAgentEnv();
  for (const line of readFileSync(cfg, "utf8").split("\n")) {
    const match = /^(ai_[^:]+):\s*(.*)$/.exec(line);
    if (match === null) continue;
    let name = (match[1] ?? "").slice("ai_".length);
    if (name === "kimi_code") name = "kimi";
    name = getAgentSpec(name)?.name ?? name;
    const dir = expandHome(((match[2] ?? "").split("|")[0] ?? "").trim());
    const target = coreAgentInstalledByName(env, name, dir) ? installed : missing;
    if (!target.includes(name)) target.push(name);
  }
  return { installed, missing };
}

/** Read the globally-configured `primary_agent`, or `null` if absent/empty. */
export function readPrimaryAgent(): string | null {
  const cfg = rollConfig();
  if (!existsSync(cfg)) return null;
  for (const line of readFileSync(cfg, "utf8").split("\n")) {
    const m = /^primary_agent:\s*(.*)$/.exec(line);
    if (m !== null) {
      const v = (m[1] ?? "").replace(/\s*#.*$/, "").trim();
      if (v !== "") return v;
    }
  }
  return null;
}

/**
 * Read a skill markdown body from `skills/<skillName>/SKILL.md` under the
 * install tree, stripping YAML frontmatter. Returns `null` when the skill file
 * is missing (e.g. submodule not initialised).
 */
export function readSkillBody(skillName: string): string | null {
  const skillFile = join(rollPkgDir(), "skills", skillName, "SKILL.md");
  if (!existsSync(skillFile)) return null;
  return readFileSync(skillFile, "utf8").replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

function kimiBin(): string {
  if (onPath("kimi-code")) return "kimi-code";
  if (onPath("kimi-cli")) return "kimi-cli";
  return "kimi";
}

/**
 * Map a canonical agent name to the interactive argv used to launch it with a
 * single prompt string. Returns `null` for unknown agents.
 */
export function interactiveAgentCommand(agent: string, prompt: string): { bin: string; args: string[] } | null {
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

/** Read one line from fd 0; returns `null` on EOF/error. */
export function readLineFromStdin(): string | null {
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
