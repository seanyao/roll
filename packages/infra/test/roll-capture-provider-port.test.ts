import { describe, expect, it } from "vitest";
import type { RollCaptureProviderPort } from "../src/index.js";

describe("US-PHYSICAL-001 RollCaptureProviderPort", () => {
  it("declares writeRequest, readResponse, and waitForResponse with timeout options", async () => {
    const provider: RollCaptureProviderPort = {
      writeRequest: async () => undefined,
      readResponse: async () => null,
      waitForResponse: async (_request, options) => ({
        status: "timeout",
        reason: `timed out after ${options.timeoutMs}ms waiting for roll.capture.v1 response`,
      }),
    };

    expect(typeof provider.writeRequest).toBe("function");
    expect(typeof provider.readResponse).toBe("function");
    expect(await provider.waitForResponse({ requestId: "r1" } as never, { timeoutMs: 5 })).toEqual({
      status: "timeout",
      reason: "timed out after 5ms waiting for roll.capture.v1 response",
    });
  });
});
