/**
 * US-ATTEST-004 — three-surface screenshot dispatcher (web / iOS / Android).
 *
 * Each surface carries its own SKIP preconditions (design D6) and the contract
 * is deletion-not-placeholder: a skipped capture returns `taken:false` with a
 * reason, and the report drops the whole screenshot block — no placeholder
 * image, no warning text. CLI/TUI stories never reach this module (their
 * visual evidence is the ANSI→HTML text capture, US-ATTEST-002).
 *
 *   web           `npx -y playwright@latest screenshot <url> <out>`
 *                 skip: ROLL_ATTEST_NO_BROWSER=1 · npx/network unavailable
 *   mobile-ios    `xcrun simctl io booted screenshot <out>`
 *                 skip: non-macOS · no booted simulator
 *   mobile-android`adb exec-out screencap -p > <out>` (sh -c redirect)
 *                 skip: adb absent · no connected device
 *   terminal      osascript opens a positioned Terminal window running an
 *                 acceptance command (or attaching the tmux observability
 *                 session), then `screencapture -x -R <rect>` grabs the pixels
 *                 and the window is closed. This is the UNATTENDED lane
 *                 (US-ATTEST-011): a headless loop cycle self-produces a real
 *                 terminal screenshot instead of waiting for a human to grab it.
 *                 skip: ROLL_ATTEST_NO_TERMINAL=1 · non-macOS · no GUI (Aqua)
 *                 session · no screen-recording permission (screencapture fails)
 *
 * All process touches go through an injectable runner; a capture only counts
 * as TAKEN when the output file exists and is non-empty (tool exit codes lie).
 */
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import type { RunOut } from "./evidence.js";
import { containsSecret } from "./redact.js";

const execFileAsync = promisify(execFile);

export type ShotRun = (cmd: string, argv: readonly string[]) => Promise<RunOut>;

const defaultRun: ShotRun = async (cmd, argv) => {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, [...argv], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof err.code === "number" ? err.code : 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
};

export type ScreenshotKind = "web" | "mobile-ios" | "mobile-android" | "terminal";

export interface ScreenshotRequest {
  kind: ScreenshotKind;
  /** Absolute output path (.png). */
  out: string;
  /** Target URL — required for kind=web. */
  url?: string;
  /** kind=terminal: acceptance command to run in the Terminal window. */
  command?: string;
  /** kind=terminal: tmux session to attach instead of running a command. */
  tmux?: string;
  /** kind=terminal: screencapture `-R` rectangle "x,y,w,h"; defaults to a 1280×800 window. */
  region?: string;
}

export interface ScreenshotResult {
  kind: ScreenshotKind;
  out: string;
  taken: boolean;
  /** Human skip/fail reason when not taken (drives the deletion contract). */
  skipped?: string;
}

export interface ScreenshotDeps {
  run?: ShotRun;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}

export type CapturePhase = "before" | "after" | "gate";

export interface CaptureMarker {
  phase: CapturePhase;
  kind: ScreenshotKind;
  stem: string;
  target?: string;
}

export interface CaptureMarkerOptions {
  runDir: string;
  deps?: ScreenshotDeps;
  region?: string;
}

const SAFE_STEM = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

function fileNonEmpty(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).size > 0;
  } catch {
    return false;
  }
}

const DEFAULT_REGION = "0,0,1280,800";
const TERMINAL_DONE_TIMEOUT_MS = 120_000;
const TERMINAL_DONE_POLL_MS = 100;

/** Parse one agent→harness screenshot signal line. */
export function parseCaptureMarker(line: string): CaptureMarker | null {
  const m = /^::roll-capture\s+(before|after|gate)\s+(web|mobile-ios|mobile-android|terminal)\s+([A-Za-z0-9_.-]+)(?:\s+(.+))?\s*$/.exec(
    line.trim(),
  );
  if (m === null) return null;
  const phase = m[1] as CapturePhase;
  const kind = m[2] as ScreenshotKind;
  const stem = m[3] ?? "";
  if (!SAFE_STEM.test(stem)) return null;
  const target = (m[4] ?? "").trim();
  return { phase, kind, stem, ...(target !== "" ? { target } : {}) };
}

