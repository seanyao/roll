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

describe("FIX-005 roll capture local-window", () => {
  it("derives a project-local output and reports a verifiable nonce-selected receipt", async () => {
    const root = tmpProject();
    const localWindow = vi.fn(async () => ({
      status: "taken" as const,
      path: join(root, ".roll", "captures", "controlled-local", "FIX-005", "run-a", "controlled-window-example.png"),
      response: { responsePath: "/tmp/controlled-window-response.json" },
      selector: { appName: "Google Chrome" as const, windowTitle: "Roll Capture FIX-005 generated-nonce" },
    }));
    const out = captureStdout();
    const code = await captureCommand([
      "local-window", "--project", root, "--story", "FIX-005", "--run", "run-a",
      "--url", "http://127.0.0.1:4173/team", "--json",
    ], { captureLocalWindow: localWindow } as never);
    out.restore();

    expect(code).toBe(0);
    expect(localWindow).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot: root,
      url: "http://127.0.0.1:4173/team",
      request: expect.objectContaining({
        storyId: "FIX-005",
        runId: "run-a",
        kind: "web",
        out: expect.stringMatching(new RegExp(`^${join(root, ".roll", "captures", "controlled-local", "FIX-005", "run-a", "controlled-window-")}[^/]+\\.png$`)),
      }),
    }));
    expect(JSON.parse(out.text())).toMatchObject({
      status: "taken",
      path: join(root, ".roll", "captures", "controlled-local", "FIX-005", "run-a", "controlled-window-example.png"),
      response: { responsePath: "/tmp/controlled-window-response.json" },
      selector: { windowTitle: "Roll Capture FIX-005 generated-nonce" },
    });
  });

  it("labels the screenshot and Roll Capture receipt as separate paths", async () => {
    const root = tmpProject();
    const screenshotPath = join(root, ".roll", "captures", "controlled-local", "FIX-005", "run-a", "controlled-window-example.png");
    const out = captureStdout();
    const code = await captureCommand([
      "local-window", "--project", root, "--story", "FIX-005", "--run", "run-a",
      "--url", "http://127.0.0.1:4173/team",
    ], {
      captureLocalWindow: vi.fn(async () => ({
        status: "taken" as const,
        path: screenshotPath,
        response: { responsePath: "/tmp/controlled-window-response.json" },
      })),
    } as never);
    out.restore();

    expect(code).toBe(0);
    expect(out.text()).toContain(`screenshot: ${screenshotPath}`);
    expect(out.text()).toContain("receipt: /tmp/controlled-window-response.json");
    expect(out.text()).not.toContain(`receipt: ${screenshotPath}`);
  });

  it("uses the controlled Roll Capture lane when the browser extension is unavailable", async () => {
    const root = tmpProject();
    const localWindow = vi.fn(async () => ({ status: "taken" as const }));
    const out = captureStdout();
    const code = await captureCommand([
      "local-window", "--project", root, "--story", "FIX-1444", "--run", "extension-unavailable",
      "--url", "http://127.0.0.1:4173/synthetic",
    ], { captureLocalWindow: localWindow } as never);
    out.restore();

    expect(code).toBe(0);
    expect(localWindow).toHaveBeenCalledOnce();
    expect(out.text()).toContain("browser extension: not used");
    expect(out.text()).toContain("privacy: loopback-only synthetic target in a temporary profile");
  });

  it("rejects a remote page before the controlled capture lane starts", async () => {
    const root = tmpProject();
    const localWindow = vi.fn();
    const out = captureStdout();
    const code = await captureCommand([
      "local-window", "--project", root, "--story", "FIX-005", "--url", "https://example.com/team",
    ], { captureLocalWindow: localWindow } as never);
    out.restore();

    expect(code).toBe(1);
    expect(localWindow).not.toHaveBeenCalled();
    expect(out.text()).toContain("loopback");
  });

  it("uses a different artifact path for each retry in the same run", async () => {
    const root = tmpProject();
    const requests: string[] = [];
    const localWindow = vi.fn(async (input: { request: { out: string } }) => {
      requests.push(input.request.out);
      return { status: "skipped" as const, reason: "fixture host unavailable" };
    });
    const args = ["local-window", "--project", root, "--story", "FIX-005", "--run", "retry-run", "--url", "http://127.0.0.1:4173/team"];
    const first = captureStdout();
    await captureCommand(args, { captureLocalWindow: localWindow } as never);
    first.restore();
    const second = captureStdout();
    await captureCommand(args, { captureLocalWindow: localWindow } as never);
    second.restore();

    expect(requests).toHaveLength(2);
    expect(requests[0]).not.toBe(requests[1]);
  });

  it("passes only a parsed closed-vocabulary prepare list to the controlled local lane", async () => {
    const root = tmpProject();
    const localWindow = vi.fn(async () => ({ status: "taken" as const }));
    const out = captureStdout();
    const code = await captureCommand([
      "local-window", "--project", root, "--story", "FIX-1435", "--url", "http://127.0.0.1:4173/",
      "--prepare", '[{"kind":"click","selector":"#synthetic-checkbox"},{"kind":"wait","ms":125},{"kind":"scroll","selector":"#synthetic-result"}]',
    ], { captureLocalWindow: localWindow } as never);
    out.restore();

    expect(code).toBe(0);
    expect(localWindow).toHaveBeenCalledWith(expect.objectContaining({
      prepare: [
        { kind: "click", selector: "#synthetic-checkbox" },
        { kind: "wait", ms: 125 },
        { kind: "scroll", selector: "#synthetic-result" },
      ],
    }));
  });

  it("rejects arbitrary evaluation and never starts the controlled local lane", async () => {
    const root = tmpProject();
    const localWindow = vi.fn();
    const out = captureStdout();
    const code = await captureCommand([
      "local-window", "--project", root, "--story", "FIX-1435", "--url", "http://127.0.0.1:4173/",
      "--prepare", '[{"kind":"evaluate","expression":"document.cookie"}]',
    ], { captureLocalWindow: localWindow } as never);
    out.restore();

    expect(code).toBe(1);
    expect(localWindow).not.toHaveBeenCalled();
    expect(out.text()).toContain("prepare");
  });
});
