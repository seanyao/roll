/** US-DOSSIER-013 — cycle ledger VM + verdict vocabulary + tape facts. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectCycleLedger, ledgerFailedCount, ledgerVerdict } from "../src/lib/cycle-ledger.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(rows: object[], events: object[] = []): string {
  const p = mkdtempSync(join(tmpdir(), "roll-cyl-"));
  dirs.push(p);
  mkdirSync(join(p, ".roll", "loop"), { recursive: true });
  writeFileSync(join(p, ".roll", "loop", "runs.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  if (events.length > 0) writeFileSync(join(p, ".roll", "loop", "events.ndjson"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return p;
}

describe("ledgerVerdict — AC4: the CLI's vocabulary", () => {
  it("maps statuses/outcomes honestly", () => {
    expect(ledgerVerdict("merged", "delivered")).toBe("delivered");
    expect(ledgerVerdict("reverted", "")).toBe("reverted");
    expect(ledgerVerdict("failed", "failed")).toBe("failed");
    expect(ledgerVerdict("blocked", "blocked")).toBe("blocked");
    expect(ledgerVerdict("aborted", "aborted_no_delivery")).toBe("failed");
    expect(ledgerVerdict("idle", "idle_no_work")).toBe("idle");
    expect(ledgerVerdict("", "")).toBe("unknown");
  });
});

describe("collectCycleLedger", () => {
  it("builds rows newest-first with telemetry and a seven-segment tape", () => {
    const p = project(
      [
        { cycle_id: "c1", status: "merged", outcome: "delivered", story_id: "US-X-1", agent: "claude", ts: "2026-06-12T01:00:00Z", duration_sec: 95, cost_usd: 0.42, tokens_in: 1200, tokens_out: 400, tcr_count: 5, merge_commit: "abc" },
        { cycle_id: "c2", status: "failed", outcome: "failed", story_id: "US-X-2", agent: "pi", ts: "2026-06-12T02:00:00Z", duration_sec: 30 },
      ],
      [
        { type: "peer:gate", cycleId: "c1", verdict: "consulted", reasons: [], ts: 1 },
        { type: "pair:verdict", cycleId: "c1", peer: "kimi", verdict: "refine", findings: 2, cost: 0.1, stage: "code", ts: 2 },
        { type: "attest:gate", cycleId: "c1", verdict: "produced", reasons: [], ts: 3 },
        { type: "pr:merge", prNumber: 123, storyId: "US-X-1", ts: 4 },
      ],
    );
    const rows = collectCycleLedger(p);
    expect(rows.map((r) => r.cycleId)).toEqual(["c2", "c1"]); // newest first
    const c1 = rows[1]!;
    expect(c1.verdict).toBe("delivered");
    expect(c1.tokens).toBe("1k/400");
    expect(c1.cost).toBe("$0.42");
    expect(c1.duration).toBe("1m35s");
    expect(c1.tape.map((s) => s.key)).toEqual(["cycle", "story", "build", "peer", "ci", "pr", "end"]);
    expect(c1.tape[2]?.detail).toBe("5 commits");
    expect(c1.tape[3]?.detail).toBe("refine");
    expect(c1.tape[4]?.detail).toBe("attest ✓");
    expect(c1.tape[5]?.detail).toBe("#123 merged");
    expect(c1.tape[6]?.detail).toBe("delivered");
  });

  it("AC2 regression: failed count = failed + reverted + blocked", () => {
    const p = project([
      { cycle_id: "a", status: "failed", ts: "2026-06-12T01:00:00Z" },
      { cycle_id: "b", status: "reverted", ts: "2026-06-12T02:00:00Z" },
      { cycle_id: "c", status: "blocked", ts: "2026-06-12T03:00:00Z" },
      { cycle_id: "d", status: "merged", outcome: "delivered", ts: "2026-06-12T04:00:00Z" },
    ]);
    const rows = collectCycleLedger(p);
    expect(ledgerFailedCount(rows)).toBe(3);
  });

  it("honest dashes when telemetry is missing", () => {
    const p = project([{ cycle_id: "x", status: "aborted", outcome: "aborted_no_delivery" }]);
    const r = collectCycleLedger(p)[0]!;
    expect(r.tokens).toBe("—");
    expect(r.cost).toBe("—");
    expect(r.duration).toBe("—");
    expect(r.verdict).toBe("failed");
  });

  it("FIX-290 AC3: usage_unknown renders tokens/cost as '?' (UNKNOWN), model+duration still present — never a misleading 0/$0", () => {
    // The failed-cycle record the runner writes when usage_credentials_missing:
    // model fixed by routing, duration known, tokens/cost unreadable → unknown.
    const p = project([
      {
        cycle_id: "u",
        status: "failed",
        outcome: "failed",
        story_id: "FIX-284",
        agent: "pi",
        model: "kimi-k2-instruct",
        ts: "2026-06-12T00:57:00Z",
        duration_sec: 1020,
        usage_unknown: true,
      },
    ]);
    const r = collectCycleLedger(p)[0]!;
    expect(r.verdict).toBe("failed");
    expect(r.model).toBe("kimi-k2-instruct"); // AC2: present
    expect(r.duration).toBe("17m00s"); // present
    expect(r.tokens).toBe("?"); // AC3: unknown, NOT "—" and NOT 0
    expect(r.cost).toBe("?"); // AC3: unknown, NOT "$0.00"
  });

  it("FIX-290 AC3: a real 0-token cycle is '—' (TRUE-0), distinct from '?' (UNKNOWN)", () => {
    const p = project([
      { cycle_id: "z", status: "idle", outcome: "idle_no_work", ts: "2026-06-12T01:00:00Z", tokens_in: 0, tokens_out: 0 },
    ]);
    const r = collectCycleLedger(p)[0]!;
    expect(r.tokens).toBe("—"); // not "?": this row was NOT marked usage_unknown
    expect(r.cost).toBe("—");
  });
});

describe("kimi pair-review regressions", () => {
  it("duplicate cycle ids: the last (newest) record wins", () => {
    const p = project([
      { cycle_id: "dup", status: "failed", ts: "2026-06-12T01:00:00Z" },
      { cycle_id: "dup", status: "merged", outcome: "delivered", ts: "2026-06-12T02:00:00Z" },
    ]);
    const rows = collectCycleLedger(p);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe("delivered");
  });

  it("numeric epoch ts is understood (seconds and millis)", () => {
    const p = project([
      { cycle_id: "s", status: "idle", ts: 1781230000 },
      { cycle_id: "ms", status: "idle", ts: 1781230000000 },
    ]);
    const rows = collectCycleLedger(p);
    expect(rows.every((r) => r.tsSec === 1781230000)).toBe(true);
  });

  it("a skipped peer gate renders as an idle segment", () => {
    const p = project(
      [{ cycle_id: "c", status: "merged", outcome: "delivered", story_id: "US-1", ts: "2026-06-12T01:00:00Z" }],
      [{ type: "peer:gate", cycleId: "c", verdict: "skipped", reasons: [], ts: 1 }],
    );
    const peer = collectCycleLedger(p)[0]?.tape.find((s) => s.key === "peer");
    expect(peer?.state).toBe("idle");
    expect(peer?.detail).toBe("skipped");
  });
});
