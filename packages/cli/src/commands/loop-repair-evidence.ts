/**
 * `roll loop repair-evidence <story-id> [--apply] [--outcome started|committed|failed]
 *                    [--agent <name>] [--reason <text>] [--json]`
 *
 * FIX-1058 - the supervised recovery path for a green manual-merge PR that is
 * blocked ONLY by missing delivery evidence (acceptance report / ac-map). The
 * original Builder did real work, CI is green, and the Evaluator approved; the
 * missing artifact is delivery evidence. This command lets a Delta Team agent
 * (or owner) record the repair milestone on the SAME PR without opening a new
 * card or re-running the whole story.
 *
 * Default (no --apply): print the auditable recovery facts - open PR, CI state,
 * evaluator state, missing evidence, and the exact command to record a repair.
 *
 * `--apply`: append an `evidence:repair` event to `events.ndjson`. The event
 * records WHO repaired, WHICH PR/story, and the outcome, so supervisor and the
 * PR loop can distinguish original Builder, repair Builder, Evaluator, CI state,
 * and final attest result.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EventBus } from "@roll/core";
import type { RollEvent } from "@roll/spec";

export interface RepairEvidenceDeps {
  now: () => number;
  runGh: (argv: string[]) => { stdout: string; code: number };
  readEvents: (path: string) => RollEvent[];
  appendEvent: (path: string, event: RollEvent) => void;
}

export function realRepairEvidenceDeps(): RepairEvidenceDeps {
  return {
    now: () => Date.now(),
    runGh: (argv) => {
      try {
        const stdout = execFileSync("gh", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        return { stdout: stdout.trim(), code: 0 };
      } catch (err: unknown) {
        const e = err as { stdout?: Buffer | string; status?: number | null };
        const out = e.stdout === undefined ? "" : e.stdout.toString();
        return { stdout: out.trim(), code: typeof e.status === "number" ? e.status : 1 };
      }
    },
    readEvents: (path) => {
      try {
        if (existsSync(path)) return new EventBus().readEvents(path);
      } catch {
        // fall through
      }
      return [];
    },
    appendEvent: (path, event) => {
      mkdirSync(dirname(path), { recursive: true });
      new EventBus().appendEvent(path, event);
    },
  };
}

interface ParsedArgs {
  storyId?: string;
  apply: boolean;
  outcome: "started" | "committed" | "failed";
  agent: string;
  reason: string;
  json: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let storyId: string | undefined;
  let apply = false;
  let outcome: ParsedArgs["outcome"] = "committed";
  let agent = "owner";
  let reason = "";
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? "";
    if (a === "--apply") apply = true;
    else if (a === "--json") json = true;
    else if (a === "--outcome") outcome = normalizeOutcome(argv[++i]);
    else if (a.startsWith("--outcome=")) outcome = normalizeOutcome(a.slice("--outcome=".length));
    else if (a === "--agent") agent = (argv[++i] ?? "").trim() || "owner";
    else if (a.startsWith("--agent=")) agent = a.slice("--agent=".length).trim() || "owner";
    else if (a === "--reason") reason = (argv[++i] ?? "").trim();
    else if (a.startsWith("--reason=")) reason = a.slice("--reason=".length).trim();
    else if (!a.startsWith("-")) storyId = a.trim();
  }
  return { ...(storyId !== undefined && storyId !== "" ? { storyId } : {}), apply, outcome, agent, reason, json };
}

function normalizeOutcome(raw: string | undefined): ParsedArgs["outcome"] {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "started" || v === "failed") return v;
  return "committed";
}

function eventsPath(projectPath: string): string {
  const rt = (process.env["ROLL_PROJECT_RUNTIME_DIR"] ?? "").trim() || join(projectPath, ".roll", "loop");
  return join(rt, "events.ndjson");
}

function findPrForStory(events: RollEvent[], storyId: string): number | undefined {
  let pr: number | undefined;
  for (const ev of events) {
    if (ev.type === "pr:open" && ev.storyId === storyId) pr = ev.prNumber;
  }
  return pr;
}

function cycleStoryMap(events: RollEvent[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const ev of events) {
    if (ev.type === "cycle:start") map.set(ev.cycleId, ev.storyId);
  }
  return map;
}

function latestAttestGateForStoryByCycle(events: RollEvent[], storyId: string): Extract<RollEvent, { type: "attest:gate" }> | undefined {
  const cycleStory = cycleStoryMap(events);
  let best: Extract<RollEvent, { type: "attest:gate" }> | undefined;
  for (const ev of events) {
    if (ev.type !== "attest:gate") continue;
    if (cycleStory.get(ev.cycleId) !== storyId) continue;
    if (best === undefined || ev.ts > best.ts) best = ev;
  }
  return best;
}

function findEvaluator(events: RollEvent[], storyId: string): { peer: string; score: number; verdict: string } | undefined {
  const cycleStory = cycleStoryMap(events);
  let best: Extract<RollEvent, { type: "pair:score" }> | undefined;
  for (const ev of events) {
    if (ev.type !== "pair:score") continue;
    if (cycleStory.get(ev.cycleId) !== storyId) continue;
    if (best === undefined || ev.ts > best.ts) best = ev;
  }
  if (best === undefined) return undefined;
  return { peer: best.peer, score: best.score, verdict: best.verdict };
}

function findOriginalBuilder(events: RollEvent[], storyId: string): string | undefined {
  let best: Extract<RollEvent, { type: "cycle:start" }> | undefined;
  for (const ev of events) {
    if (ev.type !== "cycle:start") continue;
    if (ev.storyId !== storyId) continue;
    if (best === undefined || ev.ts < best.ts) best = ev;
  }
  return best?.agent;
}

export function loopRepairEvidenceCommand(argv: string[], deps: RepairEvidenceDeps = realRepairEvidenceDeps()): number {
  const opts = parseArgs(argv);
  const projectPath = (process.env["ROLL_MAIN_PROJECT"] ?? "").trim() || process.cwd();
  const evPath = eventsPath(projectPath);
  const events = deps.readEvents(evPath);

  if (opts.storyId === undefined) {
    const msg = "Usage: roll loop repair-evidence <story-id> [--apply] [--outcome started|committed|failed] [--agent <name>] [--reason <text>]";
    if (opts.json) process.stdout.write(JSON.stringify({ ok: false, reason: "missing story-id" }, null, 2) + "\n");
    else process.stdout.write("\n  " + msg + "\n\n");
    return 1;
  }

  const storyId = opts.storyId;
  const prNumber = findPrForStory(events, storyId);
  const builder = findOriginalBuilder(events, storyId);
  const evaluator = findEvaluator(events, storyId);
  const lastAttest = latestAttestGateForStoryByCycle(events, storyId);

  if (prNumber === undefined) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: false, storyId, reason: "no open PR" }, null, 2) + "\n");
    } else {
      process.stdout.write("\n  roll loop repair-evidence: no open PR found for " + storyId + "\n\n");
    }
    return 1;
  }

  const view = deps.runGh(["pr", "view", String(prNumber), "--json", "reviews,mergeStateStatus,statusCheckRollup,body,labels,isDraft"]);
  let prState: { ciState?: string; mergeable?: string; bot?: string } = {};
  if (view.code === 0) {
    try {
      const raw = JSON.parse(view.stdout) as {
        reviews?: Array<{ authorAssociation?: string; state?: string }>;
        mergeStateStatus?: string;
        statusCheckRollup?: Array<{ conclusion?: string | null }>;
      };
      const botReviews = (raw.reviews ?? []).filter((r) => r.authorAssociation === "BOT" || r.authorAssociation === "APP");
      const lastBot = botReviews[botReviews.length - 1];
      const rollup = (raw.statusCheckRollup ?? []).map((c) => c.conclusion ?? null);
      const ciState = rollup.length === 0
        ? ""
        : rollup.some((c) => c === "FAILURE")
        ? "failure"
        : rollup.every((c) => c === "SUCCESS" || c === "SKIPPED")
        ? "success"
        : "pending";
      prState = { ciState, mergeable: raw.mergeStateStatus, bot: lastBot?.state ?? "" };
    } catch {
      // keep empty
    }
  }

  if (!opts.apply) {
    const payload = {
      recoverable: true,
      storyId,
      prNumber,
      originalBuilder: builder ?? null,
      evaluator: evaluator ?? null,
      lastAttest: lastAttest ?? null,
      prState,
      command: "roll loop repair-evidence " + storyId + " --apply --outcome committed --agent <delta-team-agent>",
    };
    if (opts.json) {
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    } else {
      const evaluatorLine = evaluator
        ? evaluator.peer + " " + String(evaluator.score) + "/" + evaluator.verdict
        : "(unknown)";
      const attestLine = lastAttest
        ? lastAttest.verdict + " - " + lastAttest.reasons.join("; ")
        : "(none)";
      const lines = [
        "",
        "  Supervised recovery - delivery evidence repair",
        "",
        "    story: " + storyId,
        "    PR: #" + String(prNumber),
        "    original Builder: " + (builder ?? "(unknown)"),
        "    accepted Evaluator: " + evaluatorLine,
        "    last attest: " + attestLine,
        "    PR state: ci=" + (prState.ciState ?? "unknown") + " merge=" + (prState.mergeable ?? "unknown") + " bot=" + (prState.bot ?? "none"),
        "",
        "    to record the repair: roll loop repair-evidence " + storyId + " --apply --outcome committed --agent <delta-team-agent>",
        "",
      ];
      process.stdout.write(lines.join("\n") + "\n");
    }
    return 0;
  }

  const event: RollEvent = {
    type: "evidence:repair",
    prNumber,
    storyId,
    agent: opts.agent,
    outcome: opts.outcome,
    ts: deps.now(),
  };
  deps.appendEvent(evPath, event);

  const payload = {
    ok: true,
    storyId,
    prNumber,
    outcome: opts.outcome,
    agent: opts.agent,
    reason: opts.reason !== "" ? opts.reason : "delivery evidence repair recorded",
    event,
  };
  if (opts.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    const lines = [
      "",
      "  roll loop repair-evidence: " + opts.outcome + " - " + storyId + " / PR #" + String(prNumber),
      "    agent: " + opts.agent,
      "    reason: " + (opts.reason !== "" ? opts.reason : "delivery evidence repair recorded"),
      "",
    ];
    process.stdout.write(lines.join("\n") + "\n");
  }
  return 0;
}
