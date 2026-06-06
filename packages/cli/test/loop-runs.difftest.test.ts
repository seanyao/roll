/**
 * diff-test: TS `roll loop runs` == bash `bin/roll loop runs` (frozen oracle).
 * Covers the single-project list (built/idle/failed rows, backlog descriptions,
 * the N limit), `--all` cross-project merge (via ROLL_LOOP_RUNS_ALL_DIRS), and
 * the `--detail` Phase Breakdown panel. US-PORT-007.
 *
 * Both sides run with a controlled HOME + ROLL_PROJECT_RUNTIME_DIR + ROLL_LANG=en
 * + NO_COLOR so every observable line is deterministic.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loopRunsCommand } from "../src/commands/loop-runs.js";

const REPO = resolve(__dirname, "../../..");
const BASH = join(REPO, "bin", "roll");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

function tsRun(env: Record<string, string | undefined>, argv: string[], cwd: string): string {
  const saveEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saveEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const saveCwd = process.cwd();
  process.chdir(cwd);
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  // @ts-expect-error — capture-only override
  process.stdout.write = (c: string | Uint8Array): boolean => {
    out.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
    return true;
  };
  try {
    loopRunsCommand(argv);
  } finally {
    process.stdout.write = realOut;
    process.chdir(saveCwd);
    for (const [k, v] of Object.entries(saveEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return out.join("");
}

function bashRun(env: Record<string, string>, argv: string[], cwd: string): string {
  try {
    return execFileSync(BASH, ["loop", ...argv], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  } catch (e) {
    const ex = e as { stdout?: string };
    return ex.stdout ?? "";
  }
}

const SLUG = "test-runs-abc123";

function sandbox(rows: object[], extra: Record<string, string> = {}): { env: Record<string, string>; cwd: string } {
  const home = mkdtempSync(join(tmpdir(), "roll-runs-home-"));
  const rt = mkdtempSync(join(tmpdir(), "roll-runs-rt-"));
  const shared = mkdtempSync(join(tmpdir(), "roll-runs-shared-"));
  const proj = mkdtempSync(join(tmpdir(), "roll-runs-proj-"));
  dirs.push(home, rt, shared, proj);
  if (rows.length > 0) {
    writeFileSync(join(rt, "runs.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  const env = {
    HOME: home,
    ROLL_PROJECT_RUNTIME_DIR: rt,
    ROLL_SHARED_ROOT: shared,
    ROLL_MAIN_SLUG: SLUG,
    ROLL_MAIN_PROJECT: proj,
    ROLL_LANG: "en",
    NO_COLOR: "1",
    ...extra,
  };
  return { env, cwd: proj };
}

function writeBacklog(proj: string, lines: string[]): void {
  writeFileSync(join(proj, ".roll", "backlog.md"), lines.join("\n") + "\n");
}

describe("diff-test: roll loop runs == bin/roll loop runs", () => {
  it("built + idle + failed rows match (with backlog descriptions)", () => {
    const rows = [
      { project: SLUG, run_id: "r1", ts: "2026-05-11T11:46:43Z", status: "built", built: ["US-CLI-006"], tcr_count: 3, duration_sec: 620 },
      { project: SLUG, run_id: "r2", ts: "2026-05-11T12:10:00Z", status: "idle" },
      { project: SLUG, run_id: "r3", ts: "2026-05-11T12:40:00Z", status: "failed", reason: "agent timeout" },
    ];
    const { env, cwd } = sandbox(rows);
    execFileSync("mkdir", ["-p", join(cwd, ".roll")]);
    writeBacklog(cwd, [
      "| ID | Description | Status |",
      "|----|----|----|",
      "| US-CLI-006 | Port the loop-status dashboard to TypeScript | Done |",
    ]);
    const b = bashRun(env, ["runs"], cwd);
    const t = tsRun(env, ["runs"], cwd);
    expect(t).toBe(b);
  });

  it("built with multiple items + skipped + phases match", () => {
    const rows = [
      {
        project: SLUG,
        run_id: "r1",
        ts: "2026-05-11T09:00:00Z",
        status: "built",
        built: ["US-A-001", "FIX-B-002"],
        skipped: ["US-C-003"],
        tcr_count: 7,
        duration_sec: 95,
        phases: { agent_invoke: 60, worktree_setup: 20, publish_push: 15 },
      },
    ];
    const { env, cwd } = sandbox(rows);
    execFileSync("mkdir", ["-p", join(cwd, ".roll")]);
    writeBacklog(cwd, ["| US-A-001 | First story | Done |", "| FIX-B-002 | A bug fix | Done |"]);
    const b = bashRun(env, ["runs"], cwd);
    const t = tsRun(env, ["runs"], cwd);
    expect(t).toBe(b);
  });

  it("N limit (newest first) matches", () => {
    const rows = [0, 1, 2, 3, 4].map((k) => ({
      project: SLUG,
      run_id: `r${k}`,
      ts: `2026-05-11T0${k}:00:00Z`,
      status: "built",
      built: [`US-X-00${k}`],
      tcr_count: k,
      duration_sec: 100 + k,
    }));
    const { env, cwd } = sandbox(rows);
    execFileSync("mkdir", ["-p", join(cwd, ".roll")]);
    writeBacklog(cwd, ["| placeholder | x | y |"]);
    const b = bashRun(env, ["runs", "2"], cwd);
    const t = tsRun(env, ["2"], cwd);
    expect(t).toBe(b);
  });

  it("empty runs file → no_loop_runs_yet", () => {
    const { env, cwd } = sandbox([]);
    execFileSync("mkdir", ["-p", join(cwd, ".roll")]);
    const b = bashRun(env, ["runs"], cwd);
    const t = tsRun(env, ["runs"], cwd);
    expect(t).toBe(b);
  });

  it("rows for other projects only → no_loop_runs_for_current_project", () => {
    const rows = [{ project: "someone-else-999", run_id: "r1", ts: "2026-05-11T11:00:00Z", status: "idle" }];
    const { env, cwd } = sandbox(rows);
    execFileSync("mkdir", ["-p", join(cwd, ".roll")]);
    const b = bashRun(env, ["runs"], cwd);
    const t = tsRun(env, ["runs"], cwd);
    expect(t).toBe(b);
  });

  it("--all merges projects, newest-first, with [proj] prefix", () => {
    const { env, cwd } = sandbox([{ project: SLUG, run_id: "own", ts: "2026-05-11T12:00:00Z", status: "idle" }]);
    execFileSync("mkdir", ["-p", join(cwd, ".roll")]);
    // Two extra project runtime dirs via ROLL_LOOP_RUNS_ALL_DIRS.
    const d1 = mkdtempSync(join(tmpdir(), "roll-runs-d1-"));
    const d2 = mkdtempSync(join(tmpdir(), "roll-runs-d2-"));
    dirs.push(d1, d2);
    writeFileSync(
      join(d1, "runs.jsonl"),
      JSON.stringify({ project: "alpha-111", run_id: "a1", ts: "2026-05-11T10:00:00Z", status: "built", built: ["US-A-001"], tcr_count: 1, duration_sec: 50 }) + "\n",
    );
    writeFileSync(
      join(d2, "runs.jsonl"),
      JSON.stringify({ project: "beta-222", run_id: "b1", ts: "2026-05-11T11:00:00Z", status: "failed", reason: "boom" }) + "\n",
    );
    const allEnv = { ...env, ROLL_LOOP_RUNS_ALL_DIRS: `${d1}:${d2}` };
    const b = bashRun(allEnv, ["runs", "--all"], cwd);
    const t = tsRun(allEnv, ["--all"], cwd);
    expect(t).toBe(b);
  });

  it("--detail <cycle> phase breakdown matches", () => {
    const rows = [
      {
        project: SLUG,
        cycle_id: "cycle-xyz",
        run_id: "r1",
        ts: "2026-05-11T09:00:00Z",
        status: "built",
        built: ["US-A-001"],
        phases: { agent_invoke: 300, worktree_setup: 40, publish_push: 60, test: 100 },
      },
    ];
    const { env, cwd } = sandbox(rows);
    execFileSync("mkdir", ["-p", join(cwd, ".roll")]);
    const b = bashRun(env, ["runs", "--detail", "cycle-xyz"], cwd);
    const t = tsRun(env, ["--detail", "cycle-xyz"], cwd);
    expect(t).toBe(b);
  });

  it("--detail missing cycle → not-found message", () => {
    const rows = [{ project: SLUG, cycle_id: "cycle-xyz", run_id: "r1", ts: "2026-05-11T09:00:00Z", status: "idle" }];
    const { env, cwd } = sandbox(rows);
    execFileSync("mkdir", ["-p", join(cwd, ".roll")]);
    const b = bashRun(env, ["runs", "--detail", "nope"], cwd);
    const t = tsRun(env, ["--detail", "nope"], cwd);
    expect(t).toBe(b);
  });
});
