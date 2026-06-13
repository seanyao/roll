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
import { type DeliveryLadder, type StoryEvidenceFlags } from "@roll/spec";
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

type StoryView = DossierEpic["stories"][number];
type State = "done" | "wip" | "hold" | "todo" | "fail" | "unknown";
const STAGE_KEYS = SPINE_STAGES.map((s) => s.key);

export type TruthBoardVerdict = "pass" | "warn" | "fail" | "unknown";

export interface TruthBoardAudit {
  fail: number;
  warn: number;
  unknown: number;
  collectedAt?: string;
}

export interface TruthBoardCycle {
  cycles3d: number;
  failed3d: number;
  costUsd3d: number;
  collectedAt?: string;
}

export interface TruthBoardRelease {
  latestTag?: string;
  verdict: TruthBoardVerdict;
  waiver?: string;
  collectedAt?: string;
}

export interface TruthBoardInput {
  generatedAt?: string;
  collectedAt?: string;
  audit?: TruthBoardAudit;
  cycle?: TruthBoardCycle;
  release?: TruthBoardRelease;
}

export interface RenderFeaturesIndexOptions {
  morningReportHref?: string;
  truth?: TruthBoardInput;
  /** US-DOSSIER-010: the EXACT serialized TruthSnapshot written to truth.json —
   *  embedded verbatim so page data and the machine file cannot diverge. */
  snapshotJson?: string;
}

/** Claim/truth-aligned delivery state for one story (US-DOSSIER-010: exported
 *  as the ONE spectrum classifier every surface shares). */
export function storySpectrumState(s: StoryView): State {
  return storyState(s);
}

/** US-DOSSIER-010: delivered pre-v3 stories without a v3 trail, across epics. */
export function countLegacyStories(epics: DossierEpic[]): number {
  return countLegacy(epics);
}

/**
 * US-DOSSIER-021 — the claim↔truth ladder rung a story has reached, derived from
 * the SAME `delivered` signal `collectDossier` already folds (it bakes in the
 * truth selector + FIX-278 offline merge evidence), never re-deriving merge from
 * scratch:
 *   - `attested` — delivered (merge truth) AND full attest evidence on disk:
 *     a report, an ac-map, and a real-pixel screenshot. The strongest rung.
 *   - `merged`   — delivered (merge truth) but missing some attest evidence —
 *     the honest middle rung, never full green.
 *   - `claimed`  — the backlog claims Done (status==="done") but there is NO
 *     merge evidence (a premature-Done: the selector keeps `delivered` false).
 *   - `"none"`   — not even claimed done (todo / wip / hold / absent).
 */
export function deriveDeliveryLadder(
  story: Pick<StoryView, "delivered" | "status">,
  evidence: StoryEvidenceFlags,
): DeliveryLadder | "none" {
  if (story.delivered) {
    return evidence.report && evidence.acMap && evidence.visualEvidence ? "attested" : "merged";
  }
  return story.status === "done" ? "claimed" : "none";
}

function storyState(s: StoryView): State {
  if (s.truthState === "fail") return "fail";
  if (s.truthState === "unknown") return "unknown";
  if (s.status === "in_progress") return "wip";
  if (s.status === "hold") return "hold";
  if (s.delivered) return "done"; // backlog ✅ Done, or heuristic-delivered
  if (s.status === "done") return "unknown";
  return "todo";
}

/** Count stories by state across a list of epics. */
function tallyStates(epics: DossierEpic[]): Record<State, number> {
  const t: Record<State, number> = { done: 0, wip: 0, hold: 0, todo: 0, fail: 0, unknown: 0 };
  for (const e of epics) for (const s of e.stories) t[storyState(s)] += 1;
  return t;
}

function dataOrQ(v: string | number | undefined): string {
  return v === undefined ? "?" : esc(String(v));
}

function moneyOrQ(v: number | undefined): string {
  return v === undefined ? "?" : `$${v.toFixed(2)}`;
}

function truthBoardVerdict(epics: DossierEpic[], truth: TruthBoardInput | undefined): TruthBoardVerdict {
  const t = tallyStates(epics);
  const audit = truth?.audit;
  const release = truth?.release;
  if ((audit?.fail ?? 0) > 0 || t.fail > 0 || release?.verdict === "fail") return "fail";
  if ((audit?.warn ?? 0) > 0 || release?.verdict === "warn") return "warn";
  if (truth === undefined || audit === undefined || release === undefined || (audit.unknown > 0) || t.unknown > 0 || release.verdict === "unknown") {
    return "unknown";
  }
  return "pass";
}

