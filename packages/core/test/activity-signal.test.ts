/**
 * US-LOOP-077 — the observability CORE: a standard ActivitySignal model + a
 * per-agent normalization layer.
 *
 * roll's thesis: normalize away agent differences via a standard layer; nothing
 * downstream is agent-specific. These tests pin:
 *
 *   - claude equivalence: the claudeNormalizer carries the SAME turning points
 *     the old US-PORT-012 formatLine surfaced (tier-A/B signals), now as
 *     ActivitySignals — an intentional migration, not drift.
 *   - codex non-blank: codex's plain text / jsonl yields meaningful signals
 *     (tests, edits, tcr, pr, tools) instead of a blank window.
 *   - generic passthrough: any unknown agent emits tier-C say lines.
 *   - heartbeat: a quiet surface beats so it never looks frozen.
 *   - tier split: default-visible (A/B) vs verbose-only (C).
 *   - the signal口径 (signalKind) still matches the report timeline taxonomy.
 */
import { describe, expect, it } from "vitest";
import {
  type ActivitySignal,
  claudeNormalizer,
  codexNormalizer,
  DEFAULT_HEARTBEAT_GAP_MS,
  genericNormalizer,
  maybeHeartbeat,
  newNormalizerState,
  normalizerFor,
} from "../src/loop/activity-signal.js";
import { signalKindForMarker } from "../src/loop/signals.js";

/** Run a sequence of raw lines through one claude state at a fixed clock. */
function runClaude(lines: string[], nowMs = 1000): ActivitySignal[] {
  const st = newNormalizerState();
  return lines.flatMap((l) => claudeNormalizer.normalize(l, st, nowMs));
}
function runCodex(lines: string[], nowMs = 1000): ActivitySignal[] {
  const st = newNormalizerState();
  return lines.flatMap((l) => codexNormalizer.normalize(l, st, nowMs));
}

const asst = (content: unknown[]) => JSON.stringify({ type: "assistant", message: { content } });
const toolUse = (name: string, input: Record<string, unknown>) => ({ type: "tool_use", name, input });
const toolResult = (text: string, isError = false) =>
  JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", is_error: isError, content: text }] } });

/** The default-visible (tier A/B) subset — what the watch shows without --verbose. */
const visible = (sigs: ActivitySignal[]) => sigs.filter((s) => s.tier === "A" || s.tier === "B");

// ════════════════════════════════════════════════════════════════════════════
// claude equivalence — the migrated US-PORT-012 turning points.
// ════════════════════════════════════════════════════════════════════════════

describe("claudeNormalizer — suppressed (no visible signal)", () => {
  it("drops empty / whitespace lines", () => {
    expect(runClaude(["", "   "])).toEqual([]);
  });
  it("drops system events", () => {
    expect(runClaude([JSON.stringify({ type: "system", subtype: "init" })])).toEqual([]);
  });
  it("drops thinking blocks", () => {
    expect(runClaude([asst([{ type: "thinking", thinking: "hmm" }])])).toEqual([]);
  });
  it("drops Read / Glob / Grep tool_use", () => {
    expect(runClaude([asst([toolUse("Read", { file_path: "a.ts" }), toolUse("Grep", { pattern: "x" })])])).toEqual([]);
  });
  it("plain assistant text is tier C (hidden by default, shown verbose)", () => {
    const all = runClaude([asst([{ type: "text", text: "let me look at this file" }])]);
    expect(all).toHaveLength(1);
    expect(all[0]!.kind).toBe("say");
    expect(all[0]!.tier).toBe("C");
    expect(visible(all)).toEqual([]); // default watch shows nothing — equivalent to old Tier 3
  });
});

