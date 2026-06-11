import { EventBus, agentsInstalled, parseBacklog, selectGoalFinalReviewer, type AuditPrEvidence, type StoryTruth } from "@roll/core";
import {
  GOAL_REVIEW_MODES,
  GOAL_SCHEMA_VERSION,
  classifyStatus,
  parseEventLine,
  parseGoalYaml,
  renderGoalYaml,
  transitionGoal,
  type GoalReviewMode,
  type GoalScope,
  type GoalStatus,
  type RollGoal,
} from "@roll/spec";
import { acquireLock, ghRepoSlug, prViewMergeInfo, projectIdentity, releaseLock, remoteUrl } from "@roll/infra";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { GOAL_ALLOWED_CARDS_ENV, runAttemptFromRow } from "../lib/goal-progress.js";
import { agentInstalledByName, projectAgent, realAgentEnv } from "./agent-list.js";
import { textAgentArgv } from "../lib/text-agent-argv.js";
import { cardArchiveDir } from "../lib/archive.js";
import { storyTruthFromBacklog } from "../lib/truth-adapter.js";

const GO_LOCK_STALE_SEC = 21_600; // 6h: covers the planned 5h goal window.
const FINAL_REVIEW_TIMEOUT_MS = 300_000;

interface ProjectId {
  path: string;
  slug: string;
}

export interface RunOnceInput {
  projectPath: string;
  allowedCards?: string[];
}

export interface StartTmuxInput {
  projectPath: string;
  slug: string;
  args: string[];
  rollBin: string;
}

export interface LoopGoDeps {
  identity: () => Promise<ProjectId>;
  pid: () => number;
  nowSec: () => number;
  nowIso: () => string;
  hasTmux: () => boolean;
  startTmux: (input: StartTmuxInput) => boolean;
  runOnce: (input: RunOnceInput) => Promise<number>;
  prEvidence?: (projectPath: string, storyId: string, backlogStatus: string) => Promise<AuditPrEvidence | undefined>;
  finalReview?: (input: GoalFinalReviewInput) => Promise<GoalFinalReviewResult>;
}

interface GoOptions {
  worker: boolean;
  noTmux: boolean;
  scope: GoalScope;
  budgetUsd?: number;
  maxCycles?: number;
  reviewMode: GoalReviewMode;
}

interface RunSummary {
  cycles: number;
  costUsd: number;
}

interface RunRowSnapshot {
  rows: Record<string, unknown>[];
  summary: RunSummary;
}

interface ScopeRow {
  id: string;
  status: string;
}

export interface GoalEvaluation {
  complete: boolean;
  reason: string;
  blockers: string[];
  total: number;
  delivered: number;
}

interface ProgressState {
  zeroStreaks: Map<string, number>;
  skippedCards: Set<string>;
}

export interface GoalFinalReviewInput {
  projectPath: string;
  sessionId: string;
  mode: Exclude<GoalReviewMode, "off">;
  goal: RollGoal;
  evaluation: GoalEvaluation;
  workerAgents: string[];
  timeoutMs: number;
}

export interface GoalFinalReviewResult {
  effectiveMode: "hetero" | "self";
  reviewer: string;
  provider: string;
  verdict: "APPROVE" | "REQUEST_CHANGES" | "TIMEOUT" | "ERROR";
  reason: string;
  findings: string[];
  degradedReason?: string;
}

function realDeps(): LoopGoDeps {
  return {
    identity: () => projectIdentity(),
    pid: () => process.pid,
    nowSec: () => Math.floor(Date.now() / 1000),
    nowIso: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    hasTmux: () => {
      try {
        return spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
      } catch {
        return false;
      }
    },
    startTmux: startGoTmux,
    runOnce: realRunOnce,
    prEvidence: defaultPrEvidence,
  };
}

async function defaultPrEvidence(projectPath: string, _storyId: string, backlogStatus: string): Promise<AuditPrEvidence | undefined> {
  const pr = /PR#(\d+)/.exec(backlogStatus)?.[1];
  if (pr === undefined) return undefined;
  const slug = ghRepoSlug(await remoteUrl(projectPath));
  if (slug === undefined) return undefined;
  try {
    const info = await prViewMergeInfo(slug, pr);
    if (info === undefined) return undefined;
    return {
      state: info.state,
      ...(info.mergedAt !== undefined ? { mergedAtSec: Date.parse(info.mergedAt) / 1000 } : {}),
    };
  } catch {
    return undefined;
  }
}

function runtimeDir(projectPath: string): string {
  return join(projectPath, ".roll", "loop");
}

function goalPath(projectPath: string): string {
  return join(runtimeDir(projectPath), "goal.yaml");
}

function goLockPath(projectPath: string): string {
  return join(runtimeDir(projectPath), "go.lock");
}

function pauseMarkerPath(projectPath: string, slug: string): string {
  return join(runtimeDir(projectPath), `PAUSE-${slug}`);
}

