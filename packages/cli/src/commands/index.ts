/** Ported-command registry — one line per migrated subcommand. */
import { fallbackToBash, registerPorted } from "../bridge.js";
import { agentListCommand } from "./agent-list.js";
import { alertCommand } from "./alert.js";
import { BACKLOG_MGMT_SUBCOMMANDS, backlogCommand } from "./backlog.js";
import { changelogCommand } from "./changelog.js";
import { CONFIG_FACADE_KEYS, configGetCommand } from "./config-get.js";
import { consistencyCommand } from "./consistency.js";
import { dashboardCommand } from "./dashboard.js";
import { doctorCommand } from "./doctor.js";
import { feedbackCommand } from "./feedback.js";
import { langCommand } from "./lang.js";
import { loopRunOnceCommand } from "./loop-run-once.js";
import { migrateCommand } from "./migrate.js";
import { offboardCommand } from "./offboard.js";
import { pricesCommand } from "./prices.js";
import { skillsCommand } from "./skills.js";
import { statusCommand } from "./status.js";

let registered = false;

export function registerAll(): void {
  if (registered) return;
  registered = true;
  registerPorted("status", statusCommand);
  // `lang`: show/set/reset/invalid all TS (full surface ported).
  registerPorted("lang", langCommand);
  // `skills`: generate/check/help/unknown all TS (full surface ported).
  registerPorted("skills", skillsCommand);
  // `alert`: list/ack/resolve/clear/log/unknown all TS (full surface ported).
  registerPorted("alert", alertCommand);
  // `doctor`: all four health sections ported TS (agent/pr/skills/launchd).
  registerPorted("doctor", doctorCommand);
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
  // `changelog`: the DETERMINISTIC paths are TS (generate --no-ai / --json,
  // --write of the deterministic draft, help, unknown). The default `generate`
  // (without --no-ai/--json) attempts the live AI-style agent in v2 — a path
  // that must NOT run an agent from TS — so it FALLS BACK to bash, preserving
  // v2's agent-styling behavior exactly. (changelog.ts keeps an injectable,
  // default-off styler used only by difftests; see its header.)
  registerPorted("changelog", (args) => {
    if (args[0] === "generate") {
      const flags = args.slice(1);
      const deterministic = flags.includes("--no-ai") || flags.includes("--json");
      if (!deterministic) return fallbackToBash(["changelog", ...args]).status;
    }
    return changelogCommand(args);
  });
  // `consistency`: check/--json/--project-dir + help + unknown all TS (full
  // surface ported; the python orchestrator is reimplemented byte-for-byte).
  registerPorted("consistency", consistencyCommand);
  // `feedback`: full surface TS (arg parse, repo resolution, env block,
  // print-url + gh issue create). No sub-paths left on bash.
  registerPorted("feedback", feedbackCommand);
  // `migrate`: full surface TS (three-state idempotency, dry-run preview,
  // git-mv execute with the single atomic commit). No sub-paths on bash.
  registerPorted("migrate", migrateCommand);
  // `offboard`: full surface TS (changeset parse, cross-project guard, plan
  // print, FIX-125 in-cycle plist tripwire, --confirm apply). No bash fallback.
  registerPorted("offboard", offboardCommand);
  // `loop status` + `loop run-once` are TS; every other loop subcommand falls
  // back to bash. `run-once` is the v3 single-cycle runner adapter (US-LOOP-006
  // prerequisite); --dry-run prints the command plan without executing.
  registerPorted("loop", (args) => {
    if (args[0] === "status") return dashboardCommand(args.slice(1));
    if (args[0] === "run-once") return loopRunOnceCommand(args.slice(1));
    return fallbackToBash(["loop", ...args]).status;
  });
}
