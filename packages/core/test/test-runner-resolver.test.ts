/**
 * FIX-1274 — unit coverage for the deterministic, fail-loud per-commit test-gate
 * resolver. Pure inputs → pure resolution: no I/O, no clock. Proves version
 * compatibility, changed-mode preference, full-suite fallback, wrapper parity,
 * structured diagnostics, and determinism across repeated calls.
 */
import { describe, expect, it } from "vitest";
import {
  MIN_VITEST_CHANGED_MAJOR,
  isNoTestsFoundOutput,
  parseMajor,
  resolveGateCommand,
  type GateResolution,
} from "../src/delivery/test-runner-resolver.js";

describe("parseMajor", () => {
  it("extracts the leading major integer", () => {
    expect(parseMajor("3.2.7")).toBe(3);
    expect(parseMajor("4.1.8")).toBe(4);
    expect(parseMajor("^3.2.0")).toBe(3);
    expect(parseMajor("0.34.6")).toBe(0);
    expect(parseMajor("10.0.0")).toBe(10);
  });
  it("is undefined for unparseable / missing versions", () => {
    expect(parseMajor(undefined)).toBeUndefined();
    expect(parseMajor("")).toBeUndefined();
    expect(parseMajor("latest")).toBeUndefined();
  });
});

describe("resolveGateCommand — Vitest projects", () => {
  it("prefers the supported --changed mode on Vitest 3.2.x (never --affected)", () => {
    const r = resolveGateCommand({
      hasPackageJson: true,
      testScript: "vitest run",
      vitestVersion: "3.2.7",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected a plan");
    expect(r.plan.mode).toBe("changed");
    expect(r.plan.npmTestArgs).toEqual(["--changed"]);
    expect(r.plan.npmTestArgs).not.toContain("--affected");
    expect(r.plan.writesProof).toBe(true);
  });

  it("prefers --changed on Vitest 4.x too", () => {
    const r = resolveGateCommand({ hasPackageJson: true, testScript: "vitest run --passWithNoTests", vitestVersion: "4.1.8" });
    if (!r.ok) throw new Error("expected a plan");
    expect(r.plan.mode).toBe("changed");
  });

  it("falls back to the FULL suite when the Vitest version is undetectable", () => {
    const r = resolveGateCommand({ hasPackageJson: true, testScript: "vitest run", vitestVersion: undefined });
    if (!r.ok) throw new Error("expected a plan");
    expect(r.plan.mode).toBe("full");
    expect(r.plan.npmTestArgs).toEqual([]);
    expect(r.plan.npmTestArgs).not.toContain("--affected");
    expect(r.plan.writesProof).toBe(true);
  });

  it("falls back to FULL for a too-old (0.x) Vitest with no verified changed mode", () => {
    const r = resolveGateCommand({ hasPackageJson: true, testScript: "vitest", vitestVersion: "0.34.6" });
    if (!r.ok) throw new Error("expected a plan");
    expect(r.plan.mode).toBe("full");
    expect(MIN_VITEST_CHANGED_MAJOR).toBe(1);
  });
});

describe("resolveGateCommand — roll wrapper parity", () => {
  it("keeps the --affected token for roll's own test-ts.sh wrapper", () => {
    const r = resolveGateCommand({ hasPackageJson: true, testScript: "bash scripts/test-ts.sh" });
    if (!r.ok) throw new Error("expected a plan");
    expect(r.plan.mode).toBe("affected");
    expect(r.plan.npmTestArgs).toEqual(["--affected"]);
    // The wrapper owns its own proof — roll must not double-write.
    expect(r.plan.writesProof).toBe(false);
  });
});

describe("resolveGateCommand — non-vitest + legacy", () => {
  it("runs the project's FULL command for a non-vitest runner (jest), never injecting a flag", () => {
    const r = resolveGateCommand({ hasPackageJson: true, testScript: "jest --ci" });
    if (!r.ok) throw new Error("expected a plan");
    expect(r.plan.mode).toBe("full");
    expect(r.plan.npmTestArgs).toEqual([]);
    expect(r.plan.writesProof).toBe(true);
  });

  it("preserves the legacy --affected default when there is no package.json", () => {
    const r = resolveGateCommand({ hasPackageJson: false });
    if (!r.ok) throw new Error("expected a plan");
    expect(r.plan.mode).toBe("affected");
    expect(r.plan.npmTestArgs).toEqual(["--affected"]);
    expect(r.plan.writesProof).toBe(false);
  });
});

describe("resolveGateCommand — structured diagnostics", () => {
  it("returns a fail-loud diagnostic when a package.json has no test script", () => {
    const r = resolveGateCommand({ hasPackageJson: true, testScript: undefined });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected a diagnostic");
    expect(r.attempted).toContain("npm test");
    expect(r.reason).toMatch(/scripts\.test/);
    expect(r.nextStep).toMatch(/roll test -- |test.*script/i);
  });

  it("treats an empty/whitespace test script as unresolvable", () => {
    const r = resolveGateCommand({ hasPackageJson: true, testScript: "   " });
    expect(r.ok).toBe(false);
  });
});

describe("resolveGateCommand — determinism", () => {
  const cases = [
    { hasPackageJson: true, testScript: "vitest run", vitestVersion: "3.2.7" },
    { hasPackageJson: true, testScript: "bash scripts/test-ts.sh" },
    { hasPackageJson: true, testScript: undefined },
    { hasPackageJson: false },
  ] as const;

  it("produces byte-identical resolutions across three repeated calls", () => {
    for (const input of cases) {
      const calls: GateResolution[] = [
        resolveGateCommand({ ...input }),
        resolveGateCommand({ ...input }),
        resolveGateCommand({ ...input }),
      ];
      expect(JSON.stringify(calls[1])).toBe(JSON.stringify(calls[0]));
      expect(JSON.stringify(calls[2])).toBe(JSON.stringify(calls[0]));
    }
  });
});

describe("isNoTestsFoundOutput", () => {
  it("detects Vitest's empty-selection message (which exits 0)", () => {
    expect(isNoTestsFoundOutput("No test files found, exiting with code 0")).toBe(true);
    expect(isNoTestsFoundOutput("no test files found")).toBe(true);
  });
  it("is false for real test output", () => {
    expect(isNoTestsFoundOutput("Test Files  3 passed (3)")).toBe(false);
    expect(isNoTestsFoundOutput("FAIL  src/foo.test.ts")).toBe(false);
  });
});
