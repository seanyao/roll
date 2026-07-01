/** US-CLI-012 — `roll cycles`: first-class cycle ledger, failures never swallowed. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RollEvent } from "@roll/spec";
import { cyclesCommand, cyclesLedgerJson, renderCyclesLedger, renderCycleDetail, cycleDetailJson, summaryBuckets, reconciledLedger } from "../src/commands/cycles.js";
import { collectCycleLedger, type CycleLedgerRow } from "../src/lib/cycle-ledger.js";
import { stripAnsi } from "../src/render.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env["ROLL_LANG"];
});

const NOW = Math.floor(Date.parse("2026-06-13T00:00:00Z") / 1000);

function project(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-cycles-"));
  dirs.push(p);
  mkdirSync(join(p, ".roll", "loop"), { recursive: true });
  const rows = [
    { cycle_id: "20260612-x-0312", status: "reverted", story_id: "FIX-242", agent: "kimi", ts: "2026-06-12T20:00:00Z", duration_sec: 242, cost_usd: 0.03, tokens_in: 80000, tokens_out: 6000 },
    { cycle_id: "20260612-x-0311", status: "merged", outcome: "delivered", story_id: "FIX-241", agent: "claude", ts: "2026-06-12T19:00:00Z", duration_sec: 500, cost_usd: 0.05, tokens_in: 120000, tokens_out: 22000 },
    { cycle_id: "20260612-x-0310", status: "failed", story_id: "US-META-010", agent: "codex", ts: "2026-06-12T18:00:00Z", duration_sec: 191, cost_usd: 0.02, tokens_in: 60000, tokens_out: 4000 },
    { cycle_id: "20260612-x-0305", status: "blocked", story_id: "IDEA-001", agent: "claude", ts: "2026-06-12T17:00:00Z", duration_sec: 72, cost_usd: 0.01, tokens_in: 20000, tokens_out: 2000 },
    { cycle_id: "20260601-x-0001", status: "merged", outcome: "delivered", story_id: "OLD-1", agent: "pi", ts: "2026-06-01T00:00:00Z", duration_sec: 60, cost_usd: 9 },
  ];
  writeFileSync(join(p, ".roll", "loop", "runs.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

function renderAt(p: string, since: string, lang: "en" | "zh"): string {
  return stripAnsi(renderCyclesLedger(collectCycleLedger(p), since, lang, NOW));
}

describe("roll cycles — US-CLI-012", () => {
  it("AC2/AC3: row format + summary where failed = failed+reverted+blocked", () => {
    const out = renderAt(project(), "3d", "en");
    expect(out).toContain("#0311");
    expect(out).toContain("delivered");
    expect(out).toContain("reverted");
    expect(out).toMatch(/4 cycles · 1 delivered · 3 failed\/reverted\/blocked · \$0\.11/);
  });

  it("AC1: window filter — all includes the old cycle, 3d does not", () => {
    const p = project();
    expect(renderAt(p, "all", "en")).toContain("OLD-1");
    expect(renderAt(p, "3d", "en")).not.toContain("OLD-1");
  });

  it("AC4: tail hint points at the newest cycle", () => {
    const out = renderAt(project(), "3d", "en");
    expect(out).toContain("→ roll cycle 0312");
  });

  it("AC5: en/zh snapshots (scrubbed of color)", () => {
    const p = project();
    expect(renderAt(p, "3d", "en")).toMatchSnapshot();
    expect(renderAt(p, "3d", "zh")).toMatchSnapshot();
  });

  // US-DOSSIER-036 AC5/AC7: --json is the SAME windowed computation as human.
  it("AC7: --json matches the human view (same cycles/delivered/failed/cost/rows)", () => {
    const p = project();
    const rows = collectCycleLedger(p);
    const human = stripAnsi(renderCyclesLedger(rows, "3d", "en", NOW));
    const json = cyclesLedgerJson(rows, "3d", NOW) as {
      cycles: number; delivered: number; failed: number; costByCurrency: Record<string, number>;
      rows: Array<{ no: string; verdict: string }>;
    };
    // Same summary numbers the human line prints (4 cycles · 1 delivered · 3 …).
    expect(json.cycles).toBe(4);
    expect(json.delivered).toBe(1);
    expect(json.failed).toBe(3);
    // FIX-361: cost is now per-currency.
    expect(json.costByCurrency["USD"] ?? 0).toBeCloseTo(0.11);
    // Every JSON row's handle appears in the human render, in the same order.
    const humanHandles = [...human.matchAll(/#(\d+)/g)].map((m) => m[1]);
    expect(json.rows.map((r) => r.no)).toEqual(humanHandles);
  });

  it("AC5: cyclesCommand --json emits the windowed ledger, exit 0", async () => {
    const save = process.cwd();
    process.chdir(project());
    const out: string[] = [];
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => (out.push(s), true)) as typeof process.stdout.write;
    let status: number;
    try {
      status = cyclesCommand(["--since", "all", "--json", "--no-color"]);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    expect(status).toBe(0);
    const parsed = JSON.parse(out.join("")) as { since: string; cycles: number };
    expect(parsed.since).toBe("all");
    expect(parsed.cycles).toBe(5);
  });

  it("FIX-1050: --json exposes usageUnknownReason when the runs row carries one", async () => {
    const p = mkdtempSync(join(tmpdir(), "roll-cycles-"));
    dirs.push(p);
    mkdirSync(join(p, ".roll", "loop"), { recursive: true });
    writeFileSync(
      join(p, ".roll", "loop", "runs.jsonl"),
      JSON.stringify({
        cycle_id: "20260630-191612-76188",
        status: "failed",
        outcome: "failed",
        story_id: "REFACTOR-055",
        agent: "agy",
        model: "gemini-2.5-pro",
        ts: "2026-06-30T19:16:12Z",
        duration_sec: 120,
        usage_unknown: true,
        usage_unknown_reason: "agy_stdout_no_usage",
      }) + "\n",
    );
    const save = process.cwd();
    process.chdir(p);
    const out: string[] = [];
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => (out.push(s), true)) as typeof process.stdout.write;
    let status: number;
    try {
      status = cyclesCommand(["--since", "all", "--json", "--no-color"]);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    expect(status).toBe(0);
    const parsed = JSON.parse(out.join("")) as { rows: Array<{ usageUnknownReason?: string; cost: string; tokens: string }> };
    const row = parsed.rows[0];
    expect(row.cost).toBe("?");
    expect(row.tokens).toBe("?");
    expect(row.usageUnknownReason).toBe("agy_stdout_no_usage");
  });

  it("US-LOOP-076: --detail needs a cycle id (loud fail)", async () => {
    const save = process.cwd();
    process.chdir(project());
    let err = "";
    const se = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
    try {
      expect(cyclesCommand(["--detail"])).toBe(1);
    } finally {
      process.stderr.write = se;
      process.chdir(save);
    }
    expect(err).toContain("--detail needs a cycle id");
  });
});

// ── FIX-1064: delivery projection keyed by cycle ID, not story ID ─────

describe("FIX-1064 — delivery projection is cycle-ID-keyed, not story-ID-keyed", () => {
  /** Build a project with two cycles for the same story: older unpublished
   *  cycle + newer delivered cycle. Write delivery records that only list the
   *  newer cycle as a `done` deliverer. The older cycle must NOT show as
   *  delivered. */
  function dualCycleProject(): string {
    const p = mkdtempSync(join(tmpdir(), "roll-fix1064-"));
    dirs.push(p);
    mkdirSync(join(p, ".roll", "loop"), { recursive: true });
    // Two cycles for the same story: old unpublished (local), new delivered (merged)
    const runs = [
      { cycle_id: "20260701-083818-66315", status: "local", outcome: "unpublished", story_id: "FIX-1064-story", agent: "codex", ts: "2026-07-01T08:38:18Z", duration_sec: 120, cost_usd: 0.02, tokens_in: 40000, tokens_out: 3000 },
      { cycle_id: "20260701-085728-49332", status: "merged", outcome: "delivered", story_id: "FIX-1064-story", agent: "claude", ts: "2026-07-01T08:57:28Z", duration_sec: 300, cost_usd: 0.05, tokens_in: 100000, tokens_out: 18000 },
    ];
    writeFileSync(join(p, ".roll", "loop", "runs.jsonl"), runs.map((r) => JSON.stringify(r)).join("\n") + "\n");
    // Delivery records: only the NEWER cycle has a `done` delivery record
    const deliveries = [
      { storyId: "FIX-1064-story", cycleId: "20260701-085728-49332", lifecycleState: "done", prNumber: { present: false, reason: "not_recorded" }, prUrl: { present: false, reason: "not_recorded" }, mergedAt: { present: false, reason: "not_recorded" }, mergeCommit: { present: false, reason: "not_recorded" }, recordedAt: Date.parse("2026-07-01T09:00:00Z") },
    ];
    writeFileSync(join(p, ".roll", "loop", "deliveries.jsonl"), deliveries.map((d) => JSON.stringify(d)).join("\n") + "\n");
    return p;
  }

  it("AC1: only the delivering cycle shows as delivered; old unpublished keeps its own verdict", () => {
    const p = dualCycleProject();
    // Use the full reconciliation pipeline (same as cyclesCommand)
    const rows = reconciledLedger(p);
    const oldCycle = rows.find((r) => r.cycleId === "20260701-083818-66315");
    expect(oldCycle).toBeDefined();
    expect(oldCycle!.verdict).toBe("unpublished"); // reconciled: still unpublished
    const newCycle = rows.find((r) => r.cycleId === "20260701-085728-49332");
    expect(newCycle).toBeDefined();
    expect(newCycle!.verdict).toBe("delivered"); // reconciled: still delivered
  });

  it("AC2: rendered output — old cycle keeps unpublished, new shows delivered", () => {
    const p = dualCycleProject();
    // Use the full reconciliation pipeline (same as cyclesCommand)
    const rows = reconciledLedger(p);
    const out = stripAnsi(renderCyclesLedger(rows, "all", "en", NOW));
    // New cycle is delivered
    expect(out).toContain("delivered");
    // Old cycle keeps unpublished (not delivered!)
    expect(out).toContain("unpublished");
    // Summary shows 2 cycles · 1 delivered · 0 failed · 1 unpublished
    expect(out).toContain("2 cycles");
    expect(out).toContain("1 delivered");
    expect(out).toContain("1 unpublished");
  });

  it("AC3: --json exposes per-cycle verdicts unchanged after reconcile", () => {
    const p = dualCycleProject();
    // Use the full reconciliation pipeline (same as cyclesCommand)
    const rows = reconciledLedger(p);
    const json = cyclesLedgerJson(rows, "all", NOW) as {
      cycles: number; rows: Array<{ cycleId: string; verdict: string }>;
    };
    expect(json.cycles).toBe(2);
    const oldRow = json.rows.find((r) => r.cycleId === "20260701-083818-66315");
    expect(oldRow).toBeDefined();
    expect(oldRow!.verdict).toBe("unpublished");
    const newRow = json.rows.find((r) => r.cycleId === "20260701-085728-49332");
    expect(newRow).toBeDefined();
    expect(newRow!.verdict).toBe("delivered");
  });

  it("AC4: cyclesCommand --json agrees with reconciledLedger", async () => {
    const p = dualCycleProject();
    const save = process.cwd();
    process.chdir(p);
    const out: string[] = [];
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => (out.push(s), true)) as typeof process.stdout.write;
    let status: number;
    try {
      status = cyclesCommand(["--since", "all", "--json", "--no-color"]);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    expect(status).toBe(0);
    const parsed = JSON.parse(out.join("")) as {
      cycles: number;
      rows: Array<{ cycleId: string; verdict: string }>;
    };
    expect(parsed.cycles).toBe(2);
    const oldRow = parsed.rows.find((r) => r.cycleId === "20260701-083818-66315");
    expect(oldRow).toBeDefined();
    expect(oldRow!.verdict).toBe("unpublished");
    const newRow = parsed.rows.find((r) => r.cycleId === "20260701-085728-49332");
    expect(newRow).toBeDefined();
    expect(newRow!.verdict).toBe("delivered");
  });
});

