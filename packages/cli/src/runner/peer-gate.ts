/**
 * FIX-150b / FIX-293 — the peer HARD-trigger gate.
 *
 * v2's peer review was a skill-text suggestion: nothing enforced it, non-claude
 * cycle agents never saw it, and skips left zero trace (owner audit 2026-05-31:
 * memory said 3-4+ consults, disk had 2). This module turns the trigger into a
 * RUNTIME MECHANISM that runs inside every cycle's capture step, agent-agnostic:
 *
 *   high-complexity delivery  AND  no peer evidence
 *     ⇒ ALERT + a `peer:gate` event in events.ndjson (auditable forever).
 *
 * FIX-293 — the gate now has TEETH. It used to be SOFT (record, don't block) and
 * its verdict was DISCARDED by the executor, so a high-complexity cycle with NO
 * peer review still silently fell back to self-score and flipped the card Done —
 * degrading the standard exactly when peer review matters most (FIX-284). The
 * owner decision: a high-complexity delivery with no peer evidence MUST NOT
 * self-score. The gate is now HARD by default — it BLOCKS the delivery and the
 * executor RE-ATTEMPTS the peer consultation ONCE (bounded; the existing peer
 * 30s hard timeout is respected so a flaky peer like pi can't death-spiral the
 * cycle). If the retry produces evidence → proceed; if it still yields none →
 * stay blocked, escalate via ALERT, and the cycle ends NOT-Done.
 *
 * `loop_safety.peer_gate: soft` in policy.yaml keeps the old record-only
 * behaviour for an explicit migration window; absent ⇒ hard (the owner default).
 *
 * Complexity is deterministic and cheap — `git diff --name-only` of the cycle
 * branch vs origin/main in the worktree:
 *   - more than 3 files changed, or
 *   - 2+ distinct `packages/<name>` touched (cross-module), or
 *   - any high-risk path (CI workflows, infra git/github/process seams).
 *
 * Peer evidence contract (FIX-150a alignment): a per-cycle evidence file at
 * `<rt>/peer/cycle-<cycleId>.*` (md/json), written by the roll-peer skill, the
 * pairing gate, or any consult wrapper. Presence = consulted; absence on a
 * high-complexity delivery = "skipped" verdict.
 */
import { parsePolicy } from "@roll/core";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

export type PeerGateMode = "soft" | "hard";

export interface PeerGateResult {
  verdict: "consulted" | "skipped" | "not-required";
  mode: PeerGateMode;
  reasons: string[];
  /** true ONLY when mode==="hard" && verdict==="skipped" — the delivery is
   *  blocked (high-complexity work shipped with no peer review). The executor
   *  consumes this: it re-attempts the consult once and, if still blocked, fails
   *  the capture so the story is NOT marked Done. */
  blocked: boolean;
}

export interface PeerGateSinks {
  alert: (message: string) => void;
  event: (payload: { cycleId: string; verdict: string; reasons: string[] }) => void;
}

/** Read `loop_safety.peer_gate` from `<repoCwd>/.roll/policy.yaml`; default hard.
 *  FIX-293: the owner default is hard (block + retry); an explicit `soft` keeps
 *  the legacy record-only behaviour. Mirrors {@link readAttestGateMode}. */
export function readPeerGateMode(repoCwd: string): PeerGateMode {
  try {
    const p = join(repoCwd, ".roll", "policy.yaml");
    if (!existsSync(p)) return "hard";
    return parsePolicy(readFileSync(p, "utf8")).loopSafety.peerGate === "soft" ? "soft" : "hard";
  } catch {
    return "hard"; // unreadable / unparseable policy → fail closed (block)
  }
}

/**
 * Run the gate for one cycle. Pure decision + sink side-effects; never throws.
 * Returns the verdict + `blocked` so callers/tests can assert without the sinks.
 *
 * FIX-293: when `mode === "hard"` (the default), a high-complexity delivery with
 * no peer evidence is `blocked`. The soft mode records the same `skipped` verdict
 * but never blocks (explicit migration window).
 */
export async function runPeerGate(
  worktreeCwd: string,
  runtimeDir: string,
  cycleId: string,
  mode: PeerGateMode,
  sinks: PeerGateSinks,
): Promise<PeerGateResult> {
  try {
    const files = await cycleChangedFiles(worktreeCwd);
    const cx = assessComplexity(files);
    if (!cx.high) return { verdict: "not-required", mode, reasons: [], blocked: false };
    if (peerEvidencePresent(runtimeDir, cycleId)) {
      sinks.event({ cycleId, verdict: "consulted", reasons: cx.reasons });
      return { verdict: "consulted", mode, reasons: cx.reasons, blocked: false };
    }
    const blocked = mode === "hard";
    sinks.alert(
      `peer gate (${mode}): high-complexity work without peer review (${cx.reasons.join("; ")}) — cycle ${cycleId}` +
        (blocked ? " — retrying the consult; story not marked Done unless peer evidence is produced" : ""),
    );
    sinks.event({ cycleId, verdict: "skipped", reasons: cx.reasons });
    return { verdict: "skipped", mode, reasons: cx.reasons, blocked };
  } catch {
    return { verdict: "not-required", mode, reasons: [], blocked: false }; // gate must never fail the cycle by surprise
  }
}
