/**
 * US-PORT-012 — observation-window 3-tier formatter (port of lib/loop-fmt.py).
 *
 * Folds the agent's raw stream-json into a layered transcript:
 *   - Tier 3 (suppressed): system, thinking, Read/Glob/Grep, plain results → []
 *   - Tier 2 (muted):      Edit/Write → one ✏ line per consecutive file
 *   - Tier 1 (signal):     tcr / story-skill / ci-gate / peer / pr-merge / error
 *
 * Pins: each tier's classification, the pending tool_use→tool_result correlation
 * (commit hash / PR # / CI verdict live in the RESULT), bad-line tolerance
 * (AC4), and that Tier-1 lines carry the SAME SignalKind the report timeline
 * uses (AC2 single口径).
 */
import { describe, expect, it } from "vitest";
import { formatLine, newFmtState } from "../src/loop/loop-fmt.js";
import { signalKindForMarker } from "../src/loop/signals.js";

/** Convenience: run a sequence of raw lines through one state, collect output. */
function run(lines: string[]) {
  const st = newFmtState();
  return lines.flatMap((l) => formatLine(l, st));
}

const asst = (content: unknown[]) => JSON.stringify({ type: "assistant", message: { content } });
const toolUse = (name: string, input: Record<string, unknown>) => ({ type: "tool_use", name, input });
const toolResult = (text: string, isError = false) =>
  JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", is_error: isError, content: text }] } });

describe("formatLine — Tier 3 (suppressed)", () => {
  it("drops empty / whitespace lines", () => {
    expect(run(["", "   "])).toEqual([]);
  });
  it("drops system events", () => {
    expect(run([JSON.stringify({ type: "system", subtype: "init" })])).toEqual([]);
  });
  it("drops thinking blocks", () => {
    expect(run([asst([{ type: "thinking", thinking: "hmm" }])])).toEqual([]);
  });
  it("drops plain assistant text", () => {
    expect(run([asst([{ type: "text", text: "let me look at this file" }])])).toEqual([]);
  });
  it("drops Read / Glob / Grep tool_use", () => {
    expect(run([asst([toolUse("Read", { file_path: "a.ts" }), toolUse("Grep", { pattern: "x" })])])).toEqual([]);
  });
});

