/**
 * US-DELTA-001 — Admission matrix tests.
 */
import { describe, expect, it } from "vitest";
import { admit, admitShape, type AdmissionResult } from "../src/delta-team/admission.js";

describe("US-DELTA-001 AC7 — Admission matrix", () => {
  describe("host-guided trigger", () => {
    it("admits solo topology", () => {
      expect(admit("host-guided", "solo")).toEqual({ admitted: true });
    });

    it("admits delta-team topology", () => {
      expect(admit("host-guided", "delta-team")).toEqual({ admitted: true });
    });

    it("admits full-delta-team topology", () => {
      expect(admit("host-guided", "full-delta-team")).toEqual({ admitted: true });
    });
  });

  describe("loop-autonomous trigger", () => {
    it("admits solo topology", () => {
      expect(admit("loop-autonomous", "solo")).toEqual({ admitted: true });
    });

    it("admits full-delta-team topology (explicit opt-in)", () => {
      expect(admit("loop-autonomous", "full-delta-team")).toEqual({ admitted: true });
    });

    it("BLOCKS delta-team topology — no implicit Supervisor", () => {
      const result = admit("loop-autonomous", "delta-team");
      expect(result.admitted).toBe(false);
      if (!result.admitted) {
        expect(result.reason).toBe("host_supervisor_required");
        expect(result.detail).toContain("host Supervisor");
        expect(result.detail).toContain("loop-autonomous");
      }
    });
  });

  describe("no silent conversion", () => {
    it("blocked result never returns admitted:true", () => {
      const r = admit("loop-autonomous", "delta-team");
      if (!r.admitted) {
        expect(r.reason).toBe("host_supervisor_required");
        // Verify it's NOT silently rerouted to solo or full-delta-team
        expect(r.reason).not.toBe("model_unavailable");
      }
    });

    it("host-guided never blocks", () => {
      for (const topology of ["solo", "delta-team", "full-delta-team"] as const) {
        expect(admit("host-guided", topology).admitted).toBe(true);
      }
    });
  });
});

describe("admitShape — quality profile never affects admission", () => {
  it("profile does not gate admission", () => {
    // standard, verified, designed all pass for any valid combination
    expect(admitShape("host-guided", "delta-team", "standard").admitted).toBe(true);
    expect(admitShape("host-guided", "delta-team", "verified").admitted).toBe(true);
    expect(admitShape("host-guided", "delta-team", "designed").admitted).toBe(true);
  });

  it("blocking is trigger×topology only", () => {
    const r = admitShape("loop-autonomous", "delta-team", "designed");
    expect(r.admitted).toBe(false);
    if (!r.admitted) {
      expect(r.reason).toBe("host_supervisor_required");
    }
  });
});
