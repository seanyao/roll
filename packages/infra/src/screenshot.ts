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
import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunOut } from "./evidence.js";

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

function fileNonEmpty(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).size > 0;
  } catch {
    return false;
  }
}

const DEFAULT_REGION = "0,0,1280,800";

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
export function terminalOpenScript(line: string, r: { x: number; y: number; w: number; h: number }): string {
  const esc = line.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    'tell application "Terminal"',
    "  activate",
    `  do script "${esc}"`,
    "  delay 1.5",
    `  set bounds of front window to {${r.x}, ${r.y}, ${r.x + r.w}, ${r.y + r.h}}`,
    "end tell",
  ].join("\n");
}

/** AppleScript that closes the front Terminal window without a save prompt. */
export function terminalCloseScript(): string {
  return 'tell application "Terminal" to close front window saving no';
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
      // GUI-session probe: launchctl reports "Aqua" only inside a graphical login.
      const gui = await run("launchctl", ["managername"]);
      if (gui.code !== 0 || !gui.stdout.includes("Aqua")) return skip("no GUI session");
      const rect = parseRegion(req.region ?? DEFAULT_REGION);
      if (rect === null) return skip("bad region");
      const line =
        req.tmux !== undefined && req.tmux !== "" ? `tmux attach -t ${req.tmux}` : (req.command ?? "");
      const opened = await run("osascript", ["-e", terminalOpenScript(line, rect)]);
      if (opened.code !== 0) return skip("osascript Terminal open failed");
      const shot = await run("screencapture", ["-x", "-R", req.region ?? DEFAULT_REGION, req.out]);
      // screencapture exits non-zero when Screen Recording permission is absent.
      if (shot.code !== 0) {
        await run("osascript", ["-e", terminalCloseScript()]); // best-effort cleanup
        return skip("screencapture failed (screen-recording permission?)");
      }
      await run("osascript", ["-e", terminalCloseScript()]); // close the window we opened
    }
  } catch {
    return skip("capture errored");
  }

  return fileNonEmpty(req.out)
    ? { kind: req.kind, out: req.out, taken: true }
    : skip("empty capture (tool exit code lied)");
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
