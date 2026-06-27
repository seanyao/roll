import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dispatch } from "../src/bridge.js";
import { registerAll } from "../src/index.js";

const ROOT = resolve(__dirname, "../../..");

function doc(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

async function captureDispatch(argv: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  try {
    // @ts-expect-error test capture
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      stdout += String(chunk);
      return true;
    };
    // @ts-expect-error test capture
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      stderr += String(chunk);
      return true;
    };
    const result = await dispatch(argv, async () => ({ ok: true }));
    return { status: result.status, stdout, stderr };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
}

describe("US-INIT-008 — init/onboard docs and help", () => {
  it("documents roll next as the continuation command after init and apply", () => {
    for (const path of ["README.md", "README_CN.md", "guide/en/project-setup.md", "guide/zh/project-setup.md"]) {
      expect(doc(path), path).toContain("roll next");
    }

    expect(doc("guide/en/legacy-onboarding.md")).toContain("Done. Run `roll next`");
    expect(doc("guide/zh/legacy-onboarding.md")).toContain("执行 `roll next` 接续下一步");
  });

  it("keeps current onboarding surfaces on existing-codebase terminology", () => {
    const en = doc("guide/en/legacy-onboarding.md");
    expect(en).toContain("# Existing Codebase Onboarding");
    expect(en).toContain("existing codebase");
    expect(en).not.toContain("# Legacy Project Onboarding");
    expect(en).not.toContain("live legacy project");
    expect(en).not.toContain("legacy codebase");

    const zh = doc("guide/zh/legacy-onboarding.md");
    expect(zh).toContain("# 已有代码库接入 Roll");
    expect(zh).not.toContain("遗留项目");
    expect(zh).not.toContain("老项目");

    expect(doc("guide/INDEX.md")).toContain("Existing Codebase Onboarding");
    expect(doc("guide/INDEX.md")).toContain("已有代码库接入 Roll");
  });

  it("keeps the site navigation and onboard diagram aligned with the current flow", () => {
    const site = doc("site/roll-data.js");
    expect(site).toContain("Existing codebase onboarding plan");
    expect(site).toContain("Existing Codebase Onboarding");
    expect(site).toContain("已有代码库接入计划");
    expect(site).toContain("已有代码库接入");
    expect(site).toContain("roll next continues after apply");
    expect(site).not.toContain("Legacy onboarding plan");
    expect(site).not.toContain("Legacy Onboarding");
    expect(site).not.toContain("老项目接入计划");
    expect(site).not.toContain("老项目接入");

    const diagramData = doc("site/diagrams/skill-diagram-data.js");
    expect(diagramData).toContain(".roll/init-diagnosis.yaml");
    expect(diagramData).toContain(".roll/onboard-plan.yaml");
    expect(diagramData).toContain("roll next");
    expect(diagramData).not.toContain("Only <code>.roll/onboard-plan.yaml</code> may be created.");

    const diagram = doc("site/diagrams/skill-diagram.js");
    expect(diagram).toContain("diagnosis + onboard-plan -> roll init --apply -> roll next");
  });

  it("keeps the roll-onboard skill boundary and handoff explicit", () => {
    const skill = doc("skills/roll-onboard/SKILL.md");
    expect(skill).toContain("existing codebase without Roll");
    expect(skill).toContain(".roll/init-diagnosis.yaml");
    expect(skill).toContain(".roll/onboard-plan.yaml");
    expect(skill).toContain("roll init --apply");
    expect(skill).toContain("roll next");

    const skillIndex = doc("skills/README.md");
    expect(skillIndex).toContain("roll-onboard");
    expect(skillIndex).toContain("已有代码库交互式接入");
  });

  it("exposes init, next, and permission-preflight help from the CLI", async () => {
    registerAll();

    const init = await captureDispatch(["init", "--help"]);
    expect(init.status).toBe(0);
    expect(init.stderr).toBe("");
    expect(init.stdout).toContain("Usage: roll init [--auto|--repair|--apply]");
    expect(init.stdout).toContain("PRD design, existing-codebase onboard");
    expect(init.stdout).toContain("--apply: validate and apply a reviewed existing-codebase onboard plan");

    const next = await captureDispatch(["next", "--help"]);
    expect(next.status).toBe(0);
    expect(next.stdout).toContain("Continue the roll init/onboard journey");
    expect(next.stdout).toContain("design, apply, repair, migrate, loop, or status");

    const doctor = await captureDispatch(["doctor", "--help"]);
    expect(doctor.status).toBe(0);
    expect(doctor.stdout).toContain("physical screenshot");
    expect(doctor.stdout).toContain("permission preflight");
  });
});
