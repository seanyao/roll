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
import type { CycleLedgerRow, CycleTapeSegment } from "./cycle-ledger.js";
import type { AgentPanelRow } from "./agent-panel.js";
import type { ReleasePanelVM } from "./release-panel.js";
import type { ReleaseScopeVM, ScopeEpicGroup } from "./release-scope.js";

export interface TruthConsoleBrand {
  /** Injected, never hardcoded (owner ruling): project name + slogan. */
  name: string;
  slogan: string;
}

/** One story row on the Backlog tab (US-DOSSIER-012). */
export interface BacklogStoryVM {
  id: string;
  epic: string;
  /** ID family: US | FIX | REFACTOR | … */
  type: string;
  title: string;
  /** Spectrum state — the SAME classifier the snapshot tally uses. */
  state: "done" | "wip" | "hold" | "todo" | "fail" | "unknown";
  legacy: boolean;
  /** Lifecycle stations done (spine keys in order). */
  stages: string[];
}

export interface BacklogEpicVM {
  name: string;
  done: number;
  total: number;
  stories: BacklogStoryVM[];
}

export interface BacklogVM {
  /** Epics still shipping (not every story merged). */
  shipping: BacklogEpicVM[];
  /** Epics fully settled on main. */
  settled: BacklogEpicVM[];
}

