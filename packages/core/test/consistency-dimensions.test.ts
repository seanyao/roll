/** US-DOSSIER-015 — the six-dimension split of the gate audit. */
import { describe, expect, it } from "vitest";
import { CONSISTENCY_DIMENSIONS, dimensionOfRule, tallyByDimension, type AuditFinding } from "../src/consistency/audit.js";

const f = (rule: string, severity: AuditFinding["severity"], subject = "US-X-1"): AuditFinding => ({ rule, severity, subject, detail: "d" });

describe("dimensionOfRule", () => {
  it("maps every known rule and never loses an unknown one (total mapping)", () => {
    expect(dimensionOfRule("done-no-merge")).toBe("code-backlog");
    expect(dimensionOfRule("terminal-twin-missing")).toBe("code-backlog");
    expect(dimensionOfRule("done-missing-attest")).toBe("cards");
    expect(dimensionOfRule("index-missing-live-card")).toBe("cards");
    expect(dimensionOfRule("doc-gap")).toBe("docs");
    expect(dimensionOfRule("bilingual-parity")).toBe("bilingual");
    expect(dimensionOfRule("site-drift")).toBe("site");
    expect(dimensionOfRule("brand-new-rule-from-the-future")).toBe("code-backlog"); // total, never unmapped
  });
});

describe("tallyByDimension — AC2 strict equality", () => {
  it("six rows sum exactly to the status line; grandfathered stays out", () => {
    const findings: AuditFinding[] = [
      f("done-no-merge", "fail"),
      f("done-no-merge", "grandfathered"),
      f("done-missing-attest", "warn", "US-X-2"),
      f("index-missing-live-card", "warn", "US-X-3"),
      f("terminal-twin-missing", "unknown", "c1"),
      f("usage-missing", "unknown", "c2"),
      f("doc-gap", "fail", "FIX-9"),
    ];
    const tallies = tallyByDimension(findings);
    let fSum = 0, wSum = 0, uSum = 0;
    for (const d of CONSISTENCY_DIMENSIONS) {
      fSum += tallies[d].fail;
      wSum += tallies[d].warn;
      uSum += tallies[d].unknown;
    }
    expect(fSum).toBe(2); // grandfathered excluded
    expect(wSum).toBe(2);
    expect(uSum).toBe(2);
    expect(tallies["code-backlog"].subjects).toContain("US-X-1");
    expect(tallies["docs"].fail).toBe(1);
  });
});