describe("FIX-337 (AC2) — summaryBuckets: total === sum(buckets), every non-zero bucket shown", () => {
  // A hand-built ledger that carries EVERY verdict the summary can show, so the
  // old `5 delivered · 20 failed → 25 ≠ 28` divergence (an unpublished /
  // superseded cycle hiding in neither figure) is provably impossible.
  function row(verdict: CycleLedgerRow["verdict"]): CycleLedgerRow {
    return {
      cycleId: `c-${verdict}`,
      tsSec: NOW - 3600,
      verdict,
      storyId: "",
      agent: "claude",
      model: "claude",
      tokens: "—",
      cost: "—",
      toolSummary: "",
      toolCosts: [],
      toolTimeline: [],
      duration: "—",
      tape: [],
      evidence: [],
    };
  }

  const mixed: CycleLedgerRow[] = [
    row("delivered"),
    row("pending_merge"),
    row("unpublished"),
    row("superseded"),
    row("failed"),
    row("reverted"), // folds into the failed cluster
    row("blocked"), // folds into the failed cluster
    row("idle"),
    row("unknown"),
  ];

  it("total equals the sum of every displayed bucket (failed cluster folded)", () => {
    const { total, parts } = summaryBuckets(mixed);
    expect(total).toBe(mixed.length); // 9 rows
    // the failed cluster (failed+reverted+blocked) is ONE part with count 3.
    const summed = parts.reduce((a, p) => a + p.count, 0);
    expect(summed).toBe(total); // ← the invariant the AC names
    expect(parts.find((p) => p.verdict === "failed")?.count).toBe(3);
    // reverted/blocked are never their own parts — they fold into `failed`.
    expect(parts.some((p) => p.verdict === "reverted")).toBe(false);
    expect(parts.some((p) => p.verdict === "blocked")).toBe(false);
  });

  it("the render lists EVERY non-zero bucket (delivered/pending_merge/unpublished/superseded/failed/idle/unknown)", () => {
    const out = stripAnsi(renderCyclesLedger(mixed, "all", "en", NOW));
    expect(out).toContain("9 cycles");
    expect(out).toContain("1 delivered");
    expect(out).toContain("1 pending_merge");
    expect(out).toContain("1 unpublished");
    expect(out).toContain("1 superseded");
    expect(out).toContain("3 failed/reverted/blocked");
    expect(out).toContain("1 idle");
    expect(out).toContain("1 unknown");
  });

  it("--json exposes every bucket and they sum to cycles", () => {
    const json = cyclesLedgerJson(mixed, "all", NOW) as { cycles: number; buckets: Record<string, number> };
    expect(json.cycles).toBe(9);
    const summed = Object.values(json.buckets).reduce((a, b) => a + b, 0);
    expect(summed).toBe(json.cycles); // bucketCounts folds unknowns → never under-counts
    expect(json.buckets["superseded"]).toBe(1);
    expect(json.buckets["unpublished"]).toBe(1);
  });

  it("a zero bucket is omitted from the human line (only non-zero shown)", () => {
    const out = stripAnsi(renderCyclesLedger([row("delivered"), row("delivered")], "all", "en", NOW));
    expect(out).toContain("2 delivered");
    expect(out).not.toContain("superseded");
    expect(out).not.toContain("unpublished");
    expect(out).not.toContain("failed");
  });
});

