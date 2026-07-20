import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IssueStoryContract } from "@roll/core";
import { repositoryIdFromRemote, type RepositoryBinding, type RequirementSourceManifest } from "@roll/spec";
import { afterEach, describe, expect, it } from "vitest";
import {
  IssueInitializationError,
  applyIssueInit,
  inspectIssueInit,
} from "../src/issue-worktrees.js";
import { protectReadOnlyWorktree, unprotectReadOnlyWorktree } from "../src/issue-worktree-git.js";

const sandboxes: string[] = [];
afterEach(() => {
  for (const root of sandboxes.splice(0)) {
    // A read-only Issue worktree (real filesystem write-denial, not just a
    // detached HEAD) would otherwise make `rmSync(recursive)` fail with
    // EACCES on its protected files/directories.
    unprotectReadOnlyWorktree(root);
    rmSync(root, { recursive: true, force: true });
  }
});

function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), "roll-issue-worktrees-"));
  sandboxes.push(root);
  return root;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Materialize a real remote with one commit on main. */
function materializeRemote(root: string, name: string): string {
  const source = join(root, `${name}-source`);
  mkdirSync(source, { recursive: true });
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "roll@example.test"]);
  git(source, ["config", "user.name", "Roll Test"]);
  writeFileSync(join(source, "README.md"), "fixture\n", "utf8");
  git(source, ["add", "README.md"]);
  git(source, ["commit", "-q", "-m", "fixture"]);
  const remote = join(root, `${name}.git`);
  git(root, ["clone", "-q", "--bare", source, remote]);
  return remote;
}

function binding(alias: string, remote: string): RepositoryBinding {
  const url = `file://${remote}`;
  const repoId = repositoryIdFromRemote(url);
  if (!repoId.ok) throw new Error(`fixture remote must be valid: ${remote}`);
  return {
    schema: "roll.repository-binding/v1",
    repoId: repoId.value,
    alias,
    remote: url,
    integrationBranch: "main",
    provider: "generic",
    workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: [] },
  };
}

function fixture() {
  const root = sandbox();
  const rollHome = join(root, "roll-home");
  const sot1Remote = materializeRemote(root, "sot1");
  const sot2Remote = materializeRemote(root, "sot2");
  const sot3Remote = materializeRemote(root, "sot3");
  const bindings: readonly RepositoryBinding[] = [
    binding("sot1", sot1Remote),
    binding("sot2", sot2Remote),
    binding("sot3", sot3Remote),
  ];
  const contract: IssueStoryContract = {
    storyId: "US-XX1",
    repositories: [
      { alias: "sot1", access: "write", requiredDelivery: true },
      { alias: "sot2", access: "write", requiredDelivery: true, dependsOnRepo: "sot1" },
      { alias: "sot3", access: "read", requiredDelivery: false },
    ],
  };
  const requirementManifests: readonly RequirementSourceManifest[] = [];
  const workspaceRoot = join(root, "workspace");
  const issueRoot = join(workspaceRoot, "issues", "US-XX1");
  return { root, rollHome, bindings, contract, requirementManifests, workspaceRoot, issueRoot, remotes: { sot1: sot1Remote, sot2: sot2Remote, sot3: sot3Remote } };
}

