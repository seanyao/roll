/**
 * `roll loop on|off|pause|resume` — US-LOOP-009: the TS scheduling surface that
 * swaps the loop's runtime heart from the v2 bash inner to `roll loop run-once`.
 *
 * DELIBERATE v2 DIVERGENCE (whitelisted in the AGENTS.md bridge table):
 *   - The generated loop runner is a SELF-CONTAINED wrapper: PATH bootstrap,
 *     PAUSE marker, active window, caffeinate, then `roll loop run-once`. The
 *     v2 outer/inner pair (tmux popup, baked agent argv, `source bin/roll`,
 *     formatter/usage/eval side-cars) is retired — run-once owns the cycle
 *     (lock, heartbeat, watchdog, events/runs/cycle-logs) natively.
 *   - No bash-engine function is referenced by the generated script. The v2
 *     outer template called `_loop_migrate_legacy_paths` & co. without sourcing
 *     them — `command not found` on every manual run (FIX-197).
 *   - The dream service is NOT regenerated here (its runner drives an agent
 *     skill command — bash-era surface, see FIX-197 lineage). `loop off` still
 *     boots it out so no zombie schedule survives a shutdown.
 *
 * KEPT contracts (so status/dashboard/brief keep reading the same world):
 *   - runner path  : <shared>/loop/run-<slug>.sh   (pr: <shared>/pr/run-<slug>.sh)
 *   - plist        : ~/Library/LaunchAgents/com.roll.<svc>.<slug>.plist via
 *                    infra plistContent (byte-shape of _write_launchd_plist)
 *   - machine log  : <project>/.roll/loop/cron.log  (pr: pr.log)
 *   - PAUSE marker : <project>/.roll/loop/PAUSE-<slug>
 *   - launchctl    : enable/bootstrap + bootout pairs (FIX-027/FIX-098 dance)
 *   - loop period  : .roll/local.yaml `loop_schedule.period_minutes` (default 30)
 */
import {
  type LaunchctlResult,
  isLoaded as launchdIsLoaded,
  launchdLabel,
  launchdPlistPath,
  plistContent,
  reinstall as launchdReinstall,
  uninstall as launchdUninstall,
  projectIdentity,
} from "@roll/infra";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ─── injectable deps (tests fake launchd + identity + paths) ─────────────────
export interface LoopSchedDeps {
  identity: () => Promise<{ path: string; slug: string }>;
  uid: () => number;
  sharedRoot: () => string;
  launchdDir: () => string;
  launchd: {
    reinstall: (uid: number, label: string, plist: string) => Promise<LaunchctlResult>;
    uninstall: (uid: number, label: string) => Promise<LaunchctlResult>;
    /** FIX-212: post-bootstrap probe (`launchctl print gui/<uid>/<label>` exit 0)
     *  — proves the job actually mounted, not just that bootstrap returned 0. */
    isLoaded?: (uid: number, label: string) => Promise<boolean>;
  };
  /** Run the generated loop runner once, FORCE env set (loop now). */
  execRunner?: (runnerPath: string) => Promise<number>;
  /** FIX-204E: is tmux available? Decides the `loop now` UX branch. */
  hasTmux?: () => boolean;
  /** FIX-204E: inline observation — tail live.log for the cycle's duration. */
  observe?: (runtimeDir: string) => Promise<void>;
}

