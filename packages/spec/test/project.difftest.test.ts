/**
 * diff-test (frozen): projectSlug == bash `_project_slug` (v2 oracle).
 *
 * Per the US-PORT-009a freeze paradigm (docs/difftest-freeze-paradigm.md): the
 * v2 `_project_slug` outputs were captured once — while bin/roll was still
 * present and proven byte-for-byte equal — and frozen below. The test no longer
 * `sed`-extracts the bash function from bin/roll.
 *
 * projectSlug is a PURE function of (path string, remoteUrl, override). To keep
 * the frozen slugs portable across machines/CI, the path-based cases feed FIXED
 * path *strings* — not `realpath`'d temp dirs whose `md5` prefix differs between
 * macOS (`/private/tmp`) and Linux CI. The worktree→main-tree path resolution is
 * an infra concern and is diff-tested in packages/infra/test/git.difftest.test.ts.
 */
import { describe, expect, it } from "vitest";
import { projectSlug } from "../src/project.js";

describe("diff-test: projectSlug == frozen v2 _project_slug oracle", () => {
  it("remote-based identity (https remote)", () => {
    expect(
      projectSlug({ path: "/x", remoteUrl: "https://github.com/SeanYao/Some.Project.git" }),
    ).toBe("some-project-c52293");
  });

  it("ssh remote normalizes like the oracle (git@ → https, lowercase)", () => {
    expect(projectSlug({ path: "/x", remoteUrl: "git@github.com:SeanYao/roll.git" })).toBe(
      "roll-ecf079",
    );
  });

  it("no remote → path-based fallback (slug = basename-md5 of the path string)", () => {
    expect(projectSlug({ path: "/some/fixed/path/My.Proj", remoteUrl: undefined })).toBe(
      "My-Proj-66005e",
    );
  });

  it("non-git directory → path-based fallback (special chars slugified)", () => {
    expect(projectSlug({ path: "/var/data/plain.dir-with_chars", remoteUrl: undefined })).toBe(
      "plain-dir-with-chars-0bea79",
    );
  });

  it("ROLL_MAIN_SLUG override wins", () => {
    expect(projectSlug({ path: "/x", mainSlugOverride: "main-abc123" })).toBe("main-abc123");
  });

  it("slug derives from the remote, independent of the (worktree) path", () => {
    // The oracle resolves a worktree to its main tree before slugging; the pure
    // slug math only sees the remote, so any path yields the remote-derived slug.
    expect(projectSlug({ path: "/anything", remoteUrl: "https://github.com/x/wt-proj.git" })).toBe(
      "wt-proj-e4b45a",
    );
  });
});
