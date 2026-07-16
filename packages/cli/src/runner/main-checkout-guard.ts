import { execFile, execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { RollEvent } from "@roll/spec";
import { resolveIntegrationBranch } from "@roll/infra";

const execFileAsync = promisify(execFile);
const PROTECTION_MARKER = "main-checkout-protection.json";

export type WriteProtectionStatus = "applied" | "released" | "recovered";

export interface WriteProtectionEvent {
  type: "sandbox:write_protected";
  cycleId: string;
  status: WriteProtectionStatus;
  repoCwd: string;
  markerPath: string;
  paths: number;
  ts: number;
}

export interface WriteProtectionResult extends WriteProtectionEvent {}

export interface MainCheckoutWriteProtectionResidue {
  markerPath: string;
  configLockPath: string;
  markerPresent: boolean;
  configLockPresent: boolean;
  reclaimableConfigLock: boolean;
  foreignConfigLock: boolean;
}

export interface MainCheckoutWriteProtectionRecovery extends MainCheckoutWriteProtectionResidue {
  restoredPaths: number;
  markerRemoved: boolean;
  configLockRemoved: boolean;
}

interface ProtectionEntry {
  path: string;
  mode: number;
}

interface ProtectionMarker {
  repoCwd: string;
  cycleId: string;
  entries: ProtectionEntry[];
}

export type QuarantineReason = "dirty" | "ahead";

export interface QuarantineResult {
  type: "sandbox:quarantined";
  cycleId: string;
  storyId?: string;
  phase: "pre-spawn" | "active-spawn" | "post-cycle" | "post-spawn" | "capture";
  reason: QuarantineReason;
  ref: string;
  files: string[];
  manifestPath: string;
  restoreCommand: string;
  ts: number;
}

export interface MainCheckoutGuardOptions {
  repoCwd: string;
  runtimeDir: string;
  cycleId: string;
  nowMs?: () => number;
}

export interface QuarantineOptions extends MainCheckoutGuardOptions {
  storyId?: string;
  phase: QuarantineResult["phase"];
}

function now(opts: { nowMs?: () => number }): number {
  return opts.nowMs?.() ?? Date.now();
}

function markerPath(runtimeDir: string): string {
  return join(runtimeDir, PROTECTION_MARKER);
}

function git(repoCwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repoCwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitQuiet(repoCwd: string, args: string[]): boolean {
  try {
    execFileSync("git", args, { cwd: repoCwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function parsePorcelainPath(line: string): string {
  const raw = line.length > 3 ? line.slice(3).trim() : line.trim();
  const target = raw.includes(" -> ") ? raw.split(" -> ").at(-1) ?? raw : raw;
  return target.replace(/^"|"$/g, "");
}

/** FIX-1218: is this line a staged (index-layer) change? */
function isStagedChange(line: string): boolean {
  // First column of porcelain output = index status
  // ' ' = unchanged, '?' = untracked (no index state)
  // Anything else = staged change
  const idx = line.length > 0 ? line[0] ?? " " : " ";
  return idx !== " " && idx !== "?";
}

/** FIX-1218: is this line a working-tree (unstaged) change? */
function isWorkingChange(line: string): boolean {
  // Second column of porcelain output = worktree status
  const wt = line.length > 1 ? line[1] ?? " " : " ";
  return wt !== " " && wt !== "?";
}

function protectedPath(rel: string): boolean {
  return rel !== ".roll" && !rel.startsWith(".roll/") && rel !== "skills" && !rel.startsWith("skills/");
}

function gitListFiles(repoCwd: string, args: string[]): string[] {
  try {
    const out = execFileSync("git", args, { cwd: repoCwd, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] });
    return out.toString("utf8").split("\0").filter((rel) => rel !== "");
  } catch {
    return [];
  }
}

export async function checkMainDirty(repoCwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: repoCwd,
      encoding: "utf8",
    });
    const dirty: string[] = [];
    for (const line of stdout.split("\n")) {
      const trimmed = line.trimEnd();
      if (trimmed === "") continue;
      const path = parsePorcelainPath(trimmed);
      // FIX-1218: staged (index-layer) changes are always included even in
      // protected paths like skills/ — someone explicitly staged them and they
      // must be listed for diagnostics.  Working-tree-only changes in protected
      // paths are still excluded (they're expected transient submodule noise).
      if (isStagedChange(trimmed) || protectedPath(path)) {
        dirty.push(path);
      }
    }
    return dirty.slice(0, 50);
  } catch {
    return [];
  }
}

function collectProtectionEntries(repoCwd: string): ProtectionEntry[] {
  const entries: ProtectionEntry[] = [];
  const seen = new Set<string>();
  const add = (absPath: string): void => {
    if (seen.has(absPath)) return;
    let st;
    try {
      st = lstatSync(absPath);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return;
    seen.add(absPath);
    entries.push({ path: absPath, mode: st.mode & 0o777 });
  };
  const rels = new Set<string>();
  const addRel = (rel: string): void => {
    if (rel === "" || rel === ".") return;
    if (!protectedPath(rel)) return;
    const parts = rel.split("/");
    let parent = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      parent = parent === "" ? parts[i] ?? "" : `${parent}/${parts[i] ?? ""}`;
      if (parent !== "" && protectedPath(parent)) rels.add(parent);
    }
    rels.add(rel);
  };
  add(repoCwd);
  for (const rel of gitListFiles(repoCwd, ["ls-files", "-z"])) addRel(rel);
  for (const rel of gitListFiles(repoCwd, ["ls-files", "-z", "-o", "--exclude-standard"])) addRel(rel);
  for (const rel of [...rels].sort()) add(join(repoCwd, rel));
  for (const rel of [".git/index", ".git/packed-refs", ".git/HEAD", ".git/refs/heads/main", ".git/logs/refs/heads/main"]) {
    add(join(repoCwd, rel));
  }
  return entries;
}

function writeMarker(path: string, marker: ProtectionMarker): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
}

function protectionEntryFrom(value: unknown): ProtectionEntry | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return typeof record["path"] === "string" && typeof record["mode"] === "number"
    ? { path: record["path"], mode: record["mode"] }
    : undefined;
}

