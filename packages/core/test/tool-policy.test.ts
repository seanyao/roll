import type { ToolDefaults, ToolId } from "@roll/spec";
import { describe, expect, it } from "vitest";
import { ToolPolicyEngine } from "../src/index.js";

const BASH = "bash" as ToolId;

const defaults: ToolDefaults = {
  enabled: true,
  timeoutMs: 1000,
  retry: { attempts: 1, backoffMs: 0 },
  maxInvocationsPerCycle: 10,
  sandbox: {
    allowedPaths: ["/repo"],
    blockedCommands: ["sudo"],
    hardTimeoutSec: 5,
    maxOutputBytes: 1024,
    allowedOrigins: ["http://localhost:3000"],
    headlessOnly: true,
  },
};

function engine(policy: string, warnings: string[] = []): ToolPolicyEngine {
  return new ToolPolicyEngine({
    policyPath: "/repo/.roll/policy.yaml",
    readFile: async () => policy,
    warn: (message) => warnings.push(message),
  });
}

describe("US-TOOL-003 ToolPolicyEngine", () => {
  it("merges exact tool config over declaration defaults", async () => {
    const policy = await engine(`
tools:
  bash:
    enabled: true
    timeoutMs: 2500
    retry:
      attempts: 3
      backoffMs: 25
    maxInvocationsPerCycle: 4
`).resolve(BASH, defaults);

    expect(policy).toEqual({
      enabled: true,
      timeoutMs: 2500,
      retry: { attempts: 3, backoffMs: 25 },
      maxInvocationsPerCycle: 4,
      sandbox: defaults.sandbox,
    });
  });

  it("handles partial config without dropping unrelated defaults", async () => {
    const policy = await engine(`
tools:
  bash:
    timeoutMs: 3000
`).resolve(BASH, defaults);

    expect(policy.enabled).toBe(true);
    expect(policy.timeoutMs).toBe(3000);
    expect(policy.retry).toEqual(defaults.retry);
    expect(policy.sandbox).toEqual(defaults.sandbox);
  });

  it("uses defaults when tools section or per-tool entry is missing", async () => {
    await expect(engine("loop_safety:\n  maxConsecutiveFailures: 3\n").resolve(BASH, defaults)).resolves.toEqual({
      enabled: true,
      timeoutMs: 1000,
      retry: { attempts: 1, backoffMs: 0 },
      maxInvocationsPerCycle: 10,
      sandbox: defaults.sandbox,
    });
    await expect(engine("tools:\n  browser.screenshot:\n    timeoutMs: 10\n").resolve(BASH, defaults)).resolves.toEqual({
      enabled: true,
      timeoutMs: 1000,
      retry: { attempts: 1, backoffMs: 0 },
      maxInvocationsPerCycle: 10,
      sandbox: defaults.sandbox,
    });
  });

  it("respects enabled false and parses integer budget", async () => {
    const policy = await engine(`
tools:
  bash:
    enabled: false
    maxInvocationsPerCycle: 2
`).resolve(BASH, defaults);

    expect(policy.enabled).toBe(false);
    expect(policy.maxInvocationsPerCycle).toBe(2);
  });

  it("parses all sandbox fields", async () => {
    const policy = await engine(`
tools:
  bash:
    sandbox:
      allowedPaths: [/tmp, /repo]
      blockedCommands:
        - rm
        - curl
      hardTimeoutSec: 12
      maxOutputBytes: 8192
      allowedOrigins: [http://localhost:4173, https://example.test]
      headlessOnly: false
`).resolve(BASH, defaults);

    expect(policy.sandbox).toEqual({
      allowedPaths: ["/tmp", "/repo"],
      blockedCommands: ["rm", "curl"],
      hardTimeoutSec: 12,
      maxOutputBytes: 8192,
      allowedOrigins: ["http://localhost:4173", "https://example.test"],
      headlessOnly: false,
    });
  });

  it("warns on unknown fields but does not reject the policy", async () => {
    const warnings: string[] = [];
    const policy = await engine(
      `
tools:
  bash:
    timeoutMs: 2000
    surprise: yes
    sandbox:
      allowedPaths: [/tmp]
      mystery: no
`,
      warnings,
    ).resolve(BASH, defaults);

    expect(policy.timeoutMs).toBe(2000);
    expect(policy.sandbox?.allowedPaths).toEqual(["/tmp"]);
    expect(warnings).toEqual([
      "unknown tools.bash field: surprise",
      "unknown tools.bash.sandbox field: mystery",
    ]);
  });
});
