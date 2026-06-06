/**
 * `roll brief` — owner-facing project digest (US-PORT-002, TS port).
 *
 * v2 displayed a cached, agent-authored `.roll/briefs/*.md` via lib/roll-brief.py
 * and shelled the roll-brief skill to (re)generate it. The v3 port COMPOSES the
 * digest live from the backlog reader (+ any active ALERT file) — see
 * @roll/core `composeBrief`. Three deliberate changes from v2, per the owner's
 * 2026-06-06 feedback baked into the AC:
 *
 *  1. 一屏精简 — the default view fits one screen: three blocks (Shipped /
 *     In-progress & queue / Needs-your-call), numbers first, detail lists folded.
 *     `--full` expands every list.
 *  2. 单语 — output follows the resolved locale (ROLL_LANG → … → en) and never
 *     mixes Chinese and English on a line. v2's bash brief mixed both; the port
 *     roots that out by routing every label through the catalog at one `lang`.
 *  3. agent 绝不漏思考过程 — no agent is shelled at all (the digest is composed
 *     from data), which is the strongest form of "never leak reasoning": there is
 *     no agent process whose thinking could reach the terminal.
 *
 * The reporting tone ("真的像在听汇报") is preserved through the templated section
 * labels and the release-readiness verdict — it never required an LLM.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type BacklogItem,
  type BriefModel,
  composeBrief,
  decideCount,
  parseBacklog,
  queueTotal,
  releaseReady,
} from "@roll/core";
import { type Lang, resolveLang, t, v2Catalog, v3Catalog } from "@roll/spec";
import { c, pad, renderState, row, trunc } from "../render.js";

const BACKLOG_PATH = ".roll/backlog.md";
const MAX_DESC = 58;

/** Locale label, single-language: v3 keys fall back to v2 keys then the key. */
function label(lang: Lang, key: string, ...args: ReadonlyArray<string | number>): string {
  if (v3Catalog[key] !== undefined) return t(v3Catalog, lang, key, ...args);
  return t(v2Catalog, lang, key, ...args);
}

function listRow(it: BacklogItem, color: string): string {
  return `    ${c("muted", "— ")}${c(color, pad(it.id, 16))}  ${c("dim", trunc(it.desc, MAX_DESC))}`;
}

/**
 * Render the digest to lines. Pure: model + lang + options + a pre-formatted
 * date string in, lines out (the adapter supplies the date so this stays
 * deterministic and testable).
 */
