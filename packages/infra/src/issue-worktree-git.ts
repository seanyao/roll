import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync, type Stats } from "node:fs";
import { dirname, join } from "node:path";
import { git } from "./git.js";

export type IssueWorktreeIdentityState = "absent" | "compatible" | "conflict";

export interface IssueWorktreeIdentity {
  readonly state: IssueWorktreeIdentityState;
  readonly dirty: boolean;
  readonly branch: string | null;
  readonly baseSha: string | null;
}

const ABSENT_IDENTITY: IssueWorktreeIdentity = { state: "absent", dirty: false, branch: null, baseSha: null };
const CONFLICT_IDENTITY: IssueWorktreeIdentity = { state: "conflict", dirty: false, branch: null, baseSha: null };

/** Walk every entry under `root` (excluding `.git`, never descending into it),
 *  applying `apply` depth-first (children before their parent directory) so a
 *  read-only parent never blocks removing write bits from its own children.
 *  A SYMLINK is passed to `apply` but never recursed into — its target may
 *  point anywhere on disk, including outside the worktree entirely. */
function walkProductEntries(root: string, apply: (entryPath: string, stat: Stats) => void): void {
  for (const name of readdirSync(root)) {
    if (name === ".git") continue;
    const entryPath = join(root, name);
    const stat = lstatSync(entryPath);
    if (stat.isDirectory() && !stat.isSymbolicLink()) walkProductEntries(entryPath, apply);
    apply(entryPath, stat);
  }
}

/** Deny filesystem writes to every product file/directory in a read-only Issue
 *  worktree checkout — NOT merely a detached HEAD, which only blocks branch
 *  commits and leaves the working tree writable to any normal process. The
 *  worktree ROOT is included (otherwise a new top-level file could still be
 *  created directly under it) — `.git` is never touched. Chmod'ing the root
 *  is only safe because {@link unprotectReadOnlyWorktree} ALWAYS restores
 *  write permission (root first, then every descendant) before
 *  {@link issueWorktreeRemove} calls `git worktree remove`: git needs write
 *  access throughout the tree to unlink it, and a still-protected root left
 *  git unable to complete the removal in testing (worse, it could leave the
 *  worktree half-unregistered) — so protect and unprotect are a matched pair,
 *  never called independently of that ordering.
 *
 *  SYMLINK BOUNDARY: a symlinked entry is NEVER chmod'd. `chmodSync` follows
 *  a symlink to its target (verified: it changes the TARGET's mode, not the
 *  link's), and Node exposes no portable `lchmod` to change the link itself —
 *  so touching a symlink here could silently mutate a file outside the
 *  worktree entirely (anywhere the link points, including outside the repo).
 *  A tracked symlink is therefore left exactly as git checked it out; the
 *  read-only guarantee covers real files/directories the checkout owns. */
export function protectReadOnlyWorktree(path: string): void {
  walkProductEntries(path, (entryPath, stat) => {
    if (stat.isSymbolicLink()) return;
    chmodSync(entryPath, stat.mode & ~0o222);
  });
  const rootStat = statSync(path);
  chmodSync(path, rootStat.mode & ~0o222);
}

/** Restore owner read+write across a previously-protected checkout (root
 *  first, then every descendant) — required before `git worktree remove` can
 *  unlink the tree, and before any repair/reuse can write into it again.
 *  Directories additionally regain the owner EXECUTE bit (needed to traverse
 *  them at all — `readdirSync` requires it, root included, regardless of what
 *  state a directory was actually left in). A REGULAR FILE never gains an
 *  execute bit it did not already have: git tracks a file's executable bit as
 *  part of its tracked mode, so unconditionally adding `0o100` would make an
 *  ordinary tracked file look modified to `git status` and make `git worktree
 *  remove` refuse it as "contains modified or untracked files" even though
 *  its content never changed. Idempotent and safe to call on an unprotected
 *  worktree. Same symlink boundary as {@link protectReadOnlyWorktree}: a
 *  symlinked entry is never chmod'd, since doing so would follow it to its
 *  target. */
export function unprotectReadOnlyWorktree(path: string): void {
  if (!existsSync(path)) return;
  const rootStat = statSync(path);
  chmodSync(path, rootStat.mode | 0o600 | (rootStat.isDirectory() ? 0o100 : 0));
  function restore(root: string): void {
    for (const name of readdirSync(root)) {
      if (name === ".git") continue;
      const entryPath = join(root, name);
      const stat = lstatSync(entryPath);
      if (stat.isSymbolicLink()) continue;
      chmodSync(entryPath, stat.mode | 0o600 | (stat.isDirectory() ? 0o100 : 0));
      if (stat.isDirectory()) restore(entryPath);
    }
  }
  restore(path);
}

