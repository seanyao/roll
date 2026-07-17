/**
 * US-EVID-032 — Evidence-only repair (AC2).
 *
 * A `degraded-infrastructure` delivery can be repaired by re-running ONLY the
 * capture lanes; the completed build is NEVER reopened, and the delivery verdict
 * is carried through unchanged. A failed delivery or any non-degraded state is
 * refused (never rebuilt).
 */
import { describe, expect, it } from "vitest";
import {
  ROLL_CAPTURE_PROTOCOL_V2,
  type CaptureIntentV2,
  type CaptureReceiptV2,
} from "@roll/spec";
import {
  CapturePlanner,
  type CaptureLanePort,
  type CaptureReceiptPersistOutcome,
  type CaptureReceiptStorePort,
} from "../src/attest/capture-planner.js";
import { evidenceHealthFact, resolveEvidenceHealth, type EvidenceHealthFact } from "../src/attest/evidence-health.js";
import { isEvidenceOnlyRepairable, repairDegradedEvidence } from "../src/attest/evidence-repair.js";

const SHA = `sha256:${"a".repeat(64)}`;

/** A degraded-infrastructure prior fact (passed delivery, no valid image yet). */
function degradedPrior(surfaceId = "http://localhost:3000/team"): EvidenceHealthFact {
  return evidenceHealthFact(
    surfaceId,
    resolveEvidenceHealth({
      delivery: "passed",
      contractDeclared: true,
      run: {
        surfaceId,
        requested: [{ requestId: "r1" }],
        attempts: [{ requestId: "r1", state: "failed", accepted: false, failureKind: "infrastructure" }],
      },
    }),
  );
}

/** An in-memory receipt store port — no disk. Trusts the planner's validation. */
function fakeStore(): CaptureReceiptStorePort {
  const seen = new Set<string>();
  let accepted: string | null = null;
  return {
    captureSetId: () => "set-1",
    async persistReceipt(_intent: CaptureIntentV2, receipt: CaptureReceiptV2): Promise<CaptureReceiptPersistOutcome> {
      if (seen.has(receipt.requestId)) {
        return { status: "duplicate", receipt, captureSetId: "set-1", accepted: accepted === receipt.requestId };
      }
      seen.add(receipt.requestId);
      if (accepted === null && receipt.state === "taken") accepted = receipt.requestId;
      return { status: "persisted", receipt, captureSetId: "set-1", accepted: accepted === receipt.requestId };
    },
  };
}

/** A lane that returns a valid rendered `taken` receipt (repair succeeds). */
function takenRenderedLane(): CaptureLanePort {
  return {
    source: "playwright-rendered",
    async run(intent: CaptureIntentV2): Promise<CaptureReceiptV2> {
      return {
        protocol: ROLL_CAPTURE_PROTOCOL_V2,
        requestId: intent.requestId,
        storyId: intent.storyId,
        runId: intent.runId,
        surfaceId: intent.surface.id,
        source: "playwright-rendered",
        captureClass: "rendered",
        state: "taken",
        screenshotPath: intent.out,
        sha256: SHA,
        finalUrl: intent.surface.declaredUrl,
        responsePath: `${intent.out}.response.json`,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };
    },
  };
}

const REQUEST = {
  storyId: "US-X-1",
  runId: "repair-run",
  runDir: "/tmp/roll-run/.roll/run",
  projectRoot: "/tmp/roll-run",
  surface: { declaredUrl: "http://localhost:3000/team", expectedAcIds: ["AC2"] },
};

describe("isEvidenceOnlyRepairable", () => {
  it("is true only for passed + degraded-infrastructure", () => {
    expect(isEvidenceOnlyRepairable(degradedPrior())).toBe(true);
  });
});