function parseProtectionMarker(raw: string): ProtectionMarker | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;
  if (typeof record["repoCwd"] !== "string" || typeof record["cycleId"] !== "string" || !Array.isArray(record["entries"])) {
    return undefined;
  }
  const entries: ProtectionEntry[] = [];
  for (const value of record["entries"]) {
    const entry = protectionEntryFrom(value);
    if (entry === undefined) return undefined;
    entries.push(entry);
  }
  return { repoCwd: record["repoCwd"], cycleId: record["cycleId"], entries };
}

function restoreMarker(path: string): number {
  if (!existsSync(path)) return 0;
  const marker = parseProtectionMarker(readFileSync(path, "utf8"));
  if (marker === undefined) {
    rmSync(path, { force: true });
    return 0;
  }
  let restored = 0;
  for (const entry of marker.entries) {
    try {
      chmodSync(entry.path, entry.mode);
      restored += 1;
    } catch {
      /* best-effort; missing files should not wedge the next cycle */
    }
  }
  rmSync(path, { force: true });
  return restored;
}

function protectionEvent(opts: MainCheckoutGuardOptions, status: WriteProtectionStatus, paths: number): WriteProtectionResult {
  return {
    type: "sandbox:write_protected",
    cycleId: opts.cycleId,
    status,
    repoCwd: opts.repoCwd,
    markerPath: markerPath(opts.runtimeDir),
    paths,
    ts: now(opts),
  };
}

// ─── FIX-1210: config.lock sentinel ──────────────────────────────────────────

/**
 * The `.git/config.lock` sentinel prevents `git config --local` writes
 * (including nested `git init` that writes `core.worktree` to the shared
 * config) by occupying the lock file that git's atomic rename mechanism uses.
 * Normal read operations (commit, add, status) are unaffected because they
 * use refs/objects/index directly, not the config lock.
 *
 * The sentinel is created as mode 0o444 (read-only for everyone) so that even
 * if a child process inherits our uid, the rename-to-target fails with EACCES.
 */
const CONFIG_LOCK_REL = ".git/config.lock";
const CONFIG_LOCK_SENTINEL_TEXT = "roll main-checkout config lock sentinel\n";

function configLockPath(repoCwd: string): string {
  return join(repoCwd, CONFIG_LOCK_REL);
}

/**
 * A lock we may take over: zero-byte (crashed git process) or carrying OUR
 * sentinel text (a roll sentinel orphaned by a hard-killed cycle — its release
 * never ran).  Anything else is a live foreign git lock and must be left alone.
 */
