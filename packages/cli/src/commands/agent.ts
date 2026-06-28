import {
  AGENT_REGISTRY_NAMES,
  AgentRegistry,
  canonicalAgentName,
  normalizeAgentScopeConfig,
  parseBlockYaml,
  parsePairingConfig,
  planAgentScopeMigration,
  resolveAgentScopeRole,
  readSlotFromText,
  type AgentEnv,
  type AgentScopeResolveLayer,
  type AgentSlot,
  type FileStore,
} from "@roll/core";
import type { AgentScopeConfig, AgentScopeRole, AgentScopeRoleResolution } from "@roll/spec";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { t, v2Catalog, v3Catalog } from "@roll/spec";
import { agentListCommand, currentLang, realAgentEnv } from "./agent-list.js";

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

/** `roll agent default` is retired. Machine roles now live in `~/.roll/agents.yaml`. */
function defaultCommand(args: string[], deps: AgentCommandDeps): number {
  return retiredRouteCommand("default", args, deps);
}

function retiredRouteCommand(_subcommand: string, _args: string[], _deps: AgentCommandDeps): number {
  err(m("agent.use_retired"));
  return 1;
}

/** The legacy use subcommand is retired with the same scoped-config guidance. */
function useCommand(args: string[], deps: AgentCommandDeps): number {
  return retiredRouteCommand("use", args, deps);
}

/** The legacy set subcommand is retired. Project roles now live in `.roll/agents.yaml`. */
function setCommand(args: string[], deps: AgentCommandDeps): number {
  return retiredRouteCommand("set", args, deps);
}

function viewCommand(deps: AgentCommandDeps): number {
  const { reg, d } = registry(deps);
  const rollHome = process.env["ROLL_HOME"] ?? join(d.env.home, ".roll");
  const machine = loadScopeFile(d, join(rollHome, "agents.yaml"));
  const project = loadScopeFile(d, ".roll/agents.yaml");
  const legacy = renderLegacySection(d, project);
  const out: string[] = [
    "",
    "  Agent Scope View",
    "",
    ...renderScopeBlock("Machine Scope", machine),
    "",
    ...renderScopeBlock("Project Scope", project),
    "",
    ...renderRoleResolutions(machine, project),
    "",
    ...renderAgentPool(reg),
  ];
  if (legacy.length > 0) out.push("", ...legacy);
  out.push(
    "",
    "  Role bindings are authored in ~/.roll/agents.yaml and .roll/agents.yaml.",
    "  roll agent migrate [--dry-run]  — convert legacy defaults/routes/pairing to roll-agents/v1",
    "  roll agent list                 — show installed agents",
    "",
  );
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}

function readIfExists(d: ReturnType<typeof depsWithDefaults>, path: string): string | undefined {
  return d.fileExists(path) ? d.readText(path) : undefined;
}

type ScopeLoad =
  | { kind: "missing"; path: string }
  | { kind: "legacy"; path: string; text: string }
  | { kind: "invalid"; path: string; text: string; errors: readonly string[] }
  | { kind: "valid"; path: string; text: string; config: AgentScopeConfig };

function loadScopeFile(d: ReturnType<typeof depsWithDefaults>, path: string): ScopeLoad {
  if (!d.fileExists(path)) return { kind: "missing", path };
  const text = d.readText(path);
  if (!text.includes("roll-agents/v1")) return { kind: "legacy", path, text };
  const parsed = normalizeAgentScopeConfig(text);
  if (parsed.config === null || parsed.errors.length > 0) {
    return { kind: "invalid", path, text, errors: parsed.errors };
  }
  return { kind: "valid", path, text, config: parsed.config };
}

