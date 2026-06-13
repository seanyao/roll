/**
 * US-DOSSIER-001b — the epic detail page (`.roll/features/<epic>/index.html`).
 *
 * One epic, fully accounted: masthead with a breadcrumb home, an epic-level
 * ledger (4 figures + wish→truth bar), then every story in three groups —
 * Merged to main / In a cycle / In backlog — each row carrying its id, type
 * chip, title, mini-spine and status pill. Rows link into the story dossier.
 * Same chrome, same tokens (001a), same single-file contract.
 */
import { CHROME_CONTROLS, CHROME_CSS, CHROME_SCRIPT, bi } from "@roll/core";
import { type DeliveryLadder, type StoryEvidenceFlags } from "@roll/spec";
import { type DossierEpic, type DossierEpicDoc, type DossierStory } from "./archive.js";
import { DOSSIER_CSS } from "./dossier-css.js";
import { LADDER_CSS, SPINE_STAGES, deriveDeliveryLadder } from "./dossier-index.js";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Evidence flags fall back to all-false so a delivered story with no enriched
 *  flags lands on the honest `merged` rung, never a silent `attested`. */
const NO_EVIDENCE: StoryEvidenceFlags = { report: false, acMap: false, visualEvidence: false };

/**
 * US-DOSSIER-025 — the epic row's display rung, aligned to the SAME
 * claimed→merged→attested ladder the story dossier (US-DOSSIER-023) and the
 * truth.json registry (US-DOSSIER-021) use, via the ONE shared
 * `deriveDeliveryLadder` classifier (no duplicated rung logic — that drift is
 * exactly what this story closes). `fail`/`unknown` error states are preserved
 * unchanged; a delivered card is `attested` (merge + full attest evidence) or
 * `merged` (merge truth, attest pending), and a backlog ✅ Done with no merge
 * evidence is `claimed`. Deterministic: no clock/locale dependence.
 */
export type StoryState = "attested" | "merged" | "claimed" | "fail" | "unknown";

/** Derive the story's ladder rung for the epic-page row. */
export function storyState(s: DossierStory): StoryState {
  if (s.truthState === "fail") return "fail";
  if (s.truthState === "unknown") return "unknown";
  const rung = deriveDeliveryLadder(s, s.evidence ?? NO_EVIDENCE);
  if (rung === "attested" || rung === "merged" || rung === "claimed") return rung;
  // `none`: not delivered, not claimed Done. A `done` status with no merge
  // evidence already mapped to `claimed`; what remains is honest unknown.
  return "unknown";
}

/**
 * US-DOSSIER-025 — the 5-dot mini-spine, filled to the story's ladder rung:
 *   - attested → all five stations, the delivery node truth-green (`i.attested`).
 *   - merged   → filled through delivery, delivery node teal (`i.merged`); no
 *     attest mark — never reads as full green.
 *   - claimed  → only the definition/in-cycle stations + a hatched amber delivery
 *     node (`i.claimed`, reached-but-unproven); upstream stays unfilled.
 *   - fail/unknown → definition only.
 * No row reads as fully done unless it is at least `merged`.
 */
export function miniSpine(s: DossierStory & { phasesDone?: number }): string {
  const rung = storyState(s);
  const reached: DeliveryLadder | "none" =
    rung === "attested" ? "attested" : rung === "merged" ? "merged" : rung === "claimed" ? "claimed" : "none";
  const delivered = reached === "attested" || reached === "merged";
  // delivered (merge truth) ⇒ definition…delivery filled; otherwise definition
  // (a card existing IS its definition) + any extra phases known.
  const upstreamDone = delivered ? SPINE_STAGES.length - 1 : 1 + (s.phasesDone ?? 0);
  const bits = SPINE_STAGES.map((st, i) => {
    let cls = "";
    if (st.key === "delivery") {
      cls = reached !== "none" ? reached : "";
    } else {
      cls = i < upstreamDone ? "done" : "";
    }
    // segment is "done" only when both endpoints are reached (delivery counts as
    // reached at any rung so the line into a claimed node still draws).
    const here = st.key === "delivery" ? reached !== "none" : i < upstreamDone;
    const nextKey = SPINE_STAGES[i + 1]?.key;
    const nextReached = nextKey === "delivery" ? reached !== "none" : i + 1 < upstreamDone;
    const seg = i < SPINE_STAGES.length - 1 ? `<s${here && nextReached ? ' class="done"' : ""}></s>` : "";
    return `<i${cls !== "" ? ` class="${cls}"` : ""}></i>${seg}`;
  });
  return `<span class="mini-spine" aria-hidden="true">${bits.join("")}</span>`;
}

/** US-DOSSIER-025 — the status pill carries the ladder rung, bilingual EN/中 on
 *  separate lines (`bi`). `fail`/`unknown` keep their error treatment. */
function pill(state: StoryState): string {
  if (state === "attested") return `<span class="pill attested">${bi("attested", "已验收")}</span>`;
  if (state === "merged") return `<span class="pill merged">${bi("merged", "已合主干")}</span>`;
  if (state === "claimed") return `<span class="pill claimed">${bi("claimed", "仅声称")}</span>`;
  if (state === "fail") return `<span class="pill fail">${bi("truth fail", "真相失败")}</span>`;
  return `<span class="pill unknown">?</span>`;
}

function storyRow(s: DossierStory): string {
  const st = storyState(s);
  const delivered = st === "attested" || st === "merged";
  return (
    `<a class="story-row" href="${encodeURIComponent(s.id)}/index.html" data-search="${esc(`${s.id} ${s.title ?? ""}`)}" data-rung="${st}" data-truth="${delivered ? "1" : "0"}">` +
    `<span class="id">${esc(s.id)}</span>` +
    `<span class="type type-${esc(s.type)}">${esc(s.type)}</span>` +
    `<span class="title">${esc(s.title ?? "")}</span>` +
    miniSpine(s) +
    pill(st) +
    (s.truthReason !== undefined ? `<span class="truth-reason">${esc(s.truthReason)}</span>` : "") +
    `</a>`
  );
}

