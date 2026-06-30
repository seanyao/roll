/**
 * US-V4-008 — `roll supervisor`: the project-level Supervisor Agent, v0 (observe +
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
  adviseProject,
  buildSupervisorRunbookState,
  buildCycleRoleSummary,
  buildSupervisorLiveBoard,
  ensureDeliveriesFresh,
  explainStuck,
  normalizeAgentConfig,
  observeProject,
  parseBacklog,
  queryStoryDelivery,
  type ExecPort,
  recommendNext,
  type FreshnessPort,
} from "@roll/core";
import type { CycleRoleSummary, RollEvent, SupervisorInput } from "@roll/spec";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { formatOperatingMode, resolveOperatingMode, suggestedGuidedRun } from "../lib/operating-mode.js";
import { reducePrView } from "./loop-pr-inbox.js";
import { readPendingPublish } from "../runner/pending-publish.js";

const EXEC_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export const SUPERVISOR_USAGE = [
  "Usage: roll supervisor [status|observe|advise|next|why|live] [--json]",
  "  status           observe + advise summary (alias for no subcommand)",
  "  observe          structured project facts (backlog, truth coverage, PRs, release readiness)",
  "  advise           Supervisor decisions (advisory; persistent changes need owner confirmation)",
  "  next             what should Roll do next?",
  "  why              why is the project stuck?",
  "  live             read-only Supervisor live board with Planner/Builder/Evaluator panes",
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

function actionForManualMerge(facts: { bot: string; ciState: string; mergeable: string; isDraft?: boolean }): string {
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
    const action = actionForManualMerge(facts);
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

/** Gather the Supervisor's structured input from project state (deterministic). */
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
    // Keep Supervisor observe usable in partial/non-git projects; event truth is
    // still consumed above, and missing delivery truth is rendered as coverage.
  }

  const openPrStories = [...opened].filter((s) => !merged.has(s));
  const recentFailures = [...failuresByStory.entries()]
    .filter(([, n]) => n > 0)
    .map(([storyId, consecutiveFailures]) => ({ storyId, consecutiveFailures }));

  return {
    backlog,
    delivered: [...merged],
    openPrStories,
    recentFailures,
    routeConfigErrors,
    releaseBlockers: [],
    rollMeta: readRollMetaState(projectPath),
    manualMergeGates: readManualMergeGates(projectPath, events, quietExecPort, backlog.map((row) => row.id)),
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
    "  Supervisor Agent — project facts (observe)",
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
  if (decisions.length === 0) return "\n  Supervisor Agent — no advisory decisions (project healthy)\n\n";
  const rows = decisions.map((d) => `    [${d.kind}]${d.requiresOwner ? " (owner confirmation required)" : ""} ${d.reason}`);
  return ["", "  Supervisor Agent — advisory decisions", "", ...rows, ""].join("\n") + "\n";
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
  const lines = ["", "  Supervisor Live — read-only role board", "", `    supervisor: ${board.supervisor.state} · ${board.supervisor.summary}`, ""];
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
  if (sub !== undefined && !["observe", "advise", "next", "why", "live"].includes(sub)) {
    process.stderr.write(SUPERVISOR_USAGE + "\n");
    return 1;
  }
  const projectPath = process.cwd();
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
            ? { mode, why: runbookWhy(runbook, facts), runbook, ...ctx }
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
      `\n  Supervisor — next: ${n.storyId ?? "(nothing ready)"}\n  scope: ${state.scope.label}\n  remaining: ${remainingLine(input)}\n  cast: ${ctx.cast}\n  cast detail: ${ctx.castDetail}\n  gate: ${ctx.gate}\n  manual merge: ${ctx.manualMerge}\n  .roll meta: ${ctx.rollMeta.state} — ${ctx.rollMeta.detail}\n  ${n.reason}\n  ${formatOperatingMode(mode)}\n  owner action: ${action}\n  scheduler: ${state.next.schedulerAction}\n\n`,
    );
    return 0;
  }
  if (sub === "why") {
    const mode = resolveOperatingMode(projectPath);
    const state = buildSupervisorRunbookState(input);
    const why = runbookWhy(state, facts);
    const ctx = supervisorContext(projectPath, input, readSupervisorEvents(projectPath));
    const ownerAction = state.next.kind === "diagnose_failure" || state.next.kind === "manual_merge_gate" ? state.next.ownerAction : mode.ownerAction;
    const schedulerAction =
      state.next.kind === "diagnose_failure" || state.next.kind === "manual_merge_gate" ? state.next.schedulerAction : mode.schedulerAction;
    process.stdout.write(
      `\n  Supervisor — why stuck: ${why}\n  cast: ${ctx.cast}\n  cast detail: ${ctx.castDetail}\n  gate: ${ctx.gate}\n  manual merge: ${ctx.manualMerge}\n  .roll meta: ${ctx.rollMeta.state} — ${ctx.rollMeta.detail}\n  ${formatOperatingMode(mode)}\n  owner action: ${ownerAction}\n  scheduler: ${schedulerAction}\n\n`,
    );
    return 0;
  }
  // default: observe + advise
  process.stdout.write(fmtFacts(input, readSupervisorEvents(projectPath)) + fmtAdvice(input));
  return 0;
}
