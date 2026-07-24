export interface WorkspaceInteractionCapabilities {
  readonly stdinTTY: boolean;
  readonly stderrTTY: boolean;
  readonly agentQuestionCapable: boolean;
}

export type WorkspaceInteractionModeDecision =
  | {
      readonly ok: true;
      readonly mode: "interactive" | "non_interactive";
      readonly args: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: "interaction_unavailable";
      readonly args: readonly string[];
    };

function removeInteractionFlags(args: readonly string[]): {
  readonly args: readonly string[];
  readonly noInput: boolean;
  readonly interactive: boolean;
} {
  const remaining: string[] = [];
  let noInput = false;
  let interactive = false;
  let optionsEnded = false;
  for (const arg of args) {
    if (optionsEnded) {
      remaining.push(arg);
      continue;
    }
    if (arg === "--") {
      optionsEnded = true;
      remaining.push(arg);
      continue;
    }
    if (arg === "--no-input") {
      noInput = true;
      continue;
    }
    if (arg === "--interactive") {
      interactive = true;
      continue;
    }
    remaining.push(arg);
  }
  return { args: remaining, noInput, interactive };
}

/**
 * Resolve whether the host can ask a Workspace clarification question.
 * Output format flags (including --json) are deliberately left untouched.
 */
export function parseWorkspaceInteractionArgs(
  args: readonly string[],
  capabilities: WorkspaceInteractionCapabilities,
): WorkspaceInteractionModeDecision {
  const parsed = removeInteractionFlags(args);
  if (parsed.noInput) {
    return { ok: true, mode: "non_interactive", args: parsed.args };
  }
  const capable = capabilities.agentQuestionCapable ||
    (capabilities.stdinTTY && capabilities.stderrTTY);
  if (parsed.interactive && !capable) {
    return { ok: false, code: "interaction_unavailable", args: parsed.args };
  }
  return {
    ok: true,
    mode: capable ? "interactive" : "non_interactive",
    args: parsed.args,
  };
}

function requirementSummary(handoff: WorkspaceClarificationHandoffV1): string {
  const sources = handoff.requirementSummary.sources.map((source) => `${source.provider}:${source.ref}`);
  const facts = [...sources, ...handoff.requirementSummary.storyIds];
  if (facts.length > 0) return facts.join(", ");
  return handoff.requirementSummary.hasSemanticOnlyEvidence
    ? "semantic-only requirement evidence"
    : "the current requirement";
}

function evidenceSummary(candidate: WorkspaceClarificationHandoffV1["candidates"][number]): string {
  if (candidate.evidence.length === 0) return "no hard requirement evidence";
  return candidate.evidence
    .map((evidence) => `${evidence.kind} ${evidence.value} (${evidence.provenance})`)
    .join(", ");
}

function diagnosticSummary(candidate: WorkspaceClarificationHandoffV1["candidates"][number]): string {
  if (candidate.diagnostics.length === 0) return "none";
  return candidate.diagnostics
    .map((diagnostic) => `${diagnostic.code} at ${diagnostic.authorityPath}`)
    .join(", ");
}

/** Render the direct CLI question from the same closed handoff the agent host uses. */
export function renderDirectWorkspaceClarificationPrompt(
  handoff: WorkspaceClarificationHandoffV1,
): string {
  const lines = [
    `Workspace requirement ${requirementSummary(handoff)} needs clarification because ${handoff.reason}.`,
    "Choose an explicit action; candidate order is never an automatic selection.",
    "",
  ];
  handoff.candidates.forEach((candidate, index) => {
    lines.push(
      `  ${index + 1}) ${candidate.displayName} (${candidate.lifecycle}) — ${evidenceSummary(candidate)}; diagnostics: ${diagnosticSummary(candidate)}`,
    );
  });
  if (handoff.allowedActions.includes("create_new")) {
    lines.push(`  create) create a new Workspace (preview only: ${handoff.canonicalCreateCommand} ... --check)`);
  }
  if (handoff.allowedActions.includes("repair_discovery")) {
    lines.push("  repair) show canonical Workspace repair commands");
  }
  lines.push("  cancel) stop without selecting or mutating a Workspace", "", "Selection: ");
  return lines.join("\n");
}

function parsedAnswer(
  handoff: WorkspaceClarificationHandoffV1,
  value: string,
): WorkspaceClarificationAnswerV1 | "cancelled" | undefined {
  const answer = value.trim();
  if (/^(?:q|quit|cancel)$/iu.test(answer)) return "cancelled";
  if (/^(?:c|create)$/iu.test(answer)) return { action: "create_new" };
  if (/^(?:r|repair)$/iu.test(answer)) return { action: "repair_discovery" };
  const numeric = Number(answer);
  if (Number.isSafeInteger(numeric) && numeric >= 1 && numeric <= handoff.candidates.length) {
    const candidate = handoff.candidates[numeric - 1];
    return candidate === undefined
      ? undefined
      : { action: "select_existing", workspaceId: candidate.workspaceId };
  }
  const candidate = handoff.candidates.find((entry) => entry.workspaceId === answer);
  return candidate === undefined
    ? undefined
    : { action: "select_existing", workspaceId: candidate.workspaceId };
}

export type DirectWorkspaceClarificationAnswer<T> =
  | { readonly kind: "selected"; readonly canonicalSelector: string; readonly result: T }
  | {
      readonly kind: "create";
      readonly nextAction: "roll workspace create <ID> --config <path> --check";
      readonly applyAuthorized: false;
    }
  | { readonly kind: "repair"; readonly commands: readonly string[] }
  | { readonly kind: "cancelled"; readonly code: "workspace_clarification_cancelled" }
  | { readonly kind: "invalid"; readonly code: "invalid_workspace_clarification"; readonly reload: true };

/** Validate one direct answer against fresh discovery facts before continuing. */
export function answerDirectWorkspaceClarification<T>(input: {
  readonly handoff: WorkspaceClarificationHandoffV1;
  readonly answer: string | null;
  readonly currentDiscovery: {
    readonly registryRevision: number;
    readonly discoveryFactsSha256: string;
  };
  readonly rerunResolver: (workspaceId: string) => T;
}): DirectWorkspaceClarificationAnswer<T> {
  if (input.answer === null) {
    return { kind: "cancelled", code: "workspace_clarification_cancelled" };
  }
  const answer = parsedAnswer(input.handoff, input.answer);
  if (answer === "cancelled") {
    return { kind: "cancelled", code: "workspace_clarification_cancelled" };
  }
  const resolution = resolveWorkspaceClarificationAnswer({
    handoff: input.handoff,
    answer,
    currentRegistryRevision: input.currentDiscovery.registryRevision,
    currentDiscoveryFactsSha256: input.currentDiscovery.discoveryFactsSha256,
  });
  if (!resolution.ok) {
    return { kind: "invalid", code: resolution.code, reload: true };
  }
  switch (resolution.action) {
    case "retry_resolution":
      return {
        kind: "selected",
        canonicalSelector: resolution.canonicalSelector,
        result: input.rerunResolver(resolution.explicitSelector.workspaceId),
      };
    case "start_create_preview":
      return {
        kind: "create",
        nextAction: "roll workspace create <ID> --config <path> --check",
        applyAuthorized: false,
      };
    case "show_repair_actions":
      return { kind: "repair", commands: resolution.commands };
  }
}
import { resolveWorkspaceClarificationAnswer } from "@roll/core";
import type {
  WorkspaceClarificationAnswerV1,
  WorkspaceClarificationHandoffV1,
} from "@roll/spec";
