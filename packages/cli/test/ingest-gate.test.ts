/**
 * US-EVID-022 — ingest soft gate: structural surface check + hold list + phased
 * mode. Structural only (no AC-text NLP); soft (records, never crashes ingest).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearIngestHold,
  ingestGateMode,
  ingestSurfaceReadiness,
  readIngestHolds,
  recordIngestHold,
} from "../src/runner/ingest-gate.js";

const STORY = "US-EVID-022";
const AC_BLOCK = "\n## Acceptance Criteria\n\n- [ ] AC1 something observable\n";

function fm(fields: string): string {
  return `---\nid: ${STORY}\ntitle: t\n${fields}\n---\n\n# ${STORY} — t${AC_BLOCK}`;
}

describe("ingestSurfaceReadiness (structural only)", () => {
  it("AC block + declared deliverable_cmd ⇒ ready", () => {
    expect(ingestSurfaceReadiness(fm("deliverable_cmd: roll cycles"), STORY).ready).toBe(true);
  });

  it("AC block + declared deliverable_url ⇒ ready", () => {
    expect(ingestSurfaceReadiness(fm("deliverable_url: https://app.test/x"), STORY).ready).toBe(true);
  });

  it("AC block + valid screenshot_exempt ⇒ ready", () => {
    expect(ingestSurfaceReadiness(fm("screenshot_exempt: backend; evidence is tests"), STORY).ready).toBe(true);
  });

  it("AC block + NO surface and NO exemption ⇒ needs hold", () => {
    const r = ingestSurfaceReadiness(fm("note: nothing"), STORY);
    expect(r.ready).toBe(false);
    expect(r.needsHold).toBe(true);
    expect(r.reason).toContain("no capture surface");
  });

  it("no AC block ⇒ ready (nothing to gate)", () => {
    const noAc = `---\nid: ${STORY}\ntitle: t\n---\n\n# ${STORY} — t\n\nJust prose, no AC list.\n`;
    expect(ingestSurfaceReadiness(noAc, STORY).ready).toBe(true);
  });

  it("naked screenshot_exempt: true (no reason) does NOT count as a surface", () => {
    expect(ingestSurfaceReadiness(fm("screenshot_exempt: true"), STORY).needsHold).toBe(true);
  });
});

describe("ingestGateMode (phased, default metric)", () => {
  it("defaults to metric when policy absent", () => {
    expect(ingestGateMode(mkdtempSync(join(tmpdir(), "roll-ig-")))).toBe("metric");
  });

  it("reads alert / block from policy.yaml", () => {
    for (const mode of ["alert", "block"] as const) {
      const root = mkdtempSync(join(tmpdir(), "roll-ig-"));
      mkdirSync(join(root, ".roll"), { recursive: true });
      writeFileSync(join(root, ".roll", "policy.yaml"), `loop_safety:\n  ingest_gate: ${mode}\n`, "utf8");
      expect(ingestGateMode(root)).toBe(mode);
    }
  });
});

describe("ingest hold list (soft queue)", () => {
  it("records, dedupes by storyId, and clears", () => {
    const rt = mkdtempSync(join(tmpdir(), "roll-ig-hold-"));
    recordIngestHold(rt, STORY, "no surface", 1);
    recordIngestHold(rt, STORY, "no surface (again)", 2); // dedupe
    expect(readIngestHolds(rt)).toHaveLength(1);
    expect(readIngestHolds(rt)[0]?.reason).toBe("no surface (again)");
    clearIngestHold(rt, STORY);
    expect(readIngestHolds(rt)).toHaveLength(0);
  });

  it("readIngestHolds on absent file ⇒ [] (never throws)", () => {
    expect(readIngestHolds(mkdtempSync(join(tmpdir(), "roll-ig-empty-")))).toEqual([]);
  });
});