export interface TruthConsoleInput {
  snapshot: TruthSnapshot;
  /** The EXACT serialized snapshot written to truth.json (US-DOSSIER-010). */
  snapshotJson: string;
  brand: TruthConsoleBrand;
  /** Backlog tab view model (US-DOSSIER-012). */
  backlog: BacklogVM;
  /** Spine station keys in lifecycle order (definition→…→retrospective). */
  spineKeys: string[];
  /** Cycle ledger rows, newest first (US-DOSSIER-013). */
  cycles: CycleLedgerRow[];
  /** Agents on this machine (US-DOSSIER-014). */
  agents: AgentPanelRow[];
  /** Release gate head + six-dimension consistency panel (US-DOSSIER-015). */
  releasePanel: ReleasePanelVM;
  /** Pending delivery + shipped changelog + version history (US-DOSSIER-016). */
  releaseScope: ReleaseScopeVM;
  /** GitHub repo slug (owner/name) for PR links, when known. */
  githubSlug?: string;
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
      `<a href="#backlog/${k}" data-tab-link="backlog" data-prefilter="${k}" title="${meta.en} · ${meta.zh}" ` +
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

const VERDICT_COLORS: Record<string, string> = {
  delivered: C.green,
  reverted: C.amber,
  failed: C.red,
  blocked: C.purple,
  idle: "#cbd2dc",
  unknown: C.slate,
};
const VERDICT_ZH: Record<string, string> = {
  delivered: "已交付",
  reverted: "已回滚",
  failed: "失败",
  blocked: "被阻塞",
  idle: "空转",
  unknown: "未知",
};
const SEG_COLORS: Record<CycleTapeSegment["state"], string> = { pass: C.green, fail: C.red, idle: "#cbd2dc", unknown: "#c3cad6" };

function tapeSegment(seg: CycleTapeSegment, last: boolean): string {
  const color = SEG_COLORS[seg.state];
  return (
    `<div style="flex:none;width:120px;min-width:120px;">` +
    `<div style="display:flex;align-items:center;"><span style="width:11px;height:11px;border-radius:50%;background:${color};flex:none;"></span>` +
    (last ? "" : `<span style="flex:1;height:2px;background:#e4e8ef;"></span>`) +
    `</div>` +
    `<div style="margin-top:9px;${MONO}font-size:11px;font-weight:600;color:${seg.state === "fail" ? C.red : C.sub};">${esc(seg.key)}</div>` +
    `<div style="margin-top:3px;${MONO}font-size:10.5px;color:${C.dim};line-height:1.35;padding-right:12px;">${esc(seg.detail)}</div></div>`
  );
}

function cycleRow(cy: CycleLedgerRow): string {
  const color = VERDICT_COLORS[cy.verdict] ?? C.slate;
  const n = cy.cycleId.slice(-6);
  return (
    `<details class="cy-row" data-ts="${cy.tsSec}" data-verdict="${cy.verdict}" style="border-top:1px solid ${C.hair};">` +
    `<summary style="display:grid;grid-template-columns:14px 70px 1fr auto;align-items:center;gap:14px;padding:12px 18px;cursor:pointer;list-style:none;">` +
    `<span title="${cy.verdict}" style="width:10px;height:10px;border-radius:50%;background:${color};flex:none;"></span>` +
    `<span style="${MONO}font-size:13px;font-weight:600;color:${C.ink};">${esc(n)}</span>` +
    `<div style="min-width:0;display:flex;align-items:center;gap:10px;">` +
    `<span style="${MONO}font-size:10px;letter-spacing:.05em;text-transform:uppercase;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid ${color}44;color:${color};flex:none;">${bi(cy.verdict, VERDICT_ZH[cy.verdict] ?? cy.verdict)}</span>` +
    `<span style="${MONO}font-size:12px;color:${C.blue};font-weight:600;flex:none;">${esc(cy.storyId || "—")}</span></div>` +
    `<div style="display:flex;align-items:center;gap:14px;${MONO}font-size:11.5px;color:${C.dim};flex:none;">` +
    `<span style="color:#5b6478;">${esc(cy.model)}</span>` +
    `<span title="tokens in/out">${esc(cy.tokens)}</span>` +
    `<span style="color:#5b6478;">${esc(cy.cost)}</span>` +
    `<span>${esc(cy.duration)}</span>` +
    `<span class="bl-caret" style="color:${C.faint};transition:transform .18s;font-size:10px;">▶</span></div></summary>` +
    `<div style="padding:6px 18px 18px 60px;background:#fbfcfe;border-top:1px solid #f1f4f8;">` +
    `<div style="display:flex;flex-wrap:nowrap;overflow-x:auto;gap:0;margin:12px 0 4px;padding-bottom:4px;">` +
    cy.tape.map((s, i) => tapeSegment(s, i === cy.tape.length - 1)).join("") +
    `</div>` +
    (cy.evidence.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;">` +
        cy.evidence
          .map((e) => `<a href="${esc(e.href)}" style="${MONO}font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid ${C.line};color:${C.blue};text-decoration:none;background:${C.card};">${esc(e.label)}</a>`)
          .join("") +
        `</div>`
      : "") +
    `</div></details>`
  );
}

function agentRow(ag: AgentPanelRow): string {
  const dot = ag.installed
    ? `width:9px;height:9px;border-radius:50%;background:${C.green};flex:none;`
    : `width:9px;height:9px;border-radius:50%;background:#cbd2dc;flex:none;`;
  const ink = ag.installed ? C.ink : C.faint;
  const cell = (label: string, value: string, mono = true): string =>
    `<div><div style="${MONO}font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:${C.faint};">${label}</div>` +
    `<div style="${mono ? MONO : ""}font-size:12px;color:${ag.installed ? "#5b6478" : C.faint};margin-top:3px;white-space:nowrap;">${value}</div></div>`;
  const FILE_STATE: Record<string, [string, string]> = {
    sync: ["✓ in sync", C.green],
    stale: ["⟳ stale", C.amber],
    missing: ["− missing", C.faint],
  };
  return (
    `<details class="ag-row" data-agent="${esc(ag.name)}" style="border-top:1px solid ${C.hair};${ag.installed ? "" : "opacity:.62;"}">` +
    `<summary style="display:grid;grid-template-columns:1fr repeat(4,minmax(90px,auto)) auto;align-items:center;gap:14px;padding:11px 18px;cursor:pointer;list-style:none;">` +
    `<span style="display:flex;align-items:center;gap:10px;min-width:0;"><span class="bl-caret" style="${MONO}font-size:9px;color:${C.faint};transition:transform .18s;flex:none;">▶</span>` +
    `<span style="${dot}"></span><span style="${MONO}font-size:13px;font-weight:600;color:${ink};white-space:nowrap;">${esc(ag.display)}</span></span>` +
    cell(bi("runner", "运行器"), esc(ag.runner), false) +
    cell(bi("version", "版本"), esc(ag.version)) +
    cell(bi("cycles 72h", "近72h周期"), String(ag.cycles72h)) +
    cell(bi("cost 72h", "近72h花费"), ag.cycles72h > 0 ? `$${ag.costUsd72h.toFixed(2)}` : "—") +
    `<span style="display:flex;align-items:center;gap:8px;justify-content:flex-end;">` +
    (ag.syncStale
      ? `<span style="${MONO}font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;padding:2px 6px;border-radius:4px;border:1px solid ${C.amber}55;color:${C.amber};white-space:nowrap;">${bi("convention stale", "约定过期")}</span>`
      : "") +
    `<span style="${MONO}font-size:11px;color:${ag.installed ? C.green : C.faint};font-weight:600;white-space:nowrap;">${ag.installed ? bi("available", "可用") : bi("not detected", "未检测到")}</span>` +
    `</span></summary>` +
    `<div style="background:#fbfcfe;border-top:1px solid #f1f4f8;padding:12px 18px 14px 47px;">` +
    `<div style="${MONO}font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:${C.faint};margin-bottom:6px;">${bi("convention files", "接入文件")}</div>` +
    (ag.files.length === 0
      ? `<div style="font-size:12.5px;color:${C.faint};font-style:italic;">${bi("nothing to sync", "无同步内容")}</div>`
      : ag.files
          .map((f) => {
            const [label, color] = FILE_STATE[f.state] ?? ["?", C.slate];
            return (
              `<div style="display:flex;gap:12px;align-items:baseline;padding:2px 0;flex-wrap:wrap;">` +
              `<span style="${MONO}font-size:11.5px;color:${C.ink};">${esc(f.path)}</span>` +
              `<span style="${MONO}font-size:10.5px;color:${C.faint};">${esc(f.kind)}</span>` +
              `<span style="${MONO}font-size:10.5px;color:${color};font-weight:600;">${label}</span></div>`
            );
          })
          .join("")) +
    (ag.setupCmd !== undefined
      ? `<div style="margin-top:9px;"><code style="${MONO}font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid ${C.amber}55;color:${C.amber};background:${C.card};">${esc(ag.setupCmd)}</code></div>`
      : "") +
    `</div></details>`
  );
}

function loopTab(input: TruthConsoleInput): string {
  const ranges: Array<[string, string, string]> = [
    ["1", "Today", "今天"],
    ["3", "3 days", "三天"],
    ["7", "7 days", "七天"],
    ["all", "All", "全部"],
  ];
  return (
    `<div style="padding:30px 0 4px;">` +
    kicker(bi("The engine says it runs — here is the tape", "引擎说在跑——这是轨迹带")) +
    `<h1 style="margin:10px 0 0;font-size:28px;line-height:1.1;font-weight:700;letter-spacing:-.02em;color:${C.ink};">${bi("Loop & Cycles", "循环与周期")}</h1>` +
    `<p style="margin:10px 0 0;max-width:660px;font-size:14.5px;line-height:1.55;color:${C.sub};">${bi(
      "Every cycle, complete and replayable. Failures are first-class — never swallowed.",
      "每一个 cycle 完整、可回溯。失败是一等公民——绝不吞。",
    )}</p></div>` +
    `<div style="display:flex;align-items:baseline;gap:12px;margin:24px 0 12px;">` +
    `<span style="${MONO}font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${C.sub};font-weight:600;white-space:nowrap;">${bi("Agents on this machine", "本机 agents")}</span>` +
    `<span style="${MONO}font-size:11.5px;color:${C.faint};">${bi("who works here, what it costs, whether conventions are fresh (72h window)", "谁在干活、花了多少、约定新不新（72h 窗口）")}</span>` +
    `<span style="flex:1;height:1px;background:#dfe4ec;"></span></div>` +
    `<section style="border:1px solid ${C.line};border-radius:12px;background:${C.card};overflow:hidden;margin:0 0 8px;box-shadow:0 1px 2px rgba(17,26,69,.05);">` +
    (input.agents.length > 0
      ? input.agents.map(agentRow).join("")
      : `<div style="padding:14px 18px;font-size:12.5px;color:${C.faint};font-style:italic;">${bi("no agents detected", "未检测到 agent")}</div>`) +
    `</section>` +
    `<div style="display:flex;align-items:center;gap:12px;margin:24px 0 12px;flex-wrap:wrap;">` +
    `<span style="${MONO}font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${C.sub};font-weight:600;">${bi("Cycle ledger", "周期账本")}</span>` +
    `<span style="${MONO}font-size:11.5px;color:${C.faint};">${bi("what it actually did while you were away", "你不在的时候它到底干了什么")}</span>` +
    `<span style="flex:1;height:1px;background:#dfe4ec;min-width:16px;"></span>` +
    `<div style="display:flex;border:1px solid #dfe4ec;border-radius:999px;overflow:hidden;background:${C.card};">` +
    ranges
      .map(
        ([key, en, zh]) =>
          `<button type="button" class="cy-range${key === "3" ? " on" : ""}" data-range="${key}" style="appearance:none;border:0;background:transparent;${MONO}font-size:11px;padding:6px 13px;cursor:pointer;color:${C.sub};">${bi(en, zh)}</button>`,
      )
      .join("") +
    `</div>` +
    `<span style="${MONO}font-size:11.5px;color:${C.dim};white-space:nowrap;"><span id="cy-count">—</span> ${bi("cycles", "周期")} <span style="color:${C.faint};">·</span> <b id="cy-failed" style="color:#d23b3b;font-weight:600;">—</b> ${bi("failed", "失败")}</span></div>` +
    `<section id="cy-ledger" style="border:1px solid ${C.line};border-radius:14px;background:${C.card};overflow:hidden;box-shadow:0 1px 2px rgba(17,26,69,.05);">` +
    (input.cycles.length > 0
      ? input.cycles.map(cycleRow).join("")
      : `<div style="padding:16px 18px;font-size:12.5px;color:${C.faint};font-style:italic;">${bi("no cycles recorded yet", "尚无周期记录")}</div>`) +
    `</section>`
  );
}

const TYPE_COLORS: Record<string, string> = { US: C.blue, FIX: C.red, REFACTOR: C.purple, IDEA: C.amber };

function typeBadge(type: string): string {
  const color = TYPE_COLORS[type] ?? C.slate;
  return `<span style="${MONO}font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;font-weight:600;padding:2px 7px;border-radius:5px;border:1px solid ${color}44;color:${color};text-align:center;">${esc(type)}</span>`;
}

function miniSpine(stages: string[], spineKeys: string[], legacy: boolean): string {
  if (legacy) {
    return `<span title="legacy delivery · 历史交付" style="display:inline-flex;gap:3px;">${spineKeys
      .map(() => `<span style="width:14px;height:5px;border-radius:3px;background:#d4dae3;"></span>`)
      .join("")}</span>`;
  }
  const done = new Set(stages);
  return `<span style="display:inline-flex;gap:3px;">${spineKeys
    .map((k) => `<span title="${esc(k)}" style="width:14px;height:5px;border-radius:3px;background:${done.has(k) ? C.green : "#e4e8ef"};"></span>`)
    .join("")}</span>`;
}

function truthChip(state: BacklogStoryVM["state"], legacy: boolean): string {
  const mk = (label: string, color: string): string =>
    `<span style="${MONO}font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;padding:2px 6px;border-radius:4px;border:1px solid ${color}55;color:${color};white-space:nowrap;">${label}</span>`;
  if (legacy) return `<span style="${MONO}font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;padding:2px 5px;border-radius:4px;border:1px dashed #c8ced6;color:${C.faint};">legacy</span>`;
  if (state === "done") return mk("truth ✓", C.green);
  if (state === "fail") return mk("truth ✗", C.red);
  if (state === "unknown") return mk("truth ?", C.slate);
  return "";
}

function storyRow(s: BacklogStoryVM, spineKeys: string[]): string {
  const meta = SPECTRUM_META[s.state] as NonNullable<(typeof SPECTRUM_META)[string]>;
  return (
    `<a class="bl-row" data-state="${s.state}" data-text="${esc(`${s.id} ${s.title}`.toLowerCase())}" href="${esc(s.epic)}/${esc(s.id)}/index.html" ` +
    `style="display:grid;grid-template-columns:62px 150px 1fr 110px minmax(150px,auto);align-items:center;gap:12px;padding:8px 10px;border-radius:8px;cursor:pointer;text-decoration:none;">` +
    typeBadge(s.type) +
    `<span style="${MONO}font-size:12.5px;color:${C.blue};font-weight:600;overflow:hidden;text-overflow:ellipsis;">${esc(s.id)}</span>` +
    `<span style="font-size:13.5px;color:${C.sub};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.title)}</span>` +
    miniSpine(s.stages, spineKeys, s.legacy) +
    `<span style="display:flex;align-items:center;gap:7px;justify-content:flex-end;${MONO}font-size:11px;">` +
    `<span style="width:7px;height:7px;border-radius:50%;background:${meta.color};flex:none;"></span>` +
    `<span style="color:${meta.color};font-weight:600;">${bi(meta.en, meta.zh)}</span>` +
    truthChip(s.state, s.legacy) +
    `</span></a>`
  );
}

