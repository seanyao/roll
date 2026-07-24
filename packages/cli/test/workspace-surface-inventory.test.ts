import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { registerPorted, registeredCliOperations } from "../src/bridge.js";
import { registerAll } from "../src/commands/index.js";
import { publicCommands } from "../src/lib/command-surface.js";
import {
  buildRegisteredWorkspaceContextMatrix,
  builtinToolContextInventory,
  skillContextPoliciesFromManifest,
} from "../src/lib/workspace-context-policy.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const skillsRoot = join(root, "skills");

function shippedSkillIds(): string[] {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(skillsRoot, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

function skillsManifest(): unknown {
  return JSON.parse(readFileSync(join(skillsRoot, "route-cases", "skills.json"), "utf8"));
}

describe("US-WS-032 actual Workspace surface inventory", () => {
  it("enumerates CLI leaves from live registerPorted metadata", () => {
    registerAll();
    const inventory = registeredCliOperations();
    const families = [...new Set(inventory.map((entry) => entry.command))].sort();
    expect(families).toEqual([...publicCommands()].sort());
    expect(inventory).toContainEqual(expect.objectContaining({ command: "workspace", operation: "create" }));
    expect(inventory).not.toContainEqual(expect.objectContaining({ command: "workspace", operation: "init" }));
    expect(inventory).toContainEqual(expect.objectContaining({ command: "backlog", operation: "read", supportsWorkspaceSelector: true }));
    expect(inventory.some((entry) => entry.command === "ws")).toBe(false);
    const commandSources = readdirSync(join(root, "packages", "cli", "src", "commands"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(join(root, "packages", "cli", "src", "commands", name), "utf8"))
      .join("\n");
    expect(commandSources).not.toContain("--ws");
  });

  it("enumerates shipped Skill.md families and built-in adapter declarations", () => {
    const skillIds = shippedSkillIds();
    const skillPolicies = skillContextPoliciesFromManifest(skillsManifest());
    const toolInventory = builtinToolContextInventory();
    expect(new Set(skillPolicies.map((policy) => policy.id))).toEqual(new Set(skillIds));
    expect(new Set(toolInventory.map((item) => `${item.id}:${item.operation}`)).size).toBe(toolInventory.length);
  });

  it.each([
    ["unknown scope", { scope: "future_scope" }],
    ["wrong selector type", { acceptsWorkspaceSelector: "yes" }],
    ["extra field", { undocumented: true }],
    ["empty operation", { operation: "" }],
    ["unknown consumer", { contextConsumer: "project" }],
  ])("rejects malformed skill manifest policy: %s", (_name, mutation) => {
    const manifest = structuredClone(skillsManifest()) as {
      workspaceContextPolicies: Array<Record<string, unknown>>;
    };
    manifest.workspaceContextPolicies[0] = {
      ...manifest.workspaceContextPolicies[0],
      ...mutation,
    };
    expect(() => skillContextPoliciesFromManifest(manifest)).toThrow(/invalid skill policy at index 0/);
  });

  it("closes the registered inventory and matches the stable machine artifact", () => {
    registerAll();
    const matrix = buildRegisteredWorkspaceContextMatrix({
      cliInventory: registeredCliOperations().map((entry) => ({
        surface: "cli" as const,
        id: entry.command,
        operation: entry.operation,
        supportsWorkspaceSelector: entry.supportsWorkspaceSelector,
      })),
      skillIds: shippedSkillIds(),
      skillPolicies: skillContextPoliciesFromManifest(skillsManifest()),
    });
    const artifact = JSON.parse(readFileSync(join(root, "docs", "generated", "workspace-context-compatibility-matrix.json"), "utf8"));
    expect(matrix).toEqual(artifact);
    expect(matrix.summary).toEqual({
      cliFamilies: new Set(matrix.rows.filter((row) => row.surface === "cli").map((row) => row.id)).size,
      cliOperations: matrix.rows.filter((row) => row.surface === "cli").length,
      skillFamilies: new Set(matrix.rows.filter((row) => row.surface === "skill").map((row) => row.id)).size,
      skillOperations: matrix.rows.filter((row) => row.surface === "skill").length,
      toolAdapters: new Set(matrix.rows.filter((row) => row.surface === "tool").map((row) => row.id)).size,
      toolOperations: matrix.rows.filter((row) => row.surface === "tool").length,
    });
  });

  it("fails when a newly registered leaf has no policy", () => {
    registerAll();
    const currentWorkspace = registeredCliOperations().filter((entry) => entry.command === "workspace");
    registerPorted("workspace", () => 0, {
      operations: [
        ...currentWorkspace,
        {
          command: "workspace",
          operation: "future-leaf",
          route: ["future-leaf"],
          canonicalCommand: "roll workspace future-leaf",
          supportsWorkspaceSelector: false,
        },
      ],
    });
    expect(() => buildRegisteredWorkspaceContextMatrix({
      cliInventory: registeredCliOperations().map((entry) => ({
        surface: "cli" as const,
        id: entry.command,
        operation: entry.operation,
        supportsWorkspaceSelector: entry.supportsWorkspaceSelector,
      })),
      skillIds: shippedSkillIds(),
      skillPolicies: skillContextPoliciesFromManifest(skillsManifest()),
    })).toThrow(/missing policy: cli:workspace:future-leaf/);
  });
});
