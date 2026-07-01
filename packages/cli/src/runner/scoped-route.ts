/**
 * FIX-1047 — scoped `story.execute` (Builder) routing.
 *
 * The executor used to resolve `story.execute` WITHOUT first resolving the
 * active `supervise` (Prime) assignment, so a project's `avoid: [supervise]`
 * rule was inert — the Prime agent stayed eligible as Builder and the
 * `least-recent` strategy kept landing on the first declared candidate
 * (claude). This module resolves the Prime role first, threads it in as
 * `assignedRoles.supervise` so `avoid` excludes the Prime by identity, and
 * feeds recent Builder usage so `least-recent` fairly rotates the whole pool.
 *
 * The full {@link AgentScopeRoleResolution} (candidate pool, skipped candidates
 * with reasons, strategy, selected Builder, source path) is returned so both
 * the executor and the route diagnostic command surface the same auditable
 * trace.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  AGENT_REGISTRY_NAMES,
  agentsInstalled,
  canonicalAgentName,
  normalizeAgentScopeConfig,
  rankRoleCandidates,
  resolveAgentScopeRole,
} from "@roll/core";
import type {
  AgentHealthSignal,
  AgentName,
  AgentScopeConfig,
  AgentScopeRoleResolution,
  CastRoleName,
  RankedRoleCandidate,
} from "@roll/spec";
import { realAgentEnv } from "../commands/agent-list.js";

export interface ScopedExecuteRoute {
  readonly resolution: AgentScopeRoleResolution;
  /** The active Prime (`supervise`) agent honored by `avoid: [supervise]`, if any. */
  readonly superviseAgent: AgentName | null;
  /** Recent-use input handed to the `least-recent` strategy (epoch ms per agent). */
  readonly recentUse: Readonly<Partial<Record<AgentName, number>>>;
}

export function readScopedAgentLayer(path: string): { config: AgentScopeConfig; path: string } | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  if (!text.includes("roll-agents/v1")) return null;
  const parsed = normalizeAgentScopeConfig(text);
  if (parsed.config === null || parsed.errors.length > 0) return null;
  return { config: parsed.config, path };
}

function runtimeDirFor(repoCwd: string): string {
  return (process.env["ROLL_PROJECT_RUNTIME_DIR"] ?? "").trim() || join(repoCwd, ".roll", "loop");
}

/**
 * Map each agent to the epoch ms of its most recent Builder run (from
 * runs.jsonl). Larger = more recently used; absent agents are "never used" and
 * the `least-recent` strategy schedules them first. Best-effort: any IO/parse
 * failure yields an empty map (degenerate but deterministic least-recent).
 */
function readRecentUse(runtimeDir: string): Partial<Record<AgentName, number>> {
  const out: Partial<Record<AgentName, number>> = {};
  const path = join(runtimeDir, "runs.jsonl");
  if (!existsSync(path)) return out;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let row: { agent?: unknown; ts?: unknown };
    try {
      row = JSON.parse(trimmed) as { agent?: unknown; ts?: unknown };
    } catch {
      continue;
    }
    if (typeof row.agent !== "string" || typeof row.ts !== "string") continue;
    const agent = canonicalAgentName(row.agent) as AgentName;
    if (!(AGENT_REGISTRY_NAMES as readonly string[]).includes(agent)) continue;
    const when = Date.parse(row.ts);
    if (Number.isNaN(when)) continue;
    const prev = out[agent];
    if (prev === undefined || when > prev) out[agent] = when;
  }
  return out;
}

/** Test seams; production reads the real ROLL_HOME, installed agents, and runs.jsonl. */
export interface ScopedRouteDeps {
  readonly rollHome?: string;
  readonly installed?: ReadonlySet<string>;
  readonly recentUse?: Readonly<Partial<Record<AgentName, number>>>;
}

/**
 * Resolve the scoped Builder (`story.execute`) assignment, honoring the active
 * Prime binding and recent-use fairness. Returns `null` when no scoped layer is
 * present (the caller falls back to legacy tier routing).
 */
