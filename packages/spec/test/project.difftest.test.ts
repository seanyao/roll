/**
 * diff-test: projectSlug == bash _project_slug (frozen v2 oracle).
 * Extracts the function from bin/roll and runs it against fixture git repos
 * covering: remote-based, ssh-remote normalization, no-remote path fallback,
 * ROLL_MAIN_SLUG override, and worktree → main-tree resolution.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { projectSlug } from "../src/project.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];

function tmp(name: string): string {
  const d = mkdtempSync(join(tmpdir(), `roll-slug-${name}-`));
  dirs.push(d);
  return realpathSync(d);
}

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

/** Run the extracted bash _project_slug for a path, with optional env. */
function bashSlug(path: string, env: Record<string, string> = {}): string {
  const script = [
    `eval "$(sed -n '/^_project_slug()/,/^}$/p' '${REPO}/bin/roll')"`,
    `config_get() { echo ""; }`,
    `_project_slug '${path}'`,
  ].join("\n");
  return execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function gitRemote(path: string): string | undefined {
  try {
    return execSync("git remote get-url origin", { cwd: path, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

describe("diff-test: projectSlug == bash _project_slug", () => {
  it("remote-based identity (https remote)", () => {
    const d = tmp("https");
    execSync(
      `git init -q && git remote add origin https://github.com/SeanYao/Some.Project.git`,
      { cwd: d },
    );
    expect(projectSlug({ path: d, remoteUrl: gitRemote(d) })).toBe(bashSlug(d));
  });

  it("ssh remote normalizes like the oracle (git@ → https, lowercase)", () => {
    const d = tmp("ssh");
    execSync(`git init -q && git remote add origin git@github.com:SeanYao/roll.git`, { cwd: d });
    expect(projectSlug({ path: d, remoteUrl: gitRemote(d) })).toBe(bashSlug(d));
  });

  it("no remote → path-based fallback", () => {
    const d = tmp("noremote");
    execSync(`git init -q`, { cwd: d });
    expect(projectSlug({ path: d, remoteUrl: undefined })).toBe(bashSlug(d));
  });

  it("non-git directory → path-based fallback", () => {
    const d = tmp("plain.dir-with_chars");
    expect(projectSlug({ path: d, remoteUrl: undefined })).toBe(bashSlug(d));
  });

  it("ROLL_MAIN_SLUG override wins on both sides", () => {
    const d = tmp("override");
    expect(projectSlug({ path: d, mainSlugOverride: "main-abc123" })).toBe(
      bashSlug(d, { ROLL_MAIN_SLUG: "main-abc123" }),
    );
  });

  it("worktree resolves to the main tree slug (caller injects resolved path)", () => {
    const d = tmp("wtmain");
    execSync(
      `git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m x && git remote add origin https://github.com/x/wt-proj.git`,
      { cwd: d },
    );
    const wt = join(tmp("wtside"), "wt");
    execSync(`git worktree add -q '${wt}' -b side`, { cwd: d });
    // Oracle resolves the worktree itself; TS side receives the main-tree path
    // (infra duty per project.ts contract) + the remote.
    expect(projectSlug({ path: d, remoteUrl: gitRemote(d) })).toBe(bashSlug(wt));
  });
});