function epicAccordion(ep: BacklogEpicVM, spineKeys: string[]): string {
  const donePct = ep.total > 0 ? (ep.done / ep.total) * 100 : 0;
  return (
    `<details class="bl-epic" data-epic="${esc(ep.name)}">` +
    `<summary style="display:grid;grid-template-columns:20px 1fr auto;align-items:center;gap:14px;padding:13px 16px;cursor:pointer;list-style:none;">` +
    `<span class="bl-caret" style="${MONO}font-size:11px;color:${C.faint};text-align:center;transition:transform .18s;">▶</span>` +
    `<div style="min-width:0;"><a href="${esc(ep.name)}/index.html" style="font-size:16px;font-weight:600;letter-spacing:-.01em;color:${C.ink};text-decoration:none;">${esc(ep.name)}</a>` +
    `<div style="display:flex;height:6px;border-radius:999px;overflow:hidden;margin-top:8px;max-width:320px;border:1px solid #e4e8ef;">` +
    `<span style="width:${donePct}%;background:${C.green};"></span><span style="flex:1;background:#eef1f5;"></span></div></div>` +
    `<span style="${MONO}font-size:13px;color:${C.dim};white-space:nowrap;"><b style="color:${C.green};font-weight:600;">${ep.done}</b> / ${ep.total}</span>` +
    `</summary>` +
    `<div style="border-top:1px solid ${C.hair};padding:5px 8px 9px;">${ep.stories.map((s) => storyRow(s, spineKeys)).join("")}</div>` +
    `</details>`
  );
}

