/**
 * US-DOSSIER-011 — the Truth Console: index.html becomes a single-page,
 * five-tab control board (Overview · Loop · Release · Backlog · Skills,
 * ordered "now → just ran → about to → wishes → machine layer").
 *
 * Faithful to the owner-approved high-fidelity prototype
 * (.roll/features/delivery-dossier/truth-console-design/Delivery Dossier.dc.html):
 * light theme, IBM Plex Sans/Mono, dark sticky header with the project name +
 * EN/中 toggle, sticky tabs, and an Overview a reader digests in thirty
 * seconds — verdict strip, loop heartbeat, three aggregate tiles, six-state
 * spectrum. Every number is read from the ONE TruthSnapshot (US-DOSSIER-010),
 * so the page can never disagree with truth.json.
 *
 * Tab state survives drill-downs via the URL hash (#overview/#loop/#release/
 * #backlog/#skills): browser Back restores it without any storage.
 *
 * This card lands the shell + Overview; Loop/Release/Skills carry placeholders
 * (US-DOSSIER-013/015/017 fill them) and Backlog embeds the existing ledger
 * (US-DOSSIER-012 redesigns it).
 */
import type { TruthSnapshot, TruthSnapshotLoopLane } from "@roll/spec";

export interface TruthConsoleBrand {
  /** Injected, never hardcoded (owner ruling): project name + slogan. */
  name: string;
  slogan: string;
}

export interface TruthConsoleInput {
  snapshot: TruthSnapshot;
  /** The EXACT serialized snapshot written to truth.json (US-DOSSIER-010). */
  snapshotJson: string;
  brand: TruthConsoleBrand;
  /** Existing ledger fragment (toolbar + epic groups) for the Backlog tab. */
  backlogFragment: string;
  /** Scripts the backlog fragment needs (search/filter). */
  backlogScript: string;
  /** Styles the backlog fragment needs (ledger CSS). */
  backlogStyle?: string;
}

const MONO = `font-family:'IBM Plex Mono',monospace;`;
const C = {
  bg: "#eef1f5",
  ink: "#161b26",
  body: "#3a4252",
  sub: "#525c6e",
  dim: "#8a93a3",
  faint: "#9aa3b2",
  line: "#e0e5ee",
  hair: "#eef1f5",
  card: "#fff",
  blue: "#2d54e8",
  green: "#178a52",
  amber: "#c77d12",
  red: "#c2402a",
  purple: "#7048bc",
  slate: "#727c8e",
};

