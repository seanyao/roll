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
import { PassThrough } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cycleRow, fmtModel, renderState } from "../src/render.js";
import { formatStream, renderSignal, streamThroughRenderer, tierVisible } from "../src/commands/loop-fmt.js";
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

describe("streamThroughRenderer — status heartbeat", () => {
  it("renders event-backed status heartbeats and suppresses unchanged duplicates", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk) => chunks.push(String(chunk)));

    let calls = 0;
    const done = streamThroughRenderer(input, output, {
      agent: "claude",
      verbose: false,
      gapMs: 10,
      status: () => {
        calls += 1;
        return calls < 3
          ? "status  phase execute · quiet 5m · US-LOOP-046 · codex · cycle c1 · 1 TCR · last building"
          : "status  phase execute · quiet 6m · US-LOOP-046 · codex · cycle c1 · 1 TCR · last building";
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 45));
    input.end();
    await done;

    const lines = chunks.join("").trim().split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("quiet 5m");
    expect(lines[1]).toContain("quiet 6m");
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
      agent: "kimi",
    });
    expect(row.join("\n")).toContain("kimi-k2");
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

describe("formatStream — claude routes to the generic normalizer (pool narrowing)", () => {
  // The pool was narrowed to kimi/pi/reasonix and claude has no AgentSpec, so
  // `normalizerFor("claude")` now returns the GENERIC normalizer. A claude-shaped
  // stream is therefore not parsed for tool_use/skill turning points — every
  // non-banner line folds to a tier-C "say" that is hidden by default and only
  // surfaced with --verbose.
  it("folds a claude stream into tier-C say lines hidden by default", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "x" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/x.ts" } }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "let me think" }] } }),
    ];
    expect(formatStream(lines, "claude").length).toBe(0); // every line is tier-C, hidden by default
    expect(formatStream(lines, "claude", { verbose: true }).length).toBe(4); // verbose reveals all
  });

  it("--verbose reveals the tier-C passthrough prose", () => {
    const lines = [JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "let me think" }] } })];
    expect(formatStream(lines, "claude").length).toBe(0);
    expect(formatStream(lines, "claude", { verbose: true }).length).toBe(1);
  });
});

describe("formatStream — non-claude agents are NOT blank (the US-LOOP-077 fix)", () => {
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
  it("a torn JSON line does not break the generic stream", () => {
    // claude → generic normalizer now: a banner still surfaces (tier A) even
    // when a torn JSON line precedes it; the torn line folds to a tier-C say
    // that is hidden by default, and the stream never throws.
    const lines = [
      '{"type":"assist', // torn — tolerated, folds to tier-C say
      "── cycle 20260613-3 · FIX-1 · agent kimi ──",
    ];
    const out = formatStream(lines, "claude");
    expect(out.length).toBe(1); // only the tier-A banner is visible by default
    expect(out[0]).toContain("FIX-1");
  });
});

describe("E2E — `roll loop fmt` golden path (spawned binary, stdin→stdout)", () => {
  it("a claude cycle surfaces the banner and hides tier-C noise via the pipe", () => {
    // claude → generic normalizer now (no AgentSpec): the cycle banner is the
    // only tier-A line, so it surfaces; the stream-json bodies fold to tier-C
    // say lines that are hidden by default, so no raw JSON leaks downstream.
    const stream = [
      "── cycle 20260606-1 · US-PORT-012 · agent claude ──",
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "planning" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/loop-fmt.ts" } }] } }),
      JSON.stringify({ type: "result", subtype: "success", duration_ms: 12000, total_cost_usd: 0.05 }),
    ].join("\n") + "\n";

    const out = execFileSync("node", [CLI_BIN, "loop", "fmt"], {
      input: stream,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ROLL_LOOP_AGENT: "claude" },
    });
    expect(out).toContain("US-PORT-012"); // cycle banner (tier A) is visible
    expect(out).not.toContain("planning"); // tier-C body hidden by default
    expect(out).not.toContain('"type"'); // no raw json leaked by default
  });

  it("a claude cycle reveals its tier-C bodies under --verbose via the pipe", () => {
    // The generic normalizer passes each non-banner line through as a clipped
    // tier-C say (it does not parse stream-json fields), so --verbose surfaces
    // the line text verbatim.
    const stream = [
      "── cycle 20260613-2 · FIX-9 · agent claude ──",
      "editing src/foo.ts",
      "ran pnpm test",
    ].join("\n") + "\n";

    const out = execFileSync("node", [CLI_BIN, "loop", "fmt", "--verbose"], {
      input: stream,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ROLL_LOOP_AGENT: "claude" },
    });
    expect(out).toContain("FIX-9"); // banner
    expect(out).toContain("foo.ts"); // tier-C body now surfaced under --verbose
    expect(out).toContain("pnpm test"); // tier-C body now surfaced under --verbose
    expect(out.trim().split("\n").length).toBeGreaterThanOrEqual(3); // demonstrably not blank
  });
});
