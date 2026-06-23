import type { ToolDeclaration, ToolRequirement, ToolRequirementResolution } from "@roll/spec";
import { describe, expect, it } from "vitest";
import { deriveToolReadiness } from "../src/index.js";

const declaration = (requirements: ToolRequirement[]): ToolDeclaration => ({
  id: "browser.screenshot" as ToolDeclaration["id"],
  kind: "browser",
  title: "Browser Screenshot",
  requirements,
});

const resolve = (states: Record<string, ToolRequirementResolution["status"]>) => (requirement: ToolRequirement): ToolRequirementResolution => ({
  requirement,
  status: states[requirement.name] ?? "ok",
  detail: `${requirement.name} is ${states[requirement.name] ?? "ok"}`,
  ...(states[requirement.name] === "missing" ? { repair: { command: `install ${requirement.name}` } } : {}),
});

describe("US-TOOL-020 tool readiness", () => {
  it("available when every non-optional requirement is ok", () => {
    const readiness = deriveToolReadiness(
      declaration([
        { kind: "executable", name: "git", optional: false },
        { kind: "executable", name: "playwright-chromium", optional: true },
      ]),
      resolve({ git: "ok", "playwright-chromium": "ok" }),
    );

    expect(readiness.status).toBe("available");
    expect(readiness.requirements.map((r) => r.status)).toEqual(["ok", "ok"]);
  });

  it("degraded when only optional requirements are missing", () => {
    const readiness = deriveToolReadiness(
      declaration([{ kind: "executable", name: "playwright-chromium", optional: true }]),
      resolve({ "playwright-chromium": "missing" }),
    );

    expect(readiness.status).toBe("degraded");
    expect(readiness.detail).toContain("playwright-chromium is missing");
    expect(readiness.repairCommands).toEqual(["install playwright-chromium"]);
  });

  it("unavailable when a non-optional requirement is missing", () => {
    const readiness = deriveToolReadiness(declaration([{ kind: "executable", name: "gh", optional: false }]), resolve({ gh: "missing" }));

    expect(readiness.status).toBe("unavailable");
    expect(readiness.detail).toContain("gh is missing");
    expect(readiness.repairCommands).toEqual(["install gh"]);
  });
});