describe("claudeNormalizer — edits fold to one signal per consecutive file", () => {
  it("an Edit yields one tier-B edit signal carrying the basename", () => {
    const out = runClaude([asst([toolUse("Edit", { file_path: "packages/core/src/loop/x.ts" })])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("edit");
    expect(out[0]!.tier).toBe("B");
    expect(out[0]!.summary).toContain("x.ts");
  });
  it("suppresses consecutive edits to the SAME file", () => {
    const st = newNormalizerState();
    const a = claudeNormalizer.normalize(asst([toolUse("Edit", { file_path: "x.ts" })]), st, 1);
    const b = claudeNormalizer.normalize(asst([toolUse("Write", { file_path: "x.ts" })]), st, 2);
    expect(a).toHaveLength(1);
    expect(b).toEqual([]);
  });
  it("re-emits when a DIFFERENT file is edited", () => {
    const st = newNormalizerState();
    claudeNormalizer.normalize(asst([toolUse("Edit", { file_path: "x.ts" })]), st, 1);
    const b = claudeNormalizer.normalize(asst([toolUse("Edit", { file_path: "y.ts" })]), st, 2);
    expect(b).toHaveLength(1);
    expect(b[0]!.summary).toContain("y.ts");
  });
});

describe("claudeNormalizer — turning points (same nodes as US-PORT-012)", () => {
  it("tcr: Bash commit is silent; the result emits the tcr signal with hash+msg", () => {
    const st = newNormalizerState();
    const cmd = claudeNormalizer.normalize(asst([toolUse("Bash", { command: "git commit -m 'tcr: add thing'" })]), st, 1);
    expect(cmd).toEqual([]); // waits for result (pending)
    const res = claudeNormalizer.normalize(toolResult("[loop/cycle-1 abc1234] tcr: add thing\n 1 file changed"), st, 2);
    expect(res).toHaveLength(1);
    expect(res[0]!.kind).toBe("tcr");
    expect(res[0]!.tier).toBe("A");
    expect(res[0]!.summary).toContain("abc1234");
    expect(res[0]!.detail).toContain("add thing");
    expect(res[0]!.result).toBe("pass");
  });
  it("story: Skill roll-build emits a lifecycle story signal immediately", () => {
    const out = visible(runClaude([asst([toolUse("Skill", { skill: "roll-build", args: "US-PORT-012" })])]));
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("lifecycle");
    expect(out[0]!.seg).toBe("story");
    expect(out[0]!.summary).toContain("US-PORT-012");
    expect(out[0]!.signalKind).toBe("skill");
  });
  it("pr: gh pr merge is silent; the result emits the pr signal with #num", () => {
    const st = newNormalizerState();
    claudeNormalizer.normalize(asst([toolUse("Bash", { command: "gh pr merge --squash loop/x" })]), st, 1);
    const res = claudeNormalizer.normalize(toolResult("Merged PR #123 (squash)"), st, 2);
    expect(res).toHaveLength(1);
    expect(res[0]!.kind).toBe("pr");
    expect(res[0]!.summary).toContain("123");
    expect(res[0]!.result).toBe("pass");
  });
  it("ci: green result passes, red result fails", () => {
    const stG = newNormalizerState();
    claudeNormalizer.normalize(asst([toolUse("Bash", { command: "roll ci --wait" })]), stG, 1);
    const green = claudeNormalizer.normalize(toolResult("CI green — all tests pass, 5 tests, 12.3s"), stG, 2);
    expect(green[0]!.kind).toBe("gate");
    expect(green[0]!.result).toBe("pass");

    const stR = newNormalizerState();
    claudeNormalizer.normalize(asst([toolUse("Bash", { command: "roll ci --wait" })]), stR, 1);
    const red = claudeNormalizer.normalize(toolResult("CI red — build failed"), stR, 2);
    expect(red[0]!.kind).toBe("gate");
    expect(red[0]!.result).toBe("fail");
  });
  it("peer: a verdict in assistant text emits a peer gate signal", () => {
    const out = visible(runClaude([asst([{ type: "text", text: "claude → kimi round 1/3 — AGREE on the plan" }])]));
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("gate");
    expect(out[0]!.seg).toBe("peer");
    expect(out[0]!.summary).toContain("claude → kimi");
    expect(out[0]!.detail).toContain("AGREE");
  });
  it("error: a tool_result error emits an alert (result=fail)", () => {
    const out = runClaude([toolResult("Traceback: boom\nsecond line", true)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("alert");
    expect(out[0]!.tier).toBe("A");
    expect(out[0]!.result).toBe("fail");
  });
});

describe("claudeNormalizer — banners & resilience", () => {
  it("a cycle header is a lifecycle banner, sets cycleId, and resets pending state", () => {
    const st = newNormalizerState();
    claudeNormalizer.normalize(asst([toolUse("Bash", { command: "git commit -m 'tcr: x'" })]), st, 1);
    const banner = claudeNormalizer.normalize("── cycle 20260606-1 · US-PORT-012 · agent claude ──", st, 2);
    expect(banner).toHaveLength(1);
    expect(banner[0]!.kind).toBe("lifecycle");
    expect(banner[0]!.seg).toBe("cycle");
    expect(st.cycleId).toBe("20260606-1");
    // pending was reset → a stray result no longer mis-fires as a tcr
    expect(claudeNormalizer.normalize(toolResult("[x abc1234] tcr: x"), st, 3)).toEqual([]);
  });
  it("result event renders a cycle-done lifecycle signal", () => {
    const out = runClaude([JSON.stringify({ type: "result", subtype: "success", duration_ms: 5000, total_cost_usd: 0.12 })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("lifecycle");
    expect(out[0]!.seg).toBe("end");
    expect(out[0]!.summary).toContain("cycle done");
  });
  it("malformed / half JSON does not throw and yields nothing", () => {
    expect(() => runClaude(['{"type":"assist', "not json at all", "{partial"])).not.toThrow();
    expect(runClaude(['{"type":"assist', "{partial"])).toEqual([]);
  });
});

describe("claudeNormalizer — signalKind matches the report timeline taxonomy", () => {
  it("alert / tcr / pr / ci kinds equal signalKindForMarker of the matching marker", () => {
    expect(runClaude([toolResult("x", true)])[0]!.signalKind).toBe(signalKindForMarker("alert"));
    const st = newNormalizerState();
    claudeNormalizer.normalize(asst([toolUse("Bash", { command: "git commit -m 'tcr: y'" })]), st, 1);
    expect(claudeNormalizer.normalize(toolResult("[b deadbee] tcr: y"), st, 2)[0]!.signalKind).toBe(signalKindForMarker("tcr"));
    const st2 = newNormalizerState();
    claudeNormalizer.normalize(asst([toolUse("Bash", { command: "gh pr merge x" })]), st2, 1);
    expect(claudeNormalizer.normalize(toolResult("Merged #9"), st2, 2)[0]!.signalKind).toBe(signalKindForMarker("pr:merge"));
    const st3 = newNormalizerState();
    claudeNormalizer.normalize(asst([toolUse("Bash", { command: "roll ci --wait" })]), st3, 1);
    expect(claudeNormalizer.normalize(toolResult("green pass"), st3, 2)[0]!.signalKind).toBe(signalKindForMarker("ci:pass"));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// codex — plain text / jsonl → NOT blank.
// ════════════════════════════════════════════════════════════════════════════

describe("codexNormalizer — meaningful signals from plain text", () => {
  it("a vitest fail line → test fail signal (tier A) carrying the test file ref", () => {
    const out = runCodex(["FAIL  packages/core/test/x.test.ts:42  expected 1 to be 2"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("test");
    expect(out[0]!.result).toBe("fail");
    expect(out[0]!.tier).toBe("A");
    expect(out[0]!.ref).toContain("x.test.ts:42");
    expect(out[0]!.signalKind).toBe(signalKindForMarker("ci:fail"));
  });
  it("a vitest pass summary → test pass signal (tier B)", () => {
    const out = runCodex(["Test Files  3 passed (3)"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("test");
    expect(out[0]!.result).toBe("pass");
    expect(out[0]!.tier).toBe("B");
  });
  it("an edit/diff block → edit signal, collapsing consecutive same-file lines", () => {
    const st = newNormalizerState();
    const a = codexNormalizer.normalize("✎ src/loop/activity-signal.ts", st, 1);
    const b = codexNormalizer.normalize("✎ src/loop/activity-signal.ts", st, 2);
    expect(a).toHaveLength(1);
    expect(a[0]!.kind).toBe("edit");
    expect(a[0]!.summary).toContain("activity-signal.ts");
    expect(b).toEqual([]); // same file collapses
  });
  it("a unified-diff header → edit signal", () => {
    const out = runCodex(["+++ b/packages/core/src/index.ts"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("edit");
    expect(out[0]!.summary).toContain("index.ts");
  });
  it("a command line → tool signal", () => {
    const out = runCodex(["$ pnpm -r test"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("tool");
    expect(out[0]!.summary).toContain("pnpm -r test");
  });
  it("a tcr commit line in plain output → tcr signal", () => {
    const out = runCodex(["[loop/c-1 abc1234] tcr: codex did a thing"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("tcr");
    expect(out[0]!.summary).toContain("abc1234");
    expect(out[0]!.signalKind).toBe(signalKindForMarker("tcr"));
  });
  it("a merged-PR line → pr signal", () => {
    const out = runCodex(["Merged PR #321 into main"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("pr");
    expect(out[0]!.summary).toContain("321");
  });
  it("other meaningful prose → tier-C say (hidden by default but NOT blank in verbose)", () => {
    const out = runCodex(["Thinking about how to approach the refactor"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("say");
    expect(out[0]!.tier).toBe("C");
  });
  it("jsonl frames are unwrapped to their text payload", () => {
    const out = runCodex([JSON.stringify({ type: "message", text: "$ git status" })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("tool");
    expect(out[0]!.summary).toContain("git status");
  });
  it("a codex stream is NOT blank end-to-end (the core bug US-LOOP-077 fixes)", () => {
    const out = runCodex([
      "── cycle 20260613-2 · FIX-9 · agent codex ──",
      "Reading the failing test first",
      "✎ src/foo.ts",
      "$ pnpm test",
      "FAIL  test/foo.test.ts:10",
      "✎ src/foo.ts",
      "$ pnpm test",
      "Test Files  1 passed (1)",
      "[loop/c-2 fee1234] tcr: fix foo",
      "Merged PR #42",
    ]);
    expect(out.length).toBeGreaterThan(5); // demonstrably not blank
    expect(out.some((s) => s.kind === "test" && s.result === "fail")).toBe(true);
    expect(out.some((s) => s.kind === "tcr")).toBe(true);
    expect(out.some((s) => s.kind === "pr")).toBe(true);
  });
  it("tolerates malformed input without throwing", () => {
    expect(() => runCodex(["{not json", "", "   ", " garbage"])).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// generic — any unknown agent → timestamped passthrough.
// ════════════════════════════════════════════════════════════════════════════

describe("genericNormalizer — passthrough for unknown agents", () => {
  it("emits a tier-C say for each non-empty line", () => {
    const st = newNormalizerState();
    const out = ["pi: thinking about the task", "", "pi: done"].flatMap((l) => genericNormalizer.normalize(l, st, 1));
    expect(out).toHaveLength(2);
    expect(out[0]!.kind).toBe("say");
    expect(out[0]!.tier).toBe("C");
    expect(out[0]!.summary).toContain("thinking about the task");
  });
  it("still recognizes a cycle banner and sets cycleId", () => {
    const st = newNormalizerState();
    const out = genericNormalizer.normalize("── cycle 20260613-3 · US-X · agent pi ──", st, 1);
    expect(out[0]!.kind).toBe("lifecycle");
    expect(st.cycleId).toBe("20260613-3");
  });
});

describe("normalizerFor — agent → normalizer mapping (downstream stays agnostic)", () => {
  it("claude → claudeNormalizer", () => {
    expect(normalizerFor("claude").agent).toBe("claude");
  });
  it("codex → codexNormalizer", () => {
    expect(normalizerFor("codex").agent).toBe("codex");
  });
  it("kimi / pi / unknown → genericNormalizer", () => {
    expect(normalizerFor("kimi").agent).toBe("generic");
    expect(normalizerFor("pi").agent).toBe("generic");
    expect(normalizerFor("something-new").agent).toBe("generic");
    expect(normalizerFor("").agent).toBe("generic");
  });
  it("is case-insensitive and trims", () => {
    expect(normalizerFor("  Claude ").agent).toBe("claude");
    expect(normalizerFor("CODEX").agent).toBe("codex");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// heartbeat — no surface ever looks frozen.
// ════════════════════════════════════════════════════════════════════════════

describe("maybeHeartbeat — keeps the window alive when the agent goes quiet", () => {
  it("does NOT beat before any activity has happened", () => {
    const st = newNormalizerState();
    expect(maybeHeartbeat(st, 100_000, DEFAULT_HEARTBEAT_GAP_MS)).toEqual([]);
  });
  it("does NOT beat while activity is recent", () => {
    const st = newNormalizerState();
    genericNormalizer.normalize("working…", st, 1000); // sets lastActionTs
    expect(maybeHeartbeat(st, 1000 + 1000, DEFAULT_HEARTBEAT_GAP_MS)).toEqual([]);
  });
  it("beats once the gap is exceeded, naming the segment + elapsed + last summary", () => {
    const st = newNormalizerState();
    claudeNormalizer.normalize(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "roll-build", args: "US-Z planning" } }] } }), st, 1000);
    const beat = maybeHeartbeat(st, 1000 + DEFAULT_HEARTBEAT_GAP_MS + 1, DEFAULT_HEARTBEAT_GAP_MS);
    expect(beat).toHaveLength(1);
    expect(beat[0]!.kind).toBe("heartbeat");
    expect(beat[0]!.tier).toBe("A");
    expect(beat[0]!.seg).toBe("story");
    expect(beat[0]!.summary).toContain("still in story");
    expect(beat[0]!.summary).toContain("last: US-Z");
  });
  it("does not spam: a second call inside the gap after a beat is silent", () => {
    const st = newNormalizerState();
    genericNormalizer.normalize("x", st, 1000);
    const t1 = 1000 + DEFAULT_HEARTBEAT_GAP_MS + 1;
    expect(maybeHeartbeat(st, t1, DEFAULT_HEARTBEAT_GAP_MS)).toHaveLength(1);
    expect(maybeHeartbeat(st, t1 + 100, DEFAULT_HEARTBEAT_GAP_MS)).toEqual([]); // too soon since last beat
  });
  it("works the same for any agent (claude/codex/generic) — agent-agnostic", () => {
    for (const norm of [claudeNormalizer, codexNormalizer, genericNormalizer]) {
      const st = newNormalizerState();
      norm.normalize("── cycle 20260613-9 · S · agent x ──", st, 5000);
      const beat = maybeHeartbeat(st, 5000 + DEFAULT_HEARTBEAT_GAP_MS + 1, DEFAULT_HEARTBEAT_GAP_MS);
      expect(beat).toHaveLength(1);
      expect(beat[0]!.kind).toBe("heartbeat");
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// tier defaults — A always · B fold · C verbose only.
// ════════════════════════════════════════════════════════════════════════════

describe("tier split — default tiers per kind", () => {
  it("lifecycle/tcr/pr/gate/alert/test-fail = A; edit/test-pass/tool = B; say = C", () => {
    // A: story (lifecycle)
    expect(visible(runClaude([asst([toolUse("Skill", { skill: "roll-build", args: "US-1" })])]))[0]!.tier).toBe("A");
    // A: tcr
    const stT = newNormalizerState();
    claudeNormalizer.normalize(asst([toolUse("Bash", { command: "git commit -m 'tcr: a'" })]), stT, 1);
    expect(claudeNormalizer.normalize(toolResult("[x abc1234] tcr: a"), stT, 2)[0]!.tier).toBe("A");
    // A: test fail (codex)
    expect(runCodex(["FAIL test/x.test.ts:1"])[0]!.tier).toBe("A");
    // B: test pass (codex)
    expect(runCodex(["12 passed"])[0]!.tier).toBe("B");
    // B: edit
    expect(runClaude([asst([toolUse("Edit", { file_path: "z.ts" })])])[0]!.tier).toBe("B");
    // B: tool (non-signal bash)
    expect(runClaude([asst([toolUse("Bash", { command: "ls -la" })])])[0]!.tier).toBe("B");
    // C: say
    expect(runClaude([asst([{ type: "text", text: "hmm pondering" }])])[0]!.tier).toBe("C");
  });
});
