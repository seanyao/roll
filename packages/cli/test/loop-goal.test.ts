import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loopGoalCommand } from "../src/commands/loop-goal.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function project(): string {
  const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-goal-")));
  dirs.push(p);
  mkdirSync(join(p, ".roll", "loop"), { recursive: true });
  return p;
}

function capture(fn: () => Promise<number>): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (out.push(String(c)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (c: string | Uint8Array): boolean => (err.push(String(c)), true);
  return fn()
    .then((code) => ({ code, out: out.join(""), err: err.join("") }))
    .finally(() => {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
    });
}

describe("US-GOAL-001 — roll loop goal", () => {
  it("prints a friendly empty state when goal.yaml is absent", async () => {
    const p = project();
    const r = await capture(() => loopGoalCommand([], { projectPath: () => p }));
    expect(r.code).toBe(0);
    expect(r.out).toContain("No active goal");
    expect(r.out).toContain("当前没有 goal");
    expect(r.out).toContain(".roll/loop/goal.yaml");
    expect(r.err).toBe("");
  });

  it("renders the current persisted goal status", async () => {
    const p = project();
    writeFileSync(
      join(p, ".roll", "loop", "goal.yaml"),
      `schema: goal.v1
scope:
  kind: epic
  epic: goal-mode
budgetUsd: 8
limits:
  maxCycles: 12
  maxHours: 5
status: budget_limited
usage:
  cycles: 4
  costUsd: 3.25
createdAt: 2026-06-11T07:00:00Z
updatedAt: 2026-06-11T09:00:00Z
lastDecisionReason: weekly_limit_guard
`,
    );

    const r = await capture(() => loopGoalCommand([], { projectPath: () => p }));
    expect(r.code).toBe(0);
    expect(r.out).toContain("Goal status");
    expect(r.out).toContain("budget_limited");
    expect(r.out).toContain("epic goal-mode");
    expect(r.out).toContain("cycles 4");
    expect(r.out).toContain("$3.25 / $8.00");
    expect(r.out).toContain("weekly_limit_guard");
  });

  it("fails loud on malformed goal.yaml", async () => {
    const p = project();
    writeFileSync(
      join(p, ".roll", "loop", "goal.yaml"),
      `schema: goal.v1
scope:
  kind: all
status: done
usage:
  cycles: 0
  costUsd: 0
createdAt: 2026-06-11T07:00:00Z
updatedAt: 2026-06-11T07:00:00Z
`,
    );
    const r = await capture(() => loopGoalCommand([], { projectPath: () => p }));
    expect(r.code).toBe(1);
    expect(r.err).toContain("goal.yaml invalid");
    expect(r.err).toContain("status");
  });
});
