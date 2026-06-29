/**
 * `roll design` — explicit thin entry point for the `$roll-design` skill
 * (US-ONBOARD-NUDGE-004).
 *
 * Deterministically selects an interactive agent, loads the roll-design skill
 * prompt, and launches the conversation. All LLM work stays inside the agent;
 * this command only wires stdin/stdout.
 */
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { t, v2Catalog, v3Catalog, type Lang } from "@roll/spec";
import { parseBacklog } from "@roll/core";
import { currentLang } from "./agent-list.js";
import {
  agentEnvFromEnv,
  discoverInteractiveAgents,
  interactiveAgentCommand,
  readLineFromStdin,
  readPrimaryAgent,
  readSkillBody,
} from "../lib/interactive-agent.js";

function lang(): Lang {
  return currentLang();
}

function emit(line: string): void {
  process.stderr.write(`${line}\n`);
}

function readDesignPrompt(fromFile: string | undefined, rest: string[]): string | null {
  const body = readSkillBody("roll-design");
  if (body === null) return null;
  const parts: string[] = [];
  if (fromFile !== undefined) {
    parts.push(
      `The user invoked \`roll design --from-file ${fromFile}\`.`,
      `Use this product brief file as the design input: ${fromFile}`,
      "Read it before asking broad discovery questions, then run the $roll-design workflow.",
    );
  }
  const req = rest.join(" ").trim();
  if (req !== "") {
    parts.push(
      `The user invoked \`roll design ${req}\`.`,
      `Design requirement: ${req}`,
    );
  }
  const handoff = parts.length > 0 ? parts.join("\n") + "\n\n" : "";
  return `${handoff}Run the $roll-design skill below for this project. Follow it end-to-end.\n\n${body}`;
}

interface ParsedDesignFlags {
  agent: string | undefined;
  fromFile: string | undefined;
  rest: string[];
  error: "from_file_missing" | null;
}

function parseDesignFlags(args: string[]): ParsedDesignFlags {
  const rest: string[] = [];
  let agent: string | undefined;
  let fromFile: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? "";
    if (a === "--agent") {
      agent = args[i + 1];
      i += 1;
    } else if (a.startsWith("--agent=")) {
      agent = a.slice("--agent=".length);
    } else if (a === "--from-file") {
      const value = args[i + 1];
      if (value === undefined || value === "" || value.startsWith("-")) {
        return { agent, fromFile, rest, error: "from_file_missing" };
      }
      fromFile = value;
      i += 1;
    } else if (a.startsWith("--from-file=")) {
      const value = a.slice("--from-file=".length);
      if (value === "") return { agent, fromFile, rest, error: "from_file_missing" };
      fromFile = value;
    } else {
      rest.push(a);
    }
  }
  return { agent, fromFile, rest, error: null };
}

