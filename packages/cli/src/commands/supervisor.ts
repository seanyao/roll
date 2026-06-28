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
 *   roll supervisor --json     # machine-readable
 */
import {
  EventBus,
  adviseProject,
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
import type { RollEvent, SupervisorInput } from "@roll/spec";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const SUPERVISOR_USAGE = [
  "Usage: roll supervisor [status|observe|advise|next|why] [--json]",
  "  status           observe + advise summary (alias for no subcommand)",
  "  observe          structured project facts (backlog, truth coverage, PRs, release readiness)",
  "  advise           Supervisor decisions (advisory; persistent changes need owner confirmation)",
  "  next             what should Roll do next?",
  "  why              why is the project stuck?",
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
  const FAIL = new Set(["failed", "gave_up", "blocked", "aborted"]);
  for (const ev of events) {
    if (ev.type === "pr:merge") merged.add(ev.storyId);
    else if (ev.type === "pr:open") opened.add(ev.storyId);
    else if (ev.type === "cycle:start") cycleStory.set(ev.cycleId, ev.storyId);
    else if (ev.type === "cycle:end") {
      const sid = cycleStory.get(ev.cycleId);
      if (sid !== undefined) {
        // consecutive trailing failures: reset on a non-failure terminal.
        failuresByStory.set(sid, FAIL.has(ev.outcome) ? (failuresByStory.get(sid) ?? 0) + 1 : 0);
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
  };
}

function fmtFacts(input: SupervisorInput): string {
  const f = observeProject(input);
  const truthCoverage =
    f.truthDrift.length === 0
      ? "complete"
      : `partial — ${f.truthDrift.length} Done row(s) lack structured delivery truth (${summarizeList(f.truthDrift)}); run roll truth audit for detail`;
  const lines = [
    "",
    "  Supervisor Agent — project facts (observe)",
    "",
    `    backlog: ${f.counts.todo} todo · ${f.counts.inProgress} in-progress · ${f.counts.blocked} blocked · ${f.counts.done} done`,
    `    open PRs: ${f.openPrCount}`,
    `    truth coverage: ${truthCoverage}`,
    `    stuck stories: ${summarizeList(f.stuckStories)}`,
    `    route config: ${f.routeConfigErrors.length === 0 ? "ok" : summarizeList(f.routeConfigErrors)}`,
    `    release: ${f.releaseReadiness.ready ? "ready" : "blocked — " + summarizeList(f.releaseReadiness.blockers)}`,
    `    budget: ${f.budgetHealth.note}`,
    "",
  ];
  return lines.join("\n") + "\n";
}

function fmtAdvice(input: SupervisorInput): string {
  const decisions = adviseProject(observeProject(input));
  if (decisions.length === 0) return "\n  Supervisor Agent — no advisory decisions (project healthy)\n\n";
  const rows = decisions.map((d) => `    [${d.kind}]${d.requiresOwner ? " (owner confirmation required)" : ""} ${d.reason}`);
  return ["", "  Supervisor Agent — advisory decisions", "", ...rows, ""].join("\n") + "\n";
}

export function supervisorCommand(args: string[]): number {
  const json = args.includes("--json");
  let sub = args.find((a) => !a.startsWith("-"));
  // `status` is an alias for the default observe + advise summary.
  if (sub === "status") sub = undefined;
  if (sub !== undefined && !["observe", "advise", "next", "why"].includes(sub)) {
    process.stderr.write(SUPERVISOR_USAGE + "\n");
    return 1;
  }
  const projectPath = process.cwd();
  const input = gatherSupervisorInput(projectPath);
  const facts = observeProject(input);

  if (json) {
    const out =
      sub === "advise"
        ? { decisions: adviseProject(facts) }
        : sub === "next"
          ? { next: recommendNext(input) }
          : sub === "why"
            ? { why: explainStuck(facts) }
            : { facts, decisions: adviseProject(facts), next: recommendNext(input) };
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return 0;
  }

  if (sub === "observe") {
    process.stdout.write(fmtFacts(input));
    return 0;
  }
  if (sub === "advise") {
    process.stdout.write(fmtAdvice(input));
    return 0;
  }
  if (sub === "next") {
    const n = recommendNext(input);
    process.stdout.write(`\n  Supervisor — next: ${n.storyId ?? "(nothing ready)"}\n  ${n.reason}\n\n`);
    return 0;
  }
  if (sub === "why") {
    process.stdout.write(`\n  Supervisor — why stuck: ${explainStuck(facts)}\n\n`);
    return 0;
  }
  // default: observe + advise
  process.stdout.write(fmtFacts(input) + fmtAdvice(input));
  return 0;
}