function eventsPath(projectPath: string): string {
  return join(runtimeDir(projectPath), "events.ndjson");
}

function runsPath(projectPath: string): string {
  return join(runtimeDir(projectPath), "runs.jsonl");
}

function parseOptions(args: string[]): GoOptions {
  let scope: GoalScope = { kind: "all" };
  let budgetUsd: number | undefined;
  let maxCycles: number | undefined;
  const cards: string[] = [];
  let worker = false;
  let noTmux = false;
  let reviewMode: GoalReviewMode = "auto";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--worker") {
      worker = true;
      continue;
    }
    if (arg === "--no-tmux") {
      noTmux = true;
      continue;
    }
    if (arg === "--epic") {
      const epic = args[i + 1]?.trim() ?? "";
      if (epic !== "") scope = { kind: "epic", epic };
      i += 1;
      continue;
    }
    if (arg.startsWith("--epic=")) {
      const epic = arg.slice("--epic=".length).trim();
      if (epic !== "") scope = { kind: "epic", epic };
      continue;
    }
    if (arg === "--budget") {
      budgetUsd = parseNonNegativeNumber(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--budget=")) {
      budgetUsd = parseNonNegativeNumber(arg.slice("--budget=".length));
      continue;
    }
    if (arg === "--max-cycles") {
      maxCycles = parseNonNegativeInteger(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--max-cycles=")) {
      maxCycles = parseNonNegativeInteger(arg.slice("--max-cycles=".length));
      continue;
    }
    if (arg === "--review") {
      reviewMode = parseReviewMode(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--review=")) {
      reviewMode = parseReviewMode(arg.slice("--review=".length));
      continue;
    }
    if (arg === "--cards") {
      cards.push(...parseCards(args[i + 1]));
      i += 1;
      continue;
    }
    if (arg.startsWith("--cards=")) {
      cards.push(...parseCards(arg.slice("--cards=".length)));
      continue;
    }
    if (!arg.startsWith("-")) cards.push(...parseCards(arg));
  }

  if (cards.length > 0) scope = { kind: "cards", cards };
  return {
    worker,
    noTmux,
    scope,
    reviewMode,
    ...(budgetUsd !== undefined ? { budgetUsd } : {}),
    ...(maxCycles !== undefined ? { maxCycles } : {}),
  };
}

function hasHelpArg(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function loopGoHelp(): string {
  return [
    "Usage: roll loop go [--epic <name>|--cards <ids>] [--budget <usd>] [--max-cycles <n>] [--review <auto|hetero|self|off>] [--no-tmux]",
    "  Chain goal-mode cycles until the scoped backlog is complete, paused, budget-limited, or capped.",
    "  按 goal 范围连续执行 cycle，直到完成、暂停、预算受限或达到上限。",
    "",
    "Options:",
    "  --epic <name>       Limit the goal to one epic.",
    "  --cards <ids>       Limit the goal to comma/space separated card IDs.",
    "  --budget <usd>      Stop once recorded goal cost reaches the budget.",
    "  --max-cycles <n>    Stop after n cycles in this go session.",
    "  --review <mode>     Final review policy before completion: auto, hetero, self, or off.",
    "  --no-tmux           Run in the current process instead of starting a tmux session.",
    "",
    "Review modes:",
    "  auto    Default. Prefer a heterogeneous reviewer; degrade to self review only when no other provider is available.",
    "  hetero  Require a reviewer from a different provider than the worker agents; unavailable reviewers block completion.",
    "  self    Allow final review by the same provider family.",
    "  off     Skip final review and record a goal:final_review SKIPPED event.",
    "",
  ].join("\n");
}

function parseReviewMode(value: string | undefined): GoalReviewMode {
  const mode = (value ?? "").trim();
  if (GOAL_REVIEW_MODES.includes(mode as GoalReviewMode)) return mode as GoalReviewMode;
  throw new Error(`roll loop go: --review must be one of ${GOAL_REVIEW_MODES.join(", ")}`);
}

function parseNonNegativeNumber(value: string | undefined): number | undefined {
  const n = Number(value ?? "");
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  const n = parseNonNegativeNumber(value);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

function parseCards(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function rollBin(): string {
  return (process.env["ROLL_BIN"] ?? "").trim() || process.argv[1] || "roll";
}

function startGoTmux(input: StartTmuxInput): boolean {
  const session = `roll-loop-${input.slug}`;
  const rt = runtimeDir(input.projectPath);
  const workerArgs = input.args
    .filter((arg) => arg !== "--worker" && arg !== "--no-tmux")
    .concat("--worker")
    .map(shellQuote)
    .join(" ");
  const watch = `printf 'roll goal · ${input.slug}\\n'; tail -n +1 -F ${shellQuote(join(rt, "live.log"))} | ${shellQuote(input.rollBin)} loop fmt`;
  try {
    if (spawnSync("tmux", ["has-session", "-t", session], { stdio: "ignore" }).status !== 0) {
      spawnSync("tmux", ["new-session", "-d", "-s", session, "-x", "200", "-y", "50", "-n", "watch", watch], { stdio: "ignore" });
    }
    const command = `cd ${shellQuote(input.projectPath)} && ROLL_LOOP_GO_WORKER=1 ROLL_LOOP_NO_TMUX=1 ROLL_BIN=${shellQuote(input.rollBin)} ${shellQuote(input.rollBin)} loop go ${workerArgs}`;
    return spawnSync("tmux", ["new-window", "-d", "-t", session, "-n", "go", command], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function realRunOnce(input: RunOnceInput): Promise<number> {
  const bin = rollBin();
  const cmd = bin.endsWith(".js") || bin.endsWith(".mjs") ? process.execPath : bin;
  const args = cmd === process.execPath ? [bin, "loop", "run-once"] : ["loop", "run-once"];
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: input.projectPath,
      detached: true,
      env: {
        ...process.env,
        ROLL_LOOP_GO_CHILD: "1",
        ...(input.allowedCards !== undefined ? { [GOAL_ALLOWED_CARDS_ENV]: input.allowedCards.join(",") } : {}),
      },
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

function writeGoal(path: string, goal: RollGoal): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, renderGoalYaml(goal), "utf8");
  renameSync(tmp, path);
}

function readGoal(path: string): RollGoal | undefined {
  if (!existsSync(path)) return undefined;
  return parseGoalYaml(readFileSync(path, "utf8"));
}

function createGoal(opts: GoOptions, at: string): RollGoal {
  return {
    schema: GOAL_SCHEMA_VERSION,
    scope: opts.scope,
    review: { mode: opts.reviewMode },
    ...(opts.budgetUsd !== undefined ? { budgetUsd: opts.budgetUsd } : {}),
    limits: {
      ...(opts.maxCycles !== undefined ? { maxCycles: opts.maxCycles } : {}),
    },
    status: "active",
    usage: { cycles: 0, costUsd: 0 },
    createdAt: at,
    updatedAt: at,
  };
}

function summarizeRuns(path: string): RunSummary {
  return readRunSnapshot(path).summary;
}

function readRunSnapshot(path: string): RunRowSnapshot {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { rows: [], summary: { cycles: 0, costUsd: 0 } };
  }
  const rows: Record<string, unknown>[] = [];
  let cycles = 0;
  let costUsd = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    rows.push(row);
    cycles += 1;
    const effective = typeof row["cost_effective_usd"] === "number" ? row["cost_effective_usd"] : undefined;
    const estimated = typeof row["cost_usd"] === "number" ? row["cost_usd"] : undefined;
    costUsd += effective ?? estimated ?? 0;
  }
  return { rows, summary: { cycles, costUsd } };
}

function readBacklogRows(projectPath: string): ScopeRow[] {
  try {
    return parseBacklog(readFileSync(join(projectPath, ".roll", "backlog.md"), "utf8")).map((row) => ({
      id: row.id,
      status: row.status,
    }));
  } catch {
    return [];
  }
}

function readStoryIndex(projectPath: string): Record<string, string> {
  try {
    const obj = JSON.parse(readFileSync(join(projectPath, ".roll", "index.json"), "utf8")) as { stories?: unknown };
    if (typeof obj.stories !== "object" || obj.stories === null || Array.isArray(obj.stories)) return {};
    const out: Record<string, string> = {};
    for (const [id, epic] of Object.entries(obj.stories)) {
      if (typeof epic === "string" && epic !== "") out[id] = epic;
    }
    return out;
  } catch {
    return {};
  }
}

function rowsForScope(projectPath: string, scope: GoalScope): ScopeRow[] {
  const rows = readBacklogRows(projectPath);
  if (scope.kind === "cards") {
    const wanted = new Set(scope.cards);
    return rows.filter((row) => wanted.has(row.id));
  }
  if (scope.kind === "epic") {
    const index = readStoryIndex(projectPath);
    return rows.filter((row) => index[row.id] === scope.epic);
  }
  return rows.filter((row) => classifyStatus(row.status) === "todo");
}

function allowedCardsForScope(projectPath: string, goal: RollGoal, progress: ProgressState): string[] {
  return rowsForScope(projectPath, goal.scope)
    .map((row) => row.id)
    .filter((id) => !progress.skippedCards.has(id));
}

function allScopeCardsSkipped(projectPath: string, goal: RollGoal, progress: ProgressState): boolean {
  const rows = rowsForScope(projectPath, goal.scope);
  return rows.length > 0 && rows.every((row) => progress.skippedCards.has(row.id));
}

function alertPath(projectPath: string, slug: string): string {
  return join(runtimeDir(projectPath), `ALERT-${slug}.md`);
}

function appendGoalAlert(projectPath: string, slug: string, storyId: string, cycleId: string | undefined, at: string): void {
  const path = alertPath(projectPath, slug);
  mkdirSync(dirname(path), { recursive: true });
  const cycleLine = cycleId === undefined ? "" : ` cycle=${cycleId}`;
  appendFileSync(path, `[${at}] goal card skipped: ${storyId}${cycleLine} reason=zero delivery streak\n`, "utf8");
}

function updateProgressFromRows(
  projectPath: string,
  slug: string,
  session: string,
  rows: Record<string, unknown>[],
  progress: ProgressState,
  deps: LoopGoDeps,
  bus: EventBus,
): void {
  for (const row of rows) {
    const attempt = runAttemptFromRow(row);
    if (attempt === undefined || !attempt.known) continue;
    if (!attempt.zeroDelivery) {
      progress.zeroStreaks.delete(attempt.storyId);
      continue;
    }
    const nextCount = (progress.zeroStreaks.get(attempt.storyId) ?? 0) + 1;
    progress.zeroStreaks.set(attempt.storyId, nextCount);
    if (nextCount < 2 || progress.skippedCards.has(attempt.storyId)) continue;
    progress.skippedCards.add(attempt.storyId);
    bus.appendEvent(eventsPath(projectPath), {
      type: "goal:card_skipped",
      sessionId: session,
      storyId: attempt.storyId,
      reason: "zero_delivery_streak",
      zeroDeliveries: nextCount,
      ...(attempt.cycleId !== undefined ? { cycleId: attempt.cycleId } : {}),
      ts: deps.nowSec(),
    });
    appendGoalAlert(projectPath, slug, attempt.storyId, attempt.cycleId, deps.nowIso());
  }
}

function goalEvaluationFromTruth(truths: StoryTruth[], scope: GoalScope, opts: { allowEmptyAllComplete: boolean }): GoalEvaluation {
  const total = truths.length;
  const delivered = truths.filter((truth) => truth.delivered).length;
  const blockers = truths
    .filter((truth) => !truth.delivered || truth.state === "fail" || truth.state === "unknown")
    .map((truth) => `${truth.storyId}:${truth.state}:${truth.reason}`);
  if ((total > 0 || (scope.kind === "all" && opts.allowEmptyAllComplete)) && blockers.length === 0) {
    return { complete: true, reason: "all_delivered", blockers: [], total, delivered };
  }
  const first = blockers[0];
  return {
    complete: false,
    reason: first === undefined ? "waiting:no_scope_cards" : `blocked:${first.replace(/:fail:/, ":").replace(/:unknown:/, ":")}`,
    blockers,
    total,
    delivered,
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed === "" || out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

function workerAgentsFromRunRows(rows: readonly Record<string, unknown>[]): string[] {
  return uniqueStrings(rows.map((row) => (typeof row["agent"] === "string" ? row["agent"] : "")));
}

async function workerAgentsForSession(projectPath: string, session: string): Promise<string[]> {
  const out: string[] = [];
  let inSession = false;
  const path = eventsPath(projectPath);
  if (!existsSync(path)) return out;
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const event = parseEventLine(line);
      if (event === null) continue;
      if (event.type === "goal:session_start") {
        if (event.sessionId === session) inSession = true;
        else if (inSession) break;
        continue;
      }
      if (!inSession) continue;
      if (event.type === "cycle:start" || event.type === "route:resolve") out.push(event.agent);
    }
  } catch {
    return [];
  } finally {
    lines.close();
  }
  return uniqueStrings(out);
}

function killFinalReviewChild(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      /* not a group leader or already gone; fall back to the child handle */
    }
  }
  return child.kill(signal);
}

function releaseFinalReviewChild(child: ChildProcess): void {
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

export function spawnFinalReviewAgent(agent: string, cwd: string, prompt: string, timeoutMs: number): Promise<FinalReviewProcessResult> {
  const cmd = textAgentArgv(agent, prompt);
  if (cmd === null) return Promise.resolve({ status: "error", reason: "unsupported_reviewer", stdout: "" });
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const child = spawn(cmd.bin, cmd.args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const finish = (result: FinalReviewProcessResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };
    timer = setTimeout(() => {
      timedOut = true;
      killFinalReviewChild(child, "SIGKILL");
      releaseFinalReviewChild(child);
      finish({ status: "timeout", stdout });
    }, timeoutMs);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = boundedAppend(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = boundedAppend(stderr, chunk);
    });
    child.on("error", (error) => finish({ status: "error", reason: error.message, stdout }));
    child.on("exit", (code, signal) => {
      setImmediate(() => {
        if (timedOut) finish({ status: "timeout", stdout });
        else if (code === 0) finish({ status: "ok", stdout });
        else finish({ status: "error", reason: `exit_${code ?? signal ?? "signal"}:${stderr.trim().slice(0, 200)}`, stdout });
      });
    });
    child.on("close", (code) => {
      if (timedOut) finish({ status: "timeout", stdout });
      else if (code === 0) finish({ status: "ok", stdout });
      else finish({ status: "error", reason: `exit_${code ?? "signal"}:${stderr.trim().slice(0, 200)}`, stdout });
    });
  });
}

function reviewAgentPool(): string[] {
  const installed = agentsInstalled(realAgentEnv());
  const current = projectAgent();
  return uniqueStrings(agentInstalledByName(current) ? [...installed, current] : installed);
}

function finalReviewPrompt(input: GoalFinalReviewInput): string {
  return [
    "You are Roll's final goal review gate. Review only; do not edit files, create commits, push, or open PRs.",
    "The goal truth adjudicator says all scoped cards are delivered. Challenge that conclusion before completion is sealed.",
    "Check acceptance criteria, implementation, tests, and evidence for watered-down or convenient readings.",
    "Return exactly one VERDICT line with APPROVE or REQUEST_CHANGES. Add one REASON line and optional FINDING lines.",
    "",
    `Session: ${input.sessionId}`,
    `Requested review mode: ${input.mode}`,
    `Goal: ${JSON.stringify({ scope: input.goal.scope, usage: input.goal.usage, lastDecisionReason: input.goal.lastDecisionReason ?? "" })}`,
    `Truth evaluation: ${JSON.stringify(input.evaluation)}`,
    "",
    "Format:",
    "VERDICT: APPROVE|REQUEST_CHANGES",
    "REASON: <short reason>",
    "FINDING: <concrete issue>",
  ].join("\n");
}

type FinalReviewProcessResult =
  | { status: "ok"; stdout: string }
  | { status: "timeout"; stdout: string }
  | { status: "error"; reason: string; stdout: string };

function boundedAppend(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");
  return next.length > 100_000 ? next.slice(-100_000) : next;
}

function reviewFindings(stdout: string): string[] {
  const findings = [...stdout.matchAll(/^\s*FINDING:\s*(.+)$/gim)].map((m) => (m[1] ?? "").trim()).filter((line) => line !== "");
  if (findings.length > 0) return findings.slice(0, 10);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^VERDICT:/i.test(line) && !/^REASON:/i.test(line))
    .slice(0, 5);
}