function realDeps(): LoopSchedDeps {
  return {
    identity: () => projectIdentity(),
    uid: () => process.getuid?.() ?? 501,
    sharedRoot: () => process.env["ROLL_SHARED_ROOT"] || join(homedir(), ".shared", "roll"),
    launchdDir: () => join(homedir(), "Library", "LaunchAgents"),
    launchd: { reinstall: launchdReinstall, uninstall: launchdUninstall, isLoaded: launchdIsLoaded },
    execRunner: (runner) =>
      new Promise((resolve) => {
        // FIX-204E: run the GENERATED runner — it self-wraps the cycle into
        // the tmux session and returns immediately (fallback: direct run).
        // The cycle must never be a child of the invoking session again.
        const child = spawn("bash", [runner], {
          stdio: "inherit",
          env: { ...process.env, ROLL_LOOP_FORCE: "1" },
        });
        child.on("exit", (code) => resolve(code ?? 1));
        child.on("error", () => resolve(1));
      }),
    hasTmux: () => {
      try {
        return spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
      } catch {
        return false;
      }
    },
    // The `loop now` inline observation: tail live.log while the cycle holds
    // the inner lock; Ctrl-C stops the TAIL only (the cycle lives in tmux).
    observe: (rt) =>
      new Promise((resolve) => {
        const lock = join(rt, "inner.lock");
        const tail = spawn("tail", ["-n", "+1", "-F", join(rt, "live.log")], { stdio: "inherit" });
        let sawLock = false;
        const t0 = Date.now();
        const finish = (): void => {
          try {
            tail.kill("SIGTERM");
          } catch {
            /* gone */
          }
          process.removeListener("SIGINT", finish);
          resolve();
        };
        const timer = setInterval(() => {
          if (existsSync(lock)) sawLock = true;
          const done = sawLock ? !existsSync(lock) : Date.now() - t0 > 30_000;
          if (done) {
            clearInterval(timer);
            finish();
          }
        }, 500);
        process.on("SIGINT", () => {
          clearInterval(timer);
          finish();
        });
      }),
  };
}

// ─── templates ────────────────────────────────────────────────────────────────

export interface LoopRunnerInput {
  projectPath: string;
  slug: string;
  /** Optional generation-time roll binary override (dev installs). */
  rollBin?: string;
  /** Active window [start, end) in hours; full window = 0..24. */
  activeStart: number;
  activeEnd: number;
}

/**
 * The v3 loop runner: a thin, self-contained launchd wrapper around
 * `roll loop run-once`. Everything cycle-shaped (lock, heartbeat, watchdog,
 * worktree, agent, publish, events/runs) lives in run-once — NOT here.
 */
export function buildLoopRunnerScript(input: LoopRunnerInput): string {
  const rt = `${input.projectPath}/.roll/loop`;
  return `#!/bin/bash -l
# roll v3 loop runner — generated by \`roll loop on\` (US-LOOP-009).
# Self-contained wrapper: the cycle heart is \`roll loop run-once\` (TS).
# Portable PATH: launchd delivers a bare PATH missing brew/local tools. Idempotent.
for _d in /opt/homebrew/bin /usr/local/bin /opt/local/bin "$HOME/.local/bin" "$HOME/.kimi-code/bin"; do
  case ":$PATH:" in *":$_d:"*) ;; *) [ -d "$_d" ] && PATH="$_d:$PATH" ;; esac
done
export PATH
RT="${rt}"
LOG="$RT/cron.log"
mkdir -p "$RT"
# Pause marker — written by \`roll loop pause\`, removed by \`roll loop resume\`.
if [ -f "$RT/PAUSE-${input.slug}" ]; then exit 0; fi
# Active window [${input.activeStart},${input.activeEnd}) — ROLL_LOOP_FORCE (manual \`roll loop now\`) bypasses.
# 10# forces base-10: \`date +%H\` yields "08"/"09" which printf %d rejects as octal (v2 latent bug, fixed here).
if [ -z "$ROLL_LOOP_FORCE" ]; then
  h=$((10#$(date +%H)))
  if [ "$h" -lt ${input.activeStart} ] || [ "$h" -ge ${input.activeEnd} ]; then exit 0; fi
fi
ROLL_BIN="\${ROLL_BIN:-${input.rollBin ?? '$(command -v roll || echo /opt/homebrew/bin/roll)'}}"
# FIX-204E observation window: every cycle runs inside tmux session
# roll-loop-${input.slug} (v2's session model around the TS heart): window 0
# tails the live agent transcript ($RT/live.log), each cycle gets its own
# window, and the cycle SURVIVES whoever invoked it — a dying terminal or
# agent session can no longer TERM a half-done cycle (2026-06-06 rc=143).
# ROLL_LOOP_NO_TMUX=1 or no tmux on PATH → direct run (previous contract).
# ROLL_TMUX_BIN: test seam (the PATH bootstrap above outranks any shim dir).
TMUX_BIN="\${ROLL_TMUX_BIN:-tmux}"
if [ -z "$ROLL_TMUX_WRAPPED" ] && [ -z "$ROLL_LOOP_NO_TMUX" ] && command -v "$TMUX_BIN" >/dev/null 2>&1; then
  _sess="roll-loop-${input.slug}"
  "$TMUX_BIN" has-session -t "$_sess" 2>/dev/null || \\
    "$TMUX_BIN" new-session -d -s "$_sess" -x 200 -y 50 -n watch "printf 'roll live · ${input.slug} — agent transcript\\n'; exec tail -n +1 -F '$RT/live.log'" 2>/dev/null || true
  if "$TMUX_BIN" new-window -d -t "$_sess" -n "c$(date +%H%M%S)" "ROLL_TMUX_WRAPPED=1 ROLL_LOOP_FORCE='\${ROLL_LOOP_FORCE:-}' ROLL_BIN='$ROLL_BIN' exec bash '$0'" 2>/dev/null; then
    exit 0
  fi
fi
# Keep the box awake for the duration of the cycle.
caffeinate -i -w $$ 2>/dev/null &
cd "${input.projectPath}" || exit 0
echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] cycle start (v3 run-once)" >> "$LOG"
"$ROLL_BIN" loop run-once >> "$LOG" 2>&1
rc=$?
echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] cycle end rc=$rc" >> "$LOG"
exit 0
`;
}

