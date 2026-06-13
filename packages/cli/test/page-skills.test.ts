/**
 * US-DOSSIER-032 — structural-fidelity test for the machine-global Skills page
 * (`skills.html`). Asserts EVERY component the design reference
 * (`Delivery Dossier.dc.html` lines 573–684) draws is present and rendered from
 * real VM data — header, audit strip (figures + command chips + shared
 * data-source line), the four skill groups, the row grid, and the per-row
 * expand (file tree · audit essentials · SKILL.md viewer). Also pins AC4: the
 * `unknown` state when the audit can't run.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectSkillsPanel } from "../src/lib/skills-panel.js";
import { renderSkillsPage } from "../src/lib/page-skills.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const HUB = (name: string): string =>
  `---\nname: ${name}\ndescription: Load when working on ${name}\n---\n# ${name}\n\nWorkflow contract.\n\n## Gotchas\n- careful\n`;

/** A fixture box carrying one skill per group (group derived from the name). */
function box(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-pgsk-"));
  dirs.push(p);
  const names = ["roll-build", "roll-peer", "roll-brief", "roll-loop", "roll-.echo"];
  const routes: Record<string, { positive: string[]; negative: string[] }> = {};
  for (const n of names) {
    mkdirSync(join(p, "skills", n, "references"), { recursive: true });
    writeFileSync(join(p, "skills", n, "SKILL.md"), HUB(n) + "\nSee `references/full-contract.md`.\n");
    writeFileSync(join(p, "skills", n, "references", "full-contract.md"), "a\nb\nc\n");
    routes[n] = { positive: ["a", "b"], negative: ["c", "d"] };
  }
  mkdirSync(join(p, "skills", "route-cases"), { recursive: true });
  writeFileSync(join(p, "skills", "route-cases", "skills.json"), JSON.stringify({ version: 1, skills: routes }));
  return p;
}

function render(p: string): string {
  return renderSkillsPage({
    skills: collectSkillsPanel(p),
    brand: { name: "roll", slogan: "It just works." },
    projects: [],
    currentSlug: "roll",
    snapshot: { release: { latestTag: "v9.9.9" } },
  });
}

/** Each entry: a reference component and a substring that proves it rendered. */
const COMPONENTS: Array<[string, string]> = [
  ["machine top-bar shell (breadcrumb)", 'data-machine="skills"'],
  ["page kicker (Harness rulebook)", "Harness rulebook"],
  ["page kicker zh (执行契约)", "执行契约"],
  ["page title (Skills on this machine)", "Skills on this machine"],
  ["page title zh (本机技能)", "本机技能"],
  ["page lede", "Markdown playbooks agents load and follow"],
  ["audit strip · skills figure", ">skills<"],
  ["audit strip · violations figure", ">violations<"],
  ["audit strip · Load-when figure", "Load when… desc"],
  ["audit strip · Gotchas figure", "Gotchas coverage"],
  ["audit strip · over-250 figure", "over 250 lines"],
  ["audit strip · aux-files figure", "with aux files"],
  ["audit strip · hub-lines figure", "hub lines"],
  ["audit strip · doctor command chip", "roll doctor skills"],
  ["audit strip · strict-audit command chip", "roll skills audit --strict"],
  ["audit strip · machine-side note", "machine-side: install"],
  ["audit strip · repo-side note", "repo-side: reproduces"],
  ["data-source line · shared kicker", "repo shared"],
  ["data-source line · route-cases", "route-cases/skills.json"],
  ["data-source line · audit script", "scripts/audit-skills.mjs"],
  ["data-source line · authoring doc", "docs/skill-authoring.md"],
  ["group · Delivery", ">Delivery<"],
  ["group · Quality", ">Quality<"],
  ["group · Observe", ">Observe<"],
  ["group · Lifecycle", ">Lifecycle<"],
  ["row grid header · skill", ">skill<"],
  ["row grid header · invocations/3d", "invocations / 3d"],
  ["row grid header · last", ">last<"],
  ["row · expand caret", "bl-caret"],
  ["row · per-skill anchor", "data-skill="],
  ["row · usage bar", "border-radius:999px"],
  ["row · passive badge (roll-.echo)", "passive"],
  ["expand · Structure label", ">Structure<"],
  ["expand · file tree entry (SKILL.md)", "SKILL.md"],
  ["expand · references pointer", "references/full-contract.md"],
  ["expand · audit essentials", "audit essentials"],
  ["expand · Load-when essential", "Load when"],
  ["expand · route cases essential", "route cases"],
  ["expand · copyable dir path chip", "copy-chip"],
  ["expand · SKILL.md viewer toggle", "SKILL.md · "],
  ["expand · rendered markdown body", "sk-md-body"],
  ["expand · rendered markdown heading", "<h1>roll-build</h1>"],
  ["footer credo", "main = truth"],
  ["lang spans (bilingual)", 'class="lang-zh"'],
];

describe("renderSkillsPage — structural fidelity", () => {
  const html = render(box());

  for (const [label, needle] of COMPONENTS) {
    it(`renders: ${label}`, () => {
      expect(html, `missing component «${label}» — expected substring not found`).toContain(needle);
    });
  }

  it("groups every skill on disk under its group (real data, zero hardcoded arrays)", () => {
    expect(html).toContain(">roll-build<");
    expect(html).toContain(">roll-peer<");
    expect(html).toContain(">roll-brief<");
    expect(html).toContain(">roll-loop<");
    expect(html).toContain(">roll-.echo<");
  });

  it("is a single self-contained HTML document", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("AC4: audit unavailable → bar + rows render `unknown`, never a silent 0", () => {
    // a box with a skill on disk but no route-cases AND audit forced to fail
    const p = mkdtempSync(join(tmpdir(), "roll-pgsk-"));
    dirs.push(p);
    mkdirSync(join(p, "skills", "roll-build"), { recursive: true });
    writeFileSync(join(p, "skills", "roll-build", "SKILL.md"), HUB("roll-build"));
    const vm = collectSkillsPanel(p, { audit: () => null, usageCounts: () => ({}) });
    const out = renderSkillsPage({ skills: vm, brand: { name: "roll", slogan: "" }, snapshot: {} });
    expect(out).toContain("audit unavailable — violations unknown");
    expect(out).toContain(">roll-build<"); // disk skill still rendered
    // the big violations figure must NOT be a green "0"
    expect(out).not.toMatch(/color:#178a52;margin-top:3px;">0</);
  });
});
