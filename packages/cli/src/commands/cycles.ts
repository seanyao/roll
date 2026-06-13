/**
 * US-CLI-012 — `roll cycles [--since 1d|3d|7d|all]`: the cycle ledger as a
 * first-class command. cycle is a first-class noun in the philosophy; now it
 * has a name on the command surface too. Same aggregation as the web ledger
 * (collectCycleLedger), same verdict vocabulary, and the summary line counts
 * failed = failed + reverted + blocked — never swallowed.
 */
import { resolveLang, type Lang } from "@roll/spec";
import { collectCycleLedger, ledgerFailedCount, type CycleLedgerRow } from "../lib/cycle-ledger.js";
import { c, renderState, stripAnsi } from "../render.js";

export const CYCLES_USAGE =
  "Usage: roll cycles [--since 1d|3d|7d|all]\n" +
  "  The cycle ledger: one line per cycle, failures never swallowed (default --since 3d).\n" +
  "周期账本：每行一个 cycle，失败不被吞（默认 --since 3d）。";

const WINDOWS: Record<string, number> = { "1d": 1, "3d": 3, "7d": 7 };

/** Display handle: the trailing digit run (the mockup's #0312), falling back
 *  to the last 5 chars for ids without one. `roll cycle <handle>` resolves it. */
export function cycleNo(cycleId: string): string {
  const m = /(\d+)$/.exec(cycleId);
  return m?.[1] !== undefined ? m[1].slice(-5) : cycleId.slice(-5);
}

const VERDICT_COLOR: Record<string, string> = {
  delivered: "green",
  reverted: "yellow",
  failed: "red",
  blocked: "purple",
  idle: "muted",
  unknown: "muted",
};

function pad(s: string, w: number): string {
  const len = stripAnsi(s).length;
  return len >= w ? s : s + " ".repeat(w - len);
}

function tokensTotal(tokens: string): string {
  // ledger carries "in/out" (e.g. 104k/16k) — the CLI column shows one figure.
  if (tokens === "—") return "—";
  // FIX-290 AC3: unreadable usage stays "?" (UNKNOWN), never collapses to 0.
  if (tokens === "?") return "?";
  const parts = tokens.split("/");
  const num = (p: string): number => (p.endsWith("k") ? Number(p.slice(0, -1)) * 1000 : Number(p));
  const total = parts.reduce((a, p) => a + (Number.isFinite(num(p)) ? num(p) : 0), 0);
  return total >= 1000 ? `${Math.round(total / 1000)}k` : String(total);
}

/** The window filter the human render applies — shared so --json is the SAME
 *  computation (AC5/AC7), never a second derivation. */
function windowRows(rows: CycleLedgerRow[], sinceLabel: string, nowSec: number): CycleLedgerRow[] {
  const horizonDays = WINDOWS[sinceLabel];
  return sinceLabel === "all"
    ? rows
    : rows.filter((r) => nowSec - r.tsSec <= (horizonDays ?? 3) * 86400 && r.tsSec > 0);
}

/**
 * US-DOSSIER-036 --json (AC5/AC7): the machine view of the ledger, built from
 * the SAME windowed rows + the SAME `delivered`/`failed`/`cost` aggregation the
 * human render computes — field-by-field parity, key/row order stable (recency).
 */
export function cyclesLedgerJson(rows: CycleLedgerRow[], sinceLabel: string, nowSec: number): unknown {
  const within = windowRows(rows, sinceLabel, nowSec);
  const delivered = within.filter((r) => r.verdict === "delivered").length;
  const failed = ledgerFailedCount(within);
  const cost = within.reduce((a, r) => {
    const n = r.cost.startsWith("$") ? Number(r.cost.slice(1)) : 0;
    return a + (Number.isFinite(n) ? n : 0);
  }, 0);
  return {
    since: sinceLabel,
    cycles: within.length,
    delivered,
    failed,
    costUsd: Number(cost.toFixed(2)),
    rows: within.map((r) => ({
      no: cycleNo(r.cycleId),
      cycleId: r.cycleId,
      verdict: r.verdict,
      storyId: r.storyId,
      model: r.model,
      tokens: tokensTotal(r.tokens),
      cost: r.cost,
      duration: r.duration,
    })),
  };
}

