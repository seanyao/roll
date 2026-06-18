/** US-CLI-013 — `roll cycle <id>`: the vertical trace tape in the terminal. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cycleCommand, cycleTraceJson, findCycle, renderCycleTrace } from "../src/commands/cycle.js";
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
      JSON.stringify({ type: "tool:invoke", cycleId: "20260612-x-0311", invocation: { invocationId: "inv-bash", toolId: "bash", input: { command: "pnpm test" }, caller: { cycleId: "20260612-x-0311" }, policy: { enabled: true }, ts: 1.2 }, declaration: { id: "bash", kind: "bash", title: "Bash" }, ts: 1.2 }),
      JSON.stringify({ type: "tool:result", cycleId: "20260612-x-0311", invocationId: "inv-bash", toolId: "bash", result: { ok: true, meta: { invocationId: "inv-bash", toolId: "bash", caller: { cycleId: "20260612-x-0311" }, startedAt: 1200, endedAt: 13600, durationMs: 12400 } }, ts: 1.3 }),
      JSON.stringify({ type: "tool:invoke", cycleId: "20260612-x-0311", invocation: { invocationId: "inv-browser", toolId: "browser", input: { url: "https://app.test" }, caller: { cycleId: "20260612-x-0311" }, policy: { enabled: true }, ts: 1.4 }, declaration: { id: "browser", kind: "browser", title: "Browser" }, ts: 1.4 }),
      JSON.stringify({ type: "tool:result", cycleId: "20260612-x-0311", invocationId: "inv-browser", toolId: "browser", result: { ok: false, errorCode: "timeout", meta: { invocationId: "inv-browser", toolId: "browser", caller: { cycleId: "20260612-x-0311" }, startedAt: 1400, endedAt: 4400, durationMs: 3000 } }, ts: 1.5 }),
      JSON.stringify({ type: "tool:invoke", cycleId: "", invocation: { invocationId: "inv-doctor", toolId: "bash", input: { command: "roll doctor" }, caller: { cycleId: "" }, policy: { enabled: true }, ts: 1.6 }, declaration: { id: "bash", kind: "bash", title: "Bash" }, ts: 1.6 }),
      JSON.stringify({ type: "cycle:end", cycleId: "20260612-x-0311", outcome: "delivered", cost: { cycleId: "20260612-x-0311", agent: "claude", model: "claude-sonnet", tokensIn: 120000, tokensOut: 22000, estimatedCost: 0.05, revertCount: 0, effectiveCost: 0.05, currency: "USD", toolCosts: [{ toolId: "bash", invocations: 3, durationMs: 21000, failures: 0, estimatedCost: 0, currency: "USD" }, { toolId: "browser", invocations: 1, durationMs: 3000, failures: 1, estimatedCost: 0, currency: "USD" }] }, ts: 1.7 }),
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
    expect(out).toContain('bash "pnpm test" 12s');
    expect(out).toContain('✗ browser "https://app.test" 3.0s timeout');
    expect(out).toContain("tools bash×3(21s) browser×1(3.0s)");
    expect(out).not.toContain("roll doctor");
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

describe("US-DOSSIER-036 --json — AC5/AC7", () => {
  it("AC7: --json carries the SAME row, tape segments and evidence as the human trace", () => {
    const rows = collectCycleLedger(project());
    const row = findCycle(rows, "0311")!;
    const slug = "seanyao/roll";
    const human = stripAnsi(renderCycleTrace(row, "en", slug));
    const j = cycleTraceJson(row, slug) as {
      no: string; verdict: string; storyId: string;
      tape: Array<{ key: string; detail: string; state: string }>;
      evidence: Array<{ label: string; href: string }>;
    };
    // Same identity numbers as the human header line.
    expect(human).toContain(`#${j.no} · ${j.verdict}`);
    expect(human).toContain(`story ${j.storyId}`);
    // Same seven tape segment keys, in order.
    expect(j.tape.map((s) => s.key)).toEqual(["cycle", "story", "build", "peer", "ci", "pr", "end"]);
    // Same evidence hrefs the human trace prints.
    for (const e of j.evidence) expect(human).toContain(e.href);
  });

  it("AC5: cycleCommand --json emits the trace JSON, exit 0", async () => {
    const save = process.cwd();
    process.chdir(project());
    const out: string[] = [];
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => (out.push(s), true)) as typeof process.stdout.write;
    let status: number;
    try {
      status = cycleCommand(["0311", "--json", "--no-color"]);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    expect(status).toBe(0);
    const parsed = JSON.parse(out.join("")) as { no: string; tape: unknown[] };
    expect(parsed.no).toBe("0311");
    expect(parsed.tape.length).toBe(7);
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

describe("kimi pair-review regressions", () => {
  it("unknown flags fail loud", async () => {
    const save = process.cwd();
    process.chdir(project());
    let err = "";
    const se = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
    try {
      expect(cycleCommand(["--foo", "0311"])).toBe(1);
    } finally {
      process.stderr.write = se;
      process.chdir(save);
    }
    expect(err).toContain("unknown flag");
  });

  it("no slug / no story → honest evidence line, never a crash", () => {
    const rows = collectCycleLedger(project());
    const out = stripAnsi(renderCycleTrace({ ...rows[1]!, storyId: "" }, "en"));
    expect(out).toContain("nothing addressable");
  });
});
