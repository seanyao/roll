import { deriveToolReadiness, type ToolRequirementResolver } from "@roll/core";
import type { ToolReadinessStatus } from "@roll/spec";
import { collectBuiltinToolDeclarations } from "./builtin-tool-declarations.js";
import { resolveRequirement } from "./external-tools.js";

export interface ToolReadinessDoctorRow {
  id: string;
  kind: string;
  status: ToolReadinessStatus;
  detail: string;
  repairCommands: readonly string[];
}

export function collectToolReadinessDoctorRows(
  projectRoot: string,
  requirementResolver: ToolRequirementResolver = resolveRequirement,
): ToolReadinessDoctorRow[] {
  return collectBuiltinToolDeclarations(projectRoot)
    .map((declaration) => {
      const readiness = deriveToolReadiness(declaration, requirementResolver);
      return {
        id: String(declaration.id),
        kind: declaration.kind,
        status: readiness.status,
        detail: readiness.detail ?? "",
        repairCommands: readiness.repairCommands ?? [],
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function renderToolReadinessDoctorSection(rows: readonly ToolReadinessDoctorRow[]): string[] {
  if (rows.length === 0) return [];
  const lines = ["", "Tool readiness", "工具就绪度", ""];
  for (const row of rows) {
    lines.push(`  ${statusMarker(row.status)} ${row.id} (${row.kind}) — ${row.status}`);
    if (row.detail !== "") lines.push(`    ${row.detail}`);
    for (const command of row.repairCommands) lines.push(`    fix: ${command}`);
  }
  return lines;
}

function statusMarker(status: ToolReadinessStatus): string {
  if (status === "available") return "✓";
  if (status === "degraded") return "~";
  return "−";
}