export interface PrRunnerInput {
  projectPath: string;
  /** The installed bash engine the PR inbox orchestrator lives in. */
  rollBin: string;
}

/**
 * PR-loop runner — transcription of the v2 `_write_pr_loop_runner_script`
 * shape (bin/roll 8306-8341): portable PATH, single-flight pid:ts lock with
 * 15-min staleness self-heal, then drive `_loop_pr_inbox` through the bash
 * engine. Unchanged behavior; only the GENERATOR moved to TS.
 */
export function buildPrRunnerScript(input: PrRunnerInput): string {
  const lock = `${input.projectPath}/.roll/loop/.pr-loop.lock`;
  const log = `${input.projectPath}/.roll/loop/pr.log`;
  return `#!/bin/bash -l
set -o pipefail
# Portable PATH: launchd delivers a bare PATH missing brew/local tools. Idempotent.
for _d in /opt/homebrew/bin /usr/local/bin /opt/local/bin "$HOME/.local/bin" "$HOME/.kimi-code/bin"; do
  case ":$PATH:" in *":$_d:"*) ;; *) [ -d "$_d" ] && PATH="$_d:$PATH" ;; esac
done
export PATH
# Single-flight re-entry guard: one PR-loop pass at a time. 5-min cadence;
# 15-min (900s) staleness so a crashed/hung pass self-heals on the next tick.
LOCK="${lock}"
mkdir -p "$(dirname "$LOCK")"
if [ -f "$LOCK" ]; then
  _pp=""; _pt=""
  IFS=: read -r _pp _pt < "$LOCK" 2>/dev/null || true
  _now=$(date -u +%s)
  if [ -n "$_pp" ] && [ -n "$_pt" ] && kill -0 "$_pp" 2>/dev/null && [ "$((_now - _pt))" -lt 900 ]; then
    exit 0
  fi
  rm -f "$LOCK"
fi
printf '%s:%s\\n' "$$" "$(date -u +%s)" > "$LOCK"
trap 'rm -f "$LOCK"' EXIT
cd "${input.projectPath}" || exit 0
bash "${input.rollBin}" _loop_pr_inbox >> "${log}" 2>&1 || true
`;
}

/** Read `loop_schedule.period_minutes` from local.yaml text; 30 when absent. */
export function parseLoopPeriodMinutes(text: string): number {
  const lines = text.split("\n");
  let inSection = false;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (!inSection) {
      if (indent === 0 && /^loop_schedule:\s*$/.test(line.trim())) inSection = true;
      continue;
    }
    if (indent === 0) break;
    const m = /^period_minutes:\s*(\d+)\s*(?:#.*)?$/.exec(line.trim());
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1) return n;
    }
  }
  return 30;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function pathValue(): string {
  // The plist EnvironmentVariables PATH — brew/local dirs first, system after
  // (mirrors the live v2-generated plist; the runner self-repairs PATH anyway).
  const home = homedir();
  return [
    "/opt/homebrew/bin",
    `${home}/.local/bin`,
    `${home}/.kimi-code/bin`,
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");
}

function writeExecutable(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o755 });
}

