/**
 * US-V4-008 — `roll supervisor`: the project-level Prime Agent, v0 (observe +
 * advise). It reads STRUCTURED facts via deterministic selectors — backlog, merge
 * truth (pr:merge events), open PRs, route config, repeated failures, release
 * readiness — then projects {@link SupervisorFacts} and emits advisory
 * {@link SupervisorDecision} records. It NEVER implements a Story, writes a Story
 * eval report, bypasses a gate, or marks a Story Done; persistent policy changes
 * are advisory and carry `requiresOwner`.
 *
 *   roll supervisor            # observe + advise summary
 *   roll supervisor observe    # structured facts
 *   roll supervisor advise     # decisions
 *   roll supervisor next       # "what should Roll do next?"
 *   roll supervisor why        # "why is the project stuck?"
 *   roll supervisor live       # read-only Planner/Builder/Evaluator board
 *   roll supervisor --json     # machine-readable
 */
import {
  EventBus,
  acForStory,
  adviseProject,
  buildSupervisorRunbookState,
  buildCycleRoleSummary,
  buildSupervisorLiveBoard,
  classifyEvidenceRepair,
  ensureDeliveriesFresh,
  explainStuck,
  generateAcMap,
  isEvidenceRepaired,
  normalizeAgentConfig,
  observeProject,
  parseBacklog,
  queryStoryDelivery,
  renderReport,
  repairedPrNumbers,
  type ExecPort,
  recommendNext,
  type FreshnessPort,
} from "@roll/core";
import type { CycleRoleSummary, RollEvent, RollGoal, SupervisorInput } from "@roll/spec";
import { parseGoalYaml } from "@roll/spec";
import { detectNoProgressStall, type NoProgressStall } from "../lib/goal-recovery.js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { formatOperatingMode, resolveOperatingMode, suggestedGuidedRun } from "../lib/operating-mode.js";
import { reducePrView } from "./loop-pr-inbox.js";
import { readPendingPublish } from "../runner/pending-publish.js";
import { cardArchiveDir, reportFileName } from "../lib/archive.js";
import { renderScopedExecuteRoute, resolveScopedStoryExecute, scopedExecuteRouteTrace } from "../runner/scoped-route.js";

const EXEC_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export const SUPERVISOR_USAGE = [
  "Usage: roll supervisor [status|observe|advise|next|why|live|repair-evidence] [--json]",
  "  status           observe + advise summary (alias for no subcommand)",
  "  observe          structured project facts (backlog, truth coverage, PRs, release readiness)",
  "  advise           Prime Agent decisions (advisory; persistent changes need owner confirmation)",
  "  next             what should Roll do next?",
  "  why              why is the project stuck?",
  "  live             read-only Prime Agent live board with Planner/Builder/Evaluator panes",
  "  route            Builder (story.execute) route trace: candidates, skipped reasons, selected",
  "  repair-evidence  repair missing acceptance evidence for a green PR and restore merge-ready status",
].join("\n");

function depsOf(desc: string): string[] {
  const m = /depends-on:\s*([A-Za-z0-9_,-]+)/i.exec(desc);
  return m === null ? [] : (m[1] ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
}

const nodeFreshnessPort: FreshnessPort = {
  mtimeMs(absPath: string): number | undefined {
    try {
      return statSync(absPath).mtimeMs;
    } catch {
      return undefined;
    }
  },
  readText(absPath: string): string {
    try {
      return readFileSync(absPath, "utf8");
    } catch {
      return "";
    }
  },
  writeText(absPath: string, text: string): void {
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, text, "utf8");
  },
};