function reviewReason(stdout: string, fallback: string): string {
  const explicit = /^\s*REASON:\s*(.+)$/im.exec(stdout)?.[1]?.trim();
  if (explicit !== undefined && explicit !== "") return explicit.slice(0, 500);
  return reviewFindings(stdout)[0]?.slice(0, 500) ?? fallback;
}

function reviewVerdict(stdout: string): "APPROVE" | "REQUEST_CHANGES" {
  const lines = [...stdout.matchAll(/^\s*VERDICT:\s*(APPROVE|REQUEST_CHANGES)\s*$/gim)].map((m) => (m[1] ?? "").toUpperCase());
  return lines.length === 1 && lines[0] === "APPROVE" ? "APPROVE" : "REQUEST_CHANGES";
}

async function defaultFinalReview(input: GoalFinalReviewInput): Promise<GoalFinalReviewResult> {
  const workers = input.workerAgents.length > 0 ? input.workerAgents : [projectAgent()];
  const selection = selectGoalFinalReviewer({
    mode: input.mode,
    installedAgents: reviewAgentPool(),
    workerAgents: workers,
  });
  if (selection.status === "unavailable") {
    return {
      effectiveMode: input.mode === "self" ? "self" : "hetero",
      reviewer: "",
      provider: "",
      verdict: "ERROR",
      reason: selection.reason,
      findings: [],
    };
  }

  const ran = await spawnFinalReviewAgent(selection.reviewer, input.projectPath, finalReviewPrompt(input), input.timeoutMs);
  if (ran.status === "timeout") {
    return {
      effectiveMode: selection.effectiveMode,
      reviewer: selection.reviewer,
      provider: selection.provider,
      verdict: "TIMEOUT",
      reason: "final_review_timeout",
      findings: reviewFindings(ran.stdout),
      ...(selection.degraded ? { degradedReason: selection.reason ?? "single_provider_available" } : {}),
    };
  }
  if (ran.status === "error") {
    return {
      effectiveMode: selection.effectiveMode,
      reviewer: selection.reviewer,
      provider: selection.provider,
      verdict: "ERROR",
      reason: ran.reason,
      findings: reviewFindings(ran.stdout),
      ...(selection.degraded ? { degradedReason: selection.reason ?? "single_provider_available" } : {}),
    };
  }
  const verdict = reviewVerdict(ran.stdout);
  return {
    effectiveMode: selection.effectiveMode,
    reviewer: selection.reviewer,
    provider: selection.provider,
    verdict,
    reason: reviewReason(ran.stdout, verdict === "APPROVE" ? "approved" : "review_requested_changes"),
    findings: reviewFindings(ran.stdout),
    ...(selection.degraded ? { degradedReason: selection.reason ?? "single_provider_available" } : {}),
  };
}

