/**
 * US-CLI-012 — `roll cycles [--since 1d|3d|7d|all]`: the cycle ledger as a
 * first-class command. cycle is a first-class noun in the philosophy; now it
 * has a name on the command surface too. Same aggregation as the web ledger
 * (collectCycleLedger), same verdict vocabulary, and the summary line counts
 * failed = failed + reverted + blocked — never swallowed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLang, type Lang, type RollEvent, parseEventLine } from "@roll/spec";
import { extractCycleSignals, signalKindForMarker, type TimelineEntry } from "@roll/core";
import { collectCycleLedger, ledgerFailedCount, reconcilePendingMergeVerdicts, type CycleLedgerRow } from "../lib/cycle-ledger.js";
import { collectGitDossierFacts, cycleMergeTruth } from "../lib/story-dossier.js";
import { findCycle } from "./cycle.js";

/**
 * FIX-347 — collect the ledger and reconcile `pending_merge` cycles against git
 * merge-truth, so a `published_pending_merge` cycle whose PR the async PR loop
 * already merged shows `delivered`, not a stale yellow. Same offline `git log`
 * check the web dashboard uses (storyHasMergeEvidence — no gh call).
 *
 * FIX-348 — also reconcile when the merge commit does NOT name the story-id: if
 * main's git log carries a `(#N)` PR-merge commit for the row's recorded PR
 * number, the delivery landed. Only an actually-merged `(#N)` commit counts (an
 * open PR leaves none), so an open PR stays pending.
 */
function reconciledLedger(cwd: string): CycleLedgerRow[] {
  const git = collectGitDossierFacts(cwd);
  return reconcilePendingMergeVerdicts(collectCycleLedger(cwd), cycleMergeTruth(git));
}
import { c, renderState, stripAnsi } from "../render.js";

export const CYCLES_USAGE =
  "Usage: roll cycles [--since 1d|3d|7d|all] [--detail <id>]\n" +
  "  The cycle ledger: one line per cycle, failures never swallowed (default --since 3d).\n" +
  "  --detail <id>  the per-cycle build-phase timeline (per-commit / heartbeat timing).\n" +
  "周期账本：每行一个 cycle，失败不被吞（默认 --since 3d）。\n" +
  "  --detail <id>  单个 cycle 的 build 阶段时间线（每提交/心跳计时）。";

const WINDOWS: Record<string, number> = { "1d": 1, "3d": 3, "7d": 7 };

/** Display handle: the trailing digit run (the mockup's #0312), falling back
 *  to the last 5 chars for ids without one. `roll cycle <handle>` resolves it. */
export function cycleNo(cycleId: string): string {
  const m = /(\d+)$/.exec(cycleId);
  return m?.[1] !== undefined ? m[1].slice(-5) : cycleId.slice(-5);
}

