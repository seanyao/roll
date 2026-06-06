/**
 * US-ATTEST-005 — acceptance report renderer: ONE self-contained HTML file
 * (all CSS inline, no external assets; screenshots referenced RELATIVELY as
 * `./screenshots/*.png`), offline-openable and print-to-PDF friendly.
 *
 * Status ladder (design D5 + US-ATTEST-012 状态口径补全):
 *   ✅ pass      live evidence from this session (command output / shot / curl)
 *   🟦 readonly  boundary observation (config visible, log line exists)
 *   🟨 partial   partly satisfied — note MUST say which sub-condition is open
 *   ❌ fail      verified AND failed — 验证过且失败 ≠ 缺证据 (not a positive claim)
 *   ⛔ blocked   a precondition blocks verification (note SHOULD say which)
 *   🟧 claimed   statement only (commit/PR text), no artifact
 *   🟥 missing   nothing found at all
 *
 * RED LINE (enforced HERE, not trusted from the caller): an AC item with ZERO
 * evidence refs cannot claim pass/readonly/partial — it is FORCED down to
 * `claimed` and surfaces in the "Discrepancies" appendix. The reporter is the
 * last line of defense against "嘴上 Done"(FIX-198 的台词层/动作层教训).
 *
 * Deletion-not-placeholder: the screenshot <figure> renders ONLY when a
 * screenshot evidence ref exists (no placeholder image, no warning text — D6).
 */
import { ANSI_CSS } from "./ansi-html.js";

export type AcStatus = "pass" | "readonly" | "partial" | "fail" | "blocked" | "claimed" | "missing";

export interface EvidenceRef {
  kind: "screenshot" | "text" | "commit" | "ci" | "deploy" | "test-pass";
  /** Short human label (e.g. `tcr: FIX-200 修正偏移` / `CI run`). */
  label: string;
  /** Relative path (screenshots) or external URL (ci/deploy) — optional. */
  href?: string;
  /** Pre-rendered inline HTML (the ANSI `<pre>` for kind=text). */
  inlineHtml?: string;
}

export interface AcReportItem {
  id: string;
  text: string;
  status: AcStatus;
  evidence: EvidenceRef[];
  /** Required free-text for `partial` (which sub-condition is open). */
  note?: string;
}

/**
 * US-ATTEST-013 — the delivery chain a reviewer needs to trace a story end to
 * end without leaving the report. Every field is optional; empties are trimmed.
 */
export interface DeliveryChain {
  prLinks?: Array<{ label: string; href: string }>;
  cycleId?: string;
  timeline?: string;
  cost?: string;
}

/**
 * US-ATTEST-013 — self-contained card context (the business body's lead): what
 * the todo is, in plain language, plus where it sits and how it shipped. Drawn
 * from the card README + backlog + delivery facts by the caller. Any subset may
 * be present; a context with no populated sub-field renders nothing (trim).
 */
export interface CardContext {
  oneLiner?: string;
  epic?: string;
  summary?: string;
  backlogStatus?: string;
  delivery?: DeliveryChain;
}

/**
 * US-ATTEST-013 — a坏态/好态 pair for FIX / behaviour-changing US. `before-*.png`
 * / `after-*.png` shots render side by side. Brand-new features carry none.
 */
export interface BeforeAfterPair {
  label: string;
  before: EvidenceRef;
  after: EvidenceRef;
}

export interface ReportInput {
  storyId: string;
  title: string;
  /** ISO timestamp injected by the caller (clock-free renderer). */
  generatedAt: string;
  items: AcReportItem[];
  /** US-ATTEST-013 — business-body lead: self-contained card context. */
  context?: CardContext;
  /** US-ATTEST-013 — before/after comparison pairs (empty ⇒ section trimmed). */
  beforeAfter?: BeforeAfterPair[];
  /** Summary facts row (counts come from evidence.json). */
  facts?: { tcrCount: number; ciConclusion: string; testPassAge: string };
  /** US-ATTEST-009 — same-story Self-Score entries from .roll/notes/; the
   *  whole collapsed block is SKIPPED when none exist (no placeholder). */
  selfScores?: Array<{ skill: string; score: number; verdict: string; ts: string; note: string }>;
  /** US-ATTEST-011 — screenshots an unattended cycle's Gate produced for itself
   *  (terminal lane). Renders a dedicated figure section; the block is SKIPPED
   *  when empty (deletion-not-placeholder — a headless host that honestly
   *  skipped the capture surfaces NOTHING here, never a placeholder). */
  selfCaptures?: EvidenceRef[];
}