function storyTruthTile(epics: DossierEpic[]): string {
  const t = tallyStates(epics);
  const total = epics.reduce((n, e) => n + e.stories.length, 0);
  let covered = 0;
  for (const e of epics) {
    for (const s of e.stories) {
      if (s.stages?.includes("delivery") === true || s.delivered) covered += 1;
    }
  }
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0;
  return (
    `<section class="truth-tile story">` +
    `<h2>Story</h2>` +
    `<div class="truth-metric"><b>${pct}%</b><span>${bi("attest coverage", "验收覆盖")}</span></div>` +
    `<dl><dt>${bi("truth fail", "真相失败")}</dt><dd>${t.fail}</dd>` +
    `<dt>${bi("unknown", "未知")}</dt><dd>${t.unknown}</dd></dl>` +
    `</section>`
  );
}

function cycleTruthTile(truth: TruthBoardInput | undefined): string {
  const c = truth?.cycle;
  return (
    `<section class="truth-tile cycle">` +
    `<h2>Cycle</h2>` +
    `<div class="truth-metric"><b>${dataOrQ(c?.cycles3d)}</b><span>${bi("cycles / 3d", "近 3 天周期")}</span></div>` +
    `<dl><dt>${bi("failed", "失败")}</dt><dd>${dataOrQ(c?.failed3d)}</dd>` +
    `<dt>${bi("cost", "花费")}</dt><dd>${moneyOrQ(c?.costUsd3d)}</dd></dl>` +
    `</section>`
  );
}

function releaseTruthTile(truth: TruthBoardInput | undefined): string {
  const r = truth?.release;
  return (
    `<section class="truth-tile release ${r?.verdict ?? "unknown"}">` +
    `<h2>Release</h2>` +
    `<div class="truth-metric"><b>${dataOrQ(r?.latestTag)}</b><span>${bi("latest tag", "最近标签")}</span></div>` +
    `<dl><dt>${bi("verdict", "判定")}</dt><dd>${dataOrQ(r?.verdict)}</dd>` +
    `<dt>${bi("waiver", "豁免")}</dt><dd>${dataOrQ(r?.waiver)}</dd></dl>` +
    `</section>`
  );
}

export function renderTruthBoard(epics: DossierEpic[], truth: TruthBoardInput | undefined): string {
  const verdict = truthBoardVerdict(epics, truth);
  const audit = truth?.audit;
  const collectedAt = truth?.collectedAt ?? audit?.collectedAt ?? truth?.cycle?.collectedAt ?? truth?.release?.collectedAt;
  const release = truth?.release;
  const verdictText = verdict === "pass" ? bi("all clear", "全部通过") : verdict;
  return (
    `<section class="truth-board" data-truth-board="${verdict}">` +
    `<div class="truth-strip ${verdict}">` +
    `<span class="truth-label">${bi("Truth", "真相")}</span>` +
    `<strong>${verdictText}</strong>` +
    `<span>${bi("audit", "审计")} f:${dataOrQ(audit?.fail)} w:${dataOrQ(audit?.warn)} ?:${dataOrQ(audit?.unknown)}</span>` +
    `<span>${bi("release", "发版")} ${dataOrQ(release?.verdict)}${release?.waiver !== undefined ? ` · ${bi("waiver", "豁免")} ${esc(release.waiver)}` : ""}</span>` +
    `<span>${bi("generated", "生成")} ${dataOrQ(truth?.generatedAt)}</span>` +
    `<span>${bi("collected", "采集")} ${dataOrQ(collectedAt)}</span>` +
    `</div>` +
    `<div class="truth-tiles">${storyTruthTile(epics)}${cycleTruthTile(truth)}${releaseTruthTile(truth)}</div>` +
    `</section>`
  );
}

/** A segmented proportional bar (the "delivery spectrum") over a state tally. */
function spectrum(t: Record<State, number>, cls: string): string {
  const total = t.done + t.wip + t.todo + t.hold + t.fail + t.unknown || 1;
  const seg = (n: number, k: string): string =>
    n > 0 ? `<span class="s-${k}" style="width:${(n / total) * 100}%"></span>` : "";
  return `<div class="${cls}">${seg(t.done, "done")}${seg(t.fail, "fail")}${seg(t.unknown, "unknown")}${seg(t.wip, "wip")}${seg(t.todo, "todo")}${seg(t.hold, "hold")}</div>`;
}

