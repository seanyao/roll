/**
 * Unit tests for 连续低分 → 待人确认候选 (US-CORE-013, Goodhart guardrail).
 */
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_STATUS,
  type CandidateDraft,
  candidateFromSignal,
  detectSignals,
  emitCandidates,
} from "../src/index.js";

const low = (dim: string): { dims: Record<string, number> } => ({ dims: { [dim]: 0.0 } });
const good = (dim: string): { dims: Record<string, number> } => ({ dims: { [dim]: 1.0 } });
const unk = (dim: string): { dims: Record<string, string> } => ({ dims: { [dim]: "unknown" } });

describe("detectSignals — consecutive-low-dimension detection windows", () => {
  it("fires after the default 3-cycle streak", () => {
    const sigs = detectSignals([low("outcome"), low("outcome"), low("outcome")]);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({ key: "lowdim:outcome", dim: "outcome", kind: "FIX", streak: 3 });
  });

  it("does NOT fire below the streak", () => {
    expect(detectSignals([low("outcome"), low("outcome")])).toHaveLength(0);
  });

  it("a known-good cycle breaks the streak", () => {
    expect(detectSignals([low("outcome"), good("outcome"), low("outcome"), low("outcome")])).toHaveLength(0);
  });

  it("unknown cycles are skipped (neither extend nor break)", () => {
    const sigs = detectSignals([low("correctness"), unk("correctness"), low("correctness"), low("correctness")]);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]?.streak).toBe(3);
  });

  it("scope_fidelity / efficiency map to IDEA; others to FIX", () => {
    const sf = detectSignals([low("scope_fidelity"), low("scope_fidelity"), low("scope_fidelity")]);
    expect(sf[0]?.kind).toBe("IDEA");
    const q = detectSignals([low("quality"), low("quality"), low("quality")]);
    expect(q[0]?.kind).toBe("FIX");
  });

  it("respects a custom streak; clamps < 1 to 1", () => {
    expect(detectSignals([low("outcome"), low("outcome")], 2)).toHaveLength(1);
    expect(detectSignals([low("outcome")], 0)).toHaveLength(1);
  });

  it("emits in DIMENSIONS order when several fire", () => {
    const records = [
      { dims: { outcome: 0.0, quality: 0.0 } },
      { dims: { outcome: 0.0, quality: 0.0 } },
      { dims: { outcome: 0.0, quality: 0.0 } },
    ];
    const sigs = detectSignals(records);
    expect(sigs.map((s) => s.dim)).toEqual(["outcome", "quality"]);
  });
});

describe("candidate draft — 待人确认, never auto-modifies backlog", () => {
  it("carries the 待人确认 status and the signal kind", () => {
    const sig = detectSignals([low("outcome"), low("outcome"), low("outcome")])[0];
    expect(sig).toBeDefined();
    const draft = candidateFromSignal(sig!);
    expect(draft.status).toBe(CANDIDATE_STATUS);
    expect(draft.status).not.toBe("📋 Todo");
    expect(draft.kind).toBe("FIX");
    expect(draft.text).toContain(CANDIDATE_STATUS);
  });

  it("emitCandidates routes drafts to the injected writer only", () => {
    const written: CandidateDraft[] = [];
    const drafts = emitCandidates(
      [low("outcome"), low("outcome"), low("outcome")],
      (d) => written.push(d),
    );
    expect(drafts).toHaveLength(1);
    expect(written).toEqual(drafts);
    // No backlog mutation occurs — the writer is the only side-effect channel.
  });
});
