import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerAll, dispatch } from "../src/index.js";
import { tuneCommand } from "../src/commands/tune.js";
import { stripAnsi } from "../src/render.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-tune-"));
  dirs.push(p);
  mkdirSync(join(p, ".roll", "notes"), { recursive: true });
  mkdirSync(join(p, ".roll", "loop"), { recursive: true });
  for (let i = 1; i <= 4; i++) {
    writeFileSync(
      join(p, ".roll", "notes", `2026-06-0${i}-roll-build-US-TUNE-00${i}.md`),
      [
        "---",
        "skill: roll-build",
        `story: US-TUNE-00${i}`,
        `score: ${i + 3}`,
        i === 1 ? "verdict: ok" : "verdict: good",
        `ts: 2026-06-0${i}T00:00:00Z`,
        "quality: 4",
        "---",
        "",
        "review-score note",
        "",
      ].join("\n"),
    );
  }
  const runs = [
    { agent: "pi", tier: "hard", story_type: "US", status: "failed", result_eval: { dims: { quality: 0.2 } }, rework_fix: "FIX-1" },
    { agent: "pi", tier: "hard", story_type: "US", status: "failed", result_eval: { dims: { quality: 0.3 } }, rework_fix: "FIX-2" },
    { agent: "claude", tier: "hard", story_type: "US", status: "done", outcome: "delivered", result_eval: { dims: { quality: 0.9 } } },
    { agent: "claude", tier: "hard", story_type: "US", status: "done", outcome: "delivered", result_eval: { dims: { quality: 0.8 } } },
  ];
  writeFileSync(join(p, ".roll", "loop", "runs.jsonl"), runs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(
    join(p, ".roll", "loop", "events.ndjson"),
    [
      { type: "tuning:misjudgment", kind: "leak", count: 4 },
      { type: "tuning:misjudgment", kind: "false_block", count: 1 },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  return p;
}

function capture(fn: () => number | Promise<number>): Promise<{ status: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const writeOut = process.stdout.write.bind(process.stdout);
  const writeErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((x: string | Uint8Array) => (out.push(String(x)), true)) as typeof process.stdout.write;
  process.stderr.write = ((x: string | Uint8Array) => (err.push(String(x)), true)) as typeof process.stderr.write;
  return Promise.resolve()
    .then(fn)
    .then((status) => ({ status, stdout: stripAnsi(out.join("")), stderr: stripAnsi(err.join("")) }))
    .finally(() => {
      process.stdout.write = writeOut;
      process.stderr.write = writeErr;
    });
}

describe("tuneCommand — US-EVID-015", () => {
  it("collects project trends and prints explainable suggest-mode JSON", async () => {
    const p = project();
    const old = process.cwd();
    process.chdir(p);
    try {
      const r = await capture(() => tuneCommand(["--json", "--min-samples", "2", "--now", "2026-06-09T00:00:00Z"]));
      expect(r.status).toBe(0);
      const body = JSON.parse(r.stdout) as { applied: boolean; proposals: Array<{ kind: string; evidence: string[] }> };
      expect(body.applied).toBe(false);
      expect(body.proposals.map((x) => x.kind)).toContain("threshold");
      expect(body.proposals.map((x) => x.kind)).toContain("route_preference");
      expect(body.proposals.map((x) => x.kind)).toContain("rubric_weight");
      expect(body.proposals.flatMap((x) => x.evidence).join("\n")).toContain("leak=4");
      expect(body.proposals.flatMap((x) => x.evidence).join("\n")).toContain("claude pass_rate=1.00");
    } finally {
      process.chdir(old);
    }
  });

  it("prints default rollback instructions without writing files", async () => {
    const r = await capture(() => tuneCommand(["reset"]));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("self_score.low_threshold: 5");
    expect(r.stdout).toContain("routing soft preferences: clear");
    expect(r.stdout).toContain("rubric weights: 1.0");
  });

  it("registers `roll tune` as a TS command", async () => {
    registerAll();
    const r = await capture(() => dispatch(["tune", "reset"]).then((d) => d.status));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("self_score.low_threshold");
  });
});
