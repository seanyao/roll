/**
 * FIX-306 — the runner commits the `.roll` metadata repo, NOT the sandboxed
 * agent. These tests exercise the REAL `commitRollMetadataRepo` against a live
 * fixture: a `.roll` directory that is its OWN git repo (the nested roll-meta
 * layout) with a bare file:// remote — the same shape codex's sandbox cannot
 * commit but the unsandboxed runner can.
 *
 * The codex meta-commit-blocked scenario is exactly: the agent WROTE files under
 * `.roll/` (acceptance report / evidence / ac-map) but could not run
 * `git -C .roll add -A && commit` because the `.roll` repo's git-internal dir is
 * outside its sandbox writable roots. The runner reproduces that "files written,
 * not yet committed" working tree and proves it lands the commit + push.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { commitRollMetadataRepo } from "../src/runner/index.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmp(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `roll-meta-${tag}-`));
  dirs.push(d);
  return d;
}

const GIT_ID = ["-c", "user.email=t@t", "-c", "user.name=t"];
function git(cwd: string, args: string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

/**
 * A project whose `.roll` is its OWN git repo with a bare file:// remote (the
 * roll-meta layout). Returns the project root, the `.roll` dir, and the remote.
 */
function makeRollRepo(tag: string): { project: string; roll: string; remote: string } {
  const remote = tmp(`${tag}-remote`);
  git(remote, ["init", "-q", "--bare", "-b", "main"]);

  const project = tmp(`${tag}-project`);
  const roll = join(project, ".roll");
  mkdirSync(roll, { recursive: true });
  git(roll, ["init", "-q", "-b", "main"]);
  // The real loop runs on the owner's machine with a configured git identity;
  // CI sandboxes may have none, so pin a repo-local one (the runner's plain
  // `git commit` reads it — it does not inject -c flags).
  git(roll, ["config", "user.email", "t@t"]);
  git(roll, ["config", "user.name", "t"]);
  git(roll, ["remote", "add", "origin", remote]);
  writeFileSync(join(roll, "backlog.md"), "| ID | Status |\n|----|--------|\n", "utf8");
  git(roll, [...GIT_ID, "add", "-A"]);
  git(roll, [...GIT_ID, "commit", "-q", "-m", "seed .roll"]);
  git(roll, ["push", "-q", "-u", "origin", "main"]);
  return { project, roll, remote };
}

describe("FIX-306 commitRollMetadataRepo — runner owns the .roll commit", () => {
  it("commits + pushes the files the (sandboxed) agent wrote under .roll", () => {
    return (async () => {
      const { project, roll, remote } = makeRollRepo("write");
      // Simulate the agent's contribution: it WROTE files (acceptance report,
      // evidence) into .roll but could NOT commit them (sandbox).
      mkdirSync(join(roll, "features", "loop-engine", "FIX-306", "latest"), { recursive: true });
      writeFileSync(join(roll, "features", "loop-engine", "FIX-306", "latest", "FIX-306-report.html"), "<html>ok</html>", "utf8");

      const res = await commitRollMetadataRepo(project, "chore: loop cycle X FIX-306 metadata");

      expect(res).toEqual({ committed: true, pushed: true, nothingToCommit: false });
      // The commit landed on the local .roll repo HEAD.
      expect(git(roll, ["log", "-1", "--pretty=%s"]).trim()).toBe("chore: loop cycle X FIX-306 metadata");
      // …and reached the remote (Done ≡ pushed metadata, not a local-only commit).
      const remoteHead = git(remote, ["rev-parse", "main"]).trim();
      const localHead = git(roll, ["rev-parse", "HEAD"]).trim();
      expect(remoteHead).toBe(localHead);
    })();
  });

  it("a clean .roll (nothing to commit) no-ops cleanly", () => {
    return (async () => {
      const { project, roll } = makeRollRepo("clean");
      const before = git(roll, ["rev-parse", "HEAD"]).trim();

      const res = await commitRollMetadataRepo(project, "chore: should not commit");

      expect(res.nothingToCommit).toBe(true);
      expect(res.committed).toBe(false);
      // No new commit — HEAD unchanged.
      expect(git(roll, ["rev-parse", "HEAD"]).trim()).toBe(before);
    })();
  });

  it("a project that TRACKS .roll inside its OWN repo → no-op (PR delivers it, not a meta commit)", () => {
    return (async () => {
      // The main repo IS the git repo; `.roll` is a tracked subdir of it (not a
      // nested roll-meta). The runner must NOT commit here — that would stage the
      // whole main checkout. This is the layout the FIX-204C "tracks .roll" path.
      const project = tmp("tracked-project");
      git(project, ["init", "-q", "-b", "main"]);
      git(project, ["config", "user.email", "t@t"]);
      git(project, ["config", "user.name", "t"]);
      const roll = join(project, ".roll");
      mkdirSync(roll, { recursive: true });
      writeFileSync(join(roll, "backlog.md"), "| ID | Status |\n", "utf8");
      writeFileSync(join(project, "src.txt"), "product code\n", "utf8");
      git(project, ["add", "-A"]);
      git(project, ["commit", "-q", "-m", "seed main repo with tracked .roll"]);
      // The agent wrote an evidence file under the tracked .roll.
      writeFileSync(join(roll, "evidence.txt"), "agent wrote this\n", "utf8");
      const head = git(project, ["rev-parse", "HEAD"]).trim();

      const res = await commitRollMetadataRepo(project, "chore: must not fire on a tracked .roll");

      expect(res.nothingToCommit).toBe(true);
      expect(res.committed).toBe(false);
      // The main repo HEAD is untouched — no stray metadata commit on the product repo.
      expect(git(project, ["rev-parse", "HEAD"]).trim()).toBe(head);
    })();
  });

  it("absent .roll → clean no-op (project that does not carry a metadata repo)", () => {
    return (async () => {
      const project = tmp("absent-project");
      expect(existsSync(join(project, ".roll"))).toBe(false);

      const res = await commitRollMetadataRepo(project, "chore: nothing here");

      expect(res).toEqual({ committed: false, pushed: false, nothingToCommit: true });
    })();
  });

  it("a push failure reports committed-but-not-pushed (no silent false-success)", () => {
    return (async () => {
      const { project, roll } = makeRollRepo("badpush");
      // Point origin at a non-existent remote so the push fails AFTER the commit
      // lands — the exact partial-failure the ALERT must surface.
      git(roll, ["remote", "set-url", "origin", join(tmpdir(), "roll-meta-does-not-exist.git")]);
      writeFileSync(join(roll, "note.txt"), "agent wrote this", "utf8");

      const res = await commitRollMetadataRepo(project, "chore: commit lands, push fails");

      expect(res.committed).toBe(true);
      expect(res.pushed).toBe(false);
      expect(res.nothingToCommit).toBe(false);
      expect(res.error).toBeDefined();
      expect(String(res.error)).toContain("push");
      // The commit is real and local even though the push failed.
      expect(git(roll, ["log", "-1", "--pretty=%s"]).trim()).toBe("chore: commit lands, push fails");
    })();
  });
});
