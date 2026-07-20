import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  normalizeRepositoryRemote,
  parseRepositoryBinding,
  type RepositoryBinding,
} from "@roll/spec";
import { git, type GitResult } from "./git.js";
import { acquireLock, INNER_LOCK_STALE_SEC, readLockOwner, releaseLock } from "./process.js";

export type RepositoryCacheErrorCode =
  | "invalid_roll_home"
  | "invalid_binding"
  | "unsafe_remote"
  | "unsupported_refspec"
  | "unsafe_path"
  | "invalid_lock_options"
  | "lock_timeout"
  | "origin_mismatch"
  | "git_failure";

export class RepositoryCacheError extends Error {
  constructor(readonly code: RepositoryCacheErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RepositoryCacheError";
  }
}

export interface RepositoryCacheIdentity {
  readonly repoId: string;
  readonly remote: string;
  readonly transportRemote: string;
  readonly integrationBranch: string;
  readonly reposRoot: string;
  readonly cachePath: string;
  readonly identityPath: string;
  readonly lockPath: string;
  readonly journalPath: string;
  readonly temporaryPath: string;
}

export interface ResolveRepositoryCacheIdentityInput {
  readonly rollHome: string;
  readonly binding: RepositoryBinding;
  readonly transportRemote?: string;
}

export type RepositoryCacheAction = "created" | "reused" | "repaired";

export type RepositoryCacheEventType =
  | "repo:cache_created"
  | "repo:cache_reused"
  | "repo:cache_repaired";

export interface RepositoryCacheEvent {
  readonly type: RepositoryCacheEventType;
  readonly repoId: string;
  readonly remote: string;
  readonly cachePath: string;
  readonly baseSha: string;
  readonly ts: number;
}

export interface RepositoryCacheResult {
  readonly action: RepositoryCacheAction;
  readonly repoId: string;
  readonly remote: string;
  readonly cachePath: string;
  readonly baseSha: string;
  readonly event: RepositoryCacheEvent;
}

export type RepositoryCacheGitRunner = (
  args: readonly string[],
  cwd?: string,
) => Promise<GitResult>;

export interface EnsureRepositoryCacheInput extends ResolveRepositoryCacheIdentityInput {
  readonly integrationRefspec: string;
  readonly runGit?: RepositoryCacheGitRunner;
  readonly lockTimeoutMs?: number;
  readonly lockRetryMs?: number;
  readonly now?: () => number;
}

interface ParsedIntegrationRefspec {
  readonly value: string;
  readonly branch: string;
  readonly destination: string;
}

interface RepositoryLockLease {
  readonly token: string;
}

const REPOSITORY_CACHE_JOURNAL_V1 = "roll.repository-cache-journal/v1" as const;
const REPOSITORY_CACHE_IDENTITY_V1 = "roll.repository-cache-identity/v1" as const;

function childPath(root: string, name: string): string {
  const candidate = resolve(root, name);
  const pathFromRoot = relative(root, candidate);
  if (
    pathFromRoot === "" || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new RepositoryCacheError("invalid_binding", "Repository cache identity escapes its machine root");
  }
  return candidate;
}

/** Resolve the only machine-scoped paths owned by a repository cache. */
export function resolveRepositoryCacheIdentity(
  input: ResolveRepositoryCacheIdentityInput,
): RepositoryCacheIdentity {
  if (!isAbsolute(input.rollHome)) {
    throw new RepositoryCacheError("invalid_roll_home", "ROLL_HOME must be an absolute path");
  }
  const parsed = parseRepositoryBinding(input.binding);
  if (!parsed.ok) {
    const code = parsed.errors.some((error) => error.code === "unsafe_remote")
      ? "unsafe_remote"
      : "invalid_binding";
    throw new RepositoryCacheError(code, "Repository binding is invalid or unsafe");
  }
  const transportRemote = input.transportRemote ?? input.binding.remote;
  const parsedTransport = normalizeRepositoryRemote(transportRemote);
  if (!parsedTransport.ok) {
    throw new RepositoryCacheError("unsafe_remote", "Repository transport remote is invalid or unsafe");
  }
  if (parsedTransport.value !== parsed.value.remote) {
    throw new RepositoryCacheError("invalid_binding", "Repository transport remote conflicts with cache identity");
  }
  const rollHome = resolve(input.rollHome);
  const reposRoot = childPath(rollHome, "repos");
  const locksRoot = childPath(rollHome, join("locks", "repos"));
  const repoId = parsed.value.repoId;
  return {
    repoId,
    remote: parsed.value.remote,
    transportRemote,
    integrationBranch: parsed.value.integrationBranch,
    reposRoot,
    cachePath: childPath(reposRoot, `${repoId}.git`),
    identityPath: childPath(reposRoot, `${repoId}.json`),
    lockPath: childPath(locksRoot, `${repoId}.lock`),
    journalPath: childPath(reposRoot, `${repoId}.pending.json`),
    temporaryPath: childPath(reposRoot, `${repoId}.creating`),
  };
}

