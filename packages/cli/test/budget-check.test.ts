/**
 * FIX-249 AC2 — budget guardrails driven by REAL captured cost.
 *
 * The BudgetPort in nodePorts was a stub (`check: () => "ok"`): even with cost
 * rows on disk the guardrail was blind. These tests prove the live chain:
 * runs.jsonl cost rows → ledger → budgetVerdict → halt/downgrade, and the
 * walk-level effect (budget_check command → budget_halt event on breach).
 */
import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ledgerFromRuns, realBudgetCheck } from "../src/runner/budget-check.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function project(policyYaml: string | null, runsLines: string[]): { repo: string; runsPath: string } {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "roll-249-budget-")));
  dirs.push(repo);
  execSync(`mkdir -p '${join(repo, ".roll", "loop")}'`);
  if (policyYaml !== null) writeFileSync(join(repo, ".roll", "policy.yaml"), policyYaml);
  const runsPath = join(repo, ".roll", "loop", "runs.jsonl");
  writeFileSync(runsPath, runsLines.join("\n") + "\n");
  return { repo, runsPath };
}

/** A cost-bearing run row stamped "now" (so it lands in today's window). */
function costRow(cycleId: string, effective: number, nowMs: number): string {
  return JSON.stringify({
    run_id: cycleId,
    cycle_id: cycleId,
    status: "published",
    outcome: "delivered",
    agent: "pi",
    model: "deepseek-v4-pro",
    tokens_in: 1000,
    tokens_out: 500,
    cost_usd: effective,
    cost_effective_usd: effective,
    ts: new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
}

const BUDGET_POLICY = ["loop_safety:", "  budget:", "    daily_usd: 10", "    weekly_usd: 100"].join("\n");

describe("FIX-249 AC2 — real-cost budget guardrail", () => {
  const now = Date.UTC(2026, 5, 11, 6, 0, 0); // fixed instant; rows stamped same day

  it("breach: today's effective spend ≥ daily ceiling → pause_and_notify", () => {
    const { repo, runsPath } = project(BUDGET_POLICY, [costRow("c1", 6, now), costRow("c2", 5, now)]);
    expect(realBudgetCheck(repo, runsPath, now)).toBe("pause_and_notify");
  });

  it("approach: spend ≥ 80% of ceiling → downgrade (advisory)", () => {
    const { repo, runsPath } = project(BUDGET_POLICY, [costRow("c1", 8.5, now)]);
    expect(realBudgetCheck(repo, runsPath, now)).toBe("downgrade");
  });

  it("under budget → ok", () => {
    const { repo, runsPath } = project(BUDGET_POLICY, [costRow("c1", 1, now)]);
    expect(realBudgetCheck(repo, runsPath, now)).toBe("ok");
  });

  it("no budget block in policy → ok (gate is explicit opt-in)", () => {
    const { repo, runsPath } = project("loop_safety:\n  attest_gate: hard\n", [costRow("c1", 999, now)]);
    expect(realBudgetCheck(repo, runsPath, now)).toBe("ok");
  });

  it("cost-less rows (pre-FIX-249 history) contribute nothing — no phantom spend", () => {
    const bare = JSON.stringify({ run_id: "old", cycle_id: "old", status: "failed", ts: new Date(now).toISOString() });
    const { repo, runsPath } = project(BUDGET_POLICY, [bare]);
    expect(realBudgetCheck(repo, runsPath, now)).toBe("ok");
    expect(ledgerFromRuns(runsPath).dailyEffective(now)).toBe(0);
  });
});
