/**
 * Schedule module — TS port of the v2 launchd (macOS) / crontab (Linux)
 * scheduling adapters (US-INFRA-004).
 *
 * ─── v2 oracle (frozen bash, bin/roll) ──────────────────────────────────────
 *   launchd label / path:
 *     - `_launchd_label svc path`       8170-8173  `com.roll.<svc>.<slug>`.
 *     - `_launchd_plist_path svc path`  8194-8197  `<dir>/<label>.plist`.
 *   plist content generation (BYTE-DIFFABLE):
 *     - `_write_launchd_plist`          8199-8290.
 *         schedule_xml selection 8235-8260:
 *           - daily + ROLL_DREAM_CALENDAR=1 → array-style StartCalendarInterval
 *             (Hour + Minute).                                       (8241-8249)
 *           - daily (default, FIX-105)      → StartInterval 86400.   (8252-8253)
 *           - non-daily                     → StartInterval = period*60. (8257-8259)
 *         content heredoc 8262-8284: xml decl + DOCTYPE + plist/dict with
 *           Label / ProgramArguments(/bin/bash -l <runner>) /
 *           EnvironmentVariables(PATH=<path_value>) / <schedule_xml> /
 *           WorkingDirectory(<project_path>). Written via
 *           `printf '%s\n' "$content"` → a SINGLE trailing newline. (8289)
 *     - the services matrix `_install_launchd_plists` 9680-9684:
 *         services=(loop dream pr) periods=($loop_period 60 5)
 *         offsets=($loop_offset $dream_minute 0) hours=("" $dream_hour "").
 *         → loop/pr use StartInterval=period*60; dream uses the daily path.
 *   launchctl lifecycle (install/uninstall/status):
 *     - install (FIX-098): `enable gui/<uid>/<label>` + `bootstrap gui/<uid>
 *       <plist>`                                                     9925-9926.
 *     - reinstall on change (FIX-027): `bootout gui/<uid>/<label>` then
 *       `bootstrap gui/<uid> <plist>`                                9740-9741.
 *     - brand-new plist (FIX-059): `disable gui/<uid>/<label>`       9748.
 *     - uninstall: `bootout gui/<uid>/<label>` (apply path) 3152 / `unload -w`.
 *     - is-loaded (FIX-098): `launchctl print gui/<uid>/<label>` exit 0 9594.
 *   Linux crontab (FIX-195: brief entry retired — only loop + dream remain):
 *     - tag      `_LOOP_TAG="# roll-loop"`                           7279.
 *     - enable (`_loop_on`) 9958-9962:
 *         (crontab -l ; printf "%d * * * * %s %s:%s\n" loop_minute loop_cmd
 *          TAG path ; printf "%d %d * * * %s %s:%s\n" dream_minute dream_hour
 *          dream_cmd TAG path) | crontab -
 *     - disable (`_loop_off`) 10012-10015:
 *         already-disabled probe `crontab -l | grep -q "TAG:path"`;
 *         remove `crontab -l | grep -v "TAG:path" | crontab -`.
 *
 * ─── Lib choice: raw `launchctl`/`crontab` via execFile, NOT a scheduler lib ──
 * Same rationale as git.ts/github.ts: the oracle is literal CLI invocations with
 * exact flags (`bootstrap`/`bootout`/`enable`/`disable`, `crontab -`/`-l`) and
 * BYTE-EXACT generated files (plist content, cron lines) that v3 must reproduce
 * verbatim for an in-place migration. We mirror them with `execFile` + pure
 * string generators (diff-tested against the extracted bash). ZERO new deps.
 *
 * The PURE generators (`launchdLabel`, `plistContent`, `scheduleXml`,
 * `cronLines`, `cronInstall`, `cronRemove`) carry the byte-exact logic and are
 * diff-tested; the exec wrappers are thin and fake-binary smoke-tested.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** v2 launchd tag prefix (bin/roll 8172). */
export const LAUNCHD_LABEL_PREFIX = "com.roll";
/** v2 Linux crontab marker (bin/roll 7279 `_LOOP_TAG`). */
export const LOOP_TAG = "# roll-loop";
/** v2 daily-service StartInterval, FIX-105 known-good (bin/roll 8253). */
export const DAILY_START_INTERVAL_SEC = 86400;