function backlogExists(projectPath: string): boolean {
  return existsSync(join(projectPath, ".roll", "backlog.md"));
}

interface FinalReviewGateResult {
  passed: boolean;
  reason: string;
}

function reviewBlockReason(verdict: GoalFinalReviewResult["verdict"], reason: string): string {
  return `final_review:${verdict.toLowerCase()}:${reason}`;
}

function safeNotePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "review";
}

function finalReviewNoteBody(session: string, review: GoalFinalReviewResult, at: string): string {
  const findings = review.findings.length > 0 ? review.findings.map((finding) => `- ${finding}`).join("\n") : "- No detailed findings provided.";
  return [
    "---",
    "source: goal_final_review",
    `session: ${session}`,
    `verdict: ${review.verdict}`,
    `reviewer: ${review.reviewer}`,
    `provider: ${review.provider}`,
    `created: ${at}`,
    "---",
    "",
    `# Goal final review: ${review.verdict}`,
    "",
    `Reason: ${review.reason}`,
    "",
    "Findings:",
    findings,
    "",
  ].join("\n");
}

function writeFinalReviewNotes(projectPath: string, goal: RollGoal, session: string, review: GoalFinalReviewResult, at: string): void {
  if (review.verdict === "APPROVE") return;
  const fileName = `final-review-${safeNotePart(session)}.md`;
  const body = finalReviewNoteBody(session, review, at);
  for (const row of rowsForScope(projectPath, goal.scope)) {
    const notesDir = join(cardArchiveDir(projectPath, row.id), "notes");
    mkdirSync(notesDir, { recursive: true });
    writeFileSync(join(notesDir, fileName), body, "utf8");
  }
}

