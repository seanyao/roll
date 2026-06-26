import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dispatch } from "../src/bridge.js";
import { registerAll } from "../src/commands/index.js";
import { initCommand } from "../src/commands/init.js";

const dirs: string[] = [];
const REPO = resolve(__dirname, "../../..");

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "roll-init-command-"));
  dirs.push(dir);
  return dir;
}

function write(root: string, rel: string, text = "x\n"): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function mkdir(root: string, rel: string): void {
  mkdirSync(join(root, rel), { recursive: true });
}

function withCapturedOutput<T>(
  cwd: string,
  run: () => T,
  options: { pathEntries?: string[] } = {},
): T extends Promise<unknown> ? Promise<Run> : Run {
  const saveCwd = process.cwd();
  const emptyBin = mkdtempSync(join(tmpdir(), "roll-init-empty-bin-"));
  dirs.push(emptyBin);
  const saveEnv = {
    PATH: process.env["PATH"],
    HOME: process.env["HOME"],
    ROLL_HOME: process.env["ROLL_HOME"],
    ROLL_PKG_DIR: process.env["ROLL_PKG_DIR"],
    NO_COLOR: process.env["NO_COLOR"],
    ROLL_LANG: process.env["ROLL_LANG"],
    ROLL_ATTEST_NO_BROWSER: process.env["ROLL_ATTEST_NO_BROWSER"],
  };
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  const restore = (): void => {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.chdir(saveCwd);
    for (const [key, value] of Object.entries(saveEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  process.chdir(cwd);
  process.env["PATH"] = [emptyBin, ...(options.pathEntries ?? [])].join(":");
  process.env["HOME"] = cwd;
  process.env["ROLL_HOME"] = REPO;
  process.env["ROLL_PKG_DIR"] = REPO;
  process.env["NO_COLOR"] = "1";
  process.env["ROLL_LANG"] = "en";
  process.env["ROLL_ATTEST_NO_BROWSER"] = "1";
  // @ts-expect-error capture-only
  process.stdout.write = (chunk: string | Uint8Array): boolean => (out.push(String(chunk)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (chunk: string | Uint8Array): boolean => (err.push(String(chunk)), true);

  const wrap = (status: number): Run => ({ status, stdout: out.join(""), stderr: err.join("") });
  try {
    const result = run();
    if (result instanceof Promise) {
      return result.then((r) => {
        restore();
        return wrap(typeof r === "object" && r !== null && "status" in r ? Number(r.status) : 0);
      }) as T extends Promise<unknown> ? Promise<Run> : Run;
    }
    restore();
    return wrap(typeof result === "number" ? result : 0) as T extends Promise<unknown> ? Promise<Run> : Run;
  } catch (error) {
    restore();
    throw error;
  }
}

function runInit(cwd: string, args: string[], options: { pathEntries?: string[] } = {}): Run {
  return withCapturedOutput(cwd, () => initCommand(args), options);
}

function runInitInteractive(cwd: string, args: string[], answer: string): Run {
  return withCapturedOutput(cwd, () => initCommand(args, { forceInteractive: true, readLine: () => answer }));
}

function gitOnlyPath(): string {
  const found = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" });
  const git = (found.stdout ?? "").trim();
  expect(found.status).toBe(0);
  expect(git).not.toBe("");
  const bin = mkdtempSync(join(tmpdir(), "roll-init-git-only-bin-"));
  dirs.push(bin);
  symlinkSync(git, join(bin, "git"));
  return bin;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("roll init --diagnose fixture", () => {
  it("prints the hidden state matrix and does not mutate the current project", () => {
    const cwd = project();
    const run = runInit(cwd, ["--diagnose", "--fixture", "state-matrix"]);

    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toMatchSnapshot();
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(cwd, ".roll"))).toBe(false);
  });

  it("does not expose the hidden fixture in normal init help", async () => {
    registerAll();
    const cwd = project();
    const run = await withCapturedOutput(cwd, () => dispatch(["init", "--help"], async () => ({ ok: true })));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Usage: roll init");
    expect(run.stdout).not.toContain("--diagnose");
    expect(run.stdout).not.toContain("state-matrix");
  });
});

describe("roll init diagnosis router", () => {
  it("renders Already initialized for a Roll-ready project without re-scaffolding", () => {
    const cwd = project();
    write(cwd, "AGENTS.md", "# Agents\n");
    write(cwd, ".roll/backlog.md", "# Backlog\n");
    mkdir(cwd, ".roll/features");

    const run = runInit(cwd, []);

    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain("Already initialized");
    expect(run.stdout).toContain("Next: roll status");
  });

  it("renders a repair route for partial Roll projects and does not create AGENTS.md", () => {
    const cwd = project();
    write(cwd, ".roll/backlog.md", "# Backlog\n");

    const run = runInit(cwd, []);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Detected: roll-partial");
    expect(run.stdout).toContain("Recommended path: repair-roll");
    expect(run.stdout).toContain("Next: roll init");
    expect(run.stdout).toContain("No files changed.");
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(false);
  });

  it("repairs partial Roll projects when explicitly requested", () => {
    const cwd = project();
    write(cwd, ".roll/backlog.md", "# Backlog\n");

    const run = runInit(cwd, ["--repair"]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("REPAIR");
    expect(run.stdout).toContain("Repaired");
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(cwd, ".roll", "backlog.md"))).toBe(true);
    expect(existsSync(join(cwd, ".roll", "features"))).toBe(true);
  });

  it("does not let --repair scaffold projects that are not partial Roll", () => {
    const cwd = project();

    const run = runInit(cwd, ["--repair"]);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("Detected: empty");
    expect(run.stderr).toContain("roll init --repair only applies to partial Roll projects.");
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(cwd, ".roll"))).toBe(false);
  });

  it("routes pre-v2 Roll layout markers to migration without fresh scaffold", () => {
    const cwd = project();
    write(cwd, "BACKLOG.md", "# Old Roll backlog\n");
    mkdir(cwd, "docs/features");

    const run = runInit(cwd, []);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Detected: roll-legacy-layout");
    expect(run.stdout).toContain("Recommended path: migrate-roll-layout");
    expect(run.stdout).toContain("npx @seanyao/roll@2 migrate --dry-run");
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(cwd, ".roll"))).toBe(false);
  });

  it("routes PRD-only workspaces to fresh scaffold without launching onboard", () => {
    const cwd = project();
    write(cwd, "docs/intel-radar-PRD.md", "# Product Requirements\n\nBuild a radar for intelligence signals.\n");

    const run = runInit(cwd, []);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("INIT");
    expect(run.stdout).toContain("Initialized");
    expect(run.stdout).toContain("roll design --from-file docs/intel-radar-PRD.md");
    expect(run.stdout).not.toContain("Onboarding");
    expect(run.stdout).not.toContain("Detected: legacy project");
    expect(existsSync(join(cwd, "prompt.txt"))).toBe(false);
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(cwd, ".roll"))).toBe(true);
  });

  it("scaffolds PRD-only workspaces and writes a design handoff brief", () => {
    const cwd = project();
    write(
      cwd,
      "docs/intel-radar-PRD.md",
      "# Intel Radar PRD\n\nBuild a radar for intelligence signals with source ranking and daily review.\n",
    );

    const run = runInit(cwd, []);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("INIT");
    expect(run.stdout).toContain("Initialized");
    expect(run.stdout).not.toContain("Onboarding");
    expect(run.stdout).toContain(".roll/brief.md");
    expect(run.stdout).toContain("roll design --from-file docs/intel-radar-PRD.md");
    expect((run.stdout.match(/roll design/g) ?? []).length).toBe(1);
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(cwd, ".roll", "backlog.md"))).toBe(true);
    expect(existsSync(join(cwd, ".roll", "brief.md"))).toBe(true);
    const brief = readFileSync(join(cwd, ".roll", "brief.md"), "utf8");
    expect(brief).toContain("docs/intel-radar-PRD.md");
    expect(brief).toContain("Build a radar for intelligence signals");
    const changeset = readFileSync(join(cwd, ".roll", "onboard-changeset.yaml"), "utf8");
    expect(changeset).toContain(".roll/brief.md");
    expect(changeset).toContain(".roll/backlog.md");
  });

  it("does not mutate empty non-interactive workspaces without --auto", () => {
    const cwd = project();

    const run = runInit(cwd, []);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Detected: empty");
    expect(run.stdout).toContain("Recommended path: guided-brief");
    expect(run.stdout).toContain("Next: roll design");
    expect(run.stdout).toContain("No files changed.");
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(cwd, ".roll"))).toBe(false);
  });

  it("writes a placeholder brief for empty non-interactive workspaces with --auto", () => {
    const cwd = project();

    const run = runInit(cwd, ["--auto"]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("INIT");
    expect(run.stdout).toContain(".roll/brief.md");
    expect(run.stdout).toContain("roll design");
    expect((run.stdout.match(/roll design/g) ?? []).length).toBe(1);
    expect(readFileSync(join(cwd, ".roll", "brief.md"), "utf8")).toContain("TODO: Describe the product");
    expect(readFileSync(join(cwd, ".roll", "onboard-changeset.yaml"), "utf8")).toContain(".roll/brief.md");
  });

  it("asks empty interactive workspaces what they are building and writes that brief", () => {
    const cwd = project();

    const run = runInitInteractive(cwd, [], "A weekly ops dashboard for release owners");

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("What are you building?");
    expect(run.stdout).toContain("INIT");
    expect(run.stdout).toContain("roll design");
    expect(readFileSync(join(cwd, ".roll", "brief.md"), "utf8")).toContain("A weekly ops dashboard for release owners");
  });

  it("does not route git-only or empty source shells to existing-codebase onboarding", () => {
    const cwd = project();
    mkdir(cwd, "src");
    mkdir(cwd, "tests");

    const run = runInit(cwd, ["--auto"]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("INIT");
    expect(run.stdout).toContain("Initialized");
    expect(run.stdout).not.toContain("Onboarding");
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(cwd, ".roll", "backlog.md"))).toBe(true);
  });

  it("does not route git history alone to existing-codebase onboarding", () => {
    const cwd = project();
    write(cwd, ".keep", "x\n");
    expect(spawnSync("git", ["init"], { cwd, stdio: "ignore" }).status).toBe(0);
    expect(spawnSync("git", ["config", "user.email", "roll-test@example.com"], { cwd, stdio: "ignore" }).status).toBe(0);
    expect(spawnSync("git", ["config", "user.name", "Roll Test"], { cwd, stdio: "ignore" }).status).toBe(0);
    expect(spawnSync("git", ["add", ".keep"], { cwd, stdio: "ignore" }).status).toBe(0);
    expect(spawnSync("git", ["commit", "-m", "seed"], { cwd, stdio: "ignore" }).status).toBe(0);

    const run = runInit(cwd, ["--auto"], { pathEntries: [gitOnlyPath()] });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("INIT");
    expect(run.stdout).toContain("Initialized");
    expect(run.stdout).not.toContain("Onboarding");
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(cwd, ".roll", "backlog.md"))).toBe(true);
  });
});
