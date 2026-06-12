/**
 * US-TRUTH-002 — Shadow Consistency Audit (pure rules).
 *
 * The audit quantifies REAL drift before anyone fixes by vibes. Rules consume
 * a snapshot (no I/O here — the cli command gathers), classify into
 * fail / warn / unknown / grandfathered, and never throw. The fixtures below
 * are the five dated incidents declared in US-TRUTH-000's anchor registry —
 * the same cases US-TRUTH-003 freezes its selectors on.
 */
import { describe, expect, it } from "vitest";
import {
  emptyAuditSnapshot,
  runConsistencyAudit,
  type AuditSnapshot,
} from "../src/index.js";

/** Schema epoch for these tests: 2026-06-11T00:00:00Z. */
const EPOCH = Date.UTC(2026, 5, 11) / 1000;
const NOW = EPOCH + 86400; // a day later — outside every grace window

function snap(over: Partial<AuditSnapshot>): AuditSnapshot {
  return { ...emptyAuditSnapshot(NOW, EPOCH), ...over };
}

describe("rule done-no-merge — backlog Done is a wish; merge evidence is the truth", () => {
  it("Done row + OPEN PR → fail (premature Done, the FIX-211/235 family)", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-A-001", status: "✅ Done · PR#10" }],
        prEvidence: { "US-A-001": { state: "OPEN" } },
      }),
    );
    expect(r.findings).toContainEqual(
      expect.objectContaining({ rule: "done-no-merge", severity: "fail", subject: "US-A-001" }),
    );
  });

  it("Done row + MERGED PR → no finding", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-A-002", status: "✅ Done · PR#11" }],
        prEvidence: { "US-A-002": { state: "MERGED", mergedAtSec: EPOCH } },
      }),
    );
    expect(r.findings.filter((f) => f.rule === "done-no-merge")).toHaveLength(0);
  });

  it("probe unavailable → unknown, never fail (gh down ≠ not merged)", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-A-003", status: "✅ Done · PR#12" }],
        prEvidence: {}, // probe did not resolve
      }),
    );
    expect(r.findings).toContainEqual(
      expect.objectContaining({ rule: "done-no-merge", severity: "unknown", subject: "US-A-003" }),
    );
  });

  it("Done row with no PR annotation and no runs trace → grandfathered (pre-card era)", () => {
    const r = runConsistencyAudit(snap({ backlog: [{ id: "US-OLD-1", status: "✅ Done" }] }));
    expect(r.findings).toContainEqual(
      expect.objectContaining({ rule: "done-no-merge", severity: "grandfathered", subject: "US-OLD-1" }),
    );
  });
});

describe("rule merge-not-backfilled — the 212711 incident (failed row, merged PR)", () => {
  it("failed runs row whose cycle branch PR MERGED past grace → fail", () => {
    const r = runConsistencyAudit(
      snap({
        runs: [{ cycle_id: "20260610-212711-40684", status: "failed", outcome: "failed", ts: iso(EPOCH + 100) }],
        cycleBranchEvidence: { "20260610-212711-40684": { state: "MERGED", mergedAtSec: EPOCH + 200 } },
      }),
    );
    expect(r.findings).toContainEqual(
      expect.objectContaining({
        rule: "merge-not-backfilled",
        severity: "fail",
        subject: "20260610-212711-40684",
      }),
    );
  });

  it("within the grace window after merge → unknown (backfill simply hasn't run yet)", () => {
    const r = runConsistencyAudit(
      snap({
        nowSec: EPOCH + 250 + 60, // merged 60s ago; grace 3600
        runs: [{ cycle_id: "C-FRESH", status: "published", outcome: "delivered", ts: iso(EPOCH + 100) }],
        cycleBranchEvidence: { "C-FRESH": { state: "MERGED", mergedAtSec: EPOCH + 250 } },
      }),
    );
    expect(r.findings).toContainEqual(
      expect.objectContaining({ rule: "merge-not-backfilled", severity: "unknown", subject: "C-FRESH" }),
    );
  });

  it("merged row already credited → no finding", () => {
    const r = runConsistencyAudit(
      snap({
        runs: [{ cycle_id: "C-OK", status: "merged", outcome: "delivered", merge_commit: "abc", ts: iso(EPOCH + 100) }],
        cycleBranchEvidence: { "C-OK": { state: "MERGED", mergedAtSec: EPOCH } },
      }),
    );
    expect(r.findings.filter((f) => f.rule === "merge-not-backfilled")).toHaveLength(0);
  });
});