// ─── launchd label / plist path (pure — mirrors 8170-8197) ────────────────────

/** `com.roll.<svc>.<slug>` (bin/roll 8172). The slug is supplied by the caller
 *  (git.ts `projectIdentity`), keeping this pure. */
export function launchdLabel(svc: string, slug: string): string {
  return `${LAUNCHD_LABEL_PREFIX}.${svc}.${slug}`;
}

/** `<launchdDir>/<label>.plist` (bin/roll 8196). */
export function launchdPlistPath(svc: string, slug: string, launchdDir: string): string {
  return `${launchdDir}/${launchdLabel(svc, slug)}.plist`;
}

// ─── plist schedule_xml + content (pure, BYTE-EXACT — mirrors 8235-8289) ──────

/** A schedule for a launchd service, as the oracle's `_install_launchd_plists`
 *  matrix derives it (bin/roll 9680-9684). */
export type LaunchdSchedule =
  | { kind: "interval"; periodMinutes: number } // non-daily: StartInterval=period*60.
  | { kind: "daily"; hour: number; minute: number; calendar?: boolean }; // dream.

/**
 * Generate the `schedule_xml` fragment EXACTLY as bin/roll 8235-8260 — including
 * the two-space indentation and embedded newlines the heredoc produces:
 *   - interval                → `  <key>StartInterval</key>\n  <integer>N</integer>`.
 *   - daily + calendar (opt-in ROLL_DREAM_CALENDAR=1) → array-style
 *     StartCalendarInterval with Hour + Minute (8241-8249).
 *   - daily (default, FIX-105) → `  <key>StartInterval</key>\n  <integer>86400</integer>`.
 */
export function scheduleXml(schedule: LaunchdSchedule): string {
  if (schedule.kind === "interval") {
    const interval = schedule.periodMinutes * 60; // bin/roll 8257
    return `  <key>StartInterval</key>\n  <integer>${interval}</integer>`;
  }
  if (schedule.calendar === true) {
    // bin/roll 8241-8249 — array-style StartCalendarInterval (opt-in).
    return [
      "  <key>StartCalendarInterval</key>",
      "  <array>",
      "    <dict>",
      "      <key>Hour</key>",
      `      <integer>${schedule.hour}</integer>`,
      "      <key>Minute</key>",
      `      <integer>${schedule.minute}</integer>`,
      "    </dict>",
      "  </array>",
    ].join("\n");
  }
  // bin/roll 8252-8253 — FIX-105 default.
  return `  <key>StartInterval</key>\n  <integer>${DAILY_START_INTERVAL_SEC}</integer>`;
}

/** Inputs for {@link plistContent} — one per cited `_write_launchd_plist` arg. */
export interface PlistInput {
  label: string;
  runnerScript: string;
  projectPath: string;
  /** Baked PATH (`_detect_path_prepend` output, bin/roll 8225). Caller supplies
   *  it so this generator stays pure / diff-testable against any PATH. */
  pathValue: string;
  schedule: LaunchdSchedule;
}

/**
 * Generate the plist file CONTENT byte-for-byte as `_write_launchd_plist`
 * (bin/roll 8262-8289). The oracle assembles `$content` (no trailing newline)
 * then writes it with `printf '%s\n'`, appending exactly ONE trailing newline —
 * which this function includes so a byte-compare against the written file
 * matches. Mirrors the heredoc's escaped double-quotes (rendered as literal `"`)
 * and the `${schedule_xml}` interpolation on its own line.
 */
export function plistContent(input: PlistInput): string {
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${input.label}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    "    <string>/bin/bash</string>",
    "    <string>-l</string>",
    `    <string>${input.runnerScript}</string>`,
    "  </array>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>PATH</key>",
    `    <string>${input.pathValue}</string>`,
    "  </dict>",
    scheduleXml(input.schedule),
    "  <key>WorkingDirectory</key>",
    `  <string>${input.projectPath}</string>`,
    "</dict>",
    "</plist>",
  ].join("\n");
  return `${body}\n`; // printf '%s\n' appends the single trailing newline.
}

// ─── launchctl exec wrappers (thin — mirror 9594/9740-9748/9925-9926) ─────────

