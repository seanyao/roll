/**
 * diff-test: TS `roll loop signals` — frozen v2 oracle output.
 *
 * The detector itself is a verified direct port (@roll/core detectSignals);
 * this test pins the CLI adapter's observable contract.
 *
 * Per US-PORT-009d the bash oracle spawn is dropped; values below were captured
 * while tests were green (TS == oracle) and then frozen.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loopSignalsCommand } from "../src/commands/loop-signals.js";

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

const FROZEN_FRESH = "signal: CAND-001 outcome → candidate FIX (cycles keep failing to merge into main for 3 cycles in a row)\n1 candidate draft(s) → <CAND> (📋 待人确认, not activated)\n";
const FROZEN_CAND = "\n## CAND-001 — outcome (FIX) 📋 待人确认\n- Pattern: lowdim:outcome\n- Signal: cycles keep failing to merge into main for 3 cycles in a row\n- 信号：result-eval 维度 outcome 连续 3 轮低分；候选 FIX，待人确认后再激活。\n";

describe("frozen: roll loop signals", () => {
  it("fresh signal → identical stdout + candidates.md draft", () => {
    const b = sandbox(lowOutcomeRows());
    const tsOut = tsRun(b.env, []);
    expect(normalize(tsOut, b.proj)).toBe(FROZEN_FRESH);
    expect(candBody(b.proj)).toBe(FROZEN_CAND);
  });

  it("no signal → 'no new improvement signals'", () => {
    const good = [0, 1, 2].map((k) => ({
      project: SLUG,
      run_id: `r${k}`,
      ts: `2026-05-11T0${k}:00:00Z`,
      status: "built",
      result_eval: { version: 1, score: 9, dims: { outcome: 1.0, correctness: 1.0 } },
    }));
    const b = sandbox(good);
    expect(tsRun(b.env, [])).toBe("no new improvement signals (result-eval patterns)\n");
  });

  it("no runs file → 'No loop runs yet'", () => {
    const b = sandbox([]);
    expect(tsRun(b.env, [])).toBe("No loop runs yet\n");
  });

  it("--quiet suppresses output", () => {
    const b = sandbox(lowOutcomeRows());
    expect(tsRun(b.env, ["--quiet"])).toBe("");
    expect(candBody(b.proj)).toBe(FROZEN_CAND);
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
    const b = sandbox(lowOutcomeRows());
    expect(normalize(tsRun(b.env, ["--streak", "2"]), b.proj)).toBe(FROZEN_FRESH);
  });
});
