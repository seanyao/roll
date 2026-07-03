import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolveLang, type Lang } from "@roll/spec";
import { detectRollCaptureInstall, invalidateRollCaptureReadinessCache } from "./roll-capture-readiness.js";

const RELEASE_API = "https://api.github.com/repos/seanyao/roll-capture/releases/latest";
const ASSET_NAME = "Roll-Capture.app.zip";
const APP_NAME = "Roll Capture.app";
const DOWNLOAD_TIMEOUT_MS = 60_000;
const UPDATE_HINT_TIMEOUT_MS = 1_500;

export interface RollCaptureReleaseAsset {
  name: string;
  size: number;
  browserDownloadUrl: string;
}

export interface RollCaptureRelease {
  tagName: string;
  assets: readonly RollCaptureReleaseAsset[];
}

export type RollCaptureInstallStatus = "installed" | "already-installed" | "skipped" | "manual";

export interface RollCaptureInstallResult {
  status: RollCaptureInstallStatus;
  reason: string;
  appPath?: string;
  releaseTag?: string;
  installedVersion?: string;
  updateAvailable?: boolean;
}

export interface RollCaptureInstallDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  hasAquaGUI?: boolean;
  exists: (path: string) => boolean;
  execFile: (cmd: string, args: readonly string[], opts?: { cwd?: string; timeoutMs?: number }) => { code: number; stdout: string; stderr: string };
  fetchLatestRelease: (timeoutMs: number) => Promise<RollCaptureRelease>;
  downloadAsset: (url: string, timeoutMs: number) => Promise<Uint8Array>;
  extractZip: (zipPath: string, destination: string, timeoutMs: number) => Promise<{ ok: true } | { ok: false; detail: string }>;
}

