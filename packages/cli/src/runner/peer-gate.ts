/**
 * FIX-150b — the peer HARD-trigger gate.
 *
 * v2's peer review was a skill-text suggestion: nothing enforced it, non-claude
 * cycle agents never saw it, and skips left zero trace (owner audit 2026-05-31:
 * memory said 3-4+ consults, disk had 2). This module turns the trigger into a
 * RUNTIME MECHANISM that runs inside every cycle's capture step, agent-agnostic:
 *
 *   high-complexity delivery  AND  no peer evidence
 *     ⇒ ALERT + a `peer` gate event in events.ndjson (auditable forever).
 *
 * The gate is SOFT by default (record, don't block): an unattended cycle that
 * hard-fails on a missing peer would deadlock deliveries on flaky peers (the
 * timebox lesson — peers do hang). `loop_safety.peer_gate: hard` in policy.yaml
 * is the escalation hook (consumed by a later card; the verdict string is
 * already emitted here so the audit trail is complete either way).
 *
 * Complexity is deterministic and cheap — `git diff --name-only` of the cycle
 * branch vs origin/main in the worktree:
 *   - more than 3 files changed, or
 *   - 2+ distinct `packages/<name>` touched (cross-module), or
 *   - any high-risk path (CI workflows, infra git/github/process seams).
 *
 * Peer evidence contract (FIX-150a alignment): a per-cycle evidence file at
 * `<rt>/peer/cycle-<cycleId>.*` (md/json), written by the roll-peer skill or
 * any consult wrapper. Presence = consulted; absence on a high-complexity
 * delivery = "skipped" verdict.
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ComplexityVerdict {
  high: boolean;
  /** Human-readable reasons (empty when not high). */
  reasons: string[];
  files: string[];
}

/** High-risk paths: changes here always warrant a second pair of eyes. */
const HIGH_RISK = [/^\.github\/workflows\//, /^packages\/infra\/src\/(git|github|process)\.ts$/];

/** Pure classifier — exported for table-driven tests. */
export function assessComplexity(files: string[]): ComplexityVerdict {
  const reasons: string[] = [];
  if (files.length > 3) reasons.push(`${files.length} files (>3)`);
  const pkgs = new Set<string>();
  for (const f of files) {
    const m = /^packages\/([^/]+)\//.exec(f);
    if (m?.[1] !== undefined) pkgs.add(m[1]);
  }
  if (pkgs.size >= 2) reasons.push(`cross-module: ${[...pkgs].sort().join(",")}`);
  const risky = files.filter((f) => HIGH_RISK.some((re) => re.test(f)));
  if (risky.length > 0) reasons.push(`high-risk: ${risky.join(",")}`);
  return { high: reasons.length > 0, reasons, files };
}

/** Changed files of the cycle branch vs origin/main (worktree cwd). */
export async function cycleChangedFiles(worktreeCwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--name-only", "origin/main...HEAD"],
      { cwd: worktreeCwd, encoding: "utf8" },
    );
    return stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  } catch {
    return []; // no refs / not a repo → gate stays silent (never fails a cycle)
  }
}

/** Evidence: any `<rt>/peer/cycle-<cycleId>.*` file. */
export function peerEvidencePresent(runtimeDir: string, cycleId: string): boolean {
  const dir = join(runtimeDir, "peer");
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((f) => f.startsWith(`cycle-${cycleId}.`));
  } catch {
    return false;
  }
}

export interface PeerGateResult {
  verdict: "consulted" | "skipped" | "not-required";
  reasons: string[];
}

export interface PeerGateSinks {
  alert: (message: string) => void;
  event: (payload: { cycleId: string; verdict: string; reasons: string[] }) => void;
}

/**
 * Run the gate for one cycle. Pure decision + sink side-effects; never throws.
 * Returns the verdict so callers/tests can assert without reading the sinks.
 */
export async function runPeerGate(
  worktreeCwd: string,
  runtimeDir: string,
  cycleId: string,
  sinks: PeerGateSinks,
): Promise<PeerGateResult> {
  try {
    const files = await cycleChangedFiles(worktreeCwd);
    const cx = assessComplexity(files);
    if (!cx.high) return { verdict: "not-required", reasons: [] };
    if (peerEvidencePresent(runtimeDir, cycleId)) {
      sinks.event({ cycleId, verdict: "consulted", reasons: cx.reasons });
      return { verdict: "consulted", reasons: cx.reasons };
    }
    sinks.alert(
      `peer gate: high-complexity delivery without peer evidence (${cx.reasons.join("; ")}) — cycle ${cycleId}`,
    );
    sinks.event({ cycleId, verdict: "skipped", reasons: cx.reasons });
    return { verdict: "skipped", reasons: cx.reasons };
  } catch {
    return { verdict: "not-required", reasons: [] }; // gate must never fail the cycle
  }
}
