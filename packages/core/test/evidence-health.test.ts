/**
 * US-EVID-031 — EvidenceHealth resolver verdict matrix (AC1, AC2, AC3) +
 * scorer_focus.
 *
 * The resolver maps a CaptureRunResult (+ delivery verdict + whether a contract
 * was declared) onto EXACTLY four visual states, keeping delivery correctness
 * and visual-evidence health as SEPARATE facts. These tests cover each of the
 * four states, the boundaries between them, and the two scorer_focus attacks:
 *   1. degraded-infrastructure is never disguised as verified;
 *   2. an invalid-target lane stays BLOCKING even beside a coexisting valid image.
 */
import { describe, expect, it } from "vitest";
import {
  resolveEvidenceHealth,
  resolveEvidenceHealthFromRun,
  evidenceCategory,
  evidenceGateDecision,
  evidenceHealthFact,
  isBlockingVisualState,
  evidenceSignalLabel,
  type EvidenceAttemptView,
  type EvidenceRunView,
} from "../src/attest/evidence-health.js";
import type { CaptureReceiptState } from "@roll/spec";
import { EVIDENCE_VISUAL_STATES } from "@roll/spec";

const SURFACE = "http://localhost:3000/team";

function attempt(over: Partial<EvidenceAttemptView> & { requestId: string }): EvidenceAttemptView {
  return {
    state: "taken" as CaptureReceiptState,
    accepted: false,
    ...over,
  };
}

/** A valid, accepted taken image (physical or rendered). */
function takenAccepted(requestId: string): EvidenceAttemptView {
  return attempt({ requestId, state: "taken", accepted: true });
}

/** A host/provider/tooling failure (infrastructure). */
function infraFail(requestId: string, state: CaptureReceiptState = "failed"): EvidenceAttemptView {
  return attempt({ requestId, state, accepted: false, failureKind: "infrastructure" });
}

/** A poisoned lane: login/redirect/wrong target/corrupt/forged. */
function poisoned(requestId: string): EvidenceAttemptView {
  return attempt({ requestId, state: "failed", accepted: false, failureKind: "invalid-target" });
}

function run(attempts: EvidenceAttemptView[], surfaceId: string | null = SURFACE): EvidenceRunView {
  return { surfaceId, attempts, requested: attempts.map((a) => ({ requestId: a.requestId })) };
}

// ── AC1 — the four visual states ─────────────────────────────────────────────

describe("resolveEvidenceHealth — the four visual states (AC1)", () => {
  it("verified: at least one valid, target-bound taken image", () => {
    const h = resolveEvidenceHealth({ delivery: "passed", contractDeclared: true, run: run([takenAccepted("r1")]) });
    expect(h.visual).toBe("verified");
    expect(h.delivery).toBe("passed");
    expect(h.acceptedReceiptIds).toEqual(["r1"]);
    expect(h.attempts).toEqual(["r1"]);
  });

  it("verified: a rendered lane verifies even when the physical lane failed for host reasons", () => {
    const h = resolveEvidenceHealth({
      delivery: "passed",
      contractDeclared: true,
      run: run([infraFail("phys"), takenAccepted("rend")]),
    });
    expect(h.visual).toBe("verified");
    expect(h.acceptedReceiptIds).toEqual(["rend"]);
  });

  it("degraded-infrastructure: all lanes attempted, only host failures, no valid image", () => {
    const h = resolveEvidenceHealth({
      delivery: "passed",
      contractDeclared: true,
      run: run([infraFail("phys", "failed"), infraFail("rend", "timeout")]),
    });
    expect(h.visual).toBe("degraded-infrastructure");
    expect(h.acceptedReceiptIds).toEqual([]);
    expect(h.attempts).toEqual(["phys", "rend"]);
  });

  it("degraded-infrastructure: skipped lanes (no executor) are infrastructure, not verified", () => {
    const h = resolveEvidenceHealth({
      delivery: "passed",
      contractDeclared: true,
      run: run([infraFail("phys", "skipped"), infraFail("rend", "skipped")]),
    });
    expect(h.visual).toBe("degraded-infrastructure");
  });

  it("invalid-target: a lane reached login / an unapproved redirect / wrong target", () => {
    const h = resolveEvidenceHealth({ delivery: "passed", contractDeclared: true, run: run([poisoned("rend")]) });
    expect(h.visual).toBe("invalid-target");
  });

  it("absent-contract: no declared visual contract at all", () => {
    const h = resolveEvidenceHealth({ delivery: "passed", contractDeclared: false, run: null });
    expect(h.visual).toBe("absent-contract");
  });

  it("absent-contract: contract declared but the surface is not a URL (no declared surface)", () => {
    const h = resolveEvidenceHealth({ delivery: "passed", contractDeclared: true, run: run([], null) });
    expect(h.visual).toBe("absent-contract");
  });

  it("absent-contract: no planned attempt (nothing was dispatched)", () => {
    const h = resolveEvidenceHealth({
      delivery: "passed",
      contractDeclared: true,
      run: { surfaceId: SURFACE, attempts: [], requested: [] },
    });
    expect(h.visual).toBe("absent-contract");
  });

  it("absent-contract: the planner was bypassed (run absent while a contract was declared)", () => {
    const h = resolveEvidenceHealth({ delivery: "passed", contractDeclared: true, run: null });
    expect(h.visual).toBe("absent-contract");
  });

  it("only ever resolves one of exactly the four declared states", () => {
    const cases: EvidenceRunView[] = [
      run([takenAccepted("r1")]),
      run([infraFail("r1")]),
      run([poisoned("r1")]),
      run([], null),
    ];
    for (const r of cases) {
      const h = resolveEvidenceHealth({ delivery: "passed", contractDeclared: true, run: r });
      expect(EVIDENCE_VISUAL_STATES).toContain(h.visual);
    }
  });
});

