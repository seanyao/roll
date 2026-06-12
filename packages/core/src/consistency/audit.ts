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
  visualEvidence?: boolean;
  machineSkip?: boolean;
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
  /** Local publish-line drift: commits on main that have not reached origin/main. */
  localMainAhead?: number;
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

  // ── local-main-ahead: local main must never be a publish endpoint ─────────
  if ((s.localMainAhead ?? 0) > 0) {
    add(
      "local-main-ahead",
      "fail",
      "main",
      `local main is ahead of origin/main by ${s.localMainAhead} commit(s) with no PR-backed publish evidence — local main is not a delivery endpoint (FIX-252)`,
    );
  }

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
    } else if (probe.acMap && !(probe.visualEvidence ?? false) && !(probe.machineSkip ?? false)) {
      // FIX-270: owner-decreed iron rule — screenshot evidence (or an honestly
      // recorded machine capture skip) is a RELEASE BLOCKER, not advice. The
      // only bypass is a recorded owner waiver.
      add(
        "done-attest-no-visual",
        "fail",
        row.id,
        "Done acceptance evidence has a report/ac-map but no screenshot and no machine-generated capture skip — screenshot iron rule (FIX-270)",
      );
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

// ── US-DOSSIER-015: the six-dimension split of the gate audit ────────────────

/** The six reconciled dimensions (guide/en/consistency.md) + the proposed ⑦. */
export type ConsistencyDimension = "code-backlog" | "cards" | "docs" | "tests" | "bilingual" | "site";
export const CONSISTENCY_DIMENSIONS: readonly ConsistencyDimension[] = [
  "code-backlog",
  "cards",
  "docs",
  "tests",
  "bilingual",
  "site",
];

/**
 * Map an audit rule to its dimension. TOTAL by construction: an unknown rule
 * lands in ① code-backlog (the claims dimension) rather than vanishing — the
 * panel's per-dimension sum must STRICTLY equal the status line's f/w/?
 * (US-DOSSIER-015 AC2), so no finding may be unmapped.
 */
export function dimensionOfRule(rule: string): ConsistencyDimension {
  switch (rule) {
    case "done-no-merge":
    case "terminal-twin-missing":
    case "usage-missing":
    case "failure-count-mismatch":
      return "code-backlog";
    case "done-missing-attest":
    case "done-missing-screenshot":
    case "index-missing-live-card":
      return "cards";
    case "doc-gap":
    case "registry-drift":
      return "docs";
    case "test-gap":
      return "tests";
    case "bilingual-parity":
      return "bilingual";
    case "site-drift":
      return "site";
    default:
      return "code-backlog";
  }
}

export interface DimensionTally {
  fail: number;
  warn: number;
  unknown: number;
  /** Up to three finding subjects (drift-card handles) for drill-down chips. */
  subjects: string[];
}

/**
 * Fold findings into per-dimension tallies. Grandfathered findings are listed
 * elsewhere, never judged — they stay OUT of f/w/? (same contract as the
 * summary line), so the six rows sum exactly to the status line.
 */
export function tallyByDimension(findings: readonly AuditFinding[]): Record<ConsistencyDimension, DimensionTally> {
  const out = Object.fromEntries(
    CONSISTENCY_DIMENSIONS.map((d) => [d, { fail: 0, warn: 0, unknown: 0, subjects: [] as string[] }]),
  ) as Record<ConsistencyDimension, DimensionTally>;
  for (const f of findings) {
    if (f.severity === "grandfathered") continue;
    const dim = out[dimensionOfRule(f.rule)];
    if (f.severity === "fail") dim.fail += 1;
    else if (f.severity === "warn") dim.warn += 1;
    else dim.unknown += 1;
    if (dim.subjects.length < 3 && !dim.subjects.includes(f.subject)) dim.subjects.push(f.subject);
  }
  return out;
}