async function runFinalReviewGate(
  projectPath: string,
  goal: RollGoal,
  evaluation: GoalEvaluation,
  deps: LoopGoDeps,
  session: string,
  workerAgents: readonly string[],
  bus: EventBus,
): Promise<FinalReviewGateResult> {
  const mode = goal.review.mode;
  if (mode === "off") {
    bus.appendEvent(eventsPath(projectPath), {
      type: "goal:final_review",
      sessionId: session,
      mode,
      effectiveMode: "off",
      reviewer: "",
      provider: "",
      verdict: "SKIPPED",
      reason: "review_off",
      findings: [],
      ts: deps.nowSec(),
    });
    return { passed: true, reason: "final_review:skipped:review_off" };
  }

  let review: GoalFinalReviewResult;
  try {
    const inferredWorkers = workerAgents.length > 0 ? uniqueStrings(workerAgents) : await workerAgentsForSession(projectPath, session);
    review = await (deps.finalReview ?? defaultFinalReview)({
      projectPath,
      sessionId: session,
      mode,
      goal,
      evaluation,
      workerAgents: inferredWorkers,
      timeoutMs: FINAL_REVIEW_TIMEOUT_MS,
    });
  } catch (error) {
    review = {
      effectiveMode: mode === "self" ? "self" : "hetero",
      reviewer: "",
      provider: "",
      verdict: "ERROR",
      reason: error instanceof Error ? error.message : "final_review_error",
      findings: [],
    };
  }

  if (mode === "auto" && review.degradedReason !== undefined) {
    bus.appendEvent(eventsPath(projectPath), {
      type: "goal:review_degraded",
      sessionId: session,
      from: "auto",
      to: "self",
      reviewer: review.reviewer,
      provider: review.provider,
      reason: review.degradedReason,
      ts: deps.nowSec(),
    });
  }
  bus.appendEvent(eventsPath(projectPath), {
    type: "goal:final_review",
    sessionId: session,
    mode,
    effectiveMode: review.effectiveMode,
    reviewer: review.reviewer,
    provider: review.provider,
    verdict: review.verdict,
    reason: review.reason,
    findings: review.findings,
    ts: deps.nowSec(),
  });
  writeFinalReviewNotes(projectPath, goal, session, review, deps.nowIso());
  return {
    passed: review.verdict === "APPROVE",
    reason: reviewBlockReason(review.verdict, review.reason),
  };
}

