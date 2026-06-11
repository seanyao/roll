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
 * HARD by default: a delivery without dense, fresh acceptance evidence is
 * BLOCKED (the capture fails so the story is not marked Done). The temporary
 * migration hook is `loop_safety.attest_gate: soft` in policy.yaml.
 *
 * Freshness contract: the report at `.roll/verification/<storyId>/latest/report.html`
 * must have been written THIS cycle (mtime ≥ cycle start). A stale report left by
 * a previous delivery of the same story does not count as evidence.
 *
 * Content floor (US-ATTEST-012): freshness alone is mere "存在性". A fresh report
 * that is an EMPTY SHELL — parseable but with zero AC sections / no ac-map (the
 * FIX-214 case, where a heading naming another card stole all the AC) — is also
 * "skipped", not "produced". A real delivery's report carries ≥1 AC + an ac-map.
 */
import { acForStory, parsePolicy } from "@roll/core";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cardArchiveDir, reportFileName } from "../lib/archive.js";
import { evaluateSelfScoreGate } from "../lib/self-score.js";

export type AttestMode = "soft" | "hard";

/**
 * Report path candidates — the card folder ONLY
 * (`features/<epic>/<ID>/latest/<ID>-report.html`). The legacy
 * `verification/<ID>/` read-compat window closed with US-META-002c: the old
 * tree was migrated (002b) and deleted; nothing writes or reads it anymore.
 */
function reportCandidates(worktreeCwd: string, storyId: string): string[] {
  return [join(cardArchiveDir(worktreeCwd, storyId), "latest", reportFileName(storyId))];
}

/** ac-map candidates, same single-home rule. */
function acMapCandidates(worktreeCwd: string, storyId: string): string[] {
  return [join(cardArchiveDir(worktreeCwd, storyId), "ac-map.json")];
}

function storySpecPath(worktreeCwd: string, storyId: string): string | null {
  const featuresDir = join(worktreeCwd, ".roll", "features");
  try {
    for (const epic of readdirSync(featuresDir, { withFileTypes: true })) {
      if (!epic.isDirectory()) continue;
      const spec = join(featuresDir, epic.name, storyId, "spec.md");
      if (existsSync(spec)) return spec;
      const legacy = join(featuresDir, epic.name, `${storyId}.md`);
      if (existsSync(legacy)) return legacy;
    }
  } catch {
    return null;
  }
  return null;
}

/** Whether the story's spec carries an `**AC:**` checklist; null = spec not
 *  found / unreadable. Exported for the FIX-246 remediation trigger, which must
 *  share the gate's exact notion of "this delivery owes an ac-map". */
export function storyHasAcBlock(worktreeCwd: string, storyId: string): boolean | null {
  const spec = storySpecPath(worktreeCwd, storyId);
  if (spec === null) return null;
  try {
    return acForStory(readFileSync(spec, "utf8"), storyId, { fileOwned: true }).length > 0;
  } catch {
    return null;
  }
}

function storyRequiresScreenshot(worktreeCwd: string, storyId: string): boolean {
  const spec = storySpecPath(worktreeCwd, storyId);
  if (spec === null) return false;
  try {
    return /\b(CLI|web|UI|TUI)\b|界面|交互|截屏|截图|screenshot/i.test(readFileSync(spec, "utf8"));
  } catch {
    return false;
  }
}

/** The acceptance report a delivered story must produce (skill step 10.6) —
 *  the canonical NEW-layout path, used for messaging. */
export function verificationReportPath(worktreeCwd: string, storyId: string): string {
  return reportCandidates(worktreeCwd, storyId)[0] as string;
}

