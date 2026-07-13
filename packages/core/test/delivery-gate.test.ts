/**
 * Delivery gate pure function tests.
 *
 * AC1: main CI red → ci_red_after_merge verdict (no delivered).
 * AC2: normal path → allowed (regression guard).
 */
import { describe, expect, it } from "vitest";
import { deliveryGate } from "../src/index.js";

describe("deliveryGate", () => {
  it("AC1: returns ci_red_after_merge when main CI is red", () => {
    const result = deliveryGate({ mainCiStatus: "red" });
    expect(result.verdict).toBe("ci_red_after_merge");
    expect(result.alert).toContain("main CI red after merge");
  });

  it("AC1: passes ciRunUrl through in the verdict", () => {
    const result = deliveryGate({
      mainCiStatus: "red",
      ciRunUrl: "https://ci.example.com/run/123",
    });
    expect(result.verdict).toBe("ci_red_after_merge");
    if (result.verdict === "ci_red_after_merge") {
      expect(result.ciRunUrl).toBe("https://ci.example.com/run/123");
    }
  });

  it("AC2: returns allowed when main CI is green", () => {
    const result = deliveryGate({ mainCiStatus: "green" });
    expect(result.verdict).toBe("allowed");
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  it("pending CI status does not block delivery", () => {
    const result = deliveryGate({ mainCiStatus: "pending" });
    expect(result.verdict).toBe("allowed");
  });

  it("unknown CI status does not block delivery", () => {
    const result = deliveryGate({ mainCiStatus: "unknown" });
    expect(result.verdict).toBe("allowed");
  });

  it("ignores a CI run URL when CI is green", () => {
    const result = deliveryGate({
      mainCiStatus: "green",
      ciRunUrl: "https://ci.example.com/run/456",
    });
    expect(result.verdict).toBe("allowed");
  });
});
