/**
 * FIX-1042: auxiliary skill-tree directories must never be mounted as skills.
 *
 * Two layers are covered here, both reading from the single shared policy in
 * setup-shared so doctor and setup cannot drift:
 *   - the path-boundary-safe predicate (`isRollAuxiliarySkillTarget`), incl. the
 *     `docs-internal` lookalike the prior `agy` review flagged; and
 *   - `roll doctor`'s pollution detector, which must report a polluted skill
 *     root WITHOUT treating the agent as auth/network-blocked.
 */
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAuxiliarySkillTreeDir, isRollAuxiliarySkillTarget } from "../src/commands/setup-shared.js";
import { detectSkillRootPollution } from "../src/commands/doctor.js";

describe("FIX-1042 auxiliary-dir policy (shared predicate)", () => {
  it("classifies the five auxiliary skill-tree directories", () => {
    for (const aux of ["docs", "reports", "scripts", "route-cases", "tests"]) {
      expect(isAuxiliarySkillTreeDir(aux)).toBe(true);
    }
    expect(isAuxiliarySkillTreeDir("roll-build")).toBe(false);
    expect(isAuxiliarySkillTreeDir("docs-internal")).toBe(false);
  });

  it("matches auxiliary symlink targets path-boundary-safely", () => {
    const homeSkills = "/home/u/.roll/skills";
    expect(isRollAuxiliarySkillTarget("/home/u/.roll/skills/docs/", homeSkills)).toBe(true);
    expect(isRollAuxiliarySkillTarget("/home/u/.roll/skills/reports", homeSkills)).toBe(true);
    // Lookalike name → NOT auxiliary (loose-prefix trap the prior review caught).
    expect(isRollAuxiliarySkillTarget("/home/u/.roll/skills/docs-internal/", homeSkills)).toBe(false);
    // Different parent root → not ours.
    expect(isRollAuxiliarySkillTarget("/home/u/.roll/skills-other/docs", homeSkills)).toBe(false);
    expect(isRollAuxiliarySkillTarget("/home/u/.roll/skills/roll-build/", homeSkills)).toBe(false);
    expect(isRollAuxiliarySkillTarget("", homeSkills)).toBe(false);
  });
});

describe("FIX-1042 roll doctor skill-root pollution detector", () => {
  let home = "";
  const saved = process.env["ROLL_HOME"];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "roll-pollution-"));
    process.env["ROLL_HOME"] = join(home, ".roll");
    mkdirSync(join(home, ".roll", "skills", "docs"), { recursive: true });
    mkdirSync(join(home, ".roll", "skills", "roll-build"), { recursive: true });
  });
  afterEach(() => {
    if (saved === undefined) delete process.env["ROLL_HOME"];
    else process.env["ROLL_HOME"] = saved;
  });

  const cfg = "ai_reasonix: ~/.reasonix|AGENTS.md|AGENTS.md\n";

  it("reports an auxiliary mount in an agent skill root", () => {
    const rxSkills = join(home, ".reasonix", "skills");
    mkdirSync(rxSkills, { recursive: true });
    symlinkSync(`${join(home, ".roll", "skills", "docs")}/`, join(rxSkills, "docs"));
    symlinkSync(`${join(home, ".roll", "skills", "roll-build")}/`, join(rxSkills, "roll-build"));

    const found = detectSkillRootPollution(cfg, home);
    expect(found).toHaveLength(1);
    expect(found[0]?.agent).toBe("reasonix");
    expect(found[0]?.link).toBe(join(rxSkills, "docs"));
  });

  it("reports nothing for a clean skill root (no false auth signal)", () => {
    const rxSkills = join(home, ".reasonix", "skills");
    mkdirSync(rxSkills, { recursive: true });
    symlinkSync(`${join(home, ".roll", "skills", "roll-build")}/`, join(rxSkills, "roll-build"));
    expect(detectSkillRootPollution(cfg, home)).toEqual([]);
  });

  it("reports nothing when the agent skills root is absent", () => {
    expect(detectSkillRootPollution(cfg, home)).toEqual([]);
  });

  it("ignores a real user-authored skill placed in the root", () => {
    const rxSkills = join(home, ".reasonix", "skills");
    mkdirSync(join(rxSkills, "my-skill"), { recursive: true });
    writeFileSync(join(rxSkills, "my-skill", "SKILL.md"), "---\nname: my-skill\ndescription: x\n---\n");
    expect(detectSkillRootPollution(cfg, home)).toEqual([]);
  });
});
