/**
 * FIX-1032c — intel-radar regression fixture.
 *
 * Encodes the real-world contradiction from intel-radar cycle
 * 20260629-112437-39253 (US-TASK-001) that exposed the false-delivered
 * bugs fixed by FIX-1032a/b:
 *
 *   - PR #75 merged by owner, merge commit dc676ff
 *   - Main CI red
 *   - Events wrote published_pending_merge, runs incorrectly wrote delivered
 *
 * All four ACs are local + deterministic — no GitHub API, no network.
 */
import { describe, expect, it } from "vitest";
import { deliveryGate } from "../src/index.js";
import { deriveCycleTruth, type CycleTruthInput } from "../src/index.js";
import {
  deliveryGateDiagnosticsFromRows,
  type TruthRunRow,
} from "../src/index.js";

// ── Fixture: intel-radar cycle 20260629-112437-39253 ──────────────────────
//
// Real-world facts from the trial that exposed the false-delivered bug:

const INTEL_RADAR_CYCLE = "20260629-112437-39253";
const INTEL_RADAR_STORY = "US-TASK-001";
const INTEL_RADAR_PR = 75;
const INTEL_RADAR_MERGE_COMMIT = "dc676ff";
const INTEL_RADAR_PR_URL = "https://github.com/seanyao/intel-radar/pull/75";
const INTEL_RADAR_CI_RUN_URL =
  "https://github.com/seanyao/intel-radar/actions/runs/39253";
const INTEL_RADAR_TS = "2026-06-29T11:24:37Z";
const INTEL_RADAR_TS_SEC = new Date(INTEL_RADAR_TS).getTime() / 1000;

// Schema epoch before the intel-radar cycle (pre-TRUTH-001 events).
const PRE_EPOCH = Date.UTC(2026, 5, 1, 0) / 1000;
const NOW = INTEL_RADAR_TS_SEC + 3600; // 1 hour after the cycle
const GRACE = 3600;

// ── The runs row that the buggy code incorrectly wrote ────────────────────
//
// The reconcile engine backfilled with merge_commit = dc676ff and
// outcome = "delivered", bypassing the delivery gate (before FIX-1032a
// existed).
const buggyRunRow: TruthRunRow = {
  run_id: INTEL_RADAR_CYCLE,
  cycle_id: INTEL_RADAR_CYCLE,
  story_id: INTEL_RADAR_STORY,
  status: "merged",
  outcome: "delivered",
  pr_number: INTEL_RADAR_PR,
  pr_url: INTEL_RADAR_PR_URL,
  merge_commit: INTEL_RADAR_MERGE_COMMIT,
  ts: INTEL_RADAR_TS,
};

// ── AC1: Fixture integrity ───────────────────────────────────────────────

describe("FIX-1032c AC1 — fixture encodes real-world facts", () => {
  it("encodes the cycle id from the intel-radar trial run", () => {
    expect(INTEL_RADAR_CYCLE).toBe("20260629-112437-39253");
  });

  it("encodes the story id US-TASK-001", () => {
    expect(INTEL_RADAR_STORY).toBe("US-TASK-001");
  });

  it("encodes PR #75 merged by owner", () => {
    expect(INTEL_RADAR_PR).toBe(75);
  });

  it("encodes merge commit dc676ff", () => {
    expect(INTEL_RADAR_MERGE_COMMIT).toBe("dc676ff");
  });

  it("encodes the fixture run row with all key fields", () => {
    expect(buggyRunRow).toMatchObject({
      run_id: "20260629-112437-39253",
      cycle_id: "20260629-112437-39253",
      story_id: "US-TASK-001",
      status: "merged",
      outcome: "delivered",
      pr_number: 75,
      pr_url: "https://github.com/seanyao/intel-radar/pull/75",
      merge_commit: "dc676ff",
    });
  });
});

// ── AC2: delivery gate blocks delivery ───────────────────────────────────

describe("FIX-1032c AC2 — delivery gate returns not-delivered", () => {
  it("ci_red_after_merge when main CI is red", () => {
    const result = deliveryGate({
      mainCiStatus: "red",
      ciRunUrl: INTEL_RADAR_CI_RUN_URL,
    });
    expect(result.verdict).toBe("ci_red_after_merge");
    expect(result.alert).toContain("main CI red after merge");
  });

  it("contains the intel-radar CI run URL in the ci_red_after_merge verdict", () => {
    const result = deliveryGate({
      mainCiStatus: "red",
      ciRunUrl: INTEL_RADAR_CI_RUN_URL,
    });
    expect(result.verdict).toBe("ci_red_after_merge");
    if (result.verdict === "ci_red_after_merge") {
      expect(result.ciRunUrl).toBe(INTEL_RADAR_CI_RUN_URL);
    }
  });
});

