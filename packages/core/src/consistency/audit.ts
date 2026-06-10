/**
 * US-TRUTH-002 — Shadow Consistency Audit (pure rules over snapshots).
 *
 * Quantifies real drift between the fact sources declared in US-TRUTH-000's
 * anchor registry (spec types/truth.ts) BEFORE anyone fixes by vibes:
 * backlog rows vs PR merge evidence, runs terminals vs cycle-branch PRs,
 * Done rows vs attest artifacts, delivered rows vs usage/cost, index vs live
 * cards, section counters vs each other, and the US-TRUTH-001 terminal twin.
 *
 * SHADOW contract: pure decisions only — no I/O, no ALERT, no status writes,
 * and the caller's exit code must not depend on drift. Severities:
 *
 *   fail          — an anchor violation past its grace window
 *   warn          — a derived view lagging or a softer obligation missed
 *   unknown       — evidence unavailable (gh down) or within convergence grace
 *   grandfathered — predates the schema epoch / pre-card era; listed, not red
 *
 * The cli gatherer (`roll consistency audit`) assembles the snapshot; rules
 * here never read the filesystem, git, or GitHub (US-TRUTH-002 AC5, and the
 * same purity bar US-TRUTH-003's selectors inherit).
 */
import { DEFAULT_GRACE_WINDOW_SEC } from "@roll/spec";

/** PR/merge evidence as the gatherer resolved it; absence in the map = probe
 *  did not resolve (→ unknown, never fail). */
export interface AuditPrEvidence {
  state: string;
  mergedAtSec?: number;
}

export interface AuditBacklogRow {
  id: string;
  /** The raw status cell (marker + annotations, e.g. "✅ Done · PR#10"). */
  status: string;
}

/** Attest artifact existence per story, as probed by the gatherer. A story
 *  absent from the map was NOT probed (pre-card era → grandfather lane). */
export interface AuditAttestProbe {
  report: boolean;
  acMap: boolean;
}

export interface AuditSnapshot {
  /** Audit wall-clock (epoch seconds) — injected, never Date.now() here. */
  nowSec: number;
  /** US-TRUTH-001 schema epoch: rows/cycles before it are grandfathered. */
  schemaEpochSec: number;
  /** Convergence grace (seconds); default from the anchor registry. */
  graceSec: number;
  backlog: AuditBacklogRow[];
  /** .roll/index.json story→epic map. */
  index: Record<string, string>;
  /** runs.jsonl rows, parsed leniently (opaque records). */
  runs: Array<Record<string, unknown>>;
  /** cycle ids that have a cycle:terminal event (US-TRUTH-001 twin). */
  terminalCycleIds: string[];
  /** story id → delivery-PR evidence (parsed from the Done row's PR#N). */
  prEvidence: Record<string, AuditPrEvidence>;
  /** cycle id → cycle-branch PR evidence (loop/cycle-<id>). */
  cycleBranchEvidence: Record<string, AuditPrEvidence>;
  /** story id → attest artifact probe. */
  attest: Record<string, AuditAttestProbe>;
  /** failure counts computed over the SAME window by the two bookkeepers. */
  runsFailedCount?: number;
  eventFailedCount?: number;
}

export type AuditSeverity = "fail" | "warn" | "unknown" | "grandfathered";

export interface AuditFinding {
  rule: string;
  severity: AuditSeverity;
  /** The drifting subject — a story id, cycle id, or counter name. */
  subject: string;
  detail: string;
}

export interface AuditReport {
  findings: AuditFinding[];
  summary: Record<AuditSeverity, number>;
}

/** A blank snapshot — tests and gatherers start here. */
export function emptyAuditSnapshot(nowSec: number, schemaEpochSec: number): AuditSnapshot {
  return {
    nowSec,
    schemaEpochSec,
    graceSec: DEFAULT_GRACE_WINDOW_SEC,
    backlog: [],
    index: {},
    runs: [],
    terminalCycleIds: [],
    prEvidence: {},
    cycleBranchEvidence: {},
    attest: {},
  };
}

const DONE_MARK = "✅";
/** Claim-shaped run statuses the backfill is responsible for (FIX-243/244). */
const CLAIM_STATUSES = new Set(["built", "published", "failed"]);
const DELIVERED_OUTCOMES = new Set(["delivered"]);

function rowStr(row: Record<string, unknown>, k: string): string {
  const v = row[k];
  return typeof v === "string" ? v : "";
}

