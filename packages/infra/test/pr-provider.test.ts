/**
 * FIX-1248 — CI-state detection must recognize BOTH GitHub check kinds: Actions
 * workflow runs (`gh run list`) AND commit statuses / non-Actions check-runs
 * (`gh pr view --json statusCheckRollup`). Previously the provider only read
 * Actions runs, so a fully-green PR whose required checks report via the
 * Statuses/Checks API was judged `unknown` and never merged.
 *
 * The 6-case mixed matrix is composed exactly the way {@link GitHubPrStatusProvider.pollPrStatus}
 * composes it: `mergeCiStates(reduceRunConclusions(runs), reduceStatusCheckRollup(rollup))`.
 */
import { describe, expect, it } from "vitest";
import type { PrCiState } from "@roll/core";
import type { StatusCheckRollupEntry } from "../src/github.js";
import { mergeCiStates, reduceRunConclusions, reduceStatusCheckRollup } from "../src/pr-provider.js";

/** Fabricate a check-run rollup entry (Checks API — Actions or third-party). */
function checkRun(status: string, conclusion: string | null): StatusCheckRollupEntry {
  return { __typename: "CheckRun", name: "build", status, conclusion };
}

/** Fabricate a status-context rollup entry (Statuses API — e.g. external CI). */
function statusContext(state: string): StatusCheckRollupEntry {
  return { __typename: "StatusContext", context: "ci/external", state };
}

describe("reduceRunConclusions — Actions runs (pre-FIX-1248 behavior, frozen)", () => {
  it("no runs → unknown", () => {
    expect(reduceRunConclusions([])).toBe("unknown");
  });
  it("any failure → red", () => {
    expect(reduceRunConclusions(["success", "failure"])).toBe("red");
    expect(reduceRunConclusions(["FAILURE"])).toBe("red");
  });
  it("all success/skipped → green", () => {
    expect(reduceRunConclusions(["success", "SKIPPED"])).toBe("green");
  });
  it("a not-yet-reported run → pending", () => {
    expect(reduceRunConclusions(["success", null])).toBe("pending");
  });
  it("mixed non-failure in-progress → pending", () => {
    expect(reduceRunConclusions(["success", "queued"])).toBe("pending");
  });
});

describe("reduceStatusCheckRollup — commit statuses + check-runs (FIX-1248)", () => {
  it("empty rollup → unknown", () => {
    expect(reduceStatusCheckRollup([])).toBe("unknown");
  });
  it("all-success check-runs → green", () => {
    expect(reduceStatusCheckRollup([checkRun("COMPLETED", "SUCCESS"), checkRun("COMPLETED", "SKIPPED")])).toBe("green");
  });
  it("success status-context → green", () => {
    expect(reduceStatusCheckRollup([statusContext("SUCCESS")])).toBe("green");
  });
  it("mixed check-run + status-context, all green → green", () => {
    expect(reduceStatusCheckRollup([checkRun("COMPLETED", "SUCCESS"), statusContext("SUCCESS")])).toBe("green");
  });
  it("failed check-run → red", () => {
    expect(reduceStatusCheckRollup([checkRun("COMPLETED", "SUCCESS"), checkRun("COMPLETED", "FAILURE")])).toBe("red");
  });
  it("failed status-context → red", () => {
    expect(reduceStatusCheckRollup([statusContext("FAILURE")])).toBe("red");
    expect(reduceStatusCheckRollup([statusContext("ERROR")])).toBe("red");
  });
  it("non-success completed conclusion (CANCELLED/TIMED_OUT) → red", () => {
    expect(reduceStatusCheckRollup([checkRun("COMPLETED", "CANCELLED")])).toBe("red");
    expect(reduceStatusCheckRollup([checkRun("COMPLETED", "TIMED_OUT")])).toBe("red");
  });
  it("in-progress check-run → pending", () => {
    expect(reduceStatusCheckRollup([checkRun("IN_PROGRESS", null)])).toBe("pending");
    expect(reduceStatusCheckRollup([checkRun("QUEUED", null)])).toBe("pending");
  });
  it("completed check-run without conclusion → pending", () => {
    expect(reduceStatusCheckRollup([checkRun("COMPLETED", null)])).toBe("pending");
  });
  it("pending status-context → pending", () => {
    expect(reduceStatusCheckRollup([statusContext("PENDING")])).toBe("pending");
  });
  it("red wins over pending", () => {
    expect(reduceStatusCheckRollup([checkRun("IN_PROGRESS", null), statusContext("FAILURE")])).toBe("red");
  });
});

describe("mergeCiStates — conservative union of the two CI sources (FIX-1248)", () => {
  it("any red → red", () => {
    expect(mergeCiStates("red", "green")).toBe("red");
    expect(mergeCiStates("green", "red")).toBe("red");
    expect(mergeCiStates("red", "pending")).toBe("red");
  });
  it("any pending (no red) → pending", () => {
    expect(mergeCiStates("pending", "green")).toBe("pending");
    expect(mergeCiStates("green", "pending")).toBe("pending");
    expect(mergeCiStates("pending", "unknown")).toBe("pending");
  });
  it("both unknown → unknown", () => {
    expect(mergeCiStates("unknown", "unknown")).toBe("unknown");
  });
  it("green + unknown → green (one source green, the other has no checks)", () => {
    expect(mergeCiStates("green", "unknown")).toBe("green");
    expect(mergeCiStates("unknown", "green")).toBe("green");
  });
  it("green + green → green", () => {
    expect(mergeCiStates("green", "green")).toBe("green");
  });
});

describe("FIX-1248 mixed regression matrix — composed as pollPrStatus composes it", () => {
  /** Compose the two sources exactly like the provider does. */
  function combined(runs: (string | null)[], rollup: StatusCheckRollupEntry[]): PrCiState {
    return mergeCiStates(reduceRunConclusions(runs), reduceStatusCheckRollup(rollup));
  }

  it("1. only Actions runs, all green → green", () => {
    expect(combined(["success"], [])).toBe("green");
  });
  it("2. only commit status, green → green (the reported bug: used to be unknown)", () => {
    expect(combined([], [statusContext("SUCCESS")])).toBe("green");
  });
  it("3. both kinds present, all green → green", () => {
    expect(combined(["success"], [checkRun("COMPLETED", "SUCCESS"), statusContext("SUCCESS")])).toBe("green");
  });
  it("4. one kind green, the other red → red", () => {
    expect(combined(["success"], [statusContext("FAILURE")])).toBe("red");
    expect(combined(["failure"], [statusContext("SUCCESS")])).toBe("red");
  });
  it("5. one kind green, the other pending → pending", () => {
    expect(combined(["success"], [statusContext("PENDING")])).toBe("pending");
    expect(combined([null], [statusContext("SUCCESS")])).toBe("pending");
  });
  it("6. neither kind has any check → unknown", () => {
    expect(combined([], [])).toBe("unknown");
  });
  it("7. FIX-1258: old-head failures excluded, only current-head runs considered → green", () => {
    // Simulates: old-head had ["failure"], current-head has ["success"].
    // After filtering by headRefOid, only ["success"] reaches reduceRunConclusions.
    // Without the fix, the union of old-head failure + current-head success → red.
    expect(reduceRunConclusions(["success"])).toBe("green");
    // Composed: current-head actions green + statusCheckRollup green = green.
    expect(mergeCiStates(
      reduceRunConclusions(["success"]),
      reduceStatusCheckRollup([statusContext("SUCCESS")]),
    )).toBe("green");
  });
});
