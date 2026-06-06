/**
 * diff-test: TS `roll loop runs` — frozen v2 oracle output.
 *
 * Covers the single-project list, `--all` cross-project merge, and the
 * `--detail` Phase Breakdown panel. US-PORT-007.
 *
 * Per US-PORT-009d the bash oracle spawn is dropped; values below were captured
 * while tests were green (TS == oracle) and then frozen. TZ=UTC keeps times
 * portable across host timezones.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loopRunsCommand } from "../src/commands/loop-runs.js";

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
    TZ: "UTC",
    ...extra,
  };
  return { env, cwd: proj };
}

function writeBacklog(proj: string, lines: string[]): void {
  writeFileSync(join(proj, ".roll", "backlog.md"), lines.join("\n") + "\n");
}

describe("frozen: roll loop runs", () => {
  it("built + idle + failed rows (with backlog descriptions)", () => {
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
    expect(tsRun(env, ["runs"], cwd)).toBe(
      "  12:40  ✗ FAILED — agent timeout\n  12:10  ○ idle — no Todo items\n  11:46  ✅ built 1 item (3 tcr, 10m)\n    • US-CLI-006     Port the loop-status dashboard to TypeScript\n",
    );
  });

  it("built with multiple items + skipped + phases", () => {
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
    expect(tsRun(env, ["runs"], cwd)).toBe(
      "  09:00  ✅ built 2 items (7 tcr, 1 skipped, 1m, slowest=agent 63%)\n    • US-A-001       First story\n    • FIX-B-002      A bug fix\n",
    );
  });

  it("N limit (newest first)", () => {
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
    expect(tsRun(env, ["2"], cwd)).toBe(
      "  04:00  ✅ built 1 item (4 tcr, 1m)\n    • US-X-004\n  03:00  ✅ built 1 item (3 tcr, 1m)\n    • US-X-003\n",
    );
  });

  it("empty runs file", () => {
    const { env, cwd } = sandbox([]);
    execFileSync("mkdir", ["-p", join(cwd, ".roll")]);
    expect(tsRun(env, ["runs"], cwd)).toBe("No loop runs yet\n");
  });

  it("rows for other projects only", () => {
    const rows = [{ project: "someone-else-999", run_id: "r1", ts: "2026-05-11T11:00:00Z", status: "idle" }];
    const { env, cwd } = sandbox(rows);
    execFileSync("mkdir", ["-p", join(cwd, ".roll")]);
    expect(tsRun(env, ["runs"], cwd)).toBe("No loop runs for current project\n");
  });

  it("--all merges projects, newest-first, with [proj] prefix", () => {
    const { env, cwd } = sandbox([{ project: SLUG, run_id: "own", ts: "2026-05-11T12:00:00Z", status: "idle" }]);
    execFileSync("mkdir", ["-p", join(cwd, ".roll")]);
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
    expect(tsRun(allEnv, ["--all"], cwd)).toBe(
      "  12:00  [test-runs-abc123] ○ idle — no Todo items\n  11:00  [beta-222] ✗ FAILED — boom\n  10:00  [alpha-111] ✅ built 1 item (1 tcr, 50s)\n    • US-A-001\n",
    );
  });

  it("--detail <cycle> phase breakdown", () => {
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
    expect(tsRun(env, ["--detail", "cycle-xyz"], cwd)).toBe(
      "\n─── Cycle cycle-xyz Phase Breakdown ───\n  agent_invoke              300s  ( 60.0%)  ████████████\n  test                      100s  ( 20.0%)  ████\n  publish_push               60s  ( 12.0%)  ██\n  worktree_setup             40s  (  8.0%)  █\n  ──────────────────────────────────────\n  Total                     500s\n\n",
    );
  });

  it("--detail missing cycle", () => {
    const rows = [{ project: SLUG, cycle_id: "cycle-xyz", run_id: "r1", ts: "2026-05-11T09:00:00Z", status: "idle" }];
    const { env, cwd } = sandbox(rows);
    execFileSync("mkdir", ["-p", join(cwd, ".roll")]);
    expect(tsRun(env, ["--detail", "nope"], cwd)).toBe("Cycle not found: nope\n");
  });
});
