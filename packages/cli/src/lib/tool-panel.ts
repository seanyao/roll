/**
 * US-TOOL-016 — the machine-global "tools on this machine" collector. One row
 * per built-in tool adapter declaration, summarizing its capabilities and
 * default guardrails. This is the single source the Tools page (US-TOOL-017)
 * renders from, exactly as the Skills page reads `auditSkills` and the Agents
 * page reads `collectAgentPanel`: the catalog can never disagree with the
 * actually-registered adapters because it maps over `builtinToolDeclarations()`.
 *
 * Machine-global → takes no project argument. The built-in catalog is stable,
 * while requirement readiness reflects this host's dependency state.
 */
import { builtinToolDeclarations } from "@roll/infra";
import type { ToolDeclaration, ToolDefaults, ToolKind, ToolRequirement, ToolSandbox } from "@roll/spec";
import { resolveRequirement } from "./external-tools.js";

export interface ToolPanelGuardrails {
  timeoutMs?: number;
  /** defaults.retry?.attempts — omitted when the declaration sets no retry. */
  retries?: number;
  /** A human label derived from defaults.sandbox — omitted when none. */
  sandbox?: string;
  maxPerCycle?: number;
}

export interface ToolPanelRow {
  id: string;
  kind: ToolKind;
  title: string;
  /** declaration.description ?? "" */
  description: string;
  /** declaration.emitsEvents ?? false */
  emitsEvents: boolean;
  /** Summarized from declaration.defaults (ToolDefaults); unset sub-fields omitted. */
  guardrails: ToolPanelGuardrails;
  /** declaration.requirements mapped to human labels; [] when none. */
  requirements: string[];
  /**
   * FIX-394 AC6 — a tool whose host dependency is absent is marked unavailable
   * rather than silently shown as ready. The caller (tool display / dossier
   * renderer) should degrade the row (icon, label) when this is false.
   */
  available: boolean;
  /** Human reason for unavailable — may be '' when available. */
  unavailableReason: string;
}

/**
 * Map every built-in tool declaration → a panel row. Order is deterministic
 * `(kind, id)`; availability comes from the requirement resolver.
 */
export function collectToolPanel(): ToolPanelRow[] {
  return builtinToolDeclarations().map(toRow);
}

function toRow(declaration: ToolDeclaration): ToolPanelRow {
  const avail = toolAvailability(declaration);
  return {
    id: String(declaration.id),
    kind: declaration.kind,
    title: declaration.title,
    description: declaration.description ?? "",
    emitsEvents: declaration.emitsEvents ?? false,
    guardrails: guardrailsOf(declaration.defaults),
    requirements: (declaration.requirements ?? []).map(requirementLabel),
    available: avail.ok,
    unavailableReason: avail.reason,
  };
}

/** FIX-394 AC6 — check whether the host dependency for a built-in tool is present. */
function toolAvailability(declaration: ToolDeclaration): { ok: boolean; reason: string } {
  const required = (declaration.requirements ?? []).filter((requirement) => requirement.optional !== true);
  const requiredFailure = required.map((requirement) => resolveRequirement(requirement)).find((resolution) => resolution.status !== "ok");
  if (requiredFailure !== undefined) return { ok: false, reason: requiredFailure.detail };

  const optionalFailure = (declaration.requirements ?? [])
    .filter((requirement) => requirement.optional === true)
    .map((requirement) => resolveRequirement(requirement))
    .find((resolution) => resolution.status !== "ok");
  if (optionalFailure !== undefined && declaration.kind === "browser") {
    const repair = optionalFailure.repair?.command;
    const suffix = repair === undefined ? "" : ` — run \`${repair}\``;
    return { ok: false, reason: `${optionalFailure.detail}${suffix}` };
  }
  return { ok: true, reason: "" };
}

function guardrailsOf(defaults: ToolDefaults | undefined): ToolPanelGuardrails {
  // No defaults → empty guardrails (the page shows "default policy").
  if (defaults === undefined) return {};
  const sandbox = sandboxLabel(defaults.sandbox);
  return {
    ...(defaults.timeoutMs !== undefined ? { timeoutMs: defaults.timeoutMs } : {}),
    ...(defaults.retry !== undefined ? { retries: defaults.retry.attempts } : {}),
    ...(sandbox !== undefined ? { sandbox } : {}),
    ...(defaults.maxInvocationsPerCycle !== undefined ? { maxPerCycle: defaults.maxInvocationsPerCycle } : {}),
  };
}

/**
 * Derive a deterministic, human-readable label from the sandbox object's most
 * distinguishing field. Returns undefined when the declaration leaves sandbox
 * unset (the page renders "—" / skips it).
 */
function sandboxLabel(sandbox: ToolSandbox | undefined): string | undefined {
  if (sandbox === undefined) return undefined;
  if (sandbox.network !== undefined) return `network:${sandbox.network}`;
  if (sandbox.headlessOnly === true) return "headless";
  if (sandbox.allowedPaths !== undefined && sandbox.allowedPaths.length > 0) return "workspace";
  if (sandbox.maxOutputBytes !== undefined) return "bounded-output";
  return "workspace";
}

/** "git", "playwright-chromium (optional)", "OPENAI_API_KEY (env)", … */
function requirementLabel(requirement: ToolRequirement): string {
  const suffix = requirement.optional === true ? " (optional)" : "";
  if (requirement.kind === "executable") return `${requirement.name}${suffix}`;
  if (requirement.kind === "env") return `${requirement.name} (env)${suffix}`;
  return `${requirement.name} (service)${suffix}`;
}