describe("formatLine — Tier 2 (muted edits)", () => {
  it("mutes Edit to one ✏ line carrying the basename", () => {
    const out = run([asst([toolUse("Edit", { file_path: "packages/core/src/loop/loop-fmt.ts" })])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.tier).toBe("muted");
    expect(out[0]!.label).toContain("loop-fmt.ts");
  });
  it("suppresses consecutive edits to the SAME file", () => {
    const st = newFmtState();
    const a = formatLine(asst([toolUse("Edit", { file_path: "x.ts" })]), st);
    const b = formatLine(asst([toolUse("Write", { file_path: "x.ts" })]), st);
    expect(a).toHaveLength(1);
    expect(b).toEqual([]);
  });
  it("re-emits when a DIFFERENT file is edited", () => {
    const st = newFmtState();
    formatLine(asst([toolUse("Edit", { file_path: "x.ts" })]), st);
    const b = formatLine(asst([toolUse("Edit", { file_path: "y.ts" })]), st);
    expect(b).toHaveLength(1);
    expect(b[0]!.label).toContain("y.ts");
  });
});

describe("formatLine — Tier 1 (signals)", () => {
  it("tcr: Bash commit is silent; the result emits the tcr signal with hash+msg", () => {
    const st = newFmtState();
    const cmd = formatLine(asst([toolUse("Bash", { command: "git commit -m 'tcr: add thing'" })]), st);
    expect(cmd).toEqual([]); // waits for result
    const res = formatLine(toolResult("[loop/cycle-1 abc1234] tcr: add thing\n 1 file changed"), st);
    expect(res).toHaveLength(1);
    expect(res[0]!.tier).toBe("signal");
    expect(res[0]!.kind).toBe("tcr");
    expect(res[0]!.label).toContain("abc1234");
    expect(res[0]!.detail).toContain("add thing");
  });
  it("story: Skill roll-build emits a story signal immediately", () => {
    const out = run([asst([toolUse("Skill", { skill: "roll-build", args: "US-PORT-012" })])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.tier).toBe("signal");
    expect(out[0]!.kind).toBe("skill");
    expect(out[0]!.label).toContain("US-PORT-012");
  });
  it("pr: gh pr merge is silent; the result emits the pr signal with #num", () => {
    const st = newFmtState();
    formatLine(asst([toolUse("Bash", { command: "gh pr merge --squash loop/x" })]), st);
    const res = formatLine(toolResult("Merged PR #123 (squash)"), st);
    expect(res).toHaveLength(1);
    expect(res[0]!.kind).toBe("pr");
    expect(res[0]!.label).toContain("123");
  });
  it("ci: green result is ok, red result is not", () => {
    const stG = newFmtState();
    formatLine(asst([toolUse("Bash", { command: "roll ci --wait" })]), stG);
    const green = formatLine(toolResult("CI green — all tests pass, 5 tests, 12.3s"), stG);
    expect(green[0]!.kind).toBe("ci");
    expect(green[0]!.ok).toBe(true);

    const stR = newFmtState();
    formatLine(asst([toolUse("Bash", { command: "roll ci --wait" })]), stR);
    const red = formatLine(toolResult("CI red — build failed"), stR);
    expect(red[0]!.kind).toBe("ci");
    expect(red[0]!.ok).toBe(false);
  });
  it("peer: a verdict in assistant text emits a peer signal", () => {
    const out = run([asst([{ type: "text", text: "claude → kimi round 1/3 — AGREE on the plan" }])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("peer");
    expect(out[0]!.label).toContain("claude → kimi");
    expect(out[0]!.detail).toContain("AGREE");
  });
  it("error: a tool_result error emits an alert signal (ok=false)", () => {
    const out = run([toolResult("Traceback: boom\nsecond line", true)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.tier).toBe("signal");
    expect(out[0]!.kind).toBe("alert");
    expect(out[0]!.ok).toBe(false);
  });
});

describe("formatLine — banners & resilience", () => {
  it("a cycle header is a banner and resets pending state", () => {
    const st = newFmtState();
    // arm a pending commit, then a new cycle header arrives mid-stream
    formatLine(asst([toolUse("Bash", { command: "git commit -m 'tcr: x'" })]), st);
    const banner = formatLine("── cycle 20260606-1 · US-PORT-012 · agent claude ──", st);
    expect(banner).toHaveLength(1);
    expect(banner[0]!.tier).toBe("banner");
    // pending was reset → a stray result no longer mis-fires as a tcr
    expect(formatLine(toolResult("[x abc1234] tcr: x"), st)).toEqual([]);
  });
  it("result event renders a cycle-done banner", () => {
    const out = run([JSON.stringify({ type: "result", subtype: "success", duration_ms: 5000, total_cost_usd: 0.12 })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.tier).toBe("banner");
  });
  it("AC4: malformed / half JSON does not throw and yields nothing", () => {
    expect(() => run(['{"type":"assist', "not json at all", "{partial"])).not.toThrow();
    expect(run(['{"type":"assist', "{partial"])).toEqual([]);
  });
});

describe("AC2 — formatter kinds match the report timeline taxonomy", () => {
  it("tcr/pr/ci/peer/alert kinds equal signalKindForMarker of the matching marker", () => {
    expect(run([JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", is_error: true, content: "x" }] } })])[0]!.kind)
      .toBe(signalKindForMarker("alert"));
    const st = newFmtState();
    formatLine(asst([toolUse("Bash", { command: "git commit -m 'tcr: y'" })]), st);
    expect(formatLine(toolResult("[b deadbee] tcr: y"), st)[0]!.kind).toBe(signalKindForMarker("tcr"));
    const st2 = newFmtState();
    formatLine(asst([toolUse("Bash", { command: "gh pr merge x" })]), st2);
    expect(formatLine(toolResult("Merged #9"), st2)[0]!.kind).toBe(signalKindForMarker("pr:merge"));
    const st3 = newFmtState();
    formatLine(asst([toolUse("Bash", { command: "roll ci --wait" })]), st3);
    expect(formatLine(toolResult("green pass"), st3)[0]!.kind).toBe(signalKindForMarker("ci:pass"));
  });
});
