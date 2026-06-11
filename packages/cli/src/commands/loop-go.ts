import { EventBus, parseBacklog, type AuditPrEvidence, type StoryTruth } from "@roll/core";
import {
  GOAL_REVIEW_MODES,
  GOAL_SCHEMA_VERSION,
  classifyStatus,
  parseEventLine,
  parseGoalYaml,
  renderGoalYaml,
  transitionGoal,
  type GoalReviewMode,
  type GoalSafetyGate,
  type GoalScope,
  type GoalStatus,
  type RollGoal,
} from "@roll/spec";
import { acquireLock, ghRepoSlug, prViewMergeInfo, projectIdentity, releaseLock, remoteUrl } from "@roll/infra";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { GOAL_ALLOWED_CARDS_ENV, runAttemptFromRow } from "../lib/goal-progress.js";
import { projectAgent } from "./agent-list.js";
import { cardArchiveDir } from "../lib/archive.js";
import { storyTruthFromBacklog } from "../lib/truth-adapter.js";
import { readAnthropicUsageLimits } from "../lib/anthropic-usage.js";
import { runPeerReview, spawnPeerReviewAgent, type SpawnPeerReviewResult } from "./peer.js";

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
  readUsageLimits?: () => Promise<UsageLimitSnapshot>;
  sleep?: (ms: number) => Promise<void>;
  prEvidence?: (projectPath: string, storyId: string, backlogStatus: string) => Promise<AuditPrEvidence | undefined>;
  finalReview?: (input: GoalFinalReviewInput) => Promise<GoalFinalReviewResult>;
}

export type UsageLimitWindowName = "five_hour" | "weekly";

export interface UsageLimitWindow {
  window: UsageLimitWindowName;
  used: number;
  limit: number;
  resetAtSec?: number;
}

export type UsageLimitSnapshot =
  | { status: "unknown"; reason: string }
  | { status: "known"; windows: UsageLimitWindow[] };

interface GoOptions {
  worker: boolean;
  noTmux: boolean;
  noWait: boolean;
  scope: GoalScope;
  budgetUsd?: number;
  maxCycles?: number;
  forSeconds?: number;
  usageThreshold: number;
  reviewMode: GoalReviewMode;
  reviewModeSpecified: boolean;
}