function isRollProject(cwd: string): boolean {
  return existsSync(join(cwd, ".roll"));
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** True when `.roll/backlog.md` has at least one parseable card row. */
function hasNonEmptyBacklog(cwd: string): boolean {
  const bp = join(cwd, ".roll", "backlog.md");
  try {
    const content = readFileSync(bp, "utf8");
    return parseBacklog(content).length > 0;
  } catch {
    return false;
  }
}

export interface DesignSpawnResult {
  status: number | null;
  signal: string | null;
}

export interface DesignCommandDeps {
  /** Current working directory for project checks. */
  cwd: string;
  /** Environment variables (used for `ROLL_DESIGN_AGENT`). */
  env: NodeJS.ProcessEnv;
  /** Read one interactive selection line. */
  readLine: () => string | null;
  /** Spawn the selected agent. */
  spawn: (bin: string, args: string[], opts: SpawnSyncOptions) => DesignSpawnResult;
}

const defaultDeps: DesignCommandDeps = {
  cwd: process.cwd(),
  env: process.env,
  readLine: readLineFromStdin,
  spawn: (bin, args, opts) => {
    const r = spawnSync(bin, args, opts);
    return { status: r.status ?? null, signal: r.signal ?? null };
  },
};

function selectAgent(
  installed: string[],
  forced: string | undefined,
  envAgent: string | undefined,
  primary: string | null,
  readLine: () => string | null,
): { agent: string | null; error: string | null } {
  if (forced !== undefined && forced !== "") {
    const canonical = installed.find((a) => a.toLowerCase() === forced.toLowerCase());
    if (canonical !== undefined) return { agent: canonical, error: null };
    return { agent: null, error: t(v3Catalog, lang(), "design.unknown_agent", forced) };
  }
  if (envAgent !== undefined && envAgent !== "") {
    const canonical = installed.find((a) => a.toLowerCase() === envAgent.toLowerCase());
    if (canonical !== undefined) return { agent: canonical, error: null };
    return { agent: null, error: t(v3Catalog, lang(), "design.unknown_agent", envAgent) };
  }
  if (primary !== null) {
    const canonical = installed.find((a) => a.toLowerCase() === primary.toLowerCase());
    if (canonical !== undefined) return { agent: canonical, error: null };
  }
  if (installed.length === 0) return { agent: null, error: null };
  if (installed.length === 1) return { agent: installed[0] ?? null, error: null };

  process.stderr.write(`${t(v2Catalog, lang(), "init.pick_an_agent")}\n`);
  installed.forEach((candidate, index) => {
    process.stderr.write(`    ${index + 1}) ${candidate}\n`);
  });
  process.stderr.write(`  Enter number [1-${installed.length}]: `);
  const choice = readLine();
  if (choice === null) {
    return { agent: null, error: t(v2Catalog, lang(), "init.no_input_received_aborting_onboard") };
  }
  const n = Number(choice);
  if (!Number.isInteger(n) || n < 1 || n > installed.length) {
    return { agent: null, error: t(v2Catalog, lang(), "init.invalid_choice", choice) };
  }
  return { agent: installed[n - 1] ?? null, error: null };
}

export function designCommand(args: string[], deps: Partial<DesignCommandDeps> = {}): number {
  const d: DesignCommandDeps = { ...defaultDeps, ...deps };
  const l = lang();

  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    process.stdout.write(`${t(v3Catalog, l, "design.usage")}\n`);
    return 0;
  }
  const { agent: forced, fromFile, rest, error: parseError } = parseDesignFlags(args);
  if (parseError === "from_file_missing") {
    emit(t(v3Catalog, l, "design.from_file_missing"));
    process.stderr.write(`${t(v3Catalog, l, "design.usage")}\n`);
    return 1;
  }
  if (rest.some((a) => a.startsWith("-"))) {
    // Unknown flag: print usage and fail loud (matches init flag handling).
    process.stderr.write(`${t(v3Catalog, l, "design.usage")}\n`);
    return 1;
  }

  if (!isRollProject(d.cwd)) {
    emit(t(v3Catalog, l, "design.not_roll_project"));
    return 1;
  }
  if (fromFile !== undefined && !isRegularFile(resolve(d.cwd, fromFile))) {
    emit(t(v3Catalog, l, "design.from_file_not_found", fromFile));
    return 1;
  }

  // Bound bare design: no target and non-empty backlog → bounded help, no spawn.
  if (fromFile === undefined && rest.length === 0) {
    if (hasNonEmptyBacklog(d.cwd)) {
      process.stdout.write(`${t(v3Catalog, l, "design.bare_backlog_help")}\n`);
      return 0;
    }
    // Empty backlog → fall through (onboarding path may still launch agent).
  }

  const prompt = readDesignPrompt(fromFile, rest);
  if (prompt === null) {
    emit(t(v3Catalog, l, "design.skill_missing"));
    return 1;
  }

  const { installed } = discoverInteractiveAgents(agentEnvFromEnv(d.env));
  if (installed.length === 0) {
    emit(t(v3Catalog, l, "design.no_agent"));
    return 1;
  }

  const envAgent = d.env["ROLL_DESIGN_AGENT"];
  const primary = readPrimaryAgent();

  const { agent, error } = selectAgent(installed, forced, envAgent, primary, d.readLine);
  if (error !== null) {
    emit(error);
    return 1;
  }
  if (agent === null) {
    // Should only happen when installed is empty, already handled above.
    emit(t(v3Catalog, l, "design.no_agent"));
    return 1;
  }

  const cmd = interactiveAgentCommand(agent, prompt);
  if (cmd === null) {
    emit(t(v2Catalog, l, "init.agent_has_no_interactive_mode_wired", agent, agent));
    return 1;
  }

  process.stderr.write(`${t(v2Catalog, l, "init.launching", agent)}\n`);
  const result = d.spawn(cmd.bin, cmd.args, { cwd: d.cwd, stdio: "inherit", env: d.env as NodeJS.ProcessEnv });
  return result.status ?? (result.signal === null ? 1 : 130);
}
