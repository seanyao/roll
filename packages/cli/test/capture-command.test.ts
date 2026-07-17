/**
 * US-EVID-032 — `roll capture` command (AC1 migrate, AC2 repair, AC4 status).
 *
 * Exercises the CLI surface against fixture policy / health files in a temp dir.
 * NEVER touches the real project policy file.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureCommand, evidenceHealthFactPath } from "../src/commands/capture.js";
import type { CapturePolicyReadiness } from "../src/lib/capture-policy-readiness.js";

const dirs: string[] = [];
function tmpProject(policy?: string): string {
  const root = mkdtempSync(join(tmpdir(), "roll-cap-"));
  dirs.push(root);
  mkdirSync(join(root, ".roll"), { recursive: true });
  if (policy !== undefined) writeFileSync(join(root, ".roll", "policy.yaml"), policy);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d !== undefined) rmSync(d, { recursive: true, force: true });
  }
});

function captureStdout(): { text: () => string; restore: () => void } {
  let buf = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    buf += String(chunk);
    return true;
  });
  return { text: () => buf, restore: () => spy.mockRestore() };
}

function readiness(over: Partial<CapturePolicyReadiness> = {}): CapturePolicyReadiness {
  return {
    gateway: { available: true, reason: "host advertises roll.capture.v2", selected: "roll.capture.v2" },
    renderer: { available: true, reason: "Playwright Chromium is installed" },
    policy: { mode: null, source: "unset", reason: "no capture mode recorded" },
    migration: { action: "enabled", reasonCode: "gateway-and-renderer-ready", reason: "ready" },
    ...over,
  };
}

describe("roll capture migrate (AC1)", () => {
  it("enables best_effort when both capabilities are ready and writes policy", async () => {
    const root = tmpProject("acceptance:\n  screenshot_exempt_epics: [foo]\n");
    const out = captureStdout();
    const code = await captureCommand(["migrate", "--project", root], { readiness: () => readiness() });
    out.restore();
    expect(code).toBe(0);
    const written = readFileSync(join(root, ".roll", "policy.yaml"), "utf8");
    expect(written).toContain("mode: best_effort");
    expect(written).toContain("screenshot_exempt_epics: [foo]");
  });

  it("retains policy (no write) when the gateway is unavailable", async () => {
    const original = "acceptance:\n  capture:\n    mode: legacy\n";
    const root = tmpProject(original);
    const out = captureStdout();
    const code = await captureCommand(["migrate", "--project", root], {
      readiness: () => readiness({ gateway: { available: false, reason: "no v2", selected: null }, migration: { action: "retained", reasonCode: "provider_v2_unavailable", reason: "no v2" } }),
    });
    out.restore();
    expect(code).toBe(0);
    expect(out.text()).toContain("provider_v2_unavailable");
    expect(readFileSync(join(root, ".roll", "policy.yaml"), "utf8")).toBe(original);
  });

  it("--dry-run never writes", async () => {
    const original = "acceptance:\n  screenshot_exempt_epics: [foo]\n";
    const root = tmpProject(original);
    const out = captureStdout();
    await captureCommand(["migrate", "--project", root, "--dry-run"], { readiness: () => readiness() });
    out.restore();
    expect(readFileSync(join(root, ".roll", "policy.yaml"), "utf8")).toBe(original);
    expect(out.text()).toContain("dry-run");
  });

  it("migrate then --revert restores the original policy", async () => {
    const original = "acceptance:\n  screenshot_exempt_epics: [foo]\n";
    const root = tmpProject(original);
    let out = captureStdout();
    await captureCommand(["migrate", "--project", root], { readiness: () => readiness() });
    out.restore();
    expect(readFileSync(join(root, ".roll", "policy.yaml"), "utf8")).toContain("best_effort");
    out = captureStdout();
    await captureCommand(["migrate", "--project", root, "--revert"], {});
    out.restore();
    expect(readFileSync(join(root, ".roll", "policy.yaml"), "utf8")).toBe(original);
  });
});

describe("roll capture repair (AC2)", () => {
  it("refuses a non-degraded record and never rebuilds", async () => {
    const root = tmpProject();
    const healthPath = evidenceHealthFactPath(root, "US-X-1");
    mkdirSync(join(root, ".roll", "features", "_evidence-health"), { recursive: true });
    writeFileSync(healthPath, JSON.stringify({ surfaceId: "http://x/y", delivery: "passed", visual: "verified", acceptedReceiptIds: [], attempts: [], category: "evidence-verified", blocksGate: false, reschedulesBuild: false, markedDegraded: false, evidenceOnlyRepair: false, reason: "ok" }));
    const out = captureStdout();
    const code = await captureCommand(["repair", "US-X-1", "--project", root], {});
    out.restore();
    expect(code).toBe(1);
    expect(out.text()).toContain("reopenedBuild=false");
    expect(out.text()).toContain("not evidence-only repairable");
  });

  it("runs an evidence-only repair for a degraded record without reopening the build", async () => {
    const root = tmpProject();
    const healthPath = evidenceHealthFactPath(root, "US-X-2");
    mkdirSync(join(root, ".roll", "features", "_evidence-health"), { recursive: true });
    writeFileSync(
      healthPath,
      JSON.stringify({ surfaceId: "http://localhost:3000/team", delivery: "passed", visual: "degraded-infrastructure", acceptedReceiptIds: [], attempts: ["r1"], category: "evidence-degradation", blocksGate: false, reschedulesBuild: false, markedDegraded: true, evidenceOnlyRepair: true, reason: "degraded" }),
    );
    const out = captureStdout();
    const code = await captureCommand(["repair", "US-X-2", "--project", root, "--json"], {
      store: { captureSetId: () => "s", async persistReceipt(_i, r) { return { status: "persisted", receipt: r, captureSetId: "s", accepted: r.state === "taken" }; } },
      lanes: [],
    });
    out.restore();
    expect(code).toBe(0);
    const parsed = JSON.parse(out.text());
    expect(parsed.reopenedBuild).toBe(false);
    expect(parsed.buildUntouched).toBe(true);
    expect(parsed.newHealth.delivery).toBe("passed");
  });
});

describe("roll capture status (AC4)", () => {
  it("prints gateway/renderer readiness and effective policy", async () => {
    const root = tmpProject();
    const out = captureStdout();
    const code = await captureCommand(["status", "--project", root, "--json"], { readiness: () => readiness() });
    out.restore();
    expect(code).toBe(0);
    const parsed = JSON.parse(out.text());
    expect(parsed.gateway.available).toBe(true);
    expect(parsed.renderer.available).toBe(true);
    expect(parsed.migration.reasonCode).toBe("gateway-and-renderer-ready");
  });
});