describe("roll cycles --detail — US-LOOP-076 build-phase timeline", () => {
  const CYCLE = "20260615-x-0312";
  function buildEvents(): RollEvent[] {
    // A "37min / 2-commit" shape: a long quiet build with two TCR commits + a
    // runner-observed heartbeat — exactly the anomaly the detail view exposes.
    return [
      { type: "cycle:start", cycleId: CYCLE, storyId: "FIX-284", agent: "codex", model: "gpt-5", ts: 1000 },
      { type: "cycle:phase", cycleId: CYCLE, phase: "execute", ts: 1001 },
      { type: "cycle:stdout", cycleId: CYCLE, data: "heartbeat: building · still working (1) · 18m quiet · 0 tcr so far", ts: 1000 + 18 * 60 },
      { type: "cycle:tcr", cycleId: CYCLE, commitHash: "aaa1112223", message: "tcr: red test", ts: 1000 + 30 * 60 },
      { type: "cycle:tcr", cycleId: CYCLE, commitHash: "bbb2223334", message: "tcr: green impl", ts: 1000 + 37 * 60 },
      { type: "cycle:end", cycleId: CYCLE, outcome: "delivered", cost: { cycleId: CYCLE, agent: "codex", model: "gpt-5", tokensIn: 0, tokensOut: 0, estimatedCost: 0, revertCount: 0, effectiveCost: 0 }, ts: 1000 + 38 * 60 },
    ];
  }

  it("renders per-commit timing, the heartbeat, and a span/TCR summary", () => {
    const out = stripAnsi(renderCycleDetail(buildEvents(), CYCLE, "en"));
    expect(out).toContain("#0312");
    expect(out).toContain("build-phase timeline");
    expect(out).toContain("tcr");
    expect(out).toContain("red test");
    expect(out).toContain("build:heartbeat");
    // 37min between cycle:start and the 2nd commit → "37:xx" offset shows the anomaly.
    expect(out).toContain("38:00 span · 2 TCR commits · 1 heartbeats");
  });

  it("empty events → an honest 'no events' line, never a crash", () => {
    const out = stripAnsi(renderCycleDetail([], CYCLE, "en"));
    expect(out).toContain("no events recorded");
  });

  it("--json mirrors the render (same span/tcrCount/timeline)", () => {
    const j = cycleDetailJson(buildEvents(), CYCLE) as { spanSec: number; tcrCount: number; heartbeats: number; timeline: unknown[] };
    expect(j.spanSec).toBe(38 * 60);
    expect(j.tcrCount).toBe(2);
    expect(j.heartbeats).toBe(1);
    // start + phase + heartbeat + 2×tcr + end = 6 entries.
    expect(j.timeline.length).toBe(6);
  });

  it("US-LOOP-043: detail order uses observed tcr ts, not old commitTs", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE, storyId: "FIX-284", agent: "codex", model: "gpt-5", ts: 10_000 },
      { type: "cycle:tcr", cycleId: CYCLE, commitHash: "old1112223", message: "tcr: observed now", ts: 10_500, commitTs: 1_000 },
      { type: "cycle:end", cycleId: CYCLE, outcome: "delivered", cost: { cycleId: CYCLE, agent: "codex", model: "gpt-5", tokensIn: 0, tokensOut: 0, estimatedCost: 0, revertCount: 0, effectiveCost: 0 }, ts: 11_000 },
    ];
    const j = cycleDetailJson(events, CYCLE) as { timeline: Array<{ marker: string; offsetSec: number }> };
    expect(j.timeline.map((e) => [e.marker, e.offsetSec])).toEqual([
      ["cycle:start", 0],
      ["tcr", 500],
      ["cycle:end", 1000],
    ]);
  });

  it("cyclesCommand --detail reads events.ndjson and prints the timeline (exit 0)", async () => {
    const p = mkdtempSync(join(tmpdir(), "roll-cyc-detail-"));
    dirs.push(p);
    mkdirSync(join(p, ".roll", "loop"), { recursive: true });
    writeFileSync(join(p, ".roll", "loop", "runs.jsonl"), JSON.stringify({ cycle_id: CYCLE, status: "merged", outcome: "delivered", story_id: "FIX-284", agent: "codex", ts: "2026-06-15T10:00:00Z", duration_sec: 2280 }) + "\n");
    writeFileSync(join(p, ".roll", "loop", "events.ndjson"), buildEvents().map((e) => JSON.stringify(e)).join("\n") + "\n");
    const save = process.cwd();
    process.chdir(p);
    const out: string[] = [];
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => (out.push(s), true)) as typeof process.stdout.write;
    let status: number;
    try {
      status = cyclesCommand(["--detail", "0312", "--no-color"]);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    expect(status).toBe(0);
    const text = out.join("");
    expect(text).toContain("build-phase timeline");
    expect(text).toContain("2 TCR commits");
  });

  it("AC1: illegal --since fails loud", async () => {
    const save = process.cwd();
    process.chdir(project());
    let err = "";
    const se = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
    try {
      expect(cyclesCommand(["--since", "2w"])).toBe(1);
    } finally {
      process.stderr.write = se;
      process.chdir(save);
    }
    expect(err).toContain("illegal --since");
  });
});