async function evaluateGoal(
  projectPath: string,
  goal: RollGoal,
  deps: LoopGoDeps,
  session: string,
  workerAgents: readonly string[],
  bus: EventBus,
): Promise<{ goal: RollGoal; complete: boolean; reason: string; reviewBlocked: boolean }> {
  const rows = rowsForScope(projectPath, goal.scope);
  const truths: StoryTruth[] = [];
  for (const row of rows) {
    const prEvidence = deps.prEvidence !== undefined ? await deps.prEvidence(projectPath, row.id, row.status) : undefined;
    truths.push(storyTruthFromBacklog(row.id, row.status, { ...(prEvidence !== undefined ? { prEvidence } : {}), nowSec: deps.nowSec() }));
  }
  const verdict = goalEvaluationFromTruth(truths, goal.scope, { allowEmptyAllComplete: backlogExists(projectPath) });
  bus.appendEvent(eventsPath(projectPath), {
    type: "goal:evaluated",
    sessionId: session,
    status: verdict.complete ? "complete" : "continue",
    total: verdict.total,
    delivered: verdict.delivered,
    reason: verdict.reason,
    blockers: verdict.blockers,
    ts: deps.nowSec(),
  });
  const at = deps.nowIso();
  if (verdict.complete) {
    const review = await runFinalReviewGate(projectPath, goal, verdict, deps, session, workerAgents, bus);
    if (!review.passed) {
      const next = { ...goal, updatedAt: at, lastDecisionReason: review.reason };
      writeGoal(goalPath(projectPath), next);
      return { goal: next, complete: false, reason: review.reason, reviewBlocked: true };
    }
    const reason = `${verdict.reason}; ${review.reason}`;
    const next = transitionGoal(goal, "complete", { actor: "adjudicator", reason, at });
    writeGoal(goalPath(projectPath), next);
    appendGoalState(bus, eventsPath(projectPath), goal.status, next, "adjudicator", reason, deps.nowSec());
    return { goal: next, complete: true, reason, reviewBlocked: false };
  }
  const next = { ...goal, updatedAt: at, lastDecisionReason: verdict.reason };
  writeGoal(goalPath(projectPath), next);
  return { goal: next, complete: false, reason: verdict.reason, reviewBlocked: false };
}