function parseIntegrationRefspec(value: string): ParsedIntegrationRefspec {
  const match = /^\+?(refs\/heads\/([A-Za-z0-9][A-Za-z0-9._/-]*)):(refs\/remotes\/origin\/\2)$/u.exec(value);
  const source = match?.[1];
  const branch = match?.[2];
  const destination = match?.[3];
  if (
    source === undefined || branch === undefined || destination === undefined ||
    branch.includes("..") || branch.includes("//") || branch.endsWith("/") ||
    branch.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))
  ) {
    throw new RepositoryCacheError(
      "unsupported_refspec",
      "Integration refspec must map one safe branch head to its origin tracking ref",
    );
  }
  return { value, branch, destination };
}

function assertSafeExistingPath(path: string, expected: "directory" | "file-or-directory"): void {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink() || (expected === "directory" && !stat.isDirectory())) {
    throw new RepositoryCacheError("unsafe_path", "Repository cache path contains a symlink or wrong node type");
  }
}

function prepareMachineRoots(identity: RepositoryCacheIdentity, rollHome: string): void {
  assertSafeExistingPath(rollHome, "directory");
  mkdirSync(rollHome, { recursive: true });
  assertSafeExistingPath(identity.reposRoot, "directory");
  mkdirSync(identity.reposRoot, { recursive: true });
  const locksRoot = join(rollHome, "locks");
  const repoLocksRoot = join(locksRoot, "repos");
  assertSafeExistingPath(locksRoot, "directory");
  mkdirSync(locksRoot, { recursive: true });
  assertSafeExistingPath(repoLocksRoot, "directory");
  mkdirSync(repoLocksRoot, { recursive: true });
  assertSafeExistingPath(identity.cachePath, "directory");
  assertSafeExistingPath(identity.identityPath, "file-or-directory");
  assertSafeExistingPath(identity.temporaryPath, "directory");
  assertSafeExistingPath(identity.journalPath, "file-or-directory");
  assertSafeExistingPath(identity.lockPath, "file-or-directory");
}

function assertRepositoryCacheBoundary(identity: RepositoryCacheIdentity): void {
  assertSafeExistingPath(identity.reposRoot, "directory");
  assertSafeExistingPath(identity.cachePath, "directory");
  assertSafeExistingPath(identity.identityPath, "file-or-directory");
  assertSafeExistingPath(identity.temporaryPath, "directory");
  assertSafeExistingPath(identity.journalPath, "file-or-directory");
}

function hasRecordedIdentity(identity: RepositoryCacheIdentity): boolean {
  if (!existsSync(identity.identityPath)) return false;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(identity.identityPath, "utf8"));
  } catch {
    throw new RepositoryCacheError("origin_mismatch", "Repository cache identity record is invalid");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RepositoryCacheError("origin_mismatch", "Repository cache identity record is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    record["schema"] !== REPOSITORY_CACHE_IDENTITY_V1 ||
    record["repoId"] !== identity.repoId ||
    record["remote"] !== identity.remote ||
    record["cachePath"] !== identity.cachePath
  ) {
    throw new RepositoryCacheError("origin_mismatch", "Repository cache identity record conflicts with its path");
  }
  return true;
}