const BADGE: Record<AcStatus, { icon: string; en: string; zh: string; cls: string }> = {
  pass: { icon: "✅", en: "Pass", zh: "通过", cls: "s-pass" },
  readonly: { icon: "🟦", en: "Read-only Pass", zh: "只读通过", cls: "s-readonly" },
  partial: { icon: "🟨", en: "Partial", zh: "部分满足", cls: "s-partial" },
  fail: { icon: "❌", en: "Fail", zh: "未通过", cls: "s-fail" },
  blocked: { icon: "⛔", en: "Blocked", zh: "受阻", cls: "s-blocked" },
  claimed: { icon: "🟧", en: "Claimed", zh: "仅声明", cls: "s-claimed" },
  missing: { icon: "🟥", en: "Missing", zh: "无证据", cls: "s-missing" },
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The red line: a POSITIVE claim with no evidence ⇒ at best `claimed`. Only the
 * three positive verdicts (pass/readonly/partial) are downgraded — `fail` and
 * `blocked` are NOT positive claims (US-ATTEST-012: 验证过且失败 ≠ 缺证据), so a
 * fail/blocked with zero refs stays itself and never surfaces as a discrepancy;
 * `claimed`/`missing` are already at/below the floor.
 */
const POSITIVE: ReadonlySet<AcStatus> = new Set<AcStatus>(["pass", "readonly", "partial"]);
export function enforceRedLine(item: AcReportItem): { item: AcReportItem; downgraded: boolean } {
  if (item.evidence.length === 0 && POSITIVE.has(item.status)) {
    return { item: { ...item, status: "claimed" }, downgraded: true };
  }
  return { item, downgraded: false };
}

function evidenceCard(ref: EvidenceRef): string {
  if (ref.kind === "screenshot" && ref.href !== undefined) {
    // deletion contract: figure exists ONLY because the artifact exists.
    return `<figure class="shot"><img src="${esc(ref.href)}" alt="${esc(ref.label)}"><figcaption>${esc(ref.label)}</figcaption></figure>`;
  }
  if (ref.kind === "text" && ref.inlineHtml !== undefined) {
    return `<div class="ev ev-text"><div class="ev-label">${esc(ref.label)}</div>${ref.inlineHtml}</div>`;
  }
  const body = ref.href !== undefined ? `<a href="${esc(ref.href)}">${esc(ref.label)}</a>` : esc(ref.label);
  return `<div class="ev ev-${ref.kind}">${body}</div>`;
}

/**
 * US-ATTEST-013 — information layering. Each AC carries business-facing evidence
 * (screenshots, PR/CI/deploy links — what a product reviewer reads) inline, and
 * technical evidence (ANSI command output / logs — kind=text) tucked into a
 * collapsed `<details>` that defaults closed. The fold is omitted entirely when
 * there is no technical evidence (deletion-not-placeholder).
 */
/** Delivery chain as a `<dl>`; empty when no sub-field is populated (trim). */
function deliveryBlock(d: DeliveryChain): string {
  const parts: string[] = [];
  if (d.prLinks !== undefined && d.prLinks.length > 0)
    parts.push(`<dt>PR</dt><dd>${d.prLinks.map((p) => `<a href="${esc(p.href)}">${esc(p.label)}</a>`).join(" · ")}</dd>`);
  if (d.cycleId !== undefined && d.cycleId !== "") parts.push(`<dt>Cycle</dt><dd><code>${esc(d.cycleId)}</code></dd>`);
  if (d.timeline !== undefined && d.timeline !== "") parts.push(`<dt>时间线 · Timeline</dt><dd>${esc(d.timeline)}</dd>`);
  if (d.cost !== undefined && d.cost !== "") parts.push(`<dt>成本 · Cost</dt><dd>${esc(d.cost)}</dd>`);
  return parts.length > 0 ? `<dl class="delivery">${parts.join("")}</dl>` : "";
}

/**
 * US-ATTEST-013 — the business body's lead. A product/business reviewer reads
 * this first and learns the whole story without leaving the report. Rendered
 * ONLY when at least one sub-field is populated; a fully-empty context is
 * trimmed (deletion-not-placeholder).
 */
function cardContextBlock(ctx: CardContext | undefined): string {
  if (ctx === undefined) return "";
  const rows: string[] = [];
  if (ctx.oneLiner !== undefined && ctx.oneLiner !== "") rows.push(`<p class="one-liner">${esc(ctx.oneLiner)}</p>`);
  const meta: string[] = [];
  if (ctx.epic !== undefined && ctx.epic !== "") meta.push(`Epic：${esc(ctx.epic)}`);
  if (ctx.backlogStatus !== undefined && ctx.backlogStatus !== "") meta.push(`Backlog：${esc(ctx.backlogStatus)}`);
  if (meta.length > 0) rows.push(`<p class="ctx-meta">${meta.join(" · ")}</p>`);
  if (ctx.summary !== undefined && ctx.summary !== "") rows.push(`<p class="summary">${esc(ctx.summary)}</p>`);
  const delivery = ctx.delivery !== undefined ? deliveryBlock(ctx.delivery) : "";
  if (delivery !== "") rows.push(delivery);
  if (rows.length === 0) return "";
  return `<section class="card-context"><h2>卡上下文 · Context</h2>\n${rows.join("\n")}\n</section>`;
}

function acSection(item: AcReportItem): string {
  const b = BADGE[item.status];
  const note = item.note !== undefined && item.note !== "" ? `<p class="note">${esc(item.note)}</p>` : "";
  const business = item.evidence.filter((e) => e.kind !== "text");
  const technical = item.evidence.filter((e) => e.kind === "text");
  const bizHtml = business.map(evidenceCard).join("\n");
  const techHtml =
    technical.length > 0
      ? `<details class="tech"><summary>技术细节 · Technical detail（${technical.length}）</summary>\n${technical.map(evidenceCard).join("\n")}\n</details>`
      : "";
  return `<section class="ac ${b.cls}" id="${esc(item.id)}">
<h3><span class="badge">${b.icon} ${b.en} · ${b.zh}</span> <code>${esc(item.id)}</code></h3>
<p class="ac-text">${esc(item.text)}</p>
${note}
${bizHtml}
${techHtml}
</section>`;
}

/**
 * US-ATTEST-013 — before/after comparison. Each pair renders its two shots side
 * by side (a flex row that wraps to stacked on narrow viewports). A figure is
 * emitted only for a ref that carries an href; a pair with neither shot is
 * dropped, and an empty list trims the whole section (全新功能免出).
 */
function beforeAfterBlock(pairs: ReportInput["beforeAfter"]): string {
  if (pairs === undefined || pairs.length === 0) return "";
  const fig = (ref: EvidenceRef, side: string, cls: string): string =>
    ref.href !== undefined
      ? `<figure class="shot ${cls}"><img src="${esc(ref.href)}" alt="${esc(ref.label)}"><figcaption>${side}：${esc(ref.label)}</figcaption></figure>`
      : "";
  const groups = pairs
    .map((p) => {
      const before = fig(p.before, "Before · 改前", "ba-before");
      const after = fig(p.after, "After · 改后", "ba-after");
      if (before === "" && after === "") return "";
      return `<div class="before-after"><h3>${esc(p.label)}</h3><div class="ba-pair">${before}${after}</div></div>`;
    })
    .filter((s) => s !== "");
  if (groups.length === 0) return "";
  return `<section class="before-after-section"><h2>对照实拍 · Before / After</h2>\n${groups.join("\n")}\n</section>`;
}

/**
 * US-ATTEST-011 — the unattended Gate's own screenshots. Renders ONLY when the
 * terminal lane actually produced pixels (the bridge yields no ref on skip), so
 * a headless cycle drops the whole block — deletion-not-placeholder, same red
 * line as the per-AC screenshot figure.
 */
function selfCaptureBlock(refs: ReportInput["selfCaptures"]): string {
  if (refs === undefined || refs.length === 0) return "";
  const figs = refs.map(evidenceCard).join("\n");
  return `<section class="self-capture"><h2>Gate self-capture · 自产实拍</h2>\n${figs}\n</section>`;
}

/**
 * US-ATTEST-013 — closing evidence index. Every evidence file referenced
 * anywhere in the report (per-AC, before/after, self-capture) appears once in a
 * single table so a reviewer can reach the raw artifact directly. Screenshots /
 * external links show their locator; inlined text shows "inline". Skipped
 * entirely when nothing was collected (no empty table).
 */
function evidenceIndexBlock(
  items: AcReportItem[],
  beforeAfter: ReportInput["beforeAfter"],
  selfCaptures: ReportInput["selfCaptures"],
): string {
  const rows: string[] = [];
  const row = (ref: EvidenceRef): void => {
    const loc =
      ref.href !== undefined
        ? `<a href="${esc(ref.href)}">${esc(ref.href)}</a>`
        : ref.inlineHtml !== undefined
          ? "inline"
          : "—";
    rows.push(`<tr><td><code>${esc(ref.kind)}</code></td><td>${esc(ref.label)}</td><td>${loc}</td></tr>`);
  };
  for (const it of items) for (const e of it.evidence) row(e);
  if (beforeAfter !== undefined) for (const p of beforeAfter) for (const r of [p.before, p.after]) if (r.href !== undefined) row(r);
  if (selfCaptures !== undefined) for (const r of selfCaptures) row(r);
  if (rows.length === 0) return "";
  return `<section class="evidence-index"><h2>证据索引 · Evidence index</h2>
<table class="ev-index"><thead><tr><th>Kind</th><th>Label</th><th>Locator</th></tr></thead>
<tbody>${rows.join("\n")}</tbody></table></section>`;
}

function selfScoreBlock(entries: ReportInput["selfScores"]): string {
  if (entries === undefined || entries.length === 0) return "";
  const li = entries
    .map(
      (e) =>
        `<li><b>${esc(String(e.score))}</b>/10 · ${esc(e.verdict)} · <code>${esc(e.skill)}</code> · <span class="meta">${esc(e.ts)}</span>${e.note !== "" ? `<br><span class="note">${esc(e.note)}</span>` : ""}</li>`,
    )
    .join("\n");
  return `<details class="selfscore"><summary>Self-Score · 自评（${entries.length}）</summary>\n<ul>\n${li}\n</ul>\n</details>`;
}

/** Render the single-file report. Pure: same input → same bytes. */
export function renderReport(input: ReportInput): string {
  const enforced = input.items.map(enforceRedLine);
  const items = enforced.map((e) => e.item);
  const discrepancies = enforced.filter((e) => e.downgraded).map((e) => e.item);
  const counts = new Map<AcStatus, number>();
  for (const it of items) counts.set(it.status, (counts.get(it.status) ?? 0) + 1);

  const summary = (Object.keys(BADGE) as AcStatus[])
    .filter((s) => (counts.get(s) ?? 0) > 0)
    .map((s) => `<span class="badge ${BADGE[s].cls}">${BADGE[s].icon} ${BADGE[s].en} ${BADGE[s].zh} × ${counts.get(s)}</span>`)
    .join(" ");

  const facts =
    input.facts !== undefined
      ? `<p class="facts">TCR commits: <b>${input.facts.tcrCount}</b> · CI: <b>${esc(input.facts.ciConclusion || "—")}</b> · test-pass: <b>${esc(input.facts.testPassAge)}</b></p>`
      : "";

  const disc =
    discrepancies.length > 0
      ? `<section class="discrepancies"><h2>Discrepancies · 证据缺口</h2>
<p>下列 AC 因<strong>没有任何证据条目</strong>被强制降级为 🟧 Claimed（红线，渲染层强制）：</p>
<ul>${discrepancies.map((d) => `<li><a href="#${esc(d.id)}"><code>${esc(d.id)}</code></a> ${esc(d.text)}</li>`).join("\n")}</ul>
</section>`
      : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(input.storyId)} — Acceptance Evidence · 验收证据</title>
<style>
:root { color-scheme: light dark; --fg:#1f2328; --bg:#ffffff; --muted:#57606a; --line:#d0d7de; }
@media (prefers-color-scheme: dark) { :root { --fg:#e6edf3; --bg:#0d1117; --muted:#8b949e; --line:#30363d; } }
body { margin:0 auto; max-width:880px; padding:32px 20px 80px; background:var(--bg); color:var(--fg);
  font:15px/1.65 -apple-system, "PingFang SC", "Segoe UI", sans-serif; }
h1 { font-size:22px; } h2 { font-size:18px; border-bottom:1px solid var(--line); padding-bottom:6px; }
code { background:rgba(127,127,127,.12); padding:1px 6px; border-radius:6px; font-size:.92em; }
.badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:12.5px; border:1px solid var(--line); }
.meta, .facts, .note { color:var(--muted); font-size:13px; }
section.ac { border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin:14px 0; }
section.ac h3 { margin:0 0 6px; font-size:14.5px; }
.s-pass { border-left:4px solid #2da44e; } .s-readonly { border-left:4px solid #218bff; }
.s-partial { border-left:4px solid #d4a72c; } .s-claimed { border-left:4px solid #e8793a; }
.s-fail { border-left:4px solid #cf222e; } .s-blocked { border-left:4px solid #8250df; }
.s-missing { border-left:4px solid #cf222e; }
figure.shot { margin:10px 0; } figure.shot img { max-width:100%; border:1px solid var(--line); border-radius:8px; }
figure.shot figcaption { color:var(--muted); font-size:12.5px; }
.ev { margin:6px 0; font-size:13.5px; } .ev-label { color:var(--muted); font-size:12.5px; margin-bottom:4px; }
.discrepancies { border:1px dashed #e8793a; border-radius:10px; padding:8px 16px; margin-top:28px; }
details.selfscore { margin-top:28px; border:1px solid var(--line); border-radius:10px; padding:8px 16px; }
details.selfscore summary { cursor:pointer; font-weight:600; }
details.selfscore ul { margin:8px 0 4px; padding-left:18px; }
details.tech { margin:8px 0 2px; border:1px solid var(--line); border-radius:8px; padding:6px 12px; background:rgba(127,127,127,.04); }
details.tech summary { cursor:pointer; color:var(--muted); font-size:12.5px; font-weight:600; }
details.tech[open] summary { margin-bottom:6px; }
section.card-context { border:1px solid var(--line); border-radius:10px; padding:6px 16px 12px; margin:14px 0; }
section.card-context .one-liner { font-size:15.5px; font-weight:600; }
section.card-context .ctx-meta { color:var(--muted); font-size:13px; }
dl.delivery { display:grid; grid-template-columns:auto 1fr; gap:2px 12px; margin:8px 0 0; font-size:13.5px; }
dl.delivery dt { color:var(--muted); } dl.delivery dd { margin:0; }
.before-after { margin:10px 0; } .before-after h3 { font-size:14px; margin:0 0 6px; }
.ba-pair { display:flex; flex-wrap:wrap; gap:12px; } .ba-pair figure.shot { flex:1 1 280px; margin:0; }
table.ev-index { width:100%; border-collapse:collapse; font-size:13px; margin-top:8px; }
table.ev-index th, table.ev-index td { border:1px solid var(--line); padding:4px 8px; text-align:left; vertical-align:top; }
table.ev-index th { color:var(--muted); font-weight:600; }
table.ev-index td a { word-break:break-all; }
@media print { body { max-width:none; padding:0; } section.ac { break-inside:avoid; } }
${ANSI_CSS}
</style>
</head>
<body>
<h1>${esc(input.title)}</h1>
<p class="meta"><code>${esc(input.storyId)}</code> · generated ${esc(input.generatedAt)} · Gate: PASS</p>
<p>${summary}</p>
${cardContextBlock(input.context)}
${facts}
${items.map(acSection).join("\n")}
${beforeAfterBlock(input.beforeAfter)}
${selfCaptureBlock(input.selfCaptures)}
${disc}
${evidenceIndexBlock(items, input.beforeAfter, input.selfCaptures)}
${selfScoreBlock(input.selfScores)}
</body>
</html>
`;
}