function isReclaimableConfigLock(lockPath: string): boolean {
  try {
    if (statSync(lockPath).size === 0) return true;
    return readFileSync(lockPath, "utf8") === CONFIG_LOCK_SENTINEL_TEXT;
  } catch {
    return false;
  }
}

function createConfigLockSentinel(repoCwd: string): void {
  try {
    const lockPath = configLockPath(repoCwd);
    if (existsSync(lockPath)) {
      if (!isReclaimableConfigLock(lockPath)) return;
      chmodSync(lockPath, 0o644);
      rmSync(lockPath, { force: true });
    }
    writeFileSync(lockPath, CONFIG_LOCK_SENTINEL_TEXT, "utf8");
    chmodSync(lockPath, 0o444);
  } catch {
    /* best-effort; the sentinel is a defense-in-depth measure */
  }
}

function removeConfigLockSentinel(repoCwd: string): void {
  try {
    const lockPath = configLockPath(repoCwd);
    if (existsSync(lockPath) && isReclaimableConfigLock(lockPath)) {
      // Restore write permission so we can delete it, then remove.  A foreign
      // (non-sentinel, non-empty) lock belongs to a live git process — leave it.
      chmodSync(lockPath, 0o644);
      rmSync(lockPath, { force: true });
    }
  } catch {
    /* best-effort */
  }
}

export function detectMainCheckoutWriteProtectionResidue(repoCwd: string, runtimeDir: string): MainCheckoutWriteProtectionResidue {
  const lockPath = configLockPath(repoCwd);
  const configLockPresent = existsSync(lockPath);
  const reclaimableConfigLock = configLockPresent && isReclaimableConfigLock(lockPath);
  return {
    markerPath: markerPath(runtimeDir),
    configLockPath: lockPath,
    markerPresent: existsSync(markerPath(runtimeDir)),
    configLockPresent,
    reclaimableConfigLock,
    foreignConfigLock: configLockPresent && !reclaimableConfigLock,
  };
}

export function recoverMainCheckoutWriteProtectionResidue(repoCwd: string, runtimeDir: string): MainCheckoutWriteProtectionRecovery {
  const before = detectMainCheckoutWriteProtectionResidue(repoCwd, runtimeDir);
  const restoredPaths = restoreMarker(before.markerPath);
  if (before.reclaimableConfigLock) removeConfigLockSentinel(repoCwd);
  const after = detectMainCheckoutWriteProtectionResidue(repoCwd, runtimeDir);
  return {
    ...after,
    restoredPaths,
    markerRemoved: before.markerPresent && !after.markerPresent,
    configLockRemoved: before.reclaimableConfigLock && !after.configLockPresent,
  };
}

// ─── FIX-1210: core.worktree contamination repair ────────────────────────────

export interface RepairContaminationResult {
  healed: boolean;
  detail: string;
}

/**
 * FIX-1210: Shared implementation that strips injected GIT_* env vars and
 * removes `core.worktree` from the local git config.  Designed to be called
 * from both the pre-check (loop-run-once) and the terminal (append_run) so
 * the clean-up logic lives in one place.
 *
 * Returns `{ healed: true, detail: <poisoned-value> }` when a contamination
 * was found and removed; `{ healed: false, detail: "" }` when clean.
 */
export function repairCoreWorktreeContamination(repoCwd: string): RepairContaminationResult {
  // Strip ALL inherited git env vars so every subsequent git operation reads
  // the ACTUAL local repo config, not the cycle worktree's overrides.
  delete process.env["GIT_DIR"];
  delete process.env["GIT_WORK_TREE"];
  delete process.env["GIT_CEILING_DIRECTORIES"];

  // Private env for this function's own execFileSync calls.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env["GIT_DIR"];
  delete env["GIT_WORK_TREE"];
  delete env["GIT_CEILING_DIRECTORIES"];

  const git = (args: string[]): { code: number; stdout: string; stderr: string } => {
    const r = spawnSync("git", args, { cwd: repoCwd, env, encoding: "utf8" });
    return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };

  // Check if core.worktree is set (contamination) — MUST use --local scope.
  const get = git(["config", "--local", "--get", "core.worktree"]);
  if (get.code !== 0 || get.stdout.trim() === "") {
    return { healed: false, detail: "" };
  }

  const poisoned = get.stdout.trim();

  // Unset the contamination.
  const unset = git(["config", "--local", "--unset", "core.worktree"]);
  if (unset.code !== 0) {
    return { healed: false, detail: `detected but failed to unset: ${poisoned}` };
  }

  return { healed: true, detail: poisoned };
}