export function renderBrief(
  m: BriefModel,
  lang: Lang,
  opts: { full: boolean },
  dateStr: string,
): string[] {
  const out: string[] = [];
  const nShipped = m.shipped.length;
  const nWatch = m.inProgress.length;
  const nQueue = queueTotal(m);
  const nDecide = decideCount(m);

  // ── Eyebrow ────────────────────────────────────────────────────────────────
  out.push("");
  out.push(
    row(
      "  " + c("pink", label(lang, "brief.title", dateStr), { bold: true }),
      "",
    ),
  );
  out.push("");

  // ── Summary line (numbers first) ─────────────────────────────────────────────
  const watchColor = nWatch > 0 ? "amber" : "dim";
  const decideColor = nDecide > 0 ? "amber" : "dim";
  // Icons + numbers only — inherently single-language; the words live in the
  // block headers below.
  out.push(
    "  " +
      c("green", `✓ ${nShipped}`) +
      c("muted", "   ·   ") +
      c(watchColor, `⏵ ${nWatch}`) +
      c("muted", "   ·   ") +
      c("dim", `▢ ${nQueue}`) +
      c("muted", "   ·   ") +
      c(decideColor, `⚠ ${nDecide}`),
  );
  out.push("");

  // ── Block 1: Shipped ─────────────────────────────────────────────────────────
  out.push(c("blue", "  " + label(lang, "brief.section_completed", String(nShipped)), { bold: true }));
  if (opts.full && nShipped > 0) {
    for (const it of m.shipped) out.push(listRow(it, "blue"));
  }
  out.push("");

  // ── Block 2: In progress & queue ─────────────────────────────────────────────
  out.push(c("purple", "  " + label(lang, "brief.section_in_progress"), { bold: true }));
  for (const it of m.inProgress) out.push(listRow(it, "purple"));
  out.push(c("dim", "  " + label(lang, "brief.section_queue", String(nQueue))));
  out.push(
    c(
      "dim",
      "    " +
        label(
          lang,
          "briefv3.queue_breakdown",
          String(m.queueFix.length),
          String(m.queueUs.length),
          String(m.queueOther.length),
        ),
    ),
  );
  if (opts.full) {
    for (const it of [...m.queueFix, ...m.queueUs, ...m.queueOther]) out.push(listRow(it, "dim"));
  }
  out.push("");

  // ── Block 3: Needs your call (never folded — these are the action items) ─────
  out.push(c("amber", "  " + label(lang, "brief.section_escalations"), { bold: true }));
  if (nDecide === 0) {
    out.push("    " + c("green", "✓ " + label(lang, "briefv3.all_clear")));
  } else {
    for (const a of m.alerts) out.push("    " + c("amber", "⚠ ") + c("fg", a));
    for (const it of m.hold) out.push(listRow(it, "amber"));
    for (const it of m.blocked) out.push(listRow(it, "amber"));
  }
  out.push("");

  // ── Release readiness ────────────────────────────────────────────────────────
  const ready = releaseReady(m);
  const verdict = ready
    ? c("green", "✓ " + label(lang, "brief.release_ready_status"))
    : c("amber", "⚠ " + label(lang, "brief.release_hold_status", String(nDecide)));
  out.push("  " + c("dim", label(lang, "brief.release_readiness") + ": ") + verdict);

  // ── Full hint (only when something is folded) ────────────────────────────────
  if (!opts.full && (nShipped > 0 || nQueue > 0)) {
    out.push("  " + c("muted", label(lang, "briefv3.full_hint")));
  }
  out.push("");
  return out;
}

/** Resolve active ALERT file identifiers for the "needs your call" block.
 *  Best-effort: the shared loop dir lives outside the repo and may be
 *  unreachable in some sandboxes — any failure yields an empty list (the
 *  in-repo 🚫 Hold / 🔒 Blocked rows still populate the block). */
function activeAlerts(): string[] {
  const slug = process.env["ROLL_MAIN_SLUG"];
  if (slug === undefined || slug === "") return [];
  const rt = process.env["ROLL_PROJECT_RUNTIME_DIR"];
  const base = rt !== undefined && rt !== "" ? rt : join(process.env["_SHARED_ROOT"] ?? join(homedir(), ".shared", "roll"), "loop");
  const name = `ALERT-${slug}.md`;
  try {
    return existsSync(join(base, name)) ? [name] : [];
  } catch {
    return [];
  }
}

export function briefCommand(args: string[]): number {
  const noColor =
    args.includes("--no-color") || !process.stdout.isTTY || (process.env["NO_COLOR"] ?? "") !== "";
  renderState.useColor = !noColor;
  const full = args.includes("--full");
  const lang = resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });

  if (!existsSync(BACKLOG_PATH)) {
    const RED = noColor ? "" : "\x1b[0;31m";
    const NC = noColor ? "" : "\x1b[0m";
    process.stderr.write(`${RED}[roll]${NC} ${t(v2Catalog, lang, "backlog.roll_backlog_md_not_found_run")}\n`);
    return 1;
  }

  const items: BacklogItem[] = parseBacklog(readFileSync(BACKLOG_PATH, "utf8"));
  const model = composeBrief(items, activeAlerts());
  const dateStr = formatNow(new Date());
  process.stdout.write(renderBrief(model, lang, { full }, dateStr).join("\n") + "\n");
  return 0;
}

/** `YYYY-MM-DD HH:MM` in local time (mirrors the v2 brief title stamp). */
function formatNow(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