function atomicWrite(path: string, text: string): void {
  const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function writeCacheIdentity(identity: RepositoryCacheIdentity, now: number): void {
  assertRepositoryCacheBoundary(identity);
  atomicWrite(identity.identityPath, `${JSON.stringify({
    schema: REPOSITORY_CACHE_IDENTITY_V1,
    repoId: identity.repoId,
    remote: identity.remote,
    cachePath: identity.cachePath,
    updatedAt: now,
  }, null, 2)}\n`);
}

async function takeRepositoryLock(
  identity: RepositoryCacheIdentity,
  timeoutMs: number,
  retryMs: number,
): Promise<RepositoryLockLease> {
  const deadline = Date.now() + timeoutMs;
  const token = `${identity.repoId}:${randomUUID()}`;
  for (;;) {
    const acquired = acquireLock(identity.lockPath, process.pid, {
      staleSec: INNER_LOCK_STALE_SEC,
      cycleId: token,
    });
    if (acquired.acquired) {
      const owner = readLockOwner(identity.lockPath);
      if (owner?.pid === process.pid && owner.cycleId === token) return { token };
      throw new RepositoryCacheError("lock_timeout", "Repository cache lock owner metadata is unavailable");
    }
    if (Date.now() >= deadline) {
      throw new RepositoryCacheError("lock_timeout", "Repository cache lock is held by another owner");
    }
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, retryMs));
  }
}

function releaseRepositoryLock(identity: RepositoryCacheIdentity, lease: RepositoryLockLease): void {
  const owner = readLockOwner(identity.lockPath);
  if (owner?.pid === process.pid && owner.cycleId === lease.token) releaseLock(identity.lockPath);
}

async function checkedGit(
  runGit: RepositoryCacheGitRunner,
  args: readonly string[],
  cwd: string | undefined,
  operation: string,
): Promise<GitResult> {
  let result: GitResult;
  try {
    result = await runGit(args, cwd);
  } catch (error) {
    throw new RepositoryCacheError("git_failure", `Git ${operation} could not start`, { cause: error });
  }
  if (result.code !== 0) {
    throw new RepositoryCacheError("git_failure", `Git ${operation} failed with exit code ${result.code}`);
  }
  return result;
}

async function inspectExistingCache(
  identity: RepositoryCacheIdentity,
  runGit: RepositoryCacheGitRunner,
): Promise<"valid" | "corrupt" | "missing"> {
  if (!existsSync(identity.cachePath)) return "missing";
  assertRepositoryCacheBoundary(identity);
  let bare: GitResult;
  let origin: GitResult;
  let fsck: GitResult;
  try {
    bare = await runGit(["rev-parse", "--is-bare-repository"], identity.cachePath);
    if (bare.code !== 0 || bare.stdout.trim() !== "true") return "corrupt";
    assertRepositoryCacheBoundary(identity);
    origin = await runGit(["remote", "get-url", "origin"], identity.cachePath);
    if (origin.code !== 0) return "corrupt";
    const normalizedOrigin = normalizeRepositoryRemote(origin.stdout.trim());
    if (!normalizedOrigin.ok || normalizedOrigin.value !== identity.remote) {
      throw new RepositoryCacheError("origin_mismatch", "Existing repository cache origin conflicts with its identity");
    }
    assertRepositoryCacheBoundary(identity);
    fsck = await runGit(["fsck", "--connectivity-only", "--no-dangling"], identity.cachePath);
  } catch (error) {
    if (error instanceof RepositoryCacheError) throw error;
    throw new RepositoryCacheError("git_failure", "Git repository cache inspection could not start", { cause: error });
  }
  return fsck.code === 0 ? "valid" : "corrupt";
}

function writeJournal(
  identity: RepositoryCacheIdentity,
  action: RepositoryCacheAction,
  refspec: string,
  now: number,
): void {
  assertRepositoryCacheBoundary(identity);
  atomicWrite(identity.journalPath, `${JSON.stringify({
    schema: REPOSITORY_CACHE_JOURNAL_V1,
    repoId: identity.repoId,
    remote: identity.remote,
    cachePath: identity.cachePath,
    temporaryPath: identity.temporaryPath,
    action,
    integrationRefspec: refspec,
    startedAt: now,
  }, null, 2)}\n`);
}

async function fetchAndResolveBaseSha(
  identity: RepositoryCacheIdentity,
  cwd: string,
  refspec: ParsedIntegrationRefspec,
  runGit: RepositoryCacheGitRunner,
): Promise<string> {
  assertRepositoryCacheBoundary(identity);
  await checkedGit(runGit, ["fetch", "--prune", "origin", refspec.value], cwd, "fetch");
  assertRepositoryCacheBoundary(identity);
  const resolved = await checkedGit(runGit, ["rev-parse", refspec.destination], cwd, "base resolve");
  const baseSha = resolved.stdout.trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(baseSha)) {
    throw new RepositoryCacheError("git_failure", "Git base resolve did not return an immutable object ID");
  }
  return baseSha;
}