function backlogTab(input: TruthConsoleInput): string {
  const groupHead = (label: string, count: number, color: string): string =>
    `<div style="display:flex;align-items:baseline;gap:12px;margin:24px 0 12px;">` +
    `<span style="${MONO}font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${C.sub};font-weight:600;">${label}</span>` +
    `<span style="${MONO}font-size:12px;color:${color};font-weight:600;">${count}</span>` +
    `<span style="flex:1;height:1px;background:#dfe4ec;"></span></div>`;
  const chips = SPECTRUM_ORDER.map((k) => {
    const meta = SPECTRUM_META[k] as NonNullable<(typeof SPECTRUM_META)[string]>;
    return (
      `<button type="button" class="bl-chip" data-filter="${k}" ` +
      `style="${MONO}font-size:11px;padding:6px 12px;border-radius:999px;border:1px solid ${C.line};background:${C.card};color:${meta.color};cursor:pointer;">` +
      `${meta.mark} ${bi(meta.en, meta.zh)}</button>`
    );
  }).join("");
  return (
    `<div style="padding:30px 0 4px;">` +
    kicker(bi("Wishes, not yet truth", "愿望，尚未成真")) +
    `<h1 style="margin:10px 0 0;font-size:28px;line-height:1.1;font-weight:700;letter-spacing:-.02em;color:${C.ink};">${bi("Backlog", "待办")}</h1>` +
    `<p style="margin:10px 0 0;max-width:660px;font-size:14.5px;line-height:1.55;color:${C.sub};">${bi(
      "Every card here is a wish until main proves the merge. Each row shows the claim beside the truth.",
      "这里的每张卡都只是愿望，直到主干证明它合并才算完成。每行同时给出声明与真相。",
    )}</p></div>` +
    `<div style="display:flex;gap:10px;align-items:center;margin:22px 0 12px;flex-wrap:wrap;">` +
    `<div style="flex:1 1 280px;display:flex;align-items:center;gap:9px;background:${C.card};border:1px solid #dfe4ec;border-radius:999px;padding:9px 16px;">` +
    `<span style="color:${C.faint};font-size:13px;">⌕</span>` +
    `<input type="search" id="bl-search" placeholder="Search epics &amp; stories · 搜索史诗与故事" style="flex:1;border:none;outline:none;background:none;font-family:inherit;font-size:13.5px;color:${C.body};"></div>` +
    `<div style="display:flex;gap:6px;flex-wrap:wrap;">${chips}</div></div>` +
    groupHead(bi("Shipping to main", "交付中"), input.backlog.shipping.length, C.blue) +
    input.backlog.shipping.map((e) => epicAccordion(e, input.spineKeys)).join("") +
    groupHead(bi("Settled on main", "已落定"), input.backlog.settled.length, C.green) +
    input.backlog.settled.map((e) => epicAccordion(e, input.spineKeys)).join("")
  );
}

const DIM_META: Record<string, { no: string; en: string; zh: string; whatEn: string; whatZh: string }> = {
  "code-backlog": { no: "①", en: "code ↔ backlog", zh: "代码↔待办", whatEn: "Done claims vs merge & cycle facts", whatZh: "Done 声明对合并与周期事实" },
  cards: { no: "②", en: "cards / evidence", zh: "卡片/证据", whatEn: "every row owns its card; evidence never dangles", whatZh: "每行有卡，证据链接不悬空" },
  docs: { no: "③", en: "docs", zh: "文档", whatEn: "changelog / guide / README / --help", whatZh: "changelog/guide/README/--help" },
  tests: { no: "④", en: "tests", zh: "测试", whatEn: "suites green, coverage honest", whatZh: "套件全绿，覆盖诚实" },
  bilingual: { no: "⑤", en: "bilingual", zh: "双语", whatEn: "guide en↔zh + i18n keys in parity", whatZh: "指南中英与 i18n key 对齐" },
  site: { no: "⑥", en: "site", zh: "站点", whatEn: "published site matches the repo", whatZh: "站点与仓库一致" },
};