function rowTsSec(row: Record<string, unknown>): number | null {
  const ts = rowStr(row, "ts");
  if (ts === "") return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

/** Run every audit rule over the snapshot. Never throws; malformed rows skip. */
export function runConsistencyAudit(s: AuditSnapshot): AuditReport {
  const findings: AuditFinding[] = [];
  const add = (rule: string, severity: AuditSeverity, subject: string, detail: string): void => {
    findings.push({ rule, severity, subject, detail });
  };

  // ── done-no-merge: a ✅ Done backlog row must have MERGED PR evidence ──────
  for (const row of s.backlog) {
    if (!row.status.includes(DONE_MARK)) continue;
    const hasPrAnnotation = /PR#\d+/.test(row.status);
    const ev = s.prEvidence[row.id];
    if (ev === undefined) {
      if (hasPrAnnotation) {
        add("done-no-merge", "unknown", row.id, `Done row carries ${/PR#\d+/.exec(row.status)?.[0] ?? "a PR"} but merge evidence could not be probed`);
      } else {
        add("done-no-merge", "grandfathered", row.id, "Done row predates PR-annotated delivery (pre-card era) — listed, not judged");
      }
      continue;
    }
    if (ev.state !== "MERGED") {
      add("done-no-merge", "fail", row.id, `backlog says Done but the delivery PR is ${ev.state} — backlog 是愿望, main 是真相 (story_delivery anchor)`);
    }
  }

  // ── merge-not-backfilled: claim-shaped run rows with MERGED branch PRs ─────
  for (const row of s.runs) {
    const cycleId = rowStr(row, "cycle_id");
    const status = rowStr(row, "status");
    if (cycleId === "" || !CLAIM_STATUSES.has(status)) continue;
    if (typeof row["merge_commit"] === "string" && row["merge_commit"] !== "") continue; // already credited
    const ev = s.cycleBranchEvidence[cycleId];
    if (ev === undefined || ev.state !== "MERGED") continue;
    const mergedAt = ev.mergedAtSec ?? 0;
    const withinGrace = s.nowSec - mergedAt < s.graceSec;
    add(
      "merge-not-backfilled",
      withinGrace ? "unknown" : "fail",
      cycleId,
      withinGrace
        ? `branch PR merged ${Math.round(s.nowSec - mergedAt)}s ago — within the ${s.graceSec}s convergence window`
        : `runs row still '${status}' although the cycle-branch PR merged — the 212711 incident shape (cycle_outcome anchor)`,
    );
  }

  // ── done-missing-attest: Done story owes acceptance evidence ───────────────
  for (const row of s.backlog) {
    if (!row.status.includes(DONE_MARK)) continue;
    const probe = s.attest[row.id];
    if (probe === undefined) {
      if (/PR#\d+/.test(row.status)) continue; // probed set is the gatherer's choice; un-probed annotated rows stay silent
      add("done-missing-attest", "grandfathered", row.id, "pre-card-era Done row — no card folder to probe");
      continue;
    }
    if (!probe.report) {
      add("done-missing-attest", "fail", row.id, `Done without an acceptance report${probe.acMap ? "" : " (no ac-map either)"} — attest_evidence anchor`);
    }
  }

  // ── usage-missing: delivered work must carry cost or an absent reason ─────
  for (const row of s.runs) {
    const cycleId = rowStr(row, "cycle_id");
    if (cycleId === "") continue;
    const outcome = rowStr(row, "outcome");
    if (!DELIVERED_OUTCOMES.has(outcome)) continue;
    if (typeof row["cost_usd"] === "number") continue;
    const ts = rowTsSec(row);
    const pre = ts !== null && ts < s.schemaEpochSec;
    add(
      "usage-missing",
      pre ? "grandfathered" : "warn",
      cycleId,
      pre
        ? "delivered before the cost-capture epoch (FIX-249) — listed, not judged"
        : "delivered with no cost/usage fields — the cost-blind-guardrail shape (usage_cost anchor)",
    );
  }

  // ── index-missing-live-card ────────────────────────────────────────────────
  for (const row of s.backlog) {
    if (s.index[row.id] === undefined) {
      add("index-missing-live-card", "warn", row.id, "live backlog row missing from .roll/index.json — regenerate (index_freshness anchor)");
    }
  }

  // ── failure-count-mismatch: two bookkeepers, one window ──────────────────
  if (s.runsFailedCount !== undefined && s.eventFailedCount !== undefined && s.runsFailedCount !== s.eventFailedCount) {
    add(
      "failure-count-mismatch",
      "warn",
      "failed-count",
      `runs.jsonl counts ${s.runsFailedCount} failed; events count ${s.eventFailedCount} over the same window — the 0-vs-14 panel shape (FIX-248)`,
    );
  }

  // ── terminal-twin-missing: US-TRUTH-001 write obligation ──────────────────
  const twins = new Set(s.terminalCycleIds);
  for (const row of s.runs) {
    const cycleId = rowStr(row, "cycle_id");
    if (cycleId === "" || twins.has(cycleId)) continue;
    const ts = rowTsSec(row);
    const pre = ts !== null && ts < s.schemaEpochSec;
    add(
      "terminal-twin-missing",
      pre ? "grandfathered" : "warn",
      cycleId,
      pre ? "cycle predates the terminal-event schema — grandfathered" : "post-epoch cycle wrote no cycle:terminal twin (US-TRUTH-001 AC5)",
    );
  }

  const summary: Record<AuditSeverity, number> = { fail: 0, warn: 0, unknown: 0, grandfathered: 0 };
  for (const f of findings) summary[f.severity] += 1;
  return { findings, summary };
}
