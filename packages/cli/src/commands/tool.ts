import { join } from "node:path";
import { deriveToolReadiness, ToolPolicyEngine, type ToolRequirementResolver } from "@roll/core";
import type { ToolDeclaration, ToolReadinessStatus, ToolSandbox } from "@roll/spec";
import { collectBuiltinToolDeclarations } from "../lib/builtin-tool-declarations.js";
import { resolveRequirement } from "../lib/external-tools.js";

export const TOOL_USAGE =
  "Usage: roll tool status\n" +
  "  Show registered tools, effective policy state, and requirement readiness.\n" +
  "  roll tool schema <tool-id>\n" +
  "  Show input/output parameter contract (JSON Schema).\n" +
  "展示已注册工具、有效 policy 状态与 requirement 就绪度。\n";

interface ToolRow {
  id: string;
  kind: string;
  enabled: boolean;
  readiness: ToolReadinessStatus;
  timeout: string;
  limit: string;
  sandbox: string;
  params: string;
}

export async function toolCommand(args: string[]): Promise<number> {
  const sub = args[0] ?? "";
  const projectRoot = process.cwd();
  if (sub === "" || sub === "help" || sub === "--help" || sub === "-h") {
    process.stdout.write(TOOL_USAGE);
    return 0;
  }
  if (sub === "schema") {
    const toolId = args[1] ?? "";
    if (toolId === "") {
      process.stderr.write("[roll] missing tool-id for 'roll tool schema'\n");
      return 1;
    }
    const declarations = collectBuiltinToolDeclarations(projectRoot);
    const declaration = declarations.find((d) => String(d.id) === toolId);
    if (declaration === undefined) {
      process.stderr.write(`[roll] tool not found: ${toolId}\n`);
      return 1;
    }
    process.stdout.write(renderToolSchema(declaration));
    return 0;
  }
  if (sub !== "status") {
    process.stderr.write(`[roll] unknown 'roll tool' subcommand: ${sub}\n`);
    return 1;
  }
  const rows = await collectToolRows(projectRoot);
  process.stdout.write(renderToolRows(rows));
  return 0;
}

export async function collectToolRows(projectRoot: string, requirementResolver: ToolRequirementResolver = resolveRequirement): Promise<ToolRow[]> {
  const policy = new ToolPolicyEngine({ policyPath: join(projectRoot, ".roll", "policy.yaml") });
  const rows: ToolRow[] = [];
  for (const declaration of collectBuiltinToolDeclarations(projectRoot)) {
    const effective = await policy.resolve(declaration.id, declaration.defaults);
    const readiness = deriveToolReadiness(declaration, requirementResolver);
    const paramCount = paramCountOf(declaration);
    rows.push({
      id: String(declaration.id),
      kind: declaration.kind,
      enabled: effective.enabled,
      readiness: readiness.status,
      timeout: effective.timeoutMs === undefined ? "-" : String(effective.timeoutMs),
      limit: effective.maxInvocationsPerCycle === undefined ? "-" : String(effective.maxInvocationsPerCycle),
      sandbox: renderSandbox(effective.sandbox),
      params: paramCount,
    });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

export function renderToolRows(rows: readonly ToolRow[]): string {
  const out = ["tool              kind        enabled  readiness    timeout  limit  params  sandbox"];
  for (const row of rows) {
    out.push([
      pad(row.id, 19),
      pad(row.kind, 12),
      pad(row.enabled ? "yes" : "no", 9),
      pad(row.readiness, 13),
      pad(row.timeout, 9),
      pad(row.limit, 7),
      pad(row.params, 8),
      row.sandbox,
    ].join(""));
  }
  return `${out.join("\n")}\n`;
}

function renderSandbox(sandbox: ToolSandbox | undefined): string {
  if (sandbox === undefined) return "-";
  const parts: string[] = [];
  if (sandbox.allowedPaths !== undefined) parts.push(`allowedPaths=${sandbox.allowedPaths.join("|")}`);
  if (sandbox.blockedCommands !== undefined) parts.push(`blockedCommands=${sandbox.blockedCommands.join("|")}`);
  if (sandbox.hardTimeoutSec !== undefined) parts.push(`hardTimeoutSec=${sandbox.hardTimeoutSec}`);
  if (sandbox.allowedOrigins !== undefined) parts.push(`allowedOrigins=${sandbox.allowedOrigins.join("|")}`);
  if (sandbox.headlessOnly !== undefined) parts.push(`headlessOnly=${sandbox.headlessOnly}`);
  if (sandbox.maxOutputBytes !== undefined) parts.push(`maxOutputBytes=${sandbox.maxOutputBytes}`);
  if (sandbox.network !== undefined) parts.push(`network=${sandbox.network}`);
  return parts.length === 0 ? "-" : parts.join(",");
}

function pad(value: string, width: number): string {
  return value.padEnd(width, " ");
}

function paramCountOf(declaration: ToolDeclaration): string {
  const schema = declaration.inputSchema;
  if (schema === undefined) return "0";
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  return props === undefined ? "0" : String(Object.keys(props).length);
}

export function renderToolSchema(declaration: ToolDeclaration): string {
  const lines: string[] = [`${String(declaration.id)} (${declaration.kind}) — ${declaration.title}`];
  lines.push("");
  lines.push("INPUT");
  lines.push("-----");
  lines.push(JSON.stringify(declaration.inputSchema, null, 2));
  lines.push("");
  lines.push("OUTPUT");
  lines.push("------");
  lines.push(JSON.stringify(declaration.outputSchema, null, 2));
  lines.push("");
  return lines.join("\n");
}