function fwu(f: number, w: number, u: number): string {
  return (
    `<span style="display:flex;gap:14px;justify-content:flex-end;${MONO}font-size:11.5px;white-space:nowrap;">` +
    `<span style="color:${f > 0 ? C.red : "#b6bdc9"};font-weight:600;">f:${f}</span>` +
    `<span style="color:${w > 0 ? C.amber : "#b6bdc9"};font-weight:600;">w:${w}</span>` +
    `<span style="color:${u > 0 ? C.slate : "#b6bdc9"};">?:${u}</span></span>`
  );
}

function releaseTab(input: TruthConsoleInput): string {
  const s = input.snapshot;
  const rp = input.releasePanel;
  const rel = s.release;
  const relColor = rel?.verdict === "pass" ? C.green : rel?.verdict === "fail" ? C.red : rel?.verdict === "warn" ? C.amber : C.slate;
  const spectrum = s.story.spectrum;
  // AC4 (US-DOSSIER-016): the head's merged/pending = the scope sections' counts
  // by the same arithmetic — pending is EVERY not-yet-done story.
  const merged = spectrum.done;
  const pending = s.story.total - spectrum.done;
  const mergedPct = s.story.total > 0 ? Math.round((merged / s.story.total) * 100) : 0;
  const head = (label: string, value: string, mono = true): string =>
    `<div><div style="${MONO}font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:${C.faint};">${label}</div>` +
    `<div style="${mono ? MONO : ""}font-size:13px;color:${C.body};margin-top:8px;white-space:nowrap;">${value}</div></div>`;

  const gateHead =
    `<section style="border:1px solid ${C.line};border-radius:12px;background:${C.card};overflow:hidden;margin:20px 0 8px;box-shadow:0 1px 2px rgba(17,26,69,.05);">` +
    `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:30px;padding:16px 20px;">` +
    `<div><div style="${MONO}font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:${C.faint};">${bi("release", "发版")}</div>` +
    `<div style="${MONO}font-size:24px;font-weight:600;color:${C.ink};margin-top:3px;">${esc(rel?.latestTag ?? "—")}</div></div>` +
    `<div><div style="${MONO}font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:${C.faint};">${bi("verdict", "判定")}</div>` +
    `<div style="margin-top:6px;"><span style="${MONO}font-size:11px;letter-spacing:.05em;text-transform:uppercase;font-weight:600;padding:3px 10px;border-radius:999px;border:1px solid ${relColor}55;color:${relColor};">${esc(rel?.verdict ?? "unknown")}</span></div></div>` +
    head(bi("gate", "闸门"), fwuInline(rp.total)) +
    head(bi("cut", "切版"), shortTs(rel?.collectedAt)) +
    head(bi("previous", "上一版"), esc(rp.prevTag ?? "—")) +
    `<span style="flex:1;"></span>` +
    `<div style="${MONO}font-size:12px;color:${C.dim};white-space:nowrap;"><b style="color:${C.green};font-weight:600;">${merged}</b> ${bi("merged", "已合")} · <b style="color:${C.amber};font-weight:600;">${pending}</b> ${bi("pending", "待交付")}</div></div>` +
    `<div style="padding:0 20px 16px;"><div style="display:flex;height:11px;border-radius:999px;overflow:hidden;border:1px solid #e4e8ef;">` +
    `<span style="width:${mergedPct}%;background:${C.green};"></span><span style="flex:1;background:#eef1f5;"></span></div></div></section>`;

  const dimRows = rp.dims
    .map((d) => {
      // runtime fallback (kimi pair-review): a future dimension renders honestly
      // instead of crashing the whole page.
      const meta = DIM_META[d.key] ?? { no: "·", en: d.key, zh: d.key, whatEn: "", whatZh: "" };
      const dotColor = d.tally.fail > 0 ? C.red : d.tally.warn > 0 ? C.amber : d.tally.unknown > 0 ? C.slate : C.green;
      const chips = d.tally.subjects
        .map((sub) => `<a href="#backlog/q:${encodeURIComponent(sub)}" style="${MONO}font-size:10.5px;color:${C.blue};border:1px solid ${C.blue}55;border-radius:5px;padding:2px 7px;text-decoration:none;white-space:nowrap;">${esc(sub)}</a>`)
        .join("");
      return (
        `<div class="rel-dim" data-dim="${d.key}" style="display:grid;grid-template-columns:215px 1fr 200px;gap:14px;align-items:center;padding:11px 18px;border-top:1px solid ${C.hair};">` +
        `<span style="display:flex;align-items:center;gap:9px;min-width:0;">` +
        `<span style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex:none;"></span>` +
        `<span style="${MONO}font-size:12.5px;font-weight:600;color:${C.ink};white-space:nowrap;">${meta.no} ${bi(meta.en, meta.zh)}</span></span>` +
        `<span style="min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span style="font-size:12.5px;color:#6b7488;">${bi(meta.whatEn, meta.whatZh)}</span>${chips}</span>` +
        fwu(d.tally.fail, d.tally.warn, d.tally.unknown) +
        `</div>`
      );
    })
    .join("");

  const proposedRow =
    `<div class="rel-dim rel-dim-proposed" data-dim="data" style="display:grid;grid-template-columns:215px 1fr 200px;gap:14px;align-items:center;padding:11px 18px;border-top:1px dashed #c8ced6;opacity:.78;">` +
    `<span style="display:flex;align-items:center;gap:9px;min-width:0;">` +
    `<span style="width:8px;height:8px;border-radius:50%;border:1px dashed #c8ced6;background:transparent;flex:none;"></span>` +
    `<span style="${MONO}font-size:12.5px;font-weight:600;color:${C.sub};white-space:nowrap;">⑦ ${bi("data", "数据")}</span>` +
    `<span style="${MONO}font-size:9px;letter-spacing:.05em;text-transform:uppercase;padding:2px 5px;border-radius:4px;border:1px dashed #c8ced6;color:${C.faint};flex:none;">${bi("proposed", "提案")}</span></span>` +
    `<span style="min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span style="font-size:12.5px;color:#6b7488;">${bi("schema contracts · the same number equal everywhere", "schema 契约 · 同一个数处处相等")}</span>` +
    `<a href="#backlog/q:FIX-248" style="${MONO}font-size:10.5px;color:${C.blue};border:1px solid ${C.blue}55;border-radius:5px;padding:2px 7px;text-decoration:none;">FIX-248</a>` +
    `<a href="#backlog/q:FIX-249" style="${MONO}font-size:10.5px;color:${C.blue};border:1px solid ${C.blue}55;border-radius:5px;padding:2px 7px;text-decoration:none;">FIX-249</a></span>` +
    `<span style="${MONO}font-size:11.5px;color:${C.faint};text-align:right;">—</span></div>`;

  const totalRow =
    `<div style="display:grid;grid-template-columns:215px 1fr 200px;gap:14px;align-items:center;padding:11px 18px;border-top:1px solid ${C.hair};background:#fbfcfe;">` +
    `<span style="${MONO}font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.sub};font-weight:600;">${bi("gate total", "闸门合计")}</span>` +
    `<span>${rp.blocking ? `<span style="${MONO}font-size:11px;font-weight:600;color:${C.red};">${bi("a failing dimension blocks the release", "有维度不通过——挡发版")}</span>` : ""}</span>` +
    `<span data-truth="gate-total">${fwu(rp.total.fail, rp.total.warn, rp.total.unknown)}</span></div>`;

  return (
    `<div style="padding:30px 0 4px;">` +
    kicker(bi("It says it will ship — the gate decides", "说要发——闸门说了算")) +
    `<h1 style="margin:10px 0 0;font-size:28px;line-height:1.1;font-weight:700;letter-spacing:-.02em;color:${C.ink};">${bi("Release", "发版")}</h1>` +
    `<p style="margin:10px 0 0;max-width:660px;font-size:14.5px;line-height:1.55;color:${C.sub};">${bi(
      "Why can't it ship? Read it, don't guess it: six reconciled dimensions, every drift with an address.",
      "为什么发不了版？读出来，不用猜：六个对账维度，每处漂移都有地址。",
    )}</p></div>` +
    gateHead +
    `<div style="display:flex;align-items:baseline;gap:12px;margin:26px 0 12px;flex-wrap:wrap;">` +
    `<span style="${MONO}font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${C.sub};font-weight:600;white-space:nowrap;">${bi("Consistency gate", "一致性闸门")}</span>` +
    `<span style="${MONO}font-size:11.5px;color:${C.faint};">${bi("six dimensions reconciled against truth anchors", "六维对真相锚点对账")}${rp.generatedAt !== undefined ? ` · ${shortTs(rp.generatedAt)}` : ""}</span>` +
    `<span style="flex:1;height:1px;background:#dfe4ec;min-width:16px;"></span>` +
    `<code class="copy-chip" data-copy="roll release consistency check" style="${MONO}font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid ${C.line};color:${C.blue};background:${C.card};cursor:pointer;">roll release consistency check</code></div>` +
    `<section style="border:1px solid ${C.line};border-radius:12px;background:${C.card};overflow:hidden;margin:0 0 8px;box-shadow:0 1px 2px rgba(17,26,69,.05);">` +
    dimRows +
    proposedRow +
    totalRow +
    `</section>` +
    releaseScopeSections(input)
  );
}