describe("repairDegradedEvidence — never reopens the build (AC2)", () => {
  it("re-runs capture and improves health to verified WITHOUT rebuilding", async () => {
    const outcome = await repairDegradedEvidence(degradedPrior(), REQUEST, [takenRenderedLane()], fakeStore());
    expect(outcome.repaired).toBe(true);
    expect(outcome.reopenedBuild).toBe(false);
    expect(outcome.buildUntouched).toBe(true);
    expect(outcome.newHealth?.visual).toBe("verified");
    // The carried-through delivery verdict is never recomputed.
    expect(outcome.newHealth?.delivery).toBe("passed");
  });

  it("carries the delivery verdict through unchanged even when re-capture stays degraded", async () => {
    // No lanes wired ⇒ every planned lane is skipped ⇒ still degraded, but the
    // build is still never reopened and delivery stays passed.
    const outcome = await repairDegradedEvidence(degradedPrior(), REQUEST, [], fakeStore());
    expect(outcome.repaired).toBe(true);
    expect(outcome.reopenedBuild).toBe(false);
    expect(outcome.buildUntouched).toBe(true);
    expect(outcome.newHealth?.delivery).toBe("passed");
    expect(outcome.newHealth?.visual).toBe("degraded-infrastructure");
    // A degraded record stays evidence-only repairable (publishable, not rebuilt).
    expect(outcome.newHealth?.reschedulesBuild).toBe(false);
    expect(outcome.newHealth?.evidenceOnlyRepair).toBe(true);
  });
});

describe("repairDegradedEvidence — guards (AC2)", () => {
  it("refuses a failed delivery and does not reopen the build", async () => {
    const failed = evidenceHealthFact(
      "http://localhost:3000/team",
      resolveEvidenceHealth({ delivery: "failed", contractDeclared: true, run: null }),
    );
    const outcome = await repairDegradedEvidence(failed, REQUEST, [takenRenderedLane()], fakeStore());
    expect(outcome.repaired).toBe(false);
    expect(outcome.refusal).toBe("delivery-failed");
    expect(outcome.reopenedBuild).toBe(false);
    expect(outcome.newHealth).toBeUndefined();
  });

  it("refuses a verified record (nothing to repair) and does not touch the build", async () => {
    const verified = evidenceHealthFact(
      "http://localhost:3000/team",
      resolveEvidenceHealth({
        delivery: "passed",
        contractDeclared: true,
        run: {
          surfaceId: "http://localhost:3000/team",
          requested: [{ requestId: "r1" }],
          attempts: [{ requestId: "r1", state: "taken", accepted: true }],
        },
      }),
    );
    const outcome = await repairDegradedEvidence(verified, REQUEST, [takenRenderedLane()], fakeStore());
    expect(outcome.repaired).toBe(false);
    expect(outcome.refusal).toBe("not-degraded-infrastructure");
    expect(outcome.reopenedBuild).toBe(false);
  });

  it("refuses an invalid-target record (needs config repair, not an evidence rerun)", async () => {
    const invalid = evidenceHealthFact(
      "http://localhost:3000/team",
      resolveEvidenceHealth({
        delivery: "passed",
        contractDeclared: true,
        run: {
          surfaceId: "http://localhost:3000/team",
          requested: [{ requestId: "r1" }],
          attempts: [{ requestId: "r1", state: "failed", accepted: false, failureKind: "invalid-target" }],
        },
      }),
    );
    const outcome = await repairDegradedEvidence(invalid, REQUEST, [takenRenderedLane()], fakeStore());
    expect(outcome.repaired).toBe(false);
    expect(outcome.refusal).toBe("not-degraded-infrastructure");
    expect(outcome.reopenedBuild).toBe(false);
  });
});

describe("repairDegradedEvidence — uses the real CapturePlanner (no rebuild dependency)", () => {
  it("drives the shared planner, proving the path is capture-only", async () => {
    const planner = new CapturePlanner();
    const outcome = await repairDegradedEvidence(degradedPrior(), REQUEST, [takenRenderedLane()], fakeStore(), planner);
    expect(outcome.run?.surfaceId).toBe("http://localhost:3000/team");
    expect(outcome.reopenedBuild).toBe(false);
  });
});
