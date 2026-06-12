/**
 * Cross-Agent Pairing CLI surface.
 *   `roll pair init`   (US-PAIR-001) — scaffold an explicit .roll/pairing.yaml.
 *   `roll pair status` (US-PAIR-002) — observability: who is in the pairing pool,
 *     their vendor + capability, and why an agent is excluded. Observability is a
 *     first-class need; kept OFF `roll agent list` (byte-difftest'd) by living
 *     under `pair` so the existing command's output is untouched.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  agentDisplayName,
  agentsInstalled,
  aggregatePairingCost,
  defaultPairingConfig,
  pairingPoolView,
  parsePairingConfig,
  renderPairingConfig,
  type PairingCostSummary,
} from "@roll/core";
import { parseEventLine, type RollEvent } from "@roll/spec";
import { peerReviewCost } from "@roll/core";
import { buildPairScorePrompt, parsePairScoreOutput, runScorePairing, type PairEvent } from "../runner/pairing-gate.js";
import { projectAgent, realAgentEnv } from "./agent-list.js";
import { spawnPeerReviewAgent, type SpawnPeerReviewInput, type SpawnPeerReviewResult } from "./peer.js";
import { loopRuntimeDir, projectSlug, sharedRoot } from "./dashboard.js";

const HELP = `Usage: roll pair <init|status|score>
  init [--force]   Scaffold .roll/pairing.yaml from installed agents.
                   File present = pairing on; delete it = off. --force overwrites.
  status           Show the pairing pool: who pairs, vendor, capability, why excluded.
  score <story-id> [--summary <text>|--file <path>] [--timeout-ms <ms>]
                   Ask the paired heterogeneous agent to score a finished cycle
                   (US-PAIR-009/010); falls back to self-score with a hint.

  init   从已安装的 agent 物化 .roll/pairing.yaml；文件在=开，删掉=关；--force 覆盖。
  status 显示结对池：谁能结对、厂商、能力、谁因何被排除。
  score  让异构配对 agent 给完成的 cycle 打分；无候选/超时回落自评并给出提示。
`;

export function pairCommand(args: string[]): number | Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (args[0] === "init") return pairInit(args.slice(1));
  if (args[0] === "status") return pairStatus(args.slice(1));
  if (args[0] === "score") return pairScore(args.slice(1));
  process.stderr.write(`[roll] unknown pair subcommand: ${args[0]}\n`);
  process.stderr.write(HELP);
  return 1;
}

function pairInit(rest: string[]): number {
  // strict arg check (kimi pair-review): reject stray args.
  const extra = rest.filter((a) => a !== "--force");
  if (extra.length > 0) {
    process.stderr.write(`[roll] unexpected argument(s): ${extra.join(" ")}\n`);
    process.stderr.write(HELP);
    return 1;
  }
  const force = rest.includes("--force");
  const path = join(process.cwd(), ".roll", "pairing.yaml");

  if (existsSync(path) && !force) {
    process.stdout.write(
      `pairing.yaml already exists — left untouched (use --force to regenerate)\n` +
        `pairing.yaml 已存在，未改动（--force 可重新生成）\n  ${path}\n`,
    );
    return 0;
  }

  const installed = agentsInstalled(realAgentEnv());
  const cfg = defaultPairingConfig(installed);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderPairingConfig(cfg), "utf8");

  const peers = Object.keys(cfg.capability).join(", ") || "(none)";
  process.stdout.write(
    `pairing.yaml written\npairing.yaml 已生成\n` +
      `  ${path}\n` +
      `  enabled: ${cfg.enabled} · stages: [${cfg.stages.join(", ")}]\n` +
      `  agents: ${peers}\n` +
      (cfg.enabled
        ? `  Pairing is ON for stages [${cfg.stages.join(", ")}] — a different-vendor agent cross-checks and scores each delivery.\n` +
          `  已为 [${cfg.stages.join(", ")}] 阶段开启结对——交付会由不同厂商的 agent 互检并打分。\n`
        : `  Pairing is OFF: fewer than two distinct vendors installed (no heterogeneous peer).\n` +
          `  结对未开启：已装 agent 不足两个不同厂商（无异构搭档）。\n`),
  );
  return 0;
}

function pairStatus(rest: string[]): number {
  if (rest.length > 0) {
    process.stderr.write(`[roll] unexpected argument(s): ${rest.join(" ")}\n`);
    return 1;
  }
  const path = join(process.cwd(), ".roll", "pairing.yaml");
  if (!existsSync(path)) {
    process.stdout.write(
      `pairing is OFF — no .roll/pairing.yaml (run \`roll pair init\`)\n` +
        `结对未开启——没有 .roll/pairing.yaml（先跑 \`roll pair init\`）\n`,
    );
    return 0;
  }
  const noColor = (process.env["NO_COLOR"] ?? "") !== "";
  const GREEN = noColor ? "" : "\x1b[0;32m";
  const DIM = noColor ? "" : "\x1b[0;90m";
  const NC = noColor ? "" : "\x1b[0m";

  let view;
  try {
    view = pairingPoolView(agentsInstalled(realAgentEnv()), parsePairingConfig(readFileSync(path, "utf8")));
  } catch (e) {
    process.stderr.write(`[roll] pairing.yaml invalid: ${(e as Error).message}\n`);
    return 1;
  }

  const out: string[] = ["", `  Cross-Agent Pairing — pool status / 结对池状态`, ""];
  out.push(`  enabled: ${view.enabled} · stages: [${view.stages.join(", ")}]`, "");
  for (const a of view.agents) {
    const disp = agentDisplayName(a.agent);
    const cap = a.capability.length > 0 ? `[${a.capability.join(", ")}]` : "—";
    if (a.inPool) {
      out.push(`    ${GREEN}✓ ${disp}${NC}  ${DIM}vendor=${a.vendor} · ${cap}${NC}`);
    } else {
      out.push(`    ${DIM}· ${disp}  vendor=${a.vendor} · ${cap} · excluded: ${a.reason}${NC}`);
    }
  }
  // US-PAIR-006 cost observability: surface pairing activity + spend from the
  // event stream. Best-effort — no events file / read error → a zero-activity line.
  out.push("");
  out.push(renderPairingActivity(pairingActivitySummary(), { noColor }));
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}

/** ndjson files holding this project's events (loop runtime dir, then shared). */
function pairingEventFiles(): string[] {
  const slug = projectSlug();
  const candidates: string[] = [];
  const rtDir = loopRuntimeDir(slug);
  if (rtDir !== null) {
    candidates.push(join(rtDir, "events.ndjson"));
    for (let i = 1; i < 5; i++) candidates.push(join(rtDir, `events.ndjson.${i}`));
  }
  candidates.push(join(sharedRoot(), "loop", `events-${slug}.ndjson`));
  for (let i = 1; i < 5; i++) candidates.push(join(sharedRoot(), "loop", `events-${slug}.ndjson.${i}`));
  return candidates.filter((p) => existsSync(p));
}

