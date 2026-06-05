/**
 * Git module — TS I/O adapters mirroring the git operations the v2 loop performs
 * (US-INFRA-002).
 *
 * ─── v2 oracle (frozen bash, bin/roll) ──────────────────────────────────────
 *   worktree helpers (12758-12810):
 *     - `_worktree_create  path branch base` 12762-12773
 *         mkdir parent; if path exists → `git worktree remove --force` + rm -rf;
 *         if branch ref exists → `git branch -D` (FIX-114: a branch left by a
 *         prior failed run, or one checked out elsewhere, would make
 *         `worktree add -b` error — delete it first); then
 *         `git worktree add <path> -b <branch> <base>`.
 *     - `_worktree_cleanup path branch` 12779-12785
 *         `git worktree remove --force` (tolerant) + rm -rf + `git branch -D`
 *         (tolerant); always returns 0 so retry / rollback is safe.
 *     - `_worktree_fetch_origin branch` 12791-12798
 *         `git fetch origin <branch> --quiet`; lenient — returns 0 even on
 *         failure (network blips must not derail the loop).
 *     - `_worktree_submodule_init path` 12806-12809
 *         `( cd <path> && git submodule update --init --recursive --quiet )`.
 *     - `_worktree_merge_back branch` 12895+
 *         `git pull --ff-only origin main --quiet`,
 *         `git merge --ff-only <branch>`, `git push origin main`.
 *   slug path canonicalization preamble inside `_project_slug` (6949-7026):
 *     - FIX-056: on Darwin, `realpath <path>` (case-normalize symlink-resolve).
 *     - FIX-034: `git -C <path> rev-parse --git-common-dir`; if it ends in
 *       `/.git`, the project is `${common%/.git}` (worktree → main tree).
 *     - remote: `git -C <path> remote get-url origin`, else first
 *       `git -C <path> remote | head -1` → `remote get-url <first>`.
 *
 * ─── Lib choice: raw `git` via execFile, NOT simple-git ─────────────────────
 * The card suggests simple-git. REJECTED for behavioral fidelity: the oracle is
 * literal `git` CLI invocations with a precise, observable flag set (e.g.
 * `worktree add -b`, `--ff-only`, `remove --force`). Driving git through
 * `execFile("git", [...])` keeps byte-parity with those invocations, keeps the
 * cited flag sets auditable line-for-line, and adds ZERO runtime dependencies.
 * simple-git would interpose its own argument synthesis and error semantics,
 * risking silent drift from the oracle. This divergence is deliberate.
 *
 * All wrappers are thin: they shell out and surface git's exit status. Lenient
 * wrappers (mirroring bash `|| true` paths) swallow failures exactly where the
 * oracle does, and say so.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import {
  type ProjectIdentityInputs,
  projectSlug,
} from "@roll/spec";

const execFileAsync = promisify(execFile);

/** Result of a raw git invocation. */
export interface GitResult {
  /** Process exit code (0 = success). */
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run `git <args>` in `cwd`. Never throws on non-zero exit — returns the code
 * + captured streams so callers can mirror bash's explicit exit-code handling
 * (`if git ...; then` / `|| true`). Throws only on spawn failure (git missing).
 */
export async function git(args: readonly string[], cwd?: string): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string; errno?: string };
    // execFile sets a numeric/string `code`; a non-process spawn error has no
    // stdout/stderr captured. Distinguish "git ran and failed" from "no git".
    if (typeof err.code === "number") {
      return { code: err.code, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    }
    if (err.stdout !== undefined || err.stderr !== undefined) {
      return { code: 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    }
    throw e; // git binary not found / unspawnable
  }
}

// ─── worktree lifecycle ──────────────────────────────────────────────────────

/**
 * Mirror `_worktree_create path branch base` (bin/roll 12762-12773).
 *
 * Steps, in the oracle's exact order:
 *   1. `mkdir -p $(dirname path)`.
 *   2. if `path` exists on disk → `git worktree remove --force path` (lenient)
 *      then `rm -rf path` (lenient).
 *   3. if `refs/heads/<branch>` exists → `git branch -D <branch>` (lenient)
 *      — FIX-114 idempotency: clears a branch a prior failed run left behind so
 *      step 4 can't fail with "branch already exists".
 *   4. `git worktree add <path> -b <branch> <base>` — STRICT: this is the one
 *      step whose failure the oracle propagates (the `if _worktree_create ...`
 *      gate). Returns its {@link GitResult}.
 *
 * @param repoCwd  the main tree to run git in (worktree commands are tree-rel).
 */
export async function worktreeAdd(
  repoCwd: string,
  path: string,
  branch: string,
  base: string,
  exists: (p: string) => boolean = defaultExists,
): Promise<GitResult> {
  mkdirSync(dirname(path), { recursive: true });
  if (exists(path)) {
    await git(["worktree", "remove", "--force", path], repoCwd); // lenient
    rmSyncQuiet(path);
  }
  const ref = await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repoCwd);
  if (ref.code === 0) {
    await git(["branch", "-D", branch], repoCwd); // lenient (FIX-114)
  }
  return git(["worktree", "add", path, "-b", branch, base], repoCwd);
}

