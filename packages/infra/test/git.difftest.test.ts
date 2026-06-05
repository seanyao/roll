/**
 * diff-test: the infra path-resolution I/O half (canonicalProjectPath +
 * projectIdentity) reproduces what the frozen bash `_project_slug`
 * (bin/roll 6949-7026) observes end-to-end — including the FIX-056 realpath and
 * FIX-034 worktree→main-tree preamble that lives in infra (the pure slug math
 * lives in @roll/spec and is diff-tested there separately).
 *
 * We run the WHOLE bash `_project_slug` against a path and assert the infra
 * `projectIdentity(path).slug` equals it. Because projectIdentity composes the
 * canonicalization (infra) + projectSlug (spec), agreement here proves the
 * canonicalization preamble is faithful.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { canonicalProjectPath, projectIdentity } from "../src/index.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});
function tmp(name: string): string {
  const d = mkdtempSync(join(tmpdir(), `roll-infra-slug-${name}-`));
  dirs.push(d);
  return realpathSync(d);
}

/** Run the full extracted bash _project_slug for a path. */
function bashSlug(path: string, env: Record<string, string> = {}): string {
  const script = [
    `eval "$(sed -n '/^_project_slug()/,/^}$/p' '${REPO}/bin/roll')"`,
    `config_get() { echo ""; }`,
    `_project_slug '${path}'`,
  ].join("\n");
  return execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

describe("diff-test: projectIdentity path-resolution == bash _project_slug", () => {
  it("https remote — same slug, canonical path == main tree", async () => {
    const d = tmp("https");
    execSync(`git init -q && git remote add origin https://github.com/SeanYao/Some.Project.git`, { cwd: d });
    const id = await projectIdentity(d);
    expect(id.slug).toBe(bashSlug(d));
  });

  it("ssh remote normalizes identically", async () => {
    const d = tmp("ssh");
    execSync(`git init -q && git remote add origin git@github.com:SeanYao/roll.git`, { cwd: d });
    const id = await projectIdentity(d);
    expect(id.slug).toBe(bashSlug(d));
  });

  it("no remote → path-based fallback agrees", async () => {
    const d = tmp("noremote");
    execSync(`git init -q`, { cwd: d });
    const id = await projectIdentity(d);
    expect(id.slug).toBe(bashSlug(d));
  });

  it("non-git dir → path-based fallback agrees", async () => {
    const d = tmp("plain.dir-x");
    const id = await projectIdentity(d);
    expect(id.slug).toBe(bashSlug(d));
  });

  it("FIX-201 worktree identity is its OWN toplevel (WHITELISTED divergence from FIX-034/bash)", async () => {
    // The v2 oracle (FIX-034) canonicalized every worktree to the MAIN tree via
    // git-common-dir — sane when the only worktrees were cycle worktrees of one
    // project, catastrophic for sibling dev worktrees post-cutover (the loop
    // baked the frozen v2 checkout's path and idled there). The TS side now
    // resolves to the current worktree's toplevel. Slug stays oracle-equal
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
    expect(id.slug).toBe(bashSlug(wt)); // remote-derived slug — still oracle-equal
    execSync(`git worktree remove --force '${wt}'`, { cwd: main });
  });

  it("ROLL_MAIN_SLUG override matches bash override path", async () => {
    const d = tmp("override");
    execSync(`git init -q`, { cwd: d });
    const save = process.env["ROLL_MAIN_SLUG"];
    process.env["ROLL_MAIN_SLUG"] = "main-abc123";
    try {
      const id = await projectIdentity(d);
      expect(id.slug).toBe(bashSlug(d, { ROLL_MAIN_SLUG: "main-abc123" }));
    } finally {
      if (save === undefined) delete process.env["ROLL_MAIN_SLUG"];
      else process.env["ROLL_MAIN_SLUG"] = save;
    }
  });
});
