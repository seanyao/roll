import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, readSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { PLAYWRIGHT_INSTALL_CHROMIUM, chromiumInstalled, PLAYWRIGHT_VERSION, PLAYWRIGHT_PIN } from "@roll/infra";

export type ExternalToolStatus = "ok" | "missing" | "permission-missing" | "unknown";

export interface ExternalToolDeclaration {
  id: string;
  label: string;
  purpose: string;
  required: boolean;
  install: string;
  authorize: string;
  impact: string;
}

export interface ExternalToolState extends ExternalToolDeclaration {
  status: ExternalToolStatus;
  detail: string;
  repairCommand?: string;
}

export interface ExternalToolDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  commandOnPath: (bin: string) => boolean;
  execFile: (cmd: string, args: readonly string[]) => { code: number; stdout: string; stderr: string };
  readDir: (path: string) => string[];
  exists: (path: string) => boolean;
}

export const EXTERNAL_TOOL_DECLARATIONS: readonly ExternalToolDeclaration[] = [
  {
    id: "screencapture",
    label: "macOS screencapture",
    purpose: "Terminal and GUI screenshot evidence on macOS.",
    required: false,
    install: "Built into macOS.",
    authorize: "Open System Settings > Privacy & Security > Screen Recording and allow the terminal running roll.",
    impact: "Terminal/GUI screenshots are skipped; web evidence may fall back to headless Chromium.",
  },
  {
    id: "playwright-chromium",
    label: "Playwright Chromium",
    purpose: "Headless web screenshots for attest and dossier visual evidence.",
    required: false,
    install: PLAYWRIGHT_INSTALL_CHROMIUM,
    authorize: "No OS permission needed.",
    impact: "Web screenshot evidence is skipped when GUI capture is unavailable.",
  },
];

export function defaultExternalToolDeps(): ExternalToolDeps {
  return {
    platform: externalToolPlatform(process.env["_ROLL_EXTERNAL_TOOLS_PLATFORM"]) ?? process.platform,
    env: process.env,
    home: homedir(),
    commandOnPath,
    execFile: (cmd, args) => {
      const r = spawnSync(cmd, [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 });
      return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    readDir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
    exists: existsSync,
  };
}

function externalToolPlatform(raw: string | undefined): NodeJS.Platform | undefined {
  if (
    raw === "aix" ||
    raw === "android" ||
    raw === "darwin" ||
    raw === "freebsd" ||
    raw === "haiku" ||
    raw === "linux" ||
    raw === "openbsd" ||
    raw === "sunos" ||
    raw === "win32" ||
    raw === "cygwin" ||
    raw === "netbsd"
  ) {
    return raw;
  }
  return undefined;
}

export function commandOnPath(bin: string): boolean {
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    const p = join(dir, bin);
    try {
      accessSync(p, constants.X_OK);
      return true;
    } catch {
      /* keep scanning */
    }
  }
  return false;
}

export function collectExternalTools(deps: ExternalToolDeps = defaultExternalToolDeps()): ExternalToolState[] {
  return EXTERNAL_TOOL_DECLARATIONS.map((decl) => {
    if (decl.id === "screencapture") return screencaptureState(decl, deps);
    return playwrightChromiumState(decl, deps);
  });
}

