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
  declaresDeliverableCmd,
  declaresDeliverableUrl,
  hasVisualEvidenceAc,
  parseDeliverableCmdsFromSpec,
  validateStoryVisualEvidence,
  visualExemptionReason,
  visualSurface,
} from "../src/lib/design-visual-evidence.js";

describe("FIX-311 design-phase visual-evidence contract", () => {
  describe("pass paths", () => {
    it("a web/visual card with a web visual-evidence AC + a declared deliverable_url is valid", () => {
      const spec = `---
deliverable_url: https://app.example.test/casting#board
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
deliverable_url: https://app.example.test/dashboard
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

  describe("FIX-341 — false-negative fixes", () => {
    describe("AC1: the [visual-evidence] marker is authoritative on its own", () => {
      it("recognises a [visual-evidence] AC whose text carries NO hard-coded noun (US-DOSSIER-043 AC7 实案)", () => {
        // The verb 截 (capture) does not match the noun 截图 — before FIX-341 this
        // AC was wrongly flagged missing-visual-evidence-ac. The marker IS the verdict.
        const spec = `---
deliverable_url: https://app.example.test/now
---
## US-DOSSIER-043 Dossier Now landing 📋

**AC:**
- [ ] AC7 [visual-evidence] headless 截 Now 及各 tab 真实渲染页:证明落 Now、四区齐全、tab 顺序对
`;
        expect(hasVisualEvidenceAc(spec)).toBe(true);
        const v = validateStoryVisualEvidence(spec);
        expect(v.ok).toBe(true);
        expect(v.code).toBeUndefined();
        expect(v.hasVisualEvidenceAc).toBe(true);
      });

      it("the marker counts even with NO surrounding screenshot keyword at all", () => {
        const spec = `## FIX-700 Some visible change 📋

**AC:**
- [ ] [visual-evidence] the new banner shows the updated copy
`;
        expect(hasVisualEvidenceAc(spec)).toBe(true);
      });

      it("does NOT relax for a non-visual AC lacking the marker (no false positive)", () => {
        // RED LINE: a plain non-visual AC stays non-visual.
        expect(hasVisualEvidenceAc("**AC:**\n- [ ] telemetry is captured from the API\n")).toBe(false);
        expect(hasVisualEvidenceAc("**AC:**\n- [ ] sorting persists across reloads\n")).toBe(false);
      });
    });

    describe("AC2: surface prefers the declared deliverable surface over AC-text heuristics", () => {
      it("a card with a [visual-evidence] AC + declared web deliverable_url is surface=web (US-EVID-018 / DOSSIER-042 实案)", () => {
        // The AC prose mentions `roll`/CLI cues (would heuristically read terminal),
        // but the frontmatter declares a real web page — the declaration wins.
        const spec = `---
deliverable_url: .roll/features/agents.html
---
## US-EVID-018 Tooling dossier surface 📋

**AC:**
- [ ] [visual-evidence] 档案页(经 \`roll\` 渲染)显性化工具可用性
`;
        const v = validateStoryVisualEvidence(spec);
        expect(v.surface).toBe("web");
        expect(v.ok).toBe(true);
        expect(v.declaresDeliverableUrl).toBe(true);
        expect(visualSurface(spec)).toBe("web");
      });

      it("an explicit deliverable_url overrides a terminal-cued AC text", () => {
        const spec = `---
deliverable_url: https://app.example.test/loop
---
## US-DOSSIER-042 Loop tab 📋

**AC:**
- [ ] terminal screenshot of \`roll status\` AND [visual-evidence] the loop tab page
`;
        expect(visualSurface(spec)).toBe("web");
      });

      it("a declared deliverable_cmd (no url) keeps a visual-evidence AC terminal", () => {
        const spec = `---
deliverable_cmd: roll status --fmt summary
---
## FIX-701 CLI demo 📋

**AC:**
- [ ] [visual-evidence] the new status summary renders
`;
        const v = validateStoryVisualEvidence(spec);
        expect(v.surface).toBe("terminal");
        expect(v.ok).toBe(true);
        expect(v.declaresDeliverableUrl).toBe(false);
      });

      it("a deliverable_cmd YAML block-list (no url) is detected and keeps surface=terminal", () => {
        const spec = `---
deliverable_cmd:
  - roll status
  - roll cycles
---
## FIX-702 CLI demo list 📋

**AC:**
- [ ] [visual-evidence] the commands render the new output
`;
        expect(declaresDeliverableCmd(spec)).toBe(true);
        expect(visualSurface(spec)).toBe("terminal");
      });

      it("with NO declaration, surface still falls back to the AC-text heuristic (no regression)", () => {
        expect(visualSurface("**AC:**\n- [ ] screenshot of the web page\n")).toBe("web");
        expect(visualSurface("**AC:**\n- [ ] terminal screenshot of \`roll x\`\n")).toBe("terminal");
        expect(visualSurface("**AC:**\n- [ ] a screenshot proves it\n")).toBe("ambiguous");
      });

      it("a declared deliverable surface does NOT manufacture a visual AC out of nothing (surface=none when no visual AC)", () => {
        // The declaration only classifies an EXISTING visual AC; it never invents one.
        const spec = `---
deliverable_url: https://app.example.test/redesign
---
## US-Y-9 Redesign 📋

**AC:**
- [ ] the dashboard groups cards by epic
`;
        expect(visualSurface(spec)).toBe("none");
        expect(validateStoryVisualEvidence(spec).code).toBe("missing-visual-evidence-ac");
      });
    });

    describe("declaresDeliverableCmd helper", () => {
      it("reads the scalar form and the block-list form, rejects empty/absent", () => {
        expect(declaresDeliverableCmd("---\ndeliverable_cmd: roll status\n---\n")).toBe(true);
        expect(declaresDeliverableCmd("---\ndeliverable_cmd:\n  - roll status\n---\n")).toBe(true);
        expect(declaresDeliverableCmd("---\ndeliverable_cmd:\n---\n")).toBe(false);
        expect(declaresDeliverableCmd("---\ndeliverable_cmd:\nother: x\n---\n")).toBe(false);
        expect(declaresDeliverableCmd("no frontmatter")).toBe(false);
      });
    });

    describe("parseDeliverableCmdsFromSpec helper", () => {
      it("returns the scalar command as a single-element array", () => {
        expect(parseDeliverableCmdsFromSpec("---\ndeliverable_cmd: roll status\n---\n")).toEqual(["roll status"]);
      });
      it("returns block-list items", () => {
        expect(parseDeliverableCmdsFromSpec("---\ndeliverable_cmd:\n  - roll status\n  - roll cycles\n---\n")).toEqual(["roll status", "roll cycles"]);
      });
      it("returns empty array when absent / empty", () => {
        expect(parseDeliverableCmdsFromSpec("no frontmatter")).toEqual([]);
        expect(parseDeliverableCmdsFromSpec("---\ndeliverable_cmd:\n---\n")).toEqual([]);
      });
    });
  });

  describe("FIX-383 — validate uses attest's allowedDeliverableCmd whitelist", () => {
    describe("AC1/AC2 — rejected commands fail validate", () => {
      it("rejects a state-changing roll subcommand (loop watch) that attest would also reject", () => {
        const spec = `---
deliverable_cmd: roll loop watch
---
## FIX-800 Demo 📋

**AC:**
- [ ] CLI screenshot of \`roll loop watch\` output
`;
        const v = validateStoryVisualEvidence(spec);
        expect(v.ok).toBe(false);
        expect(v.code).toBe("deliverable-cmd-rejected");
        expect(v.rejectedDeliverableCmds).toEqual(["roll loop watch"]);
      });

      it("rejects roll release as state-changing", () => {
        const spec = `---
deliverable_cmd: roll release
---
## FIX-801 Demo 📋

**AC:**
- [ ] CLI screenshot of \`roll release\` output
`;
        const v = validateStoryVisualEvidence(spec);
        expect(v.ok).toBe(false);
        expect(v.code).toBe("deliverable-cmd-rejected");
        expect(v.rejectedDeliverableCmds).toEqual(["roll release"]);
      });

      it("rejects shell metacharacters in the command", () => {
        const spec = `---
deliverable_cmd: roll status; rm x
---
## FIX-802 Demo 📋

**AC:**
- [ ] CLI screenshot
`;
        const v = validateStoryVisualEvidence(spec);
        expect(v.ok).toBe(false);
        expect(v.code).toBe("deliverable-cmd-rejected");
      });

      it("passes a legal read-only roll command like roll ls", () => {
        const spec = `---
deliverable_cmd: roll ls
---
## FIX-803 Demo 📋

**AC:**
- [ ] CLI screenshot of \`roll ls\` output
`;
        const v = validateStoryVisualEvidence(spec);
        expect(v.ok).toBe(true);
        expect(v.code).toBeUndefined();
      });

      it("rejects if ANY command in a block-list is invalid", () => {
        const spec = `---
deliverable_cmd:
  - roll status
  - roll loop watch
  - roll cycles
---
## FIX-804 Demo 📋

**AC:**
- [ ] CLI screenshot of the output
`;
        const v = validateStoryVisualEvidence(spec);
        expect(v.ok).toBe(false);
        expect(v.code).toBe("deliverable-cmd-rejected");
        expect(v.rejectedDeliverableCmds).toEqual(["roll loop watch"]);
      });
    });

    describe("AC3/AC5 — streaming command hint", () => {
      it("detects a streaming watch command in the rejected list and adds a hint", () => {
        const spec = `---
deliverable_cmd: roll loop watch
---
## FIX-805 Demo 📋

**AC:**
- [ ] CLI screenshot
`;
        const v = validateStoryVisualEvidence(spec);
        expect(v.ok).toBe(false);
        expect(v.streamingDeliverableCmds).toEqual(["roll loop watch"]);
        expect(v.reason).toMatch(/流式|streaming|watch/);
      });

      it("does not falsely flag non-streaming rejected commands as streaming", () => {
        const spec = `---
deliverable_cmd: roll release
---
## FIX-806 Demo 📋

**AC:**
- [ ] CLI screenshot
`;
        const v = validateStoryVisualEvidence(spec);
        expect(v.ok).toBe(false);
        expect(v.streamingDeliverableCmds?.length ?? 0).toBe(0);
      });
    });

    describe("AC4 — regression: existing legal deliverable_cmd cards still pass", () => {
      it("a card with a legal deliverable_cmd + visual-evidence AC still validates green", () => {
        const spec = `---
deliverable_cmd: roll status --fmt a,b
---
## FIX-701 CLI demo 📋

**AC:**
- [ ] [visual-evidence] the new status summary renders
`;
        const v = validateStoryVisualEvidence(spec);
        expect(v.ok).toBe(true);
        expect(v.surface).toBe("terminal");
      });

      it("a card with a legal deliverable_cmd block-list still validates green", () => {
        const spec = `---
deliverable_cmd:
  - roll status
  - roll cycles
---
## FIX-702 CLI demo list 📋

**AC:**
- [ ] [visual-evidence] the commands render the new output
`;
        const v = validateStoryVisualEvidence(spec);
        expect(v.ok).toBe(true);
      });

      it("passes an isolated roll init attest-smoke fixture but not ordinary init", () => {
        const isolated = `---
deliverable_cmd: roll init --attest-smoke existing-codebase-diagnose
physical_terminal:
  app: Terminal.app
  command: roll init --attest-smoke existing-codebase-diagnose
  evidence: screenshot
---
## US-INIT-SMOKE Demo

**AC:**
- [ ] [visual-evidence] Terminal.app screenshot of the isolated init smoke
`;
        const mutating = `---
deliverable_cmd: roll init --auto
---
## US-INIT-BAD Demo

**AC:**
- [ ] [visual-evidence] Terminal.app screenshot of init
`;

        expect(validateStoryVisualEvidence(isolated).ok).toBe(true);
        expect(validateStoryVisualEvidence(mutating)).toMatchObject({
          ok: false,
          code: "deliverable-cmd-rejected",
          rejectedDeliverableCmds: ["roll init --auto"],
        });
      });
    });
  });
});

