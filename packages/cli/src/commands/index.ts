/** Ported-command registry — one line per migrated subcommand. */
import { registerPorted } from "../bridge.js";
import { agentCommand } from "./agent.js";
import { pairCommand } from "./pair.js";
import { alertCommand } from "./alert.js";
import { attestCommand } from "./attest.js";
import { backlogCommand } from "./backlog.js";
import {
  backlogLintCommand,
  backlogSetStatusCommand,
  backlogUnstickCommand,
} from "./backlog-mgmt.js";
import { backlogSyncCommand } from "./backlog-sync.js";
import {
  loopAgentRoutesCommand,
  loopEnforceTcrCommand,
  loopHotfixHeadContextCommand,
  loopNotifyCommand,
  loopPrecheckCiCommand,
  loopTestQualityCheckRetired,
  loopUnknownSubcommand,
} from "./loop-cycle-gates.js";
import { briefCommand } from "./brief.js";
import { changelogCommand } from "./changelog.js";
import { ciCommand, ciWaitCommand } from "./ci.js";
import { configCommand } from "./config.js";
import { consistencyCommand } from "./consistency.js";
import { dashboardCommand, loopEvalCommand, loopStoryCommand } from "./dashboard.js";
import { loopRunsCommand } from "./loop-runs.js";
import { loopSignalsCommand } from "./loop-signals.js";
import { loopLogCommand } from "./loop-log.js";
import { loopEventsCommand } from "./loop-events.js";
import { loopAttachRetired, loopBranchesRetired, loopMonitorRetired } from "./loop-retired.js";
import { doctorCommand } from "./doctor.js";
import { dreamCommand } from "./dream.js";
import { feedbackCommand } from "./feedback.js";
import { gcCommand } from "./gc.js";
import { ideaCommand } from "./idea.js";
import { indexCommand } from "./index-gen.js";
import { storyNewCommand } from "./story-new.js";
import { initCommand } from "./init.js";
// REFACTOR-049: `roll lang` retired → use `roll config lang <zh|en|--reset>`.
// The lang module's write/clear/read surfaces are consumed by config.ts.
import { loopFmtCommand } from "./loop-fmt.js";
import {
  loopGcCommand,
  loopMuteCommand,
  loopResetCommand,
  loopTestCommand,
  loopUnmuteCommand,
} from "./loop-maint.js";
import { loopPrInboxCommand } from "./loop-pr-inbox.js";
import { runPrHeal } from "./loop-pr-heal.js";
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
import { releaseCommand } from "./release.js";
import { releaseShipCommand } from "./release-ship.js";
import { releaseWaiverCommand } from "./release-waiver.js";
import { setupCommand } from "./setup.js";
import { skillsCommand } from "./skills.js";
import { statusCommand } from "./status.js";
import { testCommand } from "./test.js";
import { tuneCommand } from "./tune.js";
import { updateCommand } from "./update.js";
import { versionCommand } from "./version.js";

let registered = false;

