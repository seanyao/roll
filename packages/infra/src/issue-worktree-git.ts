import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
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

/** Create a REAL git worktree for one Issue repository target. Never touches a
 *  pre-existing path — the caller must have already probed it as absent.
 *  `branch === null` creates a detached read-only worktree (no local branch);
 *  otherwise `-b branch` creates a NEW named branch for a write target. */
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
 *  clean/dirty decision is enforced by git itself, not re-derived here. */
export async function issueWorktreeRemove(cachePath: string, path: string): Promise<void> {
  const result = await git(["worktree", "remove", path], cachePath);
  if (result.code !== 0) {
    throw new Error(`git worktree remove refused for ${path}: ${result.stderr || result.stdout}`);
  }
}
