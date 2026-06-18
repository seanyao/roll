/**
 * US-LOOP-077 — CLI render + `roll loop fmt` stdin→stdout glue.
 *
 * The core (activity-signal.ts) decides WHAT each stream line means (the standard
 * ActivitySignal); this layer decides how it LOOKS (category column, color by
 * kind, tier gating) and pipes a whole stream through the agent's normalizer.
 * Color is asserted off for determinism — the structure (visible text by tier)
 * is what matters. Key claim: codex/generic streams are NOT blank, claude stays
 * equivalent, and --verbose reveals tier C.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cycleRow, fmtModel, renderState } from "../src/render.js";
import { formatStream, renderSignal, tierVisible } from "../src/commands/loop-fmt.js";
import { defaultSmokeCmd } from "../src/commands/loop-maint.js";

const CLI_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "roll.js");

renderState.useColor = false; // deterministic, plain-text assertions

describe("renderSignal", () => {
  it("renders a tcr signal with category + summary + detail", () => {
    const s = renderSignal({ ts: 0, cycleId: "c", seg: "build", kind: "tcr", tier: "A", summary: "abc1234", detail: "add thing", result: "pass" });
    expect(s).toContain("tcr");
    expect(s).toContain("abc1234");
    expect(s).toContain("add thing");
  });
  it("renders a muted edit line carrying the basename", () => {
    const s = renderSignal({ ts: 0, cycleId: "c", seg: "build", kind: "edit", tier: "B", summary: "loop-fmt.ts" });
    expect(s).toContain("loop-fmt.ts");
  });
  it("renders a lifecycle banner carrying the summary", () => {
    const s = renderSignal({ ts: 0, cycleId: "c", seg: "end", kind: "lifecycle", tier: "A", summary: "cycle done", detail: "3 tcr · 42s" });
    expect(s).toContain("cycle done");
    expect(s).toContain("3 tcr");
  });
  it("an alert (result=fail) still renders its summary + detail", () => {
    const s = renderSignal({ ts: 0, cycleId: "c", seg: "build", kind: "alert", tier: "A", summary: "tool", detail: "boom", result: "fail" });
    expect(s).toContain("error");
    expect(s).toContain("boom");
  });
  it("a heartbeat renders its still-alive summary", () => {
    const s = renderSignal({ ts: 0, cycleId: "c", seg: "ci", kind: "heartbeat", tier: "A", summary: "…still in ci · 50s · last: roll ci" });
    expect(s).toContain("still in ci");
    expect(s).toContain("last: roll ci");
  });
});

describe("FIX-313 — downstream agent presentation uses AgentSpec", () => {
  it("fmtModel keeps non-claude model names instead of degrading to ?", () => {
    expect(fmtModel("gpt-5.5")).toBe("gpt-5.5");
    expect(fmtModel("deepseek-v4-pro")).toBe("deepseek-v4-pro");
  });

  it("cycle rows fall back to the registered agent default model", () => {
    const row = cycleRow({
      outcome: "done",
      start_hhmm: "10:00",
      duration_s: 60,
      input_tokens: 0,
      output_tokens: 0,
      model: null,
      story: "FIX-313",
      agent: "qwen",
    });
    expect(row.join("\n")).toContain("qwen-coder-plus");
  });

  it("cycle rows surface the tool summary without changing the native cost currency", () => {
    const row = cycleRow({
      outcome: "done",
      start_hhmm: "10:00",
      duration_s: 60,
      input_tokens: 0,
      output_tokens: 0,
      cost_currency: "CNY",
      cost_list: 1.25,
      story: "US-TOOL-012",
      agent: "qwen",
      tool_summary: "bash×3(21s)·browser×1(3.0s)",
    });
    const out = row.join("\n");
    expect(out).toContain("¥1.25");
    expect(out).toContain("bash×3(21s)·browser×1(3.0s)");
    expect(out).not.toContain("$1.25");
  });

  it("loop smoke commands come from the registry, not non-claude mocks", () => {
    expect(defaultSmokeCmd("kimi")).toContain("kimi");
    expect(defaultSmokeCmd("kimi")).not.toContain("mock kimi");
  });
});

describe("tierVisible", () => {
  it("default shows A and B, hides C", () => {
    expect(tierVisible("A", false)).toBe(true);
    expect(tierVisible("B", false)).toBe(true);
    expect(tierVisible("C", false)).toBe(false);
  });
  it("verbose shows everything including C", () => {
    expect(tierVisible("C", true)).toBe(true);
  });
});

describe("formatStream — claude stays equivalent (turning points, noise gone)", () => {
  it("folds a claude stream into edit/story signals, dropping noise + tier C", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init" }), // dropped
      JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "x" }] } }), // dropped
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "a" } }] } }), // dropped
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "let me think" }] } }), // tier C → hidden by default
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/x.ts" } }] } }), // B
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "roll-build", args: "US-PORT-012" } }] } }), // A
    ];
    const out = formatStream(lines, "claude");
    expect(out.some((l) => l.includes("x.ts"))).toBe(true);
    expect(out.some((l) => l.includes("US-PORT-012"))).toBe(true);
    expect(out.some((l) => l.includes("let me think"))).toBe(false); // tier C hidden by default
    expect(out.length).toBe(2); // edit + story only
  });

  it("--verbose reveals the tier-C assistant prose", () => {
    const lines = [JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "let me think" }] } })];
    expect(formatStream(lines, "claude").length).toBe(0);
    expect(formatStream(lines, "claude", { verbose: true }).length).toBe(1);
  });
});

describe("formatStream — non-claude agents are NOT blank (the US-LOOP-077 fix)", () => {
  it("codex plain text yields real signals (test/edit/tool) by default tier", () => {
    const lines = [
      "✎ src/x.ts",
      "$ pnpm test",
      "FAIL  test/x.test.ts:7",
    ];
    const out = formatStream(lines, "codex");
    expect(out.length).toBe(3); // edit (B) + tool (B) + test-fail (A) — none dropped
    expect(out.some((l) => l.includes("x.ts"))).toBe(true);
    expect(out.some((l) => l.includes("pnpm test"))).toBe(true);
    expect(out.some((l) => l.includes("x.test.ts:7"))).toBe(true);
  });
  it("a generic (kimi/pi) agent passes lines through only with --verbose (tier C)", () => {
    const lines = ["pi: thinking about the task", "pi: done"];
    expect(formatStream(lines, "pi").length).toBe(0); // tier C hidden by default
    const v = formatStream(lines, "pi", { verbose: true });
    expect(v.length).toBe(2);
    expect(v[0]).toContain("thinking about the task");
  });
  it("an unknown agent name routes to generic (no agent-specific branch downstream)", () => {
    const out = formatStream(["something-new agent output line"], "brand-new-agent", { verbose: true });
    expect(out.length).toBe(1);
    expect(out[0]).toContain("agent output line");
  });
});

describe("formatStream — resilience", () => {
  it("a torn JSON line in a claude stream does not break the stream", () => {
    const lines = [
      '{"type":"assist', // torn
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "roll-fix", args: "FIX-1" } }] } }),
    ];
    const out = formatStream(lines, "claude");
    expect(out.length).toBe(1);
    expect(out[0]).toContain("FIX-1");
  });
});

describe("E2E — `roll loop fmt` golden path (spawned binary, stdin→stdout)", () => {
  it("folds a real claude cycle stream into a readable transcript via the pipe", () => {
    const stream = [
      "── cycle 20260606-1 · US-PORT-012 · agent claude ──",
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "planning" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "x.ts" } }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/loop-fmt.ts" } }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git commit -m 'tcr: ship it'" } }] } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", is_error: false, content: "[loop/x abc1234] tcr: ship it" }] } }),
      JSON.stringify({ type: "result", subtype: "success", duration_ms: 12000, total_cost_usd: 0.05 }),
    ].join("\n") + "\n";

    const out = execFileSync("node", [CLI_BIN, "loop", "fmt"], {
      input: stream,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ROLL_LOOP_AGENT: "claude" },
    });
    expect(out).toContain("US-PORT-012"); // cycle banner
    expect(out).toContain("loop-fmt.ts"); // muted edit
    expect(out).toContain("abc1234"); // tcr signal
    expect(out).toContain("ship it");
    expect(out).toContain("cycle done");
    expect(out).not.toContain("planning"); // thinking suppressed
    expect(out).not.toContain('"type"'); // no raw json leaked
  });

  it("a codex cycle is NOT blank through the pipe (ROLL_LOOP_AGENT=codex)", () => {
    const stream = [
      "── cycle 20260613-2 · FIX-9 · agent codex ──",
      "✎ src/foo.ts",
      "$ pnpm test",
      "FAIL  test/foo.test.ts:10  expected ok",
      "[loop/c fee1234] tcr: fix foo",
      "Merged PR #42",
    ].join("\n") + "\n";

    const out = execFileSync("node", [CLI_BIN, "loop", "fmt"], {
      input: stream,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ROLL_LOOP_AGENT: "codex" },
    });
    expect(out).toContain("FIX-9"); // banner
    expect(out).toContain("foo.ts"); // edit
    expect(out).toContain("pnpm test"); // tool
    expect(out).toContain("foo.test.ts:10"); // test fail
    expect(out).toContain("fee1234"); // tcr
    expect(out).toContain("#42"); // pr
    expect(out.trim().split("\n").length).toBeGreaterThanOrEqual(5); // demonstrably not blank
  });
});
