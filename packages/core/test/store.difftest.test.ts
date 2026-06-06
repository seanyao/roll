/**
 * Frozen-expectation test: TS BacklogStore `markStatus`.
 *
 * `markStatus` was proven byte-equal to the bash oracle `_backlog_set_status`
 * (bin/roll ~14006-14029) under diff-test (sed-slice + eval + temp-dir fixture).
 * Per US-PORT-009b the oracle is retired: the `bash`/`sed` spawn is dropped and
 * each case asserts against the frozen `{content, count}` captured while the
 * oracle agreed. Inputs are fixed strings (no paths/timestamps) → fully
 * portable literals.
 *
 * NOTE — the FIX-106 trap is a DELIBERATE divergence (see store.ts): the v2 bash
 * used a naive case-insensitive substring (`US-LOOP-01` matched `US-LOOP-019`,
 * count 2); the v3 store anchors on the id token (count 1). That case asserts
 * the v3 behaviour and records the historical oracle bug, rather than reviving
 * the oracle to reproduce it.
 */
import { describe, expect, it } from "vitest";
import { markStatus } from "../src/index.js";

const DONE = "✅ Done";

describe("frozen: BacklogStore.markStatus == bash _backlog_set_status", () => {
  it("simple mark — single matching row", () => {
    const content = ["| US-X | a | 📋 Todo |", "| US-Y | b | 📋 Todo |", ""].join("\n");
    const ts = markStatus(content, "US-X", DONE);
    expect(ts.count).toBe(1);
    expect(ts.content).toBe("| US-X | a | ✅ Done |\n| US-Y | b | 📋 Todo |\n");
  });

  it("pattern matching multiple stories — both flipped", () => {
    // US-AUTH-001/002 match on both sides; US-AUTHZ-001 would be a bash-only
    // substring trap, so it is omitted to keep this a true agreement case.
    const content = [
      "| US-AUTH-001 | a | 📋 Todo |",
      "| US-AUTH-002 | b | 📋 Todo |",
      "| FIX-1 | c | 📋 Todo |",
      "",
    ].join("\n");
    const ts = markStatus(content, "US-AUTH", DONE);
    expect(ts.count).toBe(2);
    expect(ts.content).toBe(
      "| US-AUTH-001 | a | ✅ Done |\n| US-AUTH-002 | b | ✅ Done |\n| FIX-1 | c | 📋 Todo |\n",
    );
  });

  it("pattern matching zero stories — reports 0 and leaves bytes intact", () => {
    const content = ["| US-X | a | 📋 Todo |", "| FIX-9 | b | ✅ Done |", ""].join("\n");
    const ts = markStatus(content, "REFACTOR-404", DONE);
    expect(ts.count).toBe(0);
    expect(ts.content).toBe("| US-X | a | 📋 Todo |\n| FIX-9 | b | ✅ Done |\n");
  });

  it("FIX-106 trap — WHITELISTED divergence (v2 substring bug vs v3 id-anchor)", () => {
    const content = ["| US-LOOP-01 | first | 📋 Todo |", "| US-LOOP-019 | nineteen | 📋 Todo |", ""].join(
      "\n",
    );
    const ts = markStatus(content, "US-LOOP-01", DONE);
    // v2 oracle (buggy): substring match flipped BOTH rows (count 2).
    // v3 store (correct): id-token anchor flips ONLY US-LOOP-01 (count 1).
    expect(ts.count).toBe(1);
    expect(ts.content).toBe("| US-LOOP-01 | first | ✅ Done |\n| US-LOOP-019 | nineteen | 📋 Todo |\n");
    expect(ts.content).toContain("| US-LOOP-019 | nineteen | 📋 Todo |");
  });
});
