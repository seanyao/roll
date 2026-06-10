/**
 * diff-test: TS `roll loop story` == python lib/roll-loop-story.py (frozen v2
 * oracle), and `roll loop eval` == bash `bin/roll loop eval` for the wrapper's
 * help / validation / delegation (US-PORT-007).
 *
 * Both sides run with a controlled HOME + empty ROLL_SHARED_ROOT + a temp
 * ROLL_PROJECT_RUNTIME_DIR holding synthetic events/runs so the cycle pipeline
 * resolves deterministically.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loopEvalCommand, loopStoryCommand } from "../src/commands/dashboard.js";
import { renderState } from "../src/render.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

// US-PORT-021b: the python/bash oracles are retired; freeze the proven-correct
// TS output as a snapshot. Scrub the per-run sandbox dirs (incl. macOS /private
// prefix) so it is stable across machines; CI is the cross-platform gate.
function scrub(r: { stdout: string; stderr: string; code: number }, dir: string): { stdout: string; stderr: string; code: number } {
  // The panel's span + cycle ids are seeded RELATIVE to now (the fixture stamps
  // cycles minutes-ago), so freeze them to stable tokens — the original parity
  // test only matched because bash + TS ran at the same instant.
  const n = (s: string): string =>
    s
      .split(dir)
      .join("<DIR>")
      .replace(/(?:\/private)?\/(?:var\/folders|tmp)\/[^\s"':)]*/g, "<TMP>")
      .replace(/\d{8}-\d{6}/g, "<CYCTS>") // cycle-id timestamp prefix (keeps -<pid> suffix)
      .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, "<DATE>"); // span dates
  return { stdout: n(r.stdout), stderr: n(r.stderr), code: r.code };
}

/** Run a TS command in-process with env/cwd, capturing stdout + stderr + code. */
function tsRun(
  fn: (a: string[]) => number,
  env: Record<string, string | undefined>,
  argv: string[],
  cwd?: string,
): { stdout: string; stderr: string; code: number } {
  const saveEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saveEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const saveCwd = process.cwd();
  if (cwd !== undefined) process.chdir(cwd);
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error — capture-only override
  process.stdout.write = (c: string | Uint8Array): boolean => {
    out.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
    return true;
  };
  // @ts-expect-error — capture-only override
  process.stderr.write = (c: string | Uint8Array): boolean => {
    err.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
    return true;
  };
  let code: number;
  try {
    code = fn(argv);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    renderState.useColor = true;
    process.chdir(saveCwd);
    for (const [k, v] of Object.entries(saveEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { stdout: out.join(""), stderr: err.join(""), code };
}

function sandboxEnv(extra: Record<string, string> = {}): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), "roll-story-home-"));
  const rt = mkdtempSync(join(tmpdir(), "roll-story-rt-"));
  const shared = mkdtempSync(join(tmpdir(), "roll-story-shared-"));
  dirs.push(home, rt, shared);
  return {
    HOME: home,
    ROLL_PROJECT_RUNTIME_DIR: rt,
    ROLL_SHARED_ROOT: shared,
    ROLL_MAIN_SLUG: "test-abc123",
    NO_COLOR: "1",
    // Pin the display TZ: roll-loop-status.py does os.environ.setdefault("TZ",
    // "Asia/Shanghai"), so a pre-set TZ here makes python honor +8 too — TS is
    // already unconditional +8 (shYmdHm). Without this the panel's span line is
    // host-TZ-dependent (the bug CI caught: UTC runner vs +8 dev box).
    TZ: "Asia/Shanghai",
    ...extra,
  };
}