export function applyMainCheckoutWriteProtection(opts: MainCheckoutGuardOptions): WriteProtectionResult {
  if (!existsSync(opts.repoCwd)) return protectionEvent(opts, "applied", 0);
  const path = markerPath(opts.runtimeDir);
  const recovered = existsSync(path);
  if (recovered) restoreMarker(path);

  const entries = collectProtectionEntries(opts.repoCwd);
  writeMarker(path, { repoCwd: opts.repoCwd, cycleId: opts.cycleId, entries });
  for (const entry of entries) {
    try {
      const writeStripped = entry.mode & ~0o222;
      chmodSync(entry.path, writeStripped);
    } catch {
      /* chmod failures are surfaced by the following write attempts/tests */
    }
  }
  // FIX-1210: add .git/config.lock sentinel to block nested git init config writes
  createConfigLockSentinel(opts.repoCwd);
  return protectionEvent(opts, recovered ? "recovered" : "applied", entries.length);
}

export function releaseMainCheckoutWriteProtection(opts: MainCheckoutGuardOptions): WriteProtectionResult {
  if (!existsSync(opts.repoCwd)) return protectionEvent(opts, "released", 0);
  // FIX-1210: remove .git/config.lock sentinel
  removeConfigLockSentinel(opts.repoCwd);
  const restored = restoreMarker(markerPath(opts.runtimeDir));
  return protectionEvent(opts, "released", restored);
}

export async function withMainCheckoutWriteProtection<T>(
  opts: MainCheckoutGuardOptions,
  fn: () => Promise<T> | T,
): Promise<{ value: T; events: WriteProtectionResult[] }> {
  const events: WriteProtectionResult[] = [applyMainCheckoutWriteProtection(opts)];
  try {
    const value = await fn();
    return { value, events };
  } finally {
    events.push(releaseMainCheckoutWriteProtection(opts));
  }
}

function quarantineId(opts: MainCheckoutGuardOptions, reason: QuarantineReason): string {
  const d = new Date(now(opts));
  const stamp = d.toISOString().replace(/[-:]/g, "").replace("T", "-").replace("Z", "").replace(".", "-");
  return `leaked-${stamp}-${opts.cycleId}-${reason}`;
}

function manifestPath(runtimeDir: string, id: string): string {
  return join(runtimeDir, "quarantine", `${id}.json`);
}

