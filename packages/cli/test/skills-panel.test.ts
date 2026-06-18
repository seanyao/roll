/** US-DOSSIER-017 / US-DOSSIER-032 — skills catalog read from disk + the strict
 *  audit truth, with an explicit `unknown` state when the audit cannot run. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectSkillsPanel, skillGroupOf } from "../src/lib/skills-panel.js";
import type { SkillAuditEntry, SkillAuditReport } from "../src/lib/skills-audit.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(skills: Record<string, string>): string {
  const p = mkdtempSync(join(tmpdir(), "roll-skp-"));
  dirs.push(p);
  for (const [name, hub] of Object.entries(skills)) {
    mkdirSync(join(p, "skills", name, "references"), { recursive: true });
    writeFileSync(join(p, "skills", name, "SKILL.md"), hub);
    writeFileSync(join(p, "skills", name, "references", "full-contract.md"), "line1\nline2\n");
  }
  return p;
}

function entry(over: Partial<SkillAuditEntry> & { name: string }): SkillAuditEntry {
  return {
    name: over.name,
    file: `${over.name}/SKILL.md`,
    frontmatterOk: true,
    lines: 60,
    description: "Load when shipping",
    descriptionWordCount: 3,
    descriptionLoadTrigger: true,
    hasWhenNotToUse: false,
    hasGotchas: true,
    hasReviewedWaiver: false,
    auxiliaryDirs: [],
    spokeFiles: [],
    referencedSpokes: [],
    missingSpokeRefs: [],
    unreferencedSpokes: [],
    routeCoverage: { positiveCount: 2, negativeCount: 2, hasMinimumCoverage: true },
    violations: [],
    ...over,
  };
}

function audit(skills: SkillAuditEntry[]): SkillAuditReport {
  return {
    summary: {
      skills: skills.length,
      violations: skills.reduce((a, s) => a + s.violations.length, 0),
      over250: 0,
      withGotchas: skills.filter((s) => s.hasGotchas).length,
      loadTriggerDescriptions: skills.filter((s) => s.descriptionLoadTrigger).length,
      withAuxiliaryFiles: 0,
    },
    skills,
  };
}

const REPORT = audit([
  entry({ name: "roll-build", lines: 60 }),
  // a skill the audit lists but the box does not carry on disk
  entry({ name: "roll-ghost", lines: 10, violations: ["missing"], hasGotchas: false, descriptionLoadTrigger: false }),
]);

describe("collectSkillsPanel", () => {
  it("AC1: the directory is the catalog — audited-but-absent skills never appear", () => {
    const p = project({ "roll-build": "# Roll Build\nhub\n" });
    const vm = collectSkillsPanel(p, { audit: () => REPORT, usageCounts: () => ({ "roll-build": 7 }) });
    const names = vm.groups.flatMap((g) => g.rows.map((r) => r.name));
    expect(names).toEqual(["roll-build"]); // roll-ghost not on disk → absent
    expect(vm.summary.skills).toBe(1); // counts disk rows, not the audit list
    expect(vm.summary.auditRan).toBe(true);
    expect(vm.summary.violations).toBe(1); // audit violation total, verbatim
  });

  it("rows carry usage, audit essentials, real file tree with line counts, and the hub text", () => {
    const p = project({ "roll-build": "# Roll Build\nhub line\n" });
    const vm = collectSkillsPanel(p, { audit: () => REPORT, usageCounts: () => ({ "roll-build": 7 }) });
    const row = vm.groups.find((g) => g.key === "delivery")!.rows[0]!;
    expect(row.usage).toBe(7);
    expect(row.auditKnown).toBe(true);
    expect(row.hasGotchas).toBe(true);
    expect(row.routeCases).toEqual({ positive: 2, negative: 2 });
    expect(row.files.some((f) => f.path === "SKILL.md" && f.lines > 0)).toBe(true);
    expect(row.files.some((f) => f.path === "references/full-contract.md")).toBe(true);
    expect(row.hubText).toContain("# Roll Build");
    expect(row.dirPath).toContain("roll-build");
  });

  it("AC4: audit can't run → disk skills still render, but as `unknown`, never silent 0", () => {
    const p = project({ "roll-build": "# Roll Build\nhub\n", "roll-loop": "# Roll Loop\nhub\n" });
    const vm = collectSkillsPanel(p, { audit: () => null, usageCounts: () => ({}) });
    const rows = vm.groups.flatMap((g) => g.rows);
    expect(rows.map((r) => r.name).sort()).toEqual(["roll-build", "roll-loop"]); // disk catalog still shown
    expect(rows.every((r) => r.auditKnown === false)).toBe(true);
    expect(vm.summary.auditRan).toBe(false);
    expect(vm.summary.violations).toBe("unknown"); // NOT 0 — the audit never ran
  });

  it("an audited skill missing from the audit list (but on disk) is `unknown`", () => {
    const p = project({ "roll-build": "# Roll Build\nhub\n", "roll-loop": "# Roll Loop\nhub\n" });
    // audit only knows roll-build; roll-loop is on disk but skipped by the audit
    const vm = collectSkillsPanel(p, { audit: () => audit([entry({ name: "roll-build" })]), usageCounts: () => ({}) });
    const build = vm.groups.flatMap((g) => g.rows).find((r) => r.name === "roll-build")!;
    const loop = vm.groups.flatMap((g) => g.rows).find((r) => r.name === "roll-loop")!;
    expect(build.auditKnown).toBe(true);
    expect(loop.auditKnown).toBe(false); // on disk, audit-skipped → unknown, not clean
  });

  it("no skills directory at all → empty, audit not run", () => {
    const p = mkdtempSync(join(tmpdir(), "roll-skp-"));
    dirs.push(p);
    const vm = collectSkillsPanel(p);
    expect(vm.summary.skills).toBe(0);
    expect(vm.summary.auditRan).toBe(false);
    expect(vm.groups.every((g) => g.rows.length === 0)).toBe(true);
  });
});

describe("skillGroupOf", () => {
  it("maps the four groups with a lifecycle fallback", () => {
    expect(skillGroupOf("roll-build")).toBe("delivery");
    expect(skillGroupOf("roll-.review")).toBe("quality");
    expect(skillGroupOf("roll-notes")).toBe("observe");
    expect(skillGroupOf("roll-loop")).toBe("lifecycle");
    expect(skillGroupOf("roll-future-unknown")).toBe("lifecycle");
  });
});
