import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { releaseCommand } from "../src/commands/release.js";

const NOW = { year: 2026, month: 6, day: 6 } as const;

/** Run releaseCommand against a throwaway repo with the given pkg version + changelog. */
function run(
  args: string[],
  opts: { version?: string; changelog?: string; lang?: string } = {},
): { status: number; stdout: string; stderr: string; head: string } {
  const proj = mkdtempSync(join(tmpdir(), "roll-release-proj-"));
  // A real git repo so we can prove the command makes NO tags/commits.
  execSync("git init -q", { cwd: proj });
  execSync("git config user.email t@t.t", { cwd: proj });
  execSync("git config user.name t", { cwd: proj });
  if (opts.version !== undefined) {
    writeFileSync(join(proj, "package.json"), JSON.stringify({ version: opts.version }), "utf8");
  }
  if (opts.changelog !== undefined) {
    writeFileSync(join(proj, "CHANGELOG.md"), opts.changelog, "utf8");
  }
  execSync("git add -A", { cwd: proj });
  execSync("git commit -q -m base", { cwd: proj });
  const headBefore = execSync("git rev-parse HEAD", { cwd: proj }).toString().trim();

  const save = { NO_COLOR: process.env["NO_COLOR"], ROLL_LANG: process.env["ROLL_LANG"] };
  process.env["NO_COLOR"] = "1";
  process.env["ROLL_LANG"] = opts.lang ?? "en";
  const saveCwd = process.cwd();
  process.chdir(proj);
  const outC: string[] = [];
  const errC: string[] = [];
  const rOut = process.stdout.write.bind(process.stdout);
  const rErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (x: string | Uint8Array): boolean => (outC.push(String(x)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (x: string | Uint8Array): boolean => (errC.push(String(x)), true);
  let status: number;
  let headAfter = headBefore;
  let tags = "";
  try {
    status = releaseCommand(args, NOW);
    headAfter = execSync("git rev-parse HEAD", { cwd: proj }).toString().trim();
    tags = execSync("git tag", { cwd: proj }).toString().trim();
  } finally {
    process.stdout.write = rOut;
    process.stderr.write = rErr;
    process.chdir(saveCwd);
    rmSync(proj, { recursive: true, force: true });
    if (save.NO_COLOR === undefined) delete process.env["NO_COLOR"];
    else process.env["NO_COLOR"] = save.NO_COLOR;
    if (save.ROLL_LANG === undefined) delete process.env["ROLL_LANG"];
    else process.env["ROLL_LANG"] = save.ROLL_LANG;
  }
  // Read-only guidance: the repo must be byte-identical (no new commit, no tag).
  expect(headAfter).toBe(headBefore);
  expect(tags).toBe("");
  return { status, stdout: outC.join(""), stderr: errC.join(""), head: headAfter };
}

const READY_CHANGELOG = ["# Changelog", "", "## Unreleased", "", "### 新功能", "", "- a thing", ""].join(
  "\n",
);
const EMPTY_CHANGELOG = ["# Changelog", "", "## Unreleased", ""].join("\n");
// FIX-226: the repo's actual convention — a pre-written NEXT-version section
// (no Unreleased heading anywhere in the file's history since v3.606.x).
const VERSIONED_READY = ["# Changelog", "", "## v3.606.3 — 2026-06-06", "", "### 修复", "", "- a fix", ""].join("\n");
const VERSIONED_STALE = ["# Changelog", "", "## v3.606.2 — 2026-06-06", "", "- already shipped", ""].join("\n");

describe("releaseCommand (guidance, read-only)", () => {
  it("prints the version bump, tag, and PR/tag flow (exit 0)", () => {
    const r = run([], { version: "3.606.2", changelog: READY_CHANGELOG });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("3.606.2"); // current
    expect(r.stdout).toContain("3.606.3"); // next (same-day seq bump)
    expect(r.stdout).toContain("v3.606.3"); // tag
    // The ordered human flow is present.
    expect(r.stdout).toContain("PR");
    expect(r.stdout.toLowerCase()).toContain("tag");
    // The CI release gate is surfaced.
    expect(r.stdout).toContain("roll release consistency check");
  });

  it("resets the seq to 1 on a new day relative to the current version", () => {
    const r = run([], { version: "3.605.9", changelog: READY_CHANGELOG });
    expect(r.stdout).toContain("3.606.1");
  });

  it("flags an empty Unreleased section as not ready", () => {
    const r = run([], { version: "3.606.2", changelog: EMPTY_CHANGELOG });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("roll release changelog generate");
  });

  it("FIX-226: a pre-written next-version section counts as ready (repo convention)", () => {
    const r = run(["--json"], { version: "3.606.2", changelog: VERSIONED_READY });
    expect((JSON.parse(r.stdout) as Record<string, unknown>)["changelogReady"]).toBe(true);
  });

  it("FIX-226: a section matching the CURRENT version is already shipped — not ready", () => {
    const r = run(["--json"], { version: "3.606.2", changelog: VERSIONED_STALE });
    expect((JSON.parse(r.stdout) as Record<string, unknown>)["changelogReady"]).toBe(false);
  });

  it("--json emits a machine-readable plan", () => {
    const r = run(["--json"], { version: "3.606.2", changelog: READY_CHANGELOG });
    expect(r.status).toBe(0);
    const plan = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(plan["currentVersion"]).toBe("3.606.2");
    expect(plan["nextVersion"]).toBe("3.606.3");
    expect(plan["tag"]).toBe("v3.606.3");
    expect(plan["changelogReady"]).toBe(true);
  });

  it("--help prints usage and exits 0", () => {
    const r = run(["--help"], { version: "3.606.2" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("roll release");
  });

  it("errors cleanly when package.json has no version", () => {
    const r = run([], { changelog: READY_CHANGELOG });
    expect(r.status).toBe(1);
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  it("English output carries no CJK (single-language contract)", () => {
    const r = run([], { version: "3.606.2", changelog: READY_CHANGELOG, lang: "en" });
    expect(r.stdout).not.toMatch(/[一-鿿]/);
  });

  it("Chinese output carries no stray English prose words", () => {
    const r = run([], { version: "3.606.2", changelog: READY_CHANGELOG, lang: "zh" });
    // Command tokens (roll release consistency check / package.json) are allowed; prose is not.
    // Assert the localized header is in Chinese.
    expect(r.stdout).toContain("发版计划");
  });
});
