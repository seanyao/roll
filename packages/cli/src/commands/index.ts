/** Ported-command registry — one line per migrated subcommand. */
import { fallbackToBash, registerPorted } from "../bridge.js";
import { agentListCommand } from "./agent-list.js";
import { statusCommand } from "./status.js";

let registered = false;

export function registerAll(): void {
  if (registered) return;
  registered = true;
  registerPorted("status", statusCommand);
  // `agent` routes per-subcommand: only `list` is ported so far.
  registerPorted("agent", (args) => {
    if (args[0] === "list") return agentListCommand(args.slice(1));
    return fallbackToBash(["agent", ...args]).status;
  });
}
