/**
 * US-PHYSICAL-008 — repo-visibility guard for image evidence.
 *
 * All network/gh probes are injected; tests run offline against temp git repos.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import {
  checkImageEvidenceAllowed,
  detectRepoVisibility,
  imageEvidencePathsInWorkingTree,
  readEvidencePublicWaiver,
  readEvidenceVisibilityCache,
  writeEvidenceVisibilityCache,
  type VisibilityProbe,
} from "../src/repo-visibility.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmp(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `roll-vis-${tag}-`));
  dirs.push(d);
  return d;
}

function initRepo(tag: string): string {
  const d = tmp(tag);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: d });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: d });
  execFileSync("git", ["config", "user.name", "t"], { cwd: d });
  execFileSync("git", ["commit", "-q", "--no-verify", "--allow-empty", "-m", "init"], { cwd: d });
  return d;
}

function addRemote(repo: string, name: string, url: string): void {
  execFileSync("git", ["remote", "add", name, url], { cwd: repo });
}

function probe(overrides: {
  gh?: { code: number; stdout: string; stderr?: string };
  git?: { code: number; stdout: string; stderr?: string };
}): VisibilityProbe {
  return {
    ghRun: async () => ({
      code: overrides.gh?.code ?? 1,
      stdout: overrides.gh?.stdout ?? "",
      stderr: overrides.gh?.stderr ?? "",
    }),
    gitRun: async () => ({
      code: overrides.git?.code ?? 1,
      stdout: overrides.git?.stdout ?? "",
      stderr: overrides.git?.stderr ?? "",
    }),
  };
}

describe("detectRepoVisibility", () => {
  it("GitHub public remote → public", async () => {
    const repo = initRepo("gh-public");
    addRemote(repo, "origin", "https://github.com/seanyao/roll.git");
    const v = await detectRepoVisibility(repo, probe({ gh: { code: 0, stdout: '"public"\n' } }));
    expect(v).toBe("public");
  });

  it("GitHub private remote → private", async () => {
    const repo = initRepo("gh-private");
    addRemote(repo, "origin", "git@github.com:seanyao/roll-meta.git");
    const v = await detectRepoVisibility(repo, probe({ gh: { code: 0, stdout: '"private"\n' } }));
    expect(v).toBe("private");
  });

  it("GitHub API fails / gh unavailable → unknown", async () => {
    const repo = initRepo("gh-unknown");
    addRemote(repo, "origin", "https://github.com/seanyao/roll.git");
    const v = await detectRepoVisibility(repo, probe({ gh: { code: 1, stdout: "", stderr: "HTTP 401" } }));
    expect(v).toBe("unknown");
  });

  it("non-GitHub remote: ls-remote reachable → unknown (conservative)", async () => {
    const repo = initRepo("non-gh");
    addRemote(repo, "origin", "https://gitlab.com/seanyao/roll.git");
    const v = await detectRepoVisibility(repo, probe({ git: { code: 0, stdout: "abc\tHEAD\n" } }));
    expect(v).toBe("unknown");
  });

  it("no origin remote → unknown", async () => {
    const repo = initRepo("no-remote");
    const v = await detectRepoVisibility(repo, {});
    expect(v).toBe("unknown");
  });
});

describe("visibility cache + waiver", () => {
  it("read/write cache round-trip", () => {
    const d = tmp("cache");
    mkdirSync(join(d, ".roll"), { recursive: true });
    writeEvidenceVisibilityCache(d, "https://github.com/seanyao/roll-meta.git", "private");
    expect(readEvidenceVisibilityCache(d)).toEqual({
      visibility: "private",
      remoteUrl: "https://github.com/seanyao/roll-meta.git",
    });
    // Update in place.
    writeEvidenceVisibilityCache(d, "https://github.com/seanyao/roll-meta.git", "public");
    expect(readEvidenceVisibilityCache(d)).toEqual({
      visibility: "public",
      remoteUrl: "https://github.com/seanyao/roll-meta.git",
    });
  });

  it("waiver read recognizes true/yes/1", () => {
    const d = tmp("waiver-true");
    mkdirSync(join(d, ".roll"), { recursive: true });
    writeFileSync(join(d, ".roll", "local.yaml"), "evidence_public_waiver: true\n");
    expect(readEvidencePublicWaiver(d)).toBe(true);
  });

  it("waiver read rejects false/nonsense", () => {
    const d = tmp("waiver-false");
    mkdirSync(join(d, ".roll"), { recursive: true });
    writeFileSync(join(d, ".roll", "local.yaml"), "evidence_public_waiver: false\n");
    expect(readEvidencePublicWaiver(d)).toBe(false);
  });

  it("missing config → no cache / no waiver", () => {
    const d = tmp("missing");
    expect(readEvidenceVisibilityCache(d)).toEqual({ visibility: null, remoteUrl: null });
    expect(readEvidencePublicWaiver(d)).toBe(false);
  });
});

describe("checkImageEvidenceAllowed", () => {
  it("cached private visibility allows without re-probing", async () => {
    const d = tmp("cached-private");
    mkdirSync(join(d, ".roll"), { recursive: true });
    writeEvidenceVisibilityCache(d, "https://github.com/seanyao/roll-meta.git", "private");
    const repo = initRepo("cached-private-repo");
    addRemote(repo, "origin", "https://github.com/seanyao/roll-meta.git");
    const check = await checkImageEvidenceAllowed(d, repo, {});
    expect(check.allowed).toBe(true);
    expect(check.visibility).toBe("private");
    expect(check.waived).toBe(false);
  });

  it("cached public visibility blocks", async () => {
    const d = tmp("cached-public");
    mkdirSync(join(d, ".roll"), { recursive: true });
    writeEvidenceVisibilityCache(d, "https://github.com/seanyao/roll.git", "public");
    const repo = initRepo("cached-public-repo");
    addRemote(repo, "origin", "https://github.com/seanyao/roll.git");
    const check = await checkImageEvidenceAllowed(d, repo, {});
    expect(check.allowed).toBe(false);
    expect(check.visibility).toBe("public");
  });

  it("remote change invalidates cache and re-detects", async () => {
    const d = tmp("cache-invalidate");
    mkdirSync(join(d, ".roll"), { recursive: true });
    writeEvidenceVisibilityCache(d, "https://github.com/seanyao/old.git", "private");
    const repo = initRepo("cache-invalidate-repo");
    addRemote(repo, "origin", "https://github.com/seanyao/roll.git");
    const check = await checkImageEvidenceAllowed(d, repo, probe({ gh: { code: 0, stdout: '"public"\n' } }));
    expect(check.allowed).toBe(false);
    expect(readEvidenceVisibilityCache(d).remoteUrl).toBe("https://github.com/seanyao/roll.git");
  });

  it("waiver allows even a public remote", async () => {
    const d = tmp("waiver-allows");
    mkdirSync(join(d, ".roll"), { recursive: true });
    writeFileSync(join(d, ".roll", "local.yaml"), "evidence_public_waiver: true\n");
    const repo = initRepo("waiver-repo");
    addRemote(repo, "origin", "https://github.com/seanyao/roll.git");
    const check = await checkImageEvidenceAllowed(d, repo, {});
    expect(check.allowed).toBe(true);
    expect(check.waived).toBe(true);
  });
});

describe("imageEvidencePathsInWorkingTree", () => {
  it("finds untracked and modified images under features/", () => {
    const repo = initRepo("images");
    const png = join(repo, "features", "capture-tool", "US-PHYSICAL-008", "screenshots", "x.png");
    mkdirSync(dirname(png), { recursive: true });
    writeFileSync(png, "fake-image");
    const jpg = join(repo, "features", "capture-tool", "US-PHYSICAL-008", "evidence", "y.jpg");
    mkdirSync(dirname(jpg), { recursive: true });
    writeFileSync(jpg, "fake-image");
    writeFileSync(join(repo, "features", "capture-tool", "US-PHYSICAL-008", "note.txt"), "text");

    const paths = imageEvidencePathsInWorkingTree(repo);
    expect(paths.sort()).toEqual(["features/capture-tool/US-PHYSICAL-008/evidence/y.jpg", "features/capture-tool/US-PHYSICAL-008/screenshots/x.png"]);
  });

  it("ignores images outside the evidence tree", () => {
    const repo = initRepo("outside");
    writeFileSync(join(repo, "logo.png"), "logo");
    mkdirSync(join(repo, "features"), { recursive: true });
    writeFileSync(join(repo, "features", "README.md"), "readme");
    const paths = imageEvidencePathsInWorkingTree(repo);
    expect(paths).toEqual([]);
  });
});