/** bi() with the console's own class names (kept compatible with roll-lang). */
function bi(en: string, zh: string): string {
  return `<span class="lang-en">${en}</span><span class="lang-zh">${zh}</span>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SPECTRUM_META: Record<string, { color: string; mark: string; en: string; zh: string; subEn: string; subZh: string }> = {
  done: { color: C.green, mark: "✓", en: "DONE", zh: "已交付", subEn: "merged to main", subZh: "已合主干" },
  fail: { color: C.red, mark: "!", en: "DRIFT", zh: "漂移", subEn: "claim ≠ truth", subZh: "声明≠真相" },
  unknown: { color: C.slate, mark: "?", en: "UNKNOWN", zh: "未知", subEn: "no evidence", subZh: "无证据" },
  wip: { color: C.blue, mark: "●", en: "WIP", zh: "进行中", subEn: "being built", subZh: "建造中" },
  todo: { color: C.amber, mark: "○", en: "TODO", zh: "待办", subEn: "still a wish", subZh: "仍是愿望" },
  hold: { color: C.purple, mark: "⏸", en: "HOLD", zh: "挂起", subEn: "parked", subZh: "停放" },
};
const SPECTRUM_ORDER = ["done", "fail", "unknown", "wip", "todo", "hold"] as const;

function consoleVerdict(s: TruthSnapshot): { word: string; color: string; noteEn: string; noteZh: string } {
  const a = s.audit;
  if (a === undefined) return { word: "UNKNOWN", color: C.slate, noteEn: "no consistency audit yet", noteZh: "尚无一致性审计" };
  if (a.fail > 0) return { word: "FAIL", color: C.red, noteEn: "a dimension is failing", noteZh: "有维度不通过" };
  if (a.warn > 0) return { word: "WARN", color: C.amber, noteEn: "warnings to triage", noteZh: "有警告待处理" };
  return { word: "PASS", color: C.green, noteEn: "all dimensions clear", noteZh: "全维度通过" };
}

function chip(k: string, v: string, color: string): string {
  return (
    `<span style="${MONO}font-size:12px;display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border:1px solid ${color}33;border-radius:999px;color:${color};background:${color}0d;">` +
    `<b style="font-weight:600;">${k}</b>&nbsp;${v}</span>`
  );
}

function kicker(text: string): string {
  return `<div style="${MONO}font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:${C.blue};font-weight:600;">${text}</div>`;
}

function sectionLabel(text: string): string {
  return `<span style="${MONO}font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:${C.faint};font-weight:600;">${text}</span>`;
}

function mins(n: number | undefined): string {
  if (n === undefined) return "—";
  return n >= 60 && n % 60 === 0 ? `${n / 60}h` : `${n}m`;
}

function shortTs(iso: string | undefined): string {
  if (iso === undefined || iso === "") return "—";
  return iso.replace(/^\d{4}-/, "").replace("T", " ").replace(/:\d{2}Z$/, "Z");
}

function heartbeatRow(lane: TruthSnapshotLoopLane): string {
  const on = lane.running;
  const dot = on
    ? `width:9px;height:9px;border-radius:50%;background:${C.green};box-shadow:0 0 0 3px rgba(23,138,82,.18);animation:beat 2.4s infinite;flex:none;`
    : `width:9px;height:9px;border-radius:50%;background:#cbd2dc;flex:none;`;
  const cell = (label: string, value: string, mono = false): string =>
    `<div><div style="${MONO}font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:${C.faint};">${label}</div>` +
    `<div style="${mono ? MONO : ""}font-size:12.5px;color:${C.body};margin-top:3px;">${value}</div></div>`;
  return (
    `<div style="display:grid;grid-template-columns:230px repeat(4,1fr);align-items:center;gap:14px;padding:13px 18px;border-top:1px solid #f4f6f9;">` +
    `<div style="display:flex;align-items:center;gap:11px;min-width:0;"><span style="${dot}"></span>` +
    `<div style="min-width:0;"><div style="font-size:13.5px;font-weight:600;color:${C.ink};white-space:nowrap;">${esc(lane.name)}</div>` +
    `<div style="${MONO}font-size:10.5px;color:${on ? C.green : C.faint};margin-top:1px;white-space:nowrap;">${on ? bi("running", "运行中") : bi("off", "未启用")}</div></div></div>` +
    cell(bi("mode", "模式"), esc(lane.mode ?? "—")) +
    cell(bi("every", "周期"), mins(lane.everyMin)) +
    cell(bi("last", "上次"), shortTs(lane.lastAt), true) +
    cell(bi("next", "下次"), shortTs(lane.nextAt), true) +
    `</div>`
  );
}

function tile(opts: {
  tab: string;
  label: string;
  badge: string;
  badgeColor: string;
  metric: string;
  metricColor: string;
  metricSub: string;
  rows: Array<[string, string, string]>;
}): string {
  return (
    `<a href="#${opts.tab}" data-tab-link="${opts.tab}" style="border:1px solid ${C.line};border-radius:12px;background:${C.card};padding:16px 18px 14px;box-shadow:0 1px 2px rgba(17,26,69,.05);cursor:pointer;text-decoration:none;display:block;">` +
    `<div style="display:flex;align-items:center;justify-content:space-between;">` +
    `<span style="${MONO}font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:${C.faint};font-weight:600;">${opts.label}</span>` +
    `<span style="${MONO}font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid ${opts.badgeColor}44;color:${opts.badgeColor};">${opts.badge}</span></div>` +
    `<div style="display:flex;align-items:baseline;gap:8px;margin:13px 0 12px;">` +
    `<span style="font-size:30px;font-weight:700;letter-spacing:-.02em;color:${opts.metricColor};font-variant-numeric:tabular-nums;${MONO}">${opts.metric}</span>` +
    `<span style="font-size:11.5px;color:${C.dim};line-height:1.25;">${opts.metricSub}</span></div>` +
    `<dl style="display:grid;grid-template-columns:1fr auto;gap:6px 12px;margin:0;${MONO}font-size:11.5px;">` +
    opts.rows.map(([k, v, color]) => `<dt style="color:${C.dim};">${k}</dt><dd style="margin:0;color:${color};font-weight:600;text-align:right;">${v}</dd>`).join("") +
    `</dl></a>`
  );
}

