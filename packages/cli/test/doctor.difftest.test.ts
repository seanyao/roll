/**
 * diff-test: TS `roll doctor` == bash `bin/roll doctor` (frozen v2 oracle).
 *
 * doctor probes host state across four sections (agent / pr / skills / launchd).
 * Every probe honors the same env overrides bash does, so fixtures fabricate
 * both healthy and broken states deterministically:
 *   - agent  : ROLL_HOME/config.yaml present (with ai_* lines) vs absent.
 *   - pr      : run inside a git repo with NO gh on PATH → "unknown" state
 *               (the deterministic, network-free branch); non-git → skipped.
 *   - skills  : ROLL_PKG_DIR points at a fixture (lib/ symlinked so bash can
 *               source its i18n catalog) with a fresh-matching or stale catalog.
 *   - launchd : _LAUNCHD_DIR pointed at an empty dir → no stale section, AND a
 *               fixture with one stale com.roll.*.plist → the warning block.
 * PATH excludes gh so branch-protection is "unknown" without any network.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { doctorCommand } from "../src/commands/doctor.js";
import { generateCatalog } from "../src/commands/skills.js";
import { seedUpdateCheckCache, pathWithout } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];
// A PATH with no `gh` (and no git would break rev-parse, so keep /usr/bin for
// git) → branch protection resolves "unknown" with zero network calls.
const NOGH_PATH = pathWithout("gh");

function freshHome(config?: string): string {
  const home = mkdtempSync(join(tmpdir(), "roll-doctor-home-"));
  dirs.push(home);
  mkdirSync(join(home, ".roll"), { recursive: true });
  seedUpdateCheckCache(join(home, ".roll"));
  if (config !== undefined) writeFileSync(join(home, ".roll", "config.yaml"), config);
  return home;
}

function emptyLaunchd(): string {
  const d = mkdtempSync(join(tmpdir(), "roll-doctor-la-"));
  dirs.push(d);
  return d;
}

/** A fixture ROLL_PKG_DIR: real lib/conventions symlinked + custom skills/guide. */
function freshPkg(): string {
  const pkg = mkdtempSync(join(tmpdir(), "roll-doctor-pkg-"));
  dirs.push(pkg);
  for (const d of ["lib", "conventions"]) symlinkSync(join(REPO, d), join(pkg, d));
  for (const [name, desc] of [
    ["alpha", "First."],
    ["beta", "Second."],
  ]) {
    mkdirSync(join(pkg, "skills", name), { recursive: true });
    writeFileSync(join(pkg, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${desc}\n---\n`);
  }
  return pkg;
}

function makeGitRepo(): string {
  const proj = mkdtempSync(join(tmpdir(), "roll-doctor-proj-"));
  dirs.push(proj);
  execSync("git init -q && git config user.email t@t.co && git config user.name t && git commit -q --allow-empty -m init", {
    cwd: proj,
  });
  return proj;
}

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

interface Env {
  home: string;
  cwd: string;
  pkg?: string;
  launchd: string;
  lang: string;
}
interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function bashDoctor(e: Env): Run {
  const env: Record<string, string> = {
    PATH: NOGH_PATH,
    HOME: e.home,
    ROLL_HOME: join(e.home, ".roll"),
    _LAUNCHD_DIR: e.launchd,
    NO_COLOR: "1",
    ROLL_LANG: e.lang,
  };
  if (e.pkg !== undefined) env["ROLL_PKG_DIR"] = e.pkg;
  try {
    const stdout = execFileSync(join(REPO, "bin", "roll"), ["doctor"], { cwd: e.cwd, encoding: "utf8", env });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const x = err as { status?: number; stdout?: string; stderr?: string };
    return { status: x.status ?? 1, stdout: x.stdout ?? "", stderr: x.stderr ?? "" };
  }
}

function tsDoctor(e: Env): Run {
  const keys = ["PATH", "HOME", "ROLL_HOME", "_LAUNCHD_DIR", "NO_COLOR", "ROLL_LANG", "LC_ALL", "LANG", "ROLL_PKG_DIR"];
  const save: Record<string, string | undefined> = {};
  for (const k of keys) save[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  process.env["PATH"] = NOGH_PATH;
  process.env["HOME"] = e.home;
  process.env["ROLL_HOME"] = join(e.home, ".roll");
  process.env["_LAUNCHD_DIR"] = e.launchd;
  process.env["NO_COLOR"] = "1";
  process.env["ROLL_LANG"] = e.lang;
  if (e.pkg !== undefined) process.env["ROLL_PKG_DIR"] = e.pkg;
  const saveCwd = process.cwd();
  process.chdir(e.cwd);
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (outChunks.push(String(c)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (c: string | Uint8Array): boolean => (errChunks.push(String(c)), true);
  let status: number;
  try {
    status = doctorCommand([]);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.chdir(saveCwd);
    for (const k of keys) {
      const v = save[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { status, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

const CONFIG = "primary_agent: claude\nai_claude: ~/.claude\nai_kimi: ~/.kimi | extra\n";

describe("diff-test: roll doctor == bash oracle", () => {
  for (const lang of ["en", "zh"]) {
    it(`healthy: git repo + config + matching skills + empty launchd (${lang})`, () => {
      const pkg = freshPkg();
      // Make the committed catalog match a fresh scan so skills section = OK.
      mkdirSync(join(pkg, "guide"), { recursive: true });
      // generateCatalog reads ROLL_PKG_DIR — set it for this synchronous call.
      const savePkg = process.env["ROLL_PKG_DIR"];
      process.env["ROLL_PKG_DIR"] = pkg;
      writeFileSync(join(pkg, "guide", "skills.md"), generateCatalog());
      if (savePkg === undefined) delete process.env["ROLL_PKG_DIR"];
      else process.env["ROLL_PKG_DIR"] = savePkg;
      const e: Env = { home: freshHome(CONFIG), cwd: makeGitRepo(), pkg, launchd: emptyLaunchd(), lang };
      expect(tsDoctor(e)).toEqual(bashDoctor(e));
    });

    it(`broken: no config (agent section skipped), non-git, skills drift (${lang})`, () => {
      const pkg = freshPkg();
      mkdirSync(join(pkg, "guide"), { recursive: true });
      writeFileSync(join(pkg, "guide", "skills.md"), "# stale\n"); // drift
      const nonGit = mkdtempSync(join(tmpdir(), "roll-doctor-nongit-"));
      dirs.push(nonGit);
      const e: Env = { home: freshHome(), cwd: nonGit, pkg, launchd: emptyLaunchd(), lang };
      expect(tsDoctor(e)).toEqual(bashDoctor(e));
    });

    it(`broken: skills target missing → drift (${lang})`, () => {
      const pkg = freshPkg(); // no guide/skills.md written at all
      const nonGit = mkdtempSync(join(tmpdir(), "roll-doctor-nog2-"));
      dirs.push(nonGit);
      const e: Env = { home: freshHome(), cwd: nonGit, pkg, launchd: emptyLaunchd(), lang };
      expect(tsDoctor(e)).toEqual(bashDoctor(e));
    });
  }

  it("launchd: a stale com.roll plist surfaces the warning block (Darwin, en)", () => {
    if (process.platform !== "darwin") return; // section is Darwin-only
    const la = mkdtempSync(join(tmpdir(), "roll-doctor-stale-la-"));
    dirs.push(la);
    const missing = "/tmp/roll-doctor-this-dir-does-not-exist-xyz";
    writeFileSync(
      join(la, "com.roll.loop.demo.plist"),
      `<plist><dict>\n<key>WorkingDirectory</key>\n<string>${missing}</string>\n</dict></plist>\n`,
    );
    const pkg = freshPkg();
    mkdirSync(join(pkg, "guide"), { recursive: true });
    const savePkg = process.env["ROLL_PKG_DIR"];
    process.env["ROLL_PKG_DIR"] = pkg;
    writeFileSync(join(pkg, "guide", "skills.md"), generateCatalog());
    if (savePkg === undefined) delete process.env["ROLL_PKG_DIR"];
    else process.env["ROLL_PKG_DIR"] = savePkg;
    const nonGit = mkdtempSync(join(tmpdir(), "roll-doctor-la-proj-"));
    dirs.push(nonGit);
    const e: Env = { home: freshHome(), cwd: nonGit, pkg, launchd: la, lang: "en" };
    const t = tsDoctor(e);
    const b = bashDoctor(e);
    // The launchctl bootout hint embeds $(id -u); both use the same uid here.
    expect(t).toEqual(b);
  });
});
