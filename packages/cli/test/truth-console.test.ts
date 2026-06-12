/**
 * US-DOSSIER-011 — the Truth Console shell + Overview. Numbers come from the
 * ONE TruthSnapshot; tabs are hash-routed; brand is injected; copy is fully
 * bilingual (single-language presentation via roll-lang).
 */
import { describe, expect, it } from "vitest";
import { serializeTruthSnapshot, type TruthSnapshot } from "@roll/spec";
import { renderTruthConsole } from "../src/lib/truth-console.js";
import { collectLoopHeartbeat } from "../src/lib/loop-heartbeat.js";

const SNAP: TruthSnapshot = {
  generatedAt: "2026-06-13T00:00:00Z",
  collectedAt: "2026-06-12T23:00:00Z",
  story: { total: 10, spectrum: { done: 5, wip: 1, hold: 1, todo: 2, fail: 0, unknown: 1 }, legacy: 3 },
  audit: { fail: 0, warn: 2, unknown: 1 },
  cycle: { cycles3d: 7, failed3d: 2, costUsd3d: 1.5 },
  release: { latestTag: "v3.612.2", verdict: "pass" },
  loop: { lanes: [{ name: "loop", running: true, mode: "cron", everyMin: 60, lastAt: "2026-06-12T23:30:00Z", nextAt: "2026-06-13T00:30:00Z" }] },
};

function render(snapshot: TruthSnapshot = SNAP): string {
  return renderTruthConsole({
    snapshot,
    snapshotJson: serializeTruthSnapshot(snapshot),
    brand: { name: "roll", slogan: "It just works." },
    backlogFragment: '<div class="toolbar">LEDGER-FRAGMENT</div>',
    backlogScript: "<script>/*filter*/</script>",
  });
}

describe("renderTruthConsole — US-DOSSIER-011", () => {
  const html = render();

  it("AC1: five hash-routed tabs in the ruled order, overview first, placeholders marked", () => {
    for (const k of ["overview", "loop", "release", "backlog", "skills"]) {
      expect(html).toContain(`data-tab="${k}"`);
      expect(html).toContain(`id="tab-${k}"`);
    }
    const order = ["overview", "loop", "release", "backlog", "skills"].map((k) => html.indexOf(`data-tab="${k}"`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("US-DOSSIER-013/014");
    expect(html).toContain("US-DOSSIER-015/016");
    expect(html).toContain("US-DOSSIER-017");
    expect(html).toContain("LEDGER-FRAGMENT"); // existing ledger survives under Backlog
    expect(html).toContain("hashchange"); // tab state survives drill-down via hash
  });

  it("AC2: brand name + slogan are injected, not hardcoded", () => {
    const custom = renderTruthConsole({
      snapshot: SNAP,
      snapshotJson: serializeTruthSnapshot(SNAP),
      brand: { name: "acme", slogan: "Ship truth." },
      backlogFragment: "",
      backlogScript: "",
    });
    expect(custom).toContain("acme");
    expect(custom).toContain("Ship truth.");
    expect(custom).not.toContain("It just works.");
  });

  it("AC3: overview carries verdict, heartbeat, three tiles and the spectrum", () => {
    expect(html).toContain('data-truth="verdict"');
    expect(html).toMatch(/data-truth="verdict"[^>]*>WARN</); // warn=2 → WARN
    expect(html).toContain("循环心跳");
    expect(html).toContain("1/1"); // running lanes
    expect(html).toContain('data-tab-link="backlog"');
    expect(html).toContain('data-tab-link="loop"');
    expect(html).toContain('data-tab-link="release"');
    for (const k of ["done", "fail", "unknown", "wip", "todo", "hold"]) expect(html).toContain(`data-truth="spectrum-${k}"`);
    expect(html).toContain('data-prefilter="done"'); // spectrum click pre-sets the backlog filter
  });

  it("AC4: bilingual spans everywhere new copy appears; telemetry is monospace", () => {
    expect(html).toContain('class="lang-en"');
    expect(html).toContain('class="lang-zh"');
    expect(html).toContain("真相判定");
    expect(html).toContain("Truth verdict");
    expect(html).toContain("IBM Plex Mono");
    expect(html).toContain('data-set-lang="en"');
    expect(html).toContain('data-set-lang="zh"');
  });

  it("AC5: every rendered number equals the snapshot (and the embed is the same serialization)", () => {
    const m = /<script id="roll-truth" type="application\/json">\n([\s\S]*?)<\/script>/.exec(html);
    const embedded = JSON.parse((m?.[1] ?? "").replace(/<\\\//g, "</")) as TruthSnapshot;
    expect(embedded).toEqual(SNAP);
    for (const k of ["done", "fail", "unknown", "wip", "todo", "hold"] as const) {
      const dm = new RegExp(`data-truth="spectrum-${k}"[^>]*>(\\d+)<`).exec(html);
      expect(Number(dm?.[1]), k).toBe(SNAP.story.spectrum[k]);
    }
    expect(new RegExp('data-truth="total"[^>]*>10 ').test(html)).toBe(true);
    const pct = /data-truth="merged-pct"[^>]*>(\d+)%/.exec(html);
    expect(Number(pct?.[1])).toBe(50);
  });
});

describe("collectLoopHeartbeat — US-DOSSIER-011", () => {
  it("reads plist presence, period, last run; derives next; off lanes stay visible", () => {
    const hb = collectLoopHeartbeat({
      plistText: (svc) =>
        svc === "loop" ? "<key>StartInterval</key>\n<integer>3600</integer>" : null,
      lastRunAt: () => "2026-06-12T23:30:00Z",
    });
    expect(hb.lanes).toHaveLength(2);
    const loop = hb.lanes[0];
    expect(loop?.running).toBe(true);
    expect(loop?.everyMin).toBe(60);
    expect(loop?.lastAt).toBe("2026-06-12T23:30:00Z");
    expect(loop?.nextAt).toBe("2026-06-13T00:30:00Z");
    expect(hb.lanes[1]?.running).toBe(false);
  });

  it("never throws on a machine with nothing scheduled", () => {
    const hb = collectLoopHeartbeat({ plistText: () => null, lastRunAt: () => null });
    expect(hb.lanes.every((l) => !l.running)).toBe(true);
  });
});
