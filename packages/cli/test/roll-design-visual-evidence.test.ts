/**
 * FIX-311 — the roll-design design-phase visual-evidence contract.
 *
 * Gives the skill text teeth: a pure validator the skill cites and tests pin.
 * A spec must be BORN honest — every non-exempt story owes a visual-evidence AC
 * AND (when it has a web surface) a declared `deliverable_url` pointing at the
 * real product page. Exemption is the only opt-out and must carry a reason.
 *
 * The two FIX-284 holes, caught at the spec source:
 *   ① declared-surface-without-deliverable-url (declared but never captured)
 *   ② missing-visual-evidence-ac (the keyword-as-enabler leak)
 */
import { describe, expect, it } from "vitest";
import {
  declaresDeliverableUrl,
  hasVisualEvidenceAc,
  validateStoryVisualEvidence,
  visualExemptionReason,
} from "../src/lib/design-visual-evidence.js";

describe("FIX-311 design-phase visual-evidence contract", () => {
  describe("pass paths", () => {
    it("a web/visual card with a visual-evidence AC + a declared deliverable_url is valid", () => {
      const spec = `---
deliverable_url: .roll/features/index.html#casting
---
## US-CAST-001 Casting board redesign 📋

**AC:**
- [ ] The Casting board renders the new lane layout
- [ ] Screenshot of the rendered Casting page at the declared deliverable_url is captured
`;
      const v = validateStoryVisualEvidence(spec);
      expect(v.ok).toBe(true);
      expect(v.code).toBeUndefined();
      expect(v.hasVisualEvidenceAc).toBe(true);
      expect(v.declaresDeliverableUrl).toBe(true);
    });

    it("accepts the screenshot_url alias as the declared surface", () => {
      const spec = `---
screenshot_url: https://example.test/app
---
## US-X-1 Title 📋

**AC:**
- [ ] A 截图 of the rendered view proves the new behavior
`;
      expect(validateStoryVisualEvidence(spec).ok).toBe(true);
    });

    it("a genuinely non-visual card with a recorded screenshot_exempt reason is valid (no AC needed)", () => {
      const spec = `---
screenshot_exempt: pure data-migration, no user-visible surface
---
## FIX-500 Migrate legacy ledger rows 📋

**AC:**
- [ ] All legacy rows are migrated with checksums intact
`;
      const v = validateStoryVisualEvidence(spec);
      expect(v.ok).toBe(true);
      expect(v.exemptReason).toBe("pure data-migration, no user-visible surface");
    });

    it("recognises a CLI/TUI visual-evidence AC when paired with a declared surface", () => {
      const spec = `---
deliverable_url: dossier
---
## FIX-501 New roll status output 📋

**AC:**
- [ ] Terminal capture (screenshot) of \`roll status\` shows the new summary line
`;
      expect(validateStoryVisualEvidence(spec).ok).toBe(true);
    });
  });

  describe("fail paths", () => {
    it("hole ②: a non-exempt card with NO visual-evidence AC is invalid (keyword-as-enabler leak closed)", () => {
      const spec = `---
deliverable_url: .roll/features/index.html
---
## US-Y-2 Redesign the dashboard 📋

**AC:**
- [ ] The dashboard groups cards by epic
- [ ] Sorting persists across reloads
`;
      const v = validateStoryVisualEvidence(spec);
      expect(v.ok).toBe(false);
      expect(v.code).toBe("missing-visual-evidence-ac");
    });

    it("hole ①: a visual-evidence AC but NO declared deliverable_url is invalid (declared but never captured)", () => {
      const spec = `## US-Z-3 Casting tab polish 📋

**AC:**
- [ ] Screenshot of the polished Casting tab is captured
`;
      const v = validateStoryVisualEvidence(spec);
      expect(v.ok).toBe(false);
      expect(v.code).toBe("declared-surface-without-deliverable-url");
    });

    it("a naked boolean screenshot_exempt is NOT a valid exemption (must carry a reason)", () => {
      for (const naked of ["true", "yes", "1", "false", "no", "0", "on"]) {
        const spec = `---
screenshot_exempt: ${naked}
---
## FIX-502 Some change 📋

**AC:**
- [ ] Some non-visual outcome
`;
        const v = validateStoryVisualEvidence(spec);
        expect(visualExemptionReason(spec)).toBeUndefined();
        // naked boolean ⇒ not exempt ⇒ still owes a visual-evidence AC
        expect(v.ok).toBe(false);
        expect(v.code).toBe("missing-visual-evidence-ac");
      }
    });

    it("an empty spec is invalid (no AC, no exemption)", () => {
      const v = validateStoryVisualEvidence("");
      expect(v.ok).toBe(false);
      expect(v.code).toBe("missing-visual-evidence-ac");
    });
  });

  describe("helpers", () => {
    it("declaresDeliverableUrl reads both keys and rejects empty values", () => {
      expect(declaresDeliverableUrl("---\ndeliverable_url: x\n---\n")).toBe(true);
      expect(declaresDeliverableUrl("---\nscreenshot_url: 'y'\n---\n")).toBe(true);
      expect(declaresDeliverableUrl("---\ndeliverable_url:\n---\n")).toBe(false);
      expect(declaresDeliverableUrl("no frontmatter")).toBe(false);
    });

    it("hasVisualEvidenceAc finds screenshot/截图 tokens inside AC items only", () => {
      expect(hasVisualEvidenceAc("**AC:**\n- [ ] capture a screenshot\n")).toBe(true);
      expect(hasVisualEvidenceAc("**AC:**\n- [ ] 截图 attached\n")).toBe(true);
      expect(hasVisualEvidenceAc("**AC:**\n- [ ] just a normal check\n")).toBe(false);
      // a screenshot word in prose (not an AC item) does not count
      expect(hasVisualEvidenceAc("We will take a screenshot later.\n")).toBe(false);
    });
  });
});
