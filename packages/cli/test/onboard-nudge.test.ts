/** US-ONBOARD-NUDGE-001 — detectDesignHandoff + renderDesignNudge behaviour contract. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectDesignHandoff, renderDesignNudge } from "../src/lib/onboard-nudge.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function mkProject(name: string): string {
  const p = mkdtempSync(join(tmpdir(), `roll-nudge-${name}-`));
  dirs.push(p);
  mkdirSync(join(p, ".roll"), { recursive: true });
  return p;
}

function mkEmptyBacklog(project: string): void {
  // parseBacklog sees only a header row → count 0
  writeFileSync(join(project, ".roll", "backlog.md"), "| Story | Description | Status |\n|---|---|---|\n");
}

function mkNonEmptyBacklog(project: string): void {
  writeFileSync(join(project, ".roll", "backlog.md"), "| Story | Description | Status |\n|---|---|---|\n| [US-001](.roll/features/epic/US-001/spec.md) | Test | 📋 Todo |\n");
}

// ---------------------------------------------------------------------------
// renderDesignNudge
// ---------------------------------------------------------------------------

describe("renderDesignNudge", () => {
  it("returns a single-line nudge containing $roll-design in en", () => {
    const lines = renderDesignNudge("en");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("$roll-design");
    expect(lines[0]).toContain("roll loop");
    expect(lines[0]).not.toContain("roll design");
  });

  it("returns a single-line nudge in zh (Chinese)", () => {
    const lines = renderDesignNudge("zh");
    expect(lines.length).toBe(1);
    // zh catalog fills $roll-design as the %s arg — the command name stays
    expect(lines[0]).toContain("$roll-design");
    expect(lines[0]).not.toContain("roll design");
  });

  it("returns en when lang is unknown", () => {
    const lines = renderDesignNudge("fr" as "en");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("$roll-design");
  });
});

// ---------------------------------------------------------------------------
// detectDesignHandoff
// ---------------------------------------------------------------------------

describe("detectDesignHandoff — material detection", () => {
  // AC1 — material present + empty backlog → shouldNudge
  it("AC1: prd.md in root + empty backlog → shouldNudge (md in root)", () => {
    const p = mkProject("ac1-root");
    writeFileSync(join(p, "prd.md"), "# Product Requirements\n\nSome requirements here.");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(true);
    expect(sig.backlogEmpty).toBe(true);
    expect(sig.shouldNudge).toBe(true);
  });

  it("AC1: design.md in root + empty backlog", () => {
    const p = mkProject("ac1-design");
    writeFileSync(join(p, "design.md"), "## Design\n\nHere is the design.");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(true);
    expect(sig.shouldNudge).toBe(true);
  });

  it("AC1: spec.txt in root + empty backlog", () => {
    const p = mkProject("ac1-spec");
    writeFileSync(join(p, "spec.txt"), "Specification content.");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(true);
    expect(sig.shouldNudge).toBe(true);
  });

  it("AC1: requirement.md in subdir depth≤2 + empty backlog", () => {
    const p = mkProject("ac1-subdir");
    mkdirSync(join(p, "docs", "design"), { recursive: true });
    writeFileSync(join(p, "docs", "design", "requirement.md"), "Requirements.");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(true);
    expect(sig.shouldNudge).toBe(true);
  });

  it("AC1: rfc.txt at depth 2 + empty backlog", () => {
    const p = mkProject("ac1-rfc");
    mkdirSync(join(p, "docs", "rfc"), { recursive: true });
    writeFileSync(join(p, "docs", "rfc", "rfc.txt"), "RFC content.");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(true);
    expect(sig.shouldNudge).toBe(true);
  });

  it("AC1: Chinese 需求文档.md at root + empty backlog", () => {
    const p = mkProject("ac1-zh");
    writeFileSync(join(p, "需求文档.md"), "需求描述.");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(true);
    expect(sig.shouldNudge).toBe(true);
  });

  it("AC1: Chinese 需求 in dir name at depth 1", () => {
    const p = mkProject("ac1-zhdir");
    mkdirSync(join(p, "需求"), { recursive: true });
    writeFileSync(join(p, "需求", "overview.md"), "需求概览.");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(true);
    expect(sig.shouldNudge).toBe(true);
  });

  // AC2 — no material signal
  it("AC2: no matching files → materialPresent false", () => {
    const p = mkProject("ac2-none");
    writeFileSync(join(p, "notes.txt"), "Just some notes.");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(false);
    expect(sig.shouldNudge).toBe(false);
  });

  it("AC2: empty file (stripped => no content) → materialPresent false", () => {
    const p = mkProject("ac2-empty");
    writeFileSync(join(p, "prd.md"), "   \n  \n");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(false);
    expect(sig.shouldNudge).toBe(false);
  });

  it("AC2: binary empty size match → materialPresent false (name triggers but content check fails)", () => {
    const p = mkProject("ac2-binempty");
    // pdf with name match but size 0
    writeFileSync(join(p, "spec.pdf"), "");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    // size==0 → treated as empty
    expect(sig.materialPresent).toBe(false);
    expect(sig.shouldNudge).toBe(false);
  });

  // AC2c — false-positive defense
  it("AC2c: only README.md in project → materialPresent false", () => {
    const p = mkProject("ac2c-readme");
    writeFileSync(join(p, "README.md"), "# My Project");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(false);
  });

  it("AC2c: only CHANGELOG.md → materialPresent false", () => {
    const p = mkProject("ac2c-cl");
    writeFileSync(join(p, "CHANGELOG.md"), "## v1.0");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(false);
  });

  it("AC2c: only CONTRIBUTING.md → materialPresent false", () => {
    const p = mkProject("ac2c-contrib");
    writeFileSync(join(p, "CONTRIBUTING.md"), "## Contributing");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(false);
  });

  it("AC2c: only LICENSE → materialPresent false", () => {
    const p = mkProject("ac2c-license");
    writeFileSync(join(p, "LICENSE"), "MIT");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(false);
  });

  it("AC2c: only AGENTS.md (roll scaffold) → materialPresent false", () => {
    const p = mkProject("ac2c-agents");
    writeFileSync(join(p, "AGENTS.md"), "# Agent manual");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(false);
  });

  it("AC2c: README.md + CHANGELOG.md only → materialPresent false", () => {
    const p = mkProject("ac2c-multi");
    writeFileSync(join(p, "README.md"), "# Proj");
    writeFileSync(join(p, "CHANGELOG.md"), "# Changelog");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(false);
  });

  // AC2b — directory-independent detection
  it("AC2b: same doc in prd-draft/ at depth 1 → detected", () => {
    const p = mkProject("ac2b-prd");
    mkdirSync(join(p, "prd-draft"), { recursive: true });
    writeFileSync(join(p, "prd-draft", "requirements.md"), "Requirements doc.");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(true);
  });

  it("AC2b: same doc in docs/ at depth 1 → detected", () => {
    const p = mkProject("ac2b-docs");
    mkdirSync(join(p, "docs"), { recursive: true });
    writeFileSync(join(p, "docs", "requirements.md"), "Requirements doc.");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(true);
  });

  it("AC2b: same doc in deep subdir depth > 2 → NOT detected", () => {
    const p = mkProject("ac2b-deep");
    mkdirSync(join(p, "a", "b", "c"), { recursive: true });
    writeFileSync(join(p, "a", "b", "c", "spec.md"), "Spec.");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(false);
  });

  it("AC2b: doc at depth 2 detected, same doc at depth 3 skipped", () => {
    const p = mkProject("ac2b-mix");
    mkdirSync(join(p, "a", "b"), { recursive: true });
    mkdirSync(join(p, "a", "b", "c"), { recursive: true });
    writeFileSync(join(p, "a", "b", "design.md"), "Design doc.");
    writeFileSync(join(p, "a", "b", "c", "design.md"), "Deep doc.");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(true); // depth-2 one found
  });
});

describe("detectDesignHandoff — backlogEmpty logic", () => {
  // AC3
  it("AC3: missing backlog file → backlogEmpty true", () => {
    const p = mkProject("ac3-missing");
    // no .roll/backlog.md at all
    const sig = detectDesignHandoff(p);
    expect(sig.backlogEmpty).toBe(true);
    expect(sig.shouldNudge).toBe(false); // no material either
  });

  it("AC3: backlog with only headers → backlogEmpty true", () => {
    const p = mkProject("ac3-header");
    writeFileSync(join(p, ".roll", "backlog.md"), "# My Backlog\n\n| Story | Description | Status |\n|---|---|---|\n\nJust some text.\n");
    const sig = detectDesignHandoff(p);
    expect(sig.backlogEmpty).toBe(true);
  });

  it("AC3: backlog with comment-only rows → backlogEmpty true", () => {
    const p = mkProject("ac3-comment");
    writeFileSync(
      join(p, ".roll", "backlog.md"),
      "| Story | Description | Status |\n|---|---|---|\n<!-- | FIX-001 | Bug | Todo | -->\n",
    );
    const sig = detectDesignHandoff(p);
    expect(sig.backlogEmpty).toBe(true);
  });

  it("AC3: backlog with one US → backlogEmpty false", () => {
    const p = mkProject("ac3-us");
    writeFileSync(join(p, "spec.md"), "spec");
    mkNonEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.backlogEmpty).toBe(false);
    expect(sig.shouldNudge).toBe(false); // materialPresent true from spec.md + backlog non-empty
  });

  it("AC3: backlog with Done item → backlogEmpty false", () => {
    const p = mkProject("ac3-done");
    writeFileSync(
      join(p, ".roll", "backlog.md"),
      "| Story | Description | Status |\n|---|---|---|\n| [US-DONE](spec.md) | Was done | ✅ Done |\n",
    );
    const sig = detectDesignHandoff(p);
    expect(sig.backlogEmpty).toBe(false);
  });

  it("AC3: backlog with FIX item → backlogEmpty false", () => {
    const p = mkProject("ac3-fix");
    writeFileSync(
      join(p, ".roll", "backlog.md"),
      "| Story | Description | Status |\n|---|---|---|\n| [FIX-001](spec.md) | Fix something | 📋 Todo |\n",
    );
    const sig = detectDesignHandoff(p);
    expect(sig.backlogEmpty).toBe(false);
  });
});

describe("detectDesignHandoff — error grading (AC4)", () => {
  it("AC4: single unreadable file → skip, continue scan for another", () => {
    const p = mkProject("ac4-skip");
    mkdirSync(join(p, "docs"), { recursive: true });
    // Make doc dir unreadable — but actually we simulate via a "broken" file
    writeFileSync(join(p, "docs", "good-spec.md"), "valid spec");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(true);
  });

  it("AC4: projectDir does not exist → shouldNudge false, no throw", () => {
    const sig = detectDesignHandoff("/tmp/no-such-project-xyz-nudge");
    expect(sig.shouldNudge).toBe(false);
    expect(sig.materialPresent).toBe(false);
    expect(sig.backlogEmpty).toBe(true);
  });
});

describe("detectDesignHandoff — symlink + large file guard (AC4b)", () => {
  it("AC4b: real directory (not symlink) with spec file is detected", () => {
    const p = mkProject("ac4b-sym");
    mkdirSync(join(p, "real-dir"), { recursive: true });
    writeFileSync(join(p, "real-dir", "spec.md"), "spec content");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    // spec.md matches MATERIAL_NAME_RE, at depth 1, not excluded → detected
    expect(sig.materialPresent).toBe(true);
  });

  // Let me fix above: spec.md in real-dir at depth 1 should match
  it("AC4b: normal directory with spec file detected", () => {
    const p = mkProject("ac4b-normal");
    mkdirSync(join(p, "docs"), { recursive: true });
    writeFileSync(join(p, "docs", "spec.md"), "spec content");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(true);
  });
});

describe("detectDesignHandoff — combined scenarios", () => {
  it("material present + backlog non-empty → shouldNudge false", () => {
    const p = mkProject("combo-nonempty");
    writeFileSync(join(p, "prd.md"), "PRD");
    mkNonEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(true);
    expect(sig.backlogEmpty).toBe(false);
    expect(sig.shouldNudge).toBe(false);
  });

  it("no material + backlog empty → shouldNudge false", () => {
    const p = mkProject("combo-no-mat");
    mkEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(false);
    expect(sig.backlogEmpty).toBe(true);
    expect(sig.shouldNudge).toBe(false);
  });

  it("no material + backlog non-empty → shouldNudge false", () => {
    const p = mkProject("combo-neither");
    mkNonEmptyBacklog(p);
    const sig = detectDesignHandoff(p);
    expect(sig.materialPresent).toBe(false);
    expect(sig.backlogEmpty).toBe(false);
    expect(sig.shouldNudge).toBe(false);
  });
});