/**
 * Read this project's pair:* events and fold them into a {@link PairingCostSummary}.
 * Best-effort: a missing/unreadable stream yields the zero summary (never throws),
 * so `roll pair status` always renders something.
 */
function pairingActivitySummary(): PairingCostSummary {
  const events: RollEvent[] = [];
  // De-dup identical lines across rotated/shared files (pi pair-review): a
  // rotation that copies rather than moves could otherwise double-count.
  const seen = new Set<string>();
  for (const p of pairingEventFiles()) {
    let content: string;
    try {
      content = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || seen.has(trimmed)) continue;
      seen.add(trimmed);
      const e = parseEventLine(trimmed);
      if (e !== null) events.push(e);
    }
  }
  return aggregatePairingCost(events);
}

/**
 * Render the pairing activity/spend block (US-PAIR-006, cost observability):
 * "pairings to date: N, by peer (codex×K…), total cost $X, M findings". Pure
 * (summary → string) so it is unit-testable; the CLI locates the events and
 * prints this. Bilingual: English + Chinese on separate lines (project
 * convention). Always renders, even at zero activity.
 */
export function renderPairingActivity(summary: PairingCostSummary, opts: { noColor: boolean }): string {
  const DIM = opts.noColor ? "" : "\x1b[0;90m";
  const NC = opts.noColor ? "" : "\x1b[0m";
  const byPeer = Object.keys(summary.byPeer)
    .sort((a, b) => (summary.byPeer[b] ?? 0) - (summary.byPeer[a] ?? 0) || a.localeCompare(b))
    .map((p) => `${agentDisplayName(p)}×${summary.byPeer[p]}`)
    .join(", ");
  const cost = `$${summary.totalCost.toFixed(2)}`;
  const peerStr = byPeer === "" ? "—" : byPeer;
  const lines: string[] = [
    `  Pairing activity — 结对活动`,
    `  ${DIM}pairings to date: ${summary.pairings} · by peer: ${peerStr}${NC}`,
    `  ${DIM}total cost: ${cost} · findings: ${summary.totalFindings} · none-available: ${summary.noneAvailable}${NC}`,
    `  ${DIM}累计结对：${summary.pairings} 次 · 各 peer：${peerStr}${NC}`,
    `  ${DIM}总花费：${cost} · 发现问题：${summary.totalFindings} · 无可用 peer：${summary.noneAvailable}${NC}`,
  ];
  return lines.join("\n");
}

// ── US-PAIR-010: `roll pair score` — the manual surface for the score stage ──

export interface PairScoreCmdDeps {
  installed: string[];
  isAvailable: (agent: string) => boolean;
  /** The agent whose work is being scored (default: the project agent). */
  workingAgent: () => string;
  /** Reviewer spawn seam (default: the `roll peer` text-agent spawn). */
  spawnReviewer: (input: SpawnPeerReviewInput) => Promise<SpawnPeerReviewResult>;
}

const PAIR_SCORE_TIMEOUT_MS = 180_000;

function defaultPairScoreDeps(): PairScoreCmdDeps {
  return {
    installed: agentsInstalled(realAgentEnv()),
    isAvailable: () => true,
    workingAgent: () => projectAgent(),
    spawnReviewer: spawnPeerReviewAgent,
  };
}