function scopeGroup(g: ScopeEpicGroup, input: TruthConsoleInput, shipped: boolean): string {
  const rows = g.items
    .map((it) => {
      const meta = SPECTRUM_META[it.state] ?? (SPECTRUM_META["unknown"] as NonNullable<(typeof SPECTRUM_META)[string]>);
      const prChip =
        shipped && it.prNumber !== undefined
          ? input.githubSlug !== undefined
            ? `<a href="https://github.com/${esc(input.githubSlug)}/pull/${it.prNumber}" style="${MONO}font-size:10.5px;color:${C.green};border:1px solid ${C.green}55;border-radius:5px;padding:2px 7px;text-decoration:none;white-space:nowrap;">#${it.prNumber} merged</a>`
            : `<span style="${MONO}font-size:10.5px;color:${C.green};">#${it.prNumber} merged</span>`
          : shipped
            ? `<span style="${MONO}font-size:10.5px;color:${C.faint};">merged</span>`
            : "";
      return (
        `<a class="sc-row" href="${encodeURIComponent(it.epic)}/${encodeURIComponent(it.id)}/index.html" ` +
        `style="display:grid;grid-template-columns:150px 1fr auto auto;gap:12px;align-items:center;padding:9px 16px;border-top:1px solid #f4f6f9;text-decoration:none;">` +
        `<span style="${MONO}font-size:12px;color:${C.blue};font-weight:600;overflow:hidden;text-overflow:ellipsis;">${esc(it.id)}</span>` +
        `<span style="font-size:13px;color:${C.sub};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(it.title)}</span>` +
        `<span style="display:flex;align-items:center;gap:7px;${MONO}font-size:11px;"><span style="width:7px;height:7px;border-radius:50%;background:${meta.color};"></span><span style="color:${meta.color};font-weight:600;">${bi(meta.en, meta.zh)}</span></span>` +
        prChip +
        `</a>`
      );
    })
    .join("");
  return (
    `<section style="border:1px solid ${C.line};border-radius:12px;background:${C.card};overflow:hidden;margin:0 0 9px;box-shadow:0 1px 2px rgba(17,26,69,.04);">` +
    `<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:#fbfcfe;border-bottom:1px solid ${C.hair};">` +
    `<a href="${encodeURIComponent(g.epic)}/index.html" style="font-size:13.5px;font-weight:600;color:${C.ink};text-decoration:none;white-space:nowrap;">${esc(g.epic)}</a>` +
    `<span style="${MONO}font-size:11px;color:${C.faint};">${g.items.length}</span></div>` +
    rows +
    `</section>`
  );
}

