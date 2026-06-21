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
  correctBacklogStatus,
  type AuditSnapshot,
} from "../src/index.js";
import type { DeliveryRecord } from "@roll/spec";
import { present, absent } from "@roll/spec";

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

// ── US-TRUTH-018: claim-drift rule ──────────────────────────────────────────

describe("rule claim-drift — backlog status vs structured delivery truth", () => {
  function deliveryRecord(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
    return {
      storyId: "US-DRIFT",
      cycleId: "cycle-001",
      lifecycleState: "pending_merge",
      prNumber: present(42),
      prUrl: present("https://gh/pull/42"),
      mergedAt: absent("not_merged"),
      mergeCommit: absent("not_merged"),
      recordedAt: 1000,
      ...overrides,
    };
  }

  // AC4: injected drift samples → audit catches all

  it("backlog ✅ Done but truth not delivered → fail (premature Done)", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-PREMATURE", status: "✅ Done" }],
        deliveries: [
          deliveryRecord({ storyId: "US-PREMATURE", lifecycleState: "pending_merge" }),
        ],
      }),
    );
    const drift = r.findings.filter((f) => f.rule === "claim-drift" && f.subject === "US-PREMATURE");
    expect(drift).toHaveLength(1);
    expect(drift[0]!.severity).toBe("fail");
    expect(drift[0]!.detail).toContain("🔨 In Progress");
    expect(drift[0]!.detail).toContain("lifecycle=pending_merge");
    expect(drift[0]!.detail).toContain("delivered=false");
  });

  it("backlog 📋 Todo but truth in_flight → warn (lagging view)", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-LAGGING", status: "📋 Todo" }],
        deliveries: [
          deliveryRecord({ storyId: "US-LAGGING", lifecycleState: "pending_merge", prNumber: present(99) }),
        ],
      }),
    );
    const drift = r.findings.filter((f) => f.rule === "claim-drift" && f.subject === "US-LAGGING");
    expect(drift).toHaveLength(1);
    expect(drift[0]!.severity).toBe("warn");
    expect(drift[0]!.detail).toContain("📋 Todo");
    expect(drift[0]!.detail).toContain("🔨 In Progress");
  });

  it("backlog 🔨 In Progress but truth done → warn (lagging view, not premature)", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-STALE-PROGRESS", status: "🔨 In Progress" }],
        deliveries: [
          deliveryRecord({
            storyId: "US-STALE-PROGRESS",
            lifecycleState: "done",
            prNumber: present(10),
            mergedAt: present(2000),
            mergeCommit: present("abc123def"),
          }),
        ],
      }),
    );
    const drift = r.findings.filter((f) => f.rule === "claim-drift" && f.subject === "US-STALE-PROGRESS");
    expect(drift).toHaveLength(1);
    expect(drift[0]!.severity).toBe("warn");
    expect(drift[0]!.detail).toContain("🔨 In Progress");
    expect(drift[0]!.detail).toContain("✅ Done");
  });

  it("backlog status matches truth → no finding", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-MATCH", status: "🔨 In Progress" }],
        deliveries: [
          deliveryRecord({ storyId: "US-MATCH", lifecycleState: "pending_merge", prNumber: present(42) }),
        ],
      }),
    );
    expect(r.findings.filter((f) => f.rule === "claim-drift")).toHaveLength(0);
  });

  it("backlog Done matches truth done → no finding", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-DONE-MATCH", status: "✅ Done" }],
        deliveries: [
          deliveryRecord({
            storyId: "US-DONE-MATCH",
            lifecycleState: "done",
            prNumber: present(1),
            mergedAt: present(2000),
            mergeCommit: present("abc"),
            recordedAt: 5000,
          }),
        ],
      }),
    );
    expect(r.findings.filter((f) => f.rule === "claim-drift")).toHaveLength(0);
  });

  it("no delivery records in snapshot → rule silently skipped (no findings)", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-NO-DEL", status: "✅ Done" }],
        // deliveries absent
      }),
    );
    expect(r.findings.filter((f) => f.rule === "claim-drift")).toHaveLength(0);
  });

  it("empty deliveries array → rule skipped", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-EMPTY", status: "📋 Todo" }],
        deliveries: [],
      }),
    );
    expect(r.findings.filter((f) => f.rule === "claim-drift")).toHaveLength(0);
  });

  it("story with no delivery records → skipped (backlog is the only truth)", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-NO-MATCH", status: "📋 Todo" }],
        deliveries: [
          deliveryRecord({ storyId: "US-OTHER", lifecycleState: "pending_merge" }),
        ],
      }),
    );
    expect(r.findings.filter((f) => f.rule === "claim-drift" && f.subject === "US-NO-MATCH")).toHaveLength(0);
  });

  it("multiple stories, mixed drift — all caught", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [
          { id: "US-A", status: "✅ Done" },
          { id: "US-B", status: "📋 Todo" },
          { id: "US-C", status: "🔨 In Progress" },
        ],
        deliveries: [
          deliveryRecord({ storyId: "US-A", lifecycleState: "pending_merge" }), // premature Done → fail
          deliveryRecord({ storyId: "US-B", lifecycleState: "pending_merge", prNumber: present(5) }), // lagging → warn
          deliveryRecord({ storyId: "US-C", lifecycleState: "pending_merge", prNumber: present(7) }), // match → ok
        ],
      }),
    );
    const drifts = r.findings.filter((f) => f.rule === "claim-drift");
    expect(drifts).toHaveLength(2);
    const failSubjects = drifts.filter((f) => f.severity === "fail").map((f) => f.subject);
    const warnSubjects = drifts.filter((f) => f.severity === "warn").map((f) => f.subject);
    expect(failSubjects).toContain("US-A");
    expect(warnSubjects).toContain("US-B");
  });

  it("reverse: projection done but backlog Todo → warn (FIX-390 AC2)", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-REVERSE", status: "📋 Todo" }],
        deliveries: [
          deliveryRecord({
            storyId: "US-REVERSE",
            lifecycleState: "done",
            prNumber: present(1),
            mergedAt: present(2000),
            mergeCommit: present("abc"),
            recordedAt: 5000,
          }),
        ],
      }),
    );
    // Forward loop already catches this (Todo vs Done mismatch) —
    // the reverse lane should NOT double-report it.
    const drift = r.findings.filter((f) => f.rule === "claim-drift" && f.subject === "US-REVERSE");
    expect(drift).toHaveLength(1);
    expect(drift[0]!.severity).toBe("warn");
    expect(drift[0]!.detail).toContain("📋 Todo");
    expect(drift[0]!.detail).toContain("✅ Done");
  });

  it("reverse: projection done but story absent from backlog → warn (FIX-390 AC2)", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-OTHER", status: "📋 Todo" }],
        deliveries: [
          deliveryRecord({
            storyId: "US-MISSING",
            lifecycleState: "done",
            prNumber: present(1),
            mergedAt: present(2000),
            mergeCommit: present("abc"),
            recordedAt: 5000,
          }),
        ],
      }),
    );
    const drift = r.findings.filter((f) => f.rule === "claim-drift" && f.subject === "US-MISSING");
    expect(drift).toHaveLength(1);
    expect(drift[0]!.severity).toBe("warn");
    expect(drift[0]!.detail).toContain("absent from backlog");
  });

  it("reverse: projection done but backlog shows non-Done → warn (FIX-390 AC2)", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-STILL-WIP", status: "🔨 In Progress" }],
        deliveries: [
          deliveryRecord({
            storyId: "US-STILL-WIP",
            lifecycleState: "done",
            prNumber: present(1),
            mergedAt: present(2000),
            mergeCommit: present("abc"),
            recordedAt: 5000,
          }),
        ],
      }),
    );
    // Forward catches this (In Progress vs Done mismatch), reverse skips.
    const drift = r.findings.filter((f) => f.rule === "claim-drift" && f.subject === "US-STILL-WIP");
    expect(drift).toHaveLength(1);
    expect(drift[0]!.severity).toBe("warn");
  });

  it("reverse: projection done + backlog Done → no finding (both agree)", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-BOTH", status: "✅ Done" }],
        deliveries: [
          deliveryRecord({
            storyId: "US-BOTH",
            lifecycleState: "done",
            prNumber: present(1),
            mergedAt: present(2000),
            mergeCommit: present("abc"),
            recordedAt: 5000,
          }),
        ],
      }),
    );
    expect(r.findings.filter((f) => f.rule === "claim-drift")).toHaveLength(0);
  });

  it("backlog Done with annotation suffix still matches truth Done (normalization)", () => {
    const r = runConsistencyAudit(
      snap({
        backlog: [{ id: "US-ANNOTATED", status: "✅ Done · evidence(.roll/features/...)" }],
        deliveries: [
          deliveryRecord({
            storyId: "US-ANNOTATED",
            lifecycleState: "done",
            prNumber: present(1),
            mergedAt: present(2000),
            mergeCommit: present("abc"),
            recordedAt: 5000,
          }),
        ],
      }),
    );
    expect(r.findings.filter((f) => f.rule === "claim-drift")).toHaveLength(0);
  });
});