/** Result of a `launchctl` invocation. */
export interface LaunchctlResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run `launchctl <args>`; never throws on non-zero exit (mirrors the oracle's
 *  uniformly lenient `2>/dev/null || true` launchctl calls). */
export async function launchctl(args: readonly string[]): Promise<LaunchctlResult> {
  try {
    const { stdout, stderr } = await execFileAsync("launchctl", [...args], { encoding: "utf8" });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    if (typeof err.code === "number") {
      return { code: err.code, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    }
    if (err.stdout !== undefined || err.stderr !== undefined) {
      return { code: 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    }
    throw e; // launchctl binary missing
  }
}

/** `gui/<uid>/<label>` domain target the oracle uses (bin/roll 9594/9740/…). */
export function guiTarget(uid: number, label: string): string {
  return `gui/${uid}/${label}`;
}

/**
 * `launchctl print gui/<uid>/<label>` — true iff exit 0 (FIX-098 loaded probe,
 * bin/roll 9594). The disabled-overrides DB is NOT consulted (the FIX-098 point).
 */
export async function isLoaded(uid: number, label: string): Promise<boolean> {
  const r = await launchctl(["print", guiTarget(uid, label)]);
  return r.code === 0;
}

/**
 * Install/activate a plist (FIX-098 enable+bootstrap pair, bin/roll 9925-9926):
 *   `launchctl enable gui/<uid>/<label>` then
 *   `launchctl bootstrap gui/<uid> <plist>`.
 * enable clears any disable-override; bootstrap registers with launchd. Both are
 * lenient in the oracle. Returns the bootstrap result.
 */
export async function install(
  uid: number,
  label: string,
  plistPath: string,
): Promise<LaunchctlResult> {
  await launchctl(["enable", guiTarget(uid, label)]);
  return launchctl(["bootstrap", `gui/${uid}`, plistPath]);
}

/**
 * Reinstall on content change (FIX-027, bin/roll 9740-9741):
 *   `launchctl bootout gui/<uid>/<label>` then
 *   `launchctl bootstrap gui/<uid> <plist>`.
 * bootout/bootstrap (vs unload/load) preserves the enabled flag in the overrides
 * DB. Returns the bootstrap result.
 */
export async function reinstall(
  uid: number,
  label: string,
  plistPath: string,
): Promise<LaunchctlResult> {
  await launchctl(["bootout", guiTarget(uid, label)]);
  return launchctl(["bootstrap", `gui/${uid}`, plistPath]);
}

/**
 * Block macOS FSEvents auto-bootstrap for a brand-new plist (FIX-059, bin/roll
 * 9748): `launchctl disable gui/<uid>/<label>`.
 */
export async function disableNew(uid: number, label: string): Promise<LaunchctlResult> {
  return launchctl(["disable", guiTarget(uid, label)]);
}

/**
 * Uninstall/deactivate a plist (bin/roll 3152 apply-path / general off-path):
 *   `launchctl bootout gui/<uid>/<label>`.
 * (The apply path uses `unload -w <plist>`; bootout is the FIX-098-era
 * equivalent and is what the modern uninstall path issues. Both are lenient.)
 */
export async function uninstall(uid: number, label: string): Promise<LaunchctlResult> {
  return launchctl(["bootout", guiTarget(uid, label)]);
}

// ─── Linux crontab (pure generators + read-modify-write — mirror 9958/10012) ──

/** A loop/dream cron command pair, as `_loop_on` builds (bin/roll 9953-9956). */
export interface CronCommands {
  /** Full loop command string (`cd "<path>" && <skill cmd> >> <log> 2>&1`). */
  loopCmd: string;
  /** Loop fire minute (bin/roll 9898 `loop_minute`). */
  loopMinute: number;
  /** Full dream command string. */
  dreamCmd: string;
  /** Dream fire minute (bin/roll 9903). */
  dreamMinute: number;
  /** Dream fire hour (bin/roll 9902). */
  dreamHour: number;
  /** Project path the `# roll-loop:<path>` tag is keyed on. */
  projectPath: string;
}

/**
 * Generate the two crontab LINES `_loop_on` appends (bin/roll 9960-9961),
 * byte-exact (FIX-195 retired the brief entry — only loop + dream remain):
 *   `<loopMinute> * * * * <loopCmd> # roll-loop:<path>`
 *   `<dreamMinute> <dreamHour> * * * <dreamCmd> # roll-loop:<path>`
 * Each via `printf "%d * * * * %s %s:%s\n"` / `printf "%d %d * * * %s %s:%s\n"`.
 * Returns the two lines WITHOUT trailing newlines (caller joins).
 */
export function cronLines(c: CronCommands): [string, string] {
  const tag = `${LOOP_TAG}:${c.projectPath}`;
  const loop = `${c.loopMinute} * * * * ${c.loopCmd} ${tag}`;
  const dream = `${c.dreamMinute} ${c.dreamHour} * * * ${c.dreamCmd} ${tag}`;
  return [loop, dream];
}

/**
 * Pure read-modify-write for `_loop_on`'s crontab install (bin/roll 9958-9962):
 * pipe the EXISTING `crontab -l` output, then append the two new lines, then
 * `| crontab -`. Given the current crontab text, return the NEW crontab text.
 *
 * Mirrors the oracle exactly: it does NOT dedup (a second `roll loop on` would
 * append again — the caller gates on the already-enabled probe via
 * {@link cronHasEntry} first, as `_loop_on` does at 9944). Each appended line
 * gets a trailing newline (printf `\n`); the existing block is preserved
 * verbatim.
 */
export function cronInstall(currentCrontab: string, c: CronCommands): string {
  const [loop, dream] = cronLines(c);
  // bash: `(crontab -l 2>/dev/null; printf ...; printf ...) | crontab -`.
  // `crontab -l` output already ends in a newline when non-empty; an empty
  // crontab contributes nothing. We append each printf line + its \n.
  const base = currentCrontab === "" ? "" : ensureTrailingNewline(currentCrontab);
  return `${base}${loop}\n${dream}\n`;
}

/**
 * Pure read-modify-write for `_loop_off`'s crontab removal (bin/roll 10015):
 * `crontab -l | grep -v "<TAG>:<path>" | crontab -`. Returns the crontab text
 * with every line CONTAINING the `# roll-loop:<path>` tag removed (substring
 * match, exactly like `grep -v` without `-F`/`-w` — but the tag has no regex
 * metacharacters in practice; we match as a literal substring to mirror the
 * observable behavior). Preserves the trailing-newline shape grep produces.
 */
export function cronRemove(currentCrontab: string, projectPath: string): string {
  const tag = `${LOOP_TAG}:${projectPath}`;
  const lines = currentCrontab.split("\n");
  // split on "\n": a trailing newline yields a final "" element — drop it so we
  // don't emit a spurious blank line, then re-append the trailing newline grep
  // keeps when any line survives.
  const hadTrailing = currentCrontab.endsWith("\n");
  if (hadTrailing) lines.pop();
  const kept = lines.filter((l) => !l.includes(tag));
  if (kept.length === 0) return "";
  return `${kept.join("\n")}\n`;
}

/** True iff the crontab text already carries the project's `# roll-loop:<path>`
 *  tag — mirrors the `crontab -l | grep -q "<TAG>:<path>"` probes
 *  (bin/roll 9944/10012). */
export function cronHasEntry(currentCrontab: string, projectPath: string): boolean {
  return currentCrontab.includes(`${LOOP_TAG}:${projectPath}`);
}

// ─── crontab exec wrappers (thin — mirror crontab -l / crontab -) ─────────────

/** Read the current crontab (`crontab -l`). Returns "" when no crontab exists
 *  (the oracle's `crontab -l 2>/dev/null` → empty on a missing crontab). */
export async function crontabRead(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("crontab", ["-l"], { encoding: "utf8" });
    return stdout;
  } catch {
    return ""; // no crontab / error → empty, mirroring `2>/dev/null`.
  }
}

/**
 * Write a new crontab from stdin (`<text> | crontab -`). Returns the exit code;
 * never throws on a non-zero exit (the oracle pipes and continues). Throws only
 * on spawn failure (crontab binary missing).
 */
export async function crontabWrite(text: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = execFile("crontab", ["-"], (err) => {
      if (err === null) {
        resolve(0);
      } else if (typeof (err as { code?: number }).code === "number") {
        resolve((err as { code: number }).code);
      } else if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(err); // no crontab binary
      } else {
        resolve(1);
      }
    });
    child.stdin?.end(text);
  });
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}
