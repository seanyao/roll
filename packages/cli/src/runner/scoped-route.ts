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
  AgentCapabilityProfile,
  AgentHealthSignal,
  AgentName,
  AgentScopeConfig,
  AgentScopeRole,
  AgentScopeRoleResolution,
  CastRoleName,
  RankedRoleCandidate,
} from "@roll/spec";
import { realAgentEnv } from "../commands/agent-list.js";

export interface ScopedExecuteRoute {
  readonly resolution: AgentScopeRoleResolution;
  readonly castRole: CastRoleName;
  readonly scopeRole: AgentScopeRole;
  /** The active Prime (`supervise`) agent honored by `avoid: [supervise]`, if any. */
  readonly superviseAgent: AgentName | null;
  /** Recent-use input handed to the `least-recent` strategy (epoch ms per agent). */
  readonly recentUse: Readonly<Partial<Record<AgentName, number>>>;
  readonly successfulDeliveries: Readonly<Partial<Record<AgentName, number>>>;
  readonly ranked: readonly RankedRoleCandidate[];
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

interface RuntimeRunRow {
  readonly agent: AgentName;
  readonly ts?: string;
  readonly status?: string;
}

function readRuntimeRunRows(runtimeDir: string): RuntimeRunRow[] {
  const path = join(runtimeDir, "runs.jsonl");
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: RuntimeRunRow[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let row: { readonly agent?: unknown; readonly ts?: unknown; readonly status?: unknown };
    try {
      row = JSON.parse(trimmed) as { readonly agent?: unknown; readonly ts?: unknown; readonly status?: unknown };
    } catch {
      continue;
    }
    if (typeof row.agent !== "string") continue;
    const agent = canonicalAgentName(row.agent) as AgentName;
    if (!(AGENT_REGISTRY_NAMES as readonly string[]).includes(agent)) continue;
    out.push({
      agent,
      ...(typeof row.ts === "string" ? { ts: row.ts } : {}),
      ...(typeof row.status === "string" ? { status: row.status } : {}),
    });
  }
  return out;
}

/**
 * Map each agent to the epoch ms of its most recent Builder run (from
 * runs.jsonl). Larger = more recently used; absent agents are "never used" and
 * the `least-recent` strategy schedules them first. Best-effort: any IO/parse
 * failure yields an empty map (degenerate but deterministic least-recent).
 */
function readRecentUse(runtimeDir: string): Partial<Record<AgentName, number>> {
  const out: Partial<Record<AgentName, number>> = {};
  for (const row of readRuntimeRunRows(runtimeDir)) {
    if (row.ts === undefined) continue;
    const when = Date.parse(row.ts);
    if (Number.isNaN(when)) continue;
    const prev = out[row.agent];
    if (prev === undefined || when > prev) out[row.agent] = when;
  }
  return out;
}

const SUCCESSFUL_RUN_STATUSES = new Set(["built", "delivered", "done", "published", "success", "merged"]);

function readSuccessfulDeliveries(runtimeDir: string): Partial<Record<AgentName, number>> {
  const out: Partial<Record<AgentName, number>> = {};
  for (const row of readRuntimeRunRows(runtimeDir)) {
    if (row.status === undefined || !SUCCESSFUL_RUN_STATUSES.has(row.status)) continue;
    out[row.agent] = (out[row.agent] ?? 0) + 1;
  }
  return out;
}

function parseHealthSignal(raw: unknown): AgentHealthSignal | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Partial<Record<keyof AgentHealthSignal, unknown>>;
  if (typeof row.agent !== "string" || !(AGENT_REGISTRY_NAMES as readonly string[]).includes(row.agent)) return null;
  if (row.source !== "cycle" && row.source !== "pair" && row.source !== "score" && row.source !== "probe" && row.source !== "manual") return null;
  if (row.status !== "healthy" && row.status !== "degraded" && row.status !== "blocked" && row.status !== "unknown") return null;
  if (typeof row.observedAt !== "string") return null;
  const reason = row.reason === "auth" || row.reason === "timeout" || row.reason === "parser" || row.reason === "no_tcr" || row.reason === "publish" || row.reason === "cost" || row.reason === "manual"
    ? row.reason
    : undefined;
  return {
    agent: row.agent as AgentName,
    source: row.source,
    status: row.status,
    ...(reason !== undefined ? { reason } : {}),
    observedAt: row.observedAt,
    ...(typeof row.expiresAt === "string" ? { expiresAt: row.expiresAt } : {}),
  };
}

