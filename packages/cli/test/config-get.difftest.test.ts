/**
 * diff-test: TS `roll config` read surface == bash oracle, with fixture
 * project + global yaml covering nested/flat/default resolution.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configGetCommand } from "../src/commands/config-get.js";
import { seedUpdateCheckCache } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];
let home = "";
let proj = "";

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "roll-cfg-home-"));
  proj = mkdtempSync(join(tmpdir(), "roll-cfg-proj-"));
  dirs.push(home, proj);
  mkdirSync(join(home, ".roll"), { recursive: true });
  seedUpdateCheckCache(join(home, ".roll"));
  writeFileSync(join(home, ".roll", "config.yaml"), "loop_dream_hour: 5   # comment\n");
  mkdirSync(join(proj, ".roll"), { recursive: true });
  writeFileSync(
    join(proj, ".roll", "local.yaml"),
    ["loop_schedule:", "  loop_active_start: 9", "  period_minutes: 30", ""].join("\n"),
  );
});

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function bashCfg(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(join(REPO, "bin", "roll"), ["config", ...args], {
      cwd: proj,
      encoding: "utf8",
      env: { ...process.env, HOME: home, ROLL_HOME: join(home, ".roll"), NO_COLOR: "1" },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function tsCfg(args: string[]): { status: number; stdout: string; stderr: string } {
  const save = { HOME: process.env["HOME"], ROLL_HOME: process.env["ROLL_HOME"], NO_COLOR: process.env["NO_COLOR"] };
  process.env["HOME"] = home;
  process.env["ROLL_HOME"] = join(home, ".roll");
  process.env["NO_COLOR"] = "1";
  const saveCwd = process.cwd();
  process.chdir(proj);
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
    status = configGetCommand(args);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.chdir(saveCwd);
    for (const [k, v] of Object.entries(save)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { status, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

const CASES: string[][] = [
  ["--help"],
  ["--list"],
  ["loop_active_start"], // project nested, set
  ["loop_active_end"], // project nested, default
  ["loop_schedule.period_minutes"], // dotted nested, set
  ["loop_schedule.offset_minute"], // dotted nested, default
  ["loop_dream_hour"], // global flat with comment strip
  ["loop_dream_minute"], // global flat, '-' default
  ["no_such_key"], // unknown → bilingual stderr + exit 2
];

describe("diff-test: roll config (read) == bash oracle", () => {
  for (const args of CASES) {
    it(`config ${args.join(" ")}`, () => {
      const b = bashCfg(args);
      const t = tsCfg(args);
      expect(t.status, "exit code").toBe(b.status);
      expect(t.stdout, "stdout").toBe(b.stdout);
      expect(t.stderr, "stderr").toBe(b.stderr);
    });
  }
});