function pauseMarkerPath(projectPath: string, slug: string): string {
  return join(projectPath, ".roll", "loop", `PAUSE-${slug}`);
}

/** Resolve the installed bash engine for the PR runner (package bin/roll). */
function installedRollBashBin(): string {
  // The TS CLI and bin/roll ship in the same package; walk from this module.
  // dist layout: <pkg>/packages/cli/dist/commands/loop-sched.js → <pkg>/bin/roll
  let dir = dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "bin", "roll");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "/opt/homebrew/lib/node_modules/@seanyao/roll/bin/roll";
}

// ─── commands ─────────────────────────────────────────────────────────────────

const LOOP_SERVICES = ["loop", "dream", "pr"] as const;

/**
 * FIX-212 — (re)install a service plist and PROVE it mounted.
 *
 * The bootout+bootstrap dance (FIX-027/098) races: `launchctl bootstrap` can
 * return non-zero, OR return 0 while the job silently never mounts. Either way
 * the old `loop on` reported success and the scheduler died quietly for hours.
 * So we treat "mounted" as the authoritative signal (`launchctl print` exit 0,
 * via `deps.launchd.isLoaded`), reinstall once more if the first pass did not
 * land it, and surface the launchctl stderr on failure.
 *
 * Returns `{ ok, detail }` — `detail` is the launchctl evidence: "loaded" on
 * success, else the last bootstrap stderr / exit code.
 */
async function mountService(
  deps: LoopSchedDeps,
  uid: number,
  label: string,
  plist: string,
): Promise<{ ok: boolean; detail: string }> {
  let last: LaunchctlResult = { code: 0, stdout: "", stderr: "" };
  // Two attempts max: the initial install + a single retry (FIX-212 spec).
  for (let attempt = 0; attempt < 2; attempt++) {
    last = await deps.launchd.reinstall(uid, label, plist);
    const loaded = deps.launchd.isLoaded
      ? await deps.launchd.isLoaded(uid, label)
      : last.code === 0;
    if (loaded) return { ok: true, detail: "loaded" };
  }
  const detail = last.stderr.trim() !== "" ? last.stderr.trim() : `bootstrap exit ${last.code}`;
  return { ok: false, detail };
}