export function resolveScopedStoryExecute(repoCwd: string, deps: ScopedRouteDeps = {}): ScopedExecuteRoute | null {
  const rollHome = deps.rollHome ?? process.env["ROLL_HOME"] ?? join(homedir(), ".roll");
  const layers = [
    readScopedAgentLayer(join(rollHome, "agents.yaml")),
    readScopedAgentLayer(join(repoCwd, ".roll", "agents.yaml")),
  ].filter((layer): layer is { config: AgentScopeConfig; path: string } => layer !== null);
  if (layers.length === 0) return null;

  const installed = deps.installed ?? new Set(agentsInstalled(realAgentEnv()).map((name) => canonicalAgentName(name)));
  const runtimeHealth = Object.fromEntries(
    AGENT_REGISTRY_NAMES.map((agent) => [
      agent,
      installed.has(agent) ? { available: true } : { available: false, reason: "not-installed" },
    ]),
  ) as Partial<Record<AgentName, { available: boolean; reason?: string }>>;

  // Resolve the active Prime first so `avoid: [supervise]` excludes it by
  // identity (not by capability). A supervise failure must not block Builder
  // routing — the assignment is simply absent and `avoid` becomes a no-op.
  const superviseResolution = resolveAgentScopeRole({ scope: "story", role: "supervise", layers, runtimeHealth });
  const superviseAgent = superviseResolution.ok ? superviseResolution.resolved.agent : null;

  const recentUse = deps.recentUse ?? readRecentUse(runtimeDirFor(repoCwd));
  const runtimeDir = runtimeDirFor(repoCwd);
  const resolution = resolveAgentScopeRole({
    scope: "story",
    role: "execute",
    layers,
    runtimeHealth,
    recentUse,
    ...(superviseAgent !== null ? { assignedRoles: { supervise: superviseAgent } } : {}),
    roleCastRanking: {
      profiles: defaultCapabilityProfiles(),
      health: healthSignalsFromEvents(runtimeDir),
      recentOutcomes: readRecentOutcomes(runtimeDir),
    },
  });
  return { resolution, superviseAgent, recentUse };
}

/** The auditable Builder route trace surfaced by the diagnostic command. */
export interface ScopedExecuteRouteTrace {
  readonly role: "execute";
  readonly candidates: readonly AgentName[];
  readonly skipped: readonly { readonly agent: AgentName; readonly reason: string }[];
  readonly strategy: string;
  readonly selected: AgentName | null;
  readonly source: string | null;
  readonly supervise: AgentName | null;
  readonly recentUse: Readonly<Partial<Record<AgentName, number>>>;
  readonly error: string | null;
}

/** Project the resolution into the stable trace shape (JSON-friendly, total). */
export function scopedExecuteRouteTrace(route: ScopedExecuteRoute): ScopedExecuteRouteTrace {
  const { resolution, superviseAgent, recentUse } = route;
  if (resolution.ok) {
    const r = resolution.resolved;
    return {
      role: "execute",
      candidates: r.candidates,
      skipped: r.skipped.map((s) => ({ agent: s.agent, reason: s.reason })),
      strategy: r.selectedStrategy,
      selected: r.agent,
      source: r.source,
      supervise: superviseAgent,
      recentUse,
      error: null,
    };
  }
  const f = resolution.failure;
  return {
    role: "execute",
    candidates: f.candidates,
    skipped: f.skipped.map((s) => ({ agent: s.agent, reason: s.reason })),
    strategy: "none",
    selected: null,
    source: f.source ?? null,
    supervise: superviseAgent,
    recentUse,
    error: f.errors[0] ?? "story.execute unresolved",
  };
}

/** Map a story scope role to the public casting role vocabulary. */
function castRoleForScopeRole(role: import("@roll/spec").AgentScopeRole): CastRoleName | undefined {
  switch (role) {
    case "execute":
      return "builder";
    case "evaluate":
      return "evaluator";
    case "supervise":
      return "designer";
    default:
      return undefined;
  }
}

/** Read the public pool declared for a cast role from the scoped config layers. */
function readCastPool(layers: readonly { config: AgentScopeConfig; path: string }[], role: CastRoleName): AgentName[] | null {
  const scopeRole: import("@roll/spec").AgentScopeRole =
    role === "builder" ? "execute" : role === "evaluator" ? "evaluate" : role === "designer" ? "supervise" : "execute";
  // Walk project/machine layers in reverse precedence looking for a select binding.
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (layer === undefined) continue;
    const binding = layer.config.roles[scopeRole] ?? layer.config.defaults.story?.roles[scopeRole];
    if (binding?.kind === "select") {
      const from = binding.from !== undefined && binding.from.length > 0 ? [...binding.from] : Object.keys(layer.config.agents) as AgentName[];
      return from;
    }
  }
  return null;
}

/** US-AGENT-049 — health-aware cast role route. */
export interface CastRoleRoute {
  readonly role: CastRoleName;
  readonly storyId: string | null;
  readonly candidates: readonly RankedRoleCandidate[];
  readonly selected: AgentName | null;
  readonly superviseAgent: AgentName | null;
}

