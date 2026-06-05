/**
 * FIX-207 — the acceptance-report (attest) gate.
 *
 * Skill 10.6 ("write the verification report") was a TEXT instruction: a cycle
 * could ship a high-quality delivery and silently skip the acceptance report
 * (observed 2026-06-06, cycle 20260606-033442 — FIX-199 merged with no ac-map,
 * no report, no self-score). Same failure mode FIX-150b fixed for peer review:
 * text has no teeth. This turns the requirement into a RUNTIME MECHANISM that
 * runs in every cycle's capture step, agent-agnostic:
 *
 *   actual delivery (commits ahead, real story)  AND  no fresh acceptance report
 *     ⇒ ALERT + an `attest:gate` event in events.ndjson (auditable forever).
 *
 * SOFT by default (record, don't block) — mirroring the peer gate: an unattended
 * cycle must not lose a legitimate delivery over a missing report. The escalation
 * hook is `loop_safety.attest_gate: hard` in policy.yaml: in HARD mode a delivery
 * without a fresh report is BLOCKED (the capture fails so the story is not marked
 * Done). Hard is strictly opt-in — production default stays soft.
 *
 * Freshness contract: the report at `.roll/verification/<storyId>/latest/report.html`
 * must have been written THIS cycle (mtime ≥ cycle start). A stale report left by
 * a previous delivery of the same story does not count as evidence.
 */
import { parsePolicy } from "@roll/core";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type AttestMode = "soft" | "hard";

/** The acceptance report a delivered story must produce (skill step 10.6). */
export function verificationReportPath(worktreeCwd: string, storyId: string): string {
  return join(worktreeCwd, ".roll", "verification", storyId, "latest", "report.html");
}

/**
 * Report exists as a file AND — when a cycle-start bound is given — was written
 * this cycle (mtime ≥ `sinceSec`). No bound ⇒ existence alone (graceful: callers
 * that can't determine cycle start still detect a wholly-absent report).
 */
export function verificationReportFresh(
  worktreeCwd: string,
  storyId: string,
  sinceSec?: number,
): boolean {
  if (storyId === "") return false;
  try {
    const st = statSync(verificationReportPath(worktreeCwd, storyId));
    if (!st.isFile()) return false;
    if (sinceSec === undefined) return true;
    return st.mtimeMs / 1000 >= sinceSec;
  } catch {
    return false; // missing path / stat error → not present
  }
}

/** Read `loop_safety.attest_gate` from `<repoCwd>/.roll/policy.yaml`; default soft. */
export function readAttestGateMode(repoCwd: string): AttestMode {
  try {
    const p = join(repoCwd, ".roll", "policy.yaml");
    if (!existsSync(p)) return "soft";
    return parsePolicy(readFileSync(p, "utf8")).loopSafety.attestGate === "hard" ? "hard" : "soft";
  } catch {
    return "soft"; // unreadable / unparseable policy → never escalate
  }
}

export interface AttestGateResult {
  verdict: "produced" | "skipped";
  mode: AttestMode;
  reasons: string[];
  /** true ONLY when mode==="hard" && verdict==="skipped" — the delivery is blocked. */
  blocked: boolean;
}

export interface AttestGateSinks {
  alert: (message: string) => void;
  event: (payload: { cycleId: string; verdict: "produced" | "skipped"; reasons: string[] }) => void;
}

/**
 * Run the gate for one delivered cycle. Pure decision + sink side-effects; never
 * throws. Returns the verdict so callers/tests can assert without the sinks.
 *
 * Call ONLY on an actual delivery (commits ahead + a real story) — an idle cycle
 * has nothing to attest. `produced` → event only; `skipped` → ALERT + event, and
 * `blocked` iff the policy is hard.
 */
export function runAttestGate(
  worktreeCwd: string,
  storyId: string,
  cycleId: string,
  mode: AttestMode,
  sinceSec: number | undefined,
  sinks: AttestGateSinks,
): AttestGateResult {
  try {
    if (verificationReportFresh(worktreeCwd, storyId, sinceSec)) {
      const reasons = ["fresh acceptance report present"];
      sinks.event({ cycleId, verdict: "produced", reasons });
      return { verdict: "produced", mode, reasons, blocked: false };
    }
    const reasons = [
      `no fresh acceptance report at .roll/verification/${storyId}/latest/report.html`,
    ];
    const blocked = mode === "hard";
    sinks.alert(
      `attest gate (${mode}): delivery without a fresh acceptance report (${storyId}) — cycle ${cycleId}` +
        (blocked ? " — BLOCKED (hard mode); story not marked Done" : ""),
    );
    sinks.event({ cycleId, verdict: "skipped", reasons });
    return { verdict: "skipped", mode, reasons, blocked };
  } catch {
    // gate must never fail the cycle by surprise — soft-fail to produced/silent.
    return { verdict: "produced", mode, reasons: [], blocked: false };
  }
}
