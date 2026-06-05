/** Ported-command registry — one line per migrated subcommand. */
import { fallbackToBash, registerPorted } from "../bridge.js";
import { agentListCommand } from "./agent-list.js";
import { BACKLOG_MGMT_SUBCOMMANDS, backlogCommand } from "./backlog.js";
import { CONFIG_FACADE_KEYS, configGetCommand } from "./config-get.js";
import { dashboardCommand } from "./dashboard.js";
import { langCommand } from "./lang.js";
import { loopRunOnceCommand } from "./loop-run-once.js";
import { pricesCommand } from "./prices.js";
import { statusCommand } from "./status.js";

let registered = false;

export function registerAll(): void {
  if (registered) return;
  registered = true;
  registerPorted("status", statusCommand);
  // `lang`: show/set/reset/invalid all TS (full surface ported).
  registerPorted("lang", langCommand);
  // `agent` routes per-subcommand: only `list` is ported so far.
  registerPorted("agent", (args) => {
    if (args[0] === "list") return agentListCommand(args.slice(1));
    return fallbackToBash(["agent", ...args]).status;
  });
  // `backlog` display is TS; management subcommands (writes) stay on bash.
  registerPorted("backlog", (args) => {
    if (args[0] !== undefined && BACKLOG_MGMT_SUBCOMMANDS.includes(args[0])) {
      return fallbackToBash(["backlog", ...args]).status;
    }
    return backlogCommand(args);
  });
  // `prices`: show/help/unknown are TS; `refresh` (network write) is bash.
  registerPorted("prices", (args) => {
    const r = pricesCommand(args);
    return r ?? fallbackToBash(["prices", ...args]).status;
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
  // `loop status` + `loop run-once` are TS; every other loop subcommand falls
  // back to bash. `run-once` is the v3 single-cycle runner adapter (US-LOOP-006
  // prerequisite); --dry-run prints the command plan without executing.
  registerPorted("loop", (args) => {
    if (args[0] === "status") return dashboardCommand(args.slice(1));
    if (args[0] === "run-once") return loopRunOnceCommand(args.slice(1));
    return fallbackToBash(["loop", ...args]).status;
  });
}
