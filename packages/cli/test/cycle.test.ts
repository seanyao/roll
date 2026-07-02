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
  delete process.env["ROLL_CYCLE_ACTIVITY_NOW_MS"];
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

function watchProject(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-cycle-watch-"));
  dirs.push(p);
  const rt = join(p, ".roll", "loop");
  mkdirSync(rt, { recursive: true });
  writeFileSync(
    join(rt, "runs.jsonl"),
    JSON.stringify({
      cycle_id: "20260624-watch-12345",
      status: "delivered",
      outcome: "delivered",
      story_id: "US-OBS-027",
      agent: "pi",
      model: "deepseek-v4-pro",
      ts: "2026-06-24T04:00:00Z",
      duration_sec: 90,
    }) + "\n",
  );
  writeFileSync(
    join(rt, "events.ndjson"),
    [
      JSON.stringify({ type: "cycle:start", cycleId: "20260624-watch-12345", storyId: "US-OBS-027", agent: "pi", model: "deepseek-v4-pro", ts: 1_800_000_000 }),
      JSON.stringify({ type: "cycle:phase", cycleId: "20260624-watch-12345", phase: "execute", ts: 1_800_000_010 }),
      JSON.stringify({ type: "cycle:stdout", cycleId: "20260624-watch-12345", data: "heartbeat: building · still working", ts: 1_800_000_020 }),
      JSON.stringify({ type: "cycle:tcr", cycleId: "20260624-watch-12345", commitHash: "abcdef123456", message: "tcr: add cycle watch once", ts: 1_800_000_030 }),
      JSON.stringify({ type: "attest:gate", cycleId: "20260624-watch-12345", verdict: "produced", reasons: ["fresh acceptance report present"], ts: 1_800_000_040 }),
      JSON.stringify({ type: "cycle:end", cycleId: "20260624-watch-12345", outcome: "delivered", cost: { cycleId: "20260624-watch-12345", agent: "pi", model: "deepseek-v4-pro", tokensIn: 10, tokensOut: 5, estimatedCost: 0.01, revertCount: 0, effectiveCost: 0.01 }, ts: 1_800_000_050 }),
    ].join("\n") + "\n",
  );
  return p;
}