/** The five-station lifecycle spine for one story, from its real `stages`. */
function storySpine(s: StoryView): string {
  // US-DOSSIER-008: a pre-v3 legacy delivery has no v3 evidence trail, so the
  // evidence-based spine would render bare and read as half-finished. Show the
  // whole spine in a uniform muted "legacy done" state instead of lying either way.
  if (s.legacy) {
    let lh = "";
    STAGE_KEYS.forEach((_, i) => {
      lh += `<i></i>`;
      if (i < STAGE_KEYS.length - 1) lh += `<b></b>`;
    });
    return `<span class="lifespine legacy" title="历史交付 · pre-v3，无 v3 留痕 / legacy delivery">${lh}</span>`;
  }
  // Enriched `stages` win; absent (un-enriched render) → derive from delivered.
  const done = new Set<string>(
    s.stages ?? (s.delivered ? ["definition", "design", "execution", "delivery"] : ["definition"]),
  );
  const state = storyState(s);
  const firstUndone = STAGE_KEYS.findIndex((k) => !done.has(k));
  const active = state === "wip" || state === "hold";
  let html = "";
  STAGE_KEYS.forEach((k, i) => {
    const cls = done.has(k) ? "on" : active && i === firstUndone ? "now" : "";
    html += `<i class="${cls}"></i>`;
    if (i < STAGE_KEYS.length - 1) {
      const segOn = done.has(k) && done.has(STAGE_KEYS[i + 1]!);
      html += `<b class="${segOn ? "on" : ""}"></b>`;
    }
  });
  const title = SPINE_STAGES.map((st) => `${st.zh}${done.has(st.key) ? "✓" : "—"}`).join(" ");
  return `<span class="lifespine${state === "hold" ? " held" : ""}" title="${title}">${html}</span>`;
}

/** One story row inside an expanded epic: type · id · title · spine · status. */
function storyRow(epic: string, s: StoryView): string {
  const state = storyState(s);
  const type = (s.type || "").toUpperCase();
  const href = `${encodeURIComponent(epic)}/${encodeURIComponent(s.id)}/index.html`;
  const claim = s.status !== undefined ? `<span class="sclaim cl-${state}">claim ${s.status === "in_progress" ? "wip" : s.status}</span>` : "";
  const truthText = state === "unknown" ? "truth ?" : state === "fail" ? "truth fail" : s.delivered ? "truth done" : "";
  const truth = truthText !== "" ? `<span class="struth tr-${state}" title="${esc(s.truthReason ?? "")}">${truthText}</span>` : "";
  // US-DOSSIER-008: legacy (pre-v3) deliveries are done, but flagged apart.
  const chip = s.legacy
    ? `<span class="slegacy" title="历史交付：pre-v3 已完成，无 v3 证据链">${bi("legacy", "历史")}</span>`
    : "";
  return (
    `<a class="story${s.legacy ? " is-legacy" : ""}" href="${href}" data-status="${state}">` +
    `<span class="stype ${esc(type)}">${esc(type)}</span>` +
    `<span class="sid">${esc(s.id)}</span>` +
    `<span class="stitle">${esc(s.title ?? s.id)}</span>` +
    storySpine(s) +
    `<span class="sstat st-${state}"><span class="sdot"></span>${state}${chip}${claim}${truth}</span>` +
    `</a>`
  );
}

/** One epic as a foldable <details>: summary (name + mini-spectrum + tally),
 *  body = its story rows. data-search/data-status drive the toolbar filter. */
function epicFold(e: DossierEpic): string {
  const t = tallyStates([e]);
  const states = [...new Set(e.stories.map(storyState))].join(" ");
  const search = `${e.name} ${e.stories.map((s) => `${s.id} ${s.title ?? ""}`).join(" ")}`;
  const hasOverview = (e.docs ?? []).some((d) => d.kind === "overview");
  const docMark = hasOverview
    ? `<span class="epic-docmark has-overview">${bi("overview", "总览")}</span>`
    : `<span class="epic-docmark no-overview">${bi("no overview", "无总览")}</span>`;
  return (
    `<details class="epic" data-search="${esc(search)}" data-status="${states}" data-truth="${e.delivered > 0 ? "1" : "0"}">` +
    `<summary class="epic-sum">` +
    `<span class="caret">▸</span>` +
    `<span class="epic-main">` +
    `<span class="epic-name"><a href="${encodeURIComponent(e.name)}/index.html">${esc(e.name)}</a>${docMark}</span>` +
    spectrum(t, "epic-mini") +
    `</span>` +
    `<span class="epic-tally"><b>${e.delivered}</b><span class="of"> / ${e.stories.length}</span></span>` +
    `</summary>` +
    `<div class="stories">${e.stories.map((s) => storyRow(e.name, s)).join("")}</div>` +
    `</details>`
  );
}