function markerOutPath(runDir: string, marker: CaptureMarker): string {
  return join(runDir, "screenshots", `${marker.phase}-${marker.stem}.png`);
}

function requestFromMarker(marker: CaptureMarker, out: string, region?: string): ScreenshotRequest {
  if (marker.kind === "web") {
    return { kind: "web", out, ...(marker.target !== undefined ? { url: marker.target } : {}) };
  }
  if (marker.kind === "terminal") {
    const target = marker.target ?? "";
    if (target.startsWith("tmux:")) {
      return { kind: "terminal", out, tmux: target.slice("tmux:".length), ...(region !== undefined ? { region } : {}) };
    }
    return { kind: "terminal", out, command: target, ...(region !== undefined ? { region } : {}) };
  }
  return { kind: marker.kind, out };
}

/** Execute a parsed capture marker against one run frame. */
export function captureFromMarker(
  marker: CaptureMarker,
  opts: CaptureMarkerOptions,
): Promise<ScreenshotResult> {
  const out = markerOutPath(opts.runDir, marker);
  mkdirSync(join(opts.runDir, "screenshots"), { recursive: true });
  return captureScreenshot(requestFromMarker(marker, out, opts.region), opts.deps ?? {});
}

/** Parse a screencapture `-R` rect "x,y,w,h" into numbers; null when malformed. */
export function parseRegion(region: string): { x: number; y: number; w: number; h: number } | null {
  const parts = region.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = parts as [number, number, number, number];
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/**
 * AppleScript that opens one Terminal window running `line`, sizes it to the
 * capture rectangle (bounds are {x1,y1,x2,y2} — top-left + bottom-right, so we
 * derive them from the -R rect's origin + size), and gives it a moment to
 * render before the screenshot is taken. `line` is embedded inside a quoted
 * `do script "…"`, so its double-quotes/backslashes are escaped.
 */
export function terminalOpenScript(line: string, r: { x: number; y: number; w: number; h: number }, title?: string): string {
  const esc = appleScriptString(line);
  const setTitle = title === undefined ? [] : [`  set custom title of front window to "${appleScriptString(title)}"`];
  return [
    'tell application "Terminal"',
    "  activate",
    `  do script "${esc}"`,
    // FIX-271: on a cold Terminal launch "front window" may not exist yet —
    // retry the title set instead of hard-failing the whole open.
    ...(setTitle.length === 0
      ? []
      : ["  repeat 20 times", "    try", "  " + setTitle[0], "      exit repeat", "    on error", "      delay 0.2", "    end try", "  end repeat"]),
    "  delay 1.5",
    "  try",
    `    set bounds of front window to {${r.x}, ${r.y}, ${r.x + r.w}, ${r.y + r.h}}`,
    "  end try",
    "end tell",
  ].join("\n");
}

/** AppleScript that closes the Terminal window we opened without a save prompt. */
export function terminalCloseScript(title?: string): string {
  if (title === undefined) return 'tell application "Terminal" to close front window saving no';
  const esc = appleScriptString(title);
  // FIX-271: match on the window NAME (a window-level property that embeds the
  // custom title). `custom title of w` reads through the selected tab and
  // throws -1728 once the tab is torn down — the try-guard then swallowed the
  // error and the window survived as an unclosable ghost.
  return [
    'tell application "Terminal"',
    "  repeat with w in windows",
    "    try",
    `      if name of w contains "${esc}" then`,
    "        close w saving no",
    "        exit repeat",
    "      end if",
    "    end try",
    "  end repeat",
    "end tell",
  ].join("\n");
}

/**
 * FIX-271 — AppleScript that reads the bounds of the window we opened (matched
 * by custom title). Returns "x1, y1, x2, y2" on stdout, or "" when the window
 * is gone (caller falls back to the configured capture rectangle).
 */
export function terminalBoundsScript(title: string): string {
  const esc = appleScriptString(title);
  return [
    'tell application "Terminal"',
    "  repeat with w in windows",
    "    try",
    `      if name of w contains "${esc}" then`,
    // FIX-271: raise the window before reporting bounds — `screencapture -R`
    // shoots the VISIBLE screen, so a window left on another Space/behind
    // others would yield someone else's pixels (privacy hazard, observed live).
    "        set index of w to 1",
    "        activate",
    "        delay 0.3",
    "        return bounds of w",
    "      end if",
    "    end try",
    "  end repeat",
    '  return ""',
    "end tell",
  ].join("\n");
}

/** Resolve the live window rect for `screencapture -R`; null → fall back to the configured rect. */
async function resolveWindowRect(
  title: string,
  run: ShotRun,
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const r = await run("osascript", ["-e", terminalBoundsScript(title)]);
  if (r.code !== 0) return null;
  const parts = r.stdout.trim().split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x1, y1, x2, y2] = parts as [number, number, number, number];
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * FIX-272 — retire the shell INSIDE our window instead of AppleScript-closing
 * the window. `close w` tears the tab while Terminal's own shellExitAction
 * (profile "when the shell exits": 0=close, 1=close on clean exit) races to
 * close the same window — the loser leaves a dead-tab ghost that no further
 * `close` can remove. Sending `exit` lets the shell die cleanly and the
 * user's own setting collapse the window; only the "never close" profile (2)
 * needs the close fallback.
 */
export function terminalExitTabScript(title: string): string {
  const esc = appleScriptString(title);
  return [
    "-- roll-attest-exit-tab",
    'tell application "Terminal"',
    "  repeat with w in windows",
    "    try",
    `      if name of w contains "${esc}" then`,
    '        do script "exit" in tab 1 of w',
    "        exit repeat",
    "      end if",
    "    end try",
    "  end repeat",
    "end tell",
  ].join("\n");
}

/** Probe whether our capture window still exists (prints yes/no). */
export function terminalWindowExistsScript(title: string): string {
  const esc = appleScriptString(title);
  return [
    "-- roll-attest-exists-probe",
    'tell application "Terminal"',
    "  repeat with w in windows",
    "    try",
    `      if name of w contains "${esc}" then return "yes"`,
    "    end try",
    "  end repeat",
    '  return "no"',
    "end tell",
  ].join("\n");
}

/**
 * Tear down the capture window. Command lane: exit-first (FIX-272), close only
 * as fallback. Tmux lane: plain close — `exit` would land inside the attached
 * session. Returns false when the fallback close itself errored.
 */
async function teardownCaptureWindow(windowTitle: string, commandLane: boolean, run: ShotRun): Promise<boolean> {
  if (commandLane) {
    await run("osascript", ["-e", terminalExitTabScript(windowTitle)]);
    for (let i = 0; i < 10; i++) {
      const probe = await run("osascript", ["-e", terminalWindowExistsScript(windowTitle)]);
      if (probe.code === 0 && probe.stdout.includes("no")) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const closed = await run("osascript", ["-e", terminalCloseScript(windowTitle)]);
  return closed.code === 0;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function appleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function terminalWindowTitle(out: string): string {
  const safe = out.replace(/[^A-Za-z0-9_.-]+/g, "-");
  return `roll-attest-${safe.slice(Math.max(0, safe.length - 80))}`;
}

function terminalCommandWithDoneFile(line: string, doneFile: string): string {
  const done = shellQuote(doneFile);
  // FIX-271: no trailing `exit` — a clean shell exit lets Terminal auto-close
  // the window, and the new wait-then-shoot order needs the OUTPUT still on
  // screen when the sentinel lands. The shell parks at its prompt; we close
  // the window ourselves after the capture.
  return [
    `(${line})`,
    "__roll_status=$?",
    `printf '%s' "$__roll_status" > ${done}`,
  ].join("; ");
}

function terminalDoneWaitScript(doneFile: string): string {
  const attempts = Math.ceil(TERMINAL_DONE_TIMEOUT_MS / TERMINAL_DONE_POLL_MS);
  const sleepSeconds = String(TERMINAL_DONE_POLL_MS / 1000);
  const done = shellQuote(doneFile);
  return `i=0; while [ ! -f ${done} ]; do if [ "$i" -ge ${attempts} ]; then exit 1; fi; i=$((i + 1)); sleep ${sleepSeconds}; done`;
}

async function waitForTerminalCommandExit(doneFile: string, run: ShotRun): Promise<boolean> {
  const waited = await run("sh", ["-lc", terminalDoneWaitScript(doneFile)]);
  try {
    rmSync(doneFile, { force: true });
  } catch {
    // cleanup only; the wait result is the signal
  }
  return waited.code === 0;
}

/** Capture one screenshot; never throws — skip reasons over exceptions. */
export async function captureScreenshot(
  req: ScreenshotRequest,
  deps: ScreenshotDeps = {},
): Promise<ScreenshotResult> {
  const run = deps.run ?? defaultRun;
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const skip = (reason: string): ScreenshotResult => ({ kind: req.kind, out: req.out, taken: false, skipped: reason });

  try {
    if (req.kind === "web") {
      if ((env["ROLL_ATTEST_NO_BROWSER"] ?? "") === "1") return skip("ROLL_ATTEST_NO_BROWSER=1");
      if (req.url === undefined || req.url === "") return skip("no url");
      const r = await run("npx", ["-y", "playwright@latest", "screenshot", req.url, req.out]);
      if (r.code !== 0) return skip("playwright unavailable or capture failed");
    } else if (req.kind === "mobile-ios") {
      if (platform !== "darwin") return skip("not macOS");
      const booted = await run("xcrun", ["simctl", "list", "devices", "booted"]);
      if (booted.code !== 0 || !booted.stdout.includes("(Booted)")) return skip("no booted simulator");
      const r = await run("xcrun", ["simctl", "io", "booted", "screenshot", req.out]);
      if (r.code !== 0) return skip("simctl screenshot failed");
    } else if (req.kind === "mobile-android") {
      const devices = await run("adb", ["devices"]);
      const connected = devices.stdout
        .split("\n")
        .slice(1)
        .some((l) => /\bdevice$/.test(l.trim()));
      if (devices.code !== 0 || !connected) return skip("no adb device connected");
      // binary stdout → shell redirect through the same seam.
      const r = await run("sh", ["-c", `adb exec-out screencap -p > '${req.out}'`]);
      if (r.code !== 0) return skip("screencap failed");
    } else {
      // terminal lane (US-ATTEST-011): unattended self-capture on macOS GUI hosts.
      if ((env["ROLL_ATTEST_NO_TERMINAL"] ?? "") === "1") return skip("ROLL_ATTEST_NO_TERMINAL=1");
      if (platform !== "darwin") return skip("not macOS");
      const rawLine =
        req.tmux !== undefined && req.tmux !== "" ? `tmux attach -t ${req.tmux}` : (req.command ?? "");
      // RED LINE (US-ATTEST-012): a token baked into pixels can't be un-baked.
      // Refuse to screen-capture a command that carries a secret — redact &
      // reshoot. Checked BEFORE any spawn so the secret never reaches the screen.
      if (containsSecret(rawLine)) return skip("secret in capture command — redact & reshoot");
      // GUI-session probe: launchctl reports "Aqua" only inside a graphical login.
      const gui = await run("launchctl", ["managername"]);
      if (gui.code !== 0 || !gui.stdout.includes("Aqua")) return skip("no GUI session");
      const rect = parseRegion(req.region ?? DEFAULT_REGION);
      if (rect === null) return skip("bad region");
      // FIX-271 follow-up: the sentinel path MUST be absolute — the Terminal
      // window's shell starts at $HOME, so a relative done-file lands there
      // while the waiter polls it relative to the attest process cwd: the two
      // sides never meet and every capture "times out".
      const commandDoneFile =
        req.tmux === undefined && req.command !== undefined && req.command !== "" ? resolve(`${req.out}.done`) : undefined;
      if (commandDoneFile !== undefined) {
        try {
          rmSync(commandDoneFile, { force: true });
        } catch {
          // stale sentinel cleanup only
        }
      }
      const line = commandDoneFile !== undefined ? terminalCommandWithDoneFile(rawLine, commandDoneFile) : rawLine;
      const windowTitle = terminalWindowTitle(req.out);
      const opened = await run("osascript", ["-e", terminalOpenScript(line, rect, windowTitle)]);
      if (opened.code !== 0) return skip("osascript Terminal open failed");
      // FIX-271: the old order shot the screen IMMEDIATELY after the window
      // opened (blank prompt, command not yet rendered) at the CONFIGURED
      // rectangle (whatever happened to live there). Correct order: wait for
      // the command to exit, read the window's ACTUAL bounds, shoot that rectangle,
      // then close the window we opened.
      if (commandDoneFile !== undefined && !(await waitForTerminalCommandExit(commandDoneFile, run))) {
        return skip("terminal command still running; window left open to avoid macOS termination prompt");
      }
      const liveRect = await resolveWindowRect(windowTitle, run);
      // FIX-271: never shoot a blind rectangle — if our window can't be found
      // and raised, the configured rect would capture WHATEVER the owner has
      // on screen (live incident: a Teams chat landed in the evidence png).
      if (liveRect === null) {
        if (!(await teardownCaptureWindow(windowTitle, commandDoneFile !== undefined, run))) {
          return skip("capture window not found; Terminal close failed");
        }
        return skip("capture window not found — refusing a blind-region shot");
      }
      const shot = await run("screencapture", ["-x", "-R", `${liveRect.x},${liveRect.y},${liveRect.w},${liveRect.h}`, req.out]);
      // screencapture exits non-zero when Screen Recording permission is absent.
      if (shot.code !== 0) {
        if (!(await teardownCaptureWindow(windowTitle, commandDoneFile !== undefined, run))) {
          return skip("screencapture failed; Terminal close failed");
        }
        return skip("screencapture failed (screen-recording permission?)");
      }
      if (!(await teardownCaptureWindow(windowTitle, commandDoneFile !== undefined, run))) {
        return skip("Terminal close failed after capture");
      }
    }
  } catch {
    return skip("capture errored");
  }

  return fileNonEmpty(req.out)
    ? { kind: req.kind, out: req.out, taken: true }
    : skip("empty capture (tool exit code lied)");
}

/**
 * Deletion-contract bridge between a capture and the acceptance report: a TAKEN
 * shot becomes a `screenshot` evidence ref the report renders as a figure; a
 * SKIPPED shot becomes `null`, so the unattended gate references no placeholder
 * and the report drops the block entirely (US-ATTEST-011 honest-skip path).
 * `href` is the screenshot path relative to the report's run dir.
 */
export function screenshotEvidenceRef(
  result: ScreenshotResult,
  href: string,
): { kind: "screenshot"; label: string; href: string } | null {
  return result.taken ? { kind: "screenshot", label: result.kind, href } : null;
}

/** Capture a batch; results keep request order. Skips never abort the batch. */
export async function captureAll(
  reqs: readonly ScreenshotRequest[],
  deps: ScreenshotDeps = {},
): Promise<ScreenshotResult[]> {
  const out: ScreenshotResult[] = [];
  for (const r of reqs) out.push(await captureScreenshot(r, deps));
  return out;
}
