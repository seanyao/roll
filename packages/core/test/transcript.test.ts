/**
 * US-ATTEST-014 — the shared cycle-trace extractor (loop-fmt 三层口径; reused by
 * US-PORT-012's observation window). Pins:
 *   - three-layer reduction: lifecycle spine (outline) + tcr/Gate/PR/ALERT
 *     turning points (signal), chronological & stable;
 *   - cycleId scoping: other cycles' lifecycle/tcr drop, cycleId-less PR/CI/
 *     ALERT events (caller-scoped) are kept;
 *   - offsetSec relative to the first event (timezone-free, deterministic);
 *   - boundTranscript: size cap with head+tail elision + truncation marker.
 */
import type { RollEvent } from "@roll/spec";
import { describe, expect, it } from "vitest";
import { boundTranscript, extractCycleSignals, isSignalMarker, SIGNAL_MARKERS, signalLabel } from "../src/loop/transcript.js";

const CYCLE = "20260606-093000-12345";

function events(): RollEvent[] {
  return [
    { type: "cycle:start", cycleId: CYCLE, storyId: "US-ATTEST-014", agent: "claude", model: "opus", ts: 1000 },
    { type: "cycle:phase", cycleId: CYCLE, phase: "execute", ts: 1010 },
    { type: "cycle:tcr", cycleId: CYCLE, commitHash: "abcdef1234", message: "tcr: add extractor", ts: 1020 },
    { type: "cycle:tcr", cycleId: CYCLE, commitHash: "0987654321", message: "tcr: render block", ts: 1040 },
    { type: "pr:open", prNumber: 490, storyId: "US-ATTEST-014", ts: 1060 },
    { type: "ci:pass", prNumber: 490, ts: 1080 },
    { type: "attest:gate", cycleId: CYCLE, verdict: "produced", reasons: [], ts: 1090 },
    { type: "pr:merge", prNumber: 490, storyId: "US-ATTEST-014", ts: 1120 },
    { type: "cycle:end", cycleId: CYCLE, outcome: "delivered", cost: { cycleId: CYCLE, agent: "claude", model: "opus", tokensIn: 0, tokensOut: 0, estimatedCost: 0, revertCount: 0, effectiveCost: 0 }, ts: 1140 },
  ];
}

describe("extractCycleSignals — three-layer reduction", () => {
  it("builds a chronological timeline with outline + signal layers", () => {
    const r = extractCycleSignals(events(), CYCLE);
    expect(r.cycleId).toBe(CYCLE);
    // chronological, all kept
    expect(r.timeline.map((t) => t.marker)).toEqual([
      "cycle:start",
      "phase:execute",
      "tcr",
      "tcr",
      "pr:open",
      "ci:pass",
      "attest:gate",
      "pr:merge",
      "cycle:end",
    ]);
  });

  it("turningPoints are exactly the signal-layer entries (tcr/Gate/PR/ALERT)", () => {
    const r = extractCycleSignals(events(), CYCLE);
    expect(r.turningPoints.every((t) => t.layer === "signal")).toBe(true);
    expect(r.turningPoints.map((t) => t.marker)).toEqual([
      "tcr",
      "tcr",
      "pr:open",
      "ci:pass",
      "attest:gate",
      "pr:merge",
    ]);
    // lifecycle spine is "outline"
    expect(r.timeline.find((t) => t.marker === "cycle:start")?.layer).toBe("outline");
    expect(r.timeline.find((t) => t.marker === "cycle:end")?.layer).toBe("outline");
  });

  it("offsetSec is relative to the first event", () => {
    const r = extractCycleSignals(events(), CYCLE);
    expect(r.timeline[0]?.offsetSec).toBe(0);
    expect(r.timeline.at(-1)?.offsetSec).toBe(140);
  });

  it("labels carry the human turning-point text", () => {
    const r = extractCycleSignals(events(), CYCLE);
    const tcr = r.timeline.find((t) => t.marker === "tcr");
    expect(tcr?.label).toContain("add extractor");
    expect(r.timeline.find((t) => t.marker === "pr:merge")?.label).toContain("490");
    expect(r.timeline.find((t) => t.marker === "attest:gate")?.label).toContain("produced");
  });

  it("scopes by cycleId — other cycles' lifecycle/tcr drop, cycleId-less stay", () => {
    const mixed: RollEvent[] = [
      { type: "cycle:tcr", cycleId: "OTHER", commitHash: "x", message: "tcr: foreign", ts: 1005 },
      ...events(),
    ];
    const r = extractCycleSignals(mixed, CYCLE);
    expect(r.timeline.some((t) => t.label.includes("foreign"))).toBe(false);
    // pr:open has no cycleId yet is kept (caller scoped it by story)
    expect(r.timeline.some((t) => t.marker === "pr:open")).toBe(true);
  });

  it("ms-epoch and second-epoch both normalize to second offsets", () => {
    const ms: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE, storyId: "S", agent: "a", model: "m", ts: 1_700_000_000_000 },
      { type: "cycle:end", cycleId: CYCLE, outcome: "delivered", cost: { cycleId: CYCLE, agent: "a", model: "m", tokensIn: 0, tokensOut: 0, estimatedCost: 0, revertCount: 0, effectiveCost: 0 }, ts: 1_700_000_000_000 + 90_000 },
    ];
    const r = extractCycleSignals(ms, CYCLE);
    expect(r.timeline.at(-1)?.offsetSec).toBe(90);
  });

  it("empty events yield an empty timeline (no throw)", () => {
    expect(extractCycleSignals([], CYCLE).timeline).toEqual([]);
  });

  it("a non-matching cycleId drops cycle-bound events but keeps caller-scoped PR/CI", () => {
    const r = extractCycleSignals(events(), "NOPE");
    // cycle-bound lifecycle/tcr/attest drop
    expect(r.timeline.some((t) => ["cycle:start", "cycle:end", "tcr", "attest:gate"].includes(t.marker))).toBe(false);
    // cycleId-less PR/CI events stay (caller scoped them by story upstream)
    expect(r.timeline.map((t) => t.marker)).toEqual(["pr:open", "ci:pass", "pr:merge"]);
  });
});