/** Count delivered stories that are legacy (pre-v3, no v3 evidence trail). */
function countLegacy(epics: DossierEpic[]): number {
  let n = 0;
  for (const e of epics) for (const s of e.stories) if (s.legacy) n += 1;
  return n;
}

/** The pulled-out status overview: tallies + the delivery spectrum. */
function overview(epics: DossierEpic[]): string {
  const t = tallyStates(epics);
  const total = epics.reduce((n, e) => n + e.stories.length, 0);
  const pct = total > 0 ? Math.round((t.done / total) * 100) : 0;
  // US-DOSSIER-008: split the Done tally so "v3-evidenced done" and "legacy
  // (pre-v3) done" are legible at a glance instead of lumped together.
  const legCount = countLegacy(epics);
  const card = (k: State, mark: string, en: string, zh: string, sub = ""): string =>
    `<a class="tally ${k}" href="#" data-jump="${k}"><div class="mark">${mark}</div>` +
    `<div class="num">${t[k]}</div><div class="lbl">${bi(en, zh)}</div>${sub}<div class="accentbar"></div></a>`;
  const leg = (k: string, en: string, zh: string): string =>
    `<span><i class="i-${k}"></i>${bi(en, zh)}</span>`;
  return (
    `<div class="statusboard">` +
    card("done", "✅", "Done", "已交付", legCount > 0 ? `<div class="tsub">${bi(`incl. ${legCount} legacy`, `含 ${legCount} 历史`)}</div>` : "") +
    card("fail", "!", "Drift", "漂移") +
    card("unknown", "?", "Unknown", "未知") +
    card("wip", "🔨", "In progress", "进行中") +
    card("todo", "📋", "Todo", "待办") +
    card("hold", "🔒", "Hold", "挂起") +
    `</div>` +
    `<div class="spectrum-wrap">` +
    spectrum(t, "spectrum") +
    `<div class="pctline">${bi(`${total} stories · ${epics.length} epics`, `在册 ${total} 故事 · ${epics.length} 史诗`)}` +
    `<span><b>${pct}%</b> ${bi("merged to main", "已合主干")}</span></div>` +
    `<div class="spectrum-legend">${leg("done", "merged", "已合")}${leg("fail", "drift", "漂移")}${leg("unknown", "unknown", "未知")}${leg("wip", "in progress", "进行中")}${leg("todo", "todo", "待办")}${leg("hold", "hold", "挂起")}</div>` +
    `</div>`
  );
}

/** Render the Delivery Dossier front page — a delivery board: a pulled-out
 *  status overview (tallies + spectrum), then foldable epics grouped by their
 *  aggregate state, each story carrying its lifecycle spine + backlog status. */
/** US-DOSSIER-011: the searchable ledger (toolbar + epic groups) as a fragment —
 *  the Truth Console embeds it under the Backlog tab until US-DOSSIER-012
 *  redesigns that surface. Same markup the legacy front page renders. */
export function featuresLedgerFragment(epics: DossierEpic[]): string {
  const done = epics.filter((e) => e.stories.length > 0 && e.delivered === e.stories.length);
  const shipping = epics.filter((e) => e.delivered > 0 && e.delivered < e.stories.length);
  const backlog = epics.filter((e) => e.delivered === 0);
  const group = (title: string, zh: string, list: DossierEpic[]): string =>
    list.length === 0
      ? ""
      : `<div class="section-h">${bi(title, zh)} <span class="ct">${list.length}</span><span class="rule"></span></div>\n` +
        `${list.map(epicFold).join("\n")}\n`;
  return (
    `<div class="toolbar">` +
    `<input type="search" data-dossier-search placeholder="Search epics &amp; stories · 搜索史诗与故事" aria-label="search">` +
    `<div class="statusfilter" role="group">` +
    `<button class="sf done" data-sf="done" aria-pressed="false">✅ ${bi("Done", "交付")}</button>` +
    `<button class="sf fail" data-sf="fail" aria-pressed="false">! ${bi("Drift", "漂移")}</button>` +
    `<button class="sf unknown" data-sf="unknown" aria-pressed="false">? ${bi("Unknown", "未知")}</button>` +
    `<button class="sf wip" data-sf="wip" aria-pressed="false">🔨 ${bi("WIP", "进行")}</button>` +
    `<button class="sf todo" data-sf="todo" aria-pressed="false">📋 ${bi("Todo", "待办")}</button>` +
    `<button class="sf hold" data-sf="hold" aria-pressed="false">🔒 ${bi("Hold", "挂起")}</button>` +
    `</div></div>\n` +
    group("Shipping to main", "交付中", shipping) +
    group("Delivered to main", "已交付", done) +
    group("In backlog", "仍在待办", backlog)
  );
}

