/**
 * US-TRUTH-003 — Truth Selectors (pure derivation over declared snapshots).
 *
 * Selectors consume ONLY authority-declared snapshot inputs (US-TRUTH-000) and
 * derive one conclusion per story/cycle/evidence question — frozen on the real
 * drift fixtures the shadow audit (US-TRUTH-002) encodes. No filesystem, no
 * git, no GitHub inside; conflicts resolve via the anchor arbitration rules
 * with closed reason codes.
 */
import { describe, expect, it } from "vitest";
import {
  deriveCycleTruth,
  deriveEvidenceTruth,
  deriveStoryTruth,
  type StoryDeliveryTruth,
  type StoryTruthInput,
} from "../src/index.js";

const EPOCH = Date.UTC(2026, 5, 10, 18) / 1000;
const NOW = EPOCH + 86400;
const GRACE = 3600;

function storyInput(over: Partial<StoryTruthInput>): StoryTruthInput {
  return {
    storyId: "US-X-001",
    backlogStatus: "✅ Done · PR#10",
    nowSec: NOW,
    graceSec: GRACE,
    schemaEpochSec: EPOCH,
    deliveringCycles: [],
    ...over,
  };
}

describe("deriveStoryTruth — Done ≡ merged (story_delivery anchor)", () => {
  it("Done + MERGED evidence → truth, delivered", () => {
    const t = deriveStoryTruth(storyInput({ prEvidence: { state: "MERGED", mergedAtSec: EPOCH } }));
    expect(t).toMatchObject({ state: "truth", delivered: true, reason: "merge_evidence_confirms" });
  });

  it("Done + OPEN PR → fail premature_done (the FIX-211/235 family)", () => {
    const t = deriveStoryTruth(storyInput({ prEvidence: { state: "OPEN" } }));
    expect(t).toMatchObject({ state: "fail", delivered: false, reason: "premature_done" });
  });

  it("Done + no probe → unknown, never a guessed fail", () => {
    const t = deriveStoryTruth(storyInput({}));
    expect(t).toMatchObject({ state: "unknown", reason: "merge_evidence_unavailable" });
  });

  it("MERGED but row not Done past grace → warn lagging_view (flip the row)", () => {
    const t = deriveStoryTruth(
      storyInput({
        backlogStatus: "🔨 In Progress",
        prEvidence: { state: "MERGED", mergedAtSec: NOW - GRACE - 10 },
      }),
    );
    expect(t).toMatchObject({ state: "warn", delivered: true, reason: "lagging_view" });
  });

  it("MERGED but row not Done WITHIN grace → unknown converging", () => {
    const t = deriveStoryTruth(
      storyInput({
        backlogStatus: "🔨 In Progress",
        prEvidence: { state: "MERGED", mergedAtSec: NOW - 60 },
      }),
    );
    expect(t).toMatchObject({ state: "unknown", reason: "converging_within_grace" });
  });

  it("pre-card-era Done (no PR annotation, no trace) → grandfathered", () => {
    const t = deriveStoryTruth(storyInput({ backlogStatus: "✅ Done" }));
    expect(t).toMatchObject({ state: "grandfathered", reason: "pre_card_era" });
  });

  it("AC5 concurrent cycles: the merged delivery credits; the duplicate is superseded", () => {
    const t = deriveStoryTruth(
      storyInput({
        prEvidence: { state: "MERGED", mergedAtSec: EPOCH },
        deliveringCycles: [
          { cycleId: "C-A", merged: true },
          { cycleId: "C-B", merged: false },
        ],
      }),
    );
    expect(t.delivered).toBe(true);
    expect(t.supersededCycles).toEqual(["C-B"]);
  });

  it("AC5 manual delivery: merged PR with no delivering cycle stays truth (manual is legal)", () => {
    const t = deriveStoryTruth(
      storyInput({ prEvidence: { state: "MERGED", mergedAtSec: EPOCH }, deliveringCycles: [] }),
    );
    expect(t).toMatchObject({ state: "truth", delivered: true });
  });
});

// ── US-TRUTH-017: structured delivery truth input ───────────────────────────

function dtInput(overrides: Partial<StoryDeliveryTruth> = {}): StoryDeliveryTruth {
  return {
    storyId: "US-X-001",
    lifecycleState: "done",
    delivered: true,
    prNumber: 10,
    prUrl: "https://github.com/example/pull/10",
    lastRecordedAt: NOW * 1000,
    deliveringCycles: ["C-A"],
    ...overrides,
  };
}