/** First candidate report that exists on disk, or null. */
function existingReport(worktreeCwd: string, storyId: string): string | null {
  for (const p of reportCandidates(worktreeCwd, storyId)) {
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/**
 * Report exists as a file AND — when a cycle-start bound is given — was written
 * this cycle (mtime ≥ `sinceSec`). No bound ⇒ existence alone (graceful: callers
 * that can't determine cycle start still detect a wholly-absent report). Either
 * archive layout counts (US-META-001 read-compat).
 */
export function verificationReportFresh(
  worktreeCwd: string,
  storyId: string,
  sinceSec?: number,
): boolean {
  if (storyId === "") return false;
  const p = existingReport(worktreeCwd, storyId);
  if (p === null) return false;
  try {
    const st = statSync(p);
    if (sinceSec === undefined) return true;
    return st.mtimeMs / 1000 >= sinceSec;
  } catch {
    return false;
  }
}

/**
 * US-ATTEST-012 content floor: a report can be fresh yet be an EMPTY SHELL —
 * parseable but carrying ZERO acceptance criteria (the FIX-214 case, where a
 * heading mentioning another card id stole all the AC, so attest rendered a
 * report with no AC sections). "存在性"过闸不等于"有内容". A delivery's report must
 * carry ≥1 rendered AC section AND an `ac-map.json` (the AI intent layer the
 * skill writes for every real delivery). Missing either ⇒ no content. Either
 * archive layout counts (US-META-001 read-compat).
 */
export function verificationReportHasContent(worktreeCwd: string, storyId: string): boolean {
  if (storyId === "") return false;
  const p = existingReport(worktreeCwd, storyId);
  if (p === null) return false;
  try {
    const html = readFileSync(p, "utf8");
    const hasMap = acMapCandidates(worktreeCwd, storyId).some((m) => existsSync(m));
    if (!hasMap) return false;
    const sections = [...html.matchAll(/<section class="ac\s+([^"]+)"[\s\S]*?<\/section>/g)];
    if (sections.length === 0) return false;
    let positiveWithEvidence = 0;
    for (const m of sections) {
      const cls = m[1] ?? "";
      const body = m[0] ?? "";
      if (!/\bs-(pass|partial|readonly)\b/.test(cls)) continue;
      if (!/(class="ev\b|class="shot\b|<figure class="shot\b)/.test(body)) return false;
      positiveWithEvidence += 1;
    }
    if (positiveWithEvidence === 0) return false;
    if (storyRequiresScreenshot(worktreeCwd, storyId)) {
      return /<figure class="shot\b|href="screenshots\/|src="screenshots\/|taken":false|skipped|honest-skip/i.test(html);
    }
    return true;
  } catch {
    return false;
  }
}

/** Read `loop_safety.attest_gate` from `<repoCwd>/.roll/policy.yaml`; default hard. */
export function readAttestGateMode(repoCwd: string): AttestMode {
  try {
    const p = join(repoCwd, ".roll", "policy.yaml");
    if (!existsSync(p)) return "hard";
    return parsePolicy(readFileSync(p, "utf8")).loopSafety.attestGate === "hard" ? "hard" : "soft";
  } catch {
    return "hard"; // unreadable / unparseable policy → fail closed
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
    if (storyHasAcBlock(worktreeCwd, storyId) === false) {
      const reasons = ["story has no AC block; acceptance report not required"];
      sinks.event({ cycleId, verdict: "produced", reasons });
      return { verdict: "produced", mode, reasons, blocked: false };
    }
    const fresh = verificationReportFresh(worktreeCwd, storyId, sinceSec);
    // US-ATTEST-012: freshness alone is "存在性" — a fresh empty shell (zero AC /
    // no ac-map, the FIX-214 case) does NOT count as a produced report.
    if (fresh && verificationReportHasContent(worktreeCwd, storyId)) {
      const score = evaluateSelfScoreGate(worktreeCwd, storyId);
      if (score.status === "pass") {
        const reasons = ["fresh acceptance report present", score.reason];
        sinks.event({ cycleId, verdict: "produced", reasons });
        return { verdict: "produced", mode, reasons, blocked: false };
      }
      const reasons = [score.reason];
      const blocked = mode === "hard";
      sinks.alert(
        `attest gate (${mode}): self-score gate failed (${storyId}) — ${score.reason} — cycle ${cycleId}` +
          (blocked ? " — BLOCKED (hard mode); story not marked Done" : ""),
      );
      sinks.event({ cycleId, verdict: "skipped", reasons });
      return { verdict: "skipped", mode, reasons, blocked };
    }
    const reasons = [
      fresh
        ? `acceptance report at .roll/features/<epic>/${storyId}/latest/${storyId}-report.html is an empty shell (no AC content / no ac-map)`
        : `no fresh acceptance report for ${storyId} (checked card archive + legacy verification paths)`,
    ];
    const blocked = mode === "hard";
    const lead = fresh
      ? `delivery with an empty-shell acceptance report (no AC content / no ac-map)`
      : `delivery without a fresh acceptance report`;
    sinks.alert(
      `attest gate (${mode}): ${lead} (${storyId}) — cycle ${cycleId}` +
        (blocked ? " — BLOCKED (hard mode); story not marked Done" : ""),
    );
    sinks.event({ cycleId, verdict: "skipped", reasons });
    return { verdict: "skipped", mode, reasons, blocked };
  } catch {
    // gate must never fail the cycle by surprise — soft-fail to produced/silent.
    return { verdict: "produced", mode, reasons: [], blocked: false };
  }
}