function readHealthSignals(runtimeDir: string): AgentHealthSignal[] {
  const path = join(runtimeDir, "agent-health.jsonl");
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: AgentHealthSignal[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed = parseHealthSignal(JSON.parse(trimmed) as unknown);
      if (parsed !== null) out.push(parsed);
    } catch {
      continue;
    }
  }
  return out;
}

function roleToScopeRole(role: CastRoleName): AgentScopeRole {
  return role === "evaluator" || role === "peer_reviewer" ? "evaluate" : "execute";
}

function declaredCapabilities(layers: readonly { config: AgentScopeConfig; path: string }[]): Map<AgentName, readonly AgentScopeRole[]> {
  const out = new Map<AgentName, readonly AgentScopeRole[]>();
  for (const layer of layers) {
    for (const [agent, spec] of Object.entries(layer.config.agents) as [AgentName, NonNullable<AgentScopeConfig["agents"][AgentName]>][]) {
      out.set(agent, spec.capabilities);
    }
  }
  return out;
}

function defaultCostBand(agent: AgentName): AgentCapabilityProfile["costBand"] {
  if (agent === "reasonix") return "low";
  if (agent === "claude") return "high";
  if (agent === "agy") return "unknown";
  return "medium";
}

function profileFor(agent: AgentName, capabilities: readonly AgentScopeRole[]): AgentCapabilityProfile {
  const canExecute = capabilities.includes("execute");
  const canReview = capabilities.includes("evaluate");
  const strengths = agent === "reasonix" ? ["focused fixes"] : canExecute ? ["execute"] : canReview ? ["evaluate"] : [];
  const knownShortcomings = agent === "reasonix" ? ["weaker broad builder"] : [];
  return {
    agent,
    canExecute,
    canReview,
    canScore: canReview,
    strengths,
    knownShortcomings,
    costBand: defaultCostBand(agent),
  };
}

function skippedCandidates(resolution: AgentScopeRoleResolution): ReadonlyMap<AgentName, string> {
  const skipped = resolution.ok ? resolution.resolved.skipped : resolution.failure.skipped;
  return new Map(skipped.map((row) => [row.agent, row.reason]));
}

function rankedWithResolutionSkips(ranked: readonly RankedRoleCandidate[], resolution: AgentScopeRoleResolution): RankedRoleCandidate[] {
  const skipped = skippedCandidates(resolution);
  return ranked
    .map((candidate) => {
      const reason = skipped.get(candidate.agent);
      if (reason === undefined) return candidate;
      return {
        ...candidate,
        eligible: false,
        score: 0,
        reasons: [...candidate.reasons, `skipped:${reason}`],
      };
    })
    .sort((a, b) => b.score - a.score || Number(b.eligible) - Number(a.eligible) || a.agent.localeCompare(b.agent));
}

/** Test seams; production reads the real ROLL_HOME, installed agents, and runs.jsonl. */
export interface ScopedRouteDeps {
  readonly rollHome?: string;
  readonly installed?: ReadonlySet<string>;
  readonly recentUse?: Readonly<Partial<Record<AgentName, number>>>;
  readonly successfulDeliveries?: Readonly<Partial<Record<AgentName, number>>>;
  readonly healthSignals?: readonly AgentHealthSignal[];
}

/**
 * Resolve the scoped Builder (`story.execute`) assignment, honoring the active
 * Prime binding and recent-use fairness. Returns `null` when no scoped layer is
 * present (the caller falls back to legacy tier routing).
 */
export function resolveScopedStoryExecute(repoCwd: string, deps: ScopedRouteDeps = {}): ScopedExecuteRoute | null {
  return resolveScopedCastRole(repoCwd, "builder", deps);
}

