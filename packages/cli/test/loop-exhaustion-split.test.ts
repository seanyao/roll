/**
 * FIX-931 — agent-exhaustion auto-split. The command is a TRIGGER EDGE over the
 * existing self-downgrade machine: $roll-design mints sub-stories, then
 * loopSelfDowngradeCommand lands the split (or ALERTs on irreducible/cap). Tested
 * with injected design + selfDowngrade (no real agent spawn, no real backlog).
 */
import { describe, expect, it, vi } from "vitest";
import { loopExhaustionSplitCommand, type ExhaustionSplitDeps } from "../src/commands/loop-exhaustion-split.js";

function capture(fn: () => Promise<number>): Promise<{ status: number; out: string }> {
  const o: string[] = [];
  const wo = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((x: string | Uint8Array) => (o.push(String(x)), true)) as typeof process.stdout.write;
  return fn()
    .then((status) => ({ status, out: o.join("") }))
    .finally(() => {
      process.stdout.write = wo;
    });
}

function baseDeps(over: Partial<ExhaustionSplitDeps> = {}): ExhaustionSplitDeps {
  return {
    design: vi.fn(async () => ["FIX-Z-a", "FIX-Z-b"]),
    selfDowngrade: vi.fn(async () => 0),
    log: () => {},
    ...over,
  };
}

describe("FIX-931 loopExhaustionSplitCommand", () => {
  it("design ≥2 sub-stories → self-downgrade lands the split with an auto-split reason", async () => {
    const selfDowngrade = vi.fn(async () => 0);
    const r = await capture(() => loopExhaustionSplitCommand(["FIX-Z", "3 failed cycles"], baseDeps({ selfDowngrade })));
    expect(r.status).toBe(0);
    expect(selfDowngrade).toHaveBeenCalledTimes(1);
    const [storyId, reason, subIds] = selfDowngrade.mock.calls[0]!;
    expect(storyId).toBe("FIX-Z");
    expect(reason).toContain("auto-split on agent-exhaustion");
    expect(reason).toContain("3 failed cycles");
    expect(subIds).toEqual(["FIX-Z-a", "FIX-Z-b"]);
  });

  it("design <2 (irreducible) → still hands to self-downgrade (which parks Hold + ALERTs for triage)", async () => {
    const selfDowngrade = vi.fn(async () => 0);
    const r = await capture(() =>
      loopExhaustionSplitCommand(["FIX-Z"], baseDeps({ design: async () => ["FIX-Z-only"], selfDowngrade })),
    );
    expect(r.status).toBe(0);
    expect(selfDowngrade).toHaveBeenCalledWith("FIX-Z", expect.stringContaining("auto-split"), ["FIX-Z-only"]);
  });

  it("design produced nothing → self-downgrade with [] (the irreducible fail-closed path)", async () => {
    const selfDowngrade = vi.fn(async () => 0);
    await capture(() => loopExhaustionSplitCommand(["FIX-Z"], baseDeps({ design: async () => [], selfDowngrade })));
    expect(selfDowngrade).toHaveBeenCalledWith("FIX-Z", expect.any(String), []);
  });

  it("propagates the self-downgrade exit code", async () => {
    const r = await capture(() => loopExhaustionSplitCommand(["FIX-Z"], baseDeps({ selfDowngrade: async () => 3 })));
    expect(r.status).toBe(3);
  });

  it("empty story id → usage (exit 2), never touches the splitter", async () => {
    const selfDowngrade = vi.fn(async () => 0);
    const design = vi.fn(async () => ["a", "b"]);
    const r = await loopExhaustionSplitCommand([], baseDeps({ selfDowngrade, design }));
    expect(r).toBe(2);
    expect(selfDowngrade).not.toHaveBeenCalled();
    expect(design).not.toHaveBeenCalled();
  });

  it("default reason is used when none is given", async () => {
    const selfDowngrade = vi.fn(async () => 0);
    await capture(() => loopExhaustionSplitCommand(["FIX-Z"], baseDeps({ selfDowngrade })));
    expect(selfDowngrade.mock.calls[0]![1]).toContain("every agent exhausted");
  });
});
