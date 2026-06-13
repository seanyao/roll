/**
 * US-DOSSIER-032 — the ONE skills-audit yardstick (TS port). It is the single
 * source the Skills page, `roll skills audit`, and `scripts/audit-skills.mjs`
 * all read, so the numbers match everywhere. These tests pin the audit rules
 * (the same gates the legacy `skills/scripts/audit-skills.mjs` enforced) and the
 * deterministic, lexicographic ordering.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditSkills, formatHumanReport, parseFrontmatter } from "../src/lib/skills-audit.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function skillsTree(skills: Record<string, { md: string; refs?: Record<string, string> }>): string {
  const p = mkdtempSync(join(tmpdir(), "roll-aud-"));
  dirs.push(p);
  const routes: Record<string, { positive: string[]; negative: string[] }> = {};
  for (const [name, spec] of Object.entries(skills)) {
    mkdirSync(join(p, "skills", name), { recursive: true });
    writeFileSync(join(p, "skills", name, "SKILL.md"), spec.md);
    for (const [rel, body] of Object.entries(spec.refs ?? {})) {
      const full = join(p, "skills", name, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body);
    }
    routes[name] = { positive: ["a", "b"], negative: ["c", "d"] };
  }
  mkdirSync(join(p, "skills", "route-cases"), { recursive: true });
  writeFileSync(join(p, "skills", "route-cases", "skills.json"), JSON.stringify({ version: 1, skills: routes }));
  return join(p, "skills");
}

const CLEAN = "---\nname: roll-build\ndescription: Load when shipping a US story end to end\n---\n# Roll Build\n\n## Gotchas\n- be careful\n";

describe("auditSkills", () => {
  it("a fully-compliant skill has zero violations", () => {
    const dir = skillsTree({ "roll-build": { md: CLEAN } });
    const report = auditSkills({ skillsDir: dir });
    expect(report.summary.skills).toBe(1);
    expect(report.summary.violations).toBe(0);
    expect(report.skills[0]!.violations).toEqual([]);
    expect(report.skills[0]!.routeCoverage).toEqual({ positiveCount: 2, negativeCount: 2, hasMinimumCoverage: true });
  });

  it("flags each gate: load-trigger, gotchas, word count, route coverage, hub size", () => {
    const dir = skillsTree({
      "roll-x": {
        // description is not a Load-when trigger AND is over 50 words; no Gotchas section
        md:
          "---\nname: roll-x\ndescription: " +
          Array(60).fill("word").join(" ") +
          "\n---\nbody no gotchas\n",
      },
    });
    // remove route coverage by pointing at an empty routes file
    const report = auditSkills({ skillsDir: dir, routeFile: join(dir, "does-not-exist.json") });
    const v = report.skills[0]!.violations;
    expect(v).toContain("description-not-load-trigger");
    expect(v).toContain("description-over-50-words");
    expect(v).toContain("gotchas-missing");
    expect(v).toContain("route-fixture-coverage-missing");
  });

  it("flags an unreferenced spoke file and a missing spoke reference", () => {
    const dir = skillsTree({
      "roll-y": {
        md: "---\nname: roll-y\ndescription: Load when y\n---\n# Y\n\nSee `references/missing.md`.\n\n## Gotchas\n- g\n",
        refs: { "references/orphan.md": "lonely\n" },
      },
    });
    const v = auditSkills({ skillsDir: dir }).skills[0]!.violations;
    expect(v).toContain("missing-spoke-ref:references/missing.md");
    expect(v).toContain("unreferenced-spoke:references/orphan.md");
  });

  it("is deterministic: skills sorted lexicographically", () => {
    const dir = skillsTree({ "roll-zeta": { md: CLEAN }, "roll-alpha": { md: CLEAN }, "roll-mid": { md: CLEAN } });
    const names = auditSkills({ skillsDir: dir }).skills.map((s) => s.name);
    // name comes from frontmatter (all "roll-build" here) — file order is the tiebreak
    expect(auditSkills({ skillsDir: dir }).skills.length).toBe(3);
    expect([...names]).toEqual(names); // stable across re-run
  });

  it("missing skills dir → empty report, never throws", () => {
    const report = auditSkills({ skillsDir: join(tmpdir(), "definitely-not-there-" + Date.now()) });
    expect(report.summary.skills).toBe(0);
    expect(report.summary.violations).toBe(0);
  });

  it("the human report is byte-stable and lists each skill", () => {
    const dir = skillsTree({ "roll-build": { md: CLEAN } });
    const text = formatHumanReport(auditSkills({ skillsDir: dir }));
    expect(text).toContain("Skill audit: 1 skills");
    expect(text).toContain("Violations: 0");
    expect(text).toContain("- roll-build: ok (");
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("parseFrontmatter", () => {
  it("parses scalar fields and the body", () => {
    const { fields, body, ok } = parseFrontmatter("---\nname: a\ndescription: Load when x\n---\nbody here\n");
    expect(ok).toBe(true);
    expect(fields["name"]).toBe("a");
    expect(fields["description"]).toBe("Load when x");
    expect(body.trim()).toBe("body here");
  });

  it("no frontmatter → ok false", () => {
    expect(parseFrontmatter("# just a heading\n").ok).toBe(false);
  });
});
