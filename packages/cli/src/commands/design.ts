/**
 * `roll design` — explicit thin entry point for the `$roll-design` skill
 * (US-ONBOARD-NUDGE-004, FIX-1055).
 *
 * Deterministically selects an interactive agent, loads the roll-design skill
 * prompt, and launches the conversation. The command now captures the agent's
 * raw output to a per-run transcript, renders a bounded progress view, and
 * prints a final artifact handoff so the operator knows what changed, where
 * the design lives, and what to do next.
 */
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { t, v2Catalog, v3Catalog, type Lang } from "@roll/spec";
import { normalizerFor, newNormalizerState, parseBacklog, type ActivitySignal } from "@roll/core";
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
  verbose: boolean;
  raw: boolean;
  rest: string[];
  error: "from_file_missing" | null;
}

function parseDesignFlags(args: string[]): ParsedDesignFlags {
  const rest: string[] = [];
  let agent: string | undefined;
  let fromFile: string | undefined;
  let verbose = false;
  let raw = false;
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
        return { agent, fromFile, verbose, raw, rest, error: "from_file_missing" };
      }
      fromFile = value;
      i += 1;
    } else if (a.startsWith("--from-file=")) {
      const value = a.slice("--from-file=".length);
      if (value === "") return { agent, fromFile, verbose, raw, rest, error: "from_file_missing" };
      fromFile = value;
    } else if (a === "--verbose" || a === "-v") {
      verbose = true;
    } else if (a === "--raw") {
      raw = true;
    } else {
      rest.push(a);
    }
  }
  return { agent, fromFile, verbose, raw, rest, error: null };
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
  stdout?: string;
  stderr?: string;
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
  /** Wall-clock epoch ms provider (used for timestamps and run folder naming). */
  now: () => number;
}

function formatRunFolder(ts: number, target: string | null): string {
  const d = new Date(ts);
  const iso = d.toISOString();
  // 2026-06-30T23-10-00Z
  const stamp = `${iso.slice(0, 13)}-${iso.slice(14, 16)}-${iso.slice(17, 19)}Z`;
  const slug = (target ?? "design").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "design";
  return `${stamp}-${slug}`;
}

function transcriptPath(cwd: string, ts: number, target: string | null): string {
  return join(cwd, ".roll", "runs", "design", formatRunFolder(ts, target), "transcript.log");
}

function lookupEpic(target: string, cwd: string): string | null {
  try {
    const raw = readFileSync(join(cwd, ".roll", "index.json"), "utf8");
    const parsed = JSON.parse(raw) as { stories?: Record<string, string> };
    return parsed.stories?.[target] ?? null;
  } catch {
    return null;
  }
}

function readBacklogItems(cwd: string): { id: string }[] {
  try {
    const content = readFileSync(join(cwd, ".roll", "backlog.md"), "utf8");
    return parseBacklog(content).map((row) => ({ id: row.id }));
  } catch {
    return [];
  }
}

