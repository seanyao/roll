/**
 * FIX-1049 — `roll loop recover` command: preview surfaces the stall facts;
 * --apply re-arms the goal for the next eligible Builder (clears the skip, flips
 * paused→active, records a `goal:recovery` allowed event); denies + explains when
 * no alternate Builder exists; and the no-progress breaker still holds when no
 * supervised action is taken. Writes go to ROLL_MAIN_PROJECT.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseGoalYaml, renderGoalYaml, type RollEvent, type RollGoal } from "@roll/spec";
import { loopRecoverCommand, type RecoverDeps } from "../src/commands/loop-recover.js";

let cwd0: string;
let dir: string;
const savedEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string): void {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  process.env[k] = v;
}
beforeEach(() => {
  cwd0 = process.cwd();
  dir = mkdtempSync(join(tmpdir(), "loop-recover-"));
  mkdirSync(join(dir, ".roll", "loop"), { recursive: true });
  setEnv("ROLL_MAIN_PROJECT", dir);
  setEnv("ROLL_PROJECT_RUNTIME_DIR", join(dir, ".roll", "loop"));
  setEnv("NO_COLOR", "1");
});
afterEach(() => {
  process.chdir(cwd0);
  rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});

function seedGoal(overrides: Partial<RollGoal>): void {
  const g: RollGoal = {
    schema: "goal.v1",
    scope: { kind: "cards", cards: ["REFACTOR-055"] },
    review: { mode: "auto" },
    limits: {},
    status: "paused",
    usage: { cycles: 2, costUsd: 0 },
    createdAt: "2026-06-30T00:00:00Z",
    updatedAt: "2026-06-30T01:00:00Z",
    ...overrides,
  };
  writeFileSync(join(dir, ".roll", "loop", "goal.yaml"), renderGoalYaml(g));
}

function seedEvents(events: RollEvent[]): void {
  writeFileSync(join(dir, ".roll", "loop", "events.ndjson"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

function readGoal(): RollGoal {
  return parseGoalYaml(readFileSync(join(dir, ".roll", "loop", "goal.yaml"), "utf8"));
}

function events(): Record<string, unknown>[] {
  const p = join(dir, ".roll", "loop", "events.ndjson");
  try {
    return readFileSync(p, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function run(args: string[], deps: RecoverDeps): { code: number; out: string } {
  const chunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (chunks.push(String(c)), true);
  process.chdir(dir);
  let code = 1;
  try {
    code = loopRecoverCommand(args, deps);
  } finally {
    process.stdout.write = realOut;
  }
  return { code, out: chunks.join("") };
}

const cs = (cycleId: string, storyId: string, agent: string, ts: number): RollEvent => ({
  type: "cycle:start",
  cycleId,
  storyId,
  agent: agent as never,
  model: "m",
  ts,
});
const ce = (cycleId: string, outcome: string, ts: number): RollEvent =>
  ({ type: "cycle:end", cycleId, outcome: outcome as never, cost: {} as never, ts }) as RollEvent;

const STALLED = {
  lastDecisionReason: "no_progress_on_all_cards",
  progress: { skippedCards: ["REFACTOR-055"], zeroStreaks: { "REFACTOR-055": 2 }, noProgressCycles: 2 },
} as const;

const depsWith = (next: string | undefined): RecoverDeps => ({ now: () => 1_700_000_000_000, nextEligibleBuilder: () => next });

describe("roll loop recover", () => {
  it("reports nothing to recover for a non-stalled goal", () => {
    seedGoal({ status: "active", lastDecisionReason: undefined });
    const r = run([], depsWith("reasonix"));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/nothing to recover/i);
  });

  it("preview surfaces blocked card, last builder, next builder, and the retry command", () => {
    seedGoal({ ...STALLED });
    seedEvents([cs("c1", "REFACTOR-055", "agy", 1), ce("c1", "gave_up", 2), cs("c2", "REFACTOR-055", "pi", 3), ce("c2", "blocked", 4)]);
    const r = run([], depsWith("reasonix"));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/blocked cards: REFACTOR-055/);
    expect(r.out).toMatch(/last failed Builder: pi/);
    expect(r.out).toMatch(/next eligible Builder: reasonix/);
    expect(r.out).toMatch(/roll loop recover REFACTOR-055 --apply/);
    // preview must NOT mutate the goal or append an event
    expect(readGoal().status).toBe("paused");
    expect(events().some((e) => e["type"] === "goal:recovery")).toBe(false);
  });

  it("--apply re-arms the goal for the next Builder and records an allowed event", () => {
    seedGoal({
      ...STALLED,
      safety: {
        lastGate: "progress",
        lastReason: "no_progress_on_all_cards",
        lastAt: "2026-06-30T00:59:00Z",
        lastReading: "all cards exhausted",
      },
    });
    seedEvents([cs("c2", "REFACTOR-055", "pi", 3), ce("c2", "blocked", 4)]);
    const r = run(["REFACTOR-055", "--apply", "--reason", "agy/pi runtime failures; rotate to reasonix"], depsWith("reasonix"));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/ALLOWED/);
    expect(r.out).toMatch(/next: roll loop go --cards REFACTOR-055/);

    const g = readGoal();
    expect(g.status).toBe("active");
    // the skip + streak for the recovered card are cleared so the next go runs it
    expect(g.progress?.skippedCards ?? []).not.toContain("REFACTOR-055");
    expect(g.progress?.noProgressCycles ?? 0).toBe(0);
    expect(g.safety).toBeUndefined();

    const ev = events().find((e) => e["type"] === "goal:recovery");
    expect(ev).toBeDefined();
    expect(ev!["decision"]).toBe("allowed");
    expect(ev!["actor"]).toBe("owner");
    expect(ev!["storyId"]).toBe("REFACTOR-055");
    expect(ev!["lastBuilder"]).toBe("pi");
    expect(ev!["nextBuilder"]).toBe("reasonix");
    expect(ev!["reason"]).toMatch(/rotate to reasonix/);
  });

  it("includes the bounded handoff reference in the allowed event when the failed cycle had no TCR", () => {
    seedGoal({ ...STALLED });
    seedEvents([cs("c2", "REFACTOR-055", "pi", 3), ce("c2", "handoff_without_tcr", 4)]);
    const r = run(["REFACTOR-055", "--apply"], depsWith("reasonix"));
    expect(r.code).toBe(0);
    const ev = events().find((e) => e["type"] === "goal:recovery")!;
    expect((ev["handoff"] as Record<string, unknown>)["cycleId"]).toBe("c2");
    expect((ev["handoff"] as Record<string, unknown>)["kind"]).toBe("zero_tcr_dirty_worktree");
    expect((ev["handoff"] as Record<string, unknown>)["worktreePath"]).toBe(".roll/loop/worktrees/cycle-c2");
  });

  it("preview surfaces the preserved worktree path for a zero-TCR handoff", () => {
    seedGoal({ ...STALLED });
    seedEvents([cs("c2", "REFACTOR-055", "pi", 3), ce("c2", "handoff_without_tcr", 4)]);
    const r = run([], depsWith("reasonix"));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/kind: zero_tcr_dirty_worktree/);
    expect(r.out).toMatch(/worktree: \.roll\/loop\/worktrees\/cycle-c2/);
  });

  it("DENIES + explains when no eligible Builder is available, leaving the goal paused", () => {
    seedGoal({ ...STALLED });
    seedEvents([cs("c2", "REFACTOR-055", "pi", 3), ce("c2", "blocked", 4)]);
    const r = run(["REFACTOR-055", "--apply"], depsWith(undefined));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/DENIED/);
    expect(r.out).toMatch(/no eligible Builder/i);
    // breaker still holds: goal stays paused, denial recorded for audit
    expect(readGoal().status).toBe("paused");
    const ev = events().find((e) => e["type"] === "goal:recovery")!;
    expect(ev["decision"]).toBe("denied");
  });

  it("DENIES a blind retry of the same Builder that just failed", () => {
    seedGoal({ ...STALLED });
    seedEvents([cs("c2", "REFACTOR-055", "pi", 3), ce("c2", "blocked", 4)]);
    const r = run(["REFACTOR-055", "--apply"], depsWith("pi"));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/no alternate Builder/i);
    expect(readGoal().status).toBe("paused");
  });

  it("--json emits the machine-readable decision + event", () => {
    seedGoal({ ...STALLED });
    seedEvents([cs("c2", "REFACTOR-055", "pi", 3), ce("c2", "blocked", 4)]);
    const r = run(["REFACTOR-055", "--apply", "--json"], depsWith("reasonix"));
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.out) as { decision: string; event: Record<string, unknown> };
    expect(parsed.decision).toBe("allowed");
    expect(parsed.event["type"]).toBe("goal:recovery");
    expect(parsed.event["nextBuilder"]).toBe("reasonix");
  });
});
