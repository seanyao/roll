import { join } from "node:path";
import { ToolPolicyEngine } from "@roll/core";
import type { ToolDeclaration, ToolSandbox } from "@roll/spec";
import { BashTool, browserTools, fsTools, gitTools, githubTools, mcpTools, networkTools } from "@roll/infra";

export const TOOL_USAGE =
  "Usage: roll tool status\n" +
  "  Show registered tools and their effective policy state.\n" +
  "展示已注册工具及其有效 policy 状态。\n";

interface ToolRow {
  id: string;
  kind: string;
  enabled: boolean;
  timeout: string;
  limit: string;
  sandbox: string;
}

export async function toolCommand(args: string[]): Promise<number> {
  const sub = args[0] ?? "";
  if (sub === "" || sub === "help" || sub === "--help" || sub === "-h") {
    process.stdout.write(TOOL_USAGE);
    return 0;
  }
  if (sub !== "status") {
    process.stderr.write(`[roll] unknown 'roll tool' subcommand: ${sub}\n`);
    return 1;
  }
  const rows = await collectToolRows(process.cwd());
  process.stdout.write(renderToolRows(rows));
  return 0;
}

export async function collectToolRows(projectRoot: string): Promise<ToolRow[]> {
  const policy = new ToolPolicyEngine({ policyPath: join(projectRoot, ".roll", "policy.yaml") });
  const rows: ToolRow[] = [];
  for (const declaration of toolDeclarations(projectRoot)) {
    const effective = await policy.resolve(declaration.id, declaration.defaults);
    rows.push({
      id: String(declaration.id),
      kind: declaration.kind,
      enabled: effective.enabled,
      timeout: effective.timeoutMs === undefined ? "-" : String(effective.timeoutMs),
      limit: effective.maxInvocationsPerCycle === undefined ? "-" : String(effective.maxInvocationsPerCycle),
      sandbox: renderSandbox(effective.sandbox),
    });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

export function renderToolRows(rows: readonly ToolRow[]): string {
  const out = ["tool              kind        enabled  timeout  limit  sandbox"];
  for (const row of rows) {
    out.push([
      pad(row.id, 19),
      pad(row.kind, 12),
      pad(row.enabled ? "yes" : "no", 9),
      pad(row.timeout, 9),
      pad(row.limit, 7),
      row.sandbox,
    ].join(""));
  }
  return `${out.join("\n")}\n`;
}

function toolDeclarations(projectRoot: string): ToolDeclaration[] {
  const tools: Array<{ declaration: ToolDeclaration }> = [
    new BashTool(),
    ...browserTools(),
    ...fsTools(projectRoot),
    ...gitTools(),
    ...githubTools(),
    ...mcpTools(projectRoot),
    ...networkTools(),
  ];
  return tools.map((tool) => tool.declaration);
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