/** Create a REAL git worktree for one Issue repository target. Never touches a
 *  pre-existing path — the caller must have already probed it as absent.
 *  `branch === null` creates a detached worktree (no local branch); `-b
 *  branch` creates a NEW named branch for a write target. Deliberately does
 *  NOT apply read-only filesystem protection itself — the CALLER must record
 *  the target as created (journal) BEFORE calling
 *  {@link protectReadOnlyWorktree} separately, so a protection failure can
 *  never leave a real, ungoverned worktree the journal doesn't know to roll
 *  back (see applyIssueInit). */
export async function issueWorktreeAdd(
  cachePath: string,
  path: string,
  baseSha: string,
  branch: string | null,
): Promise<void> {
  if (existsSync(path)) {
    throw new Error(`refusing to create an Issue worktree over a pre-existing path: ${path}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  // Clear STALE worktree admin metadata a prior run left behind (e.g. the
  // worktree directory was deleted by hand rather than via `worktree
  // remove`) — prune only ever drops registrations already missing on disk,
  // never a live worktree, so this is always safe before `worktree add`.
  await git(["worktree", "prune"], cachePath);
  const args = branch === null
    ? ["worktree", "add", "--detach", path, baseSha]
    : ["worktree", "add", "-b", branch, path, baseSha];
  const result = await git(args, cachePath);
  if (result.code !== 0) {
    throw new Error(`git worktree add failed for ${path}: ${result.stderr || result.stdout}`);
  }
}

/** Parse `git worktree list --porcelain` into path → absolute worktree path set. */
function worktreeListPaths(porcelain: string): Set<string> {
  const paths = new Set<string>();
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) paths.add(line.slice("worktree ".length).trim());
  }
  return paths;
}

/** Probe the REAL git identity of a path claiming to be an Issue worktree:
 *  is it actually registered as a worktree of `expectedCachePath`, what is its
 *  HEAD/branch, and does it have uncommitted changes. Read-only — no writes. */
export async function issueWorktreeIdentity(path: string, expectedCachePath: string): Promise<IssueWorktreeIdentity> {
  if (!existsSync(path)) return ABSENT_IDENTITY;
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    return ABSENT_IDENTITY;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return CONFLICT_IDENTITY;

  const commonDir = await git(["rev-parse", "--git-common-dir"], path);
  if (commonDir.code !== 0) return CONFLICT_IDENTITY;

  const list = await git(["worktree", "list", "--porcelain"], expectedCachePath);
  if (list.code !== 0) return CONFLICT_IDENTITY;
  const registered = worktreeListPaths(list.stdout);
  const canonicalPath = realpathSync(path);
  const isRegisteredHere = [...registered].some((registeredPath) => registeredPath === canonicalPath);
  if (!isRegisteredHere) return CONFLICT_IDENTITY;

  const head = await git(["rev-parse", "HEAD"], path);
  if (head.code !== 0) return CONFLICT_IDENTITY;
  const branchResult = await git(["symbolic-ref", "-q", "--short", "HEAD"], path);
  const branch = branchResult.code === 0 ? branchResult.stdout.trim() : null;

  const status = await git(["status", "--porcelain"], path);
  const dirty = status.code !== 0 || status.stdout.trim() !== "";

  return { state: "compatible", dirty, branch: branch === "" ? null : branch, baseSha: head.stdout.trim() };
}

/** Remove a worktree via `git worktree remove` — refuses (git's own guard) if
 *  the worktree has uncommitted changes. Never a blind `rm -rf`: the caller's
 *  clean/dirty decision is enforced by git itself, not re-derived here.
 *  Restores any read-only write-protection FIRST — `git worktree remove` must
 *  unlink every entry itself, which requires write permission throughout the
 *  tree; a still-protected checkout would make git fail (or, worse, abort
 *  with the worktree left half-registered), never a clean removal. */
export async function issueWorktreeRemove(cachePath: string, path: string): Promise<void> {
  unprotectReadOnlyWorktree(path);
  const result = await git(["worktree", "remove", path], cachePath);
  if (result.code !== 0) {
    throw new Error(`git worktree remove refused for ${path}: ${result.stderr || result.stdout}`);
  }
}
