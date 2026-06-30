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
  resolveAgentScopeRole,
} from "@roll/core";
import type {
  AgentName,
  AgentScopeConfig,
  AgentScopeRoleResolution,
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
  const resolution = resolveAgentScopeRole({
    scope: "story",
    role: "execute",
    layers,
    runtimeHealth,
    recentUse,
    ...(superviseAgent !== null ? { assignedRoles: { supervise: superviseAgent } } : {}),
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
