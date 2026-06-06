/**
 * diff-test (frozen): the infra path-resolution half (canonicalProjectPath +
 * projectIdentity) reproduces what the v2 bash `_project_slug` (bin/roll
 * 6949-7026) observed — including the FIX-056 realpath and FIX-201 worktree
 * resolution that live in infra. The pure slug math lives in @roll/spec and is
 * frozen-tested in packages/spec/test/project.difftest.test.ts.
 *
 * Per the US-PORT-009a freeze paradigm (docs/difftest-freeze-paradigm.md): we no
 * longer `sed`-extract + run `_project_slug` from bin/roll. Two flavors of
 * assertion, chosen by portability (the paradigm's load-bearing step 2):
 *   - remote-based slug derives from the remote URL → deterministic & portable →
 *     frozen literal (identical to the values frozen in the spec test).
 *   - path-based fallback slug embeds `md5` of the `realpath`'d temp dir, whose
 *     prefix differs across machines (macOS /private/tmp vs Linux /tmp) → NOT
 *     freezable. We instead assert the infra result equals the now-oracle-free
 *     spec `projectSlug` applied to the canonicalized path — proving the
 *     canonicalization preamble feeds the (separately frozen) slug math faithfully.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { projectSlug } from "@roll/spec";
import { canonicalProjectPath, projectIdentity } from "../src/index.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function tmp(name: string): string {
  const d = mkdtempSync(join(tmpdir(), `roll-infra-slug-${name}-`));
  dirs.push(d);
  return realpathSync(d);
}

describe("diff-test: projectIdentity path-resolution == frozen v2 _project_slug", () => {
  it("https remote — frozen remote-derived slug, canonical path == main tree", async () => {
    const d = tmp("https");
    execSync(`git init -q && git remote add origin https://github.com/SeanYao/Some.Project.git`, { cwd: d });
    const id = await projectIdentity(d);
    expect(id.slug).toBe("some-project-c52293");
  });

  it("ssh remote normalizes identically (frozen)", async () => {
    const d = tmp("ssh");
    execSync(`git init -q && git remote add origin git@github.com:SeanYao/roll.git`, { cwd: d });
    const id = await projectIdentity(d);
    expect(id.slug).toBe("roll-ecf079");
  });

  it("no remote → path-based fallback feeds the spec slug faithfully", async () => {
    const d = tmp("noremote");
    execSync(`git init -q`, { cwd: d });
    const id = await projectIdentity(d);
    const canon = await canonicalProjectPath(d);
    // Canonicalized path → the (frozen-tested) pure spec slug. Proves the infra
    // realpath preamble agrees with what the oracle hashed; portable (no frozen md5).
    expect(id.slug).toBe(projectSlug({ path: canon, remoteUrl: undefined }));
    expect(id.slug).toMatch(/-[0-9a-f]{6}$/);
  });

  it("non-git dir → path-based fallback feeds the spec slug faithfully", async () => {
    const d = tmp("plain.dir-x");
    const id = await projectIdentity(d);
    const canon = await canonicalProjectPath(d);
    expect(id.slug).toBe(projectSlug({ path: canon, remoteUrl: undefined }));
    expect(id.slug).toMatch(/-[0-9a-f]{6}$/);
  });

  it("FIX-201 worktree identity is its OWN toplevel (WHITELISTED divergence from FIX-034/bash)", async () => {
    // The v2 oracle (FIX-034) canonicalized every worktree to the MAIN tree via
    // git-common-dir — sane when the only worktrees were cycle worktrees of one
    // project, catastrophic for sibling dev worktrees post-cutover. The TS side
    // now resolves to the current worktree's toplevel. Slug stays oracle-equal
    // whenever a remote exists (slug derives from the remote URL).
    const main = tmp("wtmain");
    execSync(
      `git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m x && git remote add origin https://github.com/x/wt-proj.git`,
      { cwd: main },
    );
    const wt = join(tmp("wtside"), "wt");
    execSync(`git worktree add -q '${wt}' -b side`, { cwd: main });
    expect(await canonicalProjectPath(wt)).toBe(wt); // own toplevel, NOT main
    const id = await projectIdentity(wt);
    expect(id.slug).toBe("wt-proj-e4b45a"); // frozen remote-derived slug
    execSync(`git worktree remove --force '${wt}'`, { cwd: main });
  });

  it("ROLL_MAIN_SLUG override matches the bash override path (frozen)", async () => {
    const d = tmp("override");
    execSync(`git init -q`, { cwd: d });
    const save = process.env["ROLL_MAIN_SLUG"];
    process.env["ROLL_MAIN_SLUG"] = "main-abc123";
    try {
      const id = await projectIdentity(d);
      expect(id.slug).toBe("main-abc123");
    } finally {
      if (save === undefined) delete process.env["ROLL_MAIN_SLUG"];
      else process.env["ROLL_MAIN_SLUG"] = save;
    }
  });
});
