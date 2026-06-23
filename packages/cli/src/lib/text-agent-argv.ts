/**
 * Text-mode agent argv: map an agent name + prompt to the `{ bin, args }` that
 * launches it in one-shot "print the answer" mode. Shared by the loop's PR-heal
 * worktree agent and any other non-interactive text spawn. Returns null for an
 * unknown agent (caller decides the fallback).
 */
import { onPath } from "../commands/setup-shared.js";

export function textAgentArgv(agent: string, prompt: string): { bin: string; args: string[] } | null {
  switch (agent) {
    case "claude":
      return { bin: "claude", args: ["-p", "--output-format", "text", prompt] };
    case "kimi": {
      const bin = onPath("kimi-code") ? "kimi-code" : onPath("kimi-cli") ? "kimi-cli" : "kimi";
      return { bin, args: ["-p", prompt] };
    }
    case "deepseek":
      return { bin: "deepseek", args: [prompt] };
    case "pi":
      return { bin: "pi", args: ["-p", prompt] };
    case "reasonix":
      return { bin: "reasonix", args: ["run", "--max-steps", "1000", prompt] };
    case "opencode":
      return { bin: "opencode", args: ["run", prompt] };
    default:
      return null;
  }
}

export function textAgentCommandFamily(agent: string): string | undefined {
  return textAgentArgv(agent, "")?.bin;
}