function docKindLabel(doc: DossierEpicDoc): string {
  if (doc.kind === "overview") return bi("Overview", "总览");
  if (doc.kind === "plan") return bi("Plan", "方案");
  return bi("Doc", "文档");
}

function epicDocs(e: DossierEpic): string {
  const docs = e.docs ?? [];
  const overview = `.roll/features/${e.name}/${e.name}.md`;
  const plan = `.roll/features/${e.name}/${e.name}-plan.md`;
  if (docs.length === 0) {
    return (
      `<section class="epic-docs empty-docs">` +
      `<h2>${bi("Design docs", "设计文档")}</h2>` +
      `<p class="empty">${bi("No epic-root design docs yet", "暂无 epic 根设计文档")} · ` +
      `<code>${esc(overview)}</code> / <code>${esc(plan)}</code></p>` +
      `</section>\n`
    );
  }
  const missingOverview = docs.some((doc) => doc.kind === "overview")
    ? ""
    : `<p class="empty overview-hint">${bi("No overview doc yet", "暂无总览文档")} · <code>${esc(overview)}</code></p>`;
  return (
    `<section class="epic-docs">` +
    `<h2>${bi("Design docs", "设计文档")}</h2>` +
    `<div class="epic-doclinks">` +
    docs.map((doc) =>
      `<a class="epic-doc ${doc.kind}" href="${esc(doc.href)}">` +
      `<span class="doc-kind">${docKindLabel(doc)}</span>` +
      `<span class="doc-title">${esc(doc.title)}</span>` +
      `<code>${esc(doc.file)}</code>` +
      `</a>`,
    ).join("") +
    `</div>` +
    missingOverview +
    `</section>\n`
  );
}

/** Epic-level ledger (figures scoped to this epic).
 *  US-DOSSIER-025: the figures read the ladder — Attested (merge + full evidence)
 *  and Merged (merge truth, attest pending) together are `e.delivered`, so the
 *  aggregate stays consistent and never double-counts; the wish→truth bar still
 *  shows `delivered / total` so % matches the front-page spectrum. */
function epicLedger(e: DossierEpic): string {
  const total = e.stories.length;
  const pct = total > 0 ? Math.round((e.delivered / total) * 100) : 0;
  let attested = 0;
  for (const s of e.stories) if (storyState(s) === "attested") attested += 1;
  const merged = e.delivered - attested; // delivered split: attested + merged-only
  const fig = (num: string, en: string, zh: string, truthy = false): string =>
    `<div class="figure"><div class="num${truthy ? " truth" : ""}">${num}</div><div class="lbl">${bi(en, zh)}</div></div>`;
  return (
    `<div class="ledger"><div class="figures">` +
    fig(String(total), "Stories", "故事") +
    fig(String(attested), "Attested", "已验收", true) +
    fig(String(merged), "Merged only", "仅已合") +
    fig(String(total - e.delivered), "Still wish", "仍是愿望") +
    `</div>` +
    `<div class="wt-bar" role="img" aria-label="${pct}% merged"><span class="truth" style="width:${pct}%"></span></div>` +
    `<div class="wt-legend"><span>${bi("wish — backlog", "愿望 · 待办")}</span><span>${pct}%</span><span>${bi("truth — merged", "事实 · 已合")}</span></div>` +
    `</div>`
  );
}

/** Render one epic's page from the dossier model.
 *  US-DOSSIER-025: rows are grouped under the claimed→merged→attested ladder
 *  rungs (attested / merged / claimed) plus the preserved drift + unknown groups
 *  — the SAME rungs the front-page spectrum and the story dossier carry. Headings
 *  are bilingual on separate lines (`bi`) and empty groups are omitted. */
export function renderEpicPage(e: DossierEpic): string {
  const at = (st: StoryState): DossierStory[] => e.stories.filter((s) => storyState(s) === st);
  const attested = at("attested");
  const merged = at("merged");
  const claimed = at("claimed");
  const drift = at("fail");
  const unknown = at("unknown");
  const group = (en: string, zh: string, list: DossierStory[]): string =>
    list.length === 0
      ? ""
      : `<h2>${bi(en, zh)}</h2>\n<div class="story-rows">${list.map(storyRow).join("\n")}</div>\n`;
  return (
    `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${esc(e.name)} · Delivery Dossier</title>\n` +
    `<style>\n${CHROME_CSS}${DOSSIER_CSS}${LADDER_CSS}body { max-width:1000px; }\n</style>\n` +
    `${CHROME_SCRIPT}\n</head>\n<body>\n${CHROME_CONTROLS}\n` +
    `<div class="masthead">\n` +
    `<p class="crumb"><a href="../index.html#backlog">${bi("Backlog", "待办")}</a> / ${esc(e.name)}</p>\n` +
    `<p class="kicker">Roll · ${bi("Epic Dossier", "史诗档案")}</p>\n` +
    `<h1>${esc(e.name)}</h1>\n` +
    `</div>\n` +
    epicLedger(e) +
    epicDocs(e) +
    group("Merged & attested", "已合主干 · 已验收", attested) +
    group("Merged to main", "已合主干 — 尚未验收", merged) +
    group("Claimed only", "仅声称 — 尚无合并证据", claimed) +
    group("Truth drift", "真相漂移", drift) +
    group("Unknown", "未知", unknown) +
    `<footer>${bi("Generated by", "生成自")} <code>roll index</code></footer>\n</body>\n</html>\n`
  );
}