// ── scorer_focus ─────────────────────────────────────────────────────────────

describe("resolveEvidenceHealth — scorer_focus", () => {
  it("degraded-infrastructure is NEVER disguised as verified (zero valid images, only host failures)", () => {
    // Even many host failures with a rich attempt list must not read as verified.
    const h = resolveEvidenceHealth({
      delivery: "passed",
      contractDeclared: true,
      run: run([infraFail("a", "failed"), infraFail("b", "timeout"), infraFail("c", "skipped")]),
    });
    expect(h.visual).toBe("degraded-infrastructure");
    expect(h.visual).not.toBe("verified");
    expect(h.acceptedReceiptIds).toHaveLength(0);
  });

  it("invalid-target stays BLOCKING even when another valid image exists on the SAME surface", () => {
    // One good rendered image + one poisoned physical lane on the same surface.
    // The good image must NOT mask the poisoned lane.
    const h = resolveEvidenceHealth({
      delivery: "passed",
      contractDeclared: true,
      run: run([takenAccepted("good-rendered"), poisoned("poisoned-physical")]),
    });
    expect(h.visual).toBe("invalid-target");
    expect(h.visual).not.toBe("verified");
    expect(isBlockingVisualState(h.visual)).toBe(true);
    // The valid image is still honestly recorded; the state blocks regardless.
    expect(h.acceptedReceiptIds).toEqual(["good-rendered"]);
    expect(evidenceGateDecision(h).blocksGate).toBe(true);
  });

  it("invalid-target wins over verified regardless of attempt order", () => {
    const a = resolveEvidenceHealth({ delivery: "passed", contractDeclared: true, run: run([poisoned("p"), takenAccepted("g")]) });
    const b = resolveEvidenceHealth({ delivery: "passed", contractDeclared: true, run: run([takenAccepted("g"), poisoned("p")]) });
    expect(a.visual).toBe("invalid-target");
    expect(b.visual).toBe("invalid-target");
  });
});

// ── AC2 — degraded publishes, is NOT rebuilt, repairable by evidence-only rerun ─

describe("evidenceGateDecision — degraded ≠ rebuild (AC2)", () => {
  it("degraded-infrastructure publishes, is visibly marked, and does NOT reschedule a build", () => {
    const h = resolveEvidenceHealth({ delivery: "passed", contractDeclared: true, run: run([infraFail("a"), infraFail("b", "timeout")]) });
    const d = evidenceGateDecision(h);
    expect(d.category).toBe("evidence-degradation");
    expect(d.blocksGate).toBe(false);
    expect(d.publishable).toBe(true);
    expect(d.reschedulesBuild).toBe(false); // never rebuild a completed story
    expect(d.markedDegraded).toBe(true); // visibly marked
    expect(d.evidenceOnlyRepair).toBe(true); // repairable by an evidence-only rerun
    expect(d.reason).not.toMatch(/product failure/i); // not described as a product failure
  });

  it("a delivery-passed + degraded story is still delivery=passed (delivery independent of the machine)", () => {
    const h = resolveEvidenceHealth({ delivery: "passed", contractDeclared: true, run: run([infraFail("a"), infraFail("b")]) });
    expect(h.delivery).toBe("passed");
    expect(evidenceGateDecision(h).publishable).toBe(true);
  });
});

// ── AC3 — invalid-target and absent-contract BLOCK ───────────────────────────

