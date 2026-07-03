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
    const rows = collectToolReadinessDoctorRows("/repo", fakeResolver, {
      status: "available",
      installed: { status: "installed", path: "/Applications/Roll Capture.app" },
      hostPermission: { status: "granted", detail: "host permission proxy: current host process passed." },
      inbox: {
        status: "writable",
        path: "/Users/test/Library/Application Support/Roll Capture/inbox",
        detail: "temp-file atomic write succeeded.",
      },
      detailLines: [
        "installed=installed (/Applications/Roll Capture.app)",
        "hostPermission=granted — host permission proxy: current host process passed.",
        "hostPermission.zh=granted — 宿主权限代理：当前宿主进程已通过。",
        "inbox=writable (/Users/test/Library/Application Support/Roll Capture/inbox) — temp-file atomic write succeeded.",
      ],
      repairCommands: [],
    });
    const row = (id: string) => rows.find((candidate) => candidate.id === id);

    expect(row("bash")?.status).toBe("available");
    expect(row("browser.screenshot")?.status).toBe("degraded");
    expect(row("github.pr")?.status).toBe("unavailable");
    expect(row("physical.screenshot")?.status).toBe("available");

    const text = renderToolReadinessDoctorSection(rows).join("\n");
    expect(text).toContain("Tool readiness");
    expect(text).toContain("github.pr (github) — unavailable");
    expect(text).toContain("fix: brew install gh");
    expect(text).toContain("browser.screenshot (browser) — degraded");
    expect(text).toContain("fix: npx playwright install chromium");
    expect(text).toContain("physical.screenshot (physical) — available");
    expect(text).toContain("installed=installed (/Applications/Roll Capture.app)");
    expect(text).toContain("hostPermission=granted");
    expect(text).toContain("inbox=writable");
  });

  it("keeps missing app or denied permission as warnings, not doctor failures", () => {
    const rows = collectToolReadinessDoctorRows("/repo", fakeResolver, {
      status: "degraded",
      installed: { status: "missing" },
      hostPermission: { status: "denied", detail: "host permission proxy: current host process failed." },
      inbox: {
        status: "blocked",
        path: "/Users/test/Library/Application Support/Roll Capture/inbox",
        detail: "EACCES",
      },
      detailLines: [
        "installed=missing",
        "hostPermission=denied — host permission proxy: current host process failed.",
        "hostPermission.zh=denied — 宿主权限代理：当前宿主进程未通过。",
        "inbox=blocked (/Users/test/Library/Application Support/Roll Capture/inbox) — EACCES",
      ],
      repairCommands: [
        "install Roll Capture.app to ~/Applications or /Applications",
        "open x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      ],
    });
    const text = renderToolReadinessDoctorSection(rows).join("\n");

    expect(rows.find((row) => row.id === "physical.screenshot")?.status).toBe("degraded");
    expect(text).toContain("~ physical.screenshot (physical) — degraded");
    expect(text).toContain("installed=missing");
    expect(text).toContain("hostPermission=denied");
    expect(text).toContain("inbox=blocked");
    expect(text).toContain("fix: install Roll Capture.app");
    expect(text).toContain("fix: open x-apple.systempreferences");
  });
});