function writeManifest(path: string, manifest: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function aheadCount(repoCwd: string): number {
  try {
    const raw = git(repoCwd, ["rev-list", "--count", "origin/main..HEAD"]);
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function aheadFiles(repoCwd: string): string[] {
  try {
    return git(repoCwd, ["log", "--reverse", "--format=%s", "origin/main..HEAD"])
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => `<commit>:${line.trim()}`);
  } catch {
    return [];
  }
}

function refName(id: string): string {
  return `rescue/${id}`;
}

const AGENT_PRIVATE_TIMESTAMP_STATE_FILES = new Set([".pi/workflows/index.json"]);

function changedDiffLines(repoCwd: string, relPath: string): string[] {
  try {
    return execFileSync("git", ["diff", "--", relPath], {
      cwd: repoCwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split("\n")
      .filter((line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"));
  } catch {
    return [];
  }
}

function isAgentPrivateTimestampOnlyDirty(repoCwd: string, relPath: string): boolean {
  if (!AGENT_PRIVATE_TIMESTAMP_STATE_FILES.has(relPath)) return false;
  const lines = changedDiffLines(repoCwd, relPath);
  if (lines.length === 0) return false;
  return lines.every((line) => /^[-+]\s*"updatedAt":\s*"[^"]+",?\s*$/.test(line));
}

function restoreIgnorableAgentPrivateState(repoCwd: string, files: string[]): string[] {
  const remaining: string[] = [];
  for (const file of files) {
    if (isAgentPrivateTimestampOnlyDirty(repoCwd, file) && gitQuiet(repoCwd, ["restore", "--", file])) continue;
    remaining.push(file);
  }
  return remaining;
}

function toEvent(opts: QuarantineOptions, reason: QuarantineReason, ref: string, files: string[], path: string, restoreCommand: string): QuarantineResult {
  return {
    type: "sandbox:quarantined",
    cycleId: opts.cycleId,
    ...(opts.storyId !== undefined ? { storyId: opts.storyId } : {}),
    phase: opts.phase,
    reason,
    ref,
    files,
    manifestPath: path,
    restoreCommand,
    ts: now(opts),
  };
}

async function quarantineDirty(opts: QuarantineOptions, files: string[]): Promise<QuarantineResult | null> {
  if (files.length === 0) return null;
  const id = quarantineId(opts, "dirty");
  const ref = refName(id);
  const message = `roll quarantine ${opts.cycleId} dirty main checkout`;
  if (!gitQuiet(opts.repoCwd, ["stash", "push", "-u", "-m", message, "--", ...files])) return null;
  const stashSha = git(opts.repoCwd, ["rev-parse", "stash@{0}"]);
  if (!gitQuiet(opts.repoCwd, ["update-ref", `refs/heads/${ref}`, stashSha])) return null;
  gitQuiet(opts.repoCwd, ["stash", "drop", "-q", "stash@{0}"]);
  const restoreCommand = `git stash apply ${ref}`;
  const path = manifestPath(opts.runtimeDir, id);
  const ev = toEvent(opts, "dirty", ref, files, path, restoreCommand);
  writeManifest(path, {
    id,
    cycleId: opts.cycleId,
    storyId: opts.storyId,
    phase: opts.phase,
    reason: "dirty",
    ref,
    files,
    restoreCommand,
    createdAt: new Date(now(opts)).toISOString(),
  });
  return ev;
}

async function quarantineAhead(opts: QuarantineOptions): Promise<QuarantineResult | null> {
  if (aheadCount(opts.repoCwd) === 0) return null;
  const id = quarantineId(opts, "ahead");
  const ref = refName(id);
  const files = aheadFiles(opts.repoCwd);
  if (!gitQuiet(opts.repoCwd, ["branch", ref, "HEAD"])) return null;
  // E1: reset the main checkout back onto the configured integration branch
  // (default origin/main). The leaked commits are preserved on `ref` above.
  if (!gitQuiet(opts.repoCwd, ["reset", "--hard", resolveIntegrationBranch(opts.repoCwd)])) return null;
  const restoreCommand = `git cherry-pick ${ref}`;
  const path = manifestPath(opts.runtimeDir, id);
  const ev = toEvent(opts, "ahead", ref, files, path, restoreCommand);
  writeManifest(path, {
    id,
    cycleId: opts.cycleId,
    storyId: opts.storyId,
    phase: opts.phase,
    reason: "ahead",
    ref,
    files,
    restoreCommand,
    createdAt: new Date(now(opts)).toISOString(),
  });
  return ev;
}

export async function quarantineMainCheckout(opts: QuarantineOptions): Promise<QuarantineResult[]> {
  if (!existsSync(opts.repoCwd)) return [];
  const results: QuarantineResult[] = [];
  const dirty = restoreIgnorableAgentPrivateState(opts.repoCwd, await checkMainDirty(opts.repoCwd));
  const dirtyResult = await quarantineDirty(opts, dirty);
  if (dirtyResult !== null) results.push(dirtyResult);
  const aheadResult = await quarantineAhead(opts);
  if (aheadResult !== null) results.push(aheadResult);
  return results;
}

export function quarantineEventToRollEvent(result: QuarantineResult): Extract<RollEvent, { type: "sandbox:quarantined" }> {
  return {
    type: "sandbox:quarantined",
    cycleId: result.cycleId,
    ...(result.storyId !== undefined ? { storyId: result.storyId } : {}),
    phase: result.phase,
    reason: result.reason,
    ref: result.ref,
    files: result.files,
    manifestPath: result.manifestPath,
    restoreCommand: result.restoreCommand,
    ts: result.ts,
  };
}

// ─── FIX-1210: worktree env helper ──────────────────────────────────────────

export function worktreeGitEnv(worktreePath: string, repoCwd: string): NodeJS.ProcessEnv {
  try {
    const gitDir = execFileSync("git", ["-C", worktreePath, "rev-parse", "--path-format=absolute", "--git-dir"], {
      encoding: "utf8",
    }).trim();
    return {
      GIT_DIR: gitDir,
      GIT_WORK_TREE: worktreePath,
      GIT_CEILING_DIRECTORIES: dirname(repoCwd),
    };
  } catch {
    return {
      GIT_WORK_TREE: worktreePath,
      GIT_CEILING_DIRECTORIES: dirname(repoCwd),
    };
  }
}