async function createCache(
  identity: RepositoryCacheIdentity,
  refspec: ParsedIntegrationRefspec,
  runGit: RepositoryCacheGitRunner,
): Promise<string> {
  assertRepositoryCacheBoundary(identity);
  rmSync(identity.temporaryPath, { recursive: true, force: true });
  assertRepositoryCacheBoundary(identity);
  await checkedGit(runGit, ["init", "--bare", identity.temporaryPath], undefined, "bare init");
  assertRepositoryCacheBoundary(identity);
  await checkedGit(
    runGit,
    ["remote", "add", "origin", identity.transportRemote],
    identity.temporaryPath,
    "origin setup",
  );
  const baseSha = await fetchAndResolveBaseSha(identity, identity.temporaryPath, refspec, runGit);
  assertRepositoryCacheBoundary(identity);
  await checkedGit(runGit, ["fsck", "--connectivity-only", "--no-dangling"], identity.temporaryPath, "fsck");
  assertRepositoryCacheBoundary(identity);
  renameSync(identity.temporaryPath, identity.cachePath);
  return baseSha;
}

async function fetchCache(
  identity: RepositoryCacheIdentity,
  refspec: ParsedIntegrationRefspec,
  runGit: RepositoryCacheGitRunner,
): Promise<string> {
  return fetchAndResolveBaseSha(identity, identity.cachePath, refspec, runGit);
}

function eventType(action: RepositoryCacheAction): RepositoryCacheEventType {
  if (action === "created") return "repo:cache_created";
  if (action === "reused") return "repo:cache_reused";
  return "repo:cache_repaired";
}

/** Create, fetch, reuse or repair one machine-shared bare cache under an owned lock. */
export async function ensureRepositoryCache(
  input: EnsureRepositoryCacheInput,
): Promise<RepositoryCacheResult> {
  const identity = resolveRepositoryCacheIdentity(input);
  const refspec = parseIntegrationRefspec(input.integrationRefspec);
  if (refspec.branch !== identity.integrationBranch) {
    throw new RepositoryCacheError("unsupported_refspec", "Integration refspec must match the repository binding branch");
  }
  const lockTimeoutMs = input.lockTimeoutMs ?? 300_000;
  const lockRetryMs = input.lockRetryMs ?? 25;
  if (!Number.isFinite(lockTimeoutMs) || lockTimeoutMs < 0 || !Number.isFinite(lockRetryMs) || lockRetryMs <= 0) {
    throw new RepositoryCacheError(
      "invalid_lock_options",
      "Repository cache lock timeout must be non-negative and retry delay must be positive",
    );
  }
  prepareMachineRoots(identity, resolve(input.rollHome));
  const lease = await takeRepositoryLock(identity, lockTimeoutMs, lockRetryMs);
  const runGit = input.runGit ?? git;
  const now = input.now ?? Date.now;
  try {
    prepareMachineRoots(identity, resolve(input.rollHome));
    assertRepositoryCacheBoundary(identity);
    const interrupted = existsSync(identity.journalPath) || existsSync(identity.temporaryPath);
    const recordedIdentity = hasRecordedIdentity(identity);
    const state = await inspectExistingCache(identity, runGit);
    const action: RepositoryCacheAction = interrupted || state === "corrupt" || (state === "missing" && recordedIdentity)
      ? "repaired"
      : state === "missing" ? "created" : "reused";
    writeJournal(identity, action, refspec.value, now());

    let baseSha: string;
    if (state === "valid") {
      assertRepositoryCacheBoundary(identity);
      rmSync(identity.temporaryPath, { recursive: true, force: true });
      baseSha = await fetchCache(identity, refspec, runGit);
    } else {
      assertRepositoryCacheBoundary(identity);
      rmSync(identity.cachePath, { recursive: true, force: true });
      baseSha = await createCache(identity, refspec, runGit);
    }
    writeCacheIdentity(identity, now());
    rmSync(identity.journalPath, { force: true });
    const event: RepositoryCacheEvent = {
      type: eventType(action),
      repoId: identity.repoId,
      remote: identity.remote,
      cachePath: identity.cachePath,
      baseSha,
      ts: now(),
    };
    return {
      action,
      repoId: identity.repoId,
      remote: identity.remote,
      cachePath: identity.cachePath,
      baseSha,
      event,
    };
  } finally {
    releaseRepositoryLock(identity, lease);
  }
}