function overviewTab(input: TruthConsoleInput): string {
  const s = input.snapshot;
  const v = consoleVerdict(s);
  const a = s.audit;
  const lanes = s.loop?.lanes ?? [];
  const spectrum = s.story.spectrum;
  const total = s.story.total || 1;
  const mergedPct = Math.round((spectrum.done / total) * 100);

  const heartbeat =
    `<section style="border:1px solid ${C.line};border-radius:12px;background:${C.card};overflow:hidden;margin:20px 0 14px;box-shadow:0 1px 2px rgba(17,26,69,.05);">` +
    `<div style="display:flex;align-items:center;gap:11px;padding:12px 18px;border-bottom:1px solid ${C.hair};">` +
    sectionLabel(bi("Loop heartbeat", "循环心跳")) +
    `<span style="${MONO}font-size:12.5px;color:${C.ink};font-weight:600;white-space:nowrap;">${lanes.filter((l) => l.running).length}/${lanes.length} ${bi("running", "运行中")}</span>` +
    `<span style="flex:1;"></span>` +
    `<a href="#loop" data-tab-link="loop" style="${MONO}font-size:11.5px;color:${C.blue};cursor:pointer;text-decoration:none;">${bi("open loop", "打开循环页")} →</a></div>` +
    (lanes.length > 0
      ? lanes.map(heartbeatRow).join("")
      : `<div style="padding:14px 18px;font-size:12.5px;color:${C.faint};font-style:italic;">${bi("no scheduled lanes on this machine", "本机没有已调度的 lane")}</div>`) +
    `</section>`;

  const verdictStrip =
    `<section style="margin:22px 0 16px;display:flex;align-items:stretch;gap:0;border:1px solid ${C.line};border-left:4px solid ${v.color};border-radius:12px;background:${C.card};overflow:hidden;box-shadow:0 1px 2px rgba(17,26,69,.05);">` +
    `<div style="padding:16px 20px;display:flex;flex-direction:column;justify-content:center;gap:3px;border-right:1px solid ${C.hair};min-width:182px;">` +
    sectionLabel(bi("Truth verdict", "真相判定")) +
    `<div style="display:flex;align-items:center;gap:9px;"><span data-truth="verdict" style="font-size:25px;font-weight:700;letter-spacing:-.01em;color:${v.color};">${v.word}</span></div>` +
    `<div style="font-size:11.5px;color:${C.dim};">${bi(v.noteEn, v.noteZh)}</div></div>` +
    `<div style="flex:1 1 auto;display:flex;align-items:center;flex-wrap:wrap;gap:9px;padding:14px 20px;">` +
    (a !== undefined
      ? chip("fail", String(a.fail), a.fail > 0 ? C.red : C.green) + chip("warn", String(a.warn), a.warn > 0 ? C.amber : C.green) + chip("?", String(a.unknown), C.slate)
      : `<span style="font-size:12px;color:${C.faint};font-style:italic;">${bi("no audit collected", "未采集审计")}</span>`) +
    `</div>` +
    `<div style="display:flex;flex:none;flex-direction:column;justify-content:center;gap:4px;padding:14px 20px;border-left:1px solid ${C.hair};${MONO}font-size:10.5px;color:${C.faint};text-align:right;white-space:nowrap;">` +
    `<div>${bi("generated", "生成")} <span style="color:#5b6478;">${shortTs(s.generatedAt)}</span></div>` +
    `<div>${bi("collected", "采集")} <span style="color:#5b6478;">${shortTs(s.collectedAt)}</span></div></div></section>`;

  const cyc = s.cycle;
  const rel = s.release;
  const relColor = rel?.verdict === "pass" ? C.green : rel?.verdict === "fail" ? C.red : rel?.verdict === "warn" ? C.amber : C.slate;
  const tiles =
    `<section style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:0 0 8px;">` +
    tile({
      tab: "backlog",
      label: bi("Story", "故事"),
      badge: bi("backlog", "待办页"),
      badgeColor: C.blue,
      metric: String(s.story.total),
      metricColor: C.ink,
      metricSub: bi("stories on the board", "面板上的故事"),
      rows: [
        [bi("done", "已交付"), String(spectrum.done), C.green],
        [bi("todo", "待办"), String(spectrum.todo), C.amber],
        [bi("legacy", "历史交付"), String(s.story.legacy), C.slate],
      ],
    }) +
    tile({
      tab: "loop",
      label: bi("Cycle", "周期"),
      badge: "72h",
      badgeColor: C.blue,
      metric: cyc !== undefined ? String(cyc.cycles3d) : "—",
      metricColor: C.ink,
      metricSub: bi("cycles in the window", "窗口内周期"),
      rows: [
        [bi("failed", "失败"), cyc !== undefined ? String(cyc.failed3d) : "—", cyc !== undefined && cyc.failed3d > 0 ? C.red : C.green],
        [bi("cost", "花费"), cyc !== undefined ? `$${cyc.costUsd3d.toFixed(2)}` : "—", C.body],
      ],
    }) +
    tile({
      tab: "release",
      label: bi("Release", "发版"),
      badge: rel?.verdict ?? "?",
      badgeColor: relColor,
      metric: rel?.latestTag ?? "—",
      metricColor: C.ink,
      metricSub: bi("latest gated tag", "最近过闸 tag"),
      rows: [
        [bi("gate", "闸门"), rel?.verdict ?? "—", relColor],
        [bi("waiver", "豁免"), rel?.waiver ?? "—", rel?.waiver !== undefined ? C.amber : C.body],
      ],
    }) +
    `</section>`;

  const tallyCards = SPECTRUM_ORDER.map((k) => {
    const meta = SPECTRUM_META[k] as NonNullable<(typeof SPECTRUM_META)[string]>;
    const n = spectrum[k];
    return (
      `<a href="#backlog" data-tab-link="backlog" data-prefilter="${k}" title="${meta.en} · ${meta.zh}" ` +
      `style="position:relative;display:block;padding:14px 14px 12px;text-decoration:none;border-left:1px solid ${C.hair};cursor:pointer;">` +
      `<span style="position:absolute;left:0;top:0;height:3px;width:100%;background:${meta.color};opacity:${n > 0 ? "1" : ".25"};"></span>` +
      `<span style="${MONO}font-size:11px;color:${meta.color};">${meta.mark}</span>` +
      `<div data-truth="spectrum-${k}" style="font-size:30px;font-weight:700;letter-spacing:-.02em;color:${n > 0 ? C.ink : "#c3cad6"};font-variant-numeric:tabular-nums;margin:5px 0 1px;${MONO}">${n}</div>` +
      `<div style="${MONO}font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${C.slate};font-weight:600;">${bi(meta.en, meta.zh)}</div>` +
      `<div style="font-size:10px;color:${C.faint};margin-top:3px;min-height:12px;">${bi(meta.subEn, meta.subZh)}</div></a>`
    );
  }).join("");

  const bar = SPECTRUM_ORDER.filter((k) => spectrum[k] > 0)
    .map((k) => {
      const meta = SPECTRUM_META[k] as NonNullable<(typeof SPECTRUM_META)[string]>;
      return `<span title="${meta.en} ${spectrum[k]}" style="flex:${spectrum[k]} 1 0%;background:${meta.color};"></span>`;
    })
    .join("");
  const legend = SPECTRUM_ORDER.map((k) => {
    const meta = SPECTRUM_META[k] as NonNullable<(typeof SPECTRUM_META)[string]>;
    return `<span style="display:inline-flex;align-items:center;gap:6px;"><i style="width:9px;height:9px;border-radius:3px;background:${meta.color};display:inline-block;"></i>${bi(meta.en, meta.zh)} ${spectrum[k]}</span>`;
  }).join("");

  const statusBoard =
    `<section style="border:1px solid ${C.line};border-radius:14px;background:${C.card};overflow:hidden;margin:14px 0 8px;box-shadow:0 1px 2px rgba(17,26,69,.05);">` +
    `<div style="display:grid;grid-template-columns:repeat(6,1fr);">${tallyCards}</div>` +
    `<div style="padding:16px 18px 15px;border-top:1px solid ${C.hair};background:#fbfcfe;">` +
    `<div style="display:flex;height:13px;border-radius:999px;overflow:hidden;border:1px solid ${C.line};background:${C.card};">${bar}</div>` +
    `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:9px;${MONO}font-size:11.5px;color:${C.dim};">` +
    `<span data-truth="total">${s.story.total} ${bi("stories", "个故事")}</span>` +
    `<span><b data-truth="merged-pct" style="color:${C.green};font-weight:600;">${mergedPct}%</b> ${bi("merged to main", "已合入主干")}</span></div>` +
    `<div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:11px;${MONO}font-size:11px;color:${C.slate};">${legend}</div>` +
    `</div></section>`;

  return (
    `<div style="padding:34px 0 8px;">` +
    kicker(`${esc(input.brand.name)} · ${bi("Truth Console", "真相控制台")}`) +
    `<h1 style="margin:10px 0 0;font-size:33px;line-height:1.1;font-weight:700;letter-spacing:-.02em;color:${C.ink};">${bi("Overview", "总览")}</h1>` +
    `<p style="margin:12px 0 0;max-width:660px;font-size:15.5px;line-height:1.6;color:${C.sub};">` +
    bi("Am I safe? Thirty seconds, top to bottom: the verdict, the heartbeat, three aggregates, the spectrum.", "我安全吗？三十秒自上而下读完：判定、心跳、三聚合、状态光谱。") +
    `</p></div>` +
    heartbeat +
    verdictStrip +
    tiles +
    statusBoard
  );
}