function hasSafetyPauseSince(path: string, since: number): boolean {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (row["type"] === "policy:safety_pause" && typeof row["ts"] === "number" && row["ts"] >= since) return true;
  }
  return false;
}

function sessionId(at: string, pid: number): string {
  const compact = at.replace(/\D/g, "").slice(0, 14) || String(Date.now());
  return `goal-${compact}-${pid}`;
}

function appendGoalState(bus: EventBus, path: string, from: GoalStatus, goal: RollGoal, actor: "owner" | "system" | "adjudicator", reason: string, ts: number): void {
  bus.appendEvent(path, {
    type: "goal:state",
    schema: GOAL_SCHEMA_VERSION,
    from,
    to: goal.status,
    actor,
    reason,
    ts,
  });
}

function pauseGoal(projectPath: string, bus: EventBus, reason: string, at: string, ts: number): RollGoal | undefined {
  const path = goalPath(projectPath);
  const goal = readGoal(path);
  if (goal === undefined) return undefined;
  if (goal.status === "paused" || goal.status === "complete") return goal;
  const next = transitionGoal(goal, "paused", { actor: "system", reason, at });
  writeGoal(path, next);
  appendGoalState(bus, eventsPath(projectPath), goal.status, next, "system", reason, ts);
  return next;
}

function updateUsage(projectPath: string, goal: RollGoal, baseline: RunSummary, initial: RunSummary, at: string): RollGoal {
  const current = summarizeRuns(runsPath(projectPath));
  return {
    ...goal,
    usage: {
      cycles: initial.cycles + Math.max(0, current.cycles - baseline.cycles),
      costUsd: initial.costUsd + Math.max(0, current.costUsd - baseline.costUsd),
    },
    updatedAt: at,
  };
}

function installStopHandlers(onStop: (signal: string) => void): () => void {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = signals.map((signal) => {
    const handler = (): void => onStop(signal);
    process.on(signal, handler);
    return { signal, handler };
  });
  return () => {
    for (const { signal, handler } of handlers) process.off(signal, handler);
  };
}

export async function loopGoCommand(args: string[], deps: LoopGoDeps = realDeps()): Promise<number> {
  if (hasHelpArg(args)) {
    process.stdout.write(loopGoHelp());
    return 0;
  }
  const opts = parseOptions(args);
  const id = await deps.identity();
  if (!opts.worker && !opts.noTmux && deps.hasTmux()) {
    const started = deps.startTmux({ projectPath: id.path, slug: id.slug, args, rollBin: rollBin() });
    if (started) {
      process.stdout.write(
        `Goal go session started in tmux — attach anytime: tmux attach -t roll-loop-${id.slug}\n` +
          `goal 连跑会话已在 tmux 启动 — 可随时观察: tmux attach -t roll-loop-${id.slug}\n`,
      );
      return 0;
    }
  }
  return runGoWorker(id, opts, deps);
}

