/**
 * FIX-1032a — delivery gate pure function tests.
 *
 * AC1: PR loop absent  → pr_loop_unavailable verdict (no delivered).
 * AC2: main CI red     → ci_red_after_merge verdict (no delivered).
 * AC3: normal path     → allowed (regression guard).
 */
import { describe, expect, it } from "vitest";
import { deliveryGate } from "../src/index.js";

describe("deliveryGate — FIX-1032a", () => {
  // ── AC1: PR loop absent ─────────────────────────────────────────────────

  it("AC1: returns pr_loop_unavailable when PR loop is not installed", () => {
    const result = deliveryGate({ prLoopHealthy: false, mainCiStatus: "green" });
    expect(result.verdict).toBe("pr_loop_unavailable");
    expect(result.alert).toContain("PR loop not installed");
  });

  it("AC1: passes prUrl through in the verdict", () => {
    const result = deliveryGate({
      prLoopHealthy: false,
      mainCiStatus: "green",
      prUrl: "https://github.com/o/r/pull/42",
    });
    expect(result.verdict).toBe("pr_loop_unavailable");
    if (result.verdict === "pr_loop_unavailable") {
      expect(result.prUrl).toBe("https://github.com/o/r/pull/42");
    }
  });

  it("AC1: pr_loop_unavailable takes priority over CI red", () => {
    // Both conditions fail — PR loop gate fires first (loses the CI detail).
    const result = deliveryGate({ prLoopHealthy: false, mainCiStatus: "red" });
    expect(result.verdict).toBe("pr_loop_unavailable");
  });

  // ── AC2: CI red ─────────────────────────────────────────────────────────

  it("AC2: returns ci_red_after_merge when main CI is red", () => {
    const result = deliveryGate({ prLoopHealthy: true, mainCiStatus: "red" });
    expect(result.verdict).toBe("ci_red_after_merge");
    expect(result.alert).toContain("main CI red after merge");
  });

  it("AC2: passes ciRunUrl through in the verdict", () => {
    const result = deliveryGate({
      prLoopHealthy: true,
      mainCiStatus: "red",
      ciRunUrl: "https://ci.example.com/run/123",
    });
    expect(result.verdict).toBe("ci_red_after_merge");
    if (result.verdict === "ci_red_after_merge") {
      expect(result.ciRunUrl).toBe("https://ci.example.com/run/123");
    }
  });

  // ── AC3: Normal path ───────────────────────────────────────────────────

  it("AC3: returns allowed when PR loop healthy and main CI green", () => {
    const result = deliveryGate({ prLoopHealthy: true, mainCiStatus: "green" });
    expect(result.verdict).toBe("allowed");
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  it("pending CI status does not block delivery", () => {
    const result = deliveryGate({ prLoopHealthy: true, mainCiStatus: "pending" });
    expect(result.verdict).toBe("allowed");
  });

  it("unknown CI status does not block delivery", () => {
    const result = deliveryGate({ prLoopHealthy: true, mainCiStatus: "unknown" });
    expect(result.verdict).toBe("allowed");
  });

  it("prLoopHealthy = true with ciRunUrl but CI green → allowed (URL not relevant)", () => {
    const result = deliveryGate({
      prLoopHealthy: true,
      mainCiStatus: "green",
      ciRunUrl: "https://ci.example.com/run/456",
    });
    expect(result.verdict).toBe("allowed");
  });
});