function readRecentOutcomes(runtimeDir: string): Partial<Record<AgentName, ("success" | "failure" | "gave_up")[]>> {
  const out: Partial<Record<AgentName, ("success" | "failure" | "gave_up")[]>> = {};
  const path = join(runtimeDir, "runs.jsonl");
  if (!existsSync(path)) return out;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let row: { agent?: unknown; status?: unknown };
    try {
      row = JSON.parse(trimmed) as { agent?: unknown; status?: unknown };
    } catch {
      continue;
    }
    if (typeof row.agent !== "string" || typeof row.status !== "string") continue;
    const agent = canonicalAgentName(row.agent) as AgentName;
    if (!(AGENT_REGISTRY_NAMES as readonly string[]).includes(agent)) continue;
    const status = row.status;
    if (status !== "success" && status !== "failure" && status !== "gave_up") continue;
    const list = out[agent] ?? [];
    list.push(status);
    out[agent] = list;
  }
  return out;
}

function healthSignalsFromEvents(runtimeDir: string): Partial<Record<AgentName, AgentHealthSignal[]>> {
  const out: Partial<Record<AgentName, AgentHealthSignal[]>> = {};
  const eventsPath = join(runtimeDir, "events.ndjson");
  if (!existsSync(eventsPath)) return out;
  let text: string;
  try {
    text = readFileSync(eventsPath, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let ev: { type?: unknown; agent?: unknown; classification?: unknown; severity?: unknown; detail?: unknown; ts?: unknown };
    try {
      ev = JSON.parse(trimmed) as typeof ev;
    } catch {
      continue;
    }
    if (typeof ev.agent !== "string") continue;
    const agent = canonicalAgentName(ev.agent) as AgentName;
    if (!(AGENT_REGISTRY_NAMES as readonly string[]).includes(agent)) continue;

    if (ev.type === "agent:blocked" || ev.type === "agent:toolchain_issue") {
      const classification = typeof ev.classification === "string" ? ev.classification : "";
      const severity = ev.severity === "error" ? "error" : "warning";
      const status: AgentHealthSignal["status"] = severity === "error" ? "degraded" : "degraded";
      const reason: AgentHealthSignal["reason"] = classification.includes("auth")
        ? "auth"
        : classification.includes("network")
          ? "timeout"
          : classification.includes("parser")
            ? "parser"
            : "manual";
      const ts = typeof ev.ts === "number" ? ev.ts : Date.now();
      const signal: AgentHealthSignal = {
        agent,
        source: "cycle",
        status,
        reason,
        observedAt: new Date(ts).toISOString(),
      };
      const list = out[agent] ?? [];
      list.push(signal);
      out[agent] = list;
    }
  }
  return out;
}

/** Default capability profiles for the open pool (US-AGENT-049). */
export function defaultCapabilityProfiles(): NonNullable<import("@roll/spec").RoleCastRankingInput["profiles"]> {
  return {
    claude: { agent: "claude", canExecute: true, canReview: true, canScore: true, strengths: ["capable generalist"], knownShortcomings: ["high cost"], costBand: "high" },
    kimi: { agent: "kimi", canExecute: true, canReview: true, canScore: true, strengths: ["strong builder"], knownShortcomings: ["long cycles need tight scope"], costBand: "medium" },
    codex: { agent: "codex", canExecute: true, canReview: true, canScore: true, strengths: ["fresh-session capable"], knownShortcomings: [], costBand: "medium" },
    pi: { agent: "pi", canExecute: true, canReview: true, canScore: true, strengths: ["good evaluator/build candidate"], knownShortcomings: ["usage capture partial in older cycles"], costBand: "low" },
    reasonix: { agent: "reasonix", canExecute: true, canReview: true, canScore: true, strengths: ["cheap"], knownShortcomings: ["weaker Builder reliability on broad UI/workflow cards"], costBand: "low" },
    agy: { agent: "agy", canExecute: true, canReview: true, canScore: true, strengths: ["can build"], knownShortcomings: ["auth prompts in live cycles"], costBand: "medium" },
    cursor: { agent: "cursor", canExecute: true, canReview: true, canScore: true, strengths: ["Cursor adapter"], knownShortcomings: ["recently added to roster"], costBand: "medium" },
  };
}

/**
 * US-AGENT-049 — resolve a public cast role (designer/builder/evaluator/peer_reviewer)
 * using health-aware ranking over the open pool.
 *
 * Returns `null` when the role has no scoped pool configured.
 */
export function resolveCastRoleRoute(
  repoCwd: string,
  role: CastRoleName,
  storyId: string | null = null,
  deps: ScopedRouteDeps = {},
): CastRoleRoute | null {
  const rollHome = deps.rollHome ?? process.env["ROLL_HOME"] ?? join(homedir(), ".roll");
  const layers = [
    readScopedAgentLayer(join(rollHome, "agents.yaml")),
    readScopedAgentLayer(join(repoCwd, ".roll", "agents.yaml")),
  ].filter((layer): layer is { config: AgentScopeConfig; path: string } => layer !== null);
  if (layers.length === 0) return null;

  const pool = readCastPool(layers, role);
  if (pool === null || pool.length === 0) return null;

  const installed = deps.installed ?? new Set(agentsInstalled(realAgentEnv()).map((name) => canonicalAgentName(name)));
  const availablePool = pool.filter((a) => installed.has(a));
  if (availablePool.length === 0) {
    return { role, storyId, candidates: pool.map((agent) => ({ agent, eligible: false, score: 0, reasons: [], warnings: ["not installed"] })), selected: null, superviseAgent: null };
  }

  const runtimeDir = runtimeDirFor(repoCwd);
  const superviseResolution = resolveAgentScopeRole({ scope: "story", role: "supervise", layers, runtimeHealth: Object.fromEntries(
    AGENT_REGISTRY_NAMES.map((agent) => [agent, installed.has(agent) ? { available: true } : { available: false, reason: "not-installed" }]),
  ) as Partial<Record<AgentName, { available: boolean; reason?: string }>> });
  const superviseAgent = superviseResolution.ok ? superviseResolution.resolved.agent : null;

  const candidates = rankRoleCandidates({
    role,
    pool: availablePool,
    profiles: defaultCapabilityProfiles(),
    health: healthSignalsFromEvents(runtimeDir),
    recentOutcomes: readRecentOutcomes(runtimeDir),
  });

  // A Builder cannot satisfy its own Evaluator gate through the same session.
  // Same-brand independent sessions are allowed by the ranker; this only blocks
  // the exact same session identity being cast into both roles.
  const selected = candidates.find((c) => {
    if (!c.eligible) return false;
    if (role === "evaluator" && c.agent === superviseAgent) return false;
    return true;
  }) ?? null;

  return { role, storyId, candidates, selected: selected?.agent ?? null, superviseAgent };
}

/** JSON-friendly trace for a cast role route. */
export interface CastRoleRouteTrace {
  readonly role: CastRoleName;
  readonly storyId: string | null;
  readonly candidates: readonly RankedRoleCandidate[];
  readonly selected: AgentName | null;
  readonly supervise: AgentName | null;
}

export function castRoleRouteTrace(route: CastRoleRoute): CastRoleRouteTrace {
  return {
    role: route.role,
    storyId: route.storyId,
    candidates: route.candidates,
    selected: route.selected,
    supervise: route.superviseAgent,
  };
}

export function renderCastRoleRoute(trace: CastRoleRouteTrace): string {
  const lines: string[] = ["", `  ${trace.role} candidates:`];
  for (const c of trace.candidates) {
    const status = c.eligible ? "eligible" : "not eligible";
    const reasons = c.reasons.length > 0 ? c.reasons.join(" · ") : "no positive signals";
    const warnings = c.warnings.length > 0 ? c.warnings.join(" · ") : "";
    const suffix = warnings ? ` · ${warnings}` : "";
    lines.push(`    ${c.agent.padEnd(9)} score ${String(c.score).padStart(3)}  ${status} · ${reasons}${suffix}`);
  }
  lines.push(`  selected: ${trace.selected ?? "(none eligible)"}`);
  lines.push("");
  return lines.join("\n");
}

/** Human-readable Builder route trace for `roll supervisor route`. */
export function renderScopedExecuteRoute(trace: ScopedExecuteRouteTrace): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("  Builder route — story.execute");
  lines.push(`  source: ${trace.source ?? "(none)"}`);
  lines.push(`  Prime (supervise): ${trace.supervise ?? "(unassigned)"}`);
  lines.push(`  strategy: ${trace.strategy}`);
  lines.push(`  candidates: ${trace.candidates.length > 0 ? trace.candidates.join(", ") : "(none)"}`);
  if (trace.skipped.length > 0) {
    lines.push("  skipped:");
    for (const s of trace.skipped) lines.push(`    ${s.agent} — ${s.reason}`);
  } else {
    lines.push("  skipped: (none)");
  }
  lines.push(`  selected: ${trace.selected ?? `(none — ${trace.error ?? "unresolved"})`}`);
  lines.push("");
  return lines.join("\n");
}