/** `roll loop on` — generate v3 runners + plists, (re)load loop & pr. */
export async function loopOnCommand(_args: string[], deps: LoopSchedDeps = realDeps()): Promise<number> {
  const id = await deps.identity();
  const shared = deps.sharedRoot();
  const ld = deps.launchdDir();
  const uid = deps.uid();
  mkdirSync(ld, { recursive: true });

  // loop period from project local.yaml (live default: 30).
  let period = 30;
  const localYaml = join(id.path, ".roll", "local.yaml");
  if (existsSync(localYaml)) {
    try {
      period = parseLoopPeriodMinutes(readFileSync(localYaml, "utf8"));
    } catch {
      /* default */
    }
  }

  // 1. loop service — the v3 heart.
  const loopRunner = join(shared, "loop", `run-${id.slug}.sh`);
  const rollBinOverride = (process.env["ROLL_RUNNER_ROLL_BIN"] ?? "").trim();
  writeExecutable(
    loopRunner,
    buildLoopRunnerScript({
      projectPath: id.path,
      slug: id.slug,
      activeStart: 0,
      activeEnd: 24,
      ...(rollBinOverride !== "" ? { rollBin: rollBinOverride } : {}),
    }),
  );
  const loopLabel = launchdLabel("loop", id.slug);
  const loopPlist = launchdPlistPath("loop", id.slug, ld);
  writeFileSync(
    loopPlist,
    plistContent({
      label: loopLabel,
      runnerScript: loopRunner,
      projectPath: id.path,
      pathValue: pathValue(),
      schedule: { kind: "interval", periodMinutes: period },
    }),
  );
  const loopMount = await mountService(deps, uid, loopLabel, loopPlist);

  // 2. pr service — v2-shape tick every 5 min.
  const prRunner = join(shared, "pr", `run-${id.slug}.sh`);
  writeExecutable(prRunner, buildPrRunnerScript({ projectPath: id.path, rollBin: installedRollBashBin() }));
  const prLabel = launchdLabel("pr", id.slug);
  const prPlist = launchdPlistPath("pr", id.slug, ld);
  writeFileSync(
    prPlist,
    plistContent({
      label: prLabel,
      runnerScript: prRunner,
      projectPath: id.path,
      pathValue: pathValue(),
      schedule: { kind: "interval", periodMinutes: 5 },
    }),
  );
  const prMount = await mountService(deps, uid, prLabel, prPlist);

  // FIX-212: a silent mount failure is the bug. If either job did not actually
  // land in launchd (even after the retry), fail LOUD — name the label, echo
  // the launchctl evidence, and exit non-zero so `loop on` can never report a
  // green that the scheduler will not honor.
  const failed = [
    { label: loopLabel, m: loopMount },
    { label: prLabel, m: prMount },
  ].filter((s) => !s.m.ok);
  if (failed.length > 0) {
    process.stderr.write(
      [
        `loop on: failed to mount ${failed.length} launchd job(s) after retry — scheduling NOT active`,
        `loop on:重试后仍有 ${failed.length} 个 launchd 任务挂载失败 — 排程未生效`,
        ...failed.map((s) => `  ✗ ${s.label}: ${s.m.detail}`),
        `  Inspect: launchctl print gui/${uid}/<label>  ·  retry: roll loop on`,
        `  排查:launchctl print gui/${uid}/<label>  ·  重试:roll loop on`,
        ``,
      ].join("\n"),
    );
    return 1;
  }

  process.stdout.write(
    [
      `Loop enabled — cycle heart: roll loop run-once (v3)`,
      `Loop 已启用 — 周期心脏:roll loop run-once(v3)`,
      `  • roll-loop  every ${period}min  /  每 ${period} 分钟`,
      `  • pr-loop    every 5min  /  每 5 分钟`,
      `  • observe    tmux attach -t roll-loop-${id.slug}  /  观测窗`,
      `  • dream      untouched (legacy runner, see FIX-197)  /  未改动(旧 runner,见 FIX-197)`,
      // FIX-212: evidence the jobs are actually mounted (launchctl print exit 0),
      // not merely that bootstrap was issued.
      `  • verified mounted / 已验证挂载: ${loopLabel}, ${prLabel}`,
      ``,
    ].join("\n"),
  );
  return 0;
}

/** `roll loop off` — boot out every roll service for this project. */
export async function loopOffCommand(_args: string[], deps: LoopSchedDeps = realDeps()): Promise<number> {
  const id = await deps.identity();
  const uid = deps.uid();
  for (const svc of LOOP_SERVICES) {
    await deps.launchd.uninstall(uid, launchdLabel(svc, id.slug));
  }
  process.stdout.write(`Loop disabled (loop/dream/pr booted out)\nLoop 已停用(loop/dream/pr 均已卸载)\n`);
  return 0;
}

/** `roll loop pause` — write the PAUSE marker the runner honors. */
export async function loopPauseCommand(_args: string[], deps: LoopSchedDeps = realDeps()): Promise<number> {
  const id = await deps.identity();
  const marker = pauseMarkerPath(id.path, id.slug);
  mkdirSync(dirname(marker), { recursive: true });
  const already = existsSync(marker);
  if (!already) writeFileSync(marker, `${new Date().toISOString()}\n`);
  process.stdout.write(
    already
      ? `Loop already paused\nLoop 已处于暂停\n`
      : `Loop paused — next scheduled cycles will skip\nLoop 已暂停 — 后续排程周期将跳过\n`,
  );
  return 0;
}