function placeholderTab(titleEn: string, titleZh: string, fillerStory: string): string {
  return (
    `<div style="padding:34px 0 8px;">` +
    kicker(bi("Truth Console", "真相控制台")) +
    `<h1 style="margin:10px 0 0;font-size:28px;font-weight:700;letter-spacing:-.02em;color:${C.ink};">${bi(titleEn, titleZh)}</h1></div>` +
    `<section style="border:1px dashed ${C.line};border-radius:12px;background:${C.card};padding:28px 24px;margin:8px 0;color:${C.faint};font-size:13.5px;">` +
    bi(`This tab is being built (${fillerStory}).`, `本页签建设中（${fillerStory}）。`) +
    `</section>`
  );
}

const TABS = [
  { key: "overview", en: "Overview", zh: "总览" },
  { key: "loop", en: "Loop", zh: "循环" },
  { key: "release", en: "Release", zh: "发版" },
  { key: "backlog", en: "Backlog", zh: "待办" },
  { key: "skills", en: "Skills", zh: "技能" },
] as const;

const CONSOLE_SCRIPT = `<script>
(function () {
  var d = document.documentElement;
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var lang = get("roll-lang") || ((navigator.language || "").toLowerCase().indexOf("zh") === 0 ? "zh" : "en");
  function applyLang() {
    d.setAttribute("data-lang", lang);
    d.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
    var bs = document.querySelectorAll("[data-set-lang]");
    for (var i = 0; i < bs.length; i++) {
      var on = bs[i].getAttribute("data-set-lang") === lang;
      bs[i].classList.toggle("on", on);
      bs[i].setAttribute("aria-pressed", String(on));
    }
  }
  var TABS = ["overview", "loop", "release", "backlog", "skills"];
  function currentTab() {
    var h = (location.hash || "").replace(/^#/, "");
    return TABS.indexOf(h) >= 0 ? h : "overview";
  }
  function applyTab() {
    var cur = currentTab();
    for (var i = 0; i < TABS.length; i++) {
      var pane = document.getElementById("tab-" + TABS[i]);
      if (pane) pane.style.display = TABS[i] === cur ? "" : "none";
      var btn = document.querySelector('[data-tab="' + TABS[i] + '"]');
      if (btn) btn.classList.toggle("on", TABS[i] === cur);
    }
  }
  window.addEventListener("hashchange", applyTab);
  document.addEventListener("DOMContentLoaded", function () {
    applyLang();
    applyTab();
    var bs = document.querySelectorAll("[data-set-lang]");
    for (var i = 0; i < bs.length; i++) {
      bs[i].addEventListener("click", function () {
        lang = this.getAttribute("data-set-lang");
        set("roll-lang", lang);
        applyLang();
      });
    }
  });
  applyLang();
})();
</script>`;

