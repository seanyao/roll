import { describe, expect, it } from "vitest";
import { ciWaitTick, type CiRunRow } from "../src/loop/ci-loop.js";

const r = (status: string, conclusion: string | null): CiRunRow => ({ status, conclusion });

describe("ciWaitTick — mirrors _ci_wait per-poll verdict (bin/roll)", () => {
  it("no runs → 'no-runs' (caller then checks open PR / keeps waiting)", () => {
    expect(ciWaitTick([])).toBe("no-runs");
  });
  it("any run not completed → 'pending' (checked BEFORE failed, like the oracle)", () => {
    expect(ciWaitTick([r("in_progress", null)])).toBe("pending");
    expect(ciWaitTick([r("queued", null)])).toBe("pending");
    // pending wins even if another run already failed (order matters)
    expect(ciWaitTick([r("completed", "failure"), r("in_progress", null)])).toBe("pending");
  });
  it("all completed, any conclusion not success/skipped/null → 'failed'", () => {
    expect(ciWaitTick([r("completed", "failure")])).toBe("failed");
    expect(ciWaitTick([r("completed", "cancelled")])).toBe("failed");
    expect(ciWaitTick([r("completed", "timed_out")])).toBe("failed");
  });
  it("all completed, only success/skipped → 'passed'", () => {
    expect(ciWaitTick([r("completed", "success")])).toBe("passed");
    expect(ciWaitTick([r("completed", "success"), r("completed", "skipped")])).toBe("passed");
  });
  it("null conclusion among completed is NOT failure (FIX-103 lenience)", () => {
    expect(ciWaitTick([r("completed", "success"), r("completed", null)])).toBe("passed");
  });
});
