/**
 * US-EVID-032 — capture-policy readiness collector (AC4).
 *
 * Surfaces v2 gateway readiness (negotiated from the host advertisement),
 * renderer readiness, and the effective recorded capture policy — each with an
 * actionable reason. Never guesses v2 for an unadvertised host.
 */
import { describe, expect, it } from "vitest";
import { collectCapturePolicyReadiness, renderCapturePolicyReadinessDoctorSection } from "../src/lib/capture-policy-readiness.js";

function fs(files: Record<string, string>): (path: string) => string | null {
  return (path: string) => files[path] ?? null;
}

const CAPS = "/caphost/capabilities.json";
const POLICY = "/proj/.roll/policy.yaml";

describe("collectCapturePolicyReadiness — gateway (AC4)", () => {
  it("reports v2 ready when the host advertises roll.capture.v2", () => {
    const r = collectCapturePolicyReadiness({
      projectRoot: "/proj",
      captureRoot: "/caphost",
      readFileText: fs({ [CAPS]: JSON.stringify({ protocols: ["roll.capture.v1", "roll.capture.v2"] }) }),
      rendererInstalled: () => true,
    });
    expect(r.gateway.available).toBe(true);
    expect(r.gateway.selected).toBe("roll.capture.v2");
  });

  it("never assumes v2 for an unadvertised (legacy) host", () => {
    const r = collectCapturePolicyReadiness({
      projectRoot: "/proj",
      captureRoot: "/caphost",
      readFileText: fs({}), // no capabilities.json
      rendererInstalled: () => true,
    });
    expect(r.gateway.available).toBe(false);
    expect(r.gateway.reason).toContain("never assumed");
    expect(r.migration.reasonCode).toBe("provider_v2_unavailable");
  });
});

describe("collectCapturePolicyReadiness — renderer + policy (AC4)", () => {
  it("reports renderer unavailable with an actionable reason", () => {
    const r = collectCapturePolicyReadiness({
      projectRoot: "/proj",
      captureRoot: "/caphost",
      readFileText: fs({ [CAPS]: JSON.stringify({ protocols: ["roll.capture.v2"] }) }),
      rendererInstalled: () => false,
    });
    expect(r.renderer.available).toBe(false);
    expect(r.renderer.reason).toContain("playwright install chromium");
    expect(r.migration.reasonCode).toBe("renderer_unavailable");
  });

  it("reads the recorded effective capture policy", () => {
    const r = collectCapturePolicyReadiness({
      projectRoot: "/proj",
      captureRoot: "/caphost",
      readFileText: fs({
        [CAPS]: JSON.stringify({ protocols: ["roll.capture.v2"] }),
        [POLICY]: "acceptance:\n  capture:\n    mode: best_effort\n",
      }),
      rendererInstalled: () => true,
    });
    expect(r.policy.mode).toBe("best_effort");
    expect(r.policy.source).toBe("recorded");
    expect(r.migration.action).toBe("already-best-effort");
  });

  it("reports unset policy when none recorded", () => {
    const r = collectCapturePolicyReadiness({
      projectRoot: "/proj",
      captureRoot: "/caphost",
      readFileText: fs({ [CAPS]: JSON.stringify({ protocols: ["roll.capture.v2"] }) }),
      rendererInstalled: () => true,
    });
    expect(r.policy.mode).toBeNull();
    expect(r.policy.source).toBe("unset");
    expect(r.migration.action).toBe("enabled");
  });
});

describe("renderCapturePolicyReadinessDoctorSection — bilingual (AC3/AC4)", () => {
  it("renders EN and ZH header lines separately (never inline)", () => {
    const r = collectCapturePolicyReadiness({
      projectRoot: "/proj",
      captureRoot: "/caphost",
      readFileText: fs({ [CAPS]: JSON.stringify({ protocols: ["roll.capture.v2"] }) }),
      rendererInstalled: () => true,
    });
    const lines = renderCapturePolicyReadinessDoctorSection(r);
    expect(lines).toContain("Capture policy readiness");
    expect(lines).toContain("截图策略就绪度");
    // The two headers are on separate lines.
    expect(lines.some((l) => l.includes("Capture policy readiness") && l.includes("截图"))).toBe(false);
  });
});

describe("US-PHYSICAL-012 per-source readiness", () => {
  it("surfaces + renders per-source v2 readiness (rendered ready, physical legacy)", () => {
    const r = collectCapturePolicyReadiness({
      projectRoot: "/proj",
      captureRoot: "/caphost",
      rendererInstalled: () => true,
      readFileText: fs({
        [CAPS]: JSON.stringify({
          protocols: ["roll.capture.v1", "roll.capture.v2"],
          sources: {
            "playwright-rendered": { protocol: "roll.capture.v2", served: true },
            "roll-capture-window": { protocol: "roll.capture.v1", served: true, reason: "Roll Capture.app is v1-only" },
          },
        }),
      }),
    });
    expect(r.perSource?.["playwright-rendered"]?.available).toBe(true);
    expect(r.perSource?.["roll-capture-window"]?.available).toBe(false);
    const section = renderCapturePolicyReadinessDoctorSection(r).join("\n");
    expect(section).toContain("v2 playwright-rendered — ready");
    expect(section).toContain("v2 roll-capture-window — unavailable");
  });

  it("has no perSource for a legacy protocol-only advertisement (back-compat)", () => {
    const r = collectCapturePolicyReadiness({
      projectRoot: "/proj",
      captureRoot: "/caphost",
      rendererInstalled: () => true,
      readFileText: fs({ [CAPS]: JSON.stringify({ protocols: ["roll.capture.v2"] }) }),
    });
    expect(r.perSource).toBeUndefined();
  });
});