describe("signal vocabulary — single source of 口径 (US-PORT-012)", () => {
  it("every signal-layer marker toEntry emits is a canonical SIGNAL_MARKER", () => {
    const r = extractCycleSignals(events(), CYCLE);
    for (const t of r.timeline.filter((e) => e.layer === "signal")) {
      expect(isSignalMarker(t.marker)).toBe(true);
    }
  });

  it("the attest timeline's signal labels come from signalLabel (one source)", () => {
    const r = extractCycleSignals(events(), CYCLE);
    // The tcr entry in the timeline must equal what signalLabel produces for
    // the same logical signal — proving the report timeline and any other
    // consumer (the watch formatter) share one label, not two copies.
    const tcr = r.timeline.find((t) => t.marker === "tcr");
    expect(tcr?.label).toBe(signalLabel({ kind: "tcr", commitHash: "abcdef1234", message: "tcr: add extractor" }));
    const merge = r.timeline.find((t) => t.marker === "pr:merge");
    expect(merge?.label).toBe(signalLabel({ kind: "pr:merge", prNumber: 490 }));
  });

  it("signalLabel covers every SIGNAL_MARKER (no marker without a label)", () => {
    const samples: Record<string, string> = {
      tcr: signalLabel({ kind: "tcr", commitHash: "deadbeef99", message: "tcr: x" }),
      "ci:pass": signalLabel({ kind: "ci:pass", prNumber: 1 }),
      "ci:fail": signalLabel({ kind: "ci:fail", prNumber: 1 }),
      "ci:rerun": signalLabel({ kind: "ci:rerun", prNumber: 1 }),
      "peer:gate": signalLabel({ kind: "peer:gate", verdict: "AGREE" }),
      "attest:gate": signalLabel({ kind: "attest:gate", verdict: "produced" }),
      "pr:open": signalLabel({ kind: "pr:open", prNumber: 1 }),
      "pr:merge": signalLabel({ kind: "pr:merge", prNumber: 1 }),
      "pr:rebase": signalLabel({ kind: "pr:rebase", prNumber: 1 }),
      "pr:close": signalLabel({ kind: "pr:close", prNumber: 1 }),
      alert: signalLabel({ kind: "alert", message: "boom" }),
    };
    for (const m of SIGNAL_MARKERS) {
      expect(samples[m]).toBeTruthy();
    }
  });

  it("ci label omits the PR segment when no number is known (watch path)", () => {
    expect(signalLabel({ kind: "ci:pass", prNumber: 0 })).toBe("Gate CI 通过");
    expect(signalLabel({ kind: "ci:pass", prNumber: 490 })).toBe("Gate CI 通过 · PR #490");
    expect(signalLabel({ kind: "ci:fail", prNumber: 0 })).toBe("Gate CI 失败");
  });

  it("isSignalMarker rejects non-signal markers", () => {
    expect(isSignalMarker("cycle:start")).toBe(false);
    expect(isSignalMarker("phase:execute")).toBe(false);
    expect(isSignalMarker("story")).toBe(false);
  });
});

describe("boundTranscript — size cap with head+tail elision", () => {
  it("returns the whole text untouched when under the cap", () => {
    const r = boundTranscript("short log", { maxLen: 100 });
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("short log");
    expect(r.shownLen).toBe(r.totalLen);
  });

  it("elides the middle with a marker when over the cap", () => {
    const raw = "H".repeat(50) + "M".repeat(200) + "T".repeat(50);
    const r = boundTranscript(raw, { maxLen: 120, headLen: 40, tailLen: 40 });
    expect(r.truncated).toBe(true);
    expect(r.text.startsWith("H".repeat(40))).toBe(true);
    expect(r.text.endsWith("T".repeat(40))).toBe(true);
    expect(r.text).toMatch(/省略|elided/);
    expect(r.totalLen).toBe(300);
    expect(r.shownLen).toBeLessThan(r.totalLen);
  });
});
