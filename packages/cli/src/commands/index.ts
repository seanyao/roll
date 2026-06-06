/** Ported-command registry — one line per migrated subcommand. */
import { fallbackToBash, registerPorted } from "../bridge.js";
import { agentListCommand } from "./agent-list.js";
import { alertCommand } from "./alert.js";
import { archiveMigrateCommand } from "./archive-migrate.js";
import { attestCommand } from "./attest.js";
import { BACKLOG_MGMT_SUBCOMMANDS, backlogCommand } from "./backlog.js";
import { changelogCommand } from "./changelog.js";
import { ciCommand } from "./ci.js";
import { CONFIG_FACADE_KEYS, configGetCommand } from "./config-get.js";
import { consistencyCommand } from "./consistency.js";
import { dashboardCommand } from "./dashboard.js";
import { doctorCommand } from "./doctor.js";
import { feedbackCommand } from "./feedback.js";
import { gcCommand } from "./gc.js";
import { indexCommand } from "./index-gen.js";
import { initCommand } from "./init.js";
import { langCommand } from "./lang.js";
import { loopFmtCommand } from "./loop-fmt.js";
import { loopRunOnceCommand } from "./loop-run-once.js";
import {
  loopNowCommand,
  loopOffCommand,
  loopOnCommand,
  loopPauseCommand,
  loopResumeCommand,
} from "./loop-sched.js";
import { migrateCommand } from "./migrate.js";
import { offboardCommand } from "./offboard.js";
import { pricesCommand } from "./prices.js";
import { setupCommand } from "./setup.js";
import { skillsCommand } from "./skills.js";
import { slidesCommand } from "./slides/index.js";
import { statusCommand } from "./status.js";
import { testCommand } from "./test.js";
import { updateCommand } from "./update.js";
import { versionCommand } from "./version.js";

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
  // `attest`: the acceptance-evidence report (US-ATTEST-006) — v3-native, no
  // bash counterpart (additive; the evidence chain is new product surface).
  registerPorted("attest", attestCommand);
  // `index`: regenerate the backlog-derived ID→epic map (US-META-001). v3-native.
  registerPorted("index", indexCommand);
  // `gc`: age out old surplus attest runs across the archive layout (US-META-001).
  registerPorted("gc", gcCommand);
  // `archive` groups archive-layout maintenance; `migrate` ports the legacy
  // verification/<ID>/ trees into features/<epic>/<ID>/ (US-META-002a). v3-native.
  registerPorted("archive", (args) => {
    if (args[0] === "migrate") return archiveMigrateCommand(args.slice(1));
    if (args[0] === undefined || args[0] === "--help" || args[0] === "-h") {
      process.stdout.write("Usage: roll archive migrate [--dry-run] [--keep-latest N] [--keep-days M]\n");
      return args[0] === undefined ? 1 : 0;
    }
    process.stderr.write(`[roll] unknown archive subcommand: ${args[0]}\n`);
    return 1;
  });
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
  // `init`: the DETERMINISTIC scaffolding paths are TS (fresh project init +
  // re-init section-merge, with the v2 roll-init.py UI rendered natively). The
  // legacy-codebase onboarding flow, `init --apply`, unknown -flags, and the
  // no-templates guard all RETURN null → fall back to bash (which owns the
  // interactive agent launch and the i18n'd error messages).
  registerPorted("init", (args) => {
    const r = initCommand(args);
    return r ?? fallbackToBash(["init", ...args]).status;
  });
  // `migrate`: full surface TS (three-state idempotency, dry-run preview,
  // git-mv execute with the single atomic commit). No sub-paths on bash.
  registerPorted("migrate", migrateCommand);
  // `offboard`: full surface TS (changeset parse, cross-project guard, plan
  // print, FIX-125 in-cycle plist tripwire, --confirm apply). No bash fallback.
  registerPorted("offboard", offboardCommand);
  // `setup`: the DETERMINISTIC install/sync pipeline + v2 UI are TS (fresh /
  // --force / already-synced re-run; the unknown-argument error is owned by the
  // TS port too — byte-identical catalog message). The only fallback is the
  // no-conventions-source guard (rollPkgConventions missing → returns null), so
  // bash owns the convention-source-not-found error + exit. No other sub-paths.
  registerPorted("setup", (args) => {
    const r = setupCommand(args);
    return r ?? fallbackToBash(["setup", ...args]).status;
  });
  // `ci`: the READ surface is TS (no-flag / `--timeout=N` status report:
  // gh-absent warn, not-a-git-repo err, gh-run-list failure, no-runs note, and
  // the per-run "<name>: <status>/<conclusion>" listing). The `--wait` CI gate
  // (_ci_wait's polling loop) returns null → falls back to the frozen bash.
  registerPorted("ci", (args) => {
    const r = ciCommand(args);
    return r ?? fallbackToBash(["ci", ...args]).status;
  });
  // `test`: full surface TS (arg parse, --where routing, --reset lock+dispatch,
  // the default exec path through the isolation adapter). type=none runs the
  // suite on the host via a forwarded `npm test`; any other configured type
  // (incl. a stale `tart` — lane removed by REFACTOR-046) errors non-zero WITHOUT a
  // silent host fallback (US-ISO-003). No sub-paths on bash.
  registerPorted("test", testCommand);
  // `update`: full surface TS (npm + curl upgrade paths, cache invalidation, the
  // post-update `roll setup` chain, changelog). The real install is driven via
  // spawned npm/curl/tar; the curl atomic dir-swap is the one whitelisted gap.
  // No sub-paths on bash.
  registerPorted("update", updateCommand);
  // `version` / `--version` / `-v`: TS-native (FIX-202). Reads the install
  // tree's package.json (single source of truth), so it no longer reports the
  // fossil bin/roll VERSION= literal. No bash fallback for these.
  registerPorted("version", versionCommand);
  registerPorted("--version", versionCommand);
  registerPorted("-v", versionCommand);
  // `slides`: the DETERMINISTIC surface is TS — build (native validator +
  // renderer, byte-identical to the python oracle), list, preview, logs,
  // templates, delete --force, help, and the unknown-subcommand error. Two
  // sub-paths RETURN null → fall back to the frozen bash: `new` (launches the
  // selected project AI agent with the roll-deck skill to author deck.md — an
  // agent-shelling path that must not run from TS, same policy as changelog's
  // AI styling) and the interactive `delete` confirm (the live TTY y/N read).
  registerPorted("slides", (args) => {
    const r = slidesCommand(args);
    return r ?? fallbackToBash(["slides", ...args]).status;
  });
  // `loop status` + `loop run-once` are TS; `on|off|pause|resume` are TS as of
  // US-LOOP-009 — `on` generates the v3 runner (a self-contained wrapper around
  // `loop run-once`; DELIBERATE divergence from the v2 tmux outer/inner pair,
  // whitelisted in AGENTS.md). Every other loop subcommand falls back to bash.
  registerPorted("loop", (args) => {
    if (args[0] === "status") return dashboardCommand(args.slice(1));
    if (args[0] === "run-once") return loopRunOnceCommand(args.slice(1));
    if (args[0] === "on") return loopOnCommand(args.slice(1));
    if (args[0] === "off") return loopOffCommand(args.slice(1));
    if (args[0] === "pause") return loopPauseCommand(args.slice(1));
    if (args[0] === "resume") return loopResumeCommand(args.slice(1));
    if (args[0] === "now") return loopNowCommand(args.slice(1));
    if (args[0] === "fmt") return loopFmtCommand(args.slice(1));
    return fallbackToBash(["loop", ...args]).status;
  });
}
