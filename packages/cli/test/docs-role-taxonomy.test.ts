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