describe("US-OBS-027 — roll cycle watch", () => {
  it("--once replays one cycle as a deterministic ActivitySignal frame", () => {
    const save = process.cwd();
    process.chdir(watchProject());
    let out = "";
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
    try {
      expect(cycleCommand(["watch", "20260624-watch-12345", "--once", "--no-color"])).toBe(0);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    const text = stripAnsi(out);
    expect(text).toContain("cycle 20260624-watch-12345");
    expect(text).toContain("story US-OBS-027");
    expect(text).toContain("agent pi");
    expect(text).toContain("outcome delivered");
    expect(text).toContain("phase · execute");
    expect(text).toContain("TCR abcdef123");
    expect(text).toContain("Attest gate · produced");
  });

  it("US-OBS-028: --once prefers persisted ActivitySignal replay with tool granularity", () => {
    const p = watchProject();
    const rt = join(p, ".roll", "loop");
    writeFileSync(
      join(rt, "cycle-20260624-watch-12345.signals.jsonl"),
      [
        JSON.stringify({ ts: 1_800_000_000_000, cycleId: "20260624-watch-12345", seg: "cycle", kind: "lifecycle", tier: "A", summary: "cycle start" }),
        JSON.stringify({ ts: 1_800_000_001_000, cycleId: "20260624-watch-12345", seg: "build", kind: "tool_call", tier: "B", summary: "tool_call Bash", detail: "pnpm test", ref: "Bash" }),
        JSON.stringify({ ts: 1_800_000_002_000, cycleId: "20260624-watch-12345", seg: "build", kind: "tool_result", tier: "B", summary: "tool_result Bash", detail: "exit 0", result: "pass", ref: "Bash" }),
      ].join("\n") + "\n",
    );
    const save = process.cwd();
    process.chdir(p);
    let out = "";
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
    try {
      expect(cycleCommand(["watch", "20260624-watch-12345", "--once", "--no-color"])).toBe(0);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    const text = stripAnsi(out);
    expect(text).toContain("call tool_call Bash");
    expect(text).toContain("pnpm test");
    expect(text).toContain("result tool_result Bash");
    expect(text).toContain("exit 0");
  });

  it("--once without an id replays the latest cycle when no cycle is running", () => {
    const save = process.cwd();
    process.chdir(watchProject());
    let out = "";
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
    try {
      expect(cycleCommand(["watch", "--once", "--no-color"])).toBe(0);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    expect(stripAnsi(out)).toContain("cycle 20260624-watch-12345");
  });

  it("US-OBS-045: --once surfaces accepted evaluator score from pair:score events", () => {
    const p = mkdtempSync(join(tmpdir(), "roll-cycle-watch-score-"));
    dirs.push(p);
    const rt = join(p, ".roll", "loop");
    mkdirSync(rt, { recursive: true });
    writeFileSync(
      join(rt, "runs.jsonl"),
      JSON.stringify({
        cycle_id: "20260630-210059-58201",
        status: "delivered",
        outcome: "delivered",
        story_id: "FIX-1050",
        agent: "kimi",
        model: "deepseek-v4-pro",
        ts: "2026-06-30T21:00:00Z",
        duration_sec: 300,
      }) + "\n",
    );
    writeFileSync(
      join(rt, "events.ndjson"),
      [
        JSON.stringify({ type: "cycle:start", cycleId: "20260630-210059-58201", storyId: "FIX-1050", agent: "kimi", model: "deepseek-v4-pro", ts: 1_700_000_000 }),
        JSON.stringify({ type: "pair:consult", cycleId: "20260630-210059-58201", peer: "claude", durationMs: 65_000, outcome: "reviewed", ts: 1_700_000_010 }),
        JSON.stringify({ type: "pair:score", cycleId: "20260630-210059-58201", peer: "pi", score: 9, verdict: "good", cost: 0.05, stage: "score", ts: 1_700_000_020 }),
        JSON.stringify({ type: "attest:gate", cycleId: "20260630-210059-58201", verdict: "produced", reasons: ["review-score good 9/10 present"], ts: 1_700_000_030 }),
        JSON.stringify({ type: "pr:open", prNumber: 1111, storyId: "FIX-1050", ts: 1_700_000_040 }),
        JSON.stringify({ type: "cycle:end", cycleId: "20260630-210059-58201", outcome: "published_pending_merge", cost: { cycleId: "20260630-210059-58201", agent: "kimi", model: "deepseek-v4-pro", tokensIn: 10, tokensOut: 5, estimatedCost: 0.01, revertCount: 0, effectiveCost: 0.01 }, ts: 1_700_000_050 }),
      ].join("\n") + "\n",
    );
    const save = process.cwd();
    process.chdir(p);
    let out = "";
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
    try {
      expect(cycleCommand(["watch", "20260630-210059-58201", "--once", "--no-color"])).toBe(0);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    const text = stripAnsi(out);
    expect(text).toContain("cycle 20260630-210059-58201");
    expect(text).toContain("score pi 9/good");
    expect(text).toContain("Attest gate · produced");
    expect(text).toContain("outcome published_pending_merge");
  });

  it("without a running cycle, follow mode fails with an explicit message instead of blank output", () => {
    const save = process.cwd();
    process.chdir(watchProject());
    let err = "";
    const se = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
    try {
      expect(cycleCommand(["watch"])).toBe(1);
    } finally {
      process.stderr.write = se;
      process.chdir(save);
    }
    expect(err).toContain("no running cycle");
  });
});

function activityProject(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-cycle-activity-"));
  dirs.push(p);
  const rt = join(p, ".roll", "loop");
  mkdirSync(rt, { recursive: true });
  writeFileSync(
    join(rt, "runs.jsonl"),
    JSON.stringify({
      cycle_id: "20260630-210059-58201",
      status: "running",
      story_id: "FIX-1050",
      agent: "kimi",
      ts: "2026-06-30T21:00:00Z",
    }) + "\n",
  );
  return p;
}

function writeActivityEvents(p: string, events: unknown[]): void {
  writeFileSync(join(p, ".roll", "loop", "events.ndjson"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

describe("US-OBS-042 — roll cycle <id> --activity", () => {
  it("explains an active zero-TCR cycle", () => {
    const p = activityProject();
    writeActivityEvents(p, [
      { type: "cycle:start", cycleId: "20260630-210059-58201", storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "cycle:stdout", cycleId: "20260630-210059-58201", data: "micro-step: A1 parser+tests · evidence: unit tests green · scope: packages/core/src/parser.ts", ts: 60_000 },
      { type: "cycle:stdout", cycleId: "20260630-210059-58201", data: "tool_call: Edit · packages/core/src/parser.ts", ts: 130_000 },
    ]);
    process.env["ROLL_CYCLE_ACTIVITY_NOW_MS"] = String(200_000);
    const save = process.cwd();
    process.chdir(p);
    let out = "";
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
    try {
      expect(cycleCommand(["20260630-210059-58201", "--activity", "--no-color"])).toBe(0);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    expect(out).toContain("cycle 20260630-210059-58201");
    expect(out).toContain("classification active");
    expect(out).toContain("micro-step A1");
    expect(out).toContain("0 TCR");
  });

  it("surfaces green-uncommitted advisory state", () => {
    const p = activityProject();
    writeActivityEvents(p, [
      { type: "cycle:start", cycleId: "20260630-210059-58201", storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "cycle:stdout", cycleId: "20260630-210059-58201", data: "test:green · parser tests pass", ts: 120_000 },
    ]);
    process.env["ROLL_CYCLE_ACTIVITY_NOW_MS"] = String(180_000);
    const save = process.cwd();
    process.chdir(p);
    let out = "";
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
    try {
      expect(cycleCommand(["20260630-210059-58201", "--activity", "--no-color"])).toBe(0);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    expect(out).toContain("test:green");
    expect(out).toContain("green-uncommitted");
    expect(out).toContain("(advisory)");
  });

  it("surfaces oversized advisory state from durable events", () => {
    const p = activityProject();
    writeActivityEvents(p, [
      { type: "cycle:start", cycleId: "20260630-210059-58201", storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "action:started", cycleId: "20260630-210059-58201", actionId: "A1", summary: "parser+tests", expectedEvidence: "unit tests green", fileAreaScope: ["parser"], ts: 60_000 },
      { type: "action:oversized", cycleId: "20260630-210059-58201", actionId: "A1", filesTouched: 12, contractAreas: 4, thresholdFiles: 10, thresholdAreas: 3, ts: 190_000 },
    ]);
    process.env["ROLL_CYCLE_ACTIVITY_NOW_MS"] = String(200_000);
    const save = process.cwd();
    process.chdir(p);
    let out = "";
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
    try {
      expect(cycleCommand(["20260630-210059-58201", "--activity", "--no-color"])).toBe(0);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    expect(out).toContain("action oversized");
    expect(out).toContain("12 files / 4 areas");
    expect(out).toContain("(advisory)");
  });

  it("renders dynamic split suggestion and queued follow-up references", () => {
    const p = activityProject();
    writeActivityEvents(p, [
      { type: "cycle:start", cycleId: "20260630-210059-58201", storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "action:started", cycleId: "20260630-210059-58201", actionId: "A1", summary: "reasonix footer parser", expectedEvidence: "parser tests green", fileAreaScope: ["parser"], ts: 60_000 },
      { type: "test:green", cycleId: "20260630-210059-58201", actionId: "A1", source: "vitest", summary: "parser tests pass", ts: 120_000 },
      { type: "green-uncommitted", cycleId: "20260630-210059-58201", actionId: "A1", since: 120_000, durationSec: 60, ts: 180_000 },
      { type: "action:oversized", cycleId: "20260630-210059-58201", actionId: "A1", filesTouched: 12, contractAreas: 4, thresholdFiles: 10, thresholdAreas: 3, ts: 190_000 },
      { type: "followup:queued", cycleId: "20260630-210059-58201", actionId: "A1", followupId: "US-OBS-999", title: "Runtime action-boundary enforcement", reason: "deferred boundary enforcement", ts: 195_000 },
    ]);
    process.env["ROLL_CYCLE_ACTIVITY_NOW_MS"] = String(200_000);
    const save = process.cwd();
    process.chdir(p);
    let out = "";
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
    try {
      expect(cycleCommand(["20260630-210059-58201", "--activity", "--no-color"])).toBe(0);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    expect(out).toContain("split suggested A1");
    expect(out).toContain("commit current green work");
    expect(out).toContain("follow-up US-OBS-999");
    expect(out).toContain("deferred scope is not delivered by this card");
  });

  it("emits machine-readable JSON with --activity --json", () => {
    const p = activityProject();
    writeActivityEvents(p, [
      { type: "cycle:start", cycleId: "20260630-210059-58201", storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "cycle:stdout", cycleId: "20260630-210059-58201", data: "test:red · parser fails", ts: 120_000 },
      { type: "green-uncommitted", cycleId: "20260630-210059-58201", actionId: "A1", since: 120_000, durationSec: 60, ts: 180_000 },
      { type: "action:oversized", cycleId: "20260630-210059-58201", actionId: "A1", filesTouched: 12, contractAreas: 4, thresholdFiles: 10, thresholdAreas: 3, ts: 190_000 },
    ]);
    process.env["ROLL_CYCLE_ACTIVITY_NOW_MS"] = String(180_000);
    const save = process.cwd();
    process.chdir(p);
    let out = "";
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
    try {
      expect(cycleCommand(["20260630-210059-58201", "--activity", "--json", "--no-color"])).toBe(0);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    const parsed = JSON.parse(out) as {
      cycleId: string;
      classification: string;
      testTransition?: { state: string };
      history: Array<{ type: string }>;
      oversizedAction?: { filesTouched: number };
    };
    expect(parsed.cycleId).toBe("20260630-210059-58201");
    expect(parsed.classification).toBe("active");
    expect(parsed.testTransition?.state).toBe("red");
    expect(parsed.history.map((h) => h.type)).toContain("green-uncommitted");
    expect(parsed.history.map((h) => h.type)).toContain("action:oversized");
    expect(parsed.oversizedAction?.filesTouched).toBe(12);
  });
});