describe("US-EVID-025 goal 3 — exempt ≠ evidence-free: an exemption must declare a substitute capturable evidence", () => {
  const exempt = (reason: string, extra = ""): string =>
    `---\nid: US-X\ntitle: t\nscreenshot_exempt: ${reason}\n${extra}---\n\n## AC\n- [ ] AC1 backend logic\n`;

  // Design-time enforcement via a NON-FATAL field: exempt stays ok:true so the
  // RUNTIME preflight keeps honest-skipping (existing 306 exempt cards are NOT
  // retroactively flagged at runtime — that is US-EVID-027's forward-only sweep).
  // The authoring gate (roll story validate) is what rejects a missing substitute.
  it("a bare exemption with NO substitute is flagged (field), but stays ok:true for the non-blocking runtime", () => {
    const v = validateStoryVisualEvidence(exempt("no visual surface"));
    expect(v.exemptSubstituteMissing).toBe(true);
    expect(v.ok).toBe(true); // runtime honest-skip unchanged — never retroactively blocks
  });

  it("a deliverable_cmd substitute clears the flag", () => {
    const v = validateStoryVisualEvidence(exempt("CLI/backend, no web surface", "deliverable_cmd: roll cycles\n"));
    expect(v.exemptSubstituteMissing).toBeFalsy();
  });

  it("a reason that names tests as the substitute clears the flag", () => {
    expect(validateStoryVisualEvidence(exempt("纯后端逻辑；替代证据=确定性单测")).exemptSubstituteMissing).toBeFalsy();
    expect(validateStoryVisualEvidence(exempt("pure backend; substitute evidence = named unit tests")).exemptSubstituteMissing).toBeFalsy();
  });
});