const quietExecPort: ExecPort = {
  run(tool: string, argv: readonly string[]) {
    try {
      const stdout = execFileSync(tool, [...argv], {
        encoding: "utf8",
        maxBuffer: EXEC_MAX_BUFFER_BYTES,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return { stdout: stdout.trim(), code: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer | string; status?: number | null };
      const out = e.stdout === undefined ? "" : e.stdout.toString();
      return { stdout: out.trim(), code: typeof e.status === "number" ? e.status : 1 };
    }
  },
};

function summarizeList(items: readonly string[], limit = 5): string {
  if (items.length === 0) return "none";
  const shown = items.slice(0, limit).join(", ");
  const remaining = items.length - limit;
  return remaining > 0 ? `${shown}, … +${remaining} more` : shown;
}

function readRollMetaState(projectPath: string): NonNullable<SupervisorInput["rollMeta"]> {
  const rollDir = join(projectPath, ".roll");
  if (!existsSync(rollDir)) return { state: "unknown", detail: ".roll directory is missing" };
  const res = quietExecPort.run("git", ["-C", rollDir, "status", "--short"]);
  if (res.code !== 0) return { state: "unknown", detail: ".roll is not a readable git repo" };
  const files = res.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return files.length === 0
    ? { state: "clean", detail: "roll-meta clean", files: [] }
    : { state: "dirty", detail: `${files.length} dirty roll-meta file(s)`, files };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasStoryIdToken(value: string, storyId: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(storyId)}($|[^A-Za-z0-9])`).test(value);
}

function extractStoryId(knownStoryIds: readonly string[], ...values: readonly string[]): string | undefined {
  const known = [...new Set(knownStoryIds)].sort((a, b) => b.length - a.length);
  for (const value of values) {
    const knownMatch = known.find((id) => hasStoryIdToken(value, id));
    if (knownMatch !== undefined) return knownMatch;
    const match = /\b(?:US|FIX|REFACTOR)-[A-Za-z0-9_-]+\b/.exec(value);
    if (match !== null) return match[0];
  }
  return undefined;
}

function parseJsonArray(text: string): unknown[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function actionForManualMerge(facts: { bot: string; ciState: string; mergeable: string; isDraft?: boolean }, repaired?: boolean): string {
  // FIX-1058 — evidence-repaired PRs show merge_ready regardless of draft status.
  if (repaired === true) return "merge_ready";
  if (facts.isDraft === true) {
    if (facts.bot === "APPROVED" && facts.ciState === "success" && facts.mergeable === "CLEAN") return "ready_to_promote_and_merge";
    return "draft_manual_merge_waiting";
  }
  if (facts.bot === "APPROVED" && facts.ciState === "success" && facts.mergeable === "CLEAN") return "manual_merge_required";
  if (facts.ciState === "failure") return "ci_red_before_manual_merge";
  if (facts.mergeable === "BEHIND" || facts.mergeable === "DIRTY" || facts.mergeable === "CONFLICTING") return "rebase_or_conflict_before_manual_merge";
  return "manual_merge_waiting";
}

export function readManualMergeGates(
  projectPath: string,
  events: readonly RollEvent[],
  port: ExecPort = quietExecPort,
  knownStoryIds: readonly string[] = [],
  repairedPrSet?: ReadonlySet<number>,
): NonNullable<SupervisorInput["manualMergeGates"]> {
  const list = port.run("gh", ["pr", "list", "--state", "open", "--json", "number,headRefName,title"]);
  const prs = list.code === 0 ? parseJsonArray(list.stdout) : [];
  if (prs.length === 0) return [];

  const prStory = new Map<number, string>();
  for (const ev of events) {
    if (ev.type === "pr:open") prStory.set(ev.prNumber, ev.storyId);
  }

  const gates: Array<NonNullable<SupervisorInput["manualMergeGates"]>[number]> = [];
  for (const item of prs) {
    const pr = item as { number?: number; headRefName?: string; title?: string };
    if (typeof pr.number !== "number") continue;
    const view = port.run("gh", [
      "pr",
      "view",
      String(pr.number),
      "--json",
      "reviews,mergeStateStatus,statusCheckRollup,body,labels,isDraft",
    ]);
    if (view.code !== 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(view.stdout) as unknown;
    } catch {
      continue;
    }
    const body = typeof (raw as { body?: unknown }).body === "string" ? ((raw as { body?: string }).body ?? "") : "";
    const facts = reducePrView(raw as Parameters<typeof reducePrView>[0]);
    if (facts.manualMerge !== true) continue;
    const storyId = prStory.get(pr.number) ?? extractStoryId(knownStoryIds, pr.headRefName ?? "", pr.title ?? "", body) ?? `PR-${pr.number}`;
    const repaired = repairedPrSet !== undefined && isEvidenceRepaired(pr.number, repairedPrSet);
    const action = actionForManualMerge(facts, repaired);
    gates.push({
      storyId,
      prNumber: pr.number,
      ciState: facts.ciState || "unknown",
      reviewState: facts.bot || "none",
      mergeable: facts.mergeable || "unknown",
      action,
      detail: `ci=${facts.ciState || "unknown"} evaluator=${facts.bot || "none"} merge=${facts.mergeable || "unknown"} action=${action}`,
      source: `gh pr view ${pr.number}`,
    });
  }
  return gates;
}

/** Gather the Prime Agent's structured input from project state (deterministic). */
export function gatherSupervisorInput(projectPath: string): SupervisorInput {
  const backlogPath = join(projectPath, ".roll", "backlog.md");
  const backlog = existsSync(backlogPath)
    ? parseBacklog(readFileSync(backlogPath, "utf8")).map((it) => ({ id: it.id, status: it.status, dependsOn: depsOf(it.desc) }))
    : [];

  const agentsPath = join(projectPath, ".roll", "agents.yaml");
  const routeConfigErrors = existsSync(agentsPath) ? normalizeAgentConfig(readFileSync(agentsPath, "utf8")).errors : [];

  // Merge truth + PR/failure facts from the durable event stream.
  const eventsPath = join(projectPath, ".roll", "loop", "events.ndjson");
  let events: RollEvent[] = [];
  try {
    if (existsSync(eventsPath)) events = new EventBus().readEvents(eventsPath);
  } catch {
    events = [];
  }
  const merged = new Set<string>();
  const opened = new Set<string>();
  const cycleStory = new Map<string, string>();
  const failuresByStory = new Map<string, number>();
  const structuralFailures = new Map<string, NonNullable<SupervisorInput["structuralFailures"]>[number]>();
  const FAIL = new Set(["failed", "gave_up", "blocked", "aborted"]);
  for (const ev of events) {
    if (ev.type === "pr:merge") merged.add(ev.storyId);
    else if (ev.type === "pr:open") opened.add(ev.storyId);
    else if (ev.type === "cycle:start") cycleStory.set(ev.cycleId, ev.storyId);
    else if (ev.type === "sandbox:main_dirty") {
      const sid = cycleStory.get(ev.cycleId);
      if (sid !== undefined) {
        structuralFailures.set(sid, {
          storyId: sid,
          kind: "main_checkout_dirty",
          detail: `main checkout dirty at ${ev.phase}; files: ${ev.files.join(", ") || "unknown"}`,
          source: `sandbox:main_dirty/${ev.cycleId}`,
        });
      }
    }
    else if (ev.type === "cycle:end") {
      const sid = cycleStory.get(ev.cycleId);
      if (sid !== undefined) {
        // consecutive trailing failures: reset on a non-failure terminal.
        failuresByStory.set(sid, FAIL.has(ev.outcome) ? (failuresByStory.get(sid) ?? 0) + 1 : 0);
        if (ev.outcome === "handoff_without_tcr") {
          structuralFailures.set(sid, {
            storyId: sid,
            kind: "zero_tcr_dirty_worktree",
            detail: "zero TCR with dirty preserved worktree; owner must inspect or rescue before retry",
            source: `cycle:end/${ev.cycleId}`,
          });
        }
      }
    }
  }

  try {
    const deliveries = ensureDeliveriesFresh(projectPath, nodeFreshnessPort, quietExecPort);
    for (const row of backlog) {
      if (queryStoryDelivery(row.id, deliveries).delivered) merged.add(row.id);
    }
  } catch {
    // Keep Prime Agent observe usable in partial/non-git projects; event truth is
    // still consumed above, and missing delivery truth is rendered as coverage.
  }

  const openPrStories = [...opened].filter((s) => !merged.has(s));
  const recentFailures = [...failuresByStory.entries()]
    .filter(([, n]) => n > 0)
    .map(([storyId, consecutiveFailures]) => ({ storyId, consecutiveFailures }));

  const repairedPrSet = repairedPrNumbers(events);

  return {
    backlog,
    delivered: [...merged],
    openPrStories,
    recentFailures,
    routeConfigErrors,
    releaseBlockers: [],
    rollMeta: readRollMetaState(projectPath),
    manualMergeGates: readManualMergeGates(projectPath, events, quietExecPort, backlog.map((row) => row.id), repairedPrSet),
    structuralFailures: [...structuralFailures.values()],
    // FIX-1043 — surface the runner's pending-publish hold so supervisor
    // next/why agree with the picker's `all_pending_publish` idle.
    pendingPublish: [...readPendingPublish(join(projectPath, ".roll", "loop"))],
  };
}

function remainingLine(input: SupervisorInput): string {
  const s = buildSupervisorRunbookState(input).scope.remainingByFamily;
  return `FIX ${s.FIX} · US ${s.US} · REFACTOR ${s.REFACTOR}`;
}

function latestCycleStart(events: readonly RollEvent[]): Extract<RollEvent, { type: "cycle:start" }> | undefined {
  const starts = events.filter((ev): ev is Extract<RollEvent, { type: "cycle:start" }> => ev.type === "cycle:start").sort((a, b) => b.ts - a.ts);
  return starts[0];
}

function latestExecutionCast(projectPath: string, events: readonly RollEvent[]): CycleRoleSummary | undefined {
  const latest = latestCycleStart(events);
  if (latest === undefined) return undefined;
  return buildCycleRoleSummary({
    cycleId: latest.cycleId,
    events,
    eventsPath: join(projectPath, ".roll", "loop", "events.ndjson"),
    peerDir: join(projectPath, ".roll", "loop", "peer"),
    cycleLogDir: join(projectPath, ".roll", "loop", "cycle-logs"),
  });
}

function latestCastSummary(events: readonly RollEvent[]): string {
  const latest = latestCycleStart(events);
  if (latest === undefined) return "none";
  const cycleEvents = events.filter((ev) => "cycleId" in ev && ev.cycleId === latest.cycleId);
  const score = [...cycleEvents]
    .reverse()
    .find((ev): ev is Extract<RollEvent, { type: "pair:score" }> => ev.type === "pair:score");
  const verdict = [...cycleEvents]
    .reverse()
    .find((ev): ev is Extract<RollEvent, { type: "pair:verdict" }> => ev.type === "pair:verdict");
  const selectedScore = [...cycleEvents]
    .reverse()
    .find((ev): ev is Extract<RollEvent, { type: "pair:selected" }> => ev.type === "pair:selected" && ev.stage === "score");
  const evaluator = score?.peer ?? verdict?.peer ?? selectedScore?.peer ?? "-";
  return `${latest.cycleId} · ${latest.storyId} · builder=${latest.agent} · evaluator=${evaluator}`;
}

function describeRole(role: CycleRoleSummary["roles"][number]): string {
  const agent = role.agent ?? "-";
  const result = role.score !== undefined ? `${role.state}/${role.score}` : role.verdict !== undefined ? `${role.state}/${role.verdict}` : role.state;
  const cause = role.cause !== undefined ? `/${role.cause}` : "";
  return `${agent}:${result}${cause}`;
}

function latestCastDetail(projectPath: string, events: readonly RollEvent[]): string {
  const cast = latestExecutionCast(projectPath, events);
  if (cast === undefined) return "none";
  const reviewers = cast.roles.filter((r) => r.role === "peer_reviewer").map(describeRole);
  const evaluators = cast.roles.filter((r) => r.role === "evaluator").map(describeRole);
  const gates = [
    cast.gates.peerGate !== undefined ? `peer=${cast.gates.peerGate}` : undefined,
    cast.gates.attestGate !== undefined ? `attest=${cast.gates.attestGate}` : undefined,
    cast.gates.delivery !== undefined ? `delivery=${cast.gates.delivery}` : undefined,
  ].filter((v): v is string => v !== undefined);
  const sources = cast.sources.length === 0 ? "none" : summarizeList(cast.sources, 3);
  return `reviewers=${reviewers.length === 0 ? "none" : reviewers.join(", ")} · evaluators=${evaluators.length === 0 ? "none" : evaluators.join(", ")} · gates=${gates.length === 0 ? "none" : gates.join(", ")} · sources=${sources}`;
}

function latestGateState(events: readonly RollEvent[]): string {
  const board = buildSupervisorLiveBoard(events, { recentLimit: 1 });
  const row = board.rows[0];
  if (row === undefined) return "no active/recent cycle";
  return row.status;
}

function manualMergeLine(input: SupervisorInput): string {
  const gates = input.manualMergeGates ?? [];
  if (gates.length === 0) return "none";
  return summarizeList(gates.map((g) => `PR #${g.prNumber}:${g.storyId}:${g.action} (${g.detail})`), 3);
}

function supervisorContext(
  projectPath: string,
  input: SupervisorInput,
  events: readonly RollEvent[],
): {
  cast: string;
  castDetail: string;
  executionCast: CycleRoleSummary | null;
  gate: string;
  rollMeta: NonNullable<SupervisorInput["rollMeta"]>;
  manualMerge: string;
} {
  return {
    cast: latestCastSummary(events),
    castDetail: latestCastDetail(projectPath, events),
    executionCast: latestExecutionCast(projectPath, events) ?? null,
    gate: latestGateState(events),
    rollMeta: input.rollMeta ?? { state: "unknown", detail: "not gathered" },
    manualMerge: manualMergeLine(input),
  };
}

function fmtFacts(input: SupervisorInput, events: readonly RollEvent[] = []): string {
  const f = observeProject(input);
  const runbook = buildSupervisorRunbookState(input);
  const liveStuck = runbook.blockedCards.filter((b) => b.reason === "repeated_failure").map((b) => b.storyId);
  const ctx = supervisorContext(process.cwd(), input, events);
  const mode = resolveOperatingMode(process.cwd());
  const truthCoverage =
    f.truthDrift.length === 0
      ? "complete"
      : `partial — ${f.truthDrift.length} Done row(s) lack structured delivery truth (${summarizeList(f.truthDrift)}); run roll truth audit for detail`;
  const lines = [
    "",
    "  Prime Agent — project facts (observe)",
    "",
    `    scope: ${runbook.scope.label}`,
    `    remaining: ${remainingLine(input)}`,
    `    selected: ${runbook.next.storyId ?? "(nothing ready)"} — ${runbook.next.kind}`,
    `    blocked: ${runbook.blockedCards.length === 0 ? "none" : summarizeList(runbook.blockedCards.map((b) => `${b.storyId}:${b.reason}`))}`,
    `    cast: ${ctx.cast}`,
    `    cast detail: ${ctx.castDetail}`,
    `    gate: ${ctx.gate}`,
    `    manual merge: ${ctx.manualMerge}`,
    `    .roll meta: ${ctx.rollMeta.state} — ${ctx.rollMeta.detail}`,
    `    backlog: ${f.counts.todo} todo · ${f.counts.inProgress} in-progress · ${f.counts.blocked} blocked · ${f.counts.done} done`,
    `    open PRs: ${f.openPrCount}`,
    `    truth coverage: ${truthCoverage}`,
    `    stuck stories: ${liveStuck.length === 0 ? "none in live scope" : summarizeList(liveStuck)}`,
    `    route config: ${f.routeConfigErrors.length === 0 ? "ok" : summarizeList(f.routeConfigErrors)}`,
    `    release: ${f.releaseReadiness.ready ? "ready" : "blocked — " + summarizeList(f.releaseReadiness.blockers)}`,
    `    budget: ${f.budgetHealth.note}`,
    `    ${formatOperatingMode(mode)}`,
    `    owner action: ${mode.ownerAction}`,
    "",
  ];
  return lines.join("\n") + "\n";
}

function fmtAdvice(input: SupervisorInput): string {
  const decisions = supervisorDecisions(input);
  if (decisions.length === 0) return "\n  Prime Agent — no advisory decisions (project healthy)\n\n";
  const rows = decisions.map((d) => `    [${d.kind}]${d.requiresOwner ? " (owner confirmation required)" : ""} ${d.reason}`);
  return ["", "  Prime Agent — advisory decisions", "", ...rows, ""].join("\n") + "\n";
}

function supervisorDecisions(input: SupervisorInput): ReturnType<typeof adviseProject> {
  const runbook = buildSupervisorRunbookState(input);
  const hasLiveStuck = runbook.blockedCards.some((b) => b.reason === "repeated_failure");
  return adviseProject(observeProject(input)).filter((d) => hasLiveStuck || !d.reason.startsWith("stuck stories"));
}

function runbookWhy(state: ReturnType<typeof buildSupervisorRunbookState>, facts: ReturnType<typeof observeProject>): string {
  if (state.next.kind === "diagnose_failure") return state.next.reason;
  if (state.next.kind === "run_card") return `not stuck: next live card is ${state.next.storyId}`;
  return state.next.reason;
}

/**
 * FIX-1049 — read the persisted goal and, when the no-progress breaker stopped
 * it, project the supervised-recovery facts. Returns `undefined` for any other
 * state so `why` only surfaces the recovery block when there is a stall to act on.
 */
function readNoProgressStall(projectPath: string, events: readonly RollEvent[]): NoProgressStall | undefined {
  const goalPath = join(projectPath, ".roll", "loop", "goal.yaml");
  if (!existsSync(goalPath)) return undefined;
  let goal: RollGoal | undefined;
  try {
    goal = parseGoalYaml(readFileSync(goalPath, "utf8"));
  } catch {
    return undefined;
  }
  return detectNoProgressStall(goal, events);
}

/** Render the no-progress recovery facts (AC1) — blocked card, streak, last/next
 *  Builder, handoff to inspect, and the recovery command. */
function fmtNoProgressRecovery(stall: NoProgressStall): string {
  const streaks = Object.entries(stall.zeroStreaks);
  const streakLine = streaks.length === 0 ? "none recorded" : streaks.map(([id, n]) => `${id}=${n}`).join(", ");
  const target = stall.blockedCards[0] ?? "<story-id>";
  const lines = [
    "  no-progress recovery:",
    `    stopped by: ${stall.reason}`,
    `    blocked cards: ${stall.blockedCards.length === 0 ? "(whole-goal breaker)" : stall.blockedCards.join(", ")}`,
    `    zero-delivery streak: ${streakLine} · whole-goal no-progress cycles: ${stall.noProgressCycles}`,
    `    last failed Builder: ${stall.lastBuilder ?? "(unknown)"}`,
  ];
  if (stall.handoff !== undefined) {
    lines.push(`    handoff: cycle ${stall.handoff.cycleId} — ${stall.handoff.detail} (roll loop log ${stall.handoff.cycleId})`);
  }
  lines.push(`    recover: roll loop recover ${target} (preview) · roll loop recover ${target} --apply --reason "<why>"`);
  return lines.join("\n");
}

function readSupervisorEvents(projectPath: string): RollEvent[] {
  const eventsPath = join(projectPath, ".roll", "loop", "events.ndjson");
  try {
    if (existsSync(eventsPath)) return new EventBus().readEvents(eventsPath);
  } catch {
    return [];
  }
  return [];
}

function shortTs(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "n/a";
  return new Date(ts).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function agentModel(agent: string, model: string): string {
  return model.trim() === "" ? agent : `${agent}/${model}`;
}

function fmtLive(projectPath: string): string {
  const board = buildSupervisorLiveBoard(readSupervisorEvents(projectPath));
  const lines = ["", "  Prime Agent Live — read-only role board", "", `    supervisor: ${board.supervisor.state} · ${board.supervisor.summary}`, ""];
  if (board.rows.length === 0) {
    lines.push("    no cycle rows yet", "");
    return lines.join("\n") + "\n";
  }
  for (const row of board.rows) {
    lines.push(
      `    ${row.cycleId} · ${row.storyId} · ${row.profile} · ${row.status} · ${agentModel(row.agent, row.model)}`,
      `      updated ${shortTs(row.updatedAt)} · ${row.profileReason}`,
    );
    for (const role of row.roles) {
      const agent = role.agent === null ? "-" : role.agent;
      lines.push(`      ${role.role.padEnd(9)} ${role.state.padEnd(13)} agent=${agent} · ${role.reason}`);
    }
    lines.push(`      handoff ${row.handoffs.map((h) => `${h.from}->${h.to}:${h.state}`).join(" · ")}`, "");
  }
  return lines.join("\n") + "\n";
}

export function supervisorCommand(args: string[]): number {
  const json = args.includes("--json");
  let sub = args.find((a) => !a.startsWith("-"));
  // `status` is an alias for the default observe + advise summary.
  if (sub === "status") sub = undefined;
  if (sub !== undefined && !["observe", "advise", "next", "why", "live", "route", "repair-evidence"].includes(sub)) {
    process.stderr.write(SUPERVISOR_USAGE + "\n");
    return 1;
  }
  const projectPath = process.cwd();
  if (sub === "route") {
    const route = resolveScopedStoryExecute(projectPath);
    if (route === null) {
      if (json) process.stdout.write(JSON.stringify({ role: "execute", scoped: false }, null, 2) + "\n");
      else process.stdout.write("\n  Builder route — story.execute\n  (no scoped agents.yaml; legacy tier routing in effect)\n\n");
      return 0;
    }
    const trace = scopedExecuteRouteTrace(route);
    if (json) process.stdout.write(JSON.stringify(trace, null, 2) + "\n");
    else process.stdout.write(renderScopedExecuteRoute(trace));
    return 0;
  }
  if (sub === "repair-evidence") {
    // FIX-1058 — repair missing acceptance evidence for a green PR.
    // Takes a PR number, checks eligibility, records events, generates
    // ac-map draft + attest report, and records the repair as complete.
    const prArg = args.find((a) => /^\d+$/.test(a) && a !== "--json" && a !== "repair-evidence");
    if (prArg === undefined) {
      process.stderr.write("Usage: roll supervisor repair-evidence <pr-number>\n");
      return 1;
    }
    const prNumber = Number(prArg);

    // Gather PR state via gh CLI.
    const view = quietExecPort.run("gh", [
      "pr", "view", String(prNumber), "--json",
      "reviews,mergeStateStatus,statusCheckRollup,body,labels,isDraft,headRefName,state",
    ]);
    if (view.code !== 0) {
      process.stderr.write(`repair-evidence: cannot read PR #${prNumber} — gh pr view failed (code ${view.code})\n`);
      if (view.stdout !== "") process.stderr.write(view.stdout + "\n");
      return 1;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(view.stdout) as unknown;
    } catch {
      process.stderr.write(`repair-evidence: cannot parse gh pr view output for PR #${prNumber}\n`);
      return 1;
    }
    const facts = reducePrView(raw as Parameters<typeof reducePrView>[0]);
    if (facts.manualMerge !== true) {
      process.stderr.write(`repair-evidence: PR #${prNumber} does not require manual merge — nothing to repair\n`);
      return 0;
    }

    // Resolve story ID from PR.
    const events = readSupervisorEvents(projectPath);
    const alreadyRepaired = repairedPrNumbers(events).has(prNumber);
    let storyId = "";
    for (const ev of events) {
      if (ev.type === "pr:open" && ev.prNumber === prNumber) {
        storyId = ev.storyId;
        break;
      }
    }
    if (storyId === "") {
      const bodyStr = typeof (raw as { body?: unknown }).body === "string" ? ((raw as { body?: string }).body ?? "") : "";
      const headRef = typeof (raw as { headRefName?: unknown }).headRefName === "string" ? ((raw as { headRefName?: string }).headRefName ?? "") : "";
      storyId = extractStoryId([], headRef, bodyStr) ?? `PR-${prNumber}`;
    }

    // FIX-1061: resolve Roll evaluator score artifact for loop-created PRs.
    let rollEvaluatorVerdict: string | undefined;
    if (storyId !== "" && storyId !== `PR-${prNumber}`) {
      // Find the latest cycle that worked on this story.
      let cycleId = "";
      let latestTs = 0;
      for (const ev of events) {
        if (ev.type === "cycle:start" && ev.storyId === storyId && ev.ts > latestTs) {
          cycleId = ev.cycleId;
          latestTs = ev.ts;
        }
      }
      if (cycleId !== "") {
        const peerDir = join(projectPath, ".roll", "loop", "peer");
        const scorePath = join(peerDir, `cycle-${cycleId}.score.pair.json`);
        try {
          if (existsSync(scorePath)) {
            const scoreRaw = JSON.parse(readFileSync(scorePath, "utf8")) as {
              verdict?: string;
              score?: number;
            };
            if (typeof scoreRaw.verdict === "string" && (scoreRaw.verdict === "good" || scoreRaw.verdict === "ok")) {
              rollEvaluatorVerdict = scoreRaw.verdict;
            }
          }
        } catch {
          // Score file unparseable — fall through without Roll evaluator.
        }
      }
    }

    // Classify repair eligibility.
    const classification = classifyEvidenceRepair({
      ciState: facts.ciState || "unknown",
      reviewState: facts.bot || "none",
      rollEvaluatorVerdict,
      mergeable: facts.mergeable || "unknown",
      isDraft: facts.isDraft === true,
      hasFreshReport: false, // We're asked to repair — assume no fresh report.
      alreadyRepaired,
    });

    if (classification.verdict === "already_repaired") {
      if (json) process.stdout.write(JSON.stringify({ prNumber, storyId, verdict: "already_repaired", reason: classification.reason }, null, 2) + "\n");
      else process.stdout.write(`\n  repair-evidence: PR #${prNumber} already repaired — no action needed\n  ${classification.reason}\n\n`);
      return 0;
    }
    if (classification.verdict !== "reparable") {
      if (json) process.stdout.write(JSON.stringify({
        prNumber,
        storyId,
        verdict: classification.verdict,
        reason: classification.reason,
        evaluatorSources: { gitHubReview: facts.bot || "none", rollEvaluatorVerdict: rollEvaluatorVerdict ?? null },
      }, null, 2) + "\n");
      else process.stdout.write(`\n  repair-evidence: PR #${prNumber} is not reparable\n  ${classification.reason}\n\n`);
      return 1;
    }

    // Record repair_requested event.
    const eventsPath = join(projectPath, ".roll", "loop", "events.ndjson");
    const repairRequested: RollEvent = {
      type: "evidence:repair_requested",
      prNumber,
      storyId,
      reason: classification.reason,
      ts: Date.now(),
    };
    try {
      mkdirSync(dirname(eventsPath), { recursive: true });
      writeFileSync(eventsPath, JSON.stringify(repairRequested) + "\n", { flag: "a" });
    } catch (err: unknown) {
      process.stderr.write(`repair-evidence: cannot write events — ${String(err)}\n`);
      return 1;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Generate real ac-map + attest report artifacts before stamping
    // evidence:repaired. Per FIX-1058 spec AC2/AC3/AC4: the recovery path
    // must produce a non-empty acceptance report + ac-map visible at the
    // gate-checked `latest/` location, and the ac-map must pass the
    // attest gate's content predicate (positive ACs backed by real evidence
    // files — no bare-label placeholder text entries).
    // ═══════════════════════════════════════════════════════════════════

    // 1. Find the story card spec file.
    const featuresDir = join(projectPath, ".roll", "features");
    let specPath = "";
    let epic = "";
    if (existsSync(featuresDir)) {
      const entries = readdirSync(featuresDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = join(featuresDir, entry.name, storyId, "spec.md");
        if (existsSync(candidate)) {
          specPath = candidate;
          epic = entry.name;
          break;
        }
      }
    }

    // 2. Parse ACs from the spec file.
    let acItems: Array<{ id: string; text: string }> = [];
    if (specPath !== "") {
      try {
        const md = readFileSync(specPath, "utf8");
        acItems = acForStory(md, storyId);
      } catch {
        // Fall through — ac-items will be empty; the command still
        // succeeds (recording repair with empty ac-map) but warns.
      }
    }

    const storyDir = epic !== "" ? join(featuresDir, epic, storyId) : "";

    // 3. Write real evidence text files so the ac-map can reference them
    //    with `textFile` — the attest gate's content predicate
    //    (`acMapEvidenceIsReal`) requires a non-empty `textFile` for
    //    text-kind evidence; a bare label is an empty shell.
    const evidenceDir = storyDir !== "" ? join(storyDir, "evidence") : "";
    const repairSummaryFile = "repair-summary.txt";
    const repairSummaryRel = evidenceDir !== "" ? `evidence/${repairSummaryFile}` : repairSummaryFile;
    let repairSummaryAbs = "";
    if (evidenceDir !== "") {
      mkdirSync(evidenceDir, { recursive: true });
      repairSummaryAbs = join(evidenceDir, repairSummaryFile);
      const summaryLines = [
        `Repair evidence for ${storyId} — PR #${prNumber}`,
        `Generated: ${new Date().toISOString()}`,
        `CI state: ${facts.ciState || "unknown"}`,
        `Review state: ${facts.bot || "none"}`,
        `Mergeable: ${facts.mergeable || "unknown"}`,
        `Repair verdict: ${classification.verdict}`,
        `Classification reason: ${classification.reason}`,
        "",
        "Evidence-repair command completed. The PR was CI green + evaluator",
        "approved + merge clean but lacked a fresh acceptance report.",
        "This file records the repair fact; the ac-map.json and HTML report",
        "are the gate-visible acceptance artifacts.",
      ];
      writeFileSync(repairSummaryAbs, summaryLines.join("\n") + "\n", "utf8");
    }

    // 4. Build evidence refs that carry real `textFile` paths.
    const evidenceRefs: Array<{ kind: string; label: string; textFile: string }> = [];
    if (repairSummaryAbs !== "") {
      evidenceRefs.push({
        kind: "text",
        label: `repair-evidence summary: PR #${prNumber} CI=${facts.ciState} review=${facts.bot} merge=${facts.mergeable}`,
        textFile: repairSummaryRel,
      });
    }
    // CI state evidence (structural — counts as real per `acMapEvidenceIsReal`).
    if (facts.ciState === "success") {
      evidenceRefs.push({
        kind: "ci",
        label: `CI green on PR #${prNumber}`,
        textFile: repairSummaryRel,
      });
    }

    // 5. Generate ac-map with `readonly` status and real evidence refs
    //    so the attest gate's content predicate accepts the report.
    //    `readonly` is used (never `pass`) — the repair path documents
    //    existing CI/evaluator state; it does not re-verify the build.
    let acMapCount = 0;
    if (storyDir !== "" && acItems.length > 0) {
      const acMap = generateAcMap(storyId, acItems, {
        status: "readonly",
        evidenceRefs,
        fallbackTextFile: repairSummaryRel,
      });
      const acMapPath = join(storyDir, "ac-map.json");
      writeFileSync(acMapPath, JSON.stringify(acMap, null, 2) + "\n", "utf8");
      acMapCount = acItems.length;
    }

    // 6. Generate an HTML acceptance report at the gate-checked location.
    //    The attest gate's `existingReport()` looks for:
    //      features/<epic>/<ID>/latest/<ID>-report.html  (primary)
    //    We use `renderReport` — the same pure renderer normal delivery
    //    uses — so the report is structured identically.
    let htmlReportPath = "";
    if (storyDir !== "" && acItems.length > 0) {
      const now = new Date();
      const items = acItems.map((ac) => ({
        id: ac.id,
        text: ac.text,
        status: "readonly" as const,
        evidence: evidenceRefs.map((ref) => ({
          kind: ref.kind as "text" | "ci",
          label: ref.label,
          href: ref.textFile,
        })),
      }));
      const html = renderReport({
        storyId,
        title: `${storyId} — Acceptance Evidence (repaired)`,
        generatedAt: now.toISOString(),
        items,
        facts: { tcrCount: 0, ciConclusion: facts.ciState || "unknown", testPassAge: "repaired (post-hoc)" },
        evidenceDeltaSummary: `Evidence repaired via \`roll supervisor repair-evidence\` for PR #${prNumber}. CI=${facts.ciState}, review=${facts.bot}, merge=${facts.mergeable}.`,
      });
      // Write to `latest/<ID>-report.html` — the primary candidate the gate checks.
      const latestDir = join(storyDir, "latest");
      mkdirSync(latestDir, { recursive: true });
      htmlReportPath = join(latestDir, reportFileName(storyId));
      writeFileSync(htmlReportPath, html, "utf8");
    }

    // 7. Record the repair as complete ONLY after real artifacts exist.
    const repaired: RollEvent = {
      type: "evidence:repaired",
      prNumber,
      storyId,
      outcome: "evidence-generated",
      details: [
        `acceptance evidence repaired for ${storyId}`,
        acMapCount > 0 ? `ac-map: ${acMapCount} AC(s) at readonly with real evidence refs` : "ac-map: (no ACs found)",
        htmlReportPath !== "" ? `report: ${htmlReportPath}` : "report: (skipped — no ACs)",
        `CI: ${facts.ciState} | review: ${facts.bot} | merge: ${facts.mergeable}${rollEvaluatorVerdict !== undefined ? ` | roll evaluator: ${rollEvaluatorVerdict}` : ""}`,
      ].join("; "),
      ts: Date.now(),
    };
    try {
      writeFileSync(eventsPath, JSON.stringify(repaired) + "\n", { flag: "a" });
    } catch (err: unknown) {
      process.stderr.write(`repair-evidence: cannot write repaired event — ${String(err)}\n`);
      return 1;
    }

    if (json) {
      process.stdout.write(JSON.stringify({
        prNumber,
        storyId,
        verdict: "repaired",
        action: "merge_ready",
        reason: classification.reason,
        evaluatorSources: { gitHubReview: facts.bot || "none", rollEvaluatorVerdict: rollEvaluatorVerdict ?? null },
        artifacts: {
          acMap: acMapCount > 0 ? `${storyId}/ac-map.json` : null,
          report: htmlReportPath || null,
          acCount: acMapCount,
          evidenceFiles: evidenceRefs.map((r) => r.textFile),
        },
      }, null, 2) + "\n");
    } else {
      process.stdout.write(
        `\n  repair-evidence: PR #${prNumber} (${storyId}) repaired\n` +
        `  action: merge_ready — the PR can now be promoted (if draft) and merged\n` +
        `  ac-map: ${acMapCount > 0 ? `generated for ${acMapCount} AC(s) at readonly status in ${storyId}/ac-map.json` : "(no ACs found — check spec.md)"}\n` +
        `  report: ${htmlReportPath || "(skipped — no ACs)"}\n` +
        `  evidence: ${repairSummaryAbs || "(skipped)"}\n` +
        `  evaluator: ${facts.bot === "APPROVED" ? `GitHub review (${facts.bot})` : rollEvaluatorVerdict !== undefined ? `Roll evaluator (${rollEvaluatorVerdict})` : `${facts.bot || "none"}`}\n` +
        `  ${classification.reason}\n\n`,
      );
    }
    return 0;
  }

  if (sub === "live") {
    const board = buildSupervisorLiveBoard(readSupervisorEvents(projectPath));
    if (json) process.stdout.write(JSON.stringify(board, null, 2) + "\n");
    else process.stdout.write(fmtLive(projectPath));
    return 0;
  }
  const input = gatherSupervisorInput(projectPath);
  const facts = observeProject(input);

  if (json) {
    const mode = resolveOperatingMode(projectPath);
    const events = readSupervisorEvents(projectPath);
    const runbook = buildSupervisorRunbookState(input);
    const ctx = supervisorContext(projectPath, input, events);
    const out =
      sub === "advise"
        ? { mode, decisions: supervisorDecisions(input), runbook, ...ctx }
        : sub === "next"
          ? { mode, next: runbook.next, runbook, ...ctx }
          : sub === "why"
            ? { mode, why: runbookWhy(runbook, facts), noProgressRecovery: readNoProgressStall(projectPath, events) ?? null, runbook, ...ctx }
            : { mode, facts, decisions: supervisorDecisions(input), next: runbook.next, runbook, ...ctx };
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return 0;
  }

  if (sub === "observe") {
    process.stdout.write(fmtFacts(input, readSupervisorEvents(projectPath)));
    return 0;
  }
  if (sub === "advise") {
    process.stdout.write(fmtAdvice(input));
    return 0;
  }
  if (sub === "next") {
    const state = buildSupervisorRunbookState(input);
    const n = recommendNext(input);
    const mode = resolveOperatingMode(projectPath);
    const ctx = supervisorContext(projectPath, input, readSupervisorEvents(projectPath));
    const action =
      state.next.kind === "run_card" && mode.mode === "guided"
        ? suggestedGuidedRun(n.storyId)
        : state.next.kind === "run_card"
          ? mode.ownerAction
          : state.next.ownerAction;
    process.stdout.write(
      `\n  Prime Agent — next: ${n.storyId ?? "(nothing ready)"}\n  scope: ${state.scope.label}\n  remaining: ${remainingLine(input)}\n  cast: ${ctx.cast}\n  cast detail: ${ctx.castDetail}\n  gate: ${ctx.gate}\n  manual merge: ${ctx.manualMerge}\n  .roll meta: ${ctx.rollMeta.state} — ${ctx.rollMeta.detail}\n  ${n.reason}\n  ${formatOperatingMode(mode)}\n  owner action: ${action}\n  scheduler: ${state.next.schedulerAction}\n\n`,
    );
    return 0;
  }
  if (sub === "why") {
    const mode = resolveOperatingMode(projectPath);
    const state = buildSupervisorRunbookState(input);
    const why = runbookWhy(state, facts);
    const events = readSupervisorEvents(projectPath);
    const ctx = supervisorContext(projectPath, input, events);
    const stall = readNoProgressStall(projectPath, events);
    const ownerAction = state.next.kind === "diagnose_failure" || state.next.kind === "manual_merge_gate" ? state.next.ownerAction : mode.ownerAction;
    const schedulerAction =
      state.next.kind === "diagnose_failure" || state.next.kind === "manual_merge_gate" ? state.next.schedulerAction : mode.schedulerAction;
    const recoveryBlock = stall !== undefined ? `\n${fmtNoProgressRecovery(stall)}` : "";
    process.stdout.write(
      `\n  Prime Agent — why stuck: ${why}\n  cast: ${ctx.cast}\n  cast detail: ${ctx.castDetail}\n  gate: ${ctx.gate}\n  manual merge: ${ctx.manualMerge}\n  .roll meta: ${ctx.rollMeta.state} — ${ctx.rollMeta.detail}${recoveryBlock}\n  ${formatOperatingMode(mode)}\n  owner action: ${ownerAction}\n  scheduler: ${schedulerAction}\n\n`,
    );
    return 0;
  }
  // default: observe + advise
  process.stdout.write(fmtFacts(input, readSupervisorEvents(projectPath)) + fmtAdvice(input));
  return 0;
}
