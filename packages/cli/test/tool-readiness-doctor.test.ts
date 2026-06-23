import type { ToolRequirement, ToolRequirementResolution } from "@roll/spec";
import { describe, expect, it } from "vitest";
import { collectToolReadinessDoctorRows, renderToolReadinessDoctorSection } from "../src/lib/tool-readiness-doctor.js";

function fakeResolver(requirement: ToolRequirement): ToolRequirementResolution {
  if (requirement.name === "gh") return { requirement, status: "missing", detail: "gh is not on PATH.", repair: { command: "brew install gh" } };
  if (requirement.name === "playwright-chromium") {
    return { requirement, status: "missing", detail: "Chromium is not installed.", repair: { command: "npx playwright install chromium" } };
  }
  return { requirement, status: "ok", detail: `${requirement.name} ok` };
}

describe("US-TOOL-020 doctor tool readiness", () => {
  it("renders per-tool readiness from requirement resolution", () => {
    const rows = collectToolReadinessDoctorRows("/repo", fakeResolver);
    const row = (id: string) => rows.find((candidate) => candidate.id === id);

    expect(row("bash")?.status).toBe("available");
    expect(row("browser.screenshot")?.status).toBe("degraded");
    expect(row("github.pr")?.status).toBe("unavailable");

    const text = renderToolReadinessDoctorSection(rows).join("\n");
    expect(text).toContain("Tool readiness");
    expect(text).toContain("github.pr (github) — unavailable");
    expect(text).toContain("fix: brew install gh");
    expect(text).toContain("browser.screenshot (browser) — degraded");
    expect(text).toContain("fix: npx playwright install chromium");
  });
});
