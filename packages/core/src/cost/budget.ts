/**
 * Budget guardrails — v3 NEW capability (C11, B→S). No bash oracle: built to
 * spec from invariant I11 + .roll/v3/01-system.md BC8 + specs/architecture §6 +
 * 02-verification I11 chaos row.
 *
 * Contract:
 *   - Accumulate per-cycle {@link CycleCost} into daily / weekly totals on the
 *     UTC+8 day boundary (same TZ convention as the dashboard). {@link BudgetLedger}.
 *   - {@link budgetVerdict}: gate on `effectiveCost` (includes reverts), NEVER
 *     nominal (I11). ok → continue; ≥ approach threshold (default 80%) →
 *     `downgrade` (soft landing); ≥ ceiling → `pause_and_notify` (fail-loud).
 *   - {@link upgradeHint}: a cheap model whose revert-rate is too high pushes
 *     effective cost up — emit a `suggest_upgrade` signal (NEVER auto-change
 *     policy; a human decides).
 *
 * Pure: the clock (`now`) and the ledger are injected; no I/O, no Date.now().
 * Day/week keys use the fixed UTC+8 offset (no DST) — identical to
 * packages/cli/src/commands/dashboard.ts so daily/weekly windows line up across
 * the dashboard and the gate.
 */
import type { BudgetPolicy, CycleCost } from "@roll/spec";

// ── UTC+8 day / week keys (mirror dashboard.ts) ──────────────────────────────

const TZ_OFFSET_MS = 8 * 3600 * 1000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Shift a UTC epoch (ms) into UTC+8 wall-clock, read via getUTC* accessors. */
function toShanghai(epochMs: number): Date {
  return new Date(epochMs + TZ_OFFSET_MS);
}

/** `YYYY-MM-DD` in UTC+8 — the daily-budget bucket key. */
export function dayKey(epochMs: number): string {
  const s = toShanghai(epochMs);
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())}`;
}

/**
 * ISO-week key `YYYY-Www` in UTC+8 — the weekly-budget bucket key. Uses the ISO
 * 8601 week-numbering year (Monday-based; week 1 contains the first Thursday),
 * so the weekly window rolls over at Monday 00:00 UTC+8.
 */
export function weekKey(epochMs: number): string {
  const s = toShanghai(epochMs);
  // Work in a UTC date anchored at the UTC+8 wall-clock Y/M/D.
  const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
  // ISO: Thursday decides the year. day 1=Mon..7=Sun.
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${year}-W${pad2(week)}`;
}

// ── Ledger ───────────────────────────────────────────────────────────────────

/** Per-cycle revert facts the upgrade-hint heuristic folds in alongside cost. */
interface LedgerEntry {
  /** Effective cost (includes reverts) — the gated metric (I11). */
  effective: number;
  /** Nominal cost — kept for reporting / the upgrade-hint comparison. */
  estimated: number;
  /** TCR reverts this cycle. */
  reverts: number;
}

/**
 * BudgetLedger — folds {@link CycleCost} rows into UTC+8 daily / weekly totals.
 * It tracks `effectiveCost` (the gated metric) and also estimated + revert
 * counts so {@link upgradeHint} can spot a cheap-model-reverting-too-much trap.
 *
 * The ledger is a plain accumulator (no clock of its own): each {@link record}
 * takes the cycle's wall-clock `ts` (epoch ms) so the row lands in the right
 * UTC+8 bucket regardless of when the verdict is later computed.
 */
export class BudgetLedger {
  private readonly days = new Map<string, LedgerEntry>();
  private readonly weeks = new Map<string, LedgerEntry>();

  /** Fold one cycle's cost into its UTC+8 day + ISO-week buckets. */
  record(cost: CycleCost, ts: number): void {
    const entry: Pick<LedgerEntry, never> & LedgerEntry = {
      effective: cost.effectiveCost,
      estimated: cost.estimatedCost,
      reverts: Math.max(0, Math.trunc(cost.revertCount)),
    };
    this.add(this.days, dayKey(ts), entry);
    this.add(this.weeks, weekKey(ts), entry);
  }

  private add(map: Map<string, LedgerEntry>, key: string, e: LedgerEntry): void {
    const cur = map.get(key);
    if (cur === undefined) {
      map.set(key, { ...e });
      return;
    }
    cur.effective += e.effective;
    cur.estimated += e.estimated;
    cur.reverts += e.reverts;
  }

  /** Total effective cost for the UTC+8 day containing `now`. */
  dailyEffective(now: number): number {
    return this.days.get(dayKey(now))?.effective ?? 0;
  }

  /** Total effective cost for the ISO-week (UTC+8) containing `now`. */
  weeklyEffective(now: number): number {
    return this.weeks.get(weekKey(now))?.effective ?? 0;
  }

  /** Total nominal (estimated) cost for the UTC+8 day containing `now`. */
  dailyEstimated(now: number): number {
    return this.days.get(dayKey(now))?.estimated ?? 0;
  }

  /** Revert count for the UTC+8 day containing `now`. */
  dailyReverts(now: number): number {
    return this.days.get(dayKey(now))?.reverts ?? 0;
  }
}

// ── Verdict ───────────────────────────────────────────────────────────────────

/** Default approach threshold — 80% of a ceiling (architecture §6 "如 80%"). */
export const DEFAULT_APPROACH_RATIO = 0.8;

/** Which window tripped the verdict. */
export type BudgetWindow = "daily" | "weekly";

/**
 * The budget gate decision. `ok` continues; `downgrade` is the soft-landing
 * approach action; `pause_and_notify` is the fail-loud breach action (drives
 * `policy:safety_pause` + `alert:notify` in the caller).
 */
