import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { t, v3Catalog, type Lang } from "@roll/spec";

export type RollCaptureOverallStatus = "available" | "degraded" | "skip";
export type RollCaptureInstallStatus = "installed" | "missing";
export type RollCapturePermissionStatus = "granted" | "denied" | "unknown" | "skipped";
export type RollCaptureInboxStatus = "writable" | "blocked" | "skipped";

export interface RollCaptureReadinessDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  interactive: boolean;
  hasAquaGUI?: boolean;
  exists: (path: string) => boolean;
  execFile: (cmd: string, args: readonly string[]) => { code: number; stdout: string; stderr: string };
}

export interface RollCaptureReadiness {
  status: RollCaptureOverallStatus;
  installed: { status: RollCaptureInstallStatus; path?: string };
  permission: { status: RollCapturePermissionStatus; detail: string };
  inbox: { status: RollCaptureInboxStatus; path: string; detail: string };
  detailLines: readonly string[];
  repairCommands: readonly string[];
}

const APP_NAME = "Roll Capture.app";
const BUNDLE_ID = "com.seanyao.roll.capture";
const SYSTEM_SETTINGS_SCREEN_CAPTURE = "open x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

export function defaultRollCaptureReadinessDeps(): RollCaptureReadinessDeps {
  const platform = externalPlatformOverride(process.env["_ROLL_EXTERNAL_TOOLS_PLATFORM"]) ?? process.platform;
  const execFile = (cmd: string, args: readonly string[]): { code: number; stdout: string; stderr: string } => {
    const r = spawnSync(cmd, [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 });
    return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return {
    platform,
    env: process.env,
    home: homedir(),
    interactive: process.stdout.isTTY === true,
    ...(platform === "darwin" && process.stdout.isTTY === true && process.env["ROLL_NO_SCREENCAP"] !== "1" && !isCi(process.env)
      ? { hasAquaGUI: macosHasAquaGUI(execFile) }
      : {}),
    exists: (path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
    execFile,
  };
}

export function collectRollCaptureReadiness(deps: RollCaptureReadinessDeps = defaultRollCaptureReadinessDeps()): RollCaptureReadiness {
  const inboxPath = rollCaptureInboxPath(deps);
  if (deps.platform !== "darwin") {
    return skipped(inboxPath, "Roll Capture.app is a macOS-only physical screenshot host.");
  }
  if (deps.env["ROLL_NO_SCREENCAP"] === "1" || deps.interactive === false || isCi(deps.env)) {
    return skipped(inboxPath, "Roll Capture readiness probe skipped (headless / CI / ROLL_NO_SCREENCAP).");
  }
  if (deps.hasAquaGUI === false) {
    return skipped(inboxPath, "No macOS GUI session (Aqua) is available; Roll Capture probe skipped.");
  }

  const installed = detectInstalled(deps);
  const permission = preflightScreenCaptureAccess(deps);
  const inbox = probeInboxWritable(inboxPath);
  const degraded = installed.status !== "installed" || permission.status !== "granted" || inbox.status !== "writable";
  const detailLines = [
    `installed=${installed.status}${installed.path !== undefined ? ` (${installed.path})` : ""}`,
    `permission=${permission.status} — ${permission.detail}`,
    `inbox=${inbox.status} (${inbox.path}) — ${inbox.detail}`,
  ];
  const repairCommands = [
    ...(installed.status === "missing" ? ["install Roll Capture.app to ~/Applications or /Applications"] : []),
    ...(permission.status === "denied" ? [SYSTEM_SETTINGS_SCREEN_CAPTURE] : []),
  ];

  return {
    status: degraded ? "degraded" : "available",
    installed,
    permission,
    inbox,
    detailLines,
    repairCommands,
  };
}

export function renderRollCaptureSetupGuidance(readiness: RollCaptureReadiness, lang: Lang): string | null {
  if (readiness.status === "skip" || readiness.status === "available") return null;
  return [
    "",
    `  ! ${rollCaptureSetupText(lang, "setup.roll_capture_not_ready")}`,
    `  ${rollCaptureSetupText(lang, "setup.roll_capture_install")}`,
    `  ${rollCaptureSetupText(lang, "setup.roll_capture_permission")}`,
    `  ${rollCaptureSetupText(lang, "setup.roll_capture_inbox", readiness.inbox.path)}`,
    "",
  ].join("\n");
}

type RollCaptureSetupKey = keyof typeof ROLL_CAPTURE_SETUP_FALLBACK;

function rollCaptureSetupText(lang: Lang, key: RollCaptureSetupKey, ...args: ReadonlyArray<string | number>): string {
  const rendered = t(v3Catalog, lang, key, ...args);
  if (rendered !== key) return rendered;
  const fallback = ROLL_CAPTURE_SETUP_FALLBACK[key];
  if (fallback === undefined) return rendered;
  return t(fallback, lang, "text", ...args);
}

const ROLL_CAPTURE_SETUP_FALLBACK = {
  "setup.roll_capture_not_ready": {
    text: {
      en: "Roll Capture.app is not ready; physical screenshots will honestly skip at capture time.",
      zh: "Roll Capture.app 尚未就绪，物理截图会在捕获时降级为明确跳过。",
    },
  },
  "setup.roll_capture_install": {
    text: {
      en: "Install Roll Capture.app: place it in ~/Applications or /Applications, then open it once.",
      zh: "安装 Roll Capture.app：将它放到 ~/Applications 或 /Applications，然后打开一次。",
    },
  },
  "setup.roll_capture_permission": {
    text: {
      en: "Grant Screen Recording: System Settings > Privacy & Security > Screen Recording, allow Roll Capture.app.",
      zh: "授权屏幕录制：System Settings > Privacy & Security > Screen Recording，允许 Roll Capture.app。",
    },
  },
  "setup.roll_capture_inbox": {
    text: {
      en: "inbox: %s",
      zh: "inbox：%s",
    },
  },
} as const;

function skipped(inboxPath: string, detail: string): RollCaptureReadiness {
  return {
    status: "skip",
    installed: { status: "missing" },
    permission: { status: "skipped", detail },
    inbox: { status: "skipped", path: inboxPath, detail },
    detailLines: [`skipped — ${detail}`],
    repairCommands: [],
  };
}

function detectInstalled(deps: RollCaptureReadinessDeps): RollCaptureReadiness["installed"] {
  const candidates = [
    deps.env["ROLL_CAPTURE_APP"],
    join(deps.home, "Applications", APP_NAME),
    join("/Applications", APP_NAME),
  ].filter((path): path is string => path !== undefined && path.trim() !== "");
  for (const candidate of candidates) {
    if (deps.exists(candidate)) return { status: "installed", path: candidate };
  }
  const mdfind = deps.execFile("mdfind", [`kMDItemCFBundleIdentifier == '${BUNDLE_ID}'`]);
  if (mdfind.code === 0) {
    const found = mdfind.stdout.split("\n").map((line) => line.trim()).find((line) => line.endsWith(APP_NAME));
    if (found !== undefined) return { status: "installed", path: found };
  }
  return { status: "missing" };
}

function preflightScreenCaptureAccess(deps: RollCaptureReadinessDeps): RollCaptureReadiness["permission"] {
  const script = "import CoreGraphics; print(CGPreflightScreenCaptureAccess() ? \"true\" : \"false\")";
  const r = deps.execFile("swift", ["-e", script]);
  if (r.code !== 0) {
    return { status: "unknown", detail: "CGPreflightScreenCaptureAccess probe could not run." };
  }
  return r.stdout.trim() === "true"
    ? { status: "granted", detail: "CGPreflightScreenCaptureAccess returned true." }
    : { status: "denied", detail: "CGPreflightScreenCaptureAccess returned false for the active permission host." };
}

function probeInboxWritable(path: string): RollCaptureReadiness["inbox"] {
  try {
    mkdirSync(path, { recursive: true });
    const requestId = `probe-${process.pid}-${Date.now()}`;
    const finalPath = join(path, `request-${requestId}.json`);
    const tempPath = join(path, `.request-${requestId}.json.tmp`);
    writeFileSync(tempPath, "{}\n");
    renameSync(tempPath, finalPath);
    rmSync(finalPath, { force: true });
    return { status: "writable", path, detail: "temp-file atomic write succeeded." };
  } catch (error) {
    return { status: "blocked", path, detail: error instanceof Error ? error.message : String(error) };
  }
}

function rollCaptureInboxPath(deps: RollCaptureReadinessDeps): string {
  const root = deps.env["ROLL_CAPTURE_HOME"] ?? join(deps.home, "Library", "Application Support", "Roll Capture");
  return join(root, "inbox");
}

function macosHasAquaGUI(execFile: RollCaptureReadinessDeps["execFile"]): boolean {
  const r = execFile("launchctl", ["managername"]);
  return r.code === 0 && r.stdout.includes("Aqua");
}

function externalPlatformOverride(raw: string | undefined): NodeJS.Platform | undefined {
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

function isCi(env: NodeJS.ProcessEnv): boolean {
  return (env["CI"] ?? "").trim() !== "";
}
