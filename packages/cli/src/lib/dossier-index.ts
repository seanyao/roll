/**
 * US-DOSSIER-001a — the Features Index landing page, rebuilt as the Delivery
 * Dossier front page. The page exists to make one thing legible in ten
 * seconds: backlog is *wish*, main is *truth*, and how much wish has become
 * truth — per project (ledger) and per epic (cards).
 *
 * Layout: masthead (kicker + serif H1 + lede) → ledger (4 figures +
 * wish→truth bar) → lifecycle spine motif → toolbar (search + only-shipping)
 * → epic cards in two groups ("Shipping to main", then "In backlog").
 * Self-contained single file: chrome script + dossier filter script only.
 */
import { CHROME_CONTROLS, CHROME_CSS, CHROME_SCRIPT, bi } from "@roll/core";
import { type DossierEpic } from "./archive.js";
import { DOSSIER_CSS, DOSSIER_FILTER_SCRIPT } from "./dossier-css.js";

/** The five lifecycle stations, shared with epic/story pages (001b/001c). */
export const SPINE_STAGES = [
  { key: "definition", en: "Definition", zh: "立项" },
  { key: "design", en: "Design", zh: "设计" },
  { key: "execution", en: "Execution", zh: "执行" },
  { key: "delivery", en: "Delivery", zh: "交付" },
  { key: "retrospective", en: "Retrospective", zh: "复盘" },
] as const;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The decorative full spine on index/epic mastheads — delivery carries the truth badge. */
export function spineMotif(): string {
  const nodes = SPINE_STAGES.map((s, i) => {
    const cls = s.key === "delivery" ? " truth" : "";
    const seg = i < SPINE_STAGES.length - 1 ? `<span class="seg"></span>` : "";
    return `<span class="node${cls}"><span class="dot"></span><span class="tag">${bi(s.en, s.zh)}</span></span>${seg}`;
  });
  return `<div class="spine" aria-hidden="true">${nodes.join("")}</div>`;
}

/** Project-level ledger: 4 figures + wish→truth bar. */
function ledger(epics: DossierEpic[]): string {
  const total = epics.reduce((n, e) => n + e.stories.length, 0);
  const truth = epics.reduce((n, e) => n + e.delivered, 0);
  const shipping = epics.filter((e) => e.delivered > 0).length;
  const pct = total > 0 ? Math.round((truth / total) * 100) : 0;
  const fig = (num: string, en: string, zh: string, truthy = false): string =>
    `<div class="figure"><div class="num${truthy ? " truth" : ""}">${num}</div><div class="lbl">${bi(en, zh)}</div></div>`;
  return (
    `<div class="ledger">` +
    `<div class="figures">` +
    fig(String(epics.length), "Epics", "史诗") +
    fig(String(total), "Stories tracked", "在册故事") +
    fig(String(truth), "Merged to main", "已合主干", true) +
    fig(String(shipping), "Epics shipping", "交付中史诗") +
    `</div>` +
    `<div class="wt-bar" role="img" aria-label="${pct}% merged"><span class="truth" style="width:${pct}%"></span></div>` +
    `<div class="wt-legend"><span>${bi("wish — backlog", "愿望 · 待办")}</span><span>${pct}%</span><span>${bi("truth — merged", "事实 · 已合")}</span></div>` +
    `</div>`
  );
}

/** One epic card: name, tally, progress bar, story chips. */
function epicCard(e: DossierEpic): string {
  const pct = e.stories.length > 0 ? Math.round((e.delivered / e.stories.length) * 100) : 0;
  const chips = e.stories
    .map(
      (s) =>
        `<a class="chip${s.delivered ? " truth" : ""}" href="${encodeURIComponent(e.name)}/${encodeURIComponent(s.id)}/index.html" title="${esc(s.title ?? s.id)}">${esc(s.id)}</a>`,
    )
    .join("");
  return (
    `<div class="epic-card" data-search="${esc(`${e.name} ${e.stories.map((s) => `${s.id} ${s.title ?? ""}`).join(" ")}`)}" data-truth="${e.delivered > 0 ? "1" : "0"}">` +
    `<h3><a href="${encodeURIComponent(e.name)}/index.html">${esc(e.name)}</a></h3>` +
    `<div class="stat">${bi(`${e.delivered} / ${e.stories.length} delivered`, `${e.delivered} / ${e.stories.length} 已交付`)}</div>` +
    `<div class="epic-bar"><span class="truth" style="width:${pct}%"></span></div>` +
    `<div class="chips">${chips}</div>` +
    `</div>`
  );
}

/** Render the Delivery Dossier front page from the collected model. */
export function renderFeaturesIndex(epics: DossierEpic[], opts: { morningReportHref?: string } = {}): string {
  const shipping = epics.filter((e) => e.delivered > 0);
  const backlog = epics.filter((e) => e.delivered === 0);
  const group = (title: string, zh: string, list: DossierEpic[]): string =>
    list.length === 0
      ? ""
      : `<h2>${bi(title, zh)}</h2>\n<div class="epic-grid">${list.map(epicCard).join("\n")}</div>\n`;
  return (
    `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>Roll · Delivery Dossier</title>\n` +
    `<style>\n${CHROME_CSS}${DOSSIER_CSS}body { max-width:1000px; }\n</style>\n` +
    `${CHROME_SCRIPT}\n${DOSSIER_FILTER_SCRIPT}\n</head>\n<body>\n${CHROME_CONTROLS}\n` +
    `<div class="masthead">\n` +
    `<p class="kicker">Roll · ${bi("Delivery Dossier", "交付档案")}</p>\n` +
    `<h1>${bi("Features Index", "功能档案")}</h1>\n` +
    `<p class="lede">${bi(
      "The backlog is a <em>wish</em>; main is the <em>truth</em>. A story is done only when it has merged — this ledger keeps the two honest.",
      "待办是<em>愿望</em>，主干是<em>事实</em>。故事只有合入主干才算完成——这本账让两者互相对得上。",
    )}</p>\n` +
    `</div>\n` +
    ledger(epics) +
    spineMotif() +
    (opts.morningReportHref !== undefined
      ? `<p class="ops-link"><a href="${esc(opts.morningReportHref)}">${bi("Morning report", "夜间运行晨报")}</a></p>\n`
      : "") +
    `<div class="toolbar">` +
    `<input type="search" data-dossier-search placeholder="Search · 搜索" aria-label="search">` +
    `<label class="only"><input type="checkbox" data-dossier-only>${bi("Only shipping", "只看交付中")}</label>` +
    `</div>\n` +
    group("Shipping to main", "交付中", shipping) +
    group("In backlog", "仍在待办", backlog) +
    `<footer>${bi("Generated by", "生成自")} <code>roll index</code></footer>\n</body>\n</html>\n`
  );
}
