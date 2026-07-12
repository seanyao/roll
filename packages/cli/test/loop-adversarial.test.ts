/**
 * US-LOOP-104 — `roll loop adversarial` read-only shadow-run aggregate.
 * Drives the command over a synthetic runs.jsonl and asserts the cohort metrics.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loopAdversarialCommand } from "../src/commands/loop-adversarial.js";
import { stripAnsi } from "../src/render.js";

const dirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string): void {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  process.env[k] = v;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});

function runsDir(rows: string[]): string {
  const d = mkdtempSync(join(tmpdir(), "roll-adv-cmd-"));
  dirs.push(d);
  writeFileSync(join(d, "runs.jsonl"), rows.join("\n") + "\n");
  setEnv("ROLL_PROJECT_RUNTIME_DIR", d);
  return d;
}

function capture(fn: () => number): { status: number; out: string } {
  const o: string[] = [];
  const wo = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((x: string | Uint8Array) => (o.push(String(x)), true)) as typeof process.stdout.write;
  try {
    return { status: fn(), out: stripAnsi(o.join("")) };
  } finally {
    process.stdout.write = wo;
  }
}

describe("roll loop adversarial — US-LOOP-104 shadow-run aggregate", () => {
  const ROWS = [
    JSON.stringify({ run_id: "C1", status: "done", adversarial: { rounds: 3, holesFound: 1, terminationReason: "dry", degraded: false }, duration_sec: 600 }),
    JSON.stringify({ run_id: "C2", status: "done", adversarial: { rounds: 4, holesFound: 3, terminationReason: "max_rounds", degraded: false }, duration_sec: 900 }),
    JSON.stringify({ run_id: "C3", status: "published", adversarial: { rounds: 0, holesFound: 0, terminationReason: "degraded", degraded: true }, duration_sec: 300 }),
    JSON.stringify({ run_id: "C4", status: "done", adversarial: null, duration_sec: 120 }),
    JSON.stringify({ run_id: "C5", status: "idle" }),
  ];

  it("--json emits the cohort metrics (adversarial vs standard, avg holes/rounds, degrade rate, avg duration)", () => {
    runsDir(ROWS);
    const r = capture(() => loopAdversarialCommand(["--json"]));
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.out) as Record<string, number | string>;
    expect(parsed).toMatchObject({
      schema: "roll.adversarial.v1",
      adversarialCohort: 3,
      standardCohort: 2,
      degradeRate: 1 / 3,
      avgDurationSec: 600, // (600+900+300)/3
    });
    expect(parsed["avgHoles"]).toBeCloseTo(4 / 3);
    expect(parsed["avgRounds"]).toBeCloseTo(7 / 3);
  });

  it("human output shows an adversarial metric line (bilingual, read-only)", () => {
    runsDir(ROWS);
    const r = capture(() => loopAdversarialCommand([]));
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/adversarial cycles/);
    expect(r.out).toMatch(/攻防 cycle 数\s+3/);
    expect(r.out).toMatch(/degrade rate\s+降级率\s+33%/);
  });

  it("no adversarial cycles → all-zero cohort + dormant hint (never crashes)", () => {
    runsDir([JSON.stringify({ run_id: "C1", status: "idle" })]);
    const r = capture(() => loopAdversarialCommand(["--json"]));
    const parsed = JSON.parse(r.out) as Record<string, number>;
    expect(parsed["adversarialCohort"]).toBe(0);
    expect(parsed["avgHoles"]).toBe(0);
    const human = capture(() => loopAdversarialCommand([]));
    expect(human.out).toMatch(/no adversarial cycles/);
  });

  it("merges rotated runs.jsonl.<n> siblings and skips malformed lines (I8)", () => {
    const d = mkdtempSync(join(tmpdir(), "roll-adv-rot-"));
    dirs.push(d);
    // a rotation sibling + a malformed line interleaved with a good one.
    writeFileSync(
      join(d, "runs.jsonl.1"),
      JSON.stringify({ run_id: "C0", status: "done", adversarial: { rounds: 2, holesFound: 2, terminationReason: "dry", degraded: false } }) + "\n",
    );
    writeFileSync(
      join(d, "runs.jsonl"),
      "{ this is not json\n" +
        JSON.stringify({ run_id: "C1", status: "done", adversarial: { rounds: 4, holesFound: 0, terminationReason: "max_rounds", degraded: false } }) + "\n",
    );
    setEnv("ROLL_PROJECT_RUNTIME_DIR", d);
    const r = capture(() => loopAdversarialCommand(["--json"]));
    const parsed = JSON.parse(r.out) as Record<string, number>;
    // both rows counted (rotation merged), malformed line skipped (no crash).
    expect(parsed["adversarialCohort"]).toBe(2);
    expect(parsed["avgHoles"]).toBeCloseTo(1); // (2+0)/2
  });

  it("missing runtime dir → clean zero output, exit 0 (I8: readers never crash)", () => {
    setEnv("ROLL_PROJECT_RUNTIME_DIR", join(tmpdir(), "roll-adv-does-not-exist-xyz"));
    const r = capture(() => loopAdversarialCommand(["--json"]));
    expect(r.status).toBe(0);
    expect((JSON.parse(r.out) as Record<string, number>)["adversarialCohort"]).toBe(0);
  });
});