export function renderFeaturesIndex(epics: DossierEpic[], opts: RenderFeaturesIndexOptions = {}): string {
  const done = epics.filter((e) => e.stories.length > 0 && e.delivered === e.stories.length);
  const shipping = epics.filter((e) => e.delivered > 0 && e.delivered < e.stories.length);
  const backlog = epics.filter((e) => e.delivered === 0);
  const group = (title: string, zh: string, list: DossierEpic[]): string =>
    list.length === 0
      ? ""
      : `<div class="section-h">${bi(title, zh)} <span class="ct">${list.length}</span><span class="rule"></span></div>\n` +
        `${list.map(epicFold).join("\n")}\n`;
  return (
    `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>Roll · Delivery Dossier</title>\n` +
    `<style>\n${CHROME_CSS}${DOSSIER_CSS}body { max-width:1040px; }\n</style>\n` +
    `${CHROME_SCRIPT}\n${DOSSIER_FILTER_SCRIPT}\n</head>\n<body>\n${CHROME_CONTROLS}\n` +
    `<div class="masthead">\n` +
    `<p class="kicker">Roll · ${bi("Delivery Dossier", "交付档案")}</p>\n` +
    `<h1>${bi("Features Index", "功能档案")}</h1>\n` +
    `<p class="lede">${bi(
      "The backlog is a <em>wish</em>; main is the <em>truth</em>. A story is done only when it has merged — this board keeps the two honest.",
      "待办是<em>愿望</em>，主干是<em>事实</em>。故事只有合入主干才算完成——这块看板让两者互相对得上。",
    )}</p>\n` +
    `</div>\n` +
    renderTruthBoard(epics, opts.truth) +
    overview(epics) +
    (opts.morningReportHref !== undefined
      ? `<p class="ops-link"><a href="${esc(opts.morningReportHref)}">${bi("Morning report", "夜间运行晨报")}</a></p>\n`
      : "") +
    `<div class="toolbar">` +
    `<input type="search" data-dossier-search placeholder="Search epics &amp; stories · 搜索史诗与故事" aria-label="search">` +
    `<div class="statusfilter" role="group">` +
    `<button class="sf done" data-sf="done" aria-pressed="false">✅ ${bi("Done", "交付")}</button>` +
    `<button class="sf fail" data-sf="fail" aria-pressed="false">! ${bi("Drift", "漂移")}</button>` +
    `<button class="sf unknown" data-sf="unknown" aria-pressed="false">? ${bi("Unknown", "未知")}</button>` +
    `<button class="sf wip" data-sf="wip" aria-pressed="false">🔨 ${bi("WIP", "进行")}</button>` +
    `<button class="sf todo" data-sf="todo" aria-pressed="false">📋 ${bi("Todo", "待办")}</button>` +
    `<button class="sf hold" data-sf="hold" aria-pressed="false">🔒 ${bi("Hold", "挂起")}</button>` +
    `</div></div>\n` +
    group("Shipping to main", "交付中", shipping) +
    group("Delivered to main", "已交付", done) +
    group("In backlog", "仍在待办", backlog) +
    `<footer>${bi("Generated by", "生成自")} <code>roll index</code></footer>\n` +
    // US-DOSSIER-010: the machine-readable snapshot, byte-equal to truth.json
    // (the same serialized string; `</` escaped so JSON can never close the tag).
    (opts.snapshotJson !== undefined
      ? `<script id="roll-truth" type="application/json">\n${opts.snapshotJson.replace(/<\//g, "<\\/")}</script>\n`
      : "") +
    `</body>\n</html>\n`
  );
}
