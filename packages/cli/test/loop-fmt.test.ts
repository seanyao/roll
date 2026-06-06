/**
 * US-PORT-012 — CLI render + `roll loop fmt` stdin→stdout glue.
 *
 * The core (loop-fmt.ts) decides WHAT each stream line means (tier/kind/label);
 * this layer decides how it LOOKS (category column, color by kind, ✏ dim) and
 * pipes a whole stream. Color is asserted off for determinism — the structure
 * (category + label + detail present) is what matters.
 */
import { describe, expect, it } from "vitest";
import { renderState } from "../src/render.js";
import { formatStream, renderFmtLine } from "../src/commands/loop-fmt.js";

renderState.useColor = false; // deterministic, plain-text assertions

describe("renderFmtLine", () => {
  it("renders a signal line with category + label + detail", () => {
    const s = renderFmtLine({ tier: "signal", kind: "tcr", category: "tcr", label: "abc1234", detail: "add thing" });
    expect(s).toContain("tcr");
    expect(s).toContain("abc1234");
    expect(s).toContain("add thing");
  });
  it("renders a muted edit line carrying the ✏ basename", () => {
    const s = renderFmtLine({ tier: "muted", category: "✏", label: "✏ loop-fmt.ts" });
    expect(s).toContain("loop-fmt.ts");
  });
  it("renders a banner line carrying the label", () => {
    const s = renderFmtLine({ tier: "banner", category: "cycle", label: "cycle done", detail: "3 tcr · 42s" });
    expect(s).toContain("cycle done");
    expect(s).toContain("3 tcr");
  });
  it("an error signal (ok=false) still renders its label", () => {
    const s = renderFmtLine({ tier: "signal", kind: "alert", category: "error", label: "tool", detail: "boom", ok: false });
    expect(s).toContain("error");
    expect(s).toContain("boom");
  });
});

describe("formatStream — whole-stream folding", () => {
  it("folds a claude stream into the signal/muted lines, dropping noise", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init" }), // dropped
      JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "x" }] } }), // dropped
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "a" } }] } }), // dropped
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/x.ts" } }] } }), // muted
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "roll-build", args: "US-PORT-012" } }] } }), // signal
    ];
    const out = formatStream(lines, "claude");
    expect(out.some((l) => l.includes("x.ts"))).toBe(true);
    expect(out.some((l) => l.includes("US-PORT-012"))).toBe(true);
    // noise (system/thinking/Read) produced no output → fewer lines than inputs
    expect(out.length).toBe(2);
  });

  it("non-claude agent → transparent passthrough (no stream-json parsing)", () => {
    const lines = ["pi: thinking about the task", "pi: done"];
    const out = formatStream(lines, "pi");
    expect(out.length).toBe(2);
    expect(out[0]).toContain("thinking about the task");
  });

  it("AC4: a torn JSON line in the middle does not break the stream", () => {
    const lines = [
      '{"type":"assist', // torn
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "roll-fix", args: "FIX-1" } }] } }),
    ];
    const out = formatStream(lines, "claude");
    expect(out.length).toBe(1);
    expect(out[0]).toContain("FIX-1");
  });
});