export type BudgetVerdict =
  | { action: "ok"; dailyRatio: number; weeklyRatio: number }
  | {
      action: "downgrade" | "pause_and_notify";
      /** Whichever window drove the (worst) decision. */
      window: BudgetWindow;
      /** Effective spend in that window. */
      spent: number;
      /** That window's ceiling. */
      ceiling: number;
      /** spent / ceiling for that window. */
      ratio: number;
      dailyRatio: number;
      weeklyRatio: number;
    };

/** Options for {@link budgetVerdict} (the approach ratio is overridable). */
export interface BudgetVerdictOptions {
  /** Fraction of ceiling that triggers `downgrade` (default 0.8). */
  approachRatio?: number;
}

/**
 * Decide the budget gate from a ledger + policy at time `now`. Gates on
 * EFFECTIVE cost (I11), evaluating both windows and returning the most severe
 * outcome (breach > approach > ok). On a tie the window with the higher ratio
 * is reported.
 *
 *   spent ≥ ceiling                    → pause_and_notify
 *   spent ≥ approachRatio × ceiling    → downgrade
 *   else                               → ok
 *
 * A non-positive ceiling disables that window (ratio 0, never trips) — a zero
 * budget is treated as "unset", never an instant breach.
 */
export function budgetVerdict(
  ledger: BudgetLedger,
  policy: BudgetPolicy,
  now: number,
  opts: BudgetVerdictOptions = {},
): BudgetVerdict {
  const approach = opts.approachRatio ?? DEFAULT_APPROACH_RATIO;

  const dailySpent = ledger.dailyEffective(now);
  const weeklySpent = ledger.weeklyEffective(now);
  const dailyRatio = ratioOf(dailySpent, policy.dailyUsd);
  const weeklyRatio = ratioOf(weeklySpent, policy.weeklyUsd);

  const daily = severity(dailySpent, policy.dailyUsd, approach);
  const weekly = severity(weeklySpent, policy.weeklyUsd, approach);

  // Pick the worse window; tie → higher ratio.
  const worst = pickWorst(
    { window: "daily" as const, sev: daily, spent: dailySpent, ceiling: policy.dailyUsd, ratio: dailyRatio },
    { window: "weekly" as const, sev: weekly, spent: weeklySpent, ceiling: policy.weeklyUsd, ratio: weeklyRatio },
  );

  if (worst.sev === 0) return { action: "ok", dailyRatio, weeklyRatio };
  return {
    action: worst.sev === 2 ? "pause_and_notify" : "downgrade",
    window: worst.window,
    spent: worst.spent,
    ceiling: worst.ceiling,
    ratio: worst.ratio,
    dailyRatio,
    weeklyRatio,
  };
}

function ratioOf(spent: number, ceiling: number): number {
  return ceiling > 0 ? spent / ceiling : 0;
}

/** 0 = ok, 1 = approach (downgrade), 2 = breach (pause). */
function severity(spent: number, ceiling: number, approach: number): 0 | 1 | 2 {
  if (ceiling <= 0) return 0;
  if (spent >= ceiling) return 2;
  if (spent >= approach * ceiling) return 1;
  return 0;
}

interface WindowSeverity {
  window: BudgetWindow;
  sev: 0 | 1 | 2;
  spent: number;
  ceiling: number;
  ratio: number;
}

function pickWorst(a: WindowSeverity, b: WindowSeverity): WindowSeverity {
  if (a.sev !== b.sev) return a.sev > b.sev ? a : b;
  return a.ratio >= b.ratio ? a : b;
}

// ── Upgrade hint (cheap-model-reverting-too-much) ────────────────────────────

/** Default revert-rate above which a cheap model is "reverting too much". */
export const DEFAULT_REVERT_RATE_THRESHOLD = 0.4;

/** The upgrade-hint signal — advisory only, never an auto policy change. */
export type UpgradeHint =
  | { suggest: false; revertRate: number }
  | {
      suggest: true;
      signal: "suggest_upgrade";
      revertRate: number;
      threshold: number;
      /** ALERT body the caller writes (human decides — no auto change). */
      reason: string;
    };

/** Inputs for {@link upgradeHint}: the cycle tally driving the revert rate. */
export interface UpgradeHintInput {
  /** Cycles run on the cheap model in the window. */
  cycles: number;
  /** TCR reverts across those cycles. */
  reverts: number;
  /** Revert-rate trigger (default {@link DEFAULT_REVERT_RATE_THRESHOLD}). */
  threshold?: number;
}

/**
 * Detect the "cheap model reverts so much that effectiveCost reverses the
 * saving" trap (architecture §6 `upgrade_hint.when.revert_rate_gt`). Revert rate
 * = reverts / cycles; STRICTLY greater than the threshold (default 0.4) →
 * `suggest_upgrade`. Zero cycles → never suggests (no data). The signal is
 * advisory: the caller writes an ALERT and a human decides — the policy is
 * never auto-mutated (I11).
 */
export function upgradeHint(input: UpgradeHintInput): UpgradeHint {
  const threshold = input.threshold ?? DEFAULT_REVERT_RATE_THRESHOLD;
  const cycles = Math.max(0, Math.trunc(input.cycles));
  const reverts = Math.max(0, Math.trunc(input.reverts));
  const revertRate = cycles > 0 ? reverts / cycles : 0;
  if (cycles === 0 || revertRate <= threshold) {
    return { suggest: false, revertRate };
  }
  return {
    suggest: true,
    signal: "suggest_upgrade",
    revertRate,
    threshold,
    reason:
      `cheap-model revert rate ${(revertRate * 100).toFixed(0)}% ` +
      `> ${(threshold * 100).toFixed(0)}% — reverts are inflating effective cost; ` +
      "consider upgrading the routed model (human decision, no auto change).",
  };
}