function roleLine(label: string, resolution: AgentScopeRoleResolution): string {
  if (!resolution.ok) {
    const reason = resolution.failure.errors[0] ?? "unresolved";
    return `    ${label.padEnd(16)} unresolved  source=${resolution.failure.source ?? "-"}  reason=${reason}`;
  }
  const r = resolution.resolved;
  const model = r.model !== undefined ? ` model=${r.model}` : "";
  const pool = r.candidates.length > 1 ? ` pool=[${r.candidates.join(", ")}]` : "";
  const skipped = r.skipped.length > 0 ? ` skipped=[${r.skipped.map((s) => `${s.agent}:${s.reason}`).join(", ")}]` : "";
  const trace = r.trace.length > 0 ? ` trace=${r.trace.map((t) => `${t.action}:${t.source}`).join(" -> ")}` : "";
  return `    ${label.padEnd(16)} ${r.agent}${model}  via=${r.binding.kind}/${r.selectedStrategy}  source=${r.source}${pool}${skipped}${trace}`;
}

function renderScopeBlock(title: string, load: ScopeLoad): string[] {
  const out = [`  ${title}`, "", `    file: ${load.path}`];
  if (load.kind === "missing") {
    out.push("    status: missing");
  } else if (load.kind === "legacy") {
    out.push("    status: legacy config (run `roll agent migrate` to convert)");
  } else if (load.kind === "invalid") {
    out.push("    status: invalid roll-agents/v1");
    for (const errorLine of load.errors) out.push(`    error: ${errorLine}`);
  } else {
    const agents = Object.keys(load.config.agents);
    const models = Object.keys(load.config.models);
    out.push("    status: roll-agents/v1");
    out.push(`    agents: ${agents.length > 0 ? agents.join(", ") : "-"}`);
    out.push(`    models: ${models.length > 0 ? models.join(", ") : "-"}`);
  }
  return out;
}

function validLayers(machine: ScopeLoad, project: ScopeLoad): AgentScopeResolveLayer[] {
  const layers: AgentScopeResolveLayer[] = [];
  if (machine.kind === "valid") layers.push({ config: machine.config, path: machine.path });
  if (project.kind === "valid") layers.push({ config: project.config, path: project.path });
  return layers;
}

function renderRoleResolutions(machine: ScopeLoad, project: ScopeLoad): string[] {
  const layers = validLayers(machine, project);
  const out = ["  Resolved roles", ""];
  if (layers.length === 0) {
    out.push("    no roll-agents/v1 scope files to resolve");
    return out;
  }
  const render = (label: string, scope: "project" | "story", role: AgentScopeRole): string =>
    roleLine(label, resolveAgentScopeRole({ scope, role, layers }));
  out.push(render("supervise", "project", "supervise"));
  out.push(render("story.execute", "story", "execute"));
  out.push(render("story.evaluate", "story", "evaluate"));
  return out;
}

function renderAgentPool(reg: AgentRegistry): string[] {
  const out = [
    "  Agent pool",
    "",
    "    agent       status        note",
  ];
  for (const agent of AGENT_REGISTRY_NAMES) {
    const installed = reg.isInstalled(agent);
    out.push(`    ${agent.padEnd(11)} ${(installed ? "installed" : "not found").padEnd(13)} runtime auth/network/account checked at spawn`);
  }
  return out;
}

function localAgent(text: string): string | null {
  const root = parseBlockYaml(text);
  const raw = root["agent"];
  return typeof raw === "string" && raw.trim() !== "" ? canonicalAgentName(raw) : null;
}

function renderLegacySection(d: ReturnType<typeof depsWithDefaults>, project: ScopeLoad): string[] {
  const entries: string[] = [];
  if (project.kind === "legacy") {
    const slots = VALID_SLOTS
      .map((slot) => {
        const cfg = readSlotFromText(project.text, slot);
        return cfg?.agent === undefined ? null : `${slot}=${cfg.agent}`;
      })
      .filter((x): x is string => x !== null);
    if (slots.length > 0) entries.push(`    v3 route slots in ${project.path}: ${slots.join(", ")}`);
  }
  const localText = readIfExists(d, ".roll/local.yaml");
  if (localText !== undefined) {
    const agent = localAgent(localText);
    if (agent !== null) entries.push(`    .roll/local.yaml agent: ${agent}`);
  }
  const pairingText = readIfExists(d, ".roll/pairing.yaml");
  if (pairingText !== undefined) {
    try {
      const cfg = parsePairingConfig(pairingText);
      const agents = Object.keys(cfg.capability);
      entries.push(`    .roll/pairing.yaml: legacy evaluator pool ${agents.length > 0 ? agents.join(", ") : "(empty)"}`);
    } catch {
      entries.push("    .roll/pairing.yaml: invalid legacy pairing config");
    }
  }
  if (entries.length === 0) return [];
  return ["  Legacy compatibility", "", ...entries, "    migration: roll agent migrate [--dry-run]"];
}

