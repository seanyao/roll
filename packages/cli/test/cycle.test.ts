/** US-CLI-013 — `roll cycle <id>`: the vertical trace tape in the terminal. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cycleCommand, findCycle, renderCycleTrace } from "../src/commands/cycle.js";
import { collectCycleLedger } from "../src/lib/cycle-ledger.js";
import { stripAnsi } from "../src/render.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env["ROLL_LANG"];
});

function project(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-cycle-"));
  dirs.push(p);
  mkdirSync(join(p, ".roll", "loop"), { recursive: true });
  writeFileSync(
    join(p, ".roll", "loop", "runs.jsonl"),
    [
      JSON.stringify({ cycle_id: "20260612-x-0311", status: "merged", outcome: "delivered", story_id: "FIX-241", agent: "claude", ts: "2026-06-12T19:00:00Z", duration_sec: 500, cost_usd: 0.05, tokens_in: 120000, tokens_out: 22000, tcr_count: 3, merge_commit: "abc" }),
      JSON.stringify({ cycle_id: "20260612-x-0310", status: "failed", story_id: "US-X-1", agent: "pi", ts: "2026-06-12T18:00:00Z", duration_sec: 100 }),
    ].join("\n") + "\n",
  );
  writeFileSync(
    join(p, ".roll", "loop", "events.ndjson"),
    [
      JSON.stringify({ type: "peer:gate", cycleId: "20260612-x-0311", verdict: "consulted", reasons: [], ts: 1 }),
      JSON.stringify({ type: "attest:gate", cycleId: "20260612-x-0311", verdict: "produced", reasons: [], ts: 2 }),
      JSON.stringify({ type: "pr:merge", prNumber: 461, storyId: "FIX-241", ts: 3 }),
    ].join("\n") + "\n",
  );
  return p;
}

describe("findCycle — AC1 tolerance", () => {
  it("matches with/without # and leading zeros, and the full id", () => {
    const rows = collectCycleLedger(project());
    expect(findCycle(rows, "0311")?.storyId).toBe("FIX-241");
    expect(findCycle(rows, "#0311")?.storyId).toBe("FIX-241");
    expect(findCycle(rows, "311")?.storyId).toBe("FIX-241");
    expect(findCycle(rows, "20260612-x-0311")?.storyId).toBe("FIX-241");
    expect(findCycle(rows, "9999")).toBeUndefined();
  });
});

describe("renderCycleTrace", () => {
  it("AC2/AC3/AC4: summary + story + seven vertical segments + evidence pointers", () => {
    const rows = collectCycleLedger(project());
    const out = stripAnsi(renderCycleTrace(findCycle(rows, "0311")!, "en", "seanyao/roll"));
    expect(out).toContain("#0311 · delivered");
    expect(out).toContain("story FIX-241");
    for (const k of ["cycle", "story", "build", "peer", "ci", "pr", "end"]) expect(out).toContain(k);
    expect(out).toContain("3 commits");
    expect(out).toContain("#461 merged");
    expect(out).toContain("PR https://github.com/seanyao/roll/pull/461");
    expect(out).toContain("diff https://github.com/seanyao/roll/pull/461/files");
    expect((out.match(/●/g) ?? []).length).toBe(7);
  });

  it("a cycle that died mid-way shows 'not reached' segments instead of omitting them", () => {
    const rows = collectCycleLedger(project());
    const out = stripAnsi(renderCycleTrace(findCycle(rows, "0310")!, "en"));
    expect(out).toContain("not reached");
    expect((out.match(/●/g) ?? []).length).toBe(7); // all seven segments, always
  });

  it("AC5: en/zh snapshots", () => {
    const rows = collectCycleLedger(project());
    expect(stripAnsi(renderCycleTrace(findCycle(rows, "0311")!, "en", "seanyao/roll"))).toMatchSnapshot();
    expect(stripAnsi(renderCycleTrace(findCycle(rows, "0311")!, "zh", "seanyao/roll"))).toMatchSnapshot();
  });
});

describe("cycleCommand", () => {
  it("AC1: unknown id fails loud, non-zero exit", async () => {
    const save = process.cwd();
    process.chdir(project());
    let err = "";
    const se = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
    try {
      expect(cycleCommand(["424242"])).toBe(1);
    } finally {
      process.stderr.write = se;
      process.chdir(save);
    }
    expect(err).toContain("no cycle matches");
  });
});
