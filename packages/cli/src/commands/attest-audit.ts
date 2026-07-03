import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBacklog } from "@roll/core";
import { STATUS_MARKER } from "@roll/spec";
import { evidencePathsUnresolved, readAcMapEntries, verificationReportPath } from "../runner/attest-gate.js";

export interface AttestAuditIssue {
  storyId: string;
  missing: string[];
}

export function auditAcceptanceEvidence(projectCwd: string): AttestAuditIssue[] {
  const backlogPath = join(projectCwd, ".roll", "backlog.md");
  if (!existsSync(backlogPath)) return [];
  const done = parseBacklog(readFileSync(backlogPath, "utf8")).filter((row) => row.status.includes(STATUS_MARKER.done));
  const issues: AttestAuditIssue[] = [];
  for (const row of done) {
    const missing: string[] = [];
    if (!existsSync(verificationReportPath(projectCwd, row.id))) missing.push("report missing");
    const entries = readAcMapEntries(projectCwd, row.id);
    if (entries === null || entries.length === 0) missing.push("ac-map.json missing or empty");
    missing.push(...evidencePathsUnresolved(projectCwd, row.id));
    if (missing.length > 0) issues.push({ storyId: row.id, missing });
  }
  return issues;
}

export async function attestAuditCommand(args: string[], cwd = process.cwd()): Promise<number> {
  const json = args.includes("--json");
  const issues = auditAcceptanceEvidence(cwd);
  if (json) {
    process.stdout.write(`${JSON.stringify({ issues }, null, 2)}\n`);
    return issues.length === 0 ? 0 : 1;
  }
  if (issues.length === 0) {
    process.stdout.write("attest audit: no dangling evidence references found\n");
    return 0;
  }
  process.stdout.write("attest audit: dangling evidence references\n");
  for (const issue of issues) {
    process.stdout.write(`- ${issue.storyId}\n`);
    for (const missing of issue.missing) process.stdout.write(`  - ${missing}\n`);
  }
  return 1;
}
