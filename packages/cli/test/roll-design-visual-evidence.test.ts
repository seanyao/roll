/**
 * FIX-311 / FIX-311b — the roll-design design-phase visual-evidence contract.
 *
 * Gives the skill text teeth: a pure validator the skill cites and tests pin.
 * A spec must be BORN honest — every non-exempt story owes a visual-evidence AC
 * AND (when it has a WEB surface) a declared `deliverable_url` pointing at the
 * real product page. Exemption is the only opt-out and must carry a reason.
 *
 * FIX-311b hardens the validator so it is safe to WIRE INTO the build preflight:
 *   (a) SURFACE-AWARE — a terminal/CLI/TUI deliverable rides the terminal-capture
 *       lane and is NOT forced to declare a web `deliverable_url`. Only a WEB
 *       surface owes a url. An ambiguous surface is never forced either.
 *   (b) DUAL-USE TOKEN FIX — `captured` / `deliverable_url` / `screenshot_url`
 *       count as a visual-evidence AC ONLY inside an explicit visual-evidence
 *       context; "telemetry captured" / "write deliverable_url into the manifest"
 *       do NOT.
 */
import { describe, expect, it } from "vitest";
import {
  declaresDeliverableUrl,
  hasVisualEvidenceAc,
  validateStoryVisualEvidence,
  visualExemptionReason,
  visualSurface,
} from "../src/lib/design-visual-evidence.js";

describe("FIX-311 design-phase visual-evidence contract", () => {
  describe("pass paths", () => {
    it("a web/visual card with a web visual-evidence AC + a declared deliverable_url is valid", () => {
      const spec = `---
deliverable_url: .roll/features/index.html#casting
---
## US-CAST-001 Casting board redesign 📋

**AC:**
- [ ] The Casting board renders the new lane layout
- [ ] Screenshot of the rendered Casting web page at the declared deliverable_url is captured
`;
      const v = validateStoryVisualEvidence(spec);
      expect(v.ok).toBe(true);
      expect(v.code).toBeUndefined();
      expect(v.hasVisualEvidenceAc).toBe(true);
      expect(v.declaresDeliverableUrl).toBe(true);
      expect(v.surface).toBe("web");
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

    it("FIX-311b (surface a): a CLI/terminal visual-evidence AC with NO deliverable_url is valid (terminal-capture lane, no web url owed)", () => {
      const spec = `## FIX-501 New roll status output 📋

**AC:**
- [ ] Terminal screenshot of \`roll status\` shows the new summary line
`;
      const v = validateStoryVisualEvidence(spec);
      expect(v.ok).toBe(true);
      expect(v.code).toBeUndefined();
      expect(v.surface).toBe("terminal");
      expect(v.declaresDeliverableUrl).toBe(false);
    });

    it("FIX-311b (surface a): a TUI screen recording (cast) AC with NO deliverable_url is valid", () => {
      const spec = `## FIX-510 TUI dashboard polish 📋

**AC:**
- [ ] 录屏 of the TUI dashboard shows the new layout
`;
      const v = validateStoryVisualEvidence(spec);
      expect(v.ok).toBe(true);
      expect(v.surface).toBe("terminal");
    });

    it("FIX-311b (surface): an ambiguous visual-evidence AC (no web/terminal cue) is NOT forced to declare a url", () => {
      const spec = `## FIX-511 Some visible change 📋

**AC:**
- [ ] A screenshot proves the new behavior
`;
      const v = validateStoryVisualEvidence(spec);
      // Conservative: no clear web cue ⇒ surface ambiguous ⇒ not blocked for a missing url.
      expect(v.ok).toBe(true);
      expect(v.surface).toBe("ambiguous");
      expect(v.declaresDeliverableUrl).toBe(false);
    });

    it("FIX-311b (dual-use b): 'telemetry data is captured from the API' is NOT a visual-evidence AC (so the card needs a real one or exemption)", () => {
      const spec = `---
screenshot_exempt: backend-only telemetry pipeline, no user-visible surface
---
## FIX-520 Telemetry pipeline 📋

**AC:**
- [ ] Telemetry data is captured from the API and persisted
`;
      // The dual-use word "captured" does NOT make this a visual AC; the card is
      // honest only because it carries a recorded exemption.
      expect(hasVisualEvidenceAc(spec)).toBe(false);
      expect(validateStoryVisualEvidence(spec).ok).toBe(true);
    });

    it("FIX-311b (dual-use b): 'writes deliverable_url into the manifest' is NOT a visual-evidence AC", () => {
      const spec = `## FIX-521 Manifest writer 📋

**AC:**
- [ ] The publisher writes deliverable_url into the manifest.json
`;
      expect(hasVisualEvidenceAc(spec)).toBe(false);
      // No visual AC + no exemption ⇒ flagged as missing (not a phantom web-url failure).
      const v = validateStoryVisualEvidence(spec);
      expect(v.ok).toBe(false);
      expect(v.code).toBe("missing-visual-evidence-ac");
    });

    it("FIX-311b (dual-use b): a dual-use token PROMOTED by an explicit visual-evidence context counts", () => {
      const spec = `---
deliverable_url: https://app.test/x
---
## FIX-522 Page polish 📋

**AC:**
- [ ] [visual-evidence] the web page at deliverable_url is captured
`;
      expect(hasVisualEvidenceAc(spec)).toBe(true);
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

    it("hole ①: a WEB visual-evidence AC but NO declared deliverable_url is invalid (web declared but never captured)", () => {
      const spec = `## US-Z-3 Casting tab polish 📋

**AC:**
- [ ] Screenshot of the polished Casting web page (browser tab) is captured
`;
      const v = validateStoryVisualEvidence(spec);
      expect(v.ok).toBe(false);
      expect(v.code).toBe("web-surface-without-deliverable-url");
      expect(v.surface).toBe("web");
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
      expect(v.surface).toBe("none");
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

    it("visualSurface classifies web / terminal / ambiguous / none", () => {
      expect(visualSurface("**AC:**\n- [ ] screenshot of the web page\n")).toBe("web");
      expect(visualSurface("**AC:**\n- [ ] terminal screenshot of `roll x`\n")).toBe("terminal");
      expect(visualSurface("**AC:**\n- [ ] a screenshot proves it\n")).toBe("ambiguous");
      expect(visualSurface("**AC:**\n- [ ] a non-visual check\n")).toBe("none");
    });
  });
});