describe("US-TRUTH-017 AC1 — deriveStoryTruth with structured deliveryTruth", () => {
  it("deliveryTruth done + MERGED evidence → truth delivered (same as string path)", () => {
    const t = deriveStoryTruth(
      storyInput({
        deliveryTruth: dtInput({ lifecycleState: "done", delivered: true }),
        prEvidence: { state: "MERGED", mergedAtSec: EPOCH },
      }),
    );
    expect(t).toMatchObject({ state: "truth", delivered: true, reason: "merge_evidence_confirms" });
  });

  it("deliveryTruth in_flight + OPEN PR → no premature_done (not claiming done)", () => {
    const t = deriveStoryTruth(
      storyInput({
        backlogStatus: "📋 Todo", // string claim is "not done"
        deliveryTruth: dtInput({ lifecycleState: "pending_merge", delivered: false, prNumber: 42 }),
        prEvidence: { state: "OPEN" },
      }),
    );
    // Not claiming done in structured truth → truth, no premature_done
    expect(t).toMatchObject({ state: "truth", delivered: false, reason: "no_claim_no_evidence" });
  });

  it("deliveryTruth done + has prNumber but no PR evidence → unknown (same as legacy Done+PR# row)", () => {
    // Equivalent to: backlog says "✅ Done · PR#10" with no GitHub probe.
    const t = deriveStoryTruth(
      storyInput({
        deliveryTruth: dtInput({ lifecycleState: "done", delivered: true, prNumber: 10 }),
      }),
    );
    expect(t).toMatchObject({ state: "unknown", reason: "merge_evidence_unavailable" });
  });

  it("deliveryTruth todo → no claim (not reading ✅ from backlog)", () => {
    // Even if backlogStatus says "✅ Done", deliveryTruth says "todo" →
    // the structured truth wins and there is no claim being made.
    const t = deriveStoryTruth(
      storyInput({
        backlogStatus: "✅ Done · PR#10",
        deliveryTruth: dtInput({ lifecycleState: "todo", delivered: false, prNumber: undefined }),
      }),
    );
    // Since deliveryTruth does NOT claim done, it's no_claim_no_evidence
    expect(t).toMatchObject({ state: "truth", delivered: false, reason: "no_claim_no_evidence" });
  });

  it("deliveryTruth done + MERGED but no prNumber → annotated=false → grandfathered fallback (pre-card-era)", () => {
    // This is the edge case: structured says done but no PR number AND no git evidence.
    const t = deriveStoryTruth(
      storyInput({
        deliveryTruth: dtInput({ lifecycleState: "done", delivered: true, prNumber: undefined, mergeCommit: undefined }),
      }),
    );
    // Without prEvidence AND without prNumber, the done claim has no annotation.
    // This maps to the grandfathered case (pre-card-era done).
    expect(t).toMatchObject({ state: "grandfathered", delivered: false, reason: "pre_card_era" });
  });

  it("deliveryTruth in_flight with prNumber + MERGED evidence → merge confirms (backlog may lag)", () => {
    const t = deriveStoryTruth(
      storyInput({
        backlogStatus: "🔨 In Progress",
        deliveryTruth: dtInput({ lifecycleState: "pending_merge", delivered: false, prNumber: 42 }),
        prEvidence: { state: "MERGED", mergedAtSec: NOW - GRACE - 10 },
      }),
    );
    // MERGED evidence but deliveryTruth hasn't caught up → lagging_view
    expect(t).toMatchObject({ state: "warn", delivered: true, reason: "lagging_view" });
  });

  it("AC4 — no consumer reads backlog emoji when deliveryTruth present (✅ in string ignored)", () => {
    // A backlogStatus that says "✅ Done" but deliveryTruth says "building" →
    // the structured truth wins; ✅ emoji is NEVER parsed.
    const t = deriveStoryTruth(
      storyInput({
        backlogStatus: "✅ Done · PR#99",
        deliveryTruth: dtInput({ lifecycleState: "building", delivered: false, prNumber: 99 }),
      }),
    );
    // building ≠ done → no claim made, no PR# parsed from string
    expect(t).toMatchObject({ state: "truth", delivered: false, reason: "no_claim_no_evidence" });
  });
});

