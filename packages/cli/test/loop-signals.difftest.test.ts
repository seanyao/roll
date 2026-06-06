/**
 * diff-test: TS `roll loop signals` == bash `bin/roll loop signals` (frozen
 * oracle). The detector itself is a verified direct port (@roll/core
 * detectSignals == lib/loop_result_eval.py, covered in core); this test pins
 * the CLI adapter's observable contract: stdout lines, the candidates.md draft
 * blocks, dedup on re-run, and --quiet. US-PORT-007.
 *
 * Bash and TS run in SEPARATE sandboxes with identical seeds (a shared sandbox
 * would let one side's dedup mask the other). stdout's final line embeds the
 * absolute candidates.md path, so it is normalized before comparison; the
 * volatile `- Detected:` timestamp line is stripped from candidates.md.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loopSignalsCommand } from "../src/commands/loop-signals.js";

const REPO = resolve(__dirname, "../../..");
const BASH = join(REPO, "bin", "roll");
const dirs: string[] = [];
const SLUG = "test-sig-abc123";

afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

/** A fresh sandbox: HOME, runtime dir (with seeded runs), project dir. */
function sandbox(rows: object[]): { env: Record<string, string>; proj: string; rt: string } {
  const home = mkdtempSync(join(tmpdir(), "roll-sig-home-"));
  const rt = mkdtempSync(join(tmpdir(), "roll-sig-rt-"));
  const shared = mkdtempSync(join(tmpdir(), "roll-sig-shared-"));
  const proj = mkdtempSync(join(tmpdir(), "roll-sig-proj-"));
  dirs.push(home, rt, shared, proj);
  if (rows.length > 0) writeFileSync(join(rt, "runs.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const env = {
    HOME: home,
    ROLL_PROJECT_RUNTIME_DIR: rt,
    ROLL_SHARED_ROOT: shared,
    ROLL_MAIN_SLUG: SLUG,
    ROLL_MAIN_PROJECT: proj,
    _LOOP_RT_DIR: rt,
    ROLL_LANG: "en",
    NO_COLOR: "1",
  };
  return { env, proj, rt };
}

function tsRun(env: Record<string, string>, argv: string[]): string {
  const saveEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saveEnv[k] = process.env[k];
    process.env[k] = v;
  }
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  // @ts-expect-error — capture-only override
  process.stdout.write = (c: string | Uint8Array): boolean => {
    out.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
    return true;
  };
  try {
    loopSignalsCommand(argv);
  } finally {
    process.stdout.write = realOut;
    for (const [k, v] of Object.entries(saveEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return out.join("");
}

function bashRun(env: Record<string, string>, argv: string[]): string {
  try {
    return execFileSync(BASH, ["loop", "signals", ...argv], { cwd: env["ROLL_MAIN_PROJECT"], encoding: "utf8", env: { ...process.env, ...env } });
  } catch (e) {
    return (e as { stdout?: string }).stdout ?? "";
  }
}

/** Replace the sandbox's candidates.md absolute path with a placeholder. */
function normalize(out: string, proj: string): string {
  return out.split(join(proj, ".roll", "signals", "candidates.md")).join("<CAND>");
}
/** candidates.md content minus the volatile timestamp line. */
function candBody(proj: string): string {
  const p = join(proj, ".roll", "signals", "candidates.md");
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("- Detected:"))
    .join("\n");
}

/** Three cycles all low on `outcome` → fires one FIX signal. */
function lowOutcomeRows(): object[] {
  return [0, 1, 2].map((k) => ({
    project: SLUG,
    run_id: `r${k}`,
    ts: `2026-05-11T0${k}:00:00Z`,
    status: "built",
    result_eval: { version: 1, score: 3, dims: { outcome: 0.0, correctness: 1.0 } },
  }));
}

describe("diff-test: roll loop signals == bin/roll loop signals", () => {
  it("fresh signal → identical stdout + candidates.md draft", () => {
    const a = sandbox(lowOutcomeRows());
    const b = sandbox(lowOutcomeRows());
    const bashOut = bashRun(a.env, []);
    const tsOut = tsRun(b.env, []);
    expect(normalize(tsOut, b.proj)).toBe(normalize(bashOut, a.proj));
    expect(candBody(b.proj)).toBe(candBody(a.proj));
  });

  it("no signal → 'no new improvement signals' on both sides", () => {
    const good = [0, 1, 2].map((k) => ({
      project: SLUG,
      run_id: `r${k}`,
      ts: `2026-05-11T0${k}:00:00Z`,
      status: "built",
      result_eval: { version: 1, score: 9, dims: { outcome: 1.0, correctness: 1.0 } },
    }));
    const a = sandbox(good);
    const b = sandbox(good);
    expect(tsRun(b.env, [])).toBe(bashRun(a.env, []));
  });

  it("no runs file → 'No loop runs yet'", () => {
    const a = sandbox([]);
    const b = sandbox([]);
    expect(tsRun(b.env, [])).toBe(bashRun(a.env, []));
  });

  it("--quiet suppresses output", () => {
    const a = sandbox(lowOutcomeRows());
    const b = sandbox(lowOutcomeRows());
    expect(tsRun(b.env, ["--quiet"])).toBe(bashRun(a.env, ["--quiet"]));
    // ...but the candidate is still written.
    expect(candBody(b.proj)).toBe(candBody(a.proj));
    expect(candBody(b.proj)).toContain("lowdim:outcome");
  });

  it("dedup: a second run raises no new signal", () => {
    const b = sandbox(lowOutcomeRows());
    const first = tsRun(b.env, []);
    expect(first).toContain("signal: CAND-001 outcome");
    const second = tsRun(b.env, []);
    expect(second).toBe("no new improvement signals (result-eval patterns)\n");
  });

  it("--streak below the run length still fires; help exits 0", () => {
    const a = sandbox(lowOutcomeRows());
    const b = sandbox(lowOutcomeRows());
    expect(normalize(tsRun(b.env, ["--streak", "2"]), b.proj)).toBe(normalize(bashRun(a.env, ["--streak", "2"]), a.proj));
  });
});