/** `roll loop resume` — remove the PAUSE marker. */
export async function loopResumeCommand(_args: string[], deps: LoopSchedDeps = realDeps()): Promise<number> {
  const id = await deps.identity();
  const marker = pauseMarkerPath(id.path, id.slug);
  const existed = existsSync(marker);
  rmSync(marker, { force: true });
  process.stdout.write(
    existed
      ? `Loop resumed — scheduling active again\nLoop 已恢复 — 排程重新生效\n`
      : `Loop was not paused\nLoop 本就未暂停\n`,
  );
  return 0;
}

// ─── FIX-197: loop now + legacy-runner self-heal ──────────────────────────────

/**
 * A v2-generation outer runner: it bare-calls bash-engine functions that were
 * never sourced into it (`_loop_migrate_legacy_paths` & co.) — `command not
 * found` on every manual run, and its PAUSE check silently no-ops. Any runner
 * that does not delegate to `loop run-once` is treated as legacy.
 */
export function isLegacyRunner(text: string): boolean {
  if (/_loop_migrate_legacy_paths|_loop_runtime_dir/.test(text)) return true;
  if (!text.includes("loop run-once")) return true;
  // FIX-204E: a v3 runner generated before the observation window lacks the
  // tmux self-wrap — regenerate so cycles detach from the invoking session.
  return !text.includes("ROLL_TMUX_WRAPPED");
}

/**
 * `roll loop now` — force one cycle immediately (FIX-197 self-heal included):
 * a missing or v2-legacy runner is regenerated via `loop on` first (with a
 * note), then the v3 runner executes synchronously with ROLL_LOOP_FORCE=1.
 * DELIBERATE divergence from v2: no tmux popup — output streams inline and the
 * cycle transcript lands in .roll/loop/cron.log (same whitelist as US-LOOP-009).
 */
export async function loopNowCommand(_args: string[], deps: LoopSchedDeps = realDeps()): Promise<number> {
  const id = await deps.identity();
  const runner = join(deps.sharedRoot(), "loop", `run-${id.slug}.sh`);

  let legacy = false;
  if (existsSync(runner)) {
    try {
      legacy = isLegacyRunner(readFileSync(runner, "utf8"));
    } catch {
      legacy = true;
    }
  }
  if (!existsSync(runner) || legacy) {
    process.stdout.write(
      legacy
        ? `Legacy v2 runner detected — regenerating templates (FIX-197)\n检测到 v2 旧版 runner — 正在再生成模板（FIX-197）\n`
        : `No runner yet — generating templates\n尚无 runner — 正在生成模板\n`,
    );
    const rc = await loopOnCommand([], deps);
    if (rc !== 0) return rc;
  }

  // FIX-204E: the runner wraps the cycle into tmux (detached — survives this
  // session); `loop now` then tails live.log inline until the cycle releases
  // the inner lock. Ctrl-C stops the OBSERVATION only, never the cycle.
  const useTmux =
    (deps.hasTmux?.() ?? false) && (process.env["ROLL_LOOP_NO_TMUX"] ?? "").trim() === "";
  const sess = `roll-loop-${id.slug}`;
  process.stdout.write(
    useTmux
      ? `Starting one loop cycle in tmux — attach anytime: tmux attach -t ${sess}\n` +
        `强制启动一个 loop 周期(tmux 内) — 随时观察:tmux attach -t ${sess}\n` +
        `live transcript below — Ctrl-C stops watching, never the cycle\n` +
        `实时转录如下 — Ctrl-C 只退出观察,不影响周期\n\n`
      : `Starting one loop cycle (no tmux — runs inline)\n强制启动一个 loop 周期(无 tmux — 内联运行)\n\n`,
  );
  const exec = deps.execRunner;
  if (exec === undefined) {
    process.stderr.write("loop now: no runner executor available\n");
    return 1;
  }
  const rc = await exec(runner);
  if (rc === 0 && useTmux && deps.observe !== undefined) {
    await deps.observe(join(id.path, ".roll", "loop"));
    process.stdout.write(
      `\ncycle finished — logs: .roll/loop/cron.log · .roll/loop/cycle-logs/\n` +
        `周期结束 — 日志: .roll/loop/cron.log · .roll/loop/cycle-logs/\n`,
    );
  }
  return rc;
}
