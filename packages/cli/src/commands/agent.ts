import {
  AgentRegistry,
  agentDisplayName,
  agentIsKnown,
  canonicalAgentName,
  isRemovedAgentName,
  readSlotFromText,
  type AgentEnv,
  type AgentSlot,
  type FileStore,
} from "@roll/core";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { t, v2Catalog, v3Catalog } from "@roll/spec";
import { agentListCommand, currentLang, realAgentEnv } from "./agent-list.js";
import { refreshAggregates as refreshDossierAggregates } from "./index-gen.js";

const VALID_SLOTS: AgentSlot[] = ["easy", "default", "hard", "fallback"];

export interface AgentCommandDeps {
  env?: AgentEnv;
  fileExists?: (path: string) => boolean;
  readText?: (path: string) => string;
  writeText?: (path: string, text: string) => void;
  writeFileAtomic?: (path: string, text: string) => void;
  mkdirp?: (path: string) => void;
  removeFile?: (path: string) => void;
  readLine?: () => string | undefined;
  listCommand?: (args: string[]) => number;
  refreshAggregates?: (cwd: string) => void;
}

function pal(): { RED: string; GREEN: string; YELLOW: string; NC: string } {
  const noColor = (process.env["NO_COLOR"] ?? "") !== "";
  return {
    RED: noColor ? "" : "\x1b[0;31m",
    GREEN: noColor ? "" : "\x1b[0;32m",
    YELLOW: noColor ? "" : "\x1b[0;33m",
    NC: noColor ? "" : "\x1b[0m",
  };
}

function err(line: string): void {
  const { RED, NC } = pal();
  process.stderr.write(`${RED}[roll]${NC} ${line}\n`);
}

function ok(line: string): void {
  const { GREEN, NC } = pal();
  process.stdout.write(`${GREEN}[roll]${NC} ${line}\n`);
}

function warn(line: string): void {
  const { YELLOW, NC } = pal();
  process.stderr.write(`${YELLOW}[roll] WARN${NC} ${line}\n`);
}

function m(key: string, ...args: string[]): string {
  if (v3Catalog[key] !== undefined) return t(v3Catalog, currentLang(), key, ...args);
  return t(v2Catalog, currentLang(), key, ...args);
}

function depsWithDefaults(deps: AgentCommandDeps): Required<Omit<AgentCommandDeps, "readLine" | "refreshAggregates">> &
  Pick<AgentCommandDeps, "readLine"> {
  return {
    env: deps.env ?? realAgentEnv(),
    fileExists: deps.fileExists ?? existsSync,
    readText: deps.readText ?? ((path) => readFileSync(path, "utf8")),
    writeText: deps.writeText ?? ((path, text) => writeFileSync(path, text, "utf8")),
    writeFileAtomic:
      deps.writeFileAtomic ??
      ((path, text) => {
        const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
        writeFileSync(tmp, text, "utf8");
        renameSync(tmp, path);
      }),
    mkdirp: deps.mkdirp ?? ((path) => mkdirSync(path, { recursive: true })),
    removeFile: deps.removeFile ?? ((path) => rmSync(path, { force: true })),
    readLine: deps.readLine,
    listCommand: deps.listCommand ?? agentListCommand,
  };
}

function refreshAgentDossier(deps: AgentCommandDeps): void {
  try {
    (deps.refreshAggregates ?? refreshDossierAggregates)(process.cwd());
  } catch (e) {
    warn(`dossier refresh failed after agent slot update (board may lag until \`roll index\`): ${String(e)}`);
  }
}

function registry(deps: AgentCommandDeps): { reg: AgentRegistry; d: ReturnType<typeof depsWithDefaults> } {
  const d = depsWithDefaults(deps);
  const fs: FileStore = {
    readText: d.readText,
    writeFileAtomic: d.writeFileAtomic,
  };
  return { reg: new AgentRegistry(d.env, fs), d };
}

function agentsPath(reg: AgentRegistry, d: ReturnType<typeof depsWithDefaults>): string {
  return reg.configPath(process.env["ROLL_AGENTS_CONFIG"], d.fileExists) ?? ".roll/agents.yaml";
}

function syncLocalAgent(name: string, d: ReturnType<typeof depsWithDefaults>): void {
  d.mkdirp(".roll");
  const local = ".roll/local.yaml";
  let text = "";
  if (d.fileExists(local)) {
    text = d.readText(local);
    const lines = text.split("\n");
    let replaced = false;
    const next = lines.map((line) => {
      if (line.startsWith("agent:")) {
        replaced = true;
        return `agent: ${name}`;
      }
      return line;
    });
    if (!replaced) {
      if (text !== "" && !text.endsWith("\n")) next.push("");
      next.push(`agent: ${name}`);
    }
    d.writeText(local, next.join("\n"));
  } else {
    d.writeText(local, `agent: ${name}\n`);
  }

  if (d.fileExists(".roll.yaml")) {
    const kept = d.readText(".roll.yaml").split("\n").filter((line) => !line.startsWith("agent:"));
    const next = kept.join("\n");
    if (next.trim() === "") d.removeFile(".roll.yaml");
    else d.writeText(".roll.yaml", next.endsWith("\n") ? next : `${next}\n`);
  }
}