describe("rule done-missing-attest — Done with no acceptance evidence", () => {
  it("Done story with no report → fail; pre-card-era → grandfathered", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [
          { id: "FIX-900", status: "✅ Done · PR#13" },
          { id: "US-ANCIENT", status: "✅ Done" },
        ],
        prEvidence: {
          "FIX-900": { state: "MERGED", mergedAtSec: EPOCH },
        },
        attest: { "FIX-900": { report: false, acMap: false } }, // probed, absent
      }),
    );
    expect(r.findings).toContainEqual(
      expect.objectContaining({ rule: "done-missing-attest", severity: "fail", subject: "FIX-900" }),
    );
    const ancient = r.findings.filter((f) => f.subject === "US-ANCIENT" && f.rule === "done-missing-attest");
    expect(ancient.every((f) => f.severity === "grandfathered")).toBe(true);
  });

  it("FIX-270: Done story with report/ac-map but no screenshot or machine skip FAILS (iron rule)", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "FIX-TEXT", status: "✅ Done · PR#14 · evidence" }],
        prEvidence: { "FIX-TEXT": { state: "MERGED", mergedAtSec: EPOCH } },
        attest: { "FIX-TEXT": { report: true, acMap: true } },
      }),
    );
    expect(r.findings).toContainEqual(
      expect.objectContaining({ rule: "done-attest-no-visual", severity: "fail", subject: "FIX-TEXT" }),
    );
  });

  it("FIX-270: an honestly recorded machine capture skip keeps the exemption lane open", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "FIX-HEADLESS", status: "✅ Done · PR#15 · evidence" }],
        prEvidence: { "FIX-HEADLESS": { state: "MERGED", mergedAtSec: EPOCH } },
        attest: { "FIX-HEADLESS": { report: true, acMap: true, machineSkip: true } },
      }),
    );
    expect(r.findings.filter((f) => f.rule === "done-attest-no-visual")).toEqual([]);
  });

  it("FIX-270: screenshot evidence present → no finding", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "FIX-SHOT", status: "✅ Done · PR#16 · evidence" }],
        prEvidence: { "FIX-SHOT": { state: "MERGED", mergedAtSec: EPOCH } },
        attest: { "FIX-SHOT": { report: true, acMap: true, visualEvidence: true } },
      }),
    );
    expect(r.findings.filter((f) => f.rule === "done-attest-no-visual")).toEqual([]);
  });
});

describe("rule usage-missing — the cost-blind-guardrail incident", () => {
  it("post-epoch delivered row without cost fields → warn; pre-epoch → grandfathered", () => {
    const r = runConsistencyAudit(
      snap({
        runs: [
          { cycle_id: "C-NEW", status: "done", outcome: "delivered", ts: iso(EPOCH + 500) },
          { cycle_id: "C-PRE", status: "done", outcome: "delivered", ts: iso(EPOCH - 500) },
        ],
      }),
    );
    expect(r.findings).toContainEqual(
      expect.objectContaining({ rule: "usage-missing", severity: "warn", subject: "C-NEW" }),
    );
    expect(r.findings).toContainEqual(
      expect.objectContaining({ rule: "usage-missing", severity: "grandfathered", subject: "C-PRE" }),
    );
  });

  it("a row with cost fields → no finding", () => {
    const r = runConsistencyAudit(
      snap({
        runs: [{ cycle_id: "C-COSTED", status: "published", outcome: "delivered", cost_usd: 0.1, ts: iso(EPOCH + 500) }],
      }),
    );
    expect(r.findings.filter((f) => f.rule === "usage-missing")).toHaveLength(0);
  });
});

describe("rule index-missing-live-card — index must map every live card", () => {
  it("backlog row absent from index → warn", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-LIVE-1", status: "📋 Todo" }],
        index: {},
      }),
    );
    expect(r.findings).toContainEqual(
      expect.objectContaining({ rule: "index-missing-live-card", severity: "warn", subject: "US-LIVE-1" }),
    );
  });
});

describe("rule failure-count-mismatch — sections must agree on the same window", () => {
  it("runs failed ≠ events failed → warn with both numbers", () => {
    const r = runConsistencyAudit(snap({ runsFailedCount: 14, eventFailedCount: 0 }));
    const f = r.findings.find((x) => x.rule === "failure-count-mismatch");
    expect(f?.severity).toBe("warn");
    expect(f?.detail).toContain("14");
    expect(f?.detail).toContain("0");
  });
});

describe("rule terminal-twin-missing — US-TRUTH-001 grandfather boundary", () => {
  it("post-epoch run with no cycle:terminal event → warn; pre-epoch → grandfathered", () => {
    const r = runConsistencyAudit(
      snap({
        runs: [
          { cycle_id: "C-NEW2", status: "failed", outcome: "failed", ts: iso(EPOCH + 700) },
          { cycle_id: "C-PRE2", status: "failed", outcome: "failed", ts: iso(EPOCH - 700) },
        ],
        terminalCycleIds: [],
      }),
    );
    expect(r.findings).toContainEqual(
      expect.objectContaining({ rule: "terminal-twin-missing", severity: "warn", subject: "C-NEW2" }),
    );
    expect(r.findings).toContainEqual(
      expect.objectContaining({ rule: "terminal-twin-missing", severity: "grandfathered", subject: "C-PRE2" }),
    );
  });
});

describe("rule local-main-ahead — FIX-252 local main is not a publish endpoint", () => {
  it("local main ahead of origin/main → fail-level drift", () => {
    const r = runConsistencyAudit(snap({ localMainAhead: 2 }));
    expect(r.findings).toContainEqual(
      expect.objectContaining({ rule: "local-main-ahead", severity: "fail", subject: "main" }),
    );
  });
});

describe("audit contract — shadow mode invariants", () => {
  it("summary tallies by severity; an all-clean snapshot yields zero findings", () => {
    const clean = runConsistencyAudit(snap({}));
    expect(clean.findings).toHaveLength(0);
    expect(clean.summary).toEqual({ fail: 0, warn: 0, unknown: 0, grandfathered: 0 });
  });

  it("never throws on malformed rows", () => {
    const r = runConsistencyAudit(
      snap({ runs: [{ garbage: true }, { cycle_id: 42 as unknown as string, ts: "not-a-date" }] }),
    );
    expect(Array.isArray(r.findings)).toBe(true);
  });
});

function iso(sec: number): string {
  return new Date(sec * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}
