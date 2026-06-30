/**
 * `roll loop repair-evidence` — FIX-1058 recovery path for a green manual-merge PR
 * blocked only by missing delivery evidence. Tests the dry-run and --apply modes.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loopRepairEvidenceCommand, type RepairEvidenceDeps } from "../src/commands/loop-repair-evidence.js";
import { EventBus } from "@roll/core";
import type { RollEvent } from "@roll/spec";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmpProject(events: RollEvent[] = []): string {
  const d = mkdtempSync(join(tmpdir(), "roll-repair-"));
  dirs.push(d);
  mkdirSync(join(d, ".roll", "loop"), { recursive: true });
  if (events.length > 0) {
    appendFileSync(join(d, ".roll", "loop", "events.ndjson"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  return d;
}

function eventsFile(cwd: string): string {
  return join(cwd, ".roll", "loop", "events.ndjson");
}

function readEventsFile(cwd: string): string {
  return readFileSync(eventsFile(cwd), "utf8");
}

function capture<T>(fn: () => T): { out: string; result: T } {
  const chunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (chunks.push(String(c)), true);
  try {
    const result = fn();
    return { out: chunks.join(""), result };
  } finally {
    process.stdout.write = realOut;
  }
}

function depsFor(cwd: string, overrides: Partial<RepairEvidenceDeps> = {}): RepairEvidenceDeps {
  return {
    now: () => 1000,
    runGh: () => ({ stdout: "{}", code: 0 }),
    readEvents: () => new EventBus().readEvents(eventsFile(cwd)),
    appendEvent: (_path, ev) => new EventBus().appendEvent(eventsFile(cwd), ev),
    ...overrides,
  };
}

function cycleEvents(storyId: string, prNumber: number): RollEvent[] {
  return [
    { type: "pr:open", prNumber, storyId, ts: 1 },
    { type: "cycle:start", cycleId: "C1", storyId, agent: "kimi", model: "m", ts: 2 },
    { type: "pair:score", cycleId: "C1", peer: "pi", score: 9, verdict: "good", cost: 0, stage: "score", ts: 3 },
    { type: "attest:gate", cycleId: "C1", verdict: "skipped", reasons: ["no fresh acceptance report"], ts: 4 },
  ];
}

describe("loopRepairEvidenceCommand", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = tmpProject();
  });

  it("missing story-id → usage error", () => {
    const { out, result } = capture(() => loopRepairEvidenceCommand([], depsFor(cwd)));
    expect(result).toBe(1);
    expect(out).toContain("Usage:");
  });

  it("no open PR for the story → error", () => {
    const { out, result } = capture(() => loopRepairEvidenceCommand(["US-2"], depsFor(cwd)));
    expect(result).toBe(1);
    expect(out).toContain("no open PR");
  });

  it("dry run prints auditable recovery facts", () => {
    cwd = tmpProject(cycleEvents("FIX-1057", 1116));
    const deps = depsFor(cwd, {
      runGh: () => ({
        stdout: JSON.stringify({
          reviews: [{ authorAssociation: "BOT", state: "APPROVED" }],
          mergeStateStatus: "CLEAN",
          statusCheckRollup: [{ conclusion: "SUCCESS" }],
        }),
        code: 0,
      }),
    });
    const { out, result } = capture(() => loopRepairEvidenceCommand(["FIX-1057"], deps));
    expect(result).toBe(0);
    expect(out).toContain("Supervised recovery - delivery evidence repair");
    expect(out).toContain("PR: #1116");
    expect(out).toContain("original Builder: kimi");
    expect(out).toContain("accepted Evaluator: pi 9/good");
    expect(out).toContain("PR state: ci=success merge=CLEAN bot=APPROVED");
    expect(out).toContain("to record the repair: roll loop repair-evidence FIX-1057 --apply --outcome committed --agent <delta-team-agent>");
  });

  it("dry run emits JSON with recoverable=true", () => {
    cwd = tmpProject(cycleEvents("FIX-1057", 1116));
    const deps = depsFor(cwd);
    const { out, result } = capture(() => loopRepairEvidenceCommand(["FIX-1057", "--json"], deps));
    expect(result).toBe(0);
    const json = JSON.parse(out);
    expect(json.recoverable).toBe(true);
    expect(json.storyId).toBe("FIX-1057");
    expect(json.prNumber).toBe(1116);
    expect(json.originalBuilder).toBe("kimi");
    expect(json.evaluator).toEqual({ peer: "pi", score: 9, verdict: "good" });
  });

  it("--apply appends an evidence:repair event", () => {
    cwd = tmpProject(cycleEvents("FIX-1057", 1116));
    const deps = depsFor(cwd);
    const env = process.env["ROLL_MAIN_PROJECT"];
    process.env["ROLL_MAIN_PROJECT"] = cwd;
    try {
      const { out, result } = capture(() => loopRepairEvidenceCommand(["FIX-1057", "--apply", "--agent", "delta", "--reason", "acceptance report added"], deps));
      expect(result).toBe(0);
      expect(out).toContain("committed - FIX-1057 / PR #1116");
      expect(out).toContain("agent: delta");
      const lines = readEventsFile(cwd).trim().split("\n");
      const last = JSON.parse(lines[lines.length - 1]);
      expect(last.type).toBe("evidence:repair");
      expect(last.prNumber).toBe(1116);
      expect(last.storyId).toBe("FIX-1057");
      expect(last.agent).toBe("delta");
      expect(last.outcome).toBe("committed");
      expect(last.ts).toBe(1000_000);
    } finally {
      if (env === undefined) delete process.env["ROLL_MAIN_PROJECT"];
      else process.env["ROLL_MAIN_PROJECT"] = env;
    }
  });

  it("--apply without --agent defaults to owner", () => {
    cwd = tmpProject(cycleEvents("FIX-1057", 1116));
    const deps = depsFor(cwd);
    process.env["ROLL_MAIN_PROJECT"] = cwd;
    try {
      capture(() => loopRepairEvidenceCommand(["FIX-1057", "--apply"], deps));
      const lines = readEventsFile(cwd).trim().split("\n");
      const last = JSON.parse(lines[lines.length - 1]);
      expect(last.agent).toBe("owner");
      expect(last.outcome).toBe("committed");
    } finally {
      delete process.env["ROLL_MAIN_PROJECT"];
    }
  });
});