/**
 * Mirror `_worktree_cleanup path branch` (bin/roll 12779-12785). Tolerant of a
 * missing worktree / branch (every step `|| true`); always reports success.
 * Returns the streams of the `worktree remove` for diagnostics, but `code` is
 * forced to 0 to match the oracle's `return 0`.
 */
export async function worktreeRemove(
  repoCwd: string,
  path: string,
  branch: string,
): Promise<GitResult> {
  const r = await git(["worktree", "remove", "--force", path], repoCwd); // lenient
  rmSyncQuiet(path);
  await git(["branch", "-D", branch], repoCwd); // lenient
  return { code: 0, stdout: r.stdout, stderr: r.stderr };
}

/**
 * Mirror `_worktree_fetch_origin branch` (bin/roll 12791-12798).
 * `git fetch origin <branch> --quiet`. LENIENT: returns 0 even on failure (a
 * missing remote / network blip must not derail the loop). The `fetched` flag
 * reports the underlying outcome without changing the lenient return.
 */
export async function worktreeFetchOrigin(
  repoCwd: string,
  branch: string,
): Promise<{ code: 0; fetched: boolean }> {
  const r = await git(["fetch", "origin", branch, "--quiet"], repoCwd);
  return { code: 0, fetched: r.code === 0 };
}

/**
 * Mirror `_worktree_submodule_init path` (bin/roll 12806-12809):
 * `( cd <path> && git submodule update --init --recursive --quiet )`. Returns
 * submodule update's exit code (the oracle propagates it).
 */
export async function worktreeSubmoduleInit(worktreePath: string): Promise<GitResult> {
  return git(["submodule", "update", "--init", "--recursive", "--quiet"], worktreePath);
}

// ─── branch / commit / push / queries ────────────────────────────────────────

/** `git branch -D <branch>` (lenient; mirrors the oracle's tolerant deletes). */
export async function branchDelete(repoCwd: string, branch: string): Promise<GitResult> {
  return git(["branch", "-D", branch], repoCwd);
}

/**
 * Create a new branch. With `base`: `git branch <branch> <base>`; without:
 * `git branch <branch>` (off current HEAD). Mirrors plain `git branch` creation
 * — STRICT (returns git's code).
 */
export async function branchCreate(repoCwd: string, branch: string, base?: string): Promise<GitResult> {
  const args = base === undefined ? ["branch", branch] : ["branch", branch, base];
  return git(args, repoCwd);
}

/**
 * `git commit -m <message>` (optionally `--allow-empty`). The oracle commits
 * via the agent; this is the direct wrapper for v3 callers. Caller stages first.
 */
export async function commit(
  repoCwd: string,
  message: string,
  opts: { allowEmpty?: boolean } = {},
): Promise<GitResult> {
  const args = ["commit", "-m", message];
  if (opts.allowEmpty === true) args.splice(1, 0, "--allow-empty");
  return git(args, repoCwd);
}

/**
 * `git push origin <branch>` (mirrors `_worktree_merge_back`'s final push and
 * the loop's branch publishes). With `setUpstream`, prepends `-u`. STRICT.
 */
export async function push(
  repoCwd: string,
  branch: string,
  opts: { setUpstream?: boolean; remote?: string } = {},
): Promise<GitResult> {
  const remote = opts.remote ?? "origin";
  const args = opts.setUpstream === true ? ["push", "-u", remote, branch] : ["push", remote, branch];
  return git(args, repoCwd);
}

/**
 * `git rev-parse --abbrev-ref HEAD` → current branch name (trimmed). Returns
 * `undefined` on failure (detached HEAD edge / non-repo). Detached HEAD prints
 * `HEAD`, returned verbatim as the oracle would observe it.
 */
export async function currentBranch(repoCwd: string): Promise<string | undefined> {
  const r = await git(["rev-parse", "--abbrev-ref", "HEAD"], repoCwd);
  return r.code === 0 ? r.stdout.trim() : undefined;
}

/**
 * `git merge-base <a> <b>` → the common-ancestor sha (trimmed), or `undefined`
 * when there is none / on error.
 */
export async function mergeBase(repoCwd: string, a: string, b: string): Promise<string | undefined> {
  const r = await git(["merge-base", a, b], repoCwd);
  return r.code === 0 ? r.stdout.trim() : undefined;
}

/**
 * `git merge-base --is-ancestor <ancestor> <descendant>`: true iff `ancestor`
 * is an ancestor of `descendant` (git exit 0); false on exit 1; `undefined` on
 * any other code (error). Mirrors the ff-only ancestry the loop relies on.
 */
export async function isAncestor(
  repoCwd: string,
  ancestor: string,
  descendant: string,
): Promise<boolean | undefined> {
  const r = await git(["merge-base", "--is-ancestor", ancestor, descendant], repoCwd);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  return undefined;
}

/** A remote ref row from `git ls-remote`. */
export interface LsRemoteRef {
  sha: string;
  ref: string;
}