function hasDetailedDesign(path: string): boolean {
  try {
    return /#\s*Detailed design/i.test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}

function isIdeaTarget(target: string | null): boolean {
  return target !== null && /^IDEA-/i.test(target);
}

function isQuestionLike(summary: string): boolean {
  return /[?？]/.test(summary);
}

function fmtHhmmss(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatSignal(sig: ActivitySignal): string {
  const detail = sig.detail !== undefined && sig.detail !== "" ? `  ${sig.detail}` : "";
  return `${fmtHhmmss(sig.ts)}  ${sig.summary}${detail}`.trimEnd();
}

function progressLines(agent: string, combined: string, startMs: number, verbose: boolean): string[] {
  const normalizer = normalizerFor(agent);
  const state = newNormalizerState();
  const out: string[] = [];
  const lines = combined.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const nowMs = startMs + i * 1000;
    const signals = normalizer.normalize(line, state, nowMs);
    for (const sig of signals) {
      const show = verbose || sig.tier === "A" || sig.tier === "B" || (sig.kind === "say" && isQuestionLike(sig.summary));
      if (show) {
        out.push(formatSignal(sig));
      }
    }
  }
  return out;
}

const defaultDeps: DesignCommandDeps = {
  cwd: process.cwd(),
  env: process.env,
  readLine: readLineFromStdin,
  now: () => Date.now(),
  spawn: (bin, args, opts) => {
    const r = spawnSync(bin, args, { ...opts, stdio: ["inherit", "pipe", "pipe"], encoding: "utf8" });
    return {
      status: r.status ?? null,
      signal: r.signal ?? null,
      stdout: typeof r.stdout === "string" ? r.stdout : "",
      stderr: typeof r.stderr === "string" ? r.stderr : "",
    };
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

interface RunContext {
  cwd: string;
  lang: Lang;
  target: string | null;
  fromFile: string | undefined;
  agent: string;
  transcriptPath: string;
  startTs: number;
  beforeBacklog: { id: string }[];
}

function printStartBlock(ctx: RunContext): void {
  const l = ctx.lang;
  const targetDisplay = ctx.fromFile !== undefined
    ? t(v3Catalog, l, "design.target_from_file", ctx.fromFile)
    : ctx.target !== null
      ? t(v3Catalog, l, "design.target", ctx.target)
      : t(v3Catalog, l, "design.target_none");
  const mode = ctx.fromFile !== undefined
    ? t(v3Catalog, l, "design.mode_from_file", ctx.fromFile)
    : isIdeaTarget(ctx.target)
      ? t(v3Catalog, l, "design.mode_design_only_idea")
      : t(v3Catalog, l, "design.mode_design_only");
  emit(t(v3Catalog, l, "design.run_started"));
  emit(targetDisplay);
  emit(mode);
  emit(t(v3Catalog, l, "design.agent", ctx.agent));
  emit(t(v3Catalog, l, "design.raw_transcript", relative(ctx.cwd, ctx.transcriptPath)));
}

function printHandoff(ctx: RunContext, statusCode: number, rawTranscript: string): void {
  const l = ctx.lang;
  const epic = ctx.target !== null ? lookupEpic(ctx.target, ctx.cwd) : null;
  let designPath: string | undefined;
  let htmlPath: string | undefined;
  if (epic !== null && ctx.target !== null) {
    const base = join(".roll", "features", epic, ctx.target);
    const md = join(base, "spec.md");
    const html = join(base, "spec.html");
    if (existsSync(resolve(ctx.cwd, md))) {
      designPath = hasDetailedDesign(resolve(ctx.cwd, md)) ? `${md}#detailed-design` : md;
    }
    if (existsSync(resolve(ctx.cwd, html))) htmlPath = html;
  }
  const afterBacklog = readBacklogItems(ctx.cwd);
  const newCards = afterBacklog.filter((a) => !ctx.beforeBacklog.some((b) => b.id === a.id)).length;

  let status: string;
  let why: string | undefined;
  let next: string | undefined;
  if (statusCode !== 0) {
    status = t(v3Catalog, l, "design.status.agent_failed", statusCode);
  } else if (newCards > 0) {
    status = t(v3Catalog, l, "design.status.cards_created", newCards);
    next = t(v3Catalog, l, "design.next.cards_created");
  } else if (isIdeaTarget(ctx.target)) {
    status = t(v3Catalog, l, "design.status.awaiting_signoff");
    why = t(v3Catalog, l, "design.why.idea_signoff");
    next = t(v3Catalog, l, "design.next.review_and_split", ctx.target ?? "");
  } else {
    status = t(v3Catalog, l, "design.status.no_cards");
    next = t(v3Catalog, l, "design.next.no_cards", ctx.target ?? t(v3Catalog, l, "design.target_none_label"));
  }

  emit("");
  emit(t(v3Catalog, l, "design.handoff"));
  emit(t(v3Catalog, l, "design.status_label", status));
  if (designPath !== undefined) emit(t(v3Catalog, l, "design.design_label", designPath));
  if (htmlPath !== undefined) emit(t(v3Catalog, l, "design.html_label", htmlPath));
  emit(t(v3Catalog, l, "design.cards_label", newCards));
  if (why !== undefined) emit(t(v3Catalog, l, "design.why_label", why));
  if (next !== undefined) emit(t(v3Catalog, l, "design.next_label", next));
  emit(t(v3Catalog, l, "design.transcript_label", relative(ctx.cwd, ctx.transcriptPath)));
  if (rawTranscript === "") {
    emit(t(v3Catalog, l, "design.empty_transcript"));
  }
}

export function designCommand(args: string[], deps: Partial<DesignCommandDeps> = {}): number {
  const d: DesignCommandDeps = { ...defaultDeps, ...deps };
  const l = lang();

  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    process.stdout.write(`${t(v3Catalog, l, "design.usage")}\n`);
    return 0;
  }
  const { agent: forced, fromFile, verbose, raw: rawMode, rest, error: parseError } = parseDesignFlags(args);
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
  if (fromFile !== undefined && rest.length > 0) {
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

  const target = fromFile !== undefined ? fromFile : rest.join(" ").trim() || null;
  const startTs = d.now();
  const runTranscript = transcriptPath(d.cwd, startTs, target);
  mkdirSync(dirname(runTranscript), { recursive: true });
  writeFileSync(runTranscript, "", "utf8");

  const ctx: RunContext = {
    cwd: d.cwd,
    lang: l,
    target,
    fromFile,
    agent,
    transcriptPath: runTranscript,
    startTs,
    beforeBacklog: readBacklogItems(d.cwd),
  };

  printStartBlock(ctx);

  const result = d.spawn(cmd.bin, cmd.args, { cwd: d.cwd, env: d.env as NodeJS.ProcessEnv });
  const rawTranscript = [result.stdout ?? "", result.stderr ?? ""].filter((s) => s !== "").join("\n");
  writeFileSync(runTranscript, rawTranscript, "utf8");

  if (rawMode) {
    if (rawTranscript !== "") emit(rawTranscript);
  } else {
    const lines = progressLines(agent, rawTranscript, startTs, verbose);
    for (const line of lines) emit(line);
  }

  const statusCode = result.status ?? (result.signal === null ? 1 : 130);
  printHandoff(ctx, statusCode, rawTranscript);
  return statusCode;
}