async function runGoWorker(id: ProjectId, opts: GoOptions, deps: LoopGoDeps): Promise<number> {
  const rt = runtimeDir(id.path);
  mkdirSync(rt, { recursive: true });
  const bus = new EventBus();
  const evPath = eventsPath(id.path);
  const lockPath = goLockPath(id.path);
  const acq = acquireLock(lockPath, deps.pid(), { staleSec: GO_LOCK_STALE_SEC, now: deps.nowSec });
  if (!acq.acquired) {
    bus.appendEvent(evPath, {
      type: "goal:tick_skipped",
      reason: "go_session_lock",
      ...(acq.heldByPid !== undefined ? { heldByPid: acq.heldByPid } : {}),
      ts: deps.nowSec(),
    });
    process.stdout.write(`roll loop go: go session already active (pid ${acq.heldByPid ?? "?"}); skipped\n`);
    return 0;
  }

  const startedAt = deps.nowIso();
  const startedSec = deps.nowSec();
  const sid = sessionId(startedAt, deps.pid());
  const baseline = summarizeRuns(runsPath(id.path));
  let initialUsage: RunSummary = { cycles: 0, costUsd: 0 };
  let goal: RollGoal;
  const progress: ProgressState = { zeroStreaks: new Map(), skippedCards: new Set() };
  let stopReason: string | undefined;
  let stopRequested = false;
  let workerAgents: string[] = [];
  const disposeSignals = installStopHandlers((signal) => {
    stopRequested = true;
    stopReason = `signal_${signal}`;
  });

  try {
    const gPath = goalPath(id.path);
    const existing = readGoal(gPath);
    if (existing === undefined) {
      goal = createGoal(opts, startedAt);
      writeGoal(gPath, goal);
      bus.appendEvent(evPath, {
        type: "goal:created",
        schema: GOAL_SCHEMA_VERSION,
        scope: goal.scope,
        status: "active",
        review: goal.review.mode,
        ...(goal.budgetUsd !== undefined ? { budgetUsd: goal.budgetUsd } : {}),
        ts: startedSec,
      });
    } else if (existing.status === "complete") {
      process.stderr.write("roll loop go: goal is already complete; refusing to restart it\n");
      return 1;
    } else if (existing.status === "active") {
      goal = existing;
    } else {
      goal = transitionGoal(existing, "active", { actor: "owner", reason: "go_start", at: startedAt });
      writeGoal(gPath, goal);
      appendGoalState(bus, evPath, existing.status, goal, "owner", "go_start", startedSec);
    }
    initialUsage = { ...goal.usage };
    bus.appendEvent(evPath, { type: "goal:session_start", sessionId: sid, scope: goal.scope, ts: startedSec });

    while (true) {
      if (stopRequested) break;
      if (existsSync(pauseMarkerPath(id.path, id.slug))) {
        stopReason = "pause_marker";
        break;
      }
      const maxCycles = goal.limits.maxCycles;
      if (maxCycles !== undefined && goal.usage.cycles >= maxCycles) {
        stopReason = "max_cycles";
        break;
      }

      const allowedCards = allowedCardsForScope(id.path, goal, progress);
      if (allScopeCardsSkipped(id.path, goal, progress)) {
        stopReason = "no_progress_on_all_cards";
        goal = pauseGoal(id.path, bus, stopReason, deps.nowIso(), deps.nowSec()) ?? goal;
        break;
      }
      const before = readRunSnapshot(runsPath(id.path));
      await deps.runOnce({ projectPath: id.path, allowedCards });
      goal = updateUsage(id.path, goal, baseline, initialUsage, deps.nowIso());
      writeGoal(gPath, goal);
      const after = readRunSnapshot(runsPath(id.path));
      const appendedRows = after.rows.slice(before.rows.length);
      workerAgents = uniqueStrings([...workerAgents, ...workerAgentsFromRunRows(appendedRows)]);
      updateProgressFromRows(id.path, id.slug, sid, appendedRows, progress, deps, bus);
      if (allScopeCardsSkipped(id.path, goal, progress)) {
        stopReason = "no_progress_on_all_cards";
        goal = pauseGoal(id.path, bus, stopReason, deps.nowIso(), deps.nowSec()) ?? goal;
        break;
      }
      const adjudication = await evaluateGoal(id.path, goal, deps, sid, workerAgents, bus);
      goal = adjudication.goal;
      if (adjudication.complete) {
        stopReason = "goal_complete";
        break;
      }
      if (adjudication.reviewBlocked) {
        stopReason = adjudication.reason;
        break;
      }

      if (hasSafetyPauseSince(evPath, startedSec)) {
        stopReason = "safety_pause";
        break;
      }
      if (existsSync(pauseMarkerPath(id.path, id.slug))) {
        stopReason = "pause_marker";
        break;
      }
      if (after.summary.cycles <= before.summary.cycles) {
        stopReason = "no_cycle_terminal";
        break;
      }
    }

    const finalReason = stopReason ?? "stop_requested";
    const finalGoal = goal.status === "complete" ? goal : pauseGoal(id.path, bus, finalReason, deps.nowIso(), deps.nowSec()) ?? goal;
    bus.appendEvent(evPath, {
      type: "goal:session_end",
      sessionId: sid,
      status: finalGoal.status,
      reason: finalReason,
      cycles: finalGoal.usage.cycles - initialUsage.cycles,
      ts: deps.nowSec(),
    });
    process.stdout.write(`roll loop go: stopped at cycle boundary (${finalReason})\n`);
    return 0;
  } finally {
    disposeSignals();
    releaseLock(lockPath);
  }
}
