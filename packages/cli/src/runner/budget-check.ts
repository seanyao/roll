/**
 * FIX-249 — the REAL budget port (US-CORE-011 / I11, finally wired).
 *
 * nodePorts shipped with `budget: { check: () => "ok" }` — a stub. Even after
 * cost capture landed, the guardrail never read it: unattended burn had no
 * ceiling. This module rebuilds the {@link BudgetLedger} from runs.jsonl rows
 * (the same `cost_effective_usd`/`cost_usd` fields the executor now writes)
 * and gates with core's pure {@link budgetVerdict}:
 *
 *   spent ≥ ceiling                  → "pause_and_notify" (cycle halts)
 *   spent ≥ 80% ceiling (approach)   → "downgrade" (advisory)
 *   no `loop_safety.budget` in policy.yaml → "ok" (gate off, explicit opt-in)
 *
 * Fail-open by design: an unreadable policy / runs file must never halt the
 * loop on a bookkeeping error — the gate exists to stop SPEND, not cycles.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BudgetLedger, budgetVerdict, parsePolicy, type PolicyBudget } from "@roll/core";

/** One verdict literal, same union the BudgetPort speaks. */
export type BudgetCheckResult = "ok" | "downgrade" | "pause_and_notify";

/** Read `loop_safety.budget` from policy.yaml; undefined = gate off. */
export function readBudgetPolicy(repoCwd: string): PolicyBudget | undefined {
  try {
    const p = join(repoCwd, ".roll", "policy.yaml");
    if (!existsSync(p)) return undefined;
    return parsePolicy(readFileSync(p, "utf8")).loopSafety.budget;
  } catch {
    return undefined; // unreadable policy: gate off, never a phantom halt
  }
}

/** Fold runs.jsonl cost rows into a ledger (rows without cost are skipped). */
export function ledgerFromRuns(runsPath: string): BudgetLedger {
  const ledger = new BudgetLedger();
  let body: string;
  try {
    body = readFileSync(runsPath, "utf8");
  } catch {
    return ledger;
  }
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const estimated = typeof row["cost_usd"] === "number" ? row["cost_usd"] : undefined;
    if (estimated === undefined) continue;
    const effective = typeof row["cost_effective_usd"] === "number" ? row["cost_effective_usd"] : estimated;
    const ts = typeof row["ts"] === "string" ? Date.parse(row["ts"]) : Number.NaN;
    if (!Number.isFinite(ts)) continue;
    ledger.record(
      {
        cycleId: typeof row["cycle_id"] === "string" ? row["cycle_id"] : "",
        agent: typeof row["agent"] === "string" ? row["agent"] : "",
        model: typeof row["model"] === "string" ? row["model"] : "",
        tokensIn: typeof row["tokens_in"] === "number" ? row["tokens_in"] : 0,
        tokensOut: typeof row["tokens_out"] === "number" ? row["tokens_out"] : 0,
        estimatedCost: estimated,
        revertCount: 0,
        effectiveCost: effective,
      },
      ts,
    );
  }
  return ledger;
}

/**
 * The live gate: policy + runs ledger + now (epoch ms) → verdict literal.
 * No budget configured → "ok".
 */
export function realBudgetCheck(repoCwd: string, runsPath: string, nowMs: number): BudgetCheckResult {
  const policy = readBudgetPolicy(repoCwd);
  if (policy === undefined) return "ok";
  try {
    const verdict = budgetVerdict(ledgerFromRuns(runsPath), policy, nowMs);
    return verdict.action;
  } catch {
    return "ok"; // bookkeeping error must not halt the loop
  }
}
