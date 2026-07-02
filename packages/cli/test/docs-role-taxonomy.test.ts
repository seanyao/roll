import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");

function doc(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function section(md: string, heading: string): string {
  const start = md.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = md.slice(start + heading.length);
  const next = rest.search(/\n#{2,3} /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("REFACTOR-ROLE-001 — canonical role taxonomy docs", () => {
  it("architecture presents only Supervisor / Designer / Builder / Evaluator as active roles", () => {
    const architecture = doc("docs/architecture.md");
    const roleSection = section(architecture, "### BC3 · Agent Scope / Role");

    expect(roleSection).toContain("Supervisor / Designer / Builder / Evaluator");
    expect(roleSection).toContain("Supervisor = control plane");
    expect(roleSection).toContain("Designer = design plane");
    expect(roleSection).toContain("Builder = implementation plane");
    expect(roleSection).toContain("Evaluator = verification plane");
    expect(roleSection).toMatch(/fresh sessions[\s\S]{0,240}artifact handoff/);
    expect(roleSection).toMatch(/capability[\s\S]{0,180}health[\s\S]{0,180}parser stability[\s\S]{0,180}cost[\s\S]{0,180}story\s+risk/);
    expect(roleSection).not.toMatch(/Prime Agent|Delta Unit|Planner|planned|planner-contract\.md|avoid: \[supervise\]/);
  });

  it("architecture defines designed execution and a breaking migration boundary", () => {
    const architecture = doc("docs/architecture.md");
    const executionSection = section(architecture, "### BC9 · Supervisor 与执行剖面（v4）");

    expect(executionSection).toContain("`designed` = Designer -> Builder -> Evaluator");
    expect(executionSection).toContain("role-artifacts/designer/design-contract.md");
    expect(executionSection).toMatch(/Prime Agent[\s\S]{0,120}retired active term/);
    expect(executionSection).toMatch(/Planner[\s\S]{0,120}retired active term/);
    expect(executionSection).toMatch(/planner-contract\.md[\s\S]{0,160}retired active artifact/);
    expect(executionSection).toMatch(/No alias[\s\S]{0,120}fallback[\s\S]{0,120}dual-write/);
    expect(executionSection).not.toMatch(/`planned` =|planner-contract\.md` \/ `execute-evidence|Prime Agent \*\*绝不\*\*/);
  });
});

describe("REFACTOR-ROLE-006 — user-facing role taxonomy surfaces", () => {
  it("supervisor help uses Supervisor and Designer active terms", () => {
    const supervisorSource = doc("packages/cli/src/commands/supervisor.ts");

    expect(supervisorSource).toContain("Supervisor decisions");
    expect(supervisorSource).toContain("Supervisor live board with Designer/Builder/Evaluator panes");
    expect(supervisorSource).not.toMatch(/Prime Agent decisions|Prime Agent live board|Planner\/Builder\/Evaluator panes/);
  });

  it("README and overview docs present Supervisor and Designer as active roles", () => {
    const activeDocs = [
      doc("README.md"),
      doc("README_CN.md"),
      doc("guide/en/overview.md"),
      doc("guide/zh/overview.md"),
    ].join("\n");

    expect(activeDocs).toMatch(/Supervisor/);
    expect(activeDocs).toMatch(/Designer/);
    expect(activeDocs).not.toMatch(/Prime Agent|Planner/);
  });

  it("loop docs describe standard, verified, and designed profiles", () => {
    const loopEn = section(doc("guide/en/loop.md"), "## Execution profiles");
    const loopZh = section(doc("guide/zh/loop.md"), "## 执行剖面");
    const loopDocs = `${loopEn}\n${loopZh}`;

    expect(loopDocs).toMatch(/standard \/ verified \/ designed/);
    expect(loopDocs).toMatch(/`designed` = Designer -> Builder -> Evaluator/);
    expect(loopDocs).toMatch(/design-contract-vs-delivered/);
    expect(loopDocs).not.toMatch(/planned profile|`planned` =|planned-vs-delivered|planner contract|planner-contract/);
    expect(loopDocs).not.toMatch(/Prime Agent/);
  });

  it("site data no longer markets Prime Agent, Planner, or planned profiles as active concepts", () => {
    const siteData = doc("site/roll-data.js");

    expect(siteData).toContain("Supervisor");
    expect(siteData).toContain("Designer");
    expect(siteData).toContain("standard · verified · designed");
    expect(siteData).not.toMatch(/Prime Agent|Planner|standard · verified · planned|planned profiles|planned 剖面/);
  });
});