/**
 * `git ls-remote [<remote>] [<ref>...]` parsed into `{ sha, ref }` rows
 * (tab-separated, as git prints). Empty list on failure (lenient — callers gate
 * on emptiness like the bash probes do). `remote` defaults to `origin`.
 */
export async function lsRemote(
  repoCwd: string,
  remote = "origin",
  refs: readonly string[] = [],
): Promise<LsRemoteRef[]> {
  const r = await git(["ls-remote", remote, ...refs], repoCwd);
  if (r.code !== 0) return [];
  const out: LsRemoteRef[] = [];
  for (const line of r.stdout.split("\n")) {
    if (line === "") continue;
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    out.push({ sha: line.slice(0, tab), ref: line.slice(tab + 1) });
  }
  return out;
}

// ─── project path canonicalization + identity ────────────────────────────────

/**
 * The I/O half of project identity — mirrors the canonicalization PREAMBLE of
 * `_project_slug` (bin/roll 6957-6973). @roll/spec's `projectSlug` is the pure
 * algorithm; this performs the realpath + worktree resolution it documented as
 * "infra's duty".
 *
 * Steps, exactly as the oracle:
 *   1. FIX-056: on Darwin only, `realpath <path>`; on success replace `path`
 *      (case-normalize + symlink-resolve). Non-Darwin leaves the path as given,
 *      matching the bash `[[ Darwin ]]` guard. Failure leaves `path` unchanged.
 *   2. FIX-034: `git -C <path> rev-parse --git-common-dir`; if the result ends
 *      in `/.git`, the canonical project is `${common%/.git}` (a worktree
 *      resolves to its main tree).
 *
 * @param path        starting path (caller's cwd or an explicit dir).
 * @param platform    override of `process.platform` (tests).
 */
export async function canonicalProjectPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  let p = path;
  if (platform === "darwin") {
    const real = await realpathQuiet(p);
    if (real !== undefined) p = real;
  }
  // FIX-201: resolve to the CURRENT worktree's toplevel, never the main
  // worktree. `--git-common-dir` drags every linked worktree back to the
  // primary checkout — correct for cycle worktrees only by accident, and
  // catastrophically wrong for sibling dev worktrees (the loop baked
  // ~/Workspace/roll — the FROZEN v2 checkout — as the project path and
  // idled there forever while roll-v3's backlog sat untouched).
  const top = await git(["-C", p, "rev-parse", "--show-toplevel"]);
  if (top.code === 0) {
    const t = top.stdout.trim();
    if (t !== "") p = t;
  }
  return p;
}

/**
 * Resolve the remote URL the slug derives from — mirrors the bash fallback
 * chain (bin/roll 6975-6982): `origin`, else the FIRST remote, else undefined.
 */
export async function remoteUrl(repoCwd: string): Promise<string | undefined> {
  const origin = await git(["-C", repoCwd, "remote", "get-url", "origin"]);
  if (origin.code === 0 && origin.stdout.trim() !== "") return origin.stdout.trim();
  const list = await git(["-C", repoCwd, "remote"]);
  if (list.code === 0) {
    const first = list.stdout.split("\n").find((l) => l.trim() !== "")?.trim();
    if (first !== undefined) {
      const u = await git(["-C", repoCwd, "remote", "get-url", first]);
      if (u.code === 0 && u.stdout.trim() !== "") return u.stdout.trim();
    }
  }
  return undefined;
}

/** Project identity: the canonical path + the @roll/spec slug derived from it. */
export interface ProjectIdentity {
  path: string;
  slug: string;
}

/**
 * Convenience composite: canonicalize `path`, read its remote, and compute the
 * slug via @roll/spec `projectSlug`. Honors `ROLL_MAIN_SLUG` exactly as the
 * oracle (US-LOOP-006: the override short-circuits before any path/remote I/O).
 *
 * @param path     starting path; defaults to `process.cwd()` (bash `pwd`).
 */
export async function projectIdentity(
  path: string = process.cwd(),
  platform: NodeJS.Platform = process.platform,
): Promise<ProjectIdentity> {
  const override = process.env["ROLL_MAIN_SLUG"];
  if (override !== undefined && override !== "") {
    // Oracle returns the override before touching the filesystem; we still
    // report a canonical path for callers that want one.
    const canon = await canonicalProjectPath(path, platform);
    return { path: canon, slug: override };
  }
  const canon = await canonicalProjectPath(path, platform);
  const url = await remoteUrl(canon);
  const inputs: ProjectIdentityInputs = { path: canon, remoteUrl: url };
  return { path: canon, slug: projectSlug(inputs) };
}

// ─── small lenient fs helpers (mirror bash `rm -rf ... || true`) ──────────────

function defaultExists(p: string): boolean {
  return existsSync(p);
}

function rmSyncQuiet(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true });
  } catch {
    /* lenient: mirrors `rm -rf ... 2>/dev/null || true` */
  }
}

async function realpathQuiet(p: string): Promise<string | undefined> {
  try {
    return await realpath(p);
  } catch {
    return undefined;
  }
}
