/**
 * US-DOSSIER-035 — `roll status` verdict-first truth summary (design frame 1).
 *
 * Leads with a verdict line + four tab-aligned lines (LOOP/CYCLE/RELEASE/STORY)
 * in the web Overview's name/order; the STORY line's attest coverage + counts
 * are read from the SAME snapshot the web reads (no recompute). EN/中 snapshots.
 */
import { describe, expect, it } from "vitest";
import type { TruthSnapshot } from "@roll/spec";
import { renderTruthSummary, statusTruthJson } from "../src/commands/status.js";
import { attestCoverage, snapshotVerdict } from "../src/lib/truth-read.js";
import { stripAnsi } from "../src/render.js";

function snap(overrides: Partial<TruthSnapshot> = {}): TruthSnapshot {
  return {
    generatedAt: "2026-06-13T08:30:00Z",
    collectedAt: "2026-06-12T03:09:03Z",
    story: { total: 580, spectrum: { done: 366, wip: 0, hold: 0, todo: 7, fail: 0, unknown: 197 }, legacy: 366 },
    audit: { fail: 0, warn: 44, unknown: 78 },
    cycle: { cycles3d: 17, failed3d: 12, costUsd3d: 0.59 },
    release: { latestTag: "v3.611.2", verdict: "pass" },
    loop: {
      lanes: [
        { name: "loop", running: true, mode: "cron", everyMin: 30, nextAt: "2026-06-13T08:55:00Z" },
        { name: "dream", running: false, mode: "nightly", everyMin: 1440 },
      ],
    },
    stories: [
      { id: "A", epic: "e", ladder: "attested", evidence: { report: true, acMap: true, visualEvidence: true }, truthState: "done", legacy: false },
      { id: "B", epic: "e", ladder: "attested", evidence: { report: true, acMap: true, visualEvidence: true }, truthState: "done", legacy: false },
      { id: "C", epic: "e", ladder: "merged", evidence: { report: false, acMap: false, visualEvidence: false }, truthState: "done", legacy: false },
    ],
    ...overrides,
  };
}

const NOW = Date.parse("2026-06-13T08:32:00Z");
const sum = (s: TruthSnapshot | undefined, lang: "en" | "zh", stale = false): string =>
  stripAnsi(renderTruthSummary(s, stale, lang, NOW));

describe("roll status truth summary — US-DOSSIER-035", () => {
  it("AC3: verdict line first, with the exit-code intent", () => {
    const out = sum(snap(), "en");
    const first = out.trimStart().split("\n")[0] ?? "";
    expect(first).toContain("WARN"); // audit.warn>0 → WARN, same table as web
    expect(first).toContain("main reconciled vs backlog");
    expect(first).toContain("exit 1");
  });

  it("AC3: four tab-aligned lines in the web Overview order LOOP→CYCLE→RELEASE→STORY", () => {
    const out = sum(snap(), "en");
    const iLoop = out.indexOf("LOOP");
    const iCycle = out.indexOf("CYCLE");
    const iRelease = out.indexOf("RELEASE");
    const iStory = out.indexOf("STORY");
    expect(iLoop).toBeGreaterThan(-1);
    expect(iLoop).toBeLessThan(iCycle);
    expect(iCycle).toBeLessThan(iRelease);
    expect(iRelease).toBeLessThan(iStory);
    // each line summarizes its snapshot fields
    expect(out).toMatch(/LOOP\s+2 loops · 1 running/);
    expect(out).toMatch(/CYCLE\s+17 \/ 3d   12 failed · \$0\.59/);
    expect(out).toMatch(/RELEASE\s+v3\.611\.2 staged   pass · f:0 w:44 \?:78/);
  });

  it("AC4: STORY line shows attest coverage % + fail + unknown from the snapshot (no recompute)", () => {
    const s = snap();
    const cov = attestCoverage(s); // 2 attested / 3 = 67%
    expect(cov.pct).toBe(67);
    const out = sum(s, "en");
    expect(out).toMatch(new RegExp(`STORY\\s+${cov.pct}% attest coverage`));
    expect(out).toContain(`fail ${s.story.spectrum.fail}`);
    expect(out).toContain(`unknown ${s.story.spectrum.unknown}`);
  });

  it("AC4: the verdict word table matches the web selector exactly", () => {
    expect(snapshotVerdict(snap({ audit: { fail: 0, warn: 0, unknown: 0 } }))).toBe("pass");
    expect(snapshotVerdict(snap({ audit: { fail: 1, warn: 9, unknown: 9 } }))).toBe("fail");
    expect(snapshotVerdict(snap({ audit: undefined }))).toBe("unknown");
  });

  it("AC2/AC3: a missing snapshot falls back honestly — no undefined, points at roll index", () => {
    const out = sum(undefined, "en");
    expect(out).toContain("no truth snapshot");
    expect(out).toContain("roll index");
    expect(out).not.toContain("undefined");
  });

  it("AC6: EN/中 snapshots (single-language per locale, color scrubbed)", () => {
    expect(sum(snap(), "en")).toMatchSnapshot();
    expect(sum(snap(), "zh")).toMatchSnapshot();
  });
});

// US-DOSSIER-036 --json (AC5/AC7): the machine view reads the SAME snapshot +
// selectors the human summary reads — a divergence is a 口径 bug.
describe("roll status --json — US-DOSSIER-036", () => {
  interface StatusJson {
    verdict: string; exit: number; snapshot: boolean; stale: boolean;
    loop: { lanes: number; running: number };
    cycle: { cycles3d: number; failed3d: number; costUsd3d: number } | null;
    release: { latestTag: string | null; verdict: string; fail: number | null; warn: number | null; unknown: number | null; merged: number; pending: number } | null;
    story: { attestCoveragePct: number; fail: number; done: number; unknown: number; todo: number };
  }

  it("AC7: --json verdict/exit/loop/cycle/release/story match the human summary", () => {
    const s = snap();
    const human = sum(s, "en");
    const j = statusTruthJson(s, false) as StatusJson;
    // Same verdict word + exit intent the human first line carries (WARN, exit 1).
    expect(j.verdict).toBe(snapshotVerdict(s));
    expect(j.exit).toBe(1);
    expect(human.trimStart().split("\n")[0]).toContain("exit 1");
    // LOOP/CYCLE/RELEASE numbers identical to the rendered lines.
    expect(j.loop).toEqual({ lanes: 2, running: 1 });
    expect(j.cycle).toEqual({ cycles3d: 17, failed3d: 12, costUsd3d: 0.59 });
    expect(j.release?.fail).toBe(0);
    expect(j.release?.warn).toBe(44);
    expect(j.release?.unknown).toBe(78);
    expect(j.release?.merged).toBe(366);
    expect(j.release?.pending).toBe(580 - 366);
    // STORY attest coverage equals the same selector the human STORY line uses.
    expect(j.story.attestCoveragePct).toBe(attestCoverage(s).pct);
  });

  it("AC6: a missing snapshot reports unknown honestly, never fabricates a verdict", () => {
    const j = statusTruthJson(undefined, false) as StatusJson;
    expect(j.verdict).toBe("unknown");
    expect(j.snapshot).toBe(false);
  });
});