export function registerAll(): void {
  if (registered) return;
  registered = true;
  registerPorted("status", statusCommand);
  // REFACTOR-049: `roll lang` retired → use `roll config lang <zh|en|--reset>`.
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
  // `story new`: internal/advanced explicit card-folder minting (US-META-009).
  // REFACTOR-050: `roll idea` is now the one user-facing card-capture entry;
  // `story new` is retained for agents/skills that need explicit ID+epic control.
  registerPorted("story", (args) => {
    if (args[0] === "new") return storyNewCommand(args.slice(1));
    process.stdout.write("Usage: roll story new <ID> --title <text> [--epic <epic>] [--note <text>]\n");
    return args[0] === undefined || args[0] === "--help" || args[0] === "-h" ? 0 : 1;
  });
  // `gc`: age out old surplus attest runs across the archive layout (US-META-001).
  registerPorted("gc", gcCommand, { hidden: true }); // REFACTOR-049: auto-runs per cycle; manual entry stays callable, off the usage list
  // REFACTOR-048: `archive migrate` (old verification/<ID> tree port) retired —
  // that one-time migration completed (US-META-002a..c); cleanup lives in `gc`,
  // dossier reconciliation in `roll index --rebuild`.
  // `dream`: full surface TS (US-PORT-020). `run-once` is the v3-native scan
  // heart; every other arg mirrors v2's generic unknown-command surface without
  // shelling to bin/roll.
  registerPorted("dream", dreamCommand);
  // `agent`: full surface TS (view/list/use/set/unknown). The write face owns
  // .roll/agents.yaml plus legacy .roll/local.yaml sync; no bash fallback.
  registerPorted("agent", agentCommand);
  // `pair`: v3-native Cross-Agent Pairing (US-PAIR-001). `pair init` scaffolds
  // an explicit .roll/pairing.yaml from the installed registry. No bash fallback
  // (v2 had no pairing).
  registerPorted("pair", pairCommand);
  // `backlog`: FULLY TS as of US-PORT-019. Display + block/defer/unblock/promote
  // + lint + unstick + sync (GitHub issues→backlog) all run native; no bash
  // fallback remains.
  registerPorted("backlog", (args) => {
    const sub = args[0];
    if (sub === "block" || sub === "defer" || sub === "unblock" || sub === "promote") {
      return backlogSetStatusCommand(sub, args.slice(1));
    }
    if (sub === "lint") return backlogLintCommand(args.slice(1));
    if (sub === "unstick") return backlogUnstickCommand(args.slice(1));
    if (sub === "sync") return backlogSyncCommand(args.slice(1));
    return backlogCommand(args);
  });
  // `brief`: v3-native live owner digest (US-PORT-002). Composes the three-block
  // one-screen digest from the backlog reader (+ active ALERT file) instead of
  // rendering a cached, agent-authored .roll/briefs/*.md — no agent is shelled,
  // so no reasoning can leak (the "agent 绝不漏思考过程" AC, strongest form).
  // Output follows the resolved locale single-language. `--full` expands lists.
  // No bash fallback: the digest is data-derived and always fresh.
  registerPorted("brief", briefCommand);
  // `idea`: v3-native deterministic backlog capture (US-PORT-003). Classifies
  // bug→FIX / idea→IDEA, auto-numbers (max suffix + 1), lint-gates the
  // description with the same rules as the bash _backlog_lint oracle, and
  // appends through BacklogStore's optimistic atomic write (与 backlog 存取同源).
  // A lint violation reports and refuses — no bad card is ever written.
  // No bash fallback: v2 had no `roll idea` command (capture was skill-only).
  registerPorted("idea", ideaCommand);
  // `release`: v3-native read-only release guidance (US-PORT-004). Computes the
  // next calver version from package.json + today, surfaces changelog readiness,
  // and prints the PR/tag flow + the CI consistency-gate note. It NEVER bumps,
  // commits, tags, or publishes — a release is always a human decision (loop
  // hard rule). No bash fallback: v2 had no `roll release` subcommand (the flow
  // lived in the private ops wrapper, which stays for the actual publish).
  registerPorted("release", (args) => {
    if (args[0] === "ship") return releaseShipCommand(args.slice(1));
    // US-TRUTH-005: the recorded owner bypass for the consistency gate.
    if (args[0] === "waiver") return releaseWaiverCommand(args.slice(1));
    return releaseCommand(args);
  });
  // `prices`: full surface TS (show/help/unknown + refresh network write).
  // `refresh` uses the native vendor registry/parser/snapshot writer; no bash
  // fallback remains (US-PORT-017).
  registerPorted("prices", pricesCommand);
  // `config`: FULLY TS now (US-PORT-006 — 整个 config 命令收口). Read surface
  // (help/--list/key read) + write surface + the three compact facades
  // (loop-window/loop-schedule/dream-time) all run native; no bash fallback.
  // DELIBERATE divergence: a config write no longer implicitly remounts launchd
  // (apply a new schedule with `roll loop on`); CLI output stays byte-identical
  // to v2, and the v2 `_config_resolve` `set -u` crash on a missing global file
  // is fixed. See config.ts header.
  registerPorted("config", configCommand);
  // `changelog`: fully TS, deterministic-canonical (US-PORT-005). The v2 default
  // `generate` shelled the configured agent to AI-restyle the draft (and the
  // dispatch fell back to bash to do it); that path is RETIRED. The deterministic
  // draft is now the only output, produced natively in TS — no bash fallback,
  // no agent, no warn noise. `--no-ai` is kept as an accepted no-op.
  registerPorted("changelog", changelogCommand);
  // `consistency`: check/--json/--project-dir + help + unknown all TS (full
  // surface ported; the python orchestrator is reimplemented byte-for-byte).
  registerPorted("consistency", consistencyCommand);
  // `feedback`: full surface TS (arg parse, repo resolution, env block,
  // print-url + gh issue create). No sub-paths left on bash.
  registerPorted("feedback", feedbackCommand);
  // `init`: full surface TS (fresh/re-init scaffold, legacy-codebase onboard
  // launcher, --apply plan consumption, unknown flags, and no-template guard).
  // No sub-paths on bash.
  registerPorted("init", initCommand);
  // REFACTOR-048: `migrate-features` (card-skeleton backfill for pre-card-era
  // stories, US-META-007) retired — that one-time backfill completed; new cards
  // are minted via `roll story new`.
  // `migrate` STAYS: the pre-2.0 → 2.0 user-project upgrade path that
  // `roll init` directs users to (three-state idempotency, dry-run preview,
  // git-mv execute with the single atomic commit).
  registerPorted("migrate", migrateCommand);
  // `offboard`: full surface TS (changeset parse, cross-project guard, plan
  // print, FIX-125 in-cycle plist tripwire, --confirm apply). No bash fallback.
  registerPorted("offboard", offboardCommand);
  // `setup`: full surface TS (fresh / --force / already-synced re-run,
  // unknown-argument, and no-conventions-source guard). No sub-paths on bash.
  registerPorted("setup", setupCommand);
  // `ci`: the READ surface is TS (no-flag / `--timeout=N` status report:
  // gh-absent warn, not-a-git-repo err, gh-run-list failure, no-runs note, and
  // the per-run "<name>: <status>/<conclusion>" listing). The `--wait` CI gate
  // (_ci_wait's polling loop) returns null → falls back to the frozen bash.
  registerPorted("ci", (args) => {
    if (args.includes("--wait")) return ciWaitCommand(args); // US-PORT-015: TS CI gate
    // The non-wait read surface is fully TS; ciCommand only returns null on the
    // --wait path (intercepted above), so the coalesce is an unreachable guard
    // (US-PORT-021 prep: no bash fallback remains).
    return ciCommand(args) ?? 1;
  });
  // `test`: full surface TS (arg parse, --where routing, --reset lock+dispatch,
  // the default exec path through the isolation adapter). type=none runs the
  // suite on the host via a forwarded `npm test`; any other configured type
  // (incl. a stale `tart` — lane removed by REFACTOR-046) errors non-zero WITHOUT a
  // silent host fallback (US-ISO-003). No sub-paths on bash.
  registerPorted("test", testCommand);
  // `tune`: v3-native US-EVID-015 second-order control loop, READ-ONLY. Aggregates
  // four trend signals (self-score notes / runs.jsonl pass rate / events.ndjson
  // misjudgments / runs result_eval.dims rubric relevance) into the pure
  // buildSelfTuningPlan, which emits suggest-only proposals with evidence +
  // rollback. NEVER writes policy/agents/rubric config; `tune reset` prints the
  // default rollback values without touching disk. No bash fallback (v2 had none).
  registerPorted("tune", tuneCommand);
  // `update`: full surface TS (npm + curl upgrade paths, cache invalidation, the
  // post-update `roll setup` chain, changelog). The real install is driven via
  // spawned npm/curl/tar; the curl atomic dir-swap is the one whitelisted gap.
  // No sub-paths on bash.
  registerPorted("update", updateCommand);
  // `version` / `--version` / `-v`: TS-native (FIX-202). Reads the install
  // tree's package.json (single source of truth), so it no longer reports the
  // fossil bin/roll VERSION= literal. No bash fallback for these.
  registerPorted("version", versionCommand, { hidden: true }); // REFACTOR-049: alias for roll --version, off the usage list
  registerPorted("--version", versionCommand);
  registerPorted("-v", versionCommand);
  // `loop` is FULLY TS as of US-PORT-021 prep — no subcommand falls back to bash.
  // `on` generates the v3 self-contained runner (DELIBERATE divergence from the
  // v2 tmux outer/inner pair, whitelisted in AGENTS.md). Bare `roll loop`
  // defaults to status (mirrors the v2 `${1:-status}`).
  registerPorted("loop", (args) => {
    if (args[0] === undefined || args[0] === "status") return dashboardCommand(args.slice(1));
    // `loop eval` / `loop story`: read-face commands (US-PORT-007) — thin TS
    // readers over the same cycle pipeline `loop status` owns. No bash fallback.
    if (args[0] === "eval") return loopEvalCommand(args.slice(1));
    if (args[0] === "story") return loopStoryCommand(args.slice(1));
    if (args[0] === "runs") return loopRunsCommand(args.slice(1));
    if (args[0] === "signals") return loopSignalsCommand(args.slice(1));
    // `loop log` / `loop events`: residual pure-read viewers (US-PORT-022) over
    // .roll/cycle-logs and the shared events ndjson. No bash fallback.
    if (args[0] === "log") return loopLogCommand(args.slice(1));
    if (args[0] === "events") return loopEventsCommand(args.slice(1));
    // `loop monitor` / `loop attach`: the v2 tmux-popup stream retires under the
    // v3 self-contained runner (US-PORT-007) — TS stubs redirect, never run the
    // bash tmux behaviour.
    if (args[0] === "monitor") return loopMonitorRetired();
    if (args[0] === "attach") return loopAttachRetired();
    if (args[0] === "run-once") return loopRunOnceCommand(args.slice(1));
    // `loop fmt`: the observation-window formatter (US-PORT-012) — stdin
    // stream-json → three-tier transcript. v3-native; the watch pipe feeds it.
    if (args[0] === "fmt") return loopFmtCommand(args.slice(1));
    // `loop pr-inbox`: the dedicated PR-loop tick (US-PORT-001) — drives the
    // pure core/pr-loop.ts decisions; the pr runner calls this instead of the
    // retired bash `_loop_pr_inbox`.
    if (args[0] === "pr-inbox") return loopPrInboxCommand(args.slice(1));
    // `loop pr-heal-run <num> <headRef> <slug>`: the detached heal worker the PR
    // tick launches (US-PORT-021) — runs the agent-in-worktree fix natively in
    // TS, replacing the bridged bash `_loop_pr_do_heal`.
    if (args[0] === "pr-heal-run") {
      return runPrHeal(args[1] ?? "", args[2] ?? "", args[3] ?? "");
    }
    if (args[0] === "on") return loopOnCommand(args.slice(1));
    if (args[0] === "off") return loopOffCommand(args.slice(1));
    if (args[0] === "pause") return loopPauseCommand(args.slice(1));
    if (args[0] === "resume") return loopResumeCommand(args.slice(1));
    if (args[0] === "now") return loopNowCommand(args.slice(1));
    // `loop reset` / `loop mute` / `loop unmute`: residual write/maintenance
    // subcommands (US-PORT-022) — clear per-project state + heal counters, and
    // the auto-attach popup toggle pair. No bash fallback.
    if (args[0] === "reset") return loopResetCommand(args.slice(1));
    if (args[0] === "mute") return loopMuteCommand(args.slice(1));
    if (args[0] === "unmute") return loopUnmuteCommand(args.slice(1));
    // `loop gc` (≠ top-level `roll gc`): garbage-collect orphan slugs + tmp
    // debris + expired backups (US-PORT-022 / US-LOOP-021). FIX-125 gated.
    if (args[0] === "gc") return loopGcCommand(args.slice(1));
    // `loop test` (≠ top-level `roll test`): manual smoke gate — generates the
    // v3 test runner and runs it once with ROLL_LOOP_FORCE=1 (US-PORT-022).
    if (args[0] === "test") return loopTestCommand(args.slice(1));
    // `loop branches`: retired (US-PORT-022) — no internal caller; prints the
    // one-line `git ls-remote` that reproduces it. Never shells to bash.
    if (args[0] === "branches") return loopBranchesRetired();
    // Cycle-gate subcommands the loop AGENT invokes per the roll-loop skill
    // (US-PORT-021 prerequisite — the last loop fallbacks, now native TS).
    if (args[0] === "notify") return loopNotifyCommand(args.slice(1));
    if (args[0] === "enforce-tcr") return loopEnforceTcrCommand(args.slice(1));
    if (args[0] === "precheck-ci") return loopPrecheckCiCommand(args.slice(1));
    if (args[0] === "hotfix-head-context") return loopHotfixHeadContextCommand(args.slice(1));
    if (args[0] === "agent-routes") return loopAgentRoutesCommand(args.slice(1));
    if (args[0] === "test-quality-check") return loopTestQualityCheckRetired();
    // Anything else is an unknown loop subcommand — print the v2 usage, exit 1
    // (no bash fallback remains; bin/roll is being retired in US-PORT-021).
    return loopUnknownSubcommand(args[0]);
  });
}
