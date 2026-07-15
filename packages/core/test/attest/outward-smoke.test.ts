/**
 * US-ATTEST-016 — Core smoke runner tests.
 *
 * Covers:
 *   - AC2: Command digest computation
 *   - AC2: Output redaction (credential patterns, truncation)
 *   - AC3: Environment gate (matching / unmatched → unverified-external)
 *   - AC2: Smoke run report assembly
 *   - AC1: Report → OutwardSmokeResult conversion
 *   - AC5: Redaction edge cases, path isolation (no real fs access)
 */
import { describe, expect, it } from "vitest";
import {
  computeCommandDigest,
  redactOutput,
  matchEnvironment,
  buildSmokeRunReport,
  toOutwardSmokeResults,
  type SmokeSpawnResult,
  type BuildReportParams,
} from "../../src/attest/outward-smoke.js";
import type { OutwardSmokeDeclaration } from "@roll/spec";

// ════════════════════════════════════════════════════════════════════════════
// AC2: Command digest
// ════════════════════════════════════════════════════════════════════════════

describe("US-ATTEST-016 AC2 — command digest", () => {
  it("produces a stable SHA-256 hex digest", () => {
    const digest = computeCommandDigest("npm i -g github:owner/repo#abc123 && test --version");
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes extra whitespace", () => {
    const a = computeCommandDigest("npm   install   -g   foo");
    const b = computeCommandDigest("npm install -g foo");
    expect(a).toBe(b);
  });

  it("normalizes leading/trailing whitespace", () => {
    const a = computeCommandDigest("  echo hello  ");
    const b = computeCommandDigest("echo hello");
    expect(a).toBe(b);
  });

  it("produces different digests for different commands", () => {
    const a = computeCommandDigest("echo hello");
    const b = computeCommandDigest("echo world");
    expect(a).not.toBe(b);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AC2: Output redaction
// ════════════════════════════════════════════════════════════════════════════

describe("US-ATTEST-016 AC2 — output redaction", () => {
  it("passes through clean output unchanged", () => {
    const input = "Build successful\nAll tests passed\nDone.";
    expect(redactOutput(input)).toBe(input);
  });

  it("redacts GitHub tokens (ghp_ prefix)", () => {
    const input = "Using token ghp_1234567890abcdef1234567890abcdef12345678 for auth";
    const out = redactOutput(input);
    expect(out).not.toContain("ghp_");
    expect(out).toContain("[REDACTED: GitHub token]");
  });

  it("redacts npm tokens", () => {
    const input = "echo Using npm token npm_abcdef1234567890abcdef1234567890abcd for auth";
    const out = redactOutput(input);
    expect(out).not.toContain("npm_abcdef");
    expect(out).toContain("[REDACTED: npm token]");
  });

  it("redacts Bearer auth headers", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";
    const out = redactOutput(input);
    expect(out).not.toContain("Bearer eyJ");
    expect(out).toContain("[REDACTED: auth header]");
  });

  it("redacts PASSWORD=... patterns in output", () => {
    const input = "Warning: PASSWORD=hunter2 exposed in log";
    const out = redactOutput(input);
    expect(out).not.toContain("hunter2");
    expect(out).toContain("[REDACTED: credential in output]");
  });

  it("redacts SECRET=... patterns in output", () => {
    const input = "env: SECRET=abc123xyz";
    const out = redactOutput(input);
    expect(out).not.toContain("abc123xyz");
    expect(out).toContain("[REDACTED: credential in output]");
  });

  it("truncates output exceeding maxBytes", () => {
    const longText = "A".repeat(100_000);
    const out = redactOutput(longText, 100);
    expect(out.length).toBeLessThanOrEqual(200); // head + tail + truncation notice
    expect(out).toContain("bytes truncated");
    // Must contain beginning and end of original
    expect(out).toContain("AAAAA");
  });

  it("does not truncate output under maxBytes", () => {
    const shortText = "short output";
    const out = redactOutput(shortText, 1000);
    expect(out).toBe(shortText);
  });

  it("handles empty output", () => {
    expect(redactOutput("")).toBe("");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AC3: Environment gate
// ════════════════════════════════════════════════════════════════════════════

describe("US-ATTEST-016 AC3 — environment gate", () => {
  const makeDecl = (cmd: string, env: "ci" | "nightly" | "release"): OutwardSmokeDeclaration => ({
    mode: "external-smoke",
    command: cmd,
    environment: env,
    timeoutSec: 60,
  });

  it("matches declarations for the current environment", () => {
    const decls = [makeDecl("npm test", "ci"), makeDecl("npm publish", "release")];
    const { matching, unmatched } = matchEnvironment(decls, "ci");
    expect(matching).toHaveLength(1);
    expect(matching[0]?.command).toBe("npm test");
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]?.reason).toContain("release");
    expect(unmatched[0]?.reason).toContain("ci");
  });

  it("returns all unmatched when current environment matches none", () => {
    const decls = [makeDecl("cmd1", "release"), makeDecl("cmd2", "release")];
    const { matching, unmatched } = matchEnvironment(decls, "ci");
    expect(matching).toHaveLength(0);
    expect(unmatched).toHaveLength(2);
  });

  it("returns all matching when all declarations share current environment", () => {
    const decls = [makeDecl("cmd1", "nightly"), makeDecl("cmd2", "nightly")];
    const { matching, unmatched } = matchEnvironment(decls, "nightly");
    expect(matching).toHaveLength(2);
    expect(unmatched).toHaveLength(0);
  });

  it("handles empty declarations", () => {
    const { matching, unmatched } = matchEnvironment([], "ci");
    expect(matching).toHaveLength(0);
    expect(unmatched).toHaveLength(0);
  });

  it("produces unverified with specific reason, not silent skip", () => {
    const decls = [makeDecl("npm install -g", "release")];
    const { unmatched } = matchEnvironment(decls, "ci");
    expect(unmatched[0]?.reason).toMatch(/does not match/);
    // Reason must mention both declared and current
    expect(unmatched[0]?.reason).toContain("release");
    expect(unmatched[0]?.reason).toContain("ci");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AC2: Report assembly
// ════════════════════════════════════════════════════════════════════════════

describe("US-ATTEST-016 AC2 — report assembly", () => {
  const decl: OutwardSmokeDeclaration = {
    mode: "external-smoke",
    command: "npm test",
    environment: "ci",
    timeoutSec: 30,
  };

  const acMap = new Map<string, string>([["npm test", "AC1"]]);

  const successSpawn: SmokeSpawnResult = {
    exitCode: 0,
    stdout: "All tests passed",
    stderr: "",
    durationMs: 1500,
    timedOut: false,
  };

  const failSpawn: SmokeSpawnResult = {
    exitCode: 1,
    stdout: "",
    stderr: "test failed: expected true got false",
    durationMs: 2000,
    timedOut: false,
  };

  const timeoutSpawn: SmokeSpawnResult = {
    exitCode: null,
    stdout: "partial output",
    stderr: "",
    durationMs: 30_000,
    timedOut: true,
  };

  function makeParams(overrides: Partial<BuildReportParams> = {}): BuildReportParams {
    return {
      runId: "2026-07-15T10-00-00",
      environment: "ci",
      startedAt: "2026-07-15T10:00:00Z",
      spawnResults: new Map(),
      declarations: [decl],
      acMap,
      artifactDir: "/tmp/smoke-run",
      unmatched: [],
      ...overrides,
    };
  }

  it("records success with exitCode 0", () => {
    const spawnResults = new Map<string, SmokeSpawnResult>([["npm test", successSpawn]]);
    const report = buildSmokeRunReport(makeParams({ spawnResults }));
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.exitCode).toBe(0);
    expect(report.results[0]?.summary).toBe("smoke passed");
    expect(report.results[0]?.ac).toBe("AC1");
    expect(report.results[0]?.commandDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(report.results[0]?.durationMs).toBe(1500);
    expect(report.results[0]?.timedOut).toBe(false);
  });

  it("records failure with exit code and stderr summary", () => {
    const spawnResults = new Map<string, SmokeSpawnResult>([["npm test", failSpawn]]);
    const report = buildSmokeRunReport(makeParams({ spawnResults }));
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.exitCode).toBe(1);
    expect(report.results[0]?.summary).toContain("exited with code 1");
    expect(report.results[0]?.summary).toContain("test failed");
    expect(report.results[0]?.timedOut).toBe(false);
  });

  it("records timeout with specific message", () => {
    const spawnResults = new Map<string, SmokeSpawnResult>([["npm test", timeoutSpawn]]);
    const report = buildSmokeRunReport(makeParams({ spawnResults }));
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.exitCode).toBeNull();
    expect(report.results[0]?.summary).toContain("timed out after 30s");
    expect(report.results[0]?.timedOut).toBe(true);
  });

  it("preserves unverified entries from environment gate", () => {
    const spawnResults = new Map<string, SmokeSpawnResult>([["npm test", successSpawn]]);
    const report = buildSmokeRunReport(
      makeParams({
        spawnResults,
        unmatched: [{ ac: "AC2", reason: 'declared environment "release" does not match current environment "ci"' }],
      }),
    );
    expect(report.unverified).toHaveLength(1);
    expect(report.unverified[0]?.ac).toBe("AC2");
    expect(report.unverified[0]?.reason).toContain("does not match");
  });

  it("records run metadata", () => {
    const spawnResults = new Map<string, SmokeSpawnResult>([["npm test", successSpawn]]);
    const report = buildSmokeRunReport(makeParams({ spawnResults }));
    expect(report.runId).toBe("2026-07-15T10-00-00");
    expect(report.environment).toBe("ci");
    expect(report.startedAt).toBe("2026-07-15T10:00:00Z");
  });

  it("falls back to command as AC id when acMap has no entry", () => {
    const spawnResults = new Map<string, SmokeSpawnResult>([["npm test", successSpawn]]);
    const report = buildSmokeRunReport(makeParams({ spawnResults, acMap: new Map() }));
    expect(report.results[0]?.ac).toBe("npm test");
  });

  it("adds missing spawns to unverified list defensively", () => {
    // Declaration present but no spawn result → infrastructure error
    const report = buildSmokeRunReport(makeParams({ spawnResults: new Map() }));
    expect(report.results).toHaveLength(0);
    // The missing spawn should show up in unverified
    const defensive = report.unverified.find((u) => u.ac === "AC1");
    expect(defensive).toBeDefined();
    expect(defensive?.reason).toContain("infrastructure error");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AC1: SmokeRunEntry → OutwardSmokeResult conversion
// ════════════════════════════════════════════════════════════════════════════

describe("US-ATTEST-016 AC1 — toOutwardSmokeResults conversion", () => {
  it("converts entries to resolver-compatible shape", () => {
    const entries = [
      {
        ac: "AC1",
        command: "cmd1",
        environment: "ci",
        exitCode: 0,
        summary: "smoke passed",
        commandDigest: "abc123",
        durationMs: 1000,
        artifactPath: "artifacts/ac1.txt",
        startedAt: "2026-01-01T00:00:00Z",
        timedOut: false,
      },
      {
        ac: "AC2",
        command: "cmd2",
        environment: "ci",
        exitCode: 1,
        summary: "exited with code 1",
        commandDigest: "def456",
        durationMs: 2000,
        artifactPath: "artifacts/ac2.txt",
        startedAt: "2026-01-01T00:00:01Z",
        timedOut: false,
      },
    ];

    const results = toOutwardSmokeResults(entries);
    expect(results).toHaveLength(2);
    expect(results[0]?.exitCode).toBe(0);
    expect(results[0]?.summary).toBe("smoke passed");
    expect(results[1]?.exitCode).toBe(1);
    expect(results[1]?.summary).toContain("exited with code 1");
  });

  it("treats null exitCode (signal-killed) as failure (exitCode 1)", () => {
    const entries = [
      {
        ac: "AC1",
        command: "cmd1",
        environment: "ci",
        exitCode: null,
        summary: "killed by signal",
        commandDigest: "abc",
        durationMs: 5000,
        artifactPath: "artifacts/ac1.txt",
        startedAt: "2026-01-01T00:00:00Z",
        timedOut: true,
      },
    ];

    const results = toOutwardSmokeResults(entries);
    expect(results[0]?.exitCode).toBe(1);
  });

  it("handles empty entries", () => {
    expect(toOutwardSmokeResults([])).toHaveLength(0);
  });
});
