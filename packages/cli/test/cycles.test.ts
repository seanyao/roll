/** US-CLI-012 — `roll cycles`: first-class cycle ledger, failures never swallowed. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RollEvent } from "@roll/spec";
import { cyclesCommand, cyclesLedgerJson, renderCyclesLedger, renderCycleDetail, cycleDetailJson, summaryBuckets, reconciledLedger } from "../src/commands/cycles.js";
import { collectCycleLedger, formatBuilderIdentity, type CycleLedgerRow } from "../src/lib/cycle-ledger.js";
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

// ── FIX-1066: agent/model display in compact cycles rows ─────

describe("FIX-1066 — agent/model display in cycles compact rows", () => {
  /** Fixture with explicit agent + model combos. */
  function agentModelProject(): string {
    const p = mkdtempSync(join(tmpdir(), "roll-fix1066-"));
    dirs.push(p);
    mkdirSync(join(p, ".roll", "loop"), { recursive: true });
    const runs = [
      // AC2: Reasonix cycle
      { cycle_id: "20260701-133601-96666", status: "merged", outcome: "delivered", story_id: "FIX-1064", agent: "reasonix", model: "deepseek-flash", ts: "2026-07-01T13:36:01Z", duration_sec: 1090, cost_usd: 0, tokens_in: 127000, tokens_out: 15000 },
      // AC3: Kimi cycle
      { cycle_id: "20260701-130000-96665", status: "merged", outcome: "delivered", story_id: "FIX-1060", agent: "kimi-code", model: "kimi-2.7", ts: "2026-07-01T13:00:00Z", duration_sec: 600, cost_usd: 0.10, tokens_in: 80000, tokens_out: 12000 },
      // Claude with model
      { cycle_id: "20260701-120000-96664", status: "merged", outcome: "delivered", story_id: "FIX-1055", agent: "claude", model: "claude-sonnet-4", ts: "2026-07-01T12:00:00Z", duration_sec: 300, cost_usd: 0.05, tokens_in: 50000, tokens_out: 8000 },
      // AC4: Unknown model (only agent — env var agent, no model field)
      { cycle_id: "20260701-110000-96663", status: "local", outcome: "unpublished", story_id: "FIX-1050", agent: "reasonix", ts: "2026-07-01T11:00:00Z", duration_sec: 120, cost_usd: 0.01, tokens_in: 10000, tokens_out: 1000 },
      // AC6: Unknown agent (agent not matching any well-known name — must still show)
      { cycle_id: "20260701-100000-96662", status: "failed", story_id: "REFACTOR-055", agent: "custom-agi", model: "my-model", ts: "2026-07-01T10:00:00Z", duration_sec: 60, cost_usd: 0, tokens_in: 5000, tokens_out: 500 },
    ];
    writeFileSync(join(p, ".roll", "loop", "runs.jsonl"), runs.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return p;
  }

  it("AC2: Reasonix shows as `reasonix / deepseek-flash`, not bare `deepseek-flash`", () => {
    const p = agentModelProject();
    const rows = collectCycleLedger(p);
    const out = stripAnsi(renderCyclesLedger(rows, "all", "en", NOW));
    expect(out).toContain("reasonix / deepseek-flash");
    // The old bare model name should NOT appear where agent was meant to be
    expect(out).not.toMatch(/^#\S+\s+\S+\s+\S+\s+deepseek-flash\s/m);
  });

  it("AC3: Kimi shows as `kimi-code / kimi-2.7`, not bare `kimi-2.7`", () => {
    const p = agentModelProject();
    const rows = collectCycleLedger(p);
    const out = stripAnsi(renderCyclesLedger(rows, "all", "en", NOW));
    expect(out).toContain("kimi-code / kimi-2.7");
  });

  it("AC4: Missing model shows agent / —", () => {
    const p = agentModelProject();
    const rows = collectCycleLedger(p);
    const out = stripAnsi(renderCyclesLedger(rows, "all", "en", NOW));
    expect(out).toContain("reasonix / —");
  });

  it("AC6: Unknown agent (custom-agi) still shows agent+model, not silently replaced", () => {
    const p = agentModelProject();
    const rows = collectCycleLedger(p);
    const out = stripAnsi(renderCyclesLedger(rows, "all", "en", NOW));
    expect(out).toContain("custom-agi / my-model");
  });

  it("AC1: Claude with model renders `claude / claude-sonnet-4`", () => {
    const p = agentModelProject();
    const rows = collectCycleLedger(p);
    const out = stripAnsi(renderCyclesLedger(rows, "all", "en", NOW));
    expect(out).toContain("claude / claude-sonnet-4");
    // Summary line still shows correctly
    expect(out).toContain("5 cycles");
    expect(out).toContain("3 delivered");
  });

  it("AC5: --json exposes agent and model separately in each row", async () => {
    const p = agentModelProject();
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
    const parsed = JSON.parse(out.join("")) as { rows: Array<{ agent: string; model: string; cycleId: string }> };
    const reasonix = parsed.rows.find((r) => r.agent === "reasonix");
    expect(reasonix).toBeDefined();
    expect(reasonix!.model).toBe("deepseek-flash");
    const kimi = parsed.rows.find((r) => r.agent === "kimi-code");
    expect(kimi).toBeDefined();
    expect(kimi!.model).toBe("kimi-2.7");
    // Empty model field when model is unknown
    const noModel = parsed.rows.find((r) => r.agent === "reasonix" && r.model === "");
    expect(noModel).toBeDefined();
    // No row has agent mixed into model field
    for (const row of parsed.rows) {
      expect(row.model).not.toBe(row.agent);
    }
  });
});