function useCommand(args: string[], deps: AgentCommandDeps): number {
  const raw = args[0] ?? "";
  if (raw === "") {
    err(m("agent.use_usage"));
    return 1;
  }
  // US-AGENT-045 AC4: reject removed agents with a directed message before
  // falling through to the generic unknown-agent path.
  if (isRemovedAgentName(raw)) {
    err(m("agent.use_removed_agent", raw));
    return 1;
  }
  const name = canonicalAgentName(raw);
  const { reg, d } = registry(deps);
  if (!agentIsKnown(name) || !reg.isInstalled(name)) {
    err(m("agent.use_unknown_agent", name));
    return 1;
  }
  d.mkdirp(".roll");
  const path = agentsPath(reg, d);
  for (const slot of ["easy", "default", "hard"] as const) {
    try {
      reg.setSlot(path, slot, name);
    } catch {
      err(m("agent.set_write_failed", slot));
      return 1;
    }
  }
  syncLocalAgent(name, d);
  ok(m("agent.use_locked", agentDisplayName(name)));
  refreshAgentDossier(deps);
  return 0;
}

function setCommand(args: string[], deps: AgentCommandDeps): number {
  let slot = args[0] ?? "";
  let agent = args[1] ?? "";
  if (slot === "") {
    process.stderr.write(`${m("agent.set_pick_slot")}\n`);
    VALID_SLOTS.forEach((s, idx) => process.stderr.write(`    ${idx + 1}) ${s}\n`));
    process.stderr.write(`  ${m("agent.set_enter_number")} [1-4]: `);
    const choice = deps.readLine?.();
    if (choice === undefined) {
      err(m("agent.set_no_input"));
      return 1;
    }
    const n = Number(choice);
    if (!Number.isInteger(n) || n < 1 || n > VALID_SLOTS.length) {
      err(m("agent.set_invalid_choice", choice));
      return 1;
    }
    slot = VALID_SLOTS[n - 1] ?? "";
  } else if (!VALID_SLOTS.includes(slot as AgentSlot)) {
    err(m("agent.set_unknown_slot", slot));
    return 1;
  }

  if (agent === "") {
    const { reg } = registry(deps);
    const installed = reg.installed();
    if (installed.length === 0) {
      err(m("agent.set_no_online_agents"));
      return 1;
    }
    const choice = deps.readLine?.();
    if (choice === undefined) {
      err(m("agent.set_no_input"));
      return 1;
    }
    agent = canonicalAgentName(choice);
  } else {
    // US-AGENT-045 AC4: reject removed agents in set slot too.
    if (isRemovedAgentName(agent)) {
      err(m("agent.use_removed_agent", agent));
      return 1;
    }
    agent = canonicalAgentName(agent);
    if (!agentIsKnown(agent)) {
      err(m("agent.set_unknown_agent", agent));
      return 1;
    }
  }

  const { reg, d } = registry(deps);
  d.mkdirp(".roll");
  try {
    reg.setSlot(agentsPath(reg, d), slot as AgentSlot, agent);
  } catch {
    err(m("agent.set_write_failed", slot));
    return 1;
  }
  ok(m("agent.set_saved", slot, agentDisplayName(agent)));
  refreshAgentDossier(deps);
  return 0;
}

function viewCommand(deps: AgentCommandDeps): number {
  const { reg, d } = registry(deps);
  const { YELLOW, RED, GREEN, NC } = pal();
  const path = reg.configPath(process.env["ROLL_AGENTS_CONFIG"], d.fileExists);
  const out: string[] = ["", `  ${m("agent.view_header")}`, ""];
  if (path === undefined) {
    out.push(`    ${YELLOW}${m("agent.view_no_config")}${NC}`);
    out.push(`    ${m("agent.view_no_config_hint")}`, "");
    process.stdout.write(out.join("\n") + "\n");
    return 0;
  }

  const text = d.readText(path);
  out.push(`    ${m("agent.view_col_slot").padEnd(9)} ${m("agent.view_col_agent").padEnd(22)} ${m("agent.view_col_status").padEnd(8)} ${m("agent.view_col_note")}`);
  for (const slot of VALID_SLOTS) {
    const cfg = readSlotFromText(text, slot);
    const agent = cfg?.agent;
    const disp =
      agent === undefined
        ? m("agent.view_slot_unset")
        : cfg?.model !== undefined && cfg.model !== ""
          ? `${agentDisplayName(agent)} (${cfg.model})`
          : agentDisplayName(agent);
    const status =
      agent === undefined ? "-" : reg.isInstalled(agent) ? `${GREEN}✓${NC}` : `${RED}✗${NC}`;
    const note = slot === "fallback" ? m("agent.view_fallback_idle") : "";
    out.push(`    ${slot.padEnd(9)} ${disp.padEnd(22)} ${status.padEnd(8)} ${note}`);
  }
  out.push(
    "",
    "  roll agent set <slot> <agent>   — set the agent for a slot",
    "  roll agent use <name>           — switch agent for this project",
    "  roll agent list                 — show installed agents",
    "",
  );
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}

export function agentCommand(args: string[], deps: AgentCommandDeps = {}): number {
  const [sub, ...rest] = args;
  if (sub === "list") return (deps.listCommand ?? agentListCommand)(rest);
  if (sub === "use") return useCommand(rest, deps);
  if (sub === "set") return setCommand(rest, deps);
  if (sub === undefined || sub === "") return viewCommand(deps);
  err(`Unknown subcommand: ${sub}`);
  process.stdout.write("Usage: roll agent [set <slot> <agent>|use <name>|list]\n");
  return 1;
}