export function renderCyclesLedger(rows: CycleLedgerRow[], sinceLabel: string, lang: Lang, nowSec: number): string {
  const within = windowRows(rows, sinceLabel, nowSec);
  const lines: string[] = [];
  for (const r of within) {
    const color = VERDICT_COLOR[r.verdict] ?? "muted";
    lines.push(
      [
        pad(`#${cycleNo(r.cycleId)}`, 7),
        pad(c(color, r.verdict), 11),
        pad(r.storyId === "" ? "—" : r.storyId, 16),
        pad(r.model, 19),
        pad(tokensTotal(r.tokens), 6),
        pad(r.cost, 7),
        r.duration,
      ].join(" "),
    );
  }
  const delivered = within.filter((r) => r.verdict === "delivered").length;
  const failed = ledgerFailedCount(within);
  const cost = within.reduce((a, r) => {
    // kimi pair-review: a malformed cost cell must not turn the summary into $NaN.
    const n = r.cost.startsWith("$") ? Number(r.cost.slice(1)) : 0;
    return a + (Number.isFinite(n) ? n : 0);
  }, 0);
  const summary =
    lang === "zh"
      ? `${within.length} 个周期 · ${delivered} 已交付 · ${c(failed > 0 ? "red" : "green", String(failed))} 失败/回滚/阻塞 · $${cost.toFixed(2)}`
      : `${within.length} cycles · ${delivered} delivered · ${c(failed > 0 ? "red" : "green", String(failed))} failed/reverted/blocked · $${cost.toFixed(2)}`;
  const latest = within[0];
  // `roll cycle <handle>` is the spec'd companion (US-CLI-013, next card) —
  // the hint is the contract between the two surfaces, not a dead end.
  const hint = latest !== undefined ? `\n→ roll cycle ${cycleNo(latest.cycleId)}` : "";
  if (within.length === 0) {
    return lang === "zh" ? `窗口内没有周期（--since ${sinceLabel}）\n` : `no cycles in the window (--since ${sinceLabel})\n`;
  }
  return `${lines.join("\n")}\n\n${summary}${hint}\n`;
}

export function cyclesCommand(args: string[]): number {
  const noColor = args.includes("--no-color") || !process.stdout.isTTY || (process.env["NO_COLOR"] ?? "") !== "";
  renderState.useColor = !noColor;
  const lang = resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${CYCLES_USAGE}\n`);
    return 0;
  }
  const json = args.includes("--json");
  let since = "3d";
  const i = args.indexOf("--since");
  if (i >= 0) {
    const v = args[i + 1];
    if (v === undefined || (v !== "all" && WINDOWS[v] === undefined)) {
      process.stderr.write(
        lang === "zh" ? `[roll] 非法 --since 值：${v ?? "(空)"}（可用 1d|3d|7d|all）\n` : `[roll] illegal --since value: ${v ?? "(empty)"} (use 1d|3d|7d|all)\n`,
      );
      return 1;
    }
    since = v;
  }
  const unknown = args.filter((a, idx) => a.startsWith("-") && a !== "--since" && a !== "--no-color" && a !== "--json" && !(idx > 0 && args[idx - 1] === "--since"));
  if (unknown.length > 0) {
    process.stderr.write(`[roll] unknown flag: ${unknown[0]}\n${CYCLES_USAGE}\n`);
    return 1;
  }
  const rows = collectCycleLedger(process.cwd());
  const nowSec = Math.floor(Date.now() / 1000);
  if (json) {
    process.stdout.write(JSON.stringify(cyclesLedgerJson(rows, since, nowSec), null, 2) + "\n");
    return 0;
  }
  process.stdout.write(renderCyclesLedger(rows, since, lang, nowSec));
  return 0;
}