// ── FIX-1067: normalize the REAL raw ledger shape for Builder identity ─────

describe("FIX-1067 — real raw ledger facts normalize to operator-facing Builder identity", () => {
  /** Fixture with the CURRENT REAL raw ledger shape from `.roll/loop/runs.jsonl`:
   *  Kimi rows write raw `agent: "kimi"` + `model: "kimi-code/kimi-for-coding"`,
   *  Reasonix rows write raw `agent: "reasonix"` + `model: "deepseek-flash"`. */
  function realShapeProject(): string {
    const p = mkdtempSync(join(tmpdir(), "roll-fix1067-"));
    dirs.push(p);
    mkdirSync(join(p, ".roll", "loop"), { recursive: true });
    const runs = [
      { cycle_id: "20260701-133601-96666", status: "merged", outcome: "delivered", story_id: "FIX-1064", agent: "reasonix", model: "deepseek-flash", ts: "2026-07-01T13:36:01Z", duration_sec: 1090, cost_usd: 0, tokens_in: 127000, tokens_out: 15000 },
      { cycle_id: "20260701-130000-96665", status: "merged", outcome: "delivered", story_id: "FIX-1060", agent: "kimi", model: "kimi-code/kimi-for-coding", ts: "2026-07-01T13:00:00Z", duration_sec: 600, cost_usd: 0.1, tokens_in: 80000, tokens_out: 12000 },
    ];
    writeFileSync(join(p, ".roll", "loop", "runs.jsonl"), runs.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return p;
  }

  it("AC: raw `kimi` + `kimi-code/kimi-for-coding` renders as `kimi-code / kimi-2.7`", () => {
    const p = realShapeProject();
    const out = stripAnsi(renderCyclesLedger(collectCycleLedger(p), "all", "en", NOW));
    expect(out).toContain("kimi-code / kimi-2.7");
    // The raw internal names must never leak into the operator row.
    expect(out).not.toContain("kimi-code/kimi-for-coding");
    expect(out).not.toMatch(/(^|\s)kimi\s+\//m);
  });

  it("AC: raw Reasonix row still renders as `reasonix / deepseek-flash`", () => {
    const p = realShapeProject();
    const out = stripAnsi(renderCyclesLedger(collectCycleLedger(p), "all", "en", NOW));
    expect(out).toContain("reasonix / deepseek-flash");
  });

  it("AC: --json keeps the RAW agent/model facts (kimi / kimi-code/kimi-for-coding) parseable", () => {
    const p = realShapeProject();
    const json = cyclesLedgerJson(collectCycleLedger(p), "all", NOW) as { rows: Array<{ agent: string; model: string }> };
    const kimi = json.rows.find((r) => r.agent === "kimi");
    expect(kimi).toBeDefined();
    expect(kimi!.model).toBe("kimi-code/kimi-for-coding");
    const reasonix = json.rows.find((r) => r.agent === "reasonix");
    expect(reasonix!.model).toBe("deepseek-flash");
  });

  it("AC: `roll cycle <id>` uses the SAME formatter so identity cannot drift", () => {
    // The centralized formatter is what both surfaces call — verify it directly.
    expect(formatBuilderIdentity("kimi", "kimi-code/kimi-for-coding")).toBe("kimi-code / kimi-2.7");
    expect(formatBuilderIdentity("reasonix", "deepseek-flash")).toBe("reasonix / deepseek-flash");
    expect(formatBuilderIdentity("custom-agi", "my-model")).toBe("custom-agi / my-model");
    expect(formatBuilderIdentity("reasonix", "")).toBe("reasonix / —");
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
    // US-DELIV-012: pending_merge renders under the design vocabulary awaiting_merge.
    expect(out).toContain("1 awaiting_merge");
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

describe("US-DELIV-012 — new delivery states + metrics render", () => {
  const NOW_MS = NOW * 1000;
  function row(overrides: Partial<CycleLedgerRow> & { cycleId: string; verdict: CycleLedgerRow["verdict"] }): CycleLedgerRow {
    return {
      tsSec: NOW - 3600,
      storyId: "US-D",
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
      ...overrides,
    };
  }

  it("renders the new verdict vocabulary: delivered_external, degraded, awaiting_merge", () => {
    const rows = [
      row({ cycleId: "e1", verdict: "delivered_external" }),
      row({ cycleId: "g1", verdict: "degraded", degradedReason: "ci_stuck" }),
      row({ cycleId: "p1", verdict: "pending_merge", awaitingSinceMs: NOW_MS - 3_600_000 }),
    ];
    const out = stripAnsi(renderCyclesLedger(rows, "all", "en", NOW));
    expect(out).toContain("delivered_external"); // the row verdict cell
    expect(out).toContain("degraded");
    expect(out).toContain("1 awaiting_merge"); // summary bucket, design vocabulary
  });

  it("renders the delivery metrics line (external-merge rate / dwell / fan-out waste)", () => {
    const rows = [
      row({ cycleId: "d1", verdict: "delivered" }),
      row({ cycleId: "e1", verdict: "delivered_external" }),
      row({ cycleId: "p1", verdict: "pending_merge", awaitingSinceMs: NOW_MS - 7_200_000 }), // 2h
      row({ cycleId: "s1", verdict: "superseded" }),
    ];
    const out = stripAnsi(renderCyclesLedger(rows, "all", "en", NOW));
    expect(out).toContain("delivery:");
    expect(out).toContain("external-merge 50% (1/2)");
    expect(out).toContain("awaiting_merge 1 (avg dwell 2h)");
    expect(out).toContain("fan-out waste 1");
  });

  it("--json carries the delivery metrics block from the SAME derivation", () => {
    const rows = [
      row({ cycleId: "d1", verdict: "delivered" }),
      row({ cycleId: "e1", verdict: "delivered_external" }),
      row({ cycleId: "s1", verdict: "superseded" }),
    ];
    const json = cyclesLedgerJson(rows, "all", NOW) as {
      delivery: { deliveredExternal: number; externalMergeRate: number | null; fanoutWasteCycles: number };
    };
    expect(json.delivery.deliveredExternal).toBe(1);
    expect(json.delivery.externalMergeRate).toBeCloseTo(0.5, 5);
    expect(json.delivery.fanoutWasteCycles).toBe(1);
  });

  it("omits the metrics line entirely when the window has nothing to report", () => {
    const out = stripAnsi(renderCyclesLedger([row({ cycleId: "f1", verdict: "failed" })], "all", "en", NOW));
    expect(out).not.toContain("delivery:");
  });
});
