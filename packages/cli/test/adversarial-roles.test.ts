/**
 * US-LOOP-101 — role-aware spawn: the three adversarial roles carry DISTINCT,
 * constraint-bearing prompts so the test author, the implementer, and the
 * attacker cannot drift into each other's job. adversarialRolePrompt is a pure
 * framing function (no I/O); the orchestrator (US-LOOP-102) passes its output as
 * the spawn skillBody.
 */
import { describe, expect, it } from "vitest";
import { adversarialRolePrompt } from "../src/runner/agent-spawn.js";

describe("adversarialRolePrompt — role-separated, constraint-bearing prompts", () => {
  it("test_author: writes FAILING tests from the AC, must NOT write production code or read the implementation", () => {
    const p = adversarialRolePrompt("test_author");
    expect(p).toMatch(/fail|red/i);          // writes failing/red tests
    expect(p).toMatch(/AC|acceptance|contract/i);
    expect(p).toMatch(/not.*(implementation|production)|do not (write|read).*(implementation|production)/i);
  });

  it("implementer: writes ONLY production code to green the tests, must NOT modify test files", () => {
    const p = adversarialRolePrompt("implementer");
    expect(p).toMatch(/production code/i);
    expect(p).toMatch(/not.*(modify|edit|touch|change).*test|do not.*test/i);
  });

  it("attacker: adds ONLY new breaking tests (one failure mode each), must NOT edit existing tests or production code", () => {
    const p = adversarialRolePrompt("attacker");
    expect(p).toMatch(/break|breaking|attack/i);
    expect(p).toMatch(/new test|add.*test|additional test/i);
    expect(p).toMatch(/not.*(edit|modify|change).*(existing test|production)/i);
  });

  it("each role prompt is distinct (no two roles share the same framing)", () => {
    const ta = adversarialRolePrompt("test_author");
    const im = adversarialRolePrompt("implementer");
    const at = adversarialRolePrompt("attacker");
    expect(new Set([ta, im, at]).size).toBe(3);
  });

  it("an unknown role fails loud (throws) — never returns an empty/undefined framing (a role-less agent has zero constraints)", () => {
    // Defense-in-depth: if the orchestrator ever passes an off-type role (a bug),
    // the spawn must NOT proceed with a role-less prompt. Fail loud instead.
    expect(() => adversarialRolePrompt("bogus" as unknown as "attacker")).toThrow();
  });
});