describe("inspectIssueInit", () => {
  it("is side-effect free and reports every target's full check facts for a brand-new Issue", async () => {
    const f = fixture();
    const before = existsSync(f.rollHome);
    const report = await inspectIssueInit({
      workspaceId: "ws-demo",
      rollHome: f.rollHome,
      workspaceRoot: f.workspaceRoot,
      issueRoot: f.issueRoot,
      contract: f.contract,
      bindings: f.bindings,
    });
    expect(report.manifest.state).toBe("absent");
    expect(report.targets["sot1"]).toMatchObject({
      alias: "sot1", access: "write", repoId: f.bindings.find((b) => b.alias === "sot1")?.repoId,
      cacheState: "absent", baseSha: null, decision: "created", workBranch: expect.stringContaining("sot1"),
    });
    expect(report.targets["sot3"]).toMatchObject({ alias: "sot3", access: "read", workBranch: null });
    // Zero filesystem writes anywhere, including the machine Roll Home cache.
    expect(before).toBe(false);
    expect(existsSync(f.rollHome)).toBe(false);
    expect(existsSync(f.issueRoot)).toBe(false);
  });

  it("reports compatible cache/worktree facts after a real apply, still with zero writes on re-check", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });

    const beforeDigest = statSync(f.rollHome).mtimeMs;
    const report = await inspectIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings });
    expect(statSync(f.rollHome).mtimeMs).toBe(beforeDigest); // zero writes on re-check

    expect(report.manifest.state).toBe("compatible");
    for (const alias of ["sot1", "sot2", "sot3"]) {
      expect(report.targets[alias]).toMatchObject({ cacheState: "compatible", decision: "reused" });
      expect(typeof report.targets[alias]?.baseSha).toBe("string");
      expect(typeof report.targets[alias]?.cachePath).toBe("string");
    }
    expect(report.targets["sot1"]?.workBranch).toBe("roll/ws-demo/US-XX1/sot1");
    expect(report.targets["sot3"]?.workBranch).toBeNull();
  });
});

