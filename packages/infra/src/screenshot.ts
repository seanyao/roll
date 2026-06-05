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

export type ScreenshotKind = "web" | "mobile-ios" | "mobile-android";

export interface ScreenshotRequest {
  kind: ScreenshotKind;
  /** Absolute output path (.png). */
  out: string;
  /** Target URL — required for kind=web. */
  url?: string;
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
    } else {
      const devices = await run("adb", ["devices"]);
      const connected = devices.stdout
        .split("\n")
        .slice(1)
        .some((l) => /\bdevice$/.test(l.trim()));
      if (devices.code !== 0 || !connected) return skip("no adb device connected");
      // binary stdout → shell redirect through the same seam.
      const r = await run("sh", ["-c", `adb exec-out screencap -p > '${req.out}'`]);
      if (r.code !== 0) return skip("screencap failed");
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
