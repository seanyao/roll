/**
 * US-DELIV-004 — attest/ac-map push 前硬闸 (evidenceGateBeforePush, fail-loud).
 *
 * Design .roll/features/delivery-reconciler/delivery-reconciler-design.md
 * §3.2/§4/§8: BEFORE the cycle branch is pushed, the runner checks that the
 * acceptance evidence (attest report + ac-map) was actually produced. Missing
 * evidence → { ok:false, reasons } → the cycle is `blocked_no_evidence` and
 * the branch is NEVER pushed — "pushed a branch but opened no PR" stops being
 * a normal outcome and becomes a fault state (handled like the zero-TCR
 * class). The gate moves the CHECKPOINT earlier; it does not change the
 * attest judgement itself (FIX-329: attest is earned at delivery).
 *
 * AC1 (goal 1): evidence complete → { ok:true } lets the push through.
 * AC2 (goal 1/2): missing attest report and/or ac-map → { ok:false } with a
 *   reason per missing artifact; deterministic order (attest first); the
 *   function is pure + total (any fact combination yields a verdict).
 */
import { describe, expect, it } from "vitest";
import { acBlockPresentInSpec, evidenceGateBeforePush } from "../src/index.js";

describe("evidenceGateBeforePush — US-DELIV-004", () => {
  // ── AC1: evidence complete → push allowed ────────────────────────────────
  it("attest report + ac-map both present → { ok: true }", () => {
    expect(evidenceGateBeforePush({ attestReportPresent: true, acMapPresent: true })).toEqual({ ok: true });
  });

  // ── AC2: any missing artifact → fail-loud, one reason per artifact ───────
  it("missing attest report → ok:false with an attest reason", () => {
    const v = evidenceGateBeforePush({ attestReportPresent: false, acMapPresent: true });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reasons).toHaveLength(1);
      expect(v.reasons[0]).toContain("attest report");
    }
  });

  it("missing ac-map → ok:false with an 'ac-map.json missing' reason", () => {
    const v = evidenceGateBeforePush({ attestReportPresent: true, acMapPresent: false });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reasons).toHaveLength(1);
      expect(v.reasons[0]).toContain("ac-map.json missing");
    }
  });

  it("both missing → ok:false with both reasons, attest first (deterministic)", () => {
    const v = evidenceGateBeforePush({ attestReportPresent: false, acMapPresent: false });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reasons).toHaveLength(2);
      expect(v.reasons[0]).toContain("attest report");
      expect(v.reasons[1]).toContain("ac-map.json missing");
    }
  });

  // ── AC2 (purity): same input → same output, no exceptions on any combo ───
  it("is pure + total over the 2×2 fact space", () => {
    const seen = new Set<string>();
    for (const attestReportPresent of [true, false]) {
      for (const acMapPresent of [true, false]) {
        const v = evidenceGateBeforePush({ attestReportPresent, acMapPresent });
        seen.add(JSON.stringify(v));
        expect(v.ok).toBe(attestReportPresent && acMapPresent);
      }
    }
    // 4 distinct verdicts: ok / attest-missing / acmap-missing / both-missing
    expect(seen.size).toBe(4);
  });

  // ── FIX-1256: no-AC cards are exempt from report + ac-map requirements ───
  it("acceptanceReportRequired=false → ok:true even with missing artifacts", () => {
    expect(evidenceGateBeforePush({
      attestReportPresent: false,
      acMapPresent: false,
      acceptanceReportRequired: false,
    })).toEqual({ ok: true });
  });

  it("acceptanceReportRequired=true (default) still requires both artifacts", () => {
    expect(evidenceGateBeforePush({
      attestReportPresent: true,
      acMapPresent: false,
    })).toEqual({ ok: false, reasons: ["ac-map.json missing"] });
  });
});

describe("acBlockPresentInSpec — FIX-1256 shared AC-block decision", () => {
  it("returns true when the spec contains an **AC:** block for the story", () => {
    const text = "# US-FOO-001\n\n**AC:**\n- [ ] something\n";
    expect(acBlockPresentInSpec(text, "US-FOO-001")).toBe(true);
  });

  it("returns false when the spec has no **AC:** block", () => {
    const text = "# FIX-FOO-001\n\nSome description without AC.\n";
    expect(acBlockPresentInSpec(text, "FIX-FOO-001")).toBe(false);
  });
});