export function resolveScopedCastRole(repoCwd: string, castRole: CastRoleName, deps: ScopedRouteDeps = {}): ScopedExecuteRoute | null {
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

  const runtimeDir = runtimeDirFor(repoCwd);
  const recentUse = deps.recentUse ?? readRecentUse(runtimeDir);
  const successfulDeliveries = deps.successfulDeliveries ?? readSuccessfulDeliveries(runtimeDir);
  const healthSignals = deps.healthSignals ?? readHealthSignals(runtimeDir);
  const scopeRole = roleToScopeRole(castRole);
  const resolution = resolveAgentScopeRole({
    scope: "story",
    role: scopeRole,
    layers,
    runtimeHealth,
    recentUse,
    healthSignals,
    ...(superviseAgent !== null ? { assignedRoles: { supervise: superviseAgent } } : {}),
  });
  const caps = declaredCapabilities(layers);
  const candidates = resolution.ok ? resolution.resolved.candidates : resolution.failure.candidates;
  const profiles = candidates.map((agent) => profileFor(agent, caps.get(agent) ?? []));
  const ranked = rankedWithResolutionSkips(rankRoleCandidates({ role: castRole, profiles, healthSignals, recentUse, successfulDeliveries }), resolution);
  return { resolution, castRole, scopeRole, superviseAgent, recentUse, successfulDeliveries, ranked };
}

/** The auditable role route trace surfaced by the diagnostic command. */
export interface ScopedExecuteRouteTrace {
  readonly role: AgentScopeRole;
  readonly castRole: CastRoleName;
  readonly candidates: readonly AgentName[];
  readonly skipped: readonly { readonly agent: AgentName; readonly reason: string }[];
  readonly ranked: readonly RankedRoleCandidate[];
  readonly strategy: string;
  readonly selected: AgentName | null;
  readonly source: string | null;
  readonly supervise: AgentName | null;
  readonly recentUse: Readonly<Partial<Record<AgentName, number>>>;
  readonly successfulDeliveries: Readonly<Partial<Record<AgentName, number>>>;
  readonly error: string | null;
}

/** Project the resolution into the stable trace shape (JSON-friendly, total). */
export function scopedExecuteRouteTrace(route: ScopedExecuteRoute): ScopedExecuteRouteTrace {
  const { resolution, superviseAgent, recentUse, successfulDeliveries, ranked } = route;
  if (resolution.ok) {
    const r = resolution.resolved;
    return {
      role: route.scopeRole,
      castRole: route.castRole,
      candidates: r.candidates,
      skipped: r.skipped.map((s) => ({ agent: s.agent, reason: s.reason })),
      ranked,
      strategy: r.selectedStrategy,
      selected: r.agent,
      source: r.source,
      supervise: superviseAgent,
      recentUse,
      successfulDeliveries,
      error: null,
    };
  }
  const f = resolution.failure;
  return {
    role: route.scopeRole,
    castRole: route.castRole,
    candidates: f.candidates,
    skipped: f.skipped.map((s) => ({ agent: s.agent, reason: s.reason })),
    ranked,
    strategy: "none",
    selected: null,
    source: f.source ?? null,
    supervise: superviseAgent,
    recentUse,
    successfulDeliveries,
    error: f.errors[0] ?? "story.execute unresolved",
  };
}

/** Human-readable role route trace for `roll supervisor route`. */
export function renderScopedExecuteRoute(trace: ScopedExecuteRouteTrace): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${trace.castRole} route — story.${trace.role}`);
  lines.push(`  source: ${trace.source ?? "(none)"}`);
  lines.push(`  Prime (supervise): ${trace.supervise ?? "(unassigned)"}`);
  lines.push(`  strategy: ${trace.strategy}`);
  lines.push(`  candidates: ${trace.candidates.length > 0 ? trace.candidates.join(", ") : "(none)"}`);
  if (trace.ranked.length > 0) {
    lines.push("  ranked:");
    for (const candidate of trace.ranked) {
      const warnings = candidate.warnings.length > 0 ? ` · warnings=${candidate.warnings.join("; ")}` : "";
      lines.push(`    ${candidate.agent} score=${candidate.score} eligible=${candidate.eligible} · ${candidate.reasons.join(" · ")}${warnings}`);
    }
  }
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
