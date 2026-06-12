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
import { type DossierEpic, type DossierEpicDoc, type DossierStory } from "./archive.js";
import { DOSSIER_CSS } from "./dossier-css.js";
import { SPINE_STAGES } from "./dossier-index.js";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Story state: merged truth > mid-cycle (evidence exists, no latest) > backlog. */
export type StoryState = "merged" | "cycle" | "backlog" | "fail" | "unknown";

/** Derive the story's display state. 001a's minimal model knows truth (latest)
 *  and wish; "in a cycle" arrives with 001d's phase data — until then a story
 *  with any non-definition phase marked done counts as mid-cycle. */
export function storyState(s: DossierStory & { inCycle?: boolean }): StoryState {
  if (s.truthState === "fail") return "fail";
  if (s.truthState === "unknown") return "unknown";
  if (s.delivered) return "merged";
  if (s.status === "done") return "unknown";
  if (s.inCycle === true) return "cycle";
  return "backlog";
}

/** The 5-dot mini-spine: filled up to the story's current station. */
export function miniSpine(s: DossierStory & { phasesDone?: number }): string {
  // truth ⇒ all five; otherwise definition always done + phasesDone extra.
  const done = s.delivered ? SPINE_STAGES.length : 1 + (s.phasesDone ?? 0);
  const bits = SPINE_STAGES.map((st, i) => {
    const cls = s.delivered && st.key === "delivery" ? "truth" : i < done ? "done" : "";
    const seg = i < SPINE_STAGES.length - 1 ? `<s${i < done - 1 ? ' class="done"' : ""}></s>` : "";
    return `<i${cls !== "" ? ` class="${cls}"` : ""}></i>${seg}`;
  });
  return `<span class="mini-spine" aria-hidden="true">${bits.join("")}</span>`;
}

function pill(state: StoryState): string {
  if (state === "merged") return `<span class="pill merged">${bi("merged", "已合主干")}</span>`;
  if (state === "cycle") return `<span class="pill cycle">${bi("in a cycle", "周期中")}</span>`;
  if (state === "fail") return `<span class="pill fail">${bi("truth fail", "真相失败")}</span>`;
  if (state === "unknown") return `<span class="pill unknown">?</span>`;
  return `<span class="pill backlog">${bi("in backlog", "待办")}</span>`;
}

function storyRow(s: DossierStory): string {
  const st = storyState(s);
  return (
    `<a class="story-row" href="${encodeURIComponent(s.id)}/index.html" data-search="${esc(`${s.id} ${s.title ?? ""}`)}" data-truth="${s.delivered ? "1" : "0"}">` +
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

/** Epic-level ledger (figures scoped to this epic). */
function epicLedger(e: DossierEpic): string {
  const total = e.stories.length;
  const pct = total > 0 ? Math.round((e.delivered / total) * 100) : 0;
  const byType = new Set(e.stories.map((s) => s.type)).size;
  const fig = (num: string, en: string, zh: string, truthy = false): string =>
    `<div class="figure"><div class="num${truthy ? " truth" : ""}">${num}</div><div class="lbl">${bi(en, zh)}</div></div>`;
  return (
    `<div class="ledger"><div class="figures">` +
    fig(String(total), "Stories", "故事") +
    fig(String(e.delivered), "Merged to main", "已合主干", true) +
    fig(String(total - e.delivered), "Still wish", "仍是愿望") +
    fig(String(byType), "Work types", "工种") +
    `</div>` +
    `<div class="wt-bar" role="img" aria-label="${pct}% merged"><span class="truth" style="width:${pct}%"></span></div>` +
    `<div class="wt-legend"><span>${bi("wish — backlog", "愿望 · 待办")}</span><span>${pct}%</span><span>${bi("truth — merged", "事实 · 已合")}</span></div>` +
    `</div>`
  );
}

/** Render one epic's page from the dossier model. */
export function renderEpicPage(e: DossierEpic): string {
  const merged = e.stories.filter((s) => storyState(s) === "merged");
  const drift = e.stories.filter((s) => storyState(s) === "fail");
  const unknown = e.stories.filter((s) => storyState(s) === "unknown");
  const cycle = e.stories.filter((s) => storyState(s) === "cycle");
  const backlog = e.stories.filter((s) => storyState(s) === "backlog");
  const group = (en: string, zh: string, list: DossierStory[]): string =>
    list.length === 0
      ? ""
      : `<h2>${bi(en, zh)}</h2>\n<div class="story-rows">${list.map(storyRow).join("\n")}</div>\n`;
  return (
    `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${esc(e.name)} · Delivery Dossier</title>\n` +
    `<style>\n${CHROME_CSS}${DOSSIER_CSS}body { max-width:1000px; }\n</style>\n` +
    `${CHROME_SCRIPT}\n</head>\n<body>\n${CHROME_CONTROLS}\n` +
    `<div class="masthead">\n` +
    `<p class="crumb"><a href="../index.html#backlog">${bi("Backlog", "待办")}</a> / ${esc(e.name)}</p>\n` +
    `<p class="kicker">Roll · ${bi("Epic Dossier", "史诗档案")}</p>\n` +
    `<h1>${esc(e.name)}</h1>\n` +
    `</div>\n` +
    epicLedger(e) +
    epicDocs(e) +
    group("Merged to main", "已合主干", merged) +
    group("Truth drift", "真相漂移", drift) +
    group("Unknown", "未知", unknown) +
    group("In a cycle", "周期中", cycle) +
    group("In backlog", "仍在待办", backlog) +
    `<footer>${bi("Generated by", "生成自")} <code>roll index</code></footer>\n</body>\n</html>\n`
  );
}