export function renderTruthConsole(input: TruthConsoleInput): string {
  const tabBar = TABS.map(
    (t) =>
      `<a href="#${t.key}" data-tab="${t.key}" class="console-tab">${bi(t.en, t.zh)}</a>`,
  ).join("");

  const header =
    `<header style="position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:16px;height:54px;padding:0 22px;background:rgba(27,34,56,.97);backdrop-filter:blur(8px);border-bottom:1px solid #0e1424;">` +
    `<a href="#overview" style="display:flex;align-items:center;gap:9px;cursor:pointer;flex:none;text-decoration:none;">` +
    `<span style="width:9px;height:9px;border-radius:50%;background:${C.green};box-shadow:0 0 0 3px rgba(23,138,82,.22);"></span>` +
    `<span style="${MONO}font-weight:600;font-size:15px;letter-spacing:.02em;color:#fff;">${esc(input.brand.name)}</span></a>` +
    `<span style="${MONO}font-size:11.5px;color:#8f98ad;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(input.brand.slogan)}</span>` +
    `<span style="flex:1;"></span>` +
    `<span style="${MONO}font-size:11px;color:#6f7892;letter-spacing:.02em;white-space:nowrap;">${bi("release", "发版")} <b style="color:#cfd5e3;font-weight:600;">${esc(input.snapshot.release?.latestTag ?? "—")}</b></span>` +
    `<div style="display:flex;border:1px solid #313a55;border-radius:999px;overflow:hidden;">` +
    `<button type="button" data-set-lang="en" class="lang-btn">EN</button>` +
    `<button type="button" data-set-lang="zh" class="lang-btn">中</button></div></header>`;

  const css = `
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{background:${C.bg};color:${C.body};font-family:"IBM Plex Sans","IBM Plex Sans SC",-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased;}
@keyframes beat{0%{box-shadow:0 0 0 0 rgba(23,138,82,.5);}70%{box-shadow:0 0 0 8px rgba(23,138,82,0);}100%{box-shadow:0 0 0 0 rgba(23,138,82,0);}}
::selection{background:rgba(45,84,232,.16);}
html[data-lang="en"] .lang-zh{display:none;}
html[data-lang="zh"] .lang-en{display:none;}
html:not([data-lang]) .lang-zh{display:none;}
.lang-btn{appearance:none;border:0;background:transparent;color:#8f98ad;font-family:'IBM Plex Mono',monospace;font-size:11px;padding:4px 11px;cursor:pointer;}
.lang-btn.on{background:#2d54e8;color:#fff;}
.console-tab{appearance:none;border:1px solid transparent;border-bottom:0;background:transparent;color:${C.sub};font-size:13px;font-weight:600;padding:9px 16px;border-radius:9px 9px 0 0;cursor:pointer;text-decoration:none;}
.console-tab.on{background:${C.card};border-color:${C.line};color:${C.ink};box-shadow:0 -1px 2px rgba(17,26,69,.04);}
.console-tab:hover{color:${C.ink};}
a{color:${C.blue};}
`;

  const panes =
    `<div id="tab-overview">${overviewTab(input)}</div>` +
    `<div id="tab-loop" style="display:none;">${placeholderTab("Loop & Cycles", "循环与周期", "US-DOSSIER-013/014")}</div>` +
    `<div id="tab-release" style="display:none;">${placeholderTab("Release", "发版", "US-DOSSIER-015/016")}</div>` +
    `<div id="tab-backlog" style="display:none;">` +
    `<div style="padding:30px 0 4px;">` +
    kicker(bi("Truth Console", "真相控制台")) +
    `<h1 style="margin:10px 0 0;font-size:28px;font-weight:700;letter-spacing:-.02em;color:${C.ink};">${bi("Backlog", "待办")}</h1>` +
    `<p style="margin:10px 0 0;max-width:660px;font-size:14.5px;line-height:1.55;color:${C.sub};">${bi(
      "A card is a wish; main is the proof. (Full redesign lands with US-DOSSIER-012.)",
      "卡片只是愿望，主干证明才算完成。（完整重设计由 US-DOSSIER-012 落地。）",
    )}</p></div>` +
    `<div class="ledger-embed">${input.backlogFragment}</div></div>` +
    `<div id="tab-skills" style="display:none;">${placeholderTab("Skills", "技能", "US-DOSSIER-017")}</div>`;

  return (
    `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${esc(input.brand.name)} · Truth Console</title>\n` +
    `<link rel="preconnect" href="https://fonts.googleapis.com">\n` +
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n` +
    `<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+SC:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">\n` +
    `<style>${css}${input.backlogStyle ?? ""}</style>\n` +
    `${CONSOLE_SCRIPT}\n${input.backlogScript}\n</head>\n<body>\n` +
    header +
    `<main style="max-width:1100px;margin:0 auto;padding:0 22px 64px;">` +
    `<div style="display:flex;gap:6px;align-items:flex-end;border-bottom:1px solid #dfe4ec;position:sticky;top:54px;background:${C.bg};z-index:20;padding:16px 0 0;">${tabBar}</div>` +
    panes +
    `</main>\n` +
    `<script id="roll-truth" type="application/json">\n${input.snapshotJson.replace(/<\//g, "<\\/")}</script>\n` +
    `</body>\n</html>\n`
  );
}