interface RunSummary {
  cycles: number;
  costUsd: number;
  costUnknownRows: number;
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
  commandFamily?: string;
  verdict: "APPROVE" | "REQUEST_CHANGES" | "TIMEOUT" | "ERROR";
  reason: string;
  findings: string[];
  durationMs?: number;
  transcriptPath?: string;
  evidencePath?: string;
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
    readUsageLimits: readAnthropicUsageLimits,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
  let forSeconds: number | undefined;
  let usageThreshold = 0.85;
  const cards: string[] = [];
  let worker = false;
  let noTmux = false;
  let noWait = false;
  let reviewMode: GoalReviewMode = "auto";
  let reviewModeSpecified = false;

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
    if (arg === "--no-wait") {
      noWait = true;
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
      budgetUsd = parseRequiredNonNegativeNumber(args[i + 1], "--budget");
      i += 1;
      continue;
    }
    if (arg.startsWith("--budget=")) {
      budgetUsd = parseRequiredNonNegativeNumber(arg.slice("--budget=".length), "--budget");
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
    if (arg === "--for") {
      forSeconds = parseRequiredDurationSeconds(args[i + 1], "--for");
      i += 1;
      continue;
    }
    if (arg.startsWith("--for=")) {
      forSeconds = parseRequiredDurationSeconds(arg.slice("--for=".length), "--for");
      continue;
    }
    if (arg === "--usage-threshold") {
      usageThreshold = parseRequiredRatio(args[i + 1], "--usage-threshold");
      i += 1;
      continue;
    }
    if (arg.startsWith("--usage-threshold=")) {
      usageThreshold = parseRequiredRatio(arg.slice("--usage-threshold=".length), "--usage-threshold");
      continue;
    }
    if (arg === "--review") {
      reviewMode = parseReviewMode(args[i + 1]);
      reviewModeSpecified = true;
      i += 1;
      continue;
    }
    if (arg.startsWith("--review=")) {
      reviewMode = parseReviewMode(arg.slice("--review=".length));
      reviewModeSpecified = true;
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
    noWait,
    scope,
    reviewMode,
    reviewModeSpecified,
    usageThreshold,
    ...(budgetUsd !== undefined ? { budgetUsd } : {}),
    ...(maxCycles !== undefined ? { maxCycles } : {}),
    ...(forSeconds !== undefined ? { forSeconds } : {}),
  };
}

function hasHelpArg(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function loopGoHelp(): string {
  return [
    "Usage: roll loop go [--epic <name>|--cards <ids>] [--budget <usd>] [--for <duration>] [--max-cycles <n>] [--review <auto|hetero|self|off>] [--no-wait] [--no-tmux]",
    "  Chain goal-mode cycles until the scoped backlog is complete, paused, budget-limited, or capped.",
    "  按 goal 范围连续执行 cycle，直到完成、暂停、预算受限或达到上限。",
    "",
    "Options:",
    "  --epic <name>       Limit the goal to one epic.",
    "  --cards <ids>       Limit the goal to comma/space separated card IDs.",
    "  --budget <usd>      Move the goal to budget_limited once recorded cost reaches the budget.",
    "  --for <duration>    Stop after the current cycle once the wall-clock box is reached (default unit: minutes).",
    "  --max-cycles <n>    Stop after n cycles in this go session.",
    "  --usage-threshold <ratio>  Pause when account usage reaches this ratio; default 0.85.",
    "  --no-wait           Do not wait for usage windows to recover after a usage-limit pause.",
    "  --review <mode>     Final review policy before completion: auto, hetero, self, or off.",
    "  --no-tmux           Run in the current process instead of starting a tmux session.",
    "",
    "Safety gates:",
    "  budget  Uses effective run cost; missing cost rows are unknown, not zero, and stop conservatively.",
    "  usage   Audits five-hour and weekly account headroom; unavailable usage APIs record an audit event but do not block.",
    "  timebox Stops only at a cycle boundary and records a goal:gate_tripped event.",
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
  const raw = (value ?? "").trim();
  if (raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function parseRequiredNonNegativeNumber(value: string | undefined, flag: string): number {
  const n = parseNonNegativeNumber(value);
  if (n === undefined) throw new Error(`roll loop go: ${flag} must be a non-negative number`);
  return n;
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  const n = parseNonNegativeNumber(value);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

function parseRatio(value: string | undefined): number | undefined {
  const n = parseNonNegativeNumber(value);
  if (n === undefined || n > 1) return undefined;
  return n;
}

function parseRequiredRatio(value: string | undefined, flag: string): number {
  const n = parseRatio(value);
  if (n === undefined) throw new Error(`roll loop go: ${flag} must be a ratio between 0 and 1`);
  return n;
}

function parseDurationSeconds(value: string | undefined): number | undefined {
  const raw = (value ?? "").trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(raw);
  if (match === null) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const unit = match[2] ?? "m";
  if (unit === "ms") return amount / 1000;
  if (unit === "s") return amount;
  if (unit === "m") return amount * 60;
  if (unit === "h") return amount * 3600;
  return amount * 86_400;
}

function parseRequiredDurationSeconds(value: string | undefined, flag: string): number {
  const seconds = parseDurationSeconds(value);
  if (seconds === undefined) throw new Error(`roll loop go: ${flag} must be a duration like 30m, 5h, or 1d`);
  return seconds;
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
      ...(opts.forSeconds !== undefined ? { maxHours: opts.forSeconds / 3600 } : {}),
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
    return { rows: [], summary: { cycles: 0, costUsd: 0, costUnknownRows: 0 } };
  }
  const rows: Record<string, unknown>[] = [];
  let cycles = 0;
  let costUsd = 0;
  let costUnknownRows = 0;
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
    const effective = typeof row["cost_effective_usd"] === "number" && Number.isFinite(row["cost_effective_usd"]) ? row["cost_effective_usd"] : undefined;
    const estimated = typeof row["cost_usd"] === "number" && Number.isFinite(row["cost_usd"]) ? row["cost_usd"] : undefined;
    if (effective === undefined && estimated === undefined) {
      costUnknownRows += 1;
    } else {
      costUsd += effective ?? estimated ?? 0;
    }
  }
  return { rows, summary: { cycles, costUsd, costUnknownRows } };
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

export function spawnFinalReviewAgent(agent: string, cwd: string, prompt: string, timeoutMs: number): Promise<FinalReviewProcessResult> {
  return spawnPeerReviewAgent({ agent, projectPath: cwd, prompt, timeoutMs });
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
  SpawnPeerReviewResult;

async function defaultFinalReview(input: GoalFinalReviewInput): Promise<GoalFinalReviewResult> {
  const facts = await runPeerReview({
    projectPath: input.projectPath,
    prompt: finalReviewPrompt(input),
    mode: input.mode,
    workerAgents: input.workerAgents.length > 0 ? input.workerAgents : [projectAgent()],
    timeoutMs: input.timeoutMs,
    purpose: "goal_final_review",
  });
  return {
    effectiveMode: facts.effectiveMode ?? (input.mode === "self" ? "self" : "hetero"),
    reviewer: facts.agent,
    provider: facts.provider,
    commandFamily: facts.commandFamily,
    verdict: facts.verdict,
    reason: facts.reason,
    findings: facts.findings,
    durationMs: facts.durationMs,
    ...(facts.transcriptPath !== undefined ? { transcriptPath: facts.transcriptPath } : {}),
    ...(facts.evidencePath !== undefined ? { evidencePath: facts.evidencePath } : {}),
    ...(facts.degradedReason !== undefined ? { degradedReason: facts.degradedReason } : {}),
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
    ...(review.commandFamily !== undefined ? { commandFamily: review.commandFamily } : {}),
    ...(review.durationMs !== undefined ? { durationMs: review.durationMs } : {}),
    ...(review.transcriptPath !== undefined ? { transcriptPath: review.transcriptPath } : {}),
    ...(review.evidencePath !== undefined ? { evidencePath: review.evidencePath } : {}),
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

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function withSafety(goal: RollGoal, gate: GoalSafetyGate, reason: string, reading: string, at: string): RollGoal {
  return {
    ...goal,
    safety: {
      lastGate: gate,
      lastReason: reason,
      lastAt: at,
      lastReading: reading,
    },
  };
}

function appendGoalGate(
  bus: EventBus,
  path: string,
  session: string,
  gate: GoalSafetyGate,
  action: "audit" | "paused" | "budget_limited",
  reason: string,
  reading: Record<string, string | number | boolean>,
  ts: number,
  waitUntilSec?: number,
): void {
  bus.appendEvent(path, {
    type: "goal:gate_tripped",
    sessionId: session,
    gate,
    action,
    reason,
    reading,
    ...(waitUntilSec !== undefined ? { waitUntilSec } : {}),
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
  const costUnknownRows = initial.costUnknownRows + Math.max(0, current.costUnknownRows - baseline.costUnknownRows);
  return {
    ...goal,
    usage: {
      cycles: initial.cycles + Math.max(0, current.cycles - baseline.cycles),
      costUsd: initial.costUsd + Math.max(0, current.costUsd - baseline.costUsd),
      ...(costUnknownRows > 0 ? { costUnknownRows } : {}),
    },
    updatedAt: at,
  };
}

function runSummaryFromGoal(goal: RollGoal): RunSummary {
  return {
    cycles: goal.usage.cycles,
    costUsd: goal.usage.costUsd,
    costUnknownRows: goal.usage.costUnknownRows ?? 0,
  };
}

function applyRunOptions(goal: RollGoal, opts: GoOptions, at: string): RollGoal {
  const maxHours = opts.forSeconds !== undefined ? opts.forSeconds / 3600 : goal.limits.maxHours;
  return {
    ...goal,
    ...(opts.budgetUsd !== undefined ? { budgetUsd: opts.budgetUsd } : {}),
    review: opts.reviewModeSpecified ? { mode: opts.reviewMode } : goal.review,
    limits: {
      ...goal.limits,
      ...(opts.maxCycles !== undefined ? { maxCycles: opts.maxCycles } : {}),
      ...(maxHours !== undefined ? { maxHours } : {}),
    },
    updatedAt: at,
  };
}

function applyBudgetGate(projectPath: string, bus: EventBus, session: string, goal: RollGoal, deps: LoopGoDeps): { goal: RollGoal; stopped: boolean; reason?: string } {
  const budgetUsd = goal.budgetUsd;
  if (budgetUsd === undefined) return { goal, stopped: false };
  const unknownRows = goal.usage.costUnknownRows ?? 0;
  const at = deps.nowIso();
  const ts = deps.nowSec();
  if (unknownRows > 0) {
    const reason = "budget_unknown_cost";
    const reading = { costUsd: goal.usage.costUsd, budgetUsd, unknownCostRows: unknownRows };
    const labelled = withSafety(goal, "budget", reason, `${money(goal.usage.costUsd)} / ${money(budgetUsd)}; unknown cost rows ${unknownRows}`, at);
    const next = transitionGoal(labelled, "budget_limited", { actor: "system", reason, at });
    writeGoal(goalPath(projectPath), next);
    appendGoalState(bus, eventsPath(projectPath), goal.status, next, "system", reason, ts);
    appendGoalGate(bus, eventsPath(projectPath), session, "budget", "budget_limited", reason, reading, ts);
    return { goal: next, stopped: true, reason };
  }
  if (goal.usage.costUsd < budgetUsd) return { goal, stopped: false };
  const reason = "budget_exceeded";
  const reading = { costUsd: goal.usage.costUsd, budgetUsd };
  const labelled = withSafety(goal, "budget", reason, `${money(goal.usage.costUsd)} / ${money(budgetUsd)}`, at);
  const next = transitionGoal(labelled, "budget_limited", { actor: "system", reason, at });
  writeGoal(goalPath(projectPath), next);
  appendGoalState(bus, eventsPath(projectPath), goal.status, next, "system", reason, ts);
  appendGoalGate(bus, eventsPath(projectPath), session, "budget", "budget_limited", reason, reading, ts);
  return { goal: next, stopped: true, reason };
}

function usageRatio(window: UsageLimitWindow): number {
  return window.limit > 0 ? window.used / window.limit : 0;
}

function trippedUsageWindow(snapshot: UsageLimitSnapshot, threshold: number): UsageLimitWindow | undefined {
  if (snapshot.status === "unknown") return undefined;
  return snapshot.windows
    .filter((window) => usageRatio(window) >= threshold)
    .sort((a, b) => usageRatio(b) - usageRatio(a))[0];
}

async function enforceUsageGate(
  projectPath: string,
  bus: EventBus,
  session: string,
  goal: RollGoal,
  opts: GoOptions,
  deps: LoopGoDeps,
): Promise<{ goal: RollGoal; stopped: boolean; reason?: string }> {
  const read = deps.readUsageLimits;
  if (read === undefined) return { goal, stopped: false };
  let currentGoal = goal;
  while (true) {
    const snapshot = await read();
    const ts = deps.nowSec();
    if (snapshot.status === "unknown") {
      appendGoalGate(bus, eventsPath(projectPath), session, "usage", "audit", snapshot.reason, { status: "unknown", reason: snapshot.reason }, ts);
      return { goal: currentGoal, stopped: false };
    }
    const tripped = trippedUsageWindow(snapshot, opts.usageThreshold);
    if (tripped === undefined) return { goal: currentGoal, stopped: false };

    const ratio = usageRatio(tripped);
    const reason = "usage_limit_threshold";
    const at = deps.nowIso();
    const reading = {
      window: tripped.window,
      used: tripped.used,
      limit: tripped.limit,
      ratio,
      threshold: opts.usageThreshold,
    };
    const labelled = withSafety(currentGoal, "usage", reason, `${tripped.window} ${tripped.used}/${tripped.limit} (${percent(ratio)})`, at);
    const paused = transitionGoal(labelled, "paused", { actor: "system", reason, at });
    writeGoal(goalPath(projectPath), paused);
    appendGoalState(bus, eventsPath(projectPath), currentGoal.status, paused, "system", reason, ts);
    appendGoalGate(bus, eventsPath(projectPath), session, "usage", "paused", reason, reading, ts, tripped.resetAtSec);
    if (opts.noWait) return { goal: paused, stopped: true, reason };

    const waitUntilSec = tripped.resetAtSec ?? ts + 60;
    await (deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(Math.max(0, waitUntilSec - ts) * 1000);
    const resumedAt = deps.nowIso();
    const resumed = transitionGoal(paused, "active", { actor: "system", reason: "usage_window_recovered", at: resumedAt });
    writeGoal(goalPath(projectPath), resumed);
    appendGoalState(bus, eventsPath(projectPath), paused.status, resumed, "system", "usage_window_recovered", deps.nowSec());
    currentGoal = resumed;
  }
}

function timeboxDeadlineSec(goal: RollGoal, opts: GoOptions, startedSec: number): number | undefined {
  const seconds = opts.forSeconds ?? (goal.limits.maxHours !== undefined ? goal.limits.maxHours * 3600 : undefined);
  return seconds === undefined ? undefined : startedSec + seconds;
}

function applyTimeboxGate(
  projectPath: string,
  bus: EventBus,
  session: string,
  goal: RollGoal,
  deps: LoopGoDeps,
  deadlineSec: number | undefined,
): { goal: RollGoal; stopped: boolean; reason?: string } {
  if (deadlineSec === undefined || deps.nowSec() < deadlineSec) return { goal, stopped: false };
  const reason = "timebox";
  const at = deps.nowIso();
  const ts = deps.nowSec();
  const reading = { nowSec: ts, deadlineSec };
  const labelled = withSafety(goal, "timebox", reason, `now ${ts} >= deadline ${deadlineSec}`, at);
  const paused = transitionGoal(labelled, "paused", { actor: "system", reason, at });
  writeGoal(goalPath(projectPath), paused);
  appendGoalState(bus, eventsPath(projectPath), goal.status, paused, "system", reason, ts);
  appendGoalGate(bus, eventsPath(projectPath), session, "timebox", "paused", reason, reading, ts);
  return { goal: paused, stopped: true, reason };
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
  let initialUsage: RunSummary = { cycles: 0, costUsd: 0, costUnknownRows: 0 };
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
    goal = applyRunOptions(goal, opts, startedAt);
    writeGoal(gPath, goal);
    initialUsage = runSummaryFromGoal(goal);
    const deadlineSec = timeboxDeadlineSec(goal, opts, startedSec);
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
      const preBudgetGate = applyBudgetGate(id.path, bus, sid, goal, deps);
      goal = preBudgetGate.goal;
      if (preBudgetGate.stopped) {
        stopReason = preBudgetGate.reason;
        break;
      }
      const usageGate = await enforceUsageGate(id.path, bus, sid, goal, opts, deps);
      goal = usageGate.goal;
      if (usageGate.stopped) {
        stopReason = usageGate.reason;
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
      const budgetGate = applyBudgetGate(id.path, bus, sid, goal, deps);
      goal = budgetGate.goal;
      if (budgetGate.stopped) {
        stopReason = budgetGate.reason;
        break;
      }
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
      const timeboxGate = applyTimeboxGate(id.path, bus, sid, goal, deps, deadlineSec);
      goal = timeboxGate.goal;
      if (timeboxGate.stopped) {
        stopReason = timeboxGate.reason;
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
    const finalGoal = goal.status === "complete" || goal.status === "budget_limited" ? goal : pauseGoal(id.path, bus, finalReason, deps.nowIso(), deps.nowSec()) ?? goal;
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
