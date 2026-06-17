/**
 * US-DOSSIER-035 — bare `roll` front door (design frame 0).
 *
 * The verdict word is read from the ONE TruthSnapshot the web reads (no
 * recompute); EN/中 snapshots are single-language per resolved locale and
 * deterministic (color scrubbed, no clock in the emitter).
 */
import { describe, expect, it } from "vitest";
import type { TruthSnapshot } from "@roll/spec";
import { renderFrontDoor } from "../src/lib/front-door.js";
import { stripAnsi } from "../src/render.js";

function snap(overrides: Partial<TruthSnapshot> = {}): TruthSnapshot {
  return {
    generatedAt: "2026-06-13T08:30:00Z",
    story: { total: 3, spectrum: { done: 2, wip: 0, hold: 0, todo: 1, fail: 0, unknown: 0 }, legacy: 1 },
    audit: { fail: 0, warn: 3, unknown: 0 },
    stories: [
      { id: "A", epic: "e", ladder: "attested", evidence: { report: true, acMap: true, visualEvidence: true }, truthState: "done", legacy: false },
    ],
    ...overrides,
  };
}

const fd = (input: Parameters<typeof renderFrontDoor>[0]): string => stripAnsi(renderFrontDoor(input));

describe("roll front door — US-DOSSIER-035", () => {
  it("AC1: three bands — identity + verdict (from snapshot) + command map", () => {
    const out = fd({ version: "3.611.2", slogan: "It just works.", snapshot: snap(), stale: false, lang: "en" });
    // line 1: identity = version + slogan
    expect(out).toMatch(/^roll v3\.611\.2 — It just works\./m);
    // line 2: verdict read from the snapshot's audit (warn>0 → WARN) + pointer
    expect(out).toContain("WARN");
    expect(out).toContain("main reconciled vs backlog");
    expect(out).toContain("→ roll status");
    // line 3..5: the command map rows
    expect(out).toMatch(/daily\s+status · cycles · backlog · release/);
    expect(out).toMatch(/cards\s+idea/);
    expect(out).toMatch(/machine\s+loop · agent · doctor · skills · config · setup · update/);
  });

  it("AC1: the verdict word follows the snapshot's audit — same table as the web", () => {
    expect(fd({ version: "v", slogan: "s", snapshot: snap({ audit: { fail: 0, warn: 0, unknown: 0 } }), stale: false, lang: "en" })).toContain("PASS");
    expect(fd({ version: "v", slogan: "s", snapshot: snap({ audit: { fail: 2, warn: 0, unknown: 0 } }), stale: false, lang: "en" })).toContain("FAIL");
    // no audit at all → UNKNOWN, never undefined or a fabricated verdict.
    const noAudit = fd({ version: "v", slogan: "s", snapshot: snap({ audit: undefined }), stale: false, lang: "en" });
    expect(noAudit).toContain("UNKNOWN");
    expect(noAudit).not.toContain("undefined");
  });

  it("AC2: missing snapshot falls back honestly — states it, still maps + points", () => {
    const out = fd({ version: "3.611.2", slogan: "It just works.", snapshot: undefined, stale: false, lang: "en" });
    expect(out).toContain("no truth snapshot");
    expect(out).toContain("→ roll status");
    expect(out).toContain("daily");
    expect(out).not.toContain("undefined");
  });

  it("AC2: a stale snapshot is flagged, never silently rendered as fresh", () => {
    const out = fd({ version: "v", slogan: "s", snapshot: snap(), stale: true, lang: "en" });
    expect(out).toContain("snapshot stale");
  });

  it("AC6: EN/中 snapshots (single-language per locale, color scrubbed)", () => {
    expect(fd({ version: "3.611.2", slogan: "It just works.", snapshot: snap(), stale: false, lang: "en" })).toMatchSnapshot();
    expect(fd({ version: "3.611.2", slogan: "It just works.", snapshot: snap(), stale: false, lang: "zh" })).toMatchSnapshot();
  });
});
