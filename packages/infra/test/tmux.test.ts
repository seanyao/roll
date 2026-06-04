/**
 * Unit tests for the Tmux module's pure session-name derivations (US-INFRA-005).
 * The exec layer (real argv reaching a fake `tmux` shim) is in
 * tmux.difftest.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  attachArgv,
  loopSessionName,
  peerSessionName,
  slugFromRunnerScript,
} from "../src/tmux.js";

describe("session-name derivation (bin/roll 9483 / 4204)", () => {
  it("loop session: roll-loop-<slug>", () => {
    expect(loopSessionName("main-abc123")).toBe("roll-loop-main-abc123");
  });
  it("peer session: roll-peer-<from>-<to>", () => {
    expect(peerSessionName("claude", "kimi")).toBe("roll-peer-claude-kimi");
  });
  it("attachArgv builds `attach -t <name>` (bin/roll 10484)", () => {
    expect(attachArgv("roll-loop-s")).toEqual(["attach", "-t", "roll-loop-s"]);
  });
});

describe("slugFromRunnerScript — mirrors `basename run-<slug>.sh .sh | sed s/^run-//` (bin/roll 9465)", () => {
  it("from a full path", () => {
    expect(slugFromRunnerScript("/sh/loop/run-main-abc123.sh")).toBe("main-abc123");
  });
  it("from a bare basename", () => {
    expect(slugFromRunnerScript("run-s.sh")).toBe("s");
  });
  it("slug containing dashes is preserved", () => {
    expect(slugFromRunnerScript("run-a-b-c.sh")).toBe("a-b-c");
  });
});
