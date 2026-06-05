/**
 * US-ATTEST-005 — acceptance report renderer: ONE self-contained HTML file
 * (all CSS inline, no external assets; screenshots referenced RELATIVELY as
 * `./screenshots/*.png`), offline-openable and print-to-PDF friendly.
 *
 * Status ladder (design D5, roll's 5-level simplification):
 *   ✅ pass      live evidence from this session (command output / shot / curl)
 *   🟦 readonly  boundary observation (config visible, log line exists)
 *   🟨 partial   partly satisfied — note MUST say which sub-condition is open
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

export type AcStatus = "pass" | "readonly" | "partial" | "claimed" | "missing";

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

export interface ReportInput {
  storyId: string;
  title: string;
  /** ISO timestamp injected by the caller (clock-free renderer). */
  generatedAt: string;
  items: AcReportItem[];
  /** Summary facts row (counts come from evidence.json). */
  facts?: { tcrCount: number; ciConclusion: string; testPassAge: string };
  /** US-ATTEST-009 — same-story Self-Score entries from .roll/notes/; the
   *  whole collapsed block is SKIPPED when none exist (no placeholder). */
  selfScores?: Array<{ skill: string; score: number; verdict: string; ts: string; note: string }>;
}

const BADGE: Record<AcStatus, { icon: string; en: string; zh: string; cls: string }> = {
  pass: { icon: "✅", en: "Pass", zh: "通过", cls: "s-pass" },
  readonly: { icon: "🟦", en: "Read-only Pass", zh: "只读通过", cls: "s-readonly" },
  partial: { icon: "🟨", en: "Partial", zh: "部分满足", cls: "s-partial" },
  claimed: { icon: "🟧", en: "Claimed", zh: "仅声明", cls: "s-claimed" },
  missing: { icon: "🟥", en: "Missing", zh: "无证据", cls: "s-missing" },
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The red line: no evidence ⇒ at best `claimed` (missing stays missing). */
export function enforceRedLine(item: AcReportItem): { item: AcReportItem; downgraded: boolean } {
  if (item.evidence.length === 0 && item.status !== "missing" && item.status !== "claimed") {
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

function acSection(item: AcReportItem): string {
  const b = BADGE[item.status];
  const note = item.note !== undefined && item.note !== "" ? `<p class="note">${esc(item.note)}</p>` : "";
  const evs = item.evidence.map(evidenceCard).join("\n");
  return `<section class="ac ${b.cls}" id="${esc(item.id)}">
<h3><span class="badge">${b.icon} ${b.en} · ${b.zh}</span> <code>${esc(item.id)}</code></h3>
<p class="ac-text">${esc(item.text)}</p>
${note}
${evs}
</section>`;
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
.s-missing { border-left:4px solid #cf222e; }
figure.shot { margin:10px 0; } figure.shot img { max-width:100%; border:1px solid var(--line); border-radius:8px; }
figure.shot figcaption { color:var(--muted); font-size:12.5px; }
.ev { margin:6px 0; font-size:13.5px; } .ev-label { color:var(--muted); font-size:12.5px; margin-bottom:4px; }
.discrepancies { border:1px dashed #e8793a; border-radius:10px; padding:8px 16px; margin-top:28px; }
details.selfscore { margin-top:28px; border:1px solid var(--line); border-radius:10px; padding:8px 16px; }
details.selfscore summary { cursor:pointer; font-weight:600; }
details.selfscore ul { margin:8px 0 4px; padding-left:18px; }
@media print { body { max-width:none; padding:0; } section.ac { break-inside:avoid; } }
${ANSI_CSS}
</style>
</head>
<body>
<h1>${esc(input.title)}</h1>
<p class="meta"><code>${esc(input.storyId)}</code> · generated ${esc(input.generatedAt)} · Gate: PASS</p>
<p>${summary}</p>
${facts}
${items.map(acSection).join("\n")}
${disc}
${selfScoreBlock(input.selfScores)}
</body>
</html>
`;
}