const p2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
function iso(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T` +
    `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}+00:00`
  );
}
function label(d: Date): string {
  return (
    `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}-` +
    `${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}-99999`
  );
}

/** Seed a sandbox runtime dir with two cycles for US-CLI-006 + one FIX-200. */
function seedCycles(env: Record<string, string>): string {
  const rt = env["ROLL_PROJECT_RUNTIME_DIR"] as string;
  const slug = env["ROLL_MAIN_SLUG"] as string;
  const base = new Date();
  base.setUTCSeconds(30, 0);
  const start1 = new Date(base.getTime() - 30 * 60 * 1000);
  const end1 = new Date(start1.getTime() + 600 * 1000);
  const start2 = new Date(base.getTime() - 90 * 60 * 1000);
  const end2 = new Date(start2.getTime() + 480 * 1000);
  const lab1 = label(start1);
  const lab2 = label(start2);
  const usage = {
    model: "claude-opus-4-7-20251001",
    input_tokens: 12000,
    output_tokens: 3400,
    cache_creation_tokens: 50000,
    cache_read_tokens: 800000,
    cost_list_usd: 1.23,
    cost_currency: "USD",
    duration_ms: 600000,
  };
  const events = [
    { ts: iso(start1), stage: "cycle_start", label: lab1, detail: "", outcome: "" },
    { ts: iso(start1), stage: "pick_todo", label: lab1, detail: "US-CLI-006 picked", outcome: "ok" },
    { ts: iso(end1), stage: "usage", label: lab1, detail: usage, outcome: "ok" },
    { ts: iso(end1), stage: "pr", label: lab1, detail: "https://github.com/x/y/pull/777", outcome: "merged" },
    { ts: iso(end1), stage: "cycle_end", label: lab1, detail: "", outcome: "done" },
    { ts: iso(start2), stage: "cycle_start", label: lab2, detail: "", outcome: "" },
    { ts: iso(start2), stage: "pick_todo", label: lab2, detail: "US-CLI-006 picked", outcome: "ok" },
    { ts: iso(end2), stage: "cycle_end", label: lab2, detail: "", outcome: "done" },
  ];
  writeFileSync(join(rt, "events.ndjson"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const runs = [
    {
      project: slug,
      run_id: lab1,
      ts: iso(new Date(end1.getTime() + 5000)),
      tcr_count: 2,
      built: ["US-CLI-006"],
      status: "built",
      agent: "claude",
      duration_sec: 600,
    },
  ];
  writeFileSync(join(rt, "runs.jsonl"), runs.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const proj = mkdtempSync(join(tmpdir(), "roll-story-proj-"));
  dirs.push(proj);
  // A real (empty) git repo so load_pr_merges_from_git's `git log` resolves
  // identically on both sides — python leaks git's "not a repo" fatal to
  // stderr, TS suppresses it; an init removes the divergence at the source.
  const gitEnv = { GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: proj, env: { ...process.env, ...gitEnv } });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: proj, env: { ...process.env, ...gitEnv } });
  mkdirSync(join(proj, ".roll"), { recursive: true });
  writeFileSync(
    join(proj, ".roll", "backlog.md"),
    [
      "| ID | Description | Status |",
      "|----|----|----|",
      "| US-CLI-006 | Port loop-status dashboard to TS | Done |",
      "",
    ].join("\n"),
  );
  return proj;
}

describe("diff-test: roll loop story == roll-loop-story.py", () => {
  it("panel for a story with cycles matches byte-for-byte", () => {
    const env = sandboxEnv();
    const proj = seedCycles(env);
    const ts = tsRun(loopStoryCommand, env, ["US-CLI-006"], proj);
    expect(scrub(ts, proj)).toMatchSnapshot();
  });

  it("case-insensitive id matches", () => {
    const env = sandboxEnv();
    const proj = seedCycles(env);
    const ts = tsRun(loopStoryCommand, env, ["us-cli-006"], proj);
    expect(scrub(ts, proj)).toMatchSnapshot();
  });

  it("unknown story → stderr notice + exit 2", () => {
    const env = sandboxEnv();
    const proj = seedCycles(env);
    const ts = tsRun(loopStoryCommand, env, ["US-NOPE-999"], proj);
    expect(scrub(ts, proj)).toMatchSnapshot();
  });

  it("--json on unknown story → exit 2, valid JSON with count 0", () => {
    const env = sandboxEnv();
    const proj = seedCycles(env);
    const ts = tsRun(loopStoryCommand, env, ["US-NOPE-999", "--json"], proj);
    expect(ts.code).toBe(2);
    const parsed = JSON.parse(ts.stdout) as { count: number; cost: number };
    expect(parsed.count).toBe(0);
    expect(parsed.cost).toBe(0);
  });
});

describe("loop eval wrapper (US-PORT-007)", () => {
  it("help text == bash `bin/roll loop eval -h`", () => {
    const env = sandboxEnv();
    const ts = tsRun(loopEvalCommand, env, ["-h"], REPO);
    expect(scrub(ts, REPO)).toMatchSnapshot();
  });

  it("non-integer N → [roll] error on stderr, exit 1", () => {
    const env = sandboxEnv();
    const ts = tsRun(loopEvalCommand, env, ["abc"], REPO);
    expect(ts.stderr).toBe("[roll] roll loop eval: N must be a positive integer (got 'abc')\n");
    expect(ts.code).toBe(1);
  });

  it("no args delegates to the --eval trend view", () => {
    const env = sandboxEnv();
    const proj = seedCycles(env);
    const ts = tsRun(loopEvalCommand, env, [], proj);
    expect(ts.code).toBe(0);
    expect(ts.stdout).toContain("Loop result-eval");
  });
});