const VERDICT_COLOR: Record<string, string> = {
  delivered: "green",
  pending_merge: "yellow", // FIX-322: opened a PR, merge pending — in-flight, NOT delivered (amber)
  unpublished: "blue", // FIX-351: gates passed, work local, publish didn't land — neutral, NOT red
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
  // FIX-361: cost may be "$X.XX" or "¥X.XX". Parse each row and aggregate
  // per-currency in the JSON output so consumers never blindly sum across currencies.
  const costByCur: Record<string, number> = {};
  for (const r of within) {
    const { value, currency } = parseCostCell(r.cost);
    if (value !== null && currency !== null) {
      costByCur[currency] = (costByCur[currency] ?? 0) + value;
    }
  }
  return {
    since: sinceLabel,
    cycles: within.length,
    delivered,
    failed,
    costByCurrency: costByCur,
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

/** FIX-361: parse the formatted cost string ("$0.74" / "¥0.74" / "?" / "—")
 *  into { value: number | null, currency: string | null }. A null value means
 *  the cost is unknown; a null currency means not presentable. */
function parseCostCell(cell: string): { value: number | null; currency: string | null } {
  if (cell === "?" || cell === "—") return { value: null, currency: null };
  const sym = cell[0] ?? "";
  const currency = sym === "\u00A5" ? "CNY" : sym === "$" ? "USD" : null;
  const n = Number(cell.slice(1));
  return { value: Number.isFinite(n) ? n : null, currency };
}

/** FIX-361: build the cost summary string, with per-currency breakdown when
 *  the window mixes ¥ and $. */
function costSummary(within: readonly CycleLedgerRow[], lang: Lang): string {
  const byCur: Record<string, number> = {};
  for (const r of within) {
    const { value, currency } = parseCostCell(r.cost);
    if (value !== null && currency !== null) {
      byCur[currency] = (byCur[currency] ?? 0) + value;
    }
  }
  const entries = Object.entries(byCur);
  if (entries.length === 0) return lang === "zh" ? "花费 —" : "cost —";
  // Single currency: simple "$X.XX" or "¥X.XX".
  if (entries.length === 1) {
    const [cur, val] = entries[0] as [string, number];
    const sym = cur === "CNY" ? "\u00A5" : "$";
    return `${sym}${val.toFixed(2)}`;
  }
  // Mixed currencies: show each separately so they are never blindly summed.
  const parts = entries.map(([cur, val]) => {
    const sym = cur === "CNY" ? "\u00A5" : "$";
    return `${sym}${val.toFixed(2)}`;
  });
  return parts.join(" + ");
}

export function renderCyclesLedger(rows: CycleLedgerRow[], sinceLabel: string, lang: Lang, nowSec: number): string {
  const within = windowRows(rows, sinceLabel, nowSec);
  const lines: string[] = [];
  for (const r of within) {
    const color = VERDICT_COLOR[r.verdict] ?? "muted";
    lines.push(
      [
        pad(`#${cycleNo(r.cycleId)}`, 7),
        pad(c(color, r.verdict), 13), // FIX-322: fits "pending_merge" (13)
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
  const costStr = costSummary(within, lang);
  const summary =
    lang === "zh"
      ? `${within.length} 个周期 · ${delivered} 已交付 · ${c(failed > 0 ? "red" : "green", String(failed))} 失败/回滚/阻塞 · ${costStr}`
      : `${within.length} cycles · ${delivered} delivered · ${c(failed > 0 ? "red" : "green", String(failed))} failed/reverted/blocked · ${costStr}`;
  const latest = within[0];
  // `roll cycle <handle>` is the spec'd companion (US-CLI-013, next card) —
  // the hint is the contract between the two surfaces, not a dead end.
  const hint = latest !== undefined ? `\n→ roll cycle ${cycleNo(latest.cycleId)}` : "";
  if (within.length === 0) {
    return lang === "zh" ? `窗口内没有周期（--since ${sinceLabel}）\n` : `no cycles in the window (--since ${sinceLabel})\n`;
  }
  return `${lines.join("\n")}\n\n${summary}${hint}\n`;
}

/** Read + parse every event from the project's events.ndjson (empty on miss). */
function readAllEvents(projectPath: string): RollEvent[] {
  const path = join(projectPath, ".roll", "loop", "events.ndjson");
  if (!existsSync(path)) return [];
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: RollEvent[] = [];
  for (const line of text.split("\n")) {
    const ev = parseEventLine(line);
    if (ev !== null) out.push(ev);
  }
  return out;
}

/** mm:ss from whole seconds (the offset column). */
function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Human gap ("+3m" / "+45s") between two timeline entries. */
function gap(sec: number): string {
  if (sec <= 0) return "";
  return sec >= 90 ? `+${Math.round(sec / 60)}m` : `+${sec}s`;
}

const MARKER_COLOR: Record<string, string> = {
  tcr: "green",
  "build:heartbeat": "amber",
  "ci:fail": "red",
  "pr:merge": "green",
  alert: "red",
};

/**
 * US-LOOP-076 — the per-cycle build-phase timeline. Built from the SAME pure
 * {@link extractCycleSignals} reducer the acceptance report and web trace consume
 * (one 口径, zero agent special-casing), so a 37-min/2-commit anomaly is legible:
 * each turning point shows its mm:ss offset and the gap since the previous one.
 * The summary line surfaces the build span and TCR cadence at a glance.
 */
export function renderCycleDetail(events: RollEvent[], cycleId: string, lang: Lang): string {
  const { timeline } = extractCycleSignals(events, cycleId);
  if (timeline.length === 0) {
    return lang === "zh"
      ? `周期 ${cycleNo(cycleId)} 没有事件记录（build 阶段未观测到信号）\n`
      : `no events recorded for cycle ${cycleNo(cycleId)} (no build-phase signals observed)\n`;
  }
  const lines: string[] = [];
  lines.push(c("bold", `#${cycleNo(cycleId)} · ${cycleId}`));
  lines.push(lang === "zh" ? "build 阶段时间线 · build-phase timeline" : "build-phase timeline");
  lines.push("");
  let prevOffset = 0;
  for (const e of timeline) {
    const color = MARKER_COLOR[e.marker] ?? (signalKindForMarker(e.marker) !== null ? "blue" : "muted");
    const g = gap(e.offsetSec - prevOffset);
    prevOffset = e.offsetSec;
    const gapCol = g === "" ? "" : "  " + c("faint", g);
    lines.push(`${c("muted", clock(e.offsetSec))}  ${c(color, e.marker.padEnd(16))} ${e.label}${gapCol}`);
  }
  // Build-span + TCR cadence summary (the anomaly detector at a glance).
  const tcrs = timeline.filter((t) => t.marker === "tcr");
  const beats = timeline.filter((t) => t.marker === "build:heartbeat").length;
  const spanSec = (timeline[timeline.length - 1]?.offsetSec ?? 0) - (timeline[0]?.offsetSec ?? 0);
  lines.push("");
  lines.push(
    lang === "zh"
      ? `${clock(spanSec)} 总时长 · ${tcrs.length} 个 TCR 提交 · ${beats} 次心跳`
      : `${clock(spanSec)} span · ${tcrs.length} TCR commits · ${beats} heartbeats`,
  );
  return `${lines.join("\n")}\n`;
}

/** Machine view of the detail timeline — the SAME reducer, fields per entry. */
export function cycleDetailJson(events: RollEvent[], cycleId: string): unknown {
  const { timeline } = extractCycleSignals(events, cycleId);
  const tcrs = timeline.filter((t: TimelineEntry) => t.marker === "tcr");
  const beats = timeline.filter((t: TimelineEntry) => t.marker === "build:heartbeat").length;
  const spanSec = (timeline[timeline.length - 1]?.offsetSec ?? 0) - (timeline[0]?.offsetSec ?? 0);
  return {
    cycleId,
    no: cycleNo(cycleId),
    spanSec,
    tcrCount: tcrs.length,
    heartbeats: beats,
    timeline: timeline.map((t: TimelineEntry) => ({
      offsetSec: t.offsetSec,
      layer: t.layer,
      marker: t.marker,
      label: t.label,
    })),
  };
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

  // US-LOOP-076 — `roll cycles --detail <id>`: the per-cycle build-phase timeline.
  // Resolves the handle against the ledger (same tolerance as `roll cycle <id>`),
  // then renders from the SAME pure extractCycleSignals reducer the report uses.
  const di = args.indexOf("--detail");
  if (di >= 0) {
    const handle = args[di + 1];
    if (handle === undefined || handle.startsWith("-")) {
      process.stderr.write(lang === "zh" ? `[roll] --detail 需要一个 cycle id\n` : `[roll] --detail needs a cycle id\n`);
      return 1;
    }
    const cwd = process.cwd();
    const ledger = collectCycleLedger(cwd);
    const matched = findCycle(ledger, handle);
    const cycleId = matched?.cycleId ?? handle;
    const events = readAllEvents(cwd);
    if (json) {
      process.stdout.write(JSON.stringify(cycleDetailJson(events, cycleId), null, 2) + "\n");
      return 0;
    }
    process.stdout.write(renderCycleDetail(events, cycleId, lang));
    return 0;
  }

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
  const unknown = args.filter((a, idx) => a.startsWith("-") && a !== "--since" && a !== "--detail" && a !== "--no-color" && a !== "--json" && !(idx > 0 && (args[idx - 1] === "--since" || args[idx - 1] === "--detail")));
  if (unknown.length > 0) {
    process.stderr.write(`[roll] unknown flag: ${unknown[0]}\n${CYCLES_USAGE}\n`);
    return 1;
  }
  const rows = reconciledLedger(process.cwd());
  const nowSec = Math.floor(Date.now() / 1000);
  if (json) {
    process.stdout.write(JSON.stringify(cyclesLedgerJson(rows, since, nowSec), null, 2) + "\n");
    return 0;
  }
  process.stdout.write(renderCyclesLedger(rows, since, lang, nowSec));
  return 0;
}
