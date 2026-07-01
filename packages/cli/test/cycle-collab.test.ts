/** US-OBS-039 — `roll cycle <id> --collab`: single-cycle collaboration relay. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCycleRoleSummary, projectCollabCycle } from "@roll/core";
import type { RollEvent } from "@roll/spec";
import { cycleCommand } from "../src/commands/cycle.js";
import { renderCollabCycle } from "../src/lib/collab-render.js";
import { stripAnsi } from "../src/render.js";

const SUPERVISOR = "codex";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env["ROLL_LANG"];
});

function project(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-cycle-collab-"));
  dirs.push(p);
  const rt = join(p, ".roll", "loop");
  mkdirSync(rt, { recursive: true });
  writeFileSync(
    join(rt, "runs.jsonl"),
    [
      JSON.stringify({
        cycle_id: WALKED_CYCLE,
        status: "merged",
        outcome: "delivered",
        story_id: "FIX-1034",
        agent: "pi",
        model: "deepseek-v4-pro",
        ts: "2026-06-29T14:30:00Z",
        duration_sec: 600,
      }),
      JSON.stringify({
        cycle_id: ESCALATED_CYCLE,
        status: "failed",
        outcome: "gave_up",
        story_id: "FIX-1032a",
        agent: "pi",
        model: "deepseek-v4-pro",
        ts: "2026-06-29T14:40:00Z",
        duration_sec: 700,
      }),
    ].join("\n") + "\n",
  );
  writeFileSync(join(rt, "events.ndjson"), [...walkedEvents, ...escalatedEvents].map((e) => JSON.stringify(e)).join("\n") + "\n");
  return p;
}

const WALKED_CYCLE = "20260629-143000-61717";

const walkedEvents: RollEvent[] = [
  {
    type: "cycle:start",
    cycleId: WALKED_CYCLE,
    storyId: "FIX-1034",
    agent: "pi",
    model: "deepseek-v4-pro",
    ts: 1_000,
  },
  {
    type: "execution:profile",
    cycleId: WALKED_CYCLE,
    storyId: "FIX-1034",
    profile: "verified",
    reason: "high-risk fix",
    ts: 1_010,
  },
  { type: "cycle:first_edit", cycleId: WALKED_CYCLE, commitHash: "abc", ts: 1_100 },
  { type: "cycle:tcr", cycleId: WALKED_CYCLE, commitHash: "def", message: "tcr: fix root cause", ts: 1_200 },
  {
    type: "pair:selected",
    cycleId: WALKED_CYCLE,
    workingAgent: "pi",
    peer: "reasonix",
    stage: "review",
    ts: 1_300,
  },
  {
    type: "pair:consult",
    cycleId: WALKED_CYCLE,
    peer: "reasonix",
    durationMs: 12000,
    outcome: "reviewed",
    ts: 1_400,
  },
  {
    type: "pair:verdict",
    cycleId: WALKED_CYCLE,
    peer: "reasonix",
    verdict: "agree",
    findings: 0,
    cost: 0.01,
    stage: "review",
    ts: 1_500,
  },
  {
    type: "peer:gate",
    cycleId: WALKED_CYCLE,
    verdict: "consulted",
    reasons: ["peer review completed"],
    ts: 1_600,
  },
  {
    type: "pair:selected",
    cycleId: WALKED_CYCLE,
    workingAgent: "pi",
    peer: "claude",
    stage: "score",
    ts: 1_700,
  },
  {
    type: "pair:score-failure",
    cycleId: WALKED_CYCLE,
    peer: "claude",
    reason: "timeout",
    ts: 1_750,
  },
  {
    type: "pair:score-failure",
    cycleId: WALKED_CYCLE,
    peer: "kimi",
    reason: "timeout",
    ts: 1_760,
  },
  {
    type: "pair:score",
    cycleId: WALKED_CYCLE,
    peer: "claude",
    score: 8,
    verdict: "good",
    cost: 0.02,
    stage: "score",
    ts: 1_800,
  },
  {
    type: "attest:gate",
    cycleId: WALKED_CYCLE,
    verdict: "produced",
    reasons: ["review-score good 8/10 present"],
    ts: 1_900,
  },
  {
    type: "cycle:terminal",
    schema: 1,
    cycleId: WALKED_CYCLE,
    storyId: "FIX-1034",
    agent: "pi",
    model: "deepseek-v4-pro",
    startedAt: 1_000,
    endedAt: 2_000,
    outcome: "published_pending_merge",
    pr: { present: false, reason: "no_publish_attempted" },
    branch: { present: true, value: "loop/FIX-1034" },
    commit: { present: true, value: "def" },
    tcr: { present: true, value: 1 },
    attest: { present: true, value: { reportPath: ".roll/...", acMap: true } },
    usage: { present: false, reason: "no_parseable_usage" },
    cost: { present: false, reason: "no_parseable_usage" },
    ts: 2_000,
  },
];

const ESCALATED_CYCLE = "20260629-144000-4086";

const escalatedEvents: RollEvent[] = [
  {
    type: "cycle:start",
    cycleId: ESCALATED_CYCLE,
    storyId: "FIX-1032a",
    agent: "pi",
    model: "deepseek-v4-pro",
    ts: 3_000,
  },
  { type: "cycle:first_edit", cycleId: ESCALATED_CYCLE, commitHash: "aaa", ts: 3_100 },
  {
    type: "agent:stall",
    cycleId: ESCALATED_CYCLE,
    agent: "pi",
    idleSec: 601,
    thresholdSec: 600,
    ts: 3_700,
  },
  {
    type: "cycle:end",
    cycleId: ESCALATED_CYCLE,
    outcome: "gave_up",
    cost: {
      cycleId: ESCALATED_CYCLE,
      agent: "pi",
      model: "deepseek-v4-pro",
      tokensIn: 0,
      tokensOut: 0,
      estimatedCost: 0,
      revertCount: 0,
      effectiveCost: 0,
    },
    ts: 3_800,
  },
];

function walkedView() {
  const summary = buildCycleRoleSummary({
    cycleId: WALKED_CYCLE,
    events: walkedEvents,
    eventsPath: ".roll/loop/events.ndjson",
    peerDir: ".roll/loop/peer",
    cycleLogDir: ".roll/loop/cycle-logs",
  });
  return projectCollabCycle(summary, walkedEvents, SUPERVISOR);
}

function escalatedView() {
  const summary = buildCycleRoleSummary({
    cycleId: ESCALATED_CYCLE,
    events: escalatedEvents,
    eventsPath: ".roll/loop/events.ndjson",
    peerDir: ".roll/loop/peer",
    cycleLogDir: ".roll/loop/cycle-logs",
  });
  return projectCollabCycle(summary, escalatedEvents, SUPERVISOR);
}

describe("renderCollabCycle", () => {
  it("renders a walked_full cycle as a relay with terminus glyph", () => {
    const out = stripAnsi(renderCollabCycle(walkedView(), { color: false, fold: true, width: 72, lang: "en" }));
    expect(out).toContain("FIX-1034");
    expect(out).toContain("assign builder = pi");
    expect(out).toContain("build → TCR ×1");
    expect(out).toContain("▸agree");
    expect(out).toContain("▸good/8");
    expect(out).toContain("▸produced");
    expect(out).toContain("walked full protocol ✓");
    expect(out).not.toContain("success");
    expect(out).not.toContain("failure");
  });

  it("renders an escalated cycle with a boxed callout", () => {
    const out = stripAnsi(renderCollabCycle(escalatedView(), { color: false, fold: true, width: 72, lang: "en" }));
    expect(out).toContain("FIX-1032a");
    expect(out).toContain("⤴ escalation");
    expect(out).toContain("baton returned from");
    expect(out).toContain("reroute");
    expect(out).toContain("escalated ⤴");
    expect(out).not.toContain("success");
    expect(out).not.toContain("failure");
  });

  it("summarizes folded noise with counters", () => {
    const out = stripAnsi(
      renderCollabCycle(walkedView(), { color: false, fold: true, width: 72, lang: "en" }, { scoreFailures: 2 }),
    );
    expect(out).toContain("(+2 score-failure folded)");
  });

  it("snapshot: color and no-color structures match", () => {
    const colorOn = renderCollabCycle(walkedView(), { color: true, fold: true, width: 72, lang: "en" });
    const colorOff = renderCollabCycle(walkedView(), { color: false, fold: true, width: 72, lang: "en" });
    expect(stripAnsi(colorOn)).toBe(stripAnsi(colorOff));
    expect(stripAnsi(colorOff)).toMatchSnapshot();
  });
});

describe("roll cycle <id> --collab", () => {
  it("renders the collaboration relay for a cycle id", () => {
    const save = process.cwd();
    process.chdir(project());
    let out = "";
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
    let status: number;
    try {
      status = cycleCommand(["61717", "--collab", "--no-color"]);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    expect(status).toBe(0);
    const text = stripAnsi(out);
    expect(text).toContain("FIX-1034");
    expect(text).toContain("assign builder = pi");
    expect(text).toContain("walked full protocol ✓");
  });

  it("renders the escalation callout for a stalled cycle", () => {
    const save = process.cwd();
    process.chdir(project());
    let out = "";
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
    let status: number;
    try {
      status = cycleCommand(["4086", "--collab", "--no-color"]);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    expect(status).toBe(0);
    const text = stripAnsi(out);
    expect(text).toContain("FIX-1032a");
    expect(text).toContain("⤴ escalation");
    expect(text).toContain("escalated ⤴");
  });

  it("--collab --json emits the CollabCycleView shape", () => {
    const save = process.cwd();
    process.chdir(project());
    let out = "";
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
    let status: number;
    try {
      status = cycleCommand(["61717", "--collab", "--json", "--no-color"]);
    } finally {
      process.stdout.write = so;
      process.chdir(save);
    }
    expect(status).toBe(0);
    const parsed = JSON.parse(out) as { schema: string; terminus: string; handoffs: unknown[] };
    expect(parsed.schema).toBe("collab-view.v1");
    expect(parsed.terminus).toBe("walked_full");
    expect(parsed.handoffs.length).toBeGreaterThan(0);
  });

  it("fails loud when neither summary nor events are available", () => {
    const p = mkdtempSync(join(tmpdir(), "roll-cycle-collab-empty-"));
    dirs.push(p);
    mkdirSync(join(p, ".roll", "loop"), { recursive: true });
    writeFileSync(join(p, ".roll", "loop", "runs.jsonl"), "\n");
    const save = process.cwd();
    process.chdir(p);
    let err = "";
    const se = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
    try {
      expect(cycleCommand(["99999", "--collab", "--no-color"])).toBe(1);
    } finally {
      process.stderr.write = se;
      process.chdir(save);
    }
    expect(err).toContain("collab view unavailable");
  });
});
