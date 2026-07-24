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