function releaseScopeSections(input: TruthConsoleInput): string {
  const sc = input.releaseScope;
  const sectionHead = (label: string, count: number, color: string, sub: string): string =>
    `<div style="display:flex;align-items:baseline;gap:12px;margin:28px 0 12px;">` +
    `<span style="${MONO}font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${C.sub};font-weight:600;white-space:nowrap;">${label}</span>` +
    `<span data-truth="${color === C.amber ? "pending-count" : "shipped-count"}" style="${MONO}font-size:12px;color:${color};font-weight:600;">${count}</span>` +
    `<span style="${MONO}font-size:11.5px;color:${C.faint};">${sub}</span>` +
    `<span style="flex:1;height:1px;background:#dfe4ec;"></span></div>`;
  const history = sc.history
    .map(
      (h) =>
        `<details class="rel-hist" style="border-top:1px solid ${C.hair};">` +
        `<summary style="display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;list-style:none;">` +
        `<span class="bl-caret" style="${MONO}font-size:9px;color:${C.faint};transition:transform .18s;">▶</span>` +
        `<span style="${MONO}font-size:12.5px;font-weight:600;color:${C.ink};">${esc(h.tag)}</span>` +
        `<span style="${MONO}font-size:11px;color:${C.faint};">${esc(h.date)}</span>` +
        (h.waived ? `<span style="${MONO}font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;padding:2px 6px;border-radius:4px;border:1px solid ${C.amber}55;color:${C.amber};">${bi("waived", "曾豁免")}</span>` : "") +
        `<span style="flex:1;"></span><span style="${MONO}font-size:11px;color:${C.faint};">${h.items.length} ${bi("entries", "条")}</span></summary>` +
        `<ul style="margin:0;padding:6px 16px 12px 40px;font-size:12.5px;color:${C.sub};line-height:1.6;">${h.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` +
        `</details>`,
    )
    .join("");
  return (
    sectionHead(bi("Pending delivery", "待交付"), sc.pendingCount, C.amber, bi("wishes still open this cut", "本版仍开着的愿望")) +
    (sc.pending.length > 0 ? sc.pending.map((g) => scopeGroup(g, input, false)).join("") : `<section style="border:1px dashed ${C.line};border-radius:12px;background:${C.card};padding:16px 20px;color:${C.faint};font-size:12.5px;font-style:italic;">${bi("nothing pending — ship it", "没有待交付——可以发了")}</section>`) +
    sectionHead(bi("Changelog (merged truth)", "变更日志（合并真相）"), sc.shippedCount, C.green, bi("generated from merged PRs, not claims", "从 merged PR 生成，不读声明")) +
    sc.shipped.slice(0, 12).map((g) => scopeGroup(g, input, true)).join("") +
    `<div style="display:flex;align-items:baseline;gap:12px;margin:28px 0 12px;">` +
    `<span style="${MONO}font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${C.sub};font-weight:600;">${bi("Version history", "历史版本")}</span>` +
    `<span style="flex:1;height:1px;background:#dfe4ec;"></span></div>` +
    `<section style="border:1px solid ${C.line};border-radius:12px;background:${C.card};overflow:hidden;margin:0 0 8px;">${history}</section>`
  );
}

