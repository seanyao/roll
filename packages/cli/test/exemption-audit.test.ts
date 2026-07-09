/**
 * US-EVID-027 — read-only audit of existing exemptions + policy blanket epics.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blanketExemptEpics, exemptionAudit, renderExemptionAudit } from "../src/runner/exemption-audit.js";

function project(
  cards: Array<{ epic: string; id: string; reason?: string }>,
  policy?: string,
): string {
  const root = mkdtempSync(join(tmpdir(), "roll-evid027-"));
  for (const c of cards) {
    const dir = join(root, ".roll", "features", c.epic, c.id);
    mkdirSync(dir, { recursive: true });
    const line = c.reason ? `screenshot_exempt: ${c.reason}\n` : "";
    writeFileSync(join(dir, "spec.md"), `---\nid: ${c.id}\ntitle: t\n${line}---\n\n# ${c.id}\n`, "utf8");
  }
  if (policy !== undefined) {
    mkdirSync(join(root, ".roll"), { recursive: true });
    writeFileSync(join(root, ".roll", "policy.yaml"), policy, "utf8");
  }
  return root;
}

describe("exemptionAudit", () => {
  it("lists per-card exemptions (sorted) and skips non-exempt cards", () => {
    const root = project([
      { epic: "z", id: "US-9", reason: "infra; tests" },
      { epic: "a", id: "US-1", reason: "backend; tests" },
      { epic: "a", id: "US-2" }, // not exempt
    ]);
    const audit = exemptionAudit(root);
    expect(audit.cards).toEqual([
      { id: "US-1", epic: "a", reason: "backend; tests" },
      { id: "US-9", epic: "z", reason: "infra; tests" },
    ]);
  });

  it("reads policy blanket-exempt epics — inline flow AND block sequence", () => {
    expect(blanketExemptEpics(project([], "acceptance:\n  screenshot_exempt_epics: [feedback-truth-alignment, x]\n"))).toEqual([
      "feedback-truth-alignment",
      "x",
    ]);
    // block sequence form (the case the old regex missed)
    expect(
      blanketExemptEpics(project([], "acceptance:\n  screenshot_exempt_epics:\n    - feedback-truth-alignment\n    - y  # note\n  other: z\n")),
    ).toEqual(["feedback-truth-alignment", "y"]);
    expect(blanketExemptEpics(project([]))).toEqual([]);
  });

  it("renders a read-only report naming card exemptions + blanket epics", () => {
    const root = project([{ epic: "a", id: "US-1", reason: "backend" }], "acceptance:\n  screenshot_exempt_epics: [e1]\n");
    const out = renderExemptionAudit(exemptionAudit(root));
    expect(out).toContain("read-only");
    expect(out).toContain("a/US-1 — backend");
    expect(out).toContain("blanket-exempt epics: e1");
  });

  it("no features dir ⇒ empty audit (never throws)", () => {
    const audit = exemptionAudit(mkdtempSync(join(tmpdir(), "roll-evid027-empty-")));
    expect(audit).toEqual({ cards: [], blanketEpics: [] });
  });
});