describe("deriveCycleTruth — runs row + branch evidence + terminal twin", () => {
  // ── FIX-1032b AC1: contradictory input resolution ─────────────────────
  it("FIX-1032b AC1: published_pending_merge terminal + merged row delivered → delivered wins (merge stamp)", () => {
    // The terminal event says published_pending_merge, but the runs row has been
    // backfilled with hasMergeStamp and outcome "delivered" (reconcileMergeEvidence
    // checked the delivery gate). The merge-stamped verdict must win.
    const t = deriveCycleTruth({
      cycleId: "C-CONTRADICT",
      runStatus: "merged",
      runOutcome: "delivered",
      hasMergeStamp: true,
      terminalOutcome: "published_pending_merge",
      tsSec: EPOCH + 100,
      nowSec: NOW,
      graceSec: GRACE,
      schemaEpochSec: EPOCH,
    });
    expect(t).toMatchObject({ outcome: "delivered", state: "truth", reason: "merge_evidence_confirms" });
  });

  it("FIX-1032b AC1: published_pending_merge + delivered WITHOUT merge stamp → terminal wins (backfill not yet done)", () => {
    // No merge stamp yet → the terminal event is still the source of truth.
    const t = deriveCycleTruth({
      cycleId: "C-NO-STAMP",
      runStatus: "published",
      runOutcome: "published_pending_merge",
      hasMergeStamp: false,
      terminalOutcome: "published_pending_merge",
      tsSec: EPOCH + 100,
      nowSec: NOW,
      graceSec: GRACE,
      schemaEpochSec: EPOCH,
    });
    expect(t).toMatchObject({ outcome: "published_pending_merge", state: "truth" });
  });

  it("US-DELIV-013: only the active CI gate outranks published status mapping", () => {
    const ciRed = deriveCycleTruth({
      cycleId: "C-CI-RED",
      runStatus: "merged",
      runOutcome: "ci_red_after_merge",
      hasMergeStamp: true,
      terminalOutcome: "published_pending_merge",
      tsSec: EPOCH + 100,
      nowSec: NOW,
      graceSec: GRACE,
      schemaEpochSec: EPOCH,
    });
    expect(ciRed).toMatchObject({ outcome: "ci_red_after_merge", state: "truth" });

    const prLoopAbsent = deriveCycleTruth({
      cycleId: "C-NO-PR-LOOP",
      runStatus: "published",
      runOutcome: "pr_loop_unavailable",
      hasMergeStamp: false,
      terminalOutcome: "published_pending_merge",
      tsSec: EPOCH + 100,
      nowSec: NOW,
      graceSec: GRACE,
      schemaEpochSec: EPOCH,
    });
    expect(prLoopAbsent).toMatchObject({ outcome: "published_pending_merge", state: "truth" });
  });

  it("AC5 squash merge: failed row + MERGED branch evidence → delivered (phantom corrected), fail-state drift on the row", () => {
    const t = deriveCycleTruth({
      cycleId: "20260610-212711-40684",
      runStatus: "failed",
      runOutcome: "failed",
      hasMergeStamp: false,
      branchEvidence: { state: "MERGED", mergedAtSec: EPOCH - 100 },
      tsSec: EPOCH - 7200,
      nowSec: NOW,
      graceSec: GRACE,
      schemaEpochSec: EPOCH,
    });
    expect(t).toMatchObject({ outcome: "delivered", state: "fail", reason: "phantom_failure_uncorrected" });
  });

  it("published row whose merge just landed → unknown within grace (backfill converging)", () => {
    const t = deriveCycleTruth({
      cycleId: "C-FRESH",
      runStatus: "published",
      runOutcome: "delivered",
      hasMergeStamp: false,
      branchEvidence: { state: "MERGED", mergedAtSec: NOW - 60 },
      tsSec: NOW - 600,
      nowSec: NOW,
      graceSec: GRACE,
      schemaEpochSec: EPOCH,
    });
    expect(t).toMatchObject({ outcome: "delivered", state: "unknown", reason: "converging_within_grace" });
  });

  it("merged row with stamps → truth delivered", () => {
    const t = deriveCycleTruth({
      cycleId: "C-OK",
      runStatus: "merged",
      runOutcome: "delivered",
      hasMergeStamp: true,
      tsSec: EPOCH + 100,
      nowSec: NOW,
      graceSec: GRACE,
      schemaEpochSec: EPOCH,
    });
    expect(t).toMatchObject({ outcome: "delivered", state: "truth", reason: "merge_evidence_confirms" });
  });

  it("AC5 aborted-with-delivery: terminal twin says aborted_with_delivery → that verdict, truth", () => {
    const t = deriveCycleTruth({
      cycleId: "C-KILLED",
      runStatus: "aborted",
      runOutcome: "aborted",
      hasMergeStamp: false,
      terminalOutcome: "aborted_with_delivery",
      tsSec: EPOCH + 100,
      nowSec: NOW,
      graceSec: GRACE,
      schemaEpochSec: EPOCH,
    });
    expect(t).toMatchObject({ outcome: "aborted_with_delivery", state: "truth" });
  });

  it("AC5 orphan run: no terminal twin post-epoch → unknown with terminal_twin_missing", () => {
    const t = deriveCycleTruth({
      cycleId: "C-ORPHAN",
      runStatus: "",
      runOutcome: "",
      hasMergeStamp: false,
      tsSec: EPOCH + 100,
      nowSec: NOW,
      graceSec: GRACE,
      schemaEpochSec: EPOCH,
    });
    expect(t).toMatchObject({ state: "unknown", reason: "terminal_twin_missing" });
  });

  it("pre-epoch incomplete cycle → grandfathered", () => {
    const t = deriveCycleTruth({
      cycleId: "C-OLD",
      runStatus: "failed",
      runOutcome: "failed",
      hasMergeStamp: false,
      tsSec: EPOCH - 9999,
      nowSec: NOW,
      graceSec: GRACE,
      schemaEpochSec: EPOCH,
    });
    expect(t.state === "grandfathered" || t.state === "truth").toBe(true);
  });
});

