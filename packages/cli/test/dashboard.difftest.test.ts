/**
 * diff-test: TS `roll loop status` == python lib/roll-loop-status.py (frozen
 * v2 oracle). Fixture render (deterministic) + live render in a fabricated
 * runtime dir with synthetic events/runs. Byte-for-byte.
 *
 * Both sides run with a controlled HOME + empty ROLL_SHARED_ROOT + temp
 * ROLL_PROJECT_RUNTIME_DIR so the eyebrow's launchd/dream/pr probes resolve
 * deterministically (not-installed, no daily/tick lines).
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dashboardCommand } from "../src/commands/dashboard.js";
import { renderState } from "../src/render.js";

const REPO = resolve(__dirname, "../../..");
const PY = join(REPO, "lib", "roll-loop-status.py");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

/** Run the TS dashboard in-process with env/cwd, capturing stdout. */
function tsRun(env: Record<string, string | undefined>, argv: string[], cwd?: string): string {
  const saveEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saveEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const saveCwd = process.cwd();
  if (cwd !== undefined) process.chdir(cwd);
  const chunks: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  // @ts-expect-error — capture-only override
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  try {
    dashboardCommand(argv);
  } finally {
    process.stdout.write = realWrite;
    renderState.useColor = true; // reset module state for the next case
    process.chdir(saveCwd);
    for (const [k, v] of Object.entries(saveEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return chunks.join("");
}

function pyRun(env: Record<string, string>, argv: string[], cwd?: string): string {
  return execFileSync("python3", [PY, ...argv], {
    cwd: cwd ?? REPO,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

/** A sandbox that neutralizes all host-dependent eyebrow probes. */
function sandboxEnv(extra: Record<string, string> = {}): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), "roll-dash-home-"));
  const rt = mkdtempSync(join(tmpdir(), "roll-dash-rt-"));
  const shared = mkdtempSync(join(tmpdir(), "roll-dash-shared-"));
  dirs.push(home, rt, shared);
  return {
    HOME: home,
    ROLL_PROJECT_RUNTIME_DIR: rt,
    ROLL_SHARED_ROOT: shared,
    ROLL_MAIN_SLUG: "test-abc123",
    _LAUNCHD_DIR: join(home, "la"),
    ...extra,
  };
}

/** Pad a number to 2 digits. */
const p2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
/** ISO UTC string with +00:00 suffix (matches the writer format). */
function iso(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T` +
    `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}+00:00`
  );
}
/** Cycle label YYYYMMDD-HHMMSS-PID in UTC. */
function label(d: Date): string {
  return (
    `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}-` +
    `${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}-99999`
  );
}

describe("diff-test: roll loop status == roll-loop-status.py (fixture)", () => {
  for (const variant of [["--no-color"], ["--no-color", "--en"], ["--no-color", "--zh"], ["--no-color", "--days", "7"]]) {
    it(`fixture ${variant.join(" ")} matches byte-for-byte`, () => {
      const env = sandboxEnv({ ROLL_RENDER_FIXTURE: "1" });
      // Guard against a once-a-day minute-boundary flake: the title row prints
      // `now` at minute resolution. Run py first, ts immediately after; retry
      // once if they straddle a minute tick.
      let py = pyRun(env, variant, REPO);
      let ts = tsRun(env, variant, REPO);
      if (ts !== py) {
        py = pyRun(env, variant, REPO);
        ts = tsRun(env, variant, REPO);
      }
      expect(ts).toBe(py);
    });
  }

  it("--eval fixture view matches", () => {
    const env = sandboxEnv({ ROLL_RENDER_FIXTURE: "1" });
    const py = pyRun(env, ["--eval", "--no-color"], REPO);
    const ts = tsRun(env, ["--eval", "--no-color"], REPO);
    expect(ts).toBe(py);
  });

  it("--eval 5 (numeric arg, fixture) matches", () => {
    const env = sandboxEnv({ ROLL_RENDER_FIXTURE: "1" });
    const py = pyRun(env, ["--eval", "5", "--no-color"], REPO);
    const ts = tsRun(env, ["--eval", "5", "--no-color"], REPO);
    expect(ts).toBe(py);
  });

  it("unknown flag errors with exit 2 (argparse parity)", () => {
    const env = sandboxEnv({ ROLL_RENDER_FIXTURE: "1" });
    let pyCode = 0;
    let pyErr = "";
    try {
      execFileSync("python3", [PY, "--bogus"], { cwd: REPO, encoding: "utf8", env: { ...process.env, ...env } });
    } catch (e) {
      const ex = e as { status?: number; stderr?: string };
      pyCode = ex.status ?? -1;
      pyErr = ex.stderr ?? "";
    }
    // Capture TS stderr + exit code.
    const realErr = process.stderr.write.bind(process.stderr);
    let tsErr = "";
    // @ts-expect-error — capture-only override
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      tsErr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    };
    let tsCode: number;
    try {
      tsCode = dashboardCommand(["--bogus"]);
    } finally {
      process.stderr.write = realErr;
    }
    expect(tsCode).toBe(pyCode);
    expect(tsErr).toBe(pyErr);
  });
});

describe("diff-test: roll loop status == roll-loop-status.py (live)", () => {
  it("synthetic events + runs render identically", () => {
    const env = sandboxEnv();
    const rt = env["ROLL_PROJECT_RUNTIME_DIR"] as string;
    const slug = env["ROLL_MAIN_SLUG"] as string;

    // Anchor timestamps to a stable mid-minute instant ~30min ago to dodge
    // boundary flake. now() is computed inside each renderer, but cycle
    // timestamps are fixed here.
    const base = new Date();
    base.setUTCSeconds(30, 0);
    const start1 = new Date(base.getTime() - 30 * 60 * 1000);
    const end1 = new Date(start1.getTime() + 600 * 1000);
    const start2 = new Date(base.getTime() - 90 * 60 * 1000);
    const end2 = new Date(start2.getTime() + 480 * 1000);
    const lab1 = label(start1);
    const lab2 = label(start2);

    // events.ndjson: one done cycle w/ usage event, one failed cycle.
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
      {
        ts: iso(end1),
        stage: "pr",
        label: lab1,
        detail: "https://github.com/x/y/pull/777",
        outcome: "merged",
      },
      { ts: iso(end1), stage: "cycle_end", label: lab1, detail: "", outcome: "done" },
      { ts: iso(start2), stage: "cycle_start", label: lab2, detail: "", outcome: "" },
      { ts: iso(start2), stage: "pick_todo", label: lab2, detail: "FIX-200 picked", outcome: "ok" },
      { ts: iso(end2), stage: "test", label: lab2, detail: "3/9 tests failed", outcome: "fail" },
      { ts: iso(end2), stage: "cycle_end", label: lab2, detail: "", outcome: "fail" },
    ];
    writeFileSync(
      join(rt, "events.ndjson"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    // runs.jsonl: tcr + built + a result_eval for the eval line, plus agent.
    const runs = [
      {
        project: slug,
        run_id: "r1",
        ts: iso(new Date(end1.getTime() + 5000)),
        tcr_count: 2,
        built: ["US-CLI-006"],
        status: "built",
        agent: "claude",
        duration_sec: 600,
        result_eval: { version: 1, score: 8, dims: { outcome: 1.0, correctness: 1.0, quality: 0.0 } },
      },
      {
        project: slug,
        run_id: "r2",
        ts: iso(new Date(end2.getTime() + 5000)),
        tcr_count: 0,
        built: [],
        status: "interrupted",
        agent: "pi",
        result_eval: { version: 1, score: 5, dims: { outcome: 0.0, scope_fidelity: 1.0 } },
      },
    ];
    writeFileSync(join(rt, "runs.jsonl"), runs.map((r) => JSON.stringify(r)).join("\n") + "\n");

    // backlog in cwd (.roll/backlog.md). Use a fresh project dir.
    const proj = mkdtempSync(join(tmpdir(), "roll-dash-proj-"));
    dirs.push(proj);
    mkdirSync(join(proj, ".roll"), { recursive: true });
    writeFileSync(
      join(proj, ".roll", "backlog.md"),
      [
        "| ID | Description | Status |",
        "|----|----|----|",
        "| US-CLI-006 | Port loop-status dashboard to TS | Done |",
        "| FIX-200 | Some bugfix description | Todo |",
        "",
      ].join("\n"),
    );

    let py = pyRun(env, ["--no-color"], proj);
    let ts = tsRun(env, ["--no-color"], proj);
    if (ts !== py) {
      py = pyRun(env, ["--no-color"], proj);
      ts = tsRun(env, ["--no-color"], proj);
    }
    expect(ts).toBe(py);
  });

  it("paused state + CNY cost + populated eval/self-score render identically", () => {
    const env = sandboxEnv();
    const rt = env["ROLL_PROJECT_RUNTIME_DIR"] as string;
    const slug = env["ROLL_MAIN_SLUG"] as string;

    // state.yaml → paused eyebrow (no host-dependent install probe).
    writeFileSync(
      join(rt, "state.yaml"),
      ['status: "paused"', 'paused_at: "2026-06-04T10:00:00Z"', 'paused_reason: "manual hold"', ""].join("\n"),
    );

    const base = new Date();
    base.setUTCSeconds(30, 0);
    const start1 = new Date(base.getTime() - 40 * 60 * 1000);
    const end1 = new Date(start1.getTime() + 420 * 1000);
    const lab1 = label(start1);

    // deepseek (pi) cycle → native CNY cost row + agent "pi".
    const usage = {
      model: "deepseek-v4-pro",
      input_tokens: 9000,
      output_tokens: 2000,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      cost_list_usd: 0.42,
      cost_currency: "CNY",
      duration_ms: 420000,
    };
    const events = [
      { ts: iso(start1), stage: "cycle_start", label: lab1, detail: "", outcome: "" },
      { ts: iso(start1), stage: "pick_todo", label: lab1, detail: "FIX-300 picked", outcome: "ok" },
      { ts: iso(end1), stage: "agent_used", label: lab1, detail: "pi", outcome: "ok" },
      { ts: iso(end1), stage: "usage", label: lab1, detail: usage, outcome: "ok" },
      { ts: iso(end1), stage: "cycle_end", label: lab1, detail: "", outcome: "done" },
    ];
    writeFileSync(join(rt, "events.ndjson"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");

    // 4 result_eval records → populated result-eval line (mean/min/trend/dims).
    const runs = [0, 1, 2, 3].map((k) => ({
      project: slug,
      run_id: `e${k}`,
      ts: iso(new Date(end1.getTime() - (3 - k) * 1000)),
      tcr_count: 1,
      built: ["FIX-300"],
      status: "built",
      agent: "pi",
      result_eval: {
        version: 1,
        score: 6 + k,
        dims: { outcome: k % 2, correctness: 1.0, scope_fidelity: 1.0, quality: 0.0, efficiency: "unknown" },
      },
    }));
    writeFileSync(join(rt, "runs.jsonl"), runs.map((r) => JSON.stringify(r)).join("\n") + "\n");

    // self-score notes (.roll/notes/*.md) → self-score summary line.
    const proj = mkdtempSync(join(tmpdir(), "roll-dash-proj2-"));
    dirs.push(proj);
    mkdirSync(join(proj, ".roll", "notes"), { recursive: true });
    for (const [i, [s, v]] of [
      ["8", "ok"],
      ["5", "ok"],
      ["7", "regression"],
    ].entries()) {
      writeFileSync(join(proj, ".roll", "notes", `2026-06-0${i + 1}.md`), `score: ${s}\nverdict: ${v}\n`);
    }
    mkdirSync(join(proj, ".roll"), { recursive: true });
    writeFileSync(
      join(proj, ".roll", "backlog.md"),
      ["| FIX-300 | A CNY-billed bugfix | Done |", ""].join("\n"),
    );

    let py = pyRun(env, ["--no-color"], proj);
    let ts = tsRun(env, ["--no-color"], proj);
    if (ts !== py) {
      py = pyRun(env, ["--no-color"], proj);
      ts = tsRun(env, ["--no-color"], proj);
    }
    expect(ts).toBe(py);
  });
});
