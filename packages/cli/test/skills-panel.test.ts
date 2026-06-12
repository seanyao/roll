/** US-DOSSIER-017 — skills catalog read from disk + strict-audit truth. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectSkillsPanel, skillGroupOf } from "../src/lib/skills-panel.js";

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

const AUDIT = {
  summary: { skills: 2, violations: 1 },
  skills: [
    { name: "roll-build", lines: 60, description: "Load when shipping", violations: [], hasGotchas: true, descriptionLoadTrigger: true, routeCoverage: { positiveCount: 2, negativeCount: 2 } },
    { name: "roll-ghost", lines: 10, description: "not on disk", violations: ["missing"], hasGotchas: false, descriptionLoadTrigger: false, routeCoverage: {} },
  ],
};

describe("collectSkillsPanel", () => {
  it("AC5: the directory is the catalog — audited-but-absent skills never appear", () => {
    const p = project({ "roll-build": "# Roll Build\nhub\n" });
    const vm = collectSkillsPanel(p, { auditJson: () => AUDIT, usageCounts: () => ({ "roll-build": 7 }) });
    const names = vm.groups.flatMap((g) => g.rows.map((r) => r.name));
    expect(names).toEqual(["roll-build"]);
    expect(vm.summary.skills).toBe(2); // audit yardstick preserved verbatim
    expect(vm.summary.violations).toBe(1);
  });

  it("rows carry usage, audit essentials, real file tree with line counts, and the hub text", () => {
    const p = project({ "roll-build": "# Roll Build\nhub line\n" });
    const vm = collectSkillsPanel(p, { auditJson: () => AUDIT, usageCounts: () => ({ "roll-build": 7 }) });
    const row = vm.groups.find((g) => g.key === "delivery")!.rows[0]!;
    expect(row.usage).toBe(7);
    expect(row.hasGotchas).toBe(true);
    expect(row.routeCases).toEqual({ positive: 2, negative: 2 });
    expect(row.files.some((f) => f.path === "SKILL.md" && f.lines > 0)).toBe(true);
    expect(row.files.some((f) => f.path === "references/full-contract.md")).toBe(true);
    expect(row.hubText).toContain("# Roll Build");
    expect(row.dirPath).toContain("roll-build");
  });

  it("no audit script → honest empty panel", () => {
    const p = project({});
    const vm = collectSkillsPanel(p, { auditJson: () => null, usageCounts: () => ({}) });
    expect(vm.summary.skills).toBe(0);
    expect(vm.groups.every((g) => g.rows.length === 0)).toBe(true);
  });
});

describe("skillGroupOf", () => {
  it("maps the four groups with a lifecycle fallback", () => {
    expect(skillGroupOf("roll-build")).toBe("delivery");
    expect(skillGroupOf("roll-.review")).toBe("quality");
    expect(skillGroupOf("roll-brief")).toBe("observe");
    expect(skillGroupOf("roll-loop")).toBe("lifecycle");
    expect(skillGroupOf("roll-future-unknown")).toBe("lifecycle");
  });
});
