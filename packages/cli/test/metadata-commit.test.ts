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
  // US-PHYSICAL-008 test isolation: the Bash tooling may inject GIT_DIR/GIT_WORK_TREE
  // for the project worktree; temp fixture repos must be addressed by cwd only.
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_CEILING_DIRECTORIES: undefined,
    },
  });
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

  // ── FIX-367: the metadata commit must not clobber a concurrent Done flip ──────
  //
  // The re-pick storm (FIX-364 re-done 3 cycles): a published_pending_merge card
  // rests 📋 Todo while the PR-lane merges its PR async and pushes a `✅ Done` flip
  // to the roll-meta remote. The NEXT cycle's metadata commit — built on the STALE
  // pick-time `.roll` snapshot (card still 📋 Todo) — must integrate that remote
  // Done (rebase-safe) and never overwrite it back to 📋 Todo. These tests drive
  // the REAL commitRollMetadataRepo against a remote that advanced concurrently.

  it("FIX-367: integrates a concurrently-pushed Done — never clobbers it back to Todo", () => {
    return (async () => {
      const { project, roll, remote } = makeRollRepo("fix367-noclobber");
      // The seed backlog the cycle picked at pick time: FIX-364 is 📋 Todo.
      writeFileSync(
        join(roll, "backlog.md"),
        "| ID | Description | Status |\n|----|----|----|\n| FIX-364 | bug | 📋 Todo |\n",
        "utf8",
      );
      git(roll, [...GIT_ID, "add", "-A"]);
      git(roll, [...GIT_ID, "commit", "-q", "-m", "pick-time snapshot: FIX-364 Todo"]);
      git(roll, ["push", "-q", "origin", "main"]);

      // Concurrent actor (the PR-lane's merge-time Done flip / a reconcile / a
      // manual rescue) pushes `✅ Done` to the REMOTE from a SEPARATE clone — the
      // cycle's local .roll never saw it.
      const other = tmp("fix367-noclobber-other");
      git(other, ["clone", "-q", remote, "."]);
      git(other, ["config", "user.email", "t@t"]);
      git(other, ["config", "user.name", "t"]);
      writeFileSync(
        join(other, "backlog.md"),
        "| ID | Description | Status |\n|----|----|----|\n| FIX-364 | bug | ✅ Done |\n",
        "utf8",
      );
      git(other, [...GIT_ID, "add", "-A"]);
      git(other, [...GIT_ID, "commit", "-q", "-m", "PR-lane merged FIX-364 → Done"]);
      git(other, ["push", "-q", "origin", "main"]);

      // The cycle's agent wrote its evidence into the STALE local .roll (the
      // backlog row on disk is still 📋 Todo — the metadata commit must NOT push
      // that stale row over the remote Done).
      mkdirSync(join(roll, "features", "loop-engine", "FIX-364", "latest"), { recursive: true });
      writeFileSync(join(roll, "features", "loop-engine", "FIX-364", "latest", "report.html"), "<html>ok</html>", "utf8");

      const res = await commitRollMetadataRepo(project, "chore: loop cycle 20260619-022646 FIX-364 metadata");

      expect(res.committed).toBe(true);
      expect(res.pushed).toBe(true);
      // The remote backlog must still read ✅ Done — the concurrent flip survived.
      const remoteBacklog = git(remote, ["show", "main:backlog.md"]);
      expect(remoteBacklog).toContain("✅ Done");
      expect(remoteBacklog).not.toContain("📋 Todo");
      // …and the cycle's evidence ALSO landed (rebase put it on top of the Done).
      const ls = git(remote, ["ls-tree", "-r", "--name-only", "main"]);
      expect(ls).toContain("features/loop-engine/FIX-364/latest/report.html");
    })();
  });

  it("FIX-367: a fast-forward push (no concurrent change) still lands cleanly", () => {
    return (async () => {
      const { project, roll, remote } = makeRollRepo("fix367-ff");
      writeFileSync(join(roll, "note.txt"), "agent wrote this", "utf8");

      const res = await commitRollMetadataRepo(project, "chore: loop cycle X metadata");

      expect(res).toEqual({ committed: true, pushed: true, nothingToCommit: false });
      expect(git(roll, ["rev-parse", "HEAD"]).trim()).toBe(git(remote, ["rev-parse", "main"]).trim());
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

  // ── US-PHYSICAL-008: image evidence must not land in a public/unknown remote ───

  it("blocks image evidence when the roll-meta remote visibility is public/unknown", () => {
    return (async () => {
      const { project, roll } = makeRollRepo("vis-block");
      // A bare file:// remote is non-GitHub and reachable → visibility unknown,
      // which the guard treats as public (conservative).
      mkdirSync(join(roll, "features", "capture-tool", "US-PHYSICAL-008", "screenshots"), { recursive: true });
      writeFileSync(join(roll, "features", "capture-tool", "US-PHYSICAL-008", "screenshots", "x.png"), "fake", "utf8");

      const res = await commitRollMetadataRepo(project, "chore: loop cycle X metadata");

      expect(res.committed).toBe(false);
      expect(res.pushed).toBe(false);
      expect(res.nothingToCommit).toBe(false);
      expect(String(res.error)).toContain("image evidence blocked");
    })();
  });

  it("allows image evidence when the owner records a public-visibility waiver", () => {
    return (async () => {
      const { project, roll, remote } = makeRollRepo("vis-waiver");
      mkdirSync(join(roll, "features", "capture-tool", "US-PHYSICAL-008", "screenshots"), { recursive: true });
      writeFileSync(join(roll, "features", "capture-tool", "US-PHYSICAL-008", "screenshots", "x.png"), "fake", "utf8");
      // Waiver lives in the project-level config (inside .roll for nested layout).
      writeFileSync(join(project, ".roll", "local.yaml"), "evidence_public_waiver: true\n", "utf8");

      const res = await commitRollMetadataRepo(project, "chore: loop cycle X metadata");

      expect(res).toEqual({ committed: true, pushed: true, nothingToCommit: false });
      expect(git(remote, ["ls-tree", "-r", "--name-only", "main"])).toContain(
        "features/capture-tool/US-PHYSICAL-008/screenshots/x.png",
      );
    })();
  });
});
