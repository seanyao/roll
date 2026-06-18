/**
 * US-CLI-013 — `roll cycle <id>`: one cycle, fully replayable in the terminal,
 * SAME shape and vocabulary as the web trace tape (US-DOSSIER-013): summary
 * line → story line → vertical seven-segment tape (each segment a colored dot
 * + fact summary; segments a dead cycle never reached read "not reached", not
 * omitted) → evidence pointers (PR / diff / story dossier).
 */
import { resolveLang } from "@roll/spec";
import { collectCycleLedger, type CycleLedgerRow, type CycleTapeSegment } from "../lib/cycle-ledger.js";
import { collectGitDossierFacts } from "../lib/story-dossier.js";
import { cycleNo } from "./cycles.js";
import { c, renderState } from "../render.js";
import { formatToolCostSummary, formatToolTimelineRow } from "../lib/tool-display.js";

export const CYCLE_USAGE =
  "Usage: roll cycle <id>\n" +
  "  One cycle's full trace tape (same segments and vocabulary as the web ledger).\n" +
  "单个 cycle 的完整轨迹带（与 web 账本同段同词表）。";

const SEG_COLOR: Record<CycleTapeSegment["state"], string> = {
  pass: "green",
  fail: "red",
  idle: "muted",
  unknown: "muted",
};

function normalizeHandle(raw: string): string {
  return raw.replace(/^#/, "").replace(/^0+(?=\d)/, "");
}

/** Match tolerance (AC1): with/without `#`, with/without leading zeros, full id or trailing digit run. */
export function findCycle(rows: CycleLedgerRow[], raw: string): CycleLedgerRow | undefined {
  const want = normalizeHandle(raw);
  return rows.find((r) => {
    if (r.cycleId === raw || r.cycleId === want) return true;
    const no = cycleNo(r.cycleId);
    return normalizeHandle(no) === want || no === want;
  });
}

export function renderCycleTrace(row: CycleLedgerRow, lang: "en" | "zh", slug?: string): string {
  const lines: string[] = [];
  lines.push(
    `#${cycleNo(row.cycleId)} · ${c(row.verdict === "delivered" ? "green" : row.verdict === "idle" || row.verdict === "unpublished" ? "muted" : "red", row.verdict)} · ${row.model} · ${row.tokens} · ${row.cost} · ${row.duration}`,
  );
  lines.push(lang === "zh" ? `story ${row.storyId === "" ? "—（无故事）" : row.storyId}` : `story ${row.storyId === "" ? "— (no story)" : row.storyId}`);
  if (row.toolSummary !== "") lines.push(`cost ${row.cost} · tools ${formatToolCostSummary(row.toolCosts, " ")}`);
  lines.push("");
  const reached = new Set(row.tape.filter((s) => s.detail !== "—" || s.state !== "unknown").map((s) => s.key));
  for (let i = 0; i < row.tape.length; i++) {
    const seg = row.tape[i] as CycleTapeSegment;
    const dead = !reached.has(seg.key) && seg.state === "unknown";
    const dot = c(dead ? "muted" : SEG_COLOR[seg.state], "●");
    const detail = dead ? (lang === "zh" ? "未达" : "not reached") : seg.detail;
    lines.push(`${dot} ${seg.key.padEnd(7)} ${detail}`);
    if (seg.key === "build" && row.toolTimeline.length > 0) {
      for (const tool of row.toolTimeline) {
        lines.push(`  ↳ ${formatToolTimelineRow(tool)}`);
      }
    }
    if (i < row.tape.length - 1) lines.push("│");
  }
  lines.push("");
  const ev: string[] = [];
  const prMatch = /#(\d+)/.exec(row.tape.find((s) => s.key === "pr")?.detail ?? "");
  if (prMatch?.[1] !== undefined && slug !== undefined) {
    ev.push(`PR https://github.com/${slug}/pull/${prMatch[1]}`);
    ev.push(`diff https://github.com/${slug}/pull/${prMatch[1]}/files`);
  }
  if (row.storyId !== "") ev.push(`story .roll/features/*/${row.storyId}/index.html`);
  lines.push(`evidence  ${ev.length > 0 ? ev.join(" · ") : lang === "zh" ? "—（无可定位证据）" : "— (nothing addressable)"}`);
  return `${lines.join("\n")}\n`;
}

/**
 * US-DOSSIER-036 --json (AC5/AC7): the machine view of ONE cycle — the SAME
 * row, the SAME tape segments (key · detail · state), and the SAME evidence
 * pointers the human trace renders, derived from the same `row`+`slug` call.
 */
export function cycleTraceJson(row: CycleLedgerRow, slug: string | undefined): unknown {
  const ev: Array<{ label: string; href: string }> = [];
  const prMatch = /#(\d+)/.exec(row.tape.find((s) => s.key === "pr")?.detail ?? "");
  if (prMatch?.[1] !== undefined && slug !== undefined) {
    ev.push({ label: "PR", href: `https://github.com/${slug}/pull/${prMatch[1]}` });
    ev.push({ label: "diff", href: `https://github.com/${slug}/pull/${prMatch[1]}/files` });
  }
  if (row.storyId !== "") ev.push({ label: "story", href: `.roll/features/*/${row.storyId}/index.html` });
  return {
    no: cycleNo(row.cycleId),
    cycleId: row.cycleId,
    verdict: row.verdict,
    storyId: row.storyId,
    model: row.model,
    tokens: row.tokens,
    cost: row.cost,
    toolSummary: row.toolSummary,
    toolTimeline: row.toolTimeline.map((t) => ({ toolId: t.toolId, label: t.label, durationMs: t.durationMs, ok: t.ok, errorCode: t.errorCode })),
    duration: row.duration,
    tape: row.tape.map((s) => ({ key: s.key, detail: s.detail, state: s.state })),
    evidence: ev,
  };
}

export function cycleCommand(args: string[]): number {
  const noColor = args.includes("--no-color") || !process.stdout.isTTY || (process.env["NO_COLOR"] ?? "") !== "";
  renderState.useColor = !noColor;
  const lang = resolveLang({ rollLang: process.env["ROLL_LANG"], lcAll: process.env["LC_ALL"], lang: process.env["LANG"] });
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    process.stdout.write(`${CYCLE_USAGE}\n`);
    return args.length === 0 ? 1 : 0;
  }
  const json = args.includes("--json");
  // kimi pair-review: reject unknown flags like `roll cycles` does.
  const unknown = args.filter((a) => a.startsWith("-") && a !== "--no-color" && a !== "--help" && a !== "-h" && a !== "--json");
  if (unknown.length > 0) {
    process.stderr.write(`[roll] unknown flag: ${unknown[0]}\n${CYCLE_USAGE}\n`);
    return 1;
  }
  const handle = args.find((a) => !a.startsWith("-"));
  if (handle === undefined) {
    process.stderr.write(`${CYCLE_USAGE}\n`);
    return 1;
  }
  const rows = collectCycleLedger(process.cwd());
  const row = findCycle(rows, handle);
  if (row === undefined) {
    process.stderr.write(lang === "zh" ? `[roll] 找不到周期 ${handle}（试试 roll cycles --since all）\n` : `[roll] no cycle matches ${handle} (try roll cycles --since all)\n`);
    return 1;
  }
  const slug = collectGitDossierFacts(process.cwd())?.slug;
  if (json) {
    process.stdout.write(JSON.stringify(cycleTraceJson(row, slug), null, 2) + "\n");
    return 0;
  }
  process.stdout.write(renderCycleTrace(row, lang, slug));
  return 0;
}