describe("applyIssueInit", () => {
  it("creates the Issue root with real git worktrees, the immutable manifest, and one issue:repository_bound event per target with full facts", async () => {
    const f = fixture();
    const result = await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });

    expect(result.outcome).toBe("created");
    expect(existsSync(join(f.issueRoot, "sot1", ".git"))).toBe(true);
    expect(existsSync(join(f.issueRoot, "sot2", ".git"))).toBe(true);
    expect(existsSync(join(f.issueRoot, "sot3", ".git"))).toBe(true);
    // Write targets get a real named branch; read targets are real detached worktrees.
    expect(git(join(f.issueRoot, "sot1"), ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("roll/ws-demo/US-XX1/sot1");
    expect(() => git(join(f.issueRoot, "sot3"), ["symbolic-ref", "-q", "HEAD"])).toThrow();

    const manifestPath = join(f.issueRoot, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest).toMatchObject({ schema: "roll.issue/v1", workspaceId: "ws-demo", storyId: "US-XX1" });
    // The immutable manifest never carries runtime SHA/path/branch.
    expect(JSON.stringify(manifest)).not.toContain("baseSha");
    expect(JSON.stringify(manifest)).not.toContain("worktreePath");
    expect(JSON.stringify(manifest)).not.toContain("workBranch");

    const events = readFileSync(join(f.issueRoot, "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event).toMatchObject({ type: "issue:repository_bound", workspaceId: "ws-demo", storyId: "US-XX1" });
      expect(typeof event.repoId).toBe("string");
      expect(typeof event.alias).toBe("string");
      expect(["read", "write"]).toContain(event.access);
      expect(typeof event.baseSha).toBe("string");
      expect(typeof event.worktreePath).toBe("string");
    }
    const sot1Event = events.find((event) => event.alias === "sot1");
    expect(sot1Event.workBranch).toBe("roll/ws-demo/US-XX1/sot1");
    const sot3Event = events.find((event) => event.alias === "sot3");
    expect(sot3Event.workBranch).toBeNull();
  });

  it("resolves ALL targets, cache and base SHA before creating or mutating the Issue root", async () => {
    const f = fixture();
    // Break the SECOND repository's remote before apply — resolution of every
    // target must fail BEFORE the Issue root is created at all.
    rmSync(f.remotes.sot2, { recursive: true, force: true });

    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);
    expect(existsSync(f.issueRoot)).toBe(false);
  });

  it("uses the real machine Roll Home cache under <rollHome>/repos, never a Workspace-relative cache", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    expect(existsSync(join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot1")?.repoId}.git`))).toBe(true);
    expect(existsSync(join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot2")?.repoId}.git`))).toBe(true);
    expect(existsSync(join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot3")?.repoId}.git`))).toBe(true);
    // No cache anywhere under the Workspace/Issue tree.
    expect(existsSync(join(f.root, "workspace", ".roll-cache"))).toBe(false);
  });

  it("never mutates the manifest once written, and reuses it verbatim on a compatible retry", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    const manifestPath = join(f.issueRoot, "manifest.json");
    const before = readFileSync(manifestPath, "utf8");

    const retry = await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    expect(retry.outcome).toBe("reused");
    expect(readFileSync(manifestPath, "utf8")).toBe(before);
  });

  it("real-git idempotent retry creates no duplicate worktrees, branches or events; manifest bytes unchanged", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    const cachePath = join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot1")?.repoId}.git`);
    const listBefore = git(cachePath, ["worktree", "list", "--porcelain"]);
    const eventsBefore = readFileSync(join(f.issueRoot, "events.jsonl"), "utf8");

    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    const listAfter = git(cachePath, ["worktree", "list", "--porcelain"]);
    expect(listAfter).toBe(listBefore);
    expect(readFileSync(join(f.issueRoot, "events.jsonl"), "utf8")).toBe(eventsBefore);
    const branches = git(cachePath, ["branch", "--list", "roll/*"]).split("\n").filter(Boolean);
    expect(branches).toHaveLength(1);
  });

  it("rejects an on-disk manifest that conflicts with the resolved identity instead of overwriting it", async () => {
    const f = fixture();
    mkdirSync(f.issueRoot, { recursive: true });
    writeFileSync(join(f.issueRoot, "manifest.json"), JSON.stringify({
      schema: "roll.issue/v1", workspaceId: "ws-other", storyId: "US-XX1", requirements: [], repositories: [],
    }));
    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);
  });

  it("rejects a manifest_conflict when requirements/repositories changed under the same identity, with zero mutation", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    const manifestPath = join(f.issueRoot, "manifest.json");
    const before = readFileSync(manifestPath, "utf8");

    // Same workspaceId/storyId, but the Story Contract now declares a DIFFERENT
    // repository set — the full immutable intent no longer matches.
    const changedContract: IssueStoryContract = {
      storyId: "US-XX1",
      repositories: [
        { alias: "sot1", access: "write", requiredDelivery: true },
        { alias: "sot3", access: "read", requiredDelivery: false },
      ],
    };
    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: changedContract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);
    expect(readFileSync(manifestPath, "utf8")).toBe(before);
  });

  it("rejects a symlinked Issue root (workspace/issues/<story> escaping the Workspace) with zero writes, for both check and apply", async () => {
    const f = fixture();
    const outsideTarget = join(f.root, "outside-escape-target");
    mkdirSync(outsideTarget, { recursive: true });
    // Replace the Issue root ITSELF with a symlink pointing outside the
    // Workspace tree — a real escape, not a mock.
    mkdirSync(join(f.root, "workspace", "issues"), { recursive: true });
    symlinkSync(outsideTarget, f.issueRoot);

    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);
    // Zero writes: the outside target must remain completely empty.
    expect(existsSync(join(outsideTarget, "manifest.json"))).toBe(false);
    expect(existsSync(join(outsideTarget, "sot1"))).toBe(false);

    const report = await inspectIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings });
    expect(report.manifest.state).toBe("conflict");
  });

  it("rejects a symlinked workspace/issues ANCESTOR directory escaping the Workspace, before any mutation", async () => {
    const f = fixture();
    const outsideTarget = join(f.root, "outside-escape-ancestor");
    mkdirSync(outsideTarget, { recursive: true });
    mkdirSync(join(f.root, "workspace"), { recursive: true });
    // The Issue root's own PARENT ("issues" dir) is a symlink — every child
    // path underneath (including f.issueRoot) resolves outside the Workspace.
    symlinkSync(outsideTarget, join(f.root, "workspace", "issues"));

    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);
    expect(existsSync(join(outsideTarget, "US-XX1"))).toBe(false);
  });

  it("resolves no target and creates nothing when even ONE target's repository cache cannot be resolved", async () => {
    const f = fixture();
    // Break sot3's remote — cache resolution for ALL targets happens BEFORE
    // any worktree is created, so this must leave the Issue root untouched.
    rmSync(f.remotes.sot3, { recursive: true, force: true });

    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);

    expect(existsSync(f.issueRoot)).toBe(false);
  });

  it("rolls back a newly-created CLEAN target via real git worktree removal when a LATER target's worktree add genuinely fails", async () => {
    const f = fixture();
    // A real, unmocked git-level failure at the worktree-ADD phase (after
    // every target's cache already resolved): sot2's governed branch name
    // already exists in its OWN cache (e.g. left by some other process) —
    // git's own `worktree add -b` refuses to recreate an existing branch.
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.root, issueRoot: join(f.root, "throwaway-issue"), contract: { storyId: "US-XX1", repositories: [{ alias: "sot2", access: "write", requiredDelivery: true }] }, bindings: f.bindings, requirementManifests: f.requirementManifests });

    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);

    // sot1 was newly-created and clean -> rolled back via git worktree remove.
    expect(existsSync(join(f.issueRoot, "sot1"))).toBe(false);
    const journal = JSON.parse(readFileSync(join(f.issueRoot, "issue-init.pending.json"), "utf8"));
    expect(journal.status).toBe("repair_required");
  });

  it("preserves a target that becomes dirty after creation when a LATER target fails — real fault injection", async () => {
    const f = fixture();
    // A real, unmocked git-level failure at the worktree-ADD phase: sot2's
    // governed branch already exists in its own cache (left by some other
    // process), so git's own `worktree add -b` refuses to recreate it.
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.root, issueRoot: join(f.root, "throwaway-issue"), contract: { storyId: "US-XX1", repositories: [{ alias: "sot2", access: "write", requiredDelivery: true }] }, bindings: f.bindings, requirementManifests: f.requirementManifests });

    let firstAttemptError: unknown;
    try {
      await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }, {
        // Real fault injection: the instant sot1's real worktree is created,
        // make it genuinely dirty — BEFORE sot2's real git failure triggers rollback.
        afterTargetCreated: (alias, path) => {
          if (alias === "sot1") writeFileSync(join(path, "dirty.txt"), "keep me — real uncommitted work");
        },
      });
    } catch (error) {
      firstAttemptError = error;
    }
    expect(firstAttemptError).toBeInstanceOf(IssueInitializationError);
    // sot1 went dirty before rollback ran -> preserved, never removed.
    expect(existsSync(join(f.issueRoot, "sot1", "dirty.txt"))).toBe(true);

    // Repair: remove the colliding branch from the OTHER worktree, then re-run.
    const cachePath = join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot2")?.repoId}.git`);
    execFileSync("git", ["worktree", "remove", "--force", join(f.root, "throwaway-issue", "sot2")], { cwd: cachePath, stdio: "ignore" });
    execFileSync("git", ["branch", "-D", "roll/ws-demo/US-XX1/sot2"], { cwd: cachePath, stdio: "ignore" });
    const repaired = await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    expect(repaired.outcome).toBe("repaired");
    expect(existsSync(join(f.issueRoot, "sot1", "dirty.txt"))).toBe(true);
    expect(existsSync(join(f.issueRoot, "sot2", ".git"))).toBe(true);
  });

  it("resumes and repairs the same Issue identity after interruption without duplicating worktrees or branches", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.root, issueRoot: join(f.root, "throwaway-issue"), contract: { storyId: "US-XX1", repositories: [{ alias: "sot2", access: "write", requiredDelivery: true }] }, bindings: f.bindings, requirementManifests: f.requirementManifests });
    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);
    // sot1 was newly-created and clean -> rolled back on the failed attempt.
    expect(existsSync(join(f.issueRoot, "sot1"))).toBe(false);

    const cachePath = join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot2")?.repoId}.git`);
    execFileSync("git", ["worktree", "remove", "--force", join(f.root, "throwaway-issue", "sot2")], { cwd: cachePath, stdio: "ignore" });
    execFileSync("git", ["branch", "-D", "roll/ws-demo/US-XX1/sot2"], { cwd: cachePath, stdio: "ignore" });
    const result = await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    expect(result.outcome).toBe("repaired");
    expect(existsSync(join(f.issueRoot, "sot2", ".git"))).toBe(true);
    expect(existsSync(join(f.issueRoot, "sot3", ".git"))).toBe(true);

    const sot1CachePath = join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot1")?.repoId}.git`);
    const branches = git(sot1CachePath, ["branch", "--list", "roll/*"]).split("\n").filter(Boolean);
    expect(branches).toHaveLength(1); // sot1 never got a duplicate branch across the two attempts
  });

  it("rolls back a target the journal already marked created even when read-only PROTECTION itself genuinely fails afterward", async () => {
    const f = fixture();
    let sot3Path = "";
    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }, {
      // Real fault injection: right after sot3's real git worktree is created
      // and the journal has recorded it as created, but BEFORE
      // protectReadOnlyWorktree runs, strip read permission from sot3's own
      // checkout root. protectReadOnlyWorktree's readdirSync then genuinely
      // fails with EACCES — a real OS-level failure, not a mock. `git status`
      // / `git rev-parse` still succeed (they only need the execute/traverse
      // bit, which this mode keeps), so rollback's own identity probe still
      // sees a real, clean, compatible worktree it can act on.
      beforeProtect: (alias, path) => {
        if (alias === "sot3") {
          sot3Path = path;
          chmodSync(path, 0o311);
        }
      },
    })).rejects.toThrow(IssueInitializationError);

    // sot3 was journaled as created BEFORE protection ran, so rollback knows
    // about it and removes it via a real `git worktree remove` — never left
    // behind ungoverned just because protection itself failed.
    expect(existsSync(sot3Path)).toBe(false);
    // sot1/sot2 (created earlier in the SAME run, never touched again) were
    // also clean -> rolled back too.
    expect(existsSync(join(f.issueRoot, "sot1"))).toBe(false);
    expect(existsSync(join(f.issueRoot, "sot2"))).toBe(false);
    const journal = JSON.parse(readFileSync(join(f.issueRoot, "issue-init.pending.json"), "utf8"));
    expect(journal.status).toBe("repair_required");
  });

  it("refuses a read target whose real checkout contains a TRACKED symlink, rolling back deterministically", async () => {
    const f = fixture();
    // sot3 (the read target) is seeded with a real git-tracked symlink whose
    // target lives OUTSIDE the checkout entirely — chmod can never make a
    // symlink itself deny writes (it follows to the target), so the ONLY
    // safe contract is refusing to expose this checkout as read-only at all.
    const outsideFile = join(f.root, "outside-sot3-escape.txt");
    writeFileSync(outsideFile, "external content a read checkout must never let through\n", "utf8");
    symlinkSync(outsideFile, join(f.remotes.sot3.replace(/\.git$/, "-source"), "escape-link.txt"));
    const sot3Source = f.remotes.sot3.replace(/\.git$/, "-source");
    git(sot3Source, ["add", "escape-link.txt"]);
    git(sot3Source, ["commit", "-q", "-m", "add escaping symlink"]);
    // Refresh the bare remote sot3Remote points at so the new commit is fetchable.
    execFileSync("git", ["push", f.remotes.sot3, "HEAD:main"], { cwd: sot3Source, stdio: "ignore" });

    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);

    // sot1/sot2 were newly-created and clean during this run -> rolled back.
    expect(existsSync(join(f.issueRoot, "sot1"))).toBe(false);
    expect(existsSync(join(f.issueRoot, "sot2"))).toBe(false);
    // sot3 itself must never be left behind exposed as a "protected" read
    // checkout that actually still lets writes through its symlink.
    expect(existsSync(join(f.issueRoot, "sot3"))).toBe(false);
    const journal = JSON.parse(readFileSync(join(f.issueRoot, "issue-init.pending.json"), "utf8"));
    expect(journal.status).toBe("repair_required");
  });

  it("preserves a READ target as non-writable when rollback's own git worktree remove genuinely fails on it", async () => {
    const f = fixture();
    const sot3CachePath = join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot3")?.repoId}.git`);
    let sot3Path = "";
    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }, {
      // Real fault injection: right after sot3 (the read target, last in
      // contract order) is created and protected, LOCK its real worktree —
      // a genuine, unmocked reason `git worktree remove` refuses later,
      // independent of any dirty check — then throw to force apply into its
      // rollback path (sot3 is the last target created, so nothing further
      // downstream would otherwise fail).
      afterTargetCreated: (alias, path) => {
        if (alias === "sot3") {
          sot3Path = path;
          git(sot3CachePath, ["worktree", "lock", path]);
          throw new Error("real injected failure after sot3's creation, to force rollback");
        }
      },
    })).rejects.toThrow(IssueInitializationError);

    // Rollback attempted to remove sot3 (a target created THIS run) but git
    // genuinely refused (locked) -> preserved, and re-protected rather than
    // left writable just because unprotect ran before the failed removal.
    expect(existsSync(sot3Path)).toBe(true);
    expect(() => writeFileSync(join(sot3Path, "README.md"), "mutated\n", { flag: "r+" })).toThrow(/EACCES|EPERM/);
    expect(() => writeFileSync(join(sot3Path, "new-file.txt"), "new\n")).toThrow(/EACCES|EPERM/);

    git(sot3CachePath, ["worktree", "unlock", sot3Path]);
  });

  it("reports conflict (never reused) for a WRITE target checked out on the WRONG branch", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });

    // Real, unmocked drift: create the wrong branch FROM the actual worktree
    // (not the bare cache's HEAD, which may not even resolve) and switch
    // onto it — still perfectly clean and perfectly valid git-wise.
    const sot1Path = join(f.issueRoot, "sot1");
    git(sot1Path, ["switch", "-c", "wrong-branch"]);

    const report = await inspectIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings });
    expect(report.targets["sot1"]?.decision).toBe("conflict");

    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);
  });

  it("stays reused/compatible for a WRITE target with LATER real story commits on its own governed branch", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });

    // Real, unmocked forward progress: commit real story work onto sot1's
    // OWN governed branch — exactly what a Builder is expected to do. The
    // pinned base remains an ANCESTOR of the new HEAD, so this must stay
    // fully compatible, not become a conflict.
    const sot1Path = join(f.issueRoot, "sot1");
    writeFileSync(join(sot1Path, "story-work.txt"), "real story commit\n", "utf8");
    git(sot1Path, ["add", "story-work.txt"]);
    git(sot1Path, ["commit", "-q", "-m", "real story commit"]);

    const report = await inspectIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings });
    expect(report.targets["sot1"]?.decision).toBe("reused");

    const applied = await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    expect(applied.outcome).toBe("reused");
    // The real story commit is untouched — apply never resets/discards it.
    expect(existsSync(join(sot1Path, "story-work.txt"))).toBe(true);
  });

  it("reports conflict for a WRITE target with DIVERGED history (pinned base is NOT an ancestor of HEAD)", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });

    // Real divergence: reset sot1's OWN governed branch onto an orphan
    // history sharing NO ancestry with the pinned base.
    const sot1Path = join(f.issueRoot, "sot1");
    git(sot1Path, ["checkout", "--orphan", "unrelated-history"]);
    git(sot1Path, ["rm", "-rf", "."]);
    writeFileSync(join(sot1Path, "unrelated.txt"), "unrelated root commit\n", "utf8");
    git(sot1Path, ["add", "unrelated.txt"]);
    git(sot1Path, ["commit", "-q", "-m", "unrelated root commit"]);
    git(sot1Path, ["branch", "-f", "roll/ws-demo/US-XX1/sot1", "unrelated-history"]);
    git(sot1Path, ["checkout", "roll/ws-demo/US-XX1/sot1"]);

    const report = await inspectIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings });
    expect(report.targets["sot1"]?.decision).toBe("conflict");

    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);
  });

  it("reports conflict for a READ target detached at the WRONG HEAD commit (real apply-side rejection too)", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });

    // sot3 is protected (read-only) — unprotect ONLY inside this test before
    // creating the real drift commit, then the checkout is left non-writable
    // again by the immediately-following `checkout --detach`, which git
    // performs regardless of the write-bit (it only touches its own index
    // and HEAD ref, not the tracked working files that changed).
    const sot3Path = join(f.issueRoot, "sot3");
    unprotectReadOnlyWorktree(sot3Path);
    writeFileSync(join(sot3Path, "extra.txt"), "real extra commit on the read target\n", "utf8");
    git(sot3Path, ["add", "extra.txt"]);
    git(sot3Path, ["commit", "-q", "-m", "real drift commit"]);
    git(sot3Path, ["checkout", "--detach", "HEAD"]);
    protectReadOnlyWorktree(sot3Path);

    const report = await inspectIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings });
    expect(report.targets["sot3"]?.decision).toBe("conflict");

    // apply must ALSO reject — never silently repair/reuse an incompatible
    // actual worktree just because --check alone caught it.
    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);
  });

  it("keeps an existing Issue pinned and reusable after the shared cache's integration ref advances independently", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    const eventsAfterCreate = readFileSync(join(f.issueRoot, "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const pinnedBase = eventsAfterCreate.find((event) => event.alias === "sot1").baseSha as string;

    // Real, unmocked simulation of ANOTHER Workspace sharing this SAME
    // machine cache advancing the integration branch — push a brand-new
    // commit to sot1's real remote, then refresh the shared cache's
    // tracking ref for it directly (mirrors what ensureRepositoryCache's own
    // fetch would do on the next apply for some OTHER Issue).
    const sourceDir = f.remotes.sot1.replace(/\.git$/, "-source");
    writeFileSync(join(sourceDir, "new-upstream-work.txt"), "advanced upstream\n", "utf8");
    git(sourceDir, ["add", "new-upstream-work.txt"]);
    git(sourceDir, ["commit", "-q", "-m", "advanced upstream work"]);
    execFileSync("git", ["push", f.remotes.sot1, "HEAD:main"], { cwd: sourceDir, stdio: "ignore" });
    const sot1CachePath = join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot1")?.repoId}.git`);
    git(sot1CachePath, ["fetch", "--prune", f.remotes.sot1, "+refs/heads/main:refs/remotes/origin/main"]);
    const advancedRef = git(sot1CachePath, ["rev-parse", "refs/remotes/origin/main"]);
    expect(advancedRef).not.toBe(pinnedBase);

    // The existing Issue's check/reuse/repair must remain pinned at the
    // ORIGINAL base — never silently reflect the advanced shared ref.
    const report = await inspectIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings });
    expect(report.targets["sot1"]?.baseSha).toBe(pinnedBase);
    expect(report.targets["sot1"]?.decision).toBe("reused");

    const reapplied = await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    expect(reapplied.outcome).toBe("reused");
  });

  it("repairs an absent existing target from the Issue-PINNED base, not the shared cache's advanced integration head", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    const events = readFileSync(join(f.issueRoot, "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const pinnedBaseSot3 = events.find((event) => event.alias === "sot3").baseSha as string;

    // Advance sot3's real upstream AFTER the Issue already pinned its base.
    const sourceDir = f.remotes.sot3.replace(/\.git$/, "-source");
    writeFileSync(join(sourceDir, "new-upstream-work.txt"), "advanced upstream\n", "utf8");
    git(sourceDir, ["add", "new-upstream-work.txt"]);
    git(sourceDir, ["commit", "-q", "-m", "advanced upstream work"]);
    execFileSync("git", ["push", f.remotes.sot3, "HEAD:main"], { cwd: sourceDir, stdio: "ignore" });

    // Now delete sot3's real worktree directory by hand (a real operator
    // action, not a mock) — its path is absent, but the Issue already has a
    // completed issue:repository_bound fact pinning its original base.
    // sot3 is protected (read-only), so `git worktree remove` needs its
    // write bits restored first — the same real filesystem state a genuine
    // operator would need to deal with.
    unprotectReadOnlyWorktree(join(f.issueRoot, "sot3"));
    const sot3CachePath = join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot3")?.repoId}.git`);
    execFileSync("git", ["worktree", "remove", "--force", join(f.issueRoot, "sot3")], { cwd: sot3CachePath, stdio: "ignore" });

    const repaired = await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    expect(repaired.outcome).toBe("repaired");
    const recreatedHead = git(join(f.issueRoot, "sot3"), ["rev-parse", "HEAD"]);
    expect(recreatedHead).toBe(pinnedBaseSot3);
  });

  it("fails loud with zero destructive mutation when the journal and a completed event disagree on a target's pinned facts", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    const eventsBefore = readFileSync(join(f.issueRoot, "events.jsonl"), "utf8");
    const manifestBefore = readFileSync(join(f.issueRoot, "manifest.json"), "utf8");

    // Plant a STALE, CONFLICTING journal alongside the already-completed
    // events — a real malformed-state scenario (e.g. a leftover journal
    // from an old, already-superseded interrupted attempt with a different
    // pinned base than what actually completed).
    const staleJournal = {
      schema: "roll.issue-init-journal/v1",
      transactionId: "stale-transaction",
      workspaceId: "ws-demo",
      storyId: "US-XX1",
      status: "repair_required",
      targets: [
        { alias: "sot1", path: join(f.issueRoot, "sot1"), created: false, workBranch: "roll/ws-demo/US-XX1/sot1", access: "write", baseSha: "0".repeat(40) },
      ],
    };
    writeFileSync(join(f.issueRoot, "issue-init.pending.json"), `${JSON.stringify(staleJournal, null, 2)}\n`, "utf8");

    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);

    // Zero destructive mutation: events and manifest are byte-identical.
    expect(readFileSync(join(f.issueRoot, "events.jsonl"), "utf8")).toBe(eventsBefore);
    expect(readFileSync(join(f.issueRoot, "manifest.json"), "utf8")).toBe(manifestBefore);
    expect(existsSync(join(f.issueRoot, "sot1", ".git"))).toBe(true); // untouched real worktree

    const report = await inspectIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings });
    expect(report.targets["sot1"]?.decision).toBe("conflict");

    rmSync(join(f.issueRoot, "issue-init.pending.json"), { force: true });
  });

  it("never leaves a stale success fact (issue:repository_bound event) for a target that was rolled back on a failed apply", async () => {
    const f = fixture();
    // A real, unmocked git-level failure at the worktree-ADD phase: sot2's
    // governed branch already exists in its own cache (left by some other
    // process), so git's own `worktree add -b` refuses to recreate it.
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.root, issueRoot: join(f.root, "throwaway-issue"), contract: { storyId: "US-XX1", repositories: [{ alias: "sot2", access: "write", requiredDelivery: true }] }, bindings: f.bindings, requirementManifests: f.requirementManifests });

    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);

    // sot1 was rolled back — no events.jsonl was ever created for THIS
    // Issue at all, since the whole run failed before reaching the
    // event-write step (sot1 succeeded, sot2 genuinely failed).
    expect(existsSync(join(f.issueRoot, "events.jsonl"))).toBe(false);
    const journal = JSON.parse(readFileSync(join(f.issueRoot, "issue-init.pending.json"), "utf8"));
    expect(journal.status).toBe("repair_required");

    // Repair: remove the colliding branch, then re-run — the same contract converges.
    const sot2CachePath = join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot2")?.repoId}.git`);
    execFileSync("git", ["worktree", "remove", "--force", join(f.root, "throwaway-issue", "sot2")], { cwd: sot2CachePath, stdio: "ignore" });
    execFileSync("git", ["branch", "-D", "roll/ws-demo/US-XX1/sot2"], { cwd: sot2CachePath, stdio: "ignore" });
    const repaired = await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, workspaceRoot: f.workspaceRoot, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    expect(repaired.outcome).toBe("repaired");
    const events = readFileSync(join(f.issueRoot, "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(events).toHaveLength(3); // sot1, sot2, sot3 — exactly once each, no stale/duplicate facts.
    expect(new Set(events.map((e) => e.alias)).size).toBe(3);
  });
});
