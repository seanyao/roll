import { existsSync } from "node:fs";
import { STATUS_MARKER } from "@roll/spec";
import { evidencePathsUnresolved, readAcMapEntries, verificationReportPath } from "./attest-gate.js";

export interface DoneGuardEvidence {
  mergedToMain: boolean;
}

export interface DoneGuardDeps {
  markStatus: (projectCwd: string, id: string, status: string) => void;
  alert?: (message: string) => void;
}

export interface DoneGuardResult {
  ok: boolean;
  missing: string[];
}

export function acceptanceEvidenceGaps(projectCwd: string, id: string): string[] {
  const gaps: string[] = [];
  const report = verificationReportPath(projectCwd, id);
  if (!existsSync(report)) gaps.push(`report missing: ${report}`);
  const entries = readAcMapEntries(projectCwd, id);
  if (entries === null || entries.length === 0) {
    gaps.push("ac-map.json missing or empty");
  } else {
    const claimed = entries.filter((entry) => entry.status === "claimed").map((entry) => entry.ac ?? "?");
    if (claimed.length > 0) gaps.push(`claimed evidence status: ${claimed.join(", ")}`);
  }
  gaps.push(...evidencePathsUnresolved(projectCwd, id));
  return gaps;
}

export function markDoneGuarded(
  projectCwd: string,
  id: string,
  evidence: DoneGuardEvidence,
  deps: DoneGuardDeps,
): DoneGuardResult {
  const missing = [
    ...(evidence.mergedToMain ? [] : ["merge not confirmed on main"]),
    ...acceptanceEvidenceGaps(projectCwd, id),
  ];
  if (missing.length > 0) {
    deps.alert?.(`Done guard rejected ${id}: ${missing.join(", ")}`);
    return { ok: false, missing };
  }
  deps.markStatus(projectCwd, id, STATUS_MARKER.done);
  return { ok: true, missing: [] };
}