function renderMigrationPlan(plan: ReturnType<typeof planAgentScopeMigration>, dryRun: boolean): string {
  const out: string[] = ["", "  Agent config migration", "", "  Sources:"];
  if (plan.sources.length === 0) out.push("    - none found");
  else for (const source of plan.sources) out.push(`    - ${source}`);
  out.push("", "  Targets:");
  for (const target of plan.targets) out.push(`    - ${target}`);
  out.push("", "  Bindings:");
  if (plan.summary.length === 0) out.push("    - no legacy bindings to migrate");
  else for (const line of plan.summary) out.push(`    - ${line}`);
  if (plan.warnings.length > 0) {
    out.push("", "  Warnings:");
    for (const warning of plan.warnings) out.push(`    - ${warning}`);
  }
  out.push("", dryRun ? "  Dry run: no files written" : "  Migration written", "");
  return `${out.join("\n")}\n`;
}

function migrateCommand(args: string[], deps: AgentCommandDeps): number {
  const dryRun = args.includes("--dry-run");
  const unknown = args.filter((arg) => arg !== "--dry-run");
  if (unknown.length > 0) {
    err(`Unknown option for migrate: ${unknown[0]}`);
    return 1;
  }
  const d = depsWithDefaults(deps);
  const rollHome = process.env["ROLL_HOME"] ?? join(d.env.home, ".roll");
  const globalConfigPath = join(rollHome, "config.yaml");
  const machineTargetPath = join(rollHome, "agents.yaml");
  const projectTargetPath = ".roll/agents.yaml";
  const pairingPath = ".roll/pairing.yaml";
  const localPath = ".roll/local.yaml";
  const plan = planAgentScopeMigration({
    globalConfigText: readIfExists(d, globalConfigPath),
    machineAgentsText: readIfExists(d, machineTargetPath),
    projectAgentsText: readIfExists(d, projectTargetPath),
    pairingText: readIfExists(d, pairingPath),
    projectLocalText: readIfExists(d, localPath),
    globalConfigPath,
    machineTargetPath,
    projectTargetPath,
    projectLegacyAgentsPath: projectTargetPath,
    pairingPath,
    projectLocalPath: localPath,
  });

  process.stdout.write(renderMigrationPlan(plan, dryRun));
  if (dryRun) return 0;

  try {
    d.mkdirp(dirname(machineTargetPath));
    d.mkdirp(dirname(projectTargetPath));
    if (plan.machine.changed) d.writeFileAtomic(machineTargetPath, plan.machine.text);
    if (plan.project.changed) d.writeFileAtomic(projectTargetPath, plan.project.text);
  } catch (e) {
    err(`agent migration failed: ${String(e)}`);
    return 1;
  }
  return 0;
}

export function agentCommand(args: string[], deps: AgentCommandDeps = {}): number {
  const [sub, ...rest] = args;
  if (sub === "list") return (deps.listCommand ?? agentListCommand)(rest);
  if (sub === "default") return defaultCommand(rest, deps);
  if (sub === "set") return setCommand(rest, deps);
  if (sub === "migrate") return migrateCommand(rest, deps);
  if (sub === "use") return useCommand(rest, deps); // retired — fails loud with migration guidance
  if (sub === undefined || sub === "") return viewCommand(deps);
  err(`Unknown subcommand: ${sub}`);
  process.stdout.write("Usage: roll agent [migrate [--dry-run]|list]\n");
  return 1;
}