/** Best-effort event sink: manual score pairings land in the same shared event
 *  stream `roll pair status` aggregates, so the activity/spend ledger sees them. */
function appendPairEvent(e: PairEvent): void {
  try {
    const dir = join(sharedRoot(), "loop");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `events-${projectSlug()}.ndjson`), `${JSON.stringify(e)}\n`, "utf8");
  } catch {
    /* observability is best-effort — never fail the command */
  }
}

/** Summary precedence: --summary > --file > the story's backlog row. */
function resolveSummary(storyId: string, summaryFlag?: string, fileFlag?: string): string | null {
  if (summaryFlag !== undefined && summaryFlag.trim() !== "") return summaryFlag.trim();
  if (fileFlag !== undefined) {
    try {
      return readFileSync(fileFlag, "utf8").trim() || null;
    } catch {
      return null;
    }
  }
  try {
    const backlog = readFileSync(join(process.cwd(), ".roll", "backlog.md"), "utf8");
    const row = backlog.split("\n").find((l) => l.includes(storyId));
    return row !== undefined ? `Story ${storyId} — backlog row:\n${row.trim()}` : null;
  } catch {
    return null;
  }
}

export async function pairScore(rest: string[], deps: PairScoreCmdDeps = defaultPairScoreDeps()): Promise<number> {
  const flagsWithValue = new Set(["--summary", "--file", "--timeout-ms"]);
  let storyId: string | undefined;
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    if (flagsWithValue.has(a)) {
      const v = rest[i + 1];
      if (v === undefined) {
        process.stderr.write(`[roll] ${a} requires a value\n${HELP}`);
        return 1;
      }
      flags.set(a, v);
      i++;
    } else if (a.startsWith("-")) {
      process.stderr.write(`[roll] unknown flag: ${a}\n${HELP}`);
      return 1;
    } else if (storyId === undefined) {
      storyId = a;
    } else {
      process.stderr.write(`[roll] unexpected argument: ${a}\n${HELP}`);
      return 1;
    }
  }
  if (storyId === undefined || storyId === "") {
    process.stderr.write(`[roll] pair score requires a story id\n${HELP}`);
    return 1;
  }
  const summary = resolveSummary(storyId, flags.get("--summary"), flags.get("--file"));
  if (summary === null) {
    process.stderr.write(
      `[roll] no summary for ${storyId}: pass --summary/--file, or add the story to .roll/backlog.md\n`,
    );
    return 1;
  }
  const timeoutMs = flags.has("--timeout-ms") ? Number(flags.get("--timeout-ms")) : PAIR_SCORE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    process.stderr.write(`[roll] invalid --timeout-ms\n`);
    return 1;
  }

  const skill = storyId.startsWith("FIX-") || storyId.startsWith("BUG-") ? "roll-fix" : "roll-build";
  const cycleId = `manual-${storyId}-${Math.floor(Date.now() / 1000)}`;
  const scorePeer = async (peer: string, s: string, t: number) => {
    const res = await deps.spawnReviewer({ agent: peer, projectPath: process.cwd(), prompt: buildPairScorePrompt(s), timeoutMs: t });
    if (res.status !== "ok") return null;
    const parsed = parsePairScoreOutput(res.stdout);
    return parsed === null ? null : { ...parsed, cost: peerReviewCost(peer, res.stdout) };
  };

  const r = await runScorePairing(process.cwd(), join(process.cwd(), ".roll"), cycleId, deps.workingAgent(), storyId, skill, summary, {
    installed: deps.installed,
    isAvailable: deps.isAvailable,
    scorePeer,
    event: appendPairEvent,
    now: () => Date.now(),
    timeoutMs,
  });

  if (r.status === "scored") {
    const rel = r.notePath !== undefined ? relative(process.cwd(), r.notePath) : "";
    process.stdout.write(
      `Pair score written by ${r.peer}: ${r.score}/10\n` +
        `配对评分已由 ${r.peer} 写入：${r.score}/10\n` +
        `  ${rel}\n  evidence: ${relative(process.cwd(), join(process.cwd(), ".roll", "peer", `cycle-${cycleId}.score.pair.json`))}\n`,
    );
    return 0;
  }
  // Enhancement, never a blocker: every non-scored outcome degrades to the
  // documented self-score fallback with the reason in hand (exit 0).
  const reason =
    r.status === "off"
      ? "pairing off (no .roll/pairing.yaml score stage)"
      : r.status === "none-available"
        ? "no heterogeneous candidate"
        : r.status === "timeout"
          ? `peer ${r.peer ?? ""} timed out or broke protocol`.trim()
          : "score pairing errored";
  process.stdout.write(
    `Pair scoring fallback (${reason}) — write the self-score instead:\n` +
      `配对评分回落（${reason}）——请改用自评：\n` +
      `  roll self-score ${skill} ${storyId} <score 1..10> <good|ok|regression> "<rationale>" --fallback-reason "${reason}"\n`,
  );
  return 0;
}