export function defaultRollCaptureInstallDeps(): RollCaptureInstallDeps {
  const platform = externalPlatformOverride(process.env["_ROLL_EXTERNAL_TOOLS_PLATFORM"]) ?? process.platform;
  const execFile: RollCaptureInstallDeps["execFile"] = (cmd, args, opts) => {
    const r = spawnSync(cmd, [...args], {
      cwd: opts?.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts?.timeoutMs ?? 15_000,
    });
    return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return {
    platform,
    env: process.env,
    home: homedir(),
    ...(platform === "darwin" && !isCi(process.env) && process.env["ROLL_SKIP_CAPTURE_INSTALL"] !== "1"
      ? { hasAquaGUI: macosHasAquaGUI(execFile) }
      : {}),
    exists: existsSync,
    execFile,
    fetchLatestRelease: defaultFetchLatestRelease,
    downloadAsset: defaultDownloadAsset,
    extractZip: async (zipPath, destination, timeoutMs) => extractZip(zipPath, destination, execFile, timeoutMs),
  };
}

export async function installRollCapture(deps: RollCaptureInstallDeps = defaultRollCaptureInstallDeps()): Promise<RollCaptureInstallResult> {
  const gate = installGate(deps);
  if (gate !== null) return gate;

  const installed = detectRollCaptureInstall(deps);
  if (installed.status === "installed") {
    const appPath = installed.path;
    invalidateRollCaptureReadinessCache(deps);
    const installedVersion = appPath === undefined ? undefined : readInstalledVersion(appPath, deps);
    const update = await latestReleaseHint(deps, installedVersion);
    return {
      status: "already-installed",
      reason: "installed",
      ...(appPath !== undefined ? { appPath } : {}),
      ...(installedVersion !== undefined ? { installedVersion } : {}),
      ...(update.releaseTag !== undefined ? { releaseTag: update.releaseTag } : {}),
      updateAvailable: update.updateAvailable,
    };
  }

  const deadlineMs = Date.now() + DOWNLOAD_TIMEOUT_MS;
  const remainingMs = () => Math.max(1, deadlineMs - Date.now());

  let release: RollCaptureRelease;
  try {
    release = await deps.fetchLatestRelease(remainingMs());
  } catch (error) {
    return manual(`release lookup failed: ${errorMessage(error)}`);
  }

  const asset = release.assets.find((candidate) => candidate.name === ASSET_NAME);
  if (asset === undefined) return manual(`latest release has no ${ASSET_NAME} asset`);

  let bytes: Uint8Array;
  try {
    bytes = await deps.downloadAsset(asset.browserDownloadUrl, remainingMs());
  } catch (error) {
    return manual(`download failed: ${errorMessage(error)}`, release.tagName);
  }
  if (bytes.byteLength !== asset.size) {
    return manual(`download size mismatch: expected ${asset.size} bytes, got ${bytes.byteLength}`, release.tagName);
  }

  const applicationsDir = join(deps.home, "Applications");
  const targetApp = join(applicationsDir, APP_NAME);
  mkdirSync(applicationsDir, { recursive: true });
  const workDir = mkdtempSync(join(applicationsDir, ".roll-capture-install-"));
  const zipPath = join(workDir, ASSET_NAME);
  const extractDir = join(workDir, "extract");
  try {
    mkdirSync(extractDir, { recursive: true });
    writeFileSync(zipPath, bytes);
    const extracted = await deps.extractZip(zipPath, extractDir, remainingMs());
    if (!extracted.ok) return manual(extracted.detail, release.tagName);
    const app = findExtractedApp(extractDir);
    if (app === null) return manual("zip did not contain Roll Capture.app", release.tagName);
    const executable = findBundleExecutable(app);
    if (executable === null) return manual("Roll Capture.app has no executable in Contents/MacOS", release.tagName);
    chmodSync(executable, statSync(executable).mode | 0o111);
    rmSync(targetApp, { recursive: true, force: true });
    renameSync(app, targetApp);
    invalidateRollCaptureReadinessCache(deps);
    // TODO: once Roll Capture is signed/notarized, verify the Developer ID
    // certificate here before moving the bundle into place.
    return { status: "installed", reason: "installed", appPath: targetApp, releaseTag: release.tagName };
  } catch (error) {
    return manual(`install failed: ${errorMessage(error)}`, release.tagName);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function renderRollCaptureInstallResult(result: RollCaptureInstallResult, lang: Lang): string {
  if (lang === "zh") return renderZh(result);
  return renderEn(result);
}

export async function runRollCapturePostinstall(opts?: {
  deps?: RollCaptureInstallDeps;
  writeLine?: (line: string) => void;
  lang?: Lang;
}): Promise<number> {
  const writeLine = opts?.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`));
  const lang = opts?.lang ?? resolveLang({ rollLang: process.env["ROLL_LANG"], lcAll: process.env["LC_ALL"], lang: process.env["LANG"] });
  try {
    const result = await installRollCapture(opts?.deps);
    writeLine(renderRollCaptureInstallResult(result, lang));
  } catch (error) {
    writeLine(lang === "zh" ? `Roll Capture.app 安装跳过：${errorMessage(error)}` : `Roll Capture.app install skipped: ${errorMessage(error)}`);
  }
  return 0;
}

async function defaultFetchLatestRelease(timeoutMs: number): Promise<RollCaptureRelease> {
  const response = await fetch(RELEASE_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "@seanyao/roll" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`GitHub release API returned ${response.status}`);
  return parseRelease(await response.json());
}

async function defaultDownloadAsset(url: string, timeoutMs: number): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { "User-Agent": "@seanyao/roll" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`asset download returned ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function parseRelease(value: unknown): RollCaptureRelease {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("release JSON is not an object");
  const row = value as Record<string, unknown>;
  const tagName = typeof row["tag_name"] === "string" ? row["tag_name"] : "";
  const rawAssets = Array.isArray(row["assets"]) ? row["assets"] : [];
  const assets = rawAssets.flatMap((raw): RollCaptureReleaseAsset[] => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
    const asset = raw as Record<string, unknown>;
    const name = typeof asset["name"] === "string" ? asset["name"] : "";
    const browserDownloadUrl = typeof asset["browser_download_url"] === "string" ? asset["browser_download_url"] : "";
    const size = typeof asset["size"] === "number" ? asset["size"] : Number.NaN;
    return name !== "" && browserDownloadUrl !== "" && Number.isFinite(size) ? [{ name, browserDownloadUrl, size }] : [];
  });
  return { tagName, assets };
}

async function extractZip(
  zipPath: string,
  destination: string,
  execFile: RollCaptureInstallDeps["execFile"],
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const ditto = execFile("ditto", ["-x", "-k", zipPath, destination], { timeoutMs });
  if (ditto.code === 0) return { ok: true };
  const unzip = execFile("unzip", ["-q", zipPath, "-d", destination], { timeoutMs });
  if (unzip.code === 0) return { ok: true };
  const detail = [ditto.stderr.trim(), unzip.stderr.trim()].filter((line) => line !== "").join("; ");
  return { ok: false, detail: detail === "" ? "zip extraction failed" : detail };
}

function installGate(deps: RollCaptureInstallDeps): RollCaptureInstallResult | null {
  if (deps.platform !== "darwin") return { status: "skipped", reason: "non-darwin" };
  if (skipInstallEnv(deps.env)) return { status: "skipped", reason: "disabled" };
  if (isCi(deps.env)) return { status: "skipped", reason: "ci" };
  if (deps.hasAquaGUI === false) return { status: "skipped", reason: "headless" };
  return null;
}

function skipInstallEnv(env: NodeJS.ProcessEnv): boolean {
  return (
    env["ROLL_SKIP_CAPTURE_INSTALL"] === "1" ||
    env["npm_config_roll_skip_capture_install"] === "1" ||
    env["ROLL_NO_SCREENCAP"] === "1"
  );
}

function isCi(env: NodeJS.ProcessEnv): boolean {
  return (
    (env["CI"] ?? "").trim() !== "" ||
    (env["GITHUB_ACTIONS"] ?? "").trim() !== "" ||
    (env["GITLAB_CI"] ?? "").trim() !== "" ||
    (env["JENKINS_HOME"] ?? "").trim() !== ""
  );
}

function macosHasAquaGUI(execFile: RollCaptureInstallDeps["execFile"]): boolean {
  const r = execFile("launchctl", ["managername"]);
  return r.code === 0 && r.stdout.includes("Aqua");
}

function findExtractedApp(dir: string): string | null {
  try {
    for (const name of readdirSync(dir)) {
      const candidate = join(dir, name);
      const st = statSync(candidate);
      if (st.isDirectory() && name === APP_NAME) return candidate;
      if (st.isDirectory()) {
        const nested = findExtractedApp(candidate);
        if (nested !== null) return nested;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function findBundleExecutable(appPath: string): string | null {
  const macosDir = join(appPath, "Contents", "MacOS");
  try {
    for (const name of readdirSync(macosDir)) {
      const candidate = join(macosDir, name);
      const st = statSync(candidate);
      if (st.isFile()) return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

function readInstalledVersion(appPath: string, deps: RollCaptureInstallDeps): string | undefined {
  const plistPath = join(appPath, "Contents", "Info.plist");
  const plutil = deps.execFile("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", plistPath]);
  const raw = plutil.code === 0 ? plutil.stdout.trim() : "";
  if (raw !== "") return raw;
  try {
    const text = readFileSync(plistPath, "utf8");
    const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(text);
    return match?.[1];
  } catch {
    return undefined;
  }
}

async function latestReleaseHint(
  deps: RollCaptureInstallDeps,
  installedVersion: string | undefined,
): Promise<{ releaseTag?: string; updateAvailable?: boolean }> {
  try {
    const release = await deps.fetchLatestRelease(UPDATE_HINT_TIMEOUT_MS);
    const latest = normalizeVersion(release.tagName);
    const installed = normalizeVersion(installedVersion ?? "");
    return {
      releaseTag: release.tagName,
      updateAvailable: latest !== "" && installed !== "" && latest !== installed,
    };
  } catch {
    return {};
  }
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, "");
}

function manual(reason: string, releaseTag?: string): RollCaptureInstallResult {
  return { status: "manual", reason, ...(releaseTag !== undefined ? { releaseTag } : {}) };
}

function renderEn(result: RollCaptureInstallResult): string {
  if (result.status === "installed") {
    return `Roll Capture.app installed at ${result.appPath ?? join("~", "Applications", APP_NAME)}; open it once and grant Screen Recording permission.`;
  }
  if (result.status === "already-installed") {
    const update = result.updateAvailable === true && result.releaseTag !== undefined ? `; newer release ${result.releaseTag} is available` : "";
    return `Roll Capture.app already installed at ${result.appPath ?? "(detected)"}${update}.`;
  }
  if (result.status === "skipped") return `Roll Capture.app install skipped (${result.reason}).`;
  return `Roll Capture.app automatic install failed (${result.reason}); install it manually, then open it once and grant Screen Recording permission.`;
}

function renderZh(result: RollCaptureInstallResult): string {
  if (result.status === "installed") {
    return `Roll Capture.app 已安装到 ${result.appPath ?? join("~", "Applications", APP_NAME)}；请打开一次并授予屏幕录制权限。`;
  }
  if (result.status === "already-installed") {
    const update = result.updateAvailable === true && result.releaseTag !== undefined ? `；有新版 ${result.releaseTag} 可用` : "";
    return `Roll Capture.app 已安装：${result.appPath ?? "已检测到"}${update}。`;
  }
  if (result.status === "skipped") return `Roll Capture.app 安装已跳过（${result.reason}）。`;
  return `Roll Capture.app 自动安装失败（${result.reason}）；请手动安装，打开一次并授予屏幕录制权限。`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export const rollCaptureInstallInternals = {
  ASSET_NAME,
  APP_NAME,
  RELEASE_API,
  parseRelease,
};
