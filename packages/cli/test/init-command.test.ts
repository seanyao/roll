import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dispatch } from "../src/bridge.js";
import { registerAll } from "../src/commands/index.js";
import { initCommand } from "../src/commands/init.js";

const dirs: string[] = [];

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

function withCapturedOutput<T>(cwd: string, run: () => T): T extends Promise<unknown> ? Promise<Run> : Run {
  const saveCwd = process.cwd();
  const saveEnv = {
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

function runInit(cwd: string, args: string[]): Run {
  return withCapturedOutput(cwd, () => initCommand(args));
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
