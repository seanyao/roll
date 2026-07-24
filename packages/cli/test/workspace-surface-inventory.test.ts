import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { dispatch, registerPorted, registeredCliOperations } from "../src/bridge.js";
import { registerAll } from "../src/commands/index.js";
import { commandDecision, publicCommands } from "../src/lib/command-surface.js";
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

function routeLiterals(node: ts.Node): string[] {
  const aliases = new Set(["sub"]);
  const routes = new Set<string>();
  const visit = (current: ts.Node): void => {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)
      && current.initializer !== undefined && current.initializer.getText().includes("args[0]")) {
      aliases.add(current.name.text);
    }
    if (ts.isBinaryExpression(current)
      && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(current.operatorToken.kind)) {
      const pair: readonly [ts.Expression, ts.Expression] = [current.left, current.right];
      for (const [candidate, selector] of [pair, [pair[1], pair[0]] as const]) {
        if (!ts.isStringLiteral(candidate)) continue;
        const selectorText = selector.getText();
        if (selectorText === "args[0]" || (ts.isIdentifier(selector) && aliases.has(selector.text))) {
          if (candidate.text !== "" && !candidate.text.startsWith("-")) routes.add(candidate.text);
        }
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return [...routes].sort();
}

function registeredCallbackRoutes(source: string): Map<string, string[]> {
  const file = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = new Map<string, string[]>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "registerPorted") {
      const command = node.arguments[0];
      const handler = node.arguments[1];
      if (command !== undefined && ts.isStringLiteral(command)
        && handler !== undefined && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
        out.set(command.text, routeLiterals(handler));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

function exportedCommandRoutes(source: string, functionName: string): string[] {
  const file = ts.createSourceFile(`${functionName}.ts`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let routes: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) routes = routeLiterals(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return routes;
}

describe("US-WS-032 actual Workspace surface inventory", () => {
  it("enumerates CLI leaves from live registerPorted metadata", () => {
    registerAll();
    const inventory = registeredCliOperations();
    const families = [...new Set(inventory.map((entry) => entry.command))].sort();
    for (const command of publicCommands()) expect(families).toContain(command);
    for (const command of families) expect(commandDecision(command), `unclassified registered family: ${command}`).toBeDefined();
    expect(inventory).toContainEqual(expect.objectContaining({ command: "workspace", operation: "create" }));
    expect(inventory).not.toContainEqual(expect.objectContaining({ command: "workspace", operation: "init" }));
    expect(inventory).toContainEqual(expect.objectContaining({ command: "backlog", operation: "read", supportsWorkspaceSelector: true }));
    expect(inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: "release", operation: "consistency", route: ["consistency"] }),
      expect.objectContaining({ command: "doctor", operation: "repair-protection", route: ["repair-protection"] }),
      expect.objectContaining({ command: "agent", operation: "default", route: ["default"] }),
      expect.objectContaining({ command: "agent", operation: "set", route: ["set"] }),
      expect.objectContaining({ command: "agent", operation: "use", route: ["use"] }),
    ]));
    expect(inventory.some((entry) => entry.command === "ws")).toBe(false);
    const commandSources = readdirSync(join(root, "packages", "cli", "src", "commands"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(join(root, "packages", "cli", "src", "commands", name), "utf8"))
      .join("\n");
    expect(commandSources).not.toContain("--ws");
    const commandSurfaceSource = readFileSync(join(root, "packages", "cli", "src", "lib", "command-surface.ts"), "utf8");
    const registrationSource = readFileSync(join(root, "packages", "cli", "src", "commands", "index.ts"), "utf8");
    expect(commandSurfaceSource).not.toContain("PUBLIC_CLI_OPERATIONS");
    expect(registrationSource).not.toContain("cliOperations(");
  });

  it("accounts for literal callable routes in real public family dispatchers", () => {
    registerAll();
    const inventory = registeredCliOperations();
    const registeredFirstTokens = (command: string): Set<string> => new Set(
      inventory.filter((entry) => entry.command === command)
        .map((entry) => entry.route[0])
        .filter((token): token is string => token !== undefined),
    );
    const indexSource = readFileSync(join(root, "packages", "cli", "src", "commands", "index.ts"), "utf8");
    for (const [command, routes] of registeredCallbackRoutes(indexSource)) {
      if (!publicCommands().includes(command)) continue;
      for (const route of routes) expect(registeredFirstTokens(command).has(route), `${command} ${route}`).toBe(true);
    }
    for (const [command, fileName, functionName] of [
      ["workspace", "workspace.ts", "workspaceCommand"],
      ["delivery", "delivery.ts", "deliveryCommand"],
      ["agent", "agent.ts", "agentCommand"],
      ["doctor", "doctor.ts", "doctorCommand"],
      ["release", "release.ts", "releaseCommand"],
    ] as const) {
      const source = readFileSync(join(root, "packages", "cli", "src", "commands", fileName), "utf8");
      const ignored = new Set(command === "workspace" ? ["help", "init"] : command === "delivery" ? ["help"] : []);
      for (const route of exportedCommandRoutes(source, functionName)) {
        if (ignored.has(route)) continue;
        expect(registeredFirstTokens(command).has(route), `${command} ${route}`).toBe(true);
      }
    }
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
      cliRegistrations: registeredCliOperations(),
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

  it("fails when a newly registered callable route has no policy", async () => {
    registerAll();
    const currentWorkspace = registeredCliOperations().filter((entry) => entry.command === "workspace");
    registerPorted("workspace", (args) => args[0] === "future-leaf" ? 41 : 0, {
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
    await expect(dispatch(["workspace", "future-leaf"])).resolves.toEqual({ status: 41 });
    expect(() => buildRegisteredWorkspaceContextMatrix({
      cliRegistrations: registeredCliOperations(),
      skillIds: shippedSkillIds(),
      skillPolicies: skillContextPoliciesFromManifest(skillsManifest()),
    })).toThrow(/missing policy: cli:workspace:future-leaf/);
  });
});
