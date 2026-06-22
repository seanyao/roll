/**
 * US-OBS-022 — ConsoleApp: renders the live Now tab from TruthSnapshot frames.
 *
 * Reuses the same view-model and design tokens as the static truth-console.ts
 * so the live and static consoles render identically. The transport changes
 * (WebSocket instead of baked HTML) but the rendering contract stays the same.
 */
import type {
  DossierSnapshotFrame,
  DossierHeartbeatFrame,
  TruthSnapshot,
  DegradedNote,
} from "@roll/spec";
import { C, MONO } from "./colors.js";

// ── helpers ────────────────────────────────────────────────────────────────

function el(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: (string | HTMLElement)[]
): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    e.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === "string") {
      e.appendChild(document.createTextNode(child));
    } else {
      e.appendChild(child);
    }
  }
  return e;
}

function div(
  style: string,
  ...children: (string | HTMLElement)[]
): HTMLDivElement {
  return el("div", { style }, ...children) as HTMLDivElement;
}

function span(
  style: string,
  text: string,
): HTMLSpanElement {
  return el("span", { style }, text) as HTMLSpanElement;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortTs(iso: string | undefined): string {
  if (iso === undefined || iso === "") return "—";
  return iso.replace(/^\d{4}-/, "").replace("T", " ").replace(/:\d{2}Z$/, "Z");
}

function sectionLabel(text: string): HTMLSpanElement {
  return span(
    `${MONO}font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:${C.faint};font-weight:600;`,
    text,
  );
}

// ── spectrum constants (same as truth-console.ts) ─────────────────────────

const SPECTRUM_META: Record<
  string,
  { color: string; mark: string; en: string; zh: string }
> = {
  done: { color: C.green, mark: "✓", en: "DONE", zh: "已交付" },
  fail: { color: C.red, mark: "!", en: "DRIFT", zh: "漂移" },
  unknown: { color: C.slate, mark: "?", en: "UNKNOWN", zh: "未知" },
  wip: { color: C.blue, mark: "●", en: "WIP", zh: "进行中" },
  todo: { color: C.amber, mark: "○", en: "TODO", zh: "待办" },
  hold: { color: C.purple, mark: "⏸", en: "HOLD", zh: "挂起" },
};

const SPECTRUM_ORDER = [
  "done",
  "fail",
  "unknown",
  "wip",
  "todo",
  "hold",
] as const;

// ── liveness badge ─────────────────────────────────────────────────────────

export type LivenessState = "live" | "idle" | "paused" | "not-configured";

const LIVENESS_META: Record<
  LivenessState,
  { color: string; en: string; zh: string }
> = {
  live: { color: C.green, en: "live", zh: "实时" },
  idle: { color: C.slate, en: "idle", zh: "空闲" },
  paused: { color: C.amber, en: "paused", zh: "暂停" },
  "not-configured": { color: C.faint, en: "no daemon", zh: "无守护" },
};

// ── ConsoleApp ─────────────────────────────────────────────────────────────

export class ConsoleApp {
  private readonly container: HTMLElement;
  private nowRoot: HTMLElement | null = null;
  private freshnessBanner: HTMLElement | null = null;
  private livenessBadge: HTMLElement | null = null;

  /** Current snapshot data (null until first frame). */
  private snapshot: TruthSnapshot | null = null;
  /** Current degraded notes (AC4: never silent-0). */
  private degradedNotes: DegradedNote[] = [];
  /** Current liveness from the most recent heartbeat. */
  private liveness: LivenessState = "not-configured";
  /** Whether we are in degraded (static fallback) mode. */
  private degraded = false;
  /** ETag of the last rendered snapshot. */
  private renderedEtag: string | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.style.cssText = `font-family:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,sans-serif;background:${C.bg};min-height:100vh;`;
  }

  /** AC1: Render the Now tab from a snapshot frame. ETag skip handled by caller. */
  renderSnapshot(frame: DossierSnapshotFrame): void {
    this.snapshot = frame.snapshot;
    this.renderedEtag = frame.etag;
    this.degraded = false;
    this.degradedNotes = frame.degraded ?? [];
    this.renderNow();
  }

  /** AC2: Update liveness from a heartbeat frame. */
  updateHeartbeat(frame: DossierHeartbeatFrame): void {
    this.liveness = frame.liveness;
    this.updateLivenessBadge();
  }

  /**
   * AC3: Switch to degraded (static fallback) mode.
   * Renders from a baked TruthSnapshot (fetched from truth.json).
   */
  renderDegraded(snapshot: TruthSnapshot, collectedAt?: string): void {
    this.snapshot = snapshot;
    this.degraded = true;
    this.renderNow();
    if (collectedAt && this.freshnessBanner) {
      this.freshnessBanner.style.display = "block";
      this.freshnessBanner.setAttribute("data-collected-at", collectedAt);
    }
  }

  // ── private ────────────────────────────────────────────────────────────

  private renderNow(): void {
    this.container.innerHTML = "";
    this.nowRoot = div("max-width:960px;margin:0 auto;padding:24px 20px 60px;");

    // Freshness banner
    this.freshnessBanner = this.buildFreshnessBanner();
    this.nowRoot.appendChild(this.freshnessBanner);

    // Liveness badge
    const headerRow = div(
      "display:flex;align-items:center;gap:12px;margin-bottom:20px;",
    );
    headerRow.appendChild(
      span(
        `${MONO}font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${C.sub};font-weight:600;`,
        "roll · Truth Console",
      ),
    );
    this.livenessBadge = this.buildLivenessBadge();
    headerRow.appendChild(this.livenessBadge);
    this.nowRoot.appendChild(headerRow);

    // Now heading
    this.nowRoot.appendChild(
      el(
        "h1",
        {
          style: `margin:10px 0 0;font-size:33px;line-height:1.1;font-weight:700;letter-spacing:0;color:${C.ink};`,
        },
        "Now",
      ),
    );

    // Story spectrum
    if (this.snapshot) {
      this.nowRoot.appendChild(this.buildSpectrumBoard(this.snapshot));
    }

    // Degraded note
    if (this.degraded) {
      this.nowRoot.appendChild(this.buildDegradedNote());
    }

    this.container.appendChild(this.nowRoot);
  }

  private buildFreshnessBanner(): HTMLElement {
    const banner = div(
      `display:none;margin:16px 0 0;padding:10px 16px;border:1px solid ${C.amber}55;border-radius:10px;background:${C.amber}0d;${MONO}font-size:12px;color:${C.amber};`,
      "This snapshot is static — daemon not connected. Auto-reconnecting...",
    );
    banner.id = "freshness-banner";
    return banner;
  }

  private buildLivenessBadge(): HTMLElement {
    const meta = LIVENESS_META[this.liveness];
    const badge = span(
      `${MONO}font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid ${meta.color}44;color:${meta.color};`,
      meta.en,
    );
    badge.setAttribute("data-liveness", this.liveness);
    return badge;
  }

  private updateLivenessBadge(): void {
    if (!this.livenessBadge) return;
    const meta = LIVENESS_META[this.liveness];
    this.livenessBadge.style.cssText = `${MONO}font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid ${meta.color}44;color:${meta.color};`;
    this.livenessBadge.textContent = meta.en;
    this.livenessBadge.setAttribute("data-liveness", this.liveness);
  }

  private buildSpectrumBoard(s: TruthSnapshot): HTMLElement {
    const container = div(
      `border:1px solid ${C.line};border-radius:14px;background:${C.card};overflow:hidden;margin:14px 0 8px;box-shadow:0 1px 2px rgba(17,26,69,.05);`,
    );

    // Tally cards
    const tallyRow = div("display:grid;grid-template-columns:repeat(6,1fr);");
    for (const k of SPECTRUM_ORDER) {
      const meta = SPECTRUM_META[k]!;
      const n = s.story.spectrum[k] ?? 0;
      const card = div(
        `position:relative;padding:14px 14px 12px;border-left:1px solid ${C.hair};`,
        span(`${MONO}font-size:11px;color:${meta.color};`, meta.mark),
        el(
          "div",
          {
            style: `font-size:30px;font-weight:700;letter-spacing:-.02em;color:${n > 0 ? C.ink : "#c3cad6"};font-variant-numeric:tabular-nums;margin:5px 0 1px;${MONO}`,
          },
          String(n),
        ),
        div(
          `${MONO}font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${C.slate};font-weight:600;`,
          meta.en,
        ),
      );
      card.setAttribute("data-spectrum", k);
      tallyRow.appendChild(card);
    }
    container.appendChild(tallyRow);

    // Bar + legend
    const barSection = div(
      `padding:16px 18px 15px;border-top:1px solid ${C.hair};background:#fbfcfe;`,
    );

    const barContainer = div(
      `display:flex;height:13px;border-radius:999px;overflow:hidden;border:1px solid ${C.line};background:${C.card};`,
    );
    for (const k of SPECTRUM_ORDER) {
      const meta = SPECTRUM_META[k]!;
      const n = s.story.spectrum[k] ?? 0;
      if (n > 0) {
        barContainer.appendChild(
          div(
            `flex:${n} 1 0%;background:${meta.color};`,
          ),
        );
      }
    }
    barSection.appendChild(barContainer);

    const infoRow = div(
      `display:flex;justify-content:space-between;gap:12px;margin-top:9px;${MONO}font-size:11.5px;color:${C.dim};`,
      span("", `${s.story.total} stories`),
    );
    barSection.appendChild(infoRow);

    const legendRow = div(
      `display:flex;flex-wrap:wrap;gap:16px;margin-top:11px;${MONO}font-size:11px;color:${C.slate};`,
    );
    for (const k of SPECTRUM_ORDER) {
      const meta = SPECTRUM_META[k]!;
      const n = s.story.spectrum[k] ?? 0;
      const sp = span(
        `display:inline-flex;align-items:center;gap:6px;`,
        "",
      );
      sp.appendChild(
        div(
          `width:9px;height:9px;border-radius:3px;background:${meta.color};display:inline-block;`,
        ),
      );
      sp.appendChild(
        document.createTextNode(`${meta.en} ${n}`),
      );
      legendRow.appendChild(sp);
    }
    barSection.appendChild(legendRow);
    container.appendChild(barSection);

    return container;
  }

  /** AC4: degraded[] per-collector failures → visible `?` / paused indicator, never silent-0. */
  private buildDegradedNote(): HTMLElement {
    const container = div(
      `margin:12px 0;padding:10px 14px;border:1px solid ${C.amber}44;border-radius:8px;background:${C.amber}08;${MONO}font-size:11.5px;color:${C.amber};`,
    );
    container.appendChild(
      span("font-weight:600;", "⚠ Degraded — showing static snapshot. "),
    );

    if (this.degradedNotes.length > 0) {
      const list = el("ul", {
        style: `margin:6px 0 0 16px;padding:0;list-style:none;`,
      });
      for (const note of this.degradedNotes) {
        const li = el("li", {
          style: `margin:4px 0;display:flex;align-items:center;gap:6px;`,
        });
        li.appendChild(
          span(
            `${MONO}font-size:10px;padding:1px 6px;border-radius:4px;background:${C.amber}22;color:${C.amber};`,
            "?",
          ),
        );
        li.appendChild(
          span(
            `font-size:11px;color:${C.dim};`,
            `${esc(note.surface)}: ${esc(note.reason)}`,
          ),
        );
        list.appendChild(li);
      }
      container.appendChild(list);
    } else {
      container.appendChild(
        span(
          `font-size:11px;color:${C.dim};`,
          "Some collectors may be paused.",
        ),
      );
    }

    return container;
  }
}
