import { describe, expect, it } from "vitest";
import { dayKeyOffset, shDayKey, shHHMM, shYmdHm } from "../src/lib/sh-time.js";

describe("Shanghai display-time helpers", () => {
  it("uses the dashboard UTC+8 day boundary without local timezone getters", () => {
    const beforeUtcMidnight = new Date("2026-07-02T23:59:00Z");
    const afterUtcMidnight = new Date("2026-07-03T00:01:00Z");

    expect(shHHMM(beforeUtcMidnight)).toBe("07:59");
    expect(shDayKey(beforeUtcMidnight)).toBe("2026-07-03");
    expect(shYmdHm(afterUtcMidnight)).toBe("2026-07-03 08:01");
    expect(dayKeyOffset(beforeUtcMidnight, -1)).toBe("2026-07-02");
    expect(dayKeyOffset(beforeUtcMidnight, 1)).toBe("2026-07-04");
  });
});
