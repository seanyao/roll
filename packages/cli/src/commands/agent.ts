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
import { readPrimaryAgent, writePrimaryAgent } from "../lib/interactive-agent.js";

const VALID_SLOTS: AgentSlot[] = ["easy", "default", "hard", "fallback"];
/** Routing slots that carry a complexity tier (fallback is availability-only). */
const TIER_SLOTS: AgentSlot[] = ["easy", "default", "hard"];

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
  /** US-V4-002 — seam for the GLOBAL machine default (`~/.roll/config.yaml`). */
  readDefaultAgent?: () => string | null;
  writeDefaultAgent?: (name: string) => void;
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

function depsWithDefaults(
  deps: AgentCommandDeps,
): Required<Omit<AgentCommandDeps, "readLine" | "readDefaultAgent" | "writeDefaultAgent">> &
  Pick<AgentCommandDeps, "readLine" | "readDefaultAgent" | "writeDefaultAgent"> {
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
    readDefaultAgent: deps.readDefaultAgent,
    writeDefaultAgent: deps.writeDefaultAgent,
  };
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

/** US-V4-002 — the project route profile still FOLLOWS the machine default when
 *  every configured tier slot (easy/default/hard) points at the old default (or
 *  is unset). A single slot aimed at a different agent makes the profile
 *  customized → a default change must not silently overwrite it. A null old
 *  default means there is nothing to follow, so any set slot counts as custom. */
function projectRoutesFollowDefault(text: string, oldDefault: string | null): boolean {
  if (oldDefault === null) {
    return TIER_SLOTS.every((slot) => readSlotFromText(text, slot)?.agent === undefined);
  }
  for (const slot of TIER_SLOTS) {
    const agent = readSlotFromText(text, slot)?.agent;
    if (agent !== undefined && agent !== oldDefault) return false;
  }
  return true;
}

/** `roll agent default [<agent>]` — read or set the GLOBAL machine default
 *  (`primary_agent` in `~/.roll/config.yaml`). No arg prints the current default.
 *  Setting it only rewrites project routes that STILL follow the old default;
 *  customized `.roll/agents.yaml` profiles are preserved (US-V4-002). */
function defaultCommand(args: string[], deps: AgentCommandDeps): number {
  const readDefault = deps.readDefaultAgent ?? readPrimaryAgent;
  const writeDefault = deps.writeDefaultAgent ?? writePrimaryAgent;
  const raw = args[0] ?? "";
  if (raw === "") {
    const cur = readDefault();
    ok(cur !== null && cur !== "" ? m("agent.default_current", agentDisplayName(cur)) : m("agent.default_none"));
    return 0;
  }
  if (isRemovedAgentName(raw)) {
    err(m("agent.use_removed_agent", raw));
    return 1;
  }
  const name = canonicalAgentName(raw);
  if (!agentIsKnown(name)) {
    err(m("agent.default_unknown_agent", name));
    return 1;
  }
  const oldDefault = readDefault();
  try {
    writeDefault(name);
  } catch (e) {
    err(`failed to write machine default: ${String(e)}`);
    return 1;
  }
  ok(m("agent.default_saved", agentDisplayName(name)));
  // Only rewrite project routes when the profile still follows the old default —
  // never clobber a customized .roll/agents.yaml.
  const { reg, d } = registry(deps);
  const path = reg.configPath(process.env["ROLL_AGENTS_CONFIG"], d.fileExists);
  if (path !== undefined && d.fileExists(path)) {
    const text = d.readText(path);
    if (projectRoutesFollowDefault(text, oldDefault) && oldDefault !== null) {
      let rewrote = false;
      for (const slot of TIER_SLOTS) {
        if (readSlotFromText(text, slot)?.agent === oldDefault) {
          try {
            reg.setSlot(path, slot, name);
            rewrote = true;
          } catch {
            warn(m("agent.set_write_failed", slot));
          }
        }
      }
      if (rewrote) ok(m("agent.default_routes_followed", agentDisplayName(name)));
    } else if (!projectRoutesFollowDefault(text, oldDefault)) {
      ok(m("agent.default_routes_preserved"));
    }
  }
  return 0;
}

/** US-V4-002 — `roll agent use` is retired. It fails loudly with migration
 *  guidance toward `roll agent default` (machine default) and `roll agent set`
 *  (one project route), never silently aliasing the old "lock all tiers". */
function useCommand(_args: string[], _deps: AgentCommandDeps): number {
  err(m("agent.use_retired"));
  return 1;
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
  // US-V4-002: setting a project route is project-local — it no longer triggers a
  // global dossier refresh (that retired side effect belongs to `roll index`).
  return 0;
}

function viewCommand(deps: AgentCommandDeps): number {
  const { reg, d } = registry(deps);
  const { YELLOW, RED, GREEN, NC } = pal();
  const path = reg.configPath(process.env["ROLL_AGENTS_CONFIG"], d.fileExists);
  const readDefault = deps.readDefaultAgent ?? readPrimaryAgent;
  const cur = readDefault();
  // US-V4-002: the default view shows BOTH the global machine default and the
  // project route profile, two distinct concerns.
  const out: string[] = ["", `  ${m("agent.view_default_label")}`, ""];
  out.push(`    ${cur !== null && cur !== "" ? agentDisplayName(cur) : m("agent.default_none")}`, "");
  out.push(`  ${m("agent.view_routes_label")}`, "");
  if (path === undefined) {
    out.push(`    ${YELLOW}${m("agent.view_no_config")}${NC}`);
    out.push(`    ${m("agent.view_no_config_hint")}`, "");
  } else {
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
  }
  out.push(
    "",
    "  roll agent default <agent>      — set the machine default agent (~/.roll/config.yaml)",
    "  roll agent set <route> <agent>  — set one project route (easy|default|hard|fallback)",
    "  roll agent list                 — show installed agents",
    "",
  );
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}

export function agentCommand(args: string[], deps: AgentCommandDeps = {}): number {
  const [sub, ...rest] = args;
  if (sub === "list") return (deps.listCommand ?? agentListCommand)(rest);
  if (sub === "default") return defaultCommand(rest, deps);
  if (sub === "set") return setCommand(rest, deps);
  if (sub === "use") return useCommand(rest, deps); // retired — fails loud with migration guidance
  if (sub === undefined || sub === "") return viewCommand(deps);
  err(`Unknown subcommand: ${sub}`);
  process.stdout.write("Usage: roll agent [default <agent>|set <route> <agent>|list]\n");
  return 1;
}
