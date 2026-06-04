/** Ported-command registry — one line per migrated subcommand. */
import { fallbackToBash, registerPorted } from "../bridge.js";
import { agentListCommand } from "./agent-list.js";
import { CONFIG_FACADE_KEYS, configGetCommand } from "./config-get.js";
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
  // `config` read surface is TS; facades and writes stay on bash.
  registerPorted("config", (args) => {
    const flags = new Set(["--list", "--global", "--project", "--help", "-h"]);
    const positionals = args.filter((a) => !flags.has(a));
    const key = positionals[0] ?? "";
    if (CONFIG_FACADE_KEYS.includes(key) || positionals.length >= 2) {
      return fallbackToBash(["config", ...args]).status;
    }
    return configGetCommand(args);
  });
}