function screencaptureState(decl: ExternalToolDeclaration, deps: ExternalToolDeps): ExternalToolState {
  if (deps.platform !== "darwin") {
    return { ...decl, status: "unknown", detail: "macOS-only tool; not applicable on this host." };
  }
  if (!deps.commandOnPath("screencapture")) {
    return { ...decl, status: "missing", detail: "screencapture is not on PATH.", repairCommand: "xcode-select --install" };
  }
  const tmp = join(mkdtempSync(join(tmpdir(), "roll-screen-probe-")), "probe.png");
  const r = deps.execFile("screencapture", ["-x", "-R", "0,0,1,1", tmp]);
  try {
    rmSync(tmp, { force: true });
    rmSync(dirname(tmp), { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
  if (r.code === 0) return { ...decl, status: "ok", detail: "Installed and Screen Recording permission is usable." };
  return {
    ...decl,
    status: "permission-missing",
    detail: "screencapture ran but could not capture pixels; Screen Recording permission is likely missing.",
    repairCommand: "open x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  };
}

function playwrightChromiumState(decl: ExternalToolDeclaration, deps: ExternalToolDeps): ExternalToolState {
  if (!deps.commandOnPath("npx")) {
    return { ...decl, status: "missing", detail: "npx is not on PATH.", repairCommand: "npm install -g npm" };
  }
  const cache = deps.env["PLAYWRIGHT_BROWSERS_PATH"] ?? defaultPlaywrightBrowsersPath(deps);
  const entries = deps.readDir(cache);
  const hasChromium = entries.some((name) => /^chromium(-|_headless_shell-|$)/.test(name) || /^chromium_headless_shell-/.test(name)) || deps.exists(join(cache, "chromium"));
  if (hasChromium) {
    return { ...decl, status: "ok", detail: `Chromium browser files found in ${cache} (playwright pinned v${PLAYWRIGHT_VERSION}).` };
  }
  return {
    ...decl,
    status: "missing",
    detail: `No Chromium browser files found in ${cache} (playwright pinned v${PLAYWRIGHT_VERSION}).`,
    repairCommand: PLAYWRIGHT_INSTALL_CHROMIUM,
  };
}

function defaultPlaywrightBrowsersPath(deps: ExternalToolDeps): string {
  if (deps.platform === "darwin") return join(deps.home, "Library", "Caches", "ms-playwright");
  if (deps.platform === "win32") return join(deps.env["LOCALAPPDATA"] ?? join(deps.home, "AppData", "Local"), "ms-playwright");
  return join(deps.home, ".cache", "ms-playwright");
}

export function renderExternalToolDoctorSection(states: readonly ExternalToolState[]): string[] {
  const lines = ["", "External tools", "外部工具", ""];
  for (const tool of states) {
    const marker = tool.status === "ok" ? "✓" : tool.status === "permission-missing" ? "!" : tool.status === "missing" ? "−" : "?";
    lines.push(`  ${marker} ${tool.label} — ${tool.status}`);
    lines.push(`    use: ${tool.purpose}`);
    lines.push(`    ${tool.detail}`);
    if (tool.repairCommand !== undefined) lines.push(`    fix: ${tool.repairCommand}`);
    if (tool.status !== "ok") lines.push(`    impact: ${tool.impact}`);
  }
  return lines;
}

export interface ExternalToolRequestDeps {
  states: () => ExternalToolState[];
  env: NodeJS.ProcessEnv;
  stdinIsTTY: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  readLine: () => string | null;
  execFile: (cmd: string, args: readonly string[]) => { code: number };
}

export function defaultExternalToolRequestDeps(): ExternalToolRequestDeps {
  return {
    states: () => collectExternalTools(),
    env: process.env,
    stdinIsTTY: process.stdin.isTTY === true,
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
    readLine: readStdinLine,
    execFile: (cmd, args) => {
      try {
        execFileSync(cmd, [...args], { stdio: "ignore" });
        return { code: 0 };
      } catch {
        return { code: 1 };
      }
    },
  };
}

function readStdinLine(): string | null {
  const fd = process.stdin.fd;
  if (fd === undefined) return null;
  const buf = Buffer.alloc(1024);
  try {
    const n = readSync(fd, buf, 0, buf.length, null);
    if (n <= 0) return null;
    return buf.toString("utf8", 0, n).split(/\r?\n/, 1)[0] ?? "";
  } catch {
    return null;
  }
}

export function guideExternalToolSetup(
  surface: "init" | "go",
  deps: ExternalToolRequestDeps = defaultExternalToolRequestDeps(),
): void {
  const missing = deps.states().filter((s) => s.status !== "ok");
  if (missing.length === 0) return;
  const forced = (deps.env["ROLL_EXTERNAL_TOOLS"] ?? "").trim().toLowerCase();
  if (forced === "" && !deps.stdinIsTTY) return;
  deps.stderr(`[roll] External tool setup (${surface})`);
  for (const tool of missing) {
    deps.stderr(`  ${tool.label}: ${tool.status}`);
    deps.stderr(`    impact: ${tool.impact}`);
    if (tool.repairCommand !== undefined) deps.stderr(`    fix: ${tool.repairCommand}`);
  }
  const answer =
    forced === "yes" || forced === "y"
      ? "y"
      : forced === "no" || forced === "n"
        ? "n"
        : deps.stdinIsTTY
          ? (deps.stderr("  Install/open missing tools now? [y/N]"), deps.readLine())
          : null;
  if (answer === null) {
    deps.stderr("  non-interactive: continuing without changes; evidence may be degraded.");
    return;
  }
  if (!/^y(es)?$/i.test(answer.trim())) {
    deps.stderr("  declined: continuing without changes; evidence may be degraded.");
    return;
  }
  for (const tool of missing) {
    if (tool.repairCommand === undefined) continue;
    const [cmd, ...args] = tool.repairCommand.split(" ");
    if (cmd === undefined || cmd === "") continue;
    const r = deps.execFile(cmd, args);
    deps.stderr(`  ${tool.label}: ${r.code === 0 ? "repair command started" : "repair command failed"}`);
  }
}

/**
 * FIX-394 AC2 — best-effort silent Chromium pre-install. Called during init
 * and at the start of every unattended loop cycle. When Chromium is already
 * cached the call is a cheap no-op (a readdir + exist check). When missing and
 * npx is reachable, runs `PLAYWRIGHT_INSTALL_CHROMIUM` with a generous timeout
 * and swallows all errors — this is an optional tool, never a hard gate.
 *
 * Returns `true` when Chromium was installed (or was already present), `false`
 * when the attempt failed or was skipped.
 */
export function silentPreinstallChromium(env: NodeJS.ProcessEnv = process.env): boolean {
  if (chromiumInstalled()) return true;
  // Skip entirely when the owner opted out.
  if ((env["ROLL_ATTEST_NO_BROWSER"] ?? "") === "1") return false;
  try {
    const r = spawnSync("npx", ["-y", PLAYWRIGHT_PIN, "install", "chromium"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000, // 5 min — Chromium download can be large
      env,
    });
    return r.status === 0 && chromiumInstalled();
  } catch {
    return false;
  }
}


/**
 * FIX-394 AC6 — whether the browser tool is usable on this host.
 * The browser tool (headless Chromium screenshot / console / DOM query) depends
 * on chromium being installed. When chromium is absent, the Tools page and the
 * dossier rendering should mark the browser tool as degraded.
 */
export function browserToolAvailable(): boolean {
  return chromiumInstalled();
}
