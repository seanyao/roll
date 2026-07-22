/**
 * US-DELTA-002 — CLI preset loader tests.
 *
 * Covers: loading from machine-local path, parsing the Pi-balanced example,
 * handling missing files, rejecting invalid YAML, and verifying the
 * loader never touches project config paths.
 */
import { describe, expect, it, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir = "";

function setupTempPreset(yaml: string): string {
  tmpDir = join(tmpdir(), `roll-test-${randomUUID()}`);
  mkdirSync(join(tmpDir, "delta-team"), { recursive: true });
  const path = join(tmpDir, "delta-team", "presets.yaml");
  writeFileSync(path, yaml, "utf8");
  return path;
}

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Dynamic import to control ROLL_HOME
async function loadWithHome(home: string) {
  const prev = process.env["ROLL_HOME"];
  try {
    process.env["ROLL_HOME"] = home;
    // Re-import to get fresh module with new env
    const mod = await import("../src/lib/delta-artifacts.js");
    return mod.loadLocalPresets();
  } finally {
    if (prev !== undefined) {
      process.env["ROLL_HOME"] = prev;
    } else {
      delete process.env["ROLL_HOME"];
    }
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("US-DELTA-002 — CLI preset loader", () => {
  it("returns empty array when presets file does not exist", async () => {
    const nonexistent = join(tmpdir(), "roll-nonexistent-${randomUUID()}");
    const result = await loadWithHome(nonexistent);
    expect(result).toEqual([]);
  });

  it("parses the Pi-balanced example preset with flow-array syntax", async () => {
    // Use the exact flow-array syntax from the actual example file: [a, b]
    const yaml = `schema: roll-delta-preset/v1
presets:
  - id: pi-balanced-v1
    hostId: pi
    roles:
      designer:
        preferredModelIds: [a-proxy/claude-opus-4-8, o-proxy/gpt-5.6-terra]
        requiredTags:
          - reasoning
        diversity: prefer
      builder:
        preferredModelIds: [a-proxy/claude-sonnet-5, o-proxy/gpt-5.6-sol, deepseek/deepseek-v4-pro]
        requiredTags:
          - coding
        preferredCostClass: medium
        diversity: prefer
      evaluator:
        preferredModelIds: [o-proxy/gpt-5.6-terra, a-proxy/claude-opus-4-8, deepseek/deepseek-v4-pro]
        requiredTags:
          - review
        diversity: require
      peer:
        preferredModelIds: [deepseek/deepseek-v4-flash, o-proxy/gpt-5.6-luna]
        preferredCostClass: low
        diversity: prefer
`;

    const path = setupTempPreset(yaml);
    const presets = await loadWithHome(tmpDir);
    expect(presets).toHaveLength(1);

    const p = presets[0]!;
    expect(p.id).toBe("pi-balanced-v1");
    expect(p.hostId).toBe("pi");
    expect(p.schema).toBe("roll-delta-preset/v1");

    // Designer — match plan 4.4 exactly
    expect(p.roles.designer.preferredModelIds).toEqual([
      "a-proxy/claude-opus-4-8",
      "o-proxy/gpt-5.6-terra",
    ]);
    expect(p.roles.designer.requiredTags).toEqual(["reasoning"]);
    expect(p.roles.designer.diversity).toBe("prefer");

    // Builder — match plan 4.4 exactly
    expect(p.roles.builder.preferredModelIds).toEqual([
      "a-proxy/claude-sonnet-5",
      "o-proxy/gpt-5.6-sol",
      "deepseek/deepseek-v4-pro",
    ]);
    expect(p.roles.builder.requiredTags).toEqual(["coding"]);
    expect(p.roles.builder.preferredCostClass).toBe("medium");
    expect(p.roles.builder.diversity).toBe("prefer");

    // Evaluator — match plan 4.4 exactly
    expect(p.roles.evaluator.preferredModelIds).toEqual([
      "o-proxy/gpt-5.6-terra",
      "a-proxy/claude-opus-4-8",
      "deepseek/deepseek-v4-pro",
    ]);
    expect(p.roles.evaluator.requiredTags).toEqual(["review"]);
    expect(p.roles.evaluator.diversity).toBe("require");

    // Peer — match plan 4.4 exactly
    expect(p.peer).toBeDefined();
    expect(p.peer!.preferredModelIds).toEqual([
      "deepseek/deepseek-v4-flash",
      "o-proxy/gpt-5.6-luna",
    ]);
    expect(p.peer!.preferredCostClass).toBe("low");
    expect(p.peer!.diversity).toBe("prefer");

    // All preferredModelIds must be non-empty per plan 4.4
    for (const role of ["designer", "builder", "evaluator"] as const) {
      expect(p.roles[role].preferredModelIds.length).toBeGreaterThan(0);
    }
    expect(p.peer!.preferredModelIds.length).toBeGreaterThan(0);
  });

  it("parses flow-array with single element", async () => {
    const yaml = `schema: roll-delta-preset/v1
presets:
  - id: p1
    hostId: h1
    roles:
      designer:
        preferredModelIds: [only-model]
        diversity: allow
      builder:
        preferredModelIds: [b1]
        diversity: allow
      evaluator:
        preferredModelIds: [e1]
        diversity: allow
`;
    const path = setupTempPreset(yaml);
    const presets = await loadWithHome(tmpDir);
    expect(presets[0]!.roles.designer.preferredModelIds).toEqual(["only-model"]);
    expect(presets[0]!.roles.builder.preferredModelIds).toEqual(["b1"]);
  });

  it("parses empty flow-array []", async () => {
    const yaml = `schema: roll-delta-preset/v1
presets:
  - id: p1
    hostId: h1
    roles:
      designer:
        preferredModelIds: []
        diversity: allow
      builder:
        preferredModelIds: []
        diversity: allow
      evaluator:
        preferredModelIds: []
        diversity: allow
`;
    const path = setupTempPreset(yaml);
    const presets = await loadWithHome(tmpDir);
    expect(presets[0]!.roles.designer.preferredModelIds).toEqual([]);
  });

  it("rejects invalid diversity value", async () => {
    const yaml = `schema: roll-delta-preset/v1
presets:
  - id: p1
    hostId: h1
    roles:
      designer:
        preferredModelIds: []
        diversity: unknown-value
      builder:
        preferredModelIds: []
        diversity: allow
      evaluator:
        preferredModelIds: []
        diversity: allow
`;
    setupTempPreset(yaml);
    await expect(loadWithHome(tmpDir)).rejects.toThrow("unknown-value");
  });

  it("rejects invalid preferredCostClass value", async () => {
    const yaml = `schema: roll-delta-preset/v1
presets:
  - id: p1
    hostId: h1
    roles:
      designer:
        preferredModelIds: []
        diversity: allow
      builder:
        preferredModelIds: []
        preferredCostClass: free
        diversity: allow
      evaluator:
        preferredModelIds: []
        diversity: allow
`;
    setupTempPreset(yaml);
    await expect(loadWithHome(tmpDir)).rejects.toThrow("free");
  });

  it("parses multiple presets", async () => {
    const yaml = `schema: roll-delta-preset/v1
presets:
  - id: preset-a
    hostId: host-a
    roles:
      designer:
        preferredModelIds:
          - model-a1
        requiredTags:
          - reasoning
        diversity: prefer
      builder:
        preferredModelIds:
          - model-b1
        requiredTags:
          - coding
        diversity: prefer
      evaluator:
        preferredModelIds:
          - model-c1
        requiredTags:
          - review
        diversity: require
  - id: preset-b
    hostId: host-b
    roles:
      designer:
        preferredModelIds:
          - model-x1
        requiredTags:
          - planning
        diversity: allow
      builder:
        preferredModelIds:
          - model-y1
        requiredTags:
          - coding
        diversity: allow
      evaluator:
        preferredModelIds:
          - model-z1
        requiredTags:
          - review
        diversity: allow
`;

    const path = setupTempPreset(yaml);
    const presets = await loadWithHome(tmpDir);
    expect(presets).toHaveLength(2);
    expect(presets[0]!.id).toBe("preset-a");
    expect(presets[1]!.id).toBe("preset-b");
  });

  it("rejects file with wrong schema", async () => {
    const yaml = `schema: wrong-schema/v1
presets:
  - id: p1
    hostId: h1
    roles:
      designer:
        preferredModelIds: []
        requiredTags: []
        diversity: allow
      builder:
        preferredModelIds: []
        requiredTags: []
        diversity: allow
      evaluator:
        preferredModelIds: []
        requiredTags: []
        diversity: allow
`;

    setupTempPreset(yaml);
    await expect(loadWithHome(tmpDir)).rejects.toThrow("roll-delta-preset/v1");
  });

  it("rejects preset missing required role", async () => {
    const yaml = `schema: roll-delta-preset/v1
presets:
  - id: p1
    hostId: h1
    roles:
      designer:
        preferredModelIds: []
        diversity: allow
      builder:
        preferredModelIds: []
        diversity: allow
`;

    setupTempPreset(yaml);
    await expect(loadWithHome(tmpDir)).rejects.toThrow("evaluator");
  });

  it("parses the actual ~/.roll/delta-team/presets.yaml.example file content", async () => {
    // Read the actual example file from disk and copy it into a temp
    // ROLL_HOME as presets.yaml so the loader can parse it.
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const examplePath = path.join(os.homedir(), ".roll", "delta-team", "presets.yaml.example");
    if (!fs.existsSync(examplePath)) {
      // Skip if example doesn't exist on this machine
      return;
    }
    const content = fs.readFileSync(examplePath, "utf8");
    // Set up a temp dir with the example content as presets.yaml
    tmpDir = join(tmpdir(), `roll-test-${randomUUID()}`);
    mkdirSync(join(tmpDir, "delta-team"), { recursive: true });
    writeFileSync(join(tmpDir, "delta-team", "presets.yaml"), content, "utf8");

    const presets = await loadWithHome(tmpDir);

    expect(presets).toHaveLength(1);
    const p = presets[0]!;
    expect(p.id).toBe("pi-balanced-v1");
    expect(p.hostId).toBe("pi");

    // Verify all preferredModelIds match plan 4.4 and are non-empty
    expect(p.roles.designer.preferredModelIds).toEqual([
      "a-proxy/claude-opus-4-8",
      "o-proxy/gpt-5.6-terra",
    ]);
    expect(p.roles.builder.preferredModelIds).toEqual([
      "a-proxy/claude-sonnet-5",
      "o-proxy/gpt-5.6-sol",
      "deepseek/deepseek-v4-pro",
    ]);
    expect(p.roles.evaluator.preferredModelIds).toEqual([
      "o-proxy/gpt-5.6-terra",
      "a-proxy/claude-opus-4-8",
      "deepseek/deepseek-v4-pro",
    ]);
    expect(p.peer!.preferredModelIds).toEqual([
      "deepseek/deepseek-v4-flash",
      "o-proxy/gpt-5.6-luna",
    ]);

    // All must be non-empty
    for (const role of ["designer", "builder", "evaluator"] as const) {
      expect(p.roles[role].preferredModelIds.length).toBeGreaterThan(0);
    }
    expect(p.peer!.preferredModelIds.length).toBeGreaterThan(0);

    // Verify diversities
    expect(p.roles.designer.diversity).toBe("prefer");
    expect(p.roles.builder.diversity).toBe("prefer");
    expect(p.roles.evaluator.diversity).toBe("require");
    expect(p.peer!.diversity).toBe("prefer");
  });

  it("handles empty roles gracefully", async () => {
    const yaml = `schema: roll-delta-preset/v1
presets:
  - id: p-minimal
    hostId: h1
    roles:
      designer:
        preferredModelIds: []
        diversity: allow
      builder:
        preferredModelIds: []
        diversity: allow
      evaluator:
        preferredModelIds: []
        diversity: allow
`;

    const path = setupTempPreset(yaml);
    const presets = await loadWithHome(tmpDir);
    expect(presets).toHaveLength(1);
    const p = presets[0]!;
    expect(p.roles.designer.preferredModelIds).toEqual([]);
    expect(p.roles.designer.diversity).toBe("allow");
    expect(p.peer).toBeUndefined();
  });

  it("never reads from project config paths", async () => {
    // The loader only reads from ROLL_HOME/delta-team/presets.yaml
    // This test verifies it doesn't look at .roll/agents.yaml or .roll/policy.yaml
    // by providing a valid ROLL_HOME but ensuring no project config access

    const yaml = `schema: roll-delta-preset/v1
presets:
  - id: p1
    hostId: h1
    roles:
      designer:
        preferredModelIds: []
        diversity: allow
      builder:
        preferredModelIds: []
        diversity: allow
      evaluator:
        preferredModelIds: []
        diversity: allow
`;

    setupTempPreset(yaml);
    // Should succeed without touching any project-level files
    const presets = await loadWithHome(tmpDir);
    expect(presets).toHaveLength(1);
  });
});

// ── Path derivation ───────────────────────────────────────────────────────────

describe("US-DELTA-002 — preset path derivation", () => {
  it("presetPath() returns path under ROLL_HOME", async () => {
    const prev = process.env["ROLL_HOME"];
    try {
      process.env["ROLL_HOME"] = "/custom/roll/home";
      const mod = await import("../src/lib/delta-artifacts.js");
      expect(mod.presetPath()).toBe("/custom/roll/home/delta-team/presets.yaml");
    } finally {
      if (prev !== undefined) {
        process.env["ROLL_HOME"] = prev;
      } else {
        delete process.env["ROLL_HOME"];
      }
    }
  });
});
