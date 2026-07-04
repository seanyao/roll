import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyMainCheckoutWriteProtection,
  checkMainDirty,
  quarantineMainCheckout,
  releaseMainCheckoutWriteProtection,
  withMainCheckoutWriteProtection,
  worktreeGitEnv,
} from "../src/runner/main-checkout-guard.js";

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function sh(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function git(repo: string, args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "ignore" });
}

function cleanRepo(prefix: string): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "t@example.test"]);
  git(repo, ["config", "user.name", "Test User"]);
  writeFileSync(join(repo, "tracked.txt"), "base\n", "utf8");
  mkdirSync(join(repo, ".roll", "loop"), { recursive: true });
  mkdirSync(join(repo, "skills"), { recursive: true });
  writeFileSync(join(repo, "skills", "README.md"), "skill scratch\n", "utf8");
  git(repo, ["add", "tracked.txt", "skills/README.md"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  git(repo, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  return repo;
}

function worktreeFrom(repo: string): string {
  const wt = `${repo}-wt`;
  dirs.push(wt);
  git(repo, ["worktree", "add", "-q", "-b", "cycle/test", wt, "origin/main"]);
  return wt;
}

describe("main checkout guard — US-LOOP-089", () => {
  it("physically rejects builder writes to main while the cycle worktree remains writable", async () => {
    const repo = cleanRepo("roll-main-guard-");
    const wt = worktreeFrom(repo);
    const runtimeDir = join(repo, ".roll", "loop");

    const events = await withMainCheckoutWriteProtection({ repoCwd: repo, runtimeDir, cycleId: "C-phys", nowMs: () => 1000 }, async () => {
      const blocked = spawnSync(
        process.execPath,
        [
          "-e",
          [
            "const fs = require('node:fs');",
            `fs.writeFileSync(${JSON.stringify(join(repo, "leak.txt"))}, 'blocked\\n');`,
          ].join(""),
        ],
        { encoding: "utf8" },
      );
      writeFileSync(join(wt, "worktree.txt"), "ok\n", "utf8");
      git(wt, ["add", "worktree.txt"]);
      git(wt, ["commit", "-q", "-m", "tcr: protected worktree commit"]);
      return { blockedStatus: blocked.status, blockedStderr: blocked.stderr };
    });

    expect(events.value.blockedStatus).not.toBe(0);
    expect(events.value.blockedStderr).toMatch(/EACCES|EPERM|permission denied/i);
    expect(existsSync(join(repo, "leak.txt"))).toBe(false);
    expect(readFileSync(join(wt, "worktree.txt"), "utf8")).toBe("ok\n");
    expect(sh(wt, ["log", "-1", "--format=%s"])).toBe("tcr: protected worktree commit");
    expect(events.events.map((e) => e.status)).toEqual(["applied", "released"]);
    expect(sh(repo, ["status", "--short"])).toBe("");
  });

  it("recovers a stale write-protection marker on the next cycle", async () => {
    const repo = cleanRepo("roll-main-guard-stale-");
    const runtimeDir = join(repo, ".roll", "loop");
    const protectedFile = join(repo, "tracked.txt");
    const originalMode = statSync(protectedFile).mode & 0o777;

    const applied = applyMainCheckoutWriteProtection({ repoCwd: repo, runtimeDir, cycleId: "C-crash", nowMs: () => 1000 });
    expect(applied.status).toBe("applied");
    expect(() => writeFileSync(protectedFile, "blocked\n", "utf8")).toThrow();

    const recovered = applyMainCheckoutWriteProtection({ repoCwd: repo, runtimeDir, cycleId: "C-next", nowMs: () => 2000 });
    expect(recovered.status).toBe("recovered");
    releaseMainCheckoutWriteProtection({ repoCwd: repo, runtimeDir, cycleId: "C-next", nowMs: () => 3000 });

    writeFileSync(protectedFile, "restored\n", "utf8");
    expect(readFileSync(protectedFile, "utf8")).toBe("restored\n");
    expect(statSync(protectedFile).mode & 0o777).toBe(originalMode);
  });

  it("protects git-visible files and skips gitignored directories", async () => {
    const repo = cleanRepo("roll-main-guard-ignored-");
    const runtimeDir = join(repo, ".roll", "loop");
    writeFileSync(join(repo, ".gitignore"), "ignored-build/\n", "utf8");
    git(repo, ["add", ".gitignore"]);
    git(repo, ["commit", "-q", "-m", "ignore build output"]);
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "new file.ts"), "export const value = 1;\n", "utf8");
    mkdirSync(join(repo, "ignored-build", "deep"), { recursive: true });
    for (let i = 0; i < 40; i += 1) {
      writeFileSync(join(repo, "ignored-build", "deep", `artifact-${i}.txt`), "ignored\n", "utf8");
    }

    try {
      applyMainCheckoutWriteProtection({ repoCwd: repo, runtimeDir, cycleId: "C-ignore", nowMs: () => 1000 });
      const marker = JSON.parse(readFileSync(join(runtimeDir, "main-checkout-protection.json"), "utf8"));
      const protectedRels = (marker.entries as Array<{ path: string }>).map((entry) => (entry.path === repo ? "." : entry.path.slice(repo.length + 1)));

      expect(protectedRels).toContain(".");
      expect(protectedRels).toContain(".gitignore");
      expect(protectedRels).toContain("tracked.txt");
      expect(protectedRels).toContain("src");
      expect(protectedRels).toContain("src/new file.ts");
      expect(protectedRels.some((rel) => rel === "ignored-build" || rel.startsWith("ignored-build/"))).toBe(false);
      writeFileSync(join(repo, "ignored-build", "deep", "still-writable.txt"), "cache\n", "utf8");
    } finally {
      releaseMainCheckoutWriteProtection({ repoCwd: repo, runtimeDir, cycleId: "C-ignore", nowMs: () => 2000 });
    }
  });

  it("quarantines dirty product files into a rescue ref, leaves .roll/skills alone, and restores clean main", async () => {
    const repo = cleanRepo("roll-main-quarantine-dirty-");
    const runtimeDir = join(repo, ".roll", "loop");
    writeFileSync(join(repo, "tracked.txt"), "leaked tracked\n", "utf8");
    writeFileSync(join(repo, "untracked.txt"), "leaked untracked\n", "utf8");
    writeFileSync(join(repo, ".roll", "loop", "events.ndjson"), "owner runtime\n", "utf8");
    writeFileSync(join(repo, "skills", "scratch.txt"), "skill scratch\n", "utf8");

    const results = await quarantineMainCheckout({
      repoCwd: repo,
      runtimeDir,
      cycleId: "C-dirty",
      storyId: "US-LOOP-089",
      phase: "pre-spawn",
      nowMs: () => 1_000,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ reason: "dirty", cycleId: "C-dirty" });
    expect(results[0]?.files).toEqual(["tracked.txt", "untracked.txt"]);
    expect(sh(repo, ["status", "--porcelain", "--", "tracked.txt", "untracked.txt"])).toBe("");
    expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe("base\n");
    expect(readFileSync(join(repo, ".roll", "loop", "events.ndjson"), "utf8")).toBe("owner runtime\n");
    expect(readFileSync(join(repo, "skills", "scratch.txt"), "utf8")).toBe("skill scratch\n");
    expect(sh(repo, ["rev-parse", results[0]!.ref])).toMatch(/^[0-9a-f]{40}$/);
    const manifest = JSON.parse(readFileSync(results[0]!.manifestPath, "utf8"));
    expect(manifest.restoreCommand).toContain(`git stash apply ${results[0]!.ref}`);
    expect(manifest.files).toEqual(["tracked.txt", "untracked.txt"]);
  });

  it("quarantines ahead commits into a rescue branch and resets main to origin/main", async () => {
    const repo = cleanRepo("roll-main-quarantine-ahead-");
    const runtimeDir = join(repo, ".roll", "loop");
    const originHead = sh(repo, ["rev-parse", "origin/main"]);
    writeFileSync(join(repo, "tracked.txt"), "ahead commit\n", "utf8");
    git(repo, ["add", "tracked.txt"]);
    git(repo, ["commit", "-q", "-m", "leaked main commit"]);
    const leakedHead = sh(repo, ["rev-parse", "HEAD"]);

    const results = await quarantineMainCheckout({
      repoCwd: repo,
      runtimeDir,
      cycleId: "C-ahead",
      storyId: "US-LOOP-089",
      phase: "post-cycle",
      nowMs: () => 2_000,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ reason: "ahead", files: ["<commit>:leaked main commit"] });
    expect(sh(repo, ["rev-parse", "HEAD"])).toBe(originHead);
    expect(sh(repo, ["rev-parse", results[0]!.ref])).toBe(leakedHead);
    const manifest = JSON.parse(readFileSync(results[0]!.manifestPath, "utf8"));
    expect(manifest.restoreCommand).toContain(`git cherry-pick ${results[0]!.ref}`);
  });

  it("checkMainDirty ignores .roll runtime and skills submodule dirt", async () => {
    const repo = cleanRepo("roll-main-dirty-scope-");
    writeFileSync(join(repo, ".roll", "loop", "events.ndjson"), "runtime\n", "utf8");
    writeFileSync(join(repo, "skills", "scratch.txt"), "skill scratch\n", "utf8");
    writeFileSync(join(repo, "product.ts"), "leak\n", "utf8");

    await expect(checkMainDirty(repo)).resolves.toEqual(["product.ts"]);
  });

  it("pins spawned worktree git discovery below the main checkout parent", () => {
    const repo = cleanRepo("roll-main-gitenv-ceiling-");
    // Nested (non-sibling) worktree layout: dirname(wt) !== dirname(repo), so this
    // proves the ceiling pins to the MAIN checkout's parent, not the worktree's own
    // parent — a sibling layout cannot distinguish the two (kimi review finding).
    const nest = join(repo, "nested");
    mkdirSync(nest, { recursive: true });
    const wt = join(nest, "cycle-wt");
    git(repo, ["worktree", "add", "-q", "-b", "cycle/nested-test", wt, "origin/main"]);

    const env = worktreeGitEnv(wt, repo);
    expect(env).toMatchObject({
      GIT_WORK_TREE: wt,
      GIT_CEILING_DIRECTORIES: dirname(repo),
    });
    expect(env.GIT_CEILING_DIRECTORIES).not.toBe(dirname(wt));
  });

  it("does not fabricate GIT_DIR when git cannot resolve the worktree", () => {
    const repo = cleanRepo("roll-main-gitenv-fail-");
    const missing = join(repo, "missing-worktree");

    expect(worktreeGitEnv(missing, repo)).toEqual({
      GIT_WORK_TREE: missing,
      GIT_CEILING_DIRECTORIES: tmpdir(),
    });
  });
});
