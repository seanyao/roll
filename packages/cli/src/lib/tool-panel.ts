/**
 * US-TOOL-016 — the machine-global "tools on this machine" collector. One row
 * per built-in tool adapter declaration, summarizing its capabilities and
 * default guardrails. This is the single source the Tools page (US-TOOL-017)
 * renders from, exactly as the Skills page reads `auditSkills` and the Agents
 * page reads `collectAgentPanel`: the catalog can never disagree with the
 * actually-registered adapters because it maps over `builtinToolDeclarations()`.
 *
 * Machine-global → takes no project argument; the built-in catalog is identical
 * on every machine. Pure + deterministic (no clock, no RNG, no network): the
 * same machine always renders byte-identical rows.
 */
import { builtinToolDeclarations } from "@roll/infra";
import type { ToolDeclaration, ToolDefaults, ToolKind, ToolRequirement, ToolSandbox } from "@roll/spec";

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
}

/**
 * Map every built-in tool declaration → a panel row. Pure over
 * `builtinToolDeclarations()`, so order is the same deterministic `(kind, id)`.
 */
export function collectToolPanel(): ToolPanelRow[] {
  return builtinToolDeclarations().map(toRow);
}

function toRow(declaration: ToolDeclaration): ToolPanelRow {
  return {
    id: String(declaration.id),
    kind: declaration.kind,
    title: declaration.title,
    description: declaration.description ?? "",
    emitsEvents: declaration.emitsEvents ?? false,
    guardrails: guardrailsOf(declaration.defaults),
    requirements: (declaration.requirements ?? []).map(requirementLabel),
  };
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

/** "git", "playwright-or-chrome (optional)", "OPENAI_API_KEY (env)", … */
function requirementLabel(requirement: ToolRequirement): string {
  const suffix = requirement.optional === true ? " (optional)" : "";
  if (requirement.kind === "executable") return `${requirement.name}${suffix}`;
  if (requirement.kind === "env") return `${requirement.name} (env)${suffix}`;
  return `${requirement.name} (service)${suffix}`;
}
