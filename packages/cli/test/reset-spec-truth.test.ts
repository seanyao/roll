/**
 * FIX-1043 — regression tests for {@link resetSpecTruthText} and
 * {@link cleanStaleEvidence}.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetSpecTruthText, cleanStaleEvidence } from "../src/runner/executor.js";

describe("resetSpecTruthText", () => {
  it("strips the H1 done tick, resets status, and unchecks AC boxes", () => {
    const before = [
      "# FIX-1043 ✅",
      "",
      "**Status**: ✅ Done (PR#1101)",
      "",
      "**AC:**",
      "- [x] AC1",
      "- [X] AC2",
      "- [ ] AC3",
    ].join("\n");
    const { text, changed } = resetSpecTruthText(before);
    expect(changed).toBe(true);
    expect(text).toContain("# FIX-1043");
    expect(text).not.toContain("# FIX-1043 ✅");
    expect(text).toContain("**Status**: 📋 Todo");
    expect(text).toContain("- [ ] AC1");
    expect(text).toContain("- [ ] AC2");
    expect(text).toContain("- [ ] AC3");
  });

  it("always strips delivery-stamp sections (Fixed) regardless of baseline", () => {
    const before = [
      "# FIX-1042 ✅",
      "",
      "**Fixed**: 2026-06-30",
      "the fix landed",
      "",
      "**Files:**",
      "- `src/bug.ts`",
    ].join("\n");
    // No baseline → narrative sections are preserved, but the Fixed delivery
    // stamp is a planner-never-authors marker, so it is always removed.
    const { text, changed } = resetSpecTruthText(before);
    expect(changed).toBe(true);
    expect(text).not.toContain("**Fixed**: 2026-06-30");
    expect(text).not.toContain("the fix landed");
    expect(text).not.toContain("# FIX-1042 ✅");
    expect(text).toContain("**Files:**");
    expect(text).toContain("- `src/bug.ts`");
  });

  it("FIX-1043: strips ONLY narrative sections the failed cycle added (absent from baseline)", () => {
    // Planner baseline already authored Problem + Root Cause. The failed cycle
    // ADDED a Solution section and a Fixed stamp.
    const baseline = [
      "# FIX-1042",
      "",
      "**Problem**: Planner-described problem.",
      "with planner detail.",
      "",
      "**Root Cause**: Planner root cause.",
      "",
      "**Files:**",
      "- `src/bug.ts`",
    ].join("\n");
    const before = [
      "# FIX-1042 ✅",
      "",
      "**Problem**: Planner-described problem.",
      "with planner detail.",
      "",
      "**Root Cause**: Planner root cause.",
      "",
      "**Solution**:",
      "1. agent-added step.",
      "",
      "**Fixed**: 2026-06-30",
      "",
      "**Files:**",
      "- `src/bug.ts`",
    ].join("\n");
    const { text, changed } = resetSpecTruthText(before, baseline);
    expect(changed).toBe(true);
    // Planner-authored narrative sections survive.
    expect(text).toContain("**Problem**: Planner-described problem.");
    expect(text).toContain("with planner detail.");
    expect(text).toContain("**Root Cause**: Planner root cause.");
    // Agent-added Solution + Fixed stamp are stripped.
    expect(text).not.toContain("**Solution**:");
    expect(text).not.toContain("1. agent-added step.");
    expect(text).not.toContain("**Fixed**: 2026-06-30");
    expect(text).toContain("**Files:**");
  });

  it("FIX-1043: preserves planner-authored Problem/Root Cause/Solution when no baseline is available", () => {
    // A genuine Todo fix spec authored entirely by the planner. Without a
    // baseline the reset must NOT destroy this legitimate content.
    const before = [
      "# FIX-2000",
      "",
      "**Status**: 📋 Todo",
      "",
      "**Problem**: The widget crashes on empty input.",
      "Reproduced on 2026-06-30.",
      "",
      "**Root Cause**: Missing null guard.",
      "",
      "**Solution**:",
      "1. Add the guard.",
      "2. Cover with a test.",
      "",
      "**Files:**",
      "- `src/widget.ts`",
    ].join("\n");
    const { text, changed } = resetSpecTruthText(before);
    expect(changed).toBe(false);
    expect(text).toBe(before);
  });

  it("removes Delivery notes / Delivery sections", () => {
    const before = [
      "# FIX-1042 ✅",
      "",
      "**Delivery notes (2026-06-30):**",
      "- PR: #1100",
      "- CI passed",
      "",
      "## Delivery notes",
      "- another note",
      "",
      "**Files:**",
      "- `src/bug.ts`",
    ].join("\n");
    const { text, changed } = resetSpecTruthText(before);
    expect(changed).toBe(true);
    expect(text).not.toContain("**Delivery notes");
    expect(text).not.toContain("- PR: #1100");
    expect(text).not.toContain("## Delivery notes");
    expect(text).not.toContain("- another note");
    expect(text).toContain("**Files:**");
  });

  it("is idempotent: an already-honest spec is unchanged", () => {
    const before = [
      "# FIX-1043",
      "",
      "**Status**: 📋 Todo",
      "",
      "**AC:**",
      "- [ ] AC1",
    ].join("\n");
    const { text, changed } = resetSpecTruthText(before);
    expect(changed).toBe(false);
    expect(text).toBe(before);
  });

  it("does not strip non-delivery bold labels", () => {
    const before = [
      "# FIX-1043",
      "",
      "**Files:**",
      "- `src/a.ts`",
      "",
      "**Dependencies:**",
      "- none",
      "",
      "**AC:**",
      "- [ ] AC1",
    ].join("\n");
    const { text, changed } = resetSpecTruthText(before);
    expect(changed).toBe(false);
    expect(text).toBe(before);
  });
});

describe("cleanStaleEvidence", () => {
  it("moves authoritative delivery evidence into failed-diagnostics and removes latest symlink", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "roll-clean-evidence-")));
    const epic = "loop-engine";
    const storyId = "FIX-1042";
    const cardDir = join(root, ".roll", "features", epic, storyId);
    const latestDir = join(cardDir, "latest");
    mkdirSync(latestDir, { recursive: true });

    writeFileSync(join(cardDir, "ac-map.json"), '[{"ac":"FIX-1042:AC1","status":"pass"}]', "utf8");
    writeFileSync(join(latestDir, "FIX-1042-report.html"), "<html>report</html>", "utf8");

    cleanStaleEvidence(root, storyId, "20260630-123931-1248");

    expect(existsSync(join(cardDir, "ac-map.json"))).toBe(false);
    expect(existsSync(latestDir)).toBe(false);
    expect(existsSync(join(cardDir, "failed-diagnostics", "ac-map.json"))).toBe(true);
    expect(existsSync(join(cardDir, "failed-diagnostics", "FIX-1042-report.html"))).toBe(true);
    expect(readFileSync(join(cardDir, "failed-diagnostics", "README.md"), "utf8")).toContain("Failed-cycle diagnostics");
  });

  it("handles a latest symlink pointing to a timestamped run dir", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "roll-clean-evidence-symlink-")));
    const storyId = "FIX-1042";
    const cardDir = join(root, ".roll", "features", "loop-engine", storyId);
    const runDir = join(cardDir, "20260630-123931-1248");
    const latestLink = join(cardDir, "latest");
    mkdirSync(runDir, { recursive: true });

    writeFileSync(join(runDir, "FIX-1042-report.html"), "<html>report</html>", "utf8");
    symlinkSync("20260630-123931-1248", latestLink);

    cleanStaleEvidence(root, storyId, "20260630-123931-1248");

    expect(existsSync(latestLink)).toBe(false);
    expect(existsSync(join(cardDir, "failed-diagnostics", "FIX-1042-report.html"))).toBe(true);
  });

  it("is a no-op when the card directory does not exist", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "roll-clean-evidence-missing-")));
    expect(() => cleanStaleEvidence(root, "FIX-MISSING", "c1")).not.toThrow();
  });

  it("FIX-1063: preserves standard evidence paths for a published_pending_merge terminal", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "roll-clean-evidence-pending-")));
    const storyId = "FIX-1063";
    const cardDir = join(root, ".roll", "features", "loop-engine", storyId);
    const latestDir = join(cardDir, "latest");
    mkdirSync(latestDir, { recursive: true });

    writeFileSync(join(cardDir, "ac-map.json"), '[{"ac":"FIX-1063:AC1","status":"pass"}]', "utf8");
    writeFileSync(join(latestDir, "FIX-1063-report.html"), "<html>passing report</html>", "utf8");

    cleanStaleEvidence(root, storyId, "20260701-085728-49332", "published_pending_merge");

    expect(existsSync(join(cardDir, "ac-map.json"))).toBe(true);
    expect(existsSync(join(latestDir, "FIX-1063-report.html"))).toBe(true);
    expect(existsSync(join(cardDir, "failed-diagnostics"))).toBe(false);
  });

  it("FIX-1063: still archives evidence as failed-diagnostics for a failed terminal", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "roll-clean-evidence-failed-")));
    const storyId = "FIX-1063";
    const cardDir = join(root, ".roll", "features", "loop-engine", storyId);
    const latestDir = join(cardDir, "latest");
    mkdirSync(latestDir, { recursive: true });

    writeFileSync(join(cardDir, "ac-map.json"), '[{"ac":"FIX-1063:AC1","status":"claimed"}]', "utf8");
    writeFileSync(join(latestDir, "FIX-1063-report.html"), "<html>failing report</html>", "utf8");

    cleanStaleEvidence(root, storyId, "20260701-085728-49332", "failed");

    expect(existsSync(join(cardDir, "ac-map.json"))).toBe(false);
    expect(existsSync(latestDir)).toBe(false);
    expect(existsSync(join(cardDir, "failed-diagnostics", "ac-map.json"))).toBe(true);
    expect(existsSync(join(cardDir, "failed-diagnostics", "FIX-1063-report.html"))).toBe(true);
    expect(readFileSync(join(cardDir, "failed-diagnostics", "README.md"), "utf8")).toContain("Failed-cycle diagnostics");
  });
});