function fwuInline(t: { fail: number; warn: number; unknown: number }): string {
  return `f:${t.fail} w:${t.warn} ?:${t.unknown}`;
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
  function hashParts() {
    return (location.hash || "").replace(/^#/, "").split("/");
  }
  function currentTab() {
    var h = hashParts()[0];
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
  // US-DOSSIER-012: backlog search + state filters; #backlog/<state> pre-sets one.
  var active = {};
  function applyFilters() {
    var q = (document.getElementById("bl-search") || { value: "" }).value.toLowerCase();
    var any = Object.keys(active).some(function (k) { return active[k]; });
    var rows = document.querySelectorAll(".bl-row");
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var okState = !any || active[r.getAttribute("data-state")];
      var okText = q === "" || (r.getAttribute("data-text") || "").indexOf(q) >= 0;
      r.style.display = okState && okText ? "" : "none";
    }
    var epics = document.querySelectorAll(".bl-epic");
    for (var j = 0; j < epics.length; j++) {
      var visible = epics[j].querySelectorAll('.bl-row:not([style*="display: none"])').length;
      epics[j].style.display = visible > 0 ? "" : "none";
      if ((any || q !== "") && visible > 0) epics[j].setAttribute("open", "");
    }
    var chips = document.querySelectorAll(".bl-chip");
    for (var c = 0; c < chips.length; c++) {
      chips[c].classList.toggle("on", !!active[chips[c].getAttribute("data-filter")]);
    }
  }
  // US-DOSSIER-013: cycle ledger range filter (verdicts recounted, failures never hidden).
  function applyRange(range) {
    var rows = document.querySelectorAll(".cy-row");
    var nowSec = Math.floor(Date.now() / 1000);
    var horizon = range === "all" ? Infinity : Number(range) * 86400;
    var count = 0, failed = 0;
    for (var i = 0; i < rows.length; i++) {
      var ts = Number(rows[i].getAttribute("data-ts")) || 0;
      var show = range === "all" || nowSec - ts <= horizon;
      rows[i].style.display = show ? "" : "none";
      if (show) {
        count++;
        var v = rows[i].getAttribute("data-verdict");
        if (v === "failed" || v === "reverted" || v === "blocked") failed++;
      }
    }
    var c = document.getElementById("cy-count");
    var f = document.getElementById("cy-failed");
    if (c) c.textContent = String(count);
    if (f) f.textContent = String(failed);
    var btns = document.querySelectorAll(".cy-range");
    for (var b = 0; b < btns.length; b++) btns[b].classList.toggle("on", btns[b].getAttribute("data-range") === range);
  }
  function applyPrefilter() {
    var parts = hashParts();
    if (parts[0] === "backlog" && parts[1]) {
      if (parts[1].indexOf("q:") === 0) {
        // US-DOSSIER-015: dimension drift chips deep-link a search query.
        var q = parts[1].slice(2);
        try { q = decodeURIComponent(q); } catch (e) { /* malformed escape — use raw */ }
        var box = document.getElementById("bl-search");
        if (box) { box.value = q; }
        active = {};
        applyFilters();
      } else {
        active = {};
        active[parts[1]] = true;
        applyFilters();
      }
    }
  }
  window.addEventListener("hashchange", function () { applyTab(); applyPrefilter(); });
  document.addEventListener("DOMContentLoaded", function () {
    applyLang();
    applyTab();
    applyPrefilter();
    var chips = document.querySelectorAll(".bl-chip");
    for (var c = 0; c < chips.length; c++) {
      chips[c].addEventListener("click", function () {
        var k = this.getAttribute("data-filter");
        active[k] = !active[k];
        applyFilters();
      });
    }
    var search = document.getElementById("bl-search");
    if (search) search.addEventListener("input", applyFilters);
    var chipsCopy = document.querySelectorAll(".copy-chip");
    for (var cc = 0; cc < chipsCopy.length; cc++) {
      chipsCopy[cc].addEventListener("click", function () {
        var text = this.getAttribute("data-copy") || this.textContent;
        var self = this;
        try {
          navigator.clipboard.writeText(text).then(function () {
            var old = self.textContent;
            self.textContent = "✓ copied";
            setTimeout(function () { self.textContent = old; }, 1200);
          });
        } catch (e) { /* clipboard unavailable (file://) — chip stays copyable by selection */ }
      });
    }
    var rbs = document.querySelectorAll(".cy-range");
    for (var rb = 0; rb < rbs.length; rb++) {
      rbs[rb].addEventListener("click", function () { applyRange(this.getAttribute("data-range")); });
    }
    applyRange("3");
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
.bl-epic{border:1px solid ${C.line};border-radius:12px;background:${C.card};margin:0 0 9px;overflow:hidden;box-shadow:0 1px 2px rgba(17,26,69,.04);}
.bl-epic summary::-webkit-details-marker{display:none;}
.bl-epic[open] .bl-caret{transform:rotate(90deg);}
.bl-row:hover{background:#f6f8fb;}
.bl-chip.on{border-color:${C.blue};box-shadow:0 0 0 1px ${C.blue}33;}
.cy-row summary::-webkit-details-marker{display:none;}
.cy-row[open] .bl-caret{transform:rotate(90deg);}
.cy-row summary:hover{background:#fbfcfe;}
.cy-range.on{background:${C.blue};color:#fff;}
.ag-row summary::-webkit-details-marker{display:none;}
.ag-row[open] .bl-caret{transform:rotate(90deg);}
.ag-row summary:hover{background:#fbfcfe;}
`;

  const panes =
    `<div id="tab-overview">${overviewTab(input)}</div>` +
    `<div id="tab-loop" style="display:none;">${loopTab(input)}</div>` +
    `<div id="tab-release" style="display:none;">${releaseTab(input)}</div>` +
    `<div id="tab-backlog" style="display:none;">${backlogTab(input)}</div>` +
    `<div id="tab-skills" style="display:none;">${placeholderTab("Skills", "技能", "US-DOSSIER-017")}</div>`;

  return (
    `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${esc(input.brand.name)} · Truth Console</title>\n` +
    `<link rel="preconnect" href="https://fonts.googleapis.com">\n` +
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n` +
    `<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+SC:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">\n` +
    `<style>${css}</style>\n` +
    `${CONSOLE_SCRIPT}\n</head>\n<body>\n` +
    header +
    `<main style="max-width:1100px;margin:0 auto;padding:0 22px 64px;">` +
    `<div style="display:flex;gap:6px;align-items:flex-end;border-bottom:1px solid #dfe4ec;position:sticky;top:54px;background:${C.bg};z-index:20;padding:16px 0 0;">${tabBar}</div>` +
    panes +
    `</main>\n` +
    `<script id="roll-truth" type="application/json">\n${input.snapshotJson.replace(/<\//g, "<\\/")}</script>\n` +
    `</body>\n</html>\n`
  );
}