// ── US-TRUTH-018 AC2: correctBacklogStatus ─────────────────────────────────

describe("US-TRUTH-018 AC2 — correctBacklogStatus", () => {
  function deliveryRecord(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
    return {
      storyId: "US-CORRECT",
      cycleId: "cycle-001",
      lifecycleState: "pending_merge",
      prNumber: present(42),
      prUrl: present("https://gh/pull/42"),
      mergedAt: absent("not_merged"),
      mergeCommit: absent("not_merged"),
      recordedAt: 1000,
      ...overrides,
    };
  }

  it("returns corrected status when backlog shows Todo but truth is in_flight", () => {
    const result = correctBacklogStatus(
      "US-CORRECT",
      "📋 Todo",
      [deliveryRecord({ storyId: "US-CORRECT", lifecycleState: "pending_merge", prNumber: present(99) })],
    );
    expect(result).toBe("🔨 In Progress · PR#99");
  });

  it("returns corrected status when backlog shows Done but truth is in_flight (premature)", () => {
    const result = correctBacklogStatus(
      "US-CORRECT",
      "✅ Done",
      [deliveryRecord({ storyId: "US-CORRECT", lifecycleState: "pending_merge", prNumber: present(10) })],
    );
    expect(result).toBe("🔨 In Progress · PR#10");
  });

  it("returns null when status already matches truth", () => {
    const result = correctBacklogStatus(
      "US-CORRECT",
      "🔨 In Progress",
      [deliveryRecord({ storyId: "US-CORRECT", lifecycleState: "pending_merge", prNumber: present(42) })],
    );
    expect(result).toBeNull();
  });

  it("returns null when no delivery records exist for the story", () => {
    const result = correctBacklogStatus(
      "US-NO-RECORDS",
      "📋 Todo",
      [deliveryRecord({ storyId: "US-OTHER" })],
    );
    expect(result).toBeNull();
  });

  it("returns null when deliveries array is empty", () => {
    const result = correctBacklogStatus("US-EMPTY", "📋 Todo", []);
    expect(result).toBeNull();
  });

  it("correctStatus for done → derived display includes merge commit", () => {
    const result = correctBacklogStatus(
      "US-CORRECT",
      "🔨 In Progress",
      [
        deliveryRecord({
          storyId: "US-CORRECT",
          lifecycleState: "done",
          prNumber: present(1),
          mergedAt: present(2000),
          mergeCommit: present("deadbeefcafe"),
          recordedAt: 5000,
        }),
      ],
    );
    expect(result).toBe("✅ Done · merged deadbee");
  });

  it("does not modify human-written fields — only returns the status string", () => {
    // The function returns ONLY the status string. The caller (BacklogStore)
    // replaces just the status cell in the markdown row, leaving the title,
    // priority annotations, etc. untouched. Here we verify the function
    // signature is correct: it takes a status string and returns a status
    // string, never full markdown rows.
    const result = correctBacklogStatus(
      "US-CORRECT",
      "📋 Todo",
      [deliveryRecord({ storyId: "US-CORRECT", lifecycleState: "pending_merge", prNumber: present(5) })],
    );
    expect(typeof result).toBe("string");
    expect(result).toContain("PR#5");
    // The result is a clean status cell — no markdown row wrapping
    expect(result).not.toContain("|");
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