describe("evidenceGateDecision — blocking states (AC3)", () => {
  it("invalid-target blocks and is not publishable", () => {
    const h = resolveEvidenceHealth({ delivery: "passed", contractDeclared: true, run: run([poisoned("p")]) });
    const d = evidenceGateDecision(h);
    expect(d.blocksGate).toBe(true);
    expect(d.publishable).toBe(false);
    expect(d.category).toBe("evidence-contract-failure");
  });

  it("absent-contract blocks and is not publishable", () => {
    const h = resolveEvidenceHealth({ delivery: "passed", contractDeclared: false, run: null });
    const d = evidenceGateDecision(h);
    expect(d.blocksGate).toBe(true);
    expect(d.publishable).toBe(false);
    expect(d.reschedulesBuild).toBe(false);
  });

  it("a corrupt / forged receipt (invalid-target) is never promoted to evidence", () => {
    // The planner records a forged/corrupt receipt as a failed invalid-target attempt.
    const h = resolveEvidenceHealth({ delivery: "passed", contractDeclared: true, run: run([poisoned("forged")]) });
    expect(h.visual).toBe("invalid-target");
    expect(h.acceptedReceiptIds).toHaveLength(0);
  });
});

// ── AC5 — three distinct signals ─────────────────────────────────────────────

describe("evidenceCategory — three distinct signals + healthy (AC5)", () => {
  it("distinguishes delivery failure vs evidence degradation vs evidence contract failure", () => {
    const deliveryFailed = resolveEvidenceHealth({ delivery: "failed", contractDeclared: true, run: run([takenAccepted("r1")]) });
    const degraded = resolveEvidenceHealth({ delivery: "passed", contractDeclared: true, run: run([infraFail("a"), infraFail("b")]) });
    const invalid = resolveEvidenceHealth({ delivery: "passed", contractDeclared: true, run: run([poisoned("p")]) });
    const absent = resolveEvidenceHealth({ delivery: "passed", contractDeclared: false, run: null });
    const verified = resolveEvidenceHealth({ delivery: "passed", contractDeclared: true, run: run([takenAccepted("r1")]) });

    expect(evidenceCategory(deliveryFailed)).toBe("delivery-failure");
    expect(evidenceCategory(degraded)).toBe("evidence-degradation");
    expect(evidenceCategory(invalid)).toBe("evidence-contract-failure");
    expect(evidenceCategory(absent)).toBe("evidence-contract-failure");
    expect(evidenceCategory(verified)).toBe("evidence-verified");

    // The four categories are mutually distinct.
    const set = new Set([
      evidenceCategory(deliveryFailed),
      evidenceCategory(degraded),
      evidenceCategory(invalid),
      evidenceCategory(verified),
    ]);
    expect(set.size).toBe(4);
  });

  it("delivery failure takes precedence over the visual category in the coarse signal", () => {
    // Even when the visual would be degraded, a delivery failure is signalled as such.
    const h = resolveEvidenceHealth({ delivery: "failed", contractDeclared: true, run: run([infraFail("a")]) });
    expect(evidenceCategory(h)).toBe("delivery-failure");
    // The fine-grained visual state is still resolved for the report.
    expect(h.visual).toBe("degraded-infrastructure");
  });

  it("emits a bilingual label per category (EN + ZH on separate lines)", () => {
    for (const cat of ["delivery-failure", "evidence-verified", "evidence-degradation", "evidence-contract-failure"] as const) {
      const label = evidenceSignalLabel(cat);
      expect(label.en.length).toBeGreaterThan(0);
      expect(label.zh.length).toBeGreaterThan(0);
      expect(label.en).not.toBe(label.zh);
    }
  });
});

// ── evidenceHealthFact — the durable + status-facing fact ─────────────────────

describe("evidenceHealthFact — machine-readable per-surface fact", () => {
  it("carries surfaceId, category, gate flags, and the EvidenceHealth verdict", () => {
    const h = resolveEvidenceHealth({ delivery: "passed", contractDeclared: true, run: run([infraFail("a"), infraFail("b")]) });
    const fact = evidenceHealthFact(SURFACE, h);
    expect(fact.surfaceId).toBe(SURFACE);
    expect(fact.visual).toBe("degraded-infrastructure");
    expect(fact.delivery).toBe("passed");
    expect(fact.category).toBe("evidence-degradation");
    expect(fact.blocksGate).toBe(false);
    expect(fact.reschedulesBuild).toBe(false);
    expect(fact.markedDegraded).toBe(true);
  });
});

// ── resolveEvidenceHealthFromRun — accepts a real CaptureRunResult shape ──────

describe("resolveEvidenceHealthFromRun — structural passthrough", () => {
  it("resolves from a CaptureRunResult-shaped object", () => {
    const h = resolveEvidenceHealthFromRun({
      delivery: "passed",
      contractDeclared: true,
      run: {
        surfaceId: SURFACE,
        captureSetId: "set-1",
        requested: [{ requestId: "r1" } as never],
        attempts: [takenAccepted("r1") as never],
        persisted: [],
        taken: [],
      },
    });
    expect(h.visual).toBe("verified");
  });

  it("null run resolves to absent-contract", () => {
    const h = resolveEvidenceHealthFromRun({ delivery: "passed", contractDeclared: true, run: null });
    expect(h.visual).toBe("absent-contract");
  });
});
