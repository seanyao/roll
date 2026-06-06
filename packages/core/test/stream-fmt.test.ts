/**
 * US-PORT-012 — watch-window stream formatter (port of v2 lib/loop-fmt.py).
 * Pins the three tiers, the shared signal口径, and bad-line tolerance.
 */
import { describe, expect, it } from "vitest";
import { signalLabel } from "../src/loop/transcript.js";
import { isFmtSignal, StreamFormatter } from "../src/loop/stream-fmt.js";

const j = (o: unknown): string => JSON.stringify(o);

/** Feed a batch of lines, return the flattened formatted output. */
function run(lines: string[], color = false): ReturnType<StreamFormatter["feed"]> {
  const fmt = new StreamFormatter({ color });
  return lines.flatMap((l) => fmt.feed(l));
}

describe("StreamFormatter — Tier 3 suppression", () => {
  it("suppresses system events, thinking, and read-class tools", () => {
    const out = run([
      j({ type: "system", subtype: "init" }),
      j({ type: "assistant", message: { content: [{ type: "thinking", text: "hmm" }] } }),
      j({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/a.ts" } }] } }),
      j({ type: "assistant", message: { content: [{ type: "tool_use", name: "Grep", input: { pattern: "x" } }] } }),
      j({ type: "assistant", message: { content: [{ type: "text", text: "just narrating" }] } }),
    ]);
    expect(out).toEqual([]);
  });
});

describe("StreamFormatter — Tier 2 edit streak", () => {
  it("collapses consecutive same-file edits into a running ×N", () => {
    const edit = (p: string): string => j({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: p, new_string: "const x = 1" } }] } });
    const out = run([edit("/x/foo.ts"), edit("/x/foo.ts"), edit("/x/foo.ts")]);
    expect(out.map((l) => l.text)).toEqual(["  ✏ foo.ts | const", "  ✏ foo.ts | const ×2", "  ✏ foo.ts | const ×3"]);
    expect(out.every((l) => l.layer === "muted")).toBe(true);
  });

  it("a different file starts a fresh streak (no ×N)", () => {
    const edit = (p: string): string => j({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: p, new_string: "y" } }] } });
    const out = run([edit("/a.ts"), edit("/b.ts")]);
    expect(out.map((l) => l.text)).toEqual(["  ✏ a.ts | y", "  ✏ b.ts | y"]);
  });
});

describe("StreamFormatter — Tier 1 signals via shared signalLabel", () => {
  it("a tcr commit renders the shared TCR label", () => {
    const out = run([
      j({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git commit -m 'tcr: add foo'" } }] } }),
      j({ type: "user", message: { content: [{ type: "tool_result", content: "[loop/x abc1234] tcr: add foo\n 1 file changed" }] } }),
    ]);
    const tcr = out.find((l) => l.marker === "tcr");
    expect(tcr).toBeDefined();
    expect(tcr!.text).toContain(signalLabel({ kind: "tcr", commitHash: "abc1234", message: "tcr: add foo" }));
    expect(isFmtSignal(tcr!)).toBe(true);
  });

  it("a gh pr merge renders the shared pr:merge label", () => {
    const out = run([
      j({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "gh pr merge --squash loop/x" } }] } }),
      j({ type: "user", message: { content: [{ type: "tool_result", content: "merged PR #490 into main" }] } }),
    ]);
    const pr = out.find((l) => l.marker === "pr:merge");
    expect(pr).toBeDefined();
    expect(pr!.text).toContain(signalLabel({ kind: "pr:merge", prNumber: 490 }));
  });

  it("a green roll ci renders the shared ci:pass label", () => {
    const out = run([
      j({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "roll ci --wait" } }] } }),
      j({ type: "user", message: { content: [{ type: "tool_result", content: "CI green for PR #490 — all tests pass in 12.5s" }] } }),
    ]);
    const ci = out.find((l) => l.marker === "ci:pass");
    expect(ci).toBeDefined();
    expect(ci!.text).toContain(signalLabel({ kind: "ci:pass", prNumber: 490 }));
  });

  it("a tool error surfaces as an error signal and clears pending state", () => {
    const out = run([
      j({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git commit -m 'tcr: x'" } }] } }),
      j({ type: "user", message: { content: [{ type: "tool_result", is_error: true, content: "fatal: nothing to commit" }] } }),
    ]);
    expect(out.find((l) => l.marker === "error")).toBeDefined();
    // pending commit was cleared — no tcr line minted from the error
    expect(out.find((l) => l.marker === "tcr")).toBeUndefined();
  });

  it("a peer verdict surfaces as a peer:gate signal", () => {
    const out = run([
      j({ type: "assistant", message: { content: [{ type: "text", text: "claude → kimi round 2/3: AGREE on the plan" }] } }),
    ]);
    const peer = out.find((l) => l.marker === "peer:gate");
    expect(peer).toBeDefined();
    expect(peer!.text).toContain("AGREE");
  });

  it("a roll-build Skill prints the story header", () => {
    const out = run([
      j({ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "roll-build", args: "US-PORT-012 do the thing" } }] } }),
    ]);
    expect(out.find((l) => l.marker === "story")?.text).toContain("US-PORT-012");
  });

  it("the result event prints a cycle-done stamp with tcr count", () => {
    const fmt = new StreamFormatter();
    fmt.feed(j({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git commit -m 'tcr: a'" } }] } }));
    fmt.feed(j({ type: "user", message: { content: [{ type: "tool_result", content: "[loop/x aaaaaaa] tcr: a" }] } }));
    const out = fmt.feed(j({ type: "result", subtype: "success", duration_ms: 5000, total_cost_usd: 0.42 }));
    expect(out[0]?.text).toMatch(/done · 1 tcr · 5s · \$0\.42/);
    expect(out[0]?.layer).toBe("outline");
  });
});

describe("StreamFormatter — resilience (AC4: bad lines never crash)", () => {
  it("a half-written JSON line is tolerated (no throw, no output)", () => {
    const fmt = new StreamFormatter();
    expect(() => fmt.feed('{"type":"assist')).not.toThrow();
    expect(fmt.feed('{"type":"assist')).toEqual([]);
  });

  it("blank lines and non-cycle plain text are suppressed", () => {
    expect(run(["", "   ", "some raw log line"])).toEqual([]);
  });

  it("a [loop] cycle plain line becomes a cycle stamp", () => {
    const out = run(["[loop] cycle 7: picking story"]);
    expect(out[0]?.text).toContain("cycle #7");
    expect(out[0]?.marker).toBe("cycle");
  });

  it("non-object JSON (number, array, null) is ignored", () => {
    expect(run(["42", "[1,2,3]", "null", '"a string"'])).toEqual([]);
  });
});