describe("deriveEvidenceTruth — attest_evidence anchor", () => {
  it("report + ac-map → truth", () => {
    expect(
      deriveEvidenceTruth({ storyId: "S", report: true, acMap: true, delivered: true }),
    ).toMatchObject({ state: "truth", reason: "evidence_complete" });
  });
  it("delivered without report → fail (the v3.611.1 release-gate shape)", () => {
    expect(
      deriveEvidenceTruth({ storyId: "S", report: false, acMap: false, delivered: true }),
    ).toMatchObject({ state: "fail", reason: "report_missing" });
  });
  it("report without ac-map → fail acmap_missing (the 6/10 epidemic)", () => {
    expect(
      deriveEvidenceTruth({ storyId: "S", report: true, acMap: false, delivered: true }),
    ).toMatchObject({ state: "fail", reason: "acmap_missing" });
  });
  it("not delivered yet → unknown (evidence not owed until delivery)", () => {
    expect(
      deriveEvidenceTruth({ storyId: "S", report: false, acMap: false, delivered: false }),
    ).toMatchObject({ state: "unknown", reason: "not_yet_owed" });
  });
});

describe("AC3/AC6 — outputs freeze on the US-TRUTH-002 drift fixtures and stay serializable", () => {
  it("the five dated incidents derive stable verdicts", () => {
    const verdicts = {
      "failed-cycle-merged-pr": deriveCycleTruth({
        cycleId: "20260610-212711-40684",
        runStatus: "failed",
        runOutcome: "failed",
        hasMergeStamp: false,
        branchEvidence: { state: "MERGED", mergedAtSec: EPOCH - 1000 },
        tsSec: EPOCH - 7200,
        nowSec: NOW,
        graceSec: GRACE,
        schemaEpochSec: EPOCH,
      }),
      "phantom-failure-pause": deriveCycleTruth({
        cycleId: "20260610-222703-13871",
        runStatus: "failed",
        runOutcome: "failed",
        hasMergeStamp: false,
        branchEvidence: { state: "MERGED", mergedAtSec: EPOCH - 500 },
        tsSec: EPOCH - 5000,
        nowSec: NOW,
        graceSec: GRACE,
        schemaEpochSec: EPOCH,
      }),
      "done-no-merge": deriveStoryTruth(storyInput({ prEvidence: { state: "OPEN" } })),
      "cost-blind": deriveCycleTruth({
        cycleId: "C-NOCOST",
        runStatus: "done",
        runOutcome: "delivered",
        hasMergeStamp: false,
        hasCost: false,
        tsSec: EPOCH + 100,
        nowSec: NOW,
        graceSec: GRACE,
        schemaEpochSec: EPOCH,
      }),
      "acmap-omission": deriveEvidenceTruth({ storyId: "FIX-232", report: true, acMap: false, delivered: true }),
    };
    expect(JSON.parse(JSON.stringify(verdicts))).toEqual(verdicts); // serializable, stable fields
    expect(verdicts).toMatchSnapshot();
  });
});
