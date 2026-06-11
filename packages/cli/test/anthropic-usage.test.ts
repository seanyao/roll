import { describe, expect, it, vi } from "vitest";
import { normalizeAnthropicUsagePayload, readAnthropicUsageLimits } from "../src/lib/anthropic-usage.js";

describe("US-GOAL-005 — Anthropic usage limit payload", () => {
  it("normalizes five-hour and weekly quota windows", () => {
    expect(
      normalizeAnthropicUsagePayload({
        usage: {
          five_hour: { used: 86, limit: 100, reset_at: "2026-06-11T12:00:00Z" },
          weekly: { current: 420, quota: 500, resets_at: 1_780_500_000 },
        },
      }),
    ).toEqual({
      status: "known",
      windows: [
        { window: "five_hour", used: 86, limit: 100, resetAtSec: 1_781_179_200 },
        { window: "weekly", used: 420, limit: 500, resetAtSec: 1_780_500_000 },
      ],
    });
  });

  it("returns unknown for unrecognized payloads instead of blocking the loop", () => {
    expect(normalizeAnthropicUsagePayload({ ok: true })).toEqual({ status: "unknown", reason: "usage_api_unrecognized" });
  });

  it("times out hanging usage API reads instead of blocking the loop", async () => {
    const previousToken = process.env["ANTHROPIC_AUTH_TOKEN"];
    process.env["ANTHROPIC_AUTH_TOKEN"] = "test-token";
    vi.useFakeTimers();
    let aborted = false;
    try {
      const result = readAnthropicUsageLimits(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted"));
            });
          }),
      );

      await vi.advanceTimersByTimeAsync(10_000);

      await expect(result).resolves.toEqual({ status: "unknown", reason: "usage_api_unreachable" });
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
      if (previousToken === undefined) {
        delete process.env["ANTHROPIC_AUTH_TOKEN"];
      } else {
        process.env["ANTHROPIC_AUTH_TOKEN"] = previousToken;
      }
    }
  });
});