// ── AC3: Truth function resolves contradictory inputs ────────────────────

describe("FIX-1032c AC3 — truth function resolves contradiction as not-delivered", () => {
  it("terminal published_pending_merge wins when no merge stamp backfilled", () => {
    // The contradictory inputs: runs says "delivered" but terminal says
    // "published_pending_merge".  Without a merge stamp (hasMergeStamp=false),
    // the terminal twin should win → published_pending_merge (not delivered).
    const input: CycleTruthInput = {
      cycleId: INTEL_RADAR_CYCLE,
      runStatus: "merged",
      runOutcome: "delivered",
      hasMergeStamp: false,
      terminalOutcome: "published_pending_merge",
      tsSec: INTEL_RADAR_TS_SEC,
      nowSec: NOW,
      graceSec: GRACE,
      schemaEpochSec: PRE_EPOCH,
    };
    const result = deriveCycleTruth(input);
    expect(result.outcome).toBe("published_pending_merge");
    expect(result.outcome).not.toBe("delivered");
    expect(result.state).toBe("truth");
  });

  it("delivery gate outcome (ci_red_after_merge) outranks legacy delivered", () => {
    // After FIX-1032a, the reconcile engine writes ci_red_after_merge instead
    // of delivered.  The truth function sees the gate outcome directly and
    // returns it without consulting the terminal twin.
    const input: CycleTruthInput = {
      cycleId: INTEL_RADAR_CYCLE,
      runStatus: "merged",
      runOutcome: "ci_red_after_merge",
      hasMergeStamp: false,
      terminalOutcome: "published_pending_merge",
      tsSec: INTEL_RADAR_TS_SEC,
      nowSec: NOW,
      graceSec: GRACE,
      schemaEpochSec: PRE_EPOCH,
    };
    const result = deriveCycleTruth(input);
    expect(result.outcome).toBe("ci_red_after_merge");
    expect(result.outcome).not.toBe("delivered");
    expect(result.state).toBe("truth");
    expect(result.reason).toBe("terminal_self_reported");
  });

  it("a retired historical outcome falls back to awaiting reconciliation", () => {
    const input: CycleTruthInput = {
      cycleId: INTEL_RADAR_CYCLE,
      runStatus: "published",
      runOutcome: "pr_loop_unavailable",
      hasMergeStamp: false,
      terminalOutcome: "published_pending_merge",
      tsSec: INTEL_RADAR_TS_SEC,
      nowSec: NOW,
      graceSec: GRACE,
      schemaEpochSec: PRE_EPOCH,
    };
    const result = deriveCycleTruth(input);
    expect(result.outcome).toBe("published_pending_merge");
    expect(result.outcome).not.toBe("delivered");
    expect(result.state).toBe("truth");
  });
});

// ── AC4: Diagnostics include blocking reasons and URLs ───────────────────

describe("FIX-1032c AC4 — gate diagnostics with blocking reasons and URLs", () => {
  it("deliveryGateDiagnosticsFromRows surfaces ci_red_after_merge with CI run URL", () => {
    const row: TruthRunRow = {
      run_id: INTEL_RADAR_CYCLE,
      story_id: INTEL_RADAR_STORY,
      status: "merged",
      outcome: "ci_red_after_merge",
      ts: INTEL_RADAR_TS,
      ci_run_url: INTEL_RADAR_CI_RUN_URL,
    };
    const diags = deliveryGateDiagnosticsFromRows([row], { nowSec: NOW });
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({
      kind: "ci_red_after_merge",
      cycleId: INTEL_RADAR_CYCLE,
      storyId: INTEL_RADAR_STORY,
      ciRunUrl: INTEL_RADAR_CI_RUN_URL,
    });
  });

  it("old rows beyond maxAgeSec are filtered out", () => {
    // A row from 100 days ago should not appear in diagnostics.
    const oldTs = new Date(INTEL_RADAR_TS_SEC * 1000 - 100 * 86400 * 1000).toISOString();
    const row: TruthRunRow = {
      run_id: "stale-cycle",
      story_id: "US-STALE",
      status: "merged",
      outcome: "ci_red_after_merge",
      ts: oldTs,
      ci_run_url: INTEL_RADAR_CI_RUN_URL,
    };
    const diags = deliveryGateDiagnosticsFromRows([row], {
      nowSec: NOW,
      maxAgeSec: 86400, // 1 day
    });
    expect(diags).toHaveLength(0);
  });
});
