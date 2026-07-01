/** US-OBS-040 — `roll supervisor live --collab`: multi-cycle collaboration stream. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RollEvent } from "@roll/spec";
import { supervisorCommand } from "../src/commands/supervisor.js";
import { stripAnsi } from "../src/render.js";

const SUPERVISOR = "codex";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env["ROLL_LANG"];
});

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

const WALKED_CYCLE_2 = "20260629-143500-61718";

const walked2Events: RollEvent[] = [
  {
    type: "cycle:start",
    cycleId: WALKED_CYCLE_2,
    storyId: "FIX-1033",
    agent: "pi",
    model: "deepseek-v4-pro",
    ts: 2_100,
  },
  { type: "cycle:first_edit", cycleId: WALKED_CYCLE_2, commitHash: "abc2", ts: 2_200 },
  { type: "cycle:tcr", cycleId: WALKED_CYCLE_2, commitHash: "def2", message: "tcr: fix root cause", ts: 2_300 },
  {
    type: "pair:verdict",
    cycleId: WALKED_CYCLE_2,
    peer: "reasonix",
    verdict: "agree",
    findings: 0,
    cost: 0.01,
    stage: "review",
    ts: 2_400,
  },
  {
    type: "peer:gate",
    cycleId: WALKED_CYCLE_2,
    verdict: "consulted",
    reasons: ["peer review completed"],
    ts: 2_500,
  },
  {
    type: "pair:score",
    cycleId: WALKED_CYCLE_2,
    peer: "claude",
    score: 8,
    verdict: "good",
    cost: 0.02,
    stage: "score",
    ts: 2_600,
  },
  {
    type: "attest:gate",
    cycleId: WALKED_CYCLE_2,
    verdict: "produced",
    reasons: ["review-score good 8/10 present"],
    ts: 2_700,
  },
  {
    type: "cycle:terminal",
    schema: 1,
    cycleId: WALKED_CYCLE_2,
    storyId: "FIX-1033",
    agent: "pi",
    model: "deepseek-v4-pro",
    startedAt: 2_100,
    endedAt: 2_800,
    outcome: "published_pending_merge",
    pr: { present: false, reason: "no_publish_attempted" },
    branch: { present: true, value: "loop/FIX-1033" },
    commit: { present: true, value: "def2" },
    tcr: { present: true, value: 1 },
    attest: { present: true, value: { reportPath: ".roll/...", acMap: true } },
    usage: { present: false, reason: "no_parseable_usage" },
    cost: { present: false, reason: "no_parseable_usage" },
    ts: 2_800,
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

function project(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-supervisor-collab-"));
  dirs.push(p);
  const rt = join(p, ".roll", "loop");
  mkdirSync(rt, { recursive: true });
  mkdirSync(join(rt, "peer"), { recursive: true });
  mkdirSync(join(rt, "cycle-logs"), { recursive: true });
  writeFileSync(
    join(rt, "events.ndjson"),
    [...walkedEvents, ...walked2Events, ...escalatedEvents].map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  writeFileSync(
    join(rt, "goal.yaml"),
    [
      "schema: goal.v1",
      "scope:",
      "  kind: all",
      "review: auto",
      "limits:",
      "status: active",
      "usage:",
      "  cycles: 3",
      "  costUsd: 0.05",
      "createdAt: 2026-06-29T14:00:00Z",
      "updatedAt: 2026-06-29T14:00:00Z",
    ].join("\n") + "\n",
  );
  return p;
}

async function runOnce(args: string[], p: string): Promise<{ status: number; out: string; err: string }> {
  const save = process.cwd();
  process.chdir(p);
  let out = "";
  let err = "";
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
  process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
  let status: number;
  try {
    status = await Promise.resolve(supervisorCommand([...args, "--no-color"]));
  } finally {
    process.stdout.write = so;
    process.stderr.write = se;
    process.chdir(save);
  }
  return { status, out, err };
}

describe("roll supervisor live --collab", () => {
  it("renders a deterministic stream snapshot with folded walked_full cycles", async () => {
    const { status, out } = await runOnce(["live", "--collab", "--once"], project());
    expect(status).toBe(0);
    const text = stripAnsi(out);
    expect(text).toContain("GOAL  all backlog");
    expect(text).toContain(`supervisor = ${SUPERVISOR}`);
    expect(text).toContain("supervise");
    expect(text).toContain("plan");
    expect(text).toContain("build");
    // Two consecutive walked_full cycles should render as one-line chains.
    expect(text).toContain("FIX-1034");
    expect(text).toContain("FIX-1033");
    expect(text).toMatch(/FIX-1034.*✓/);
    expect(text).toMatch(/FIX-1033.*✓/);
    // No success/failure language.
    expect(text).not.toContain("success");
    expect(text).not.toContain("failure");
  });

  it("expands an escalated cycle to a boxed callout", async () => {
    const { status, out } = await runOnce(["live", "--collab", "--once"], project());
    expect(status).toBe(0);
    const text = stripAnsi(out);
    expect(text).toContain("FIX-1032a");
    expect(text).toContain("⤴ escalation");
    expect(text).toContain("baton returned from");
    expect(text).toContain("escalated ⤴");
  });

  it("uses a single epoch time spine (UTC) for all rows", async () => {
    const { status, out } = await runOnce(["live", "--collab", "--once"], project());
    expect(status).toBe(0);
    const text = stripAnsi(out);
    // All three cycles fall on the same UTC second representation from the fixture ts values.
    expect(text).toContain("00:00:01");
    expect(text).toContain("00:00:02");
    expect(text).toContain("00:00:03");
  });

  it("--collab --json emits the CollabStreamView shape", async () => {
    const { status, out } = await runOnce(["live", "--collab", "--once", "--json"], project());
    expect(status).toBe(0);
    const parsed = JSON.parse(out) as { schema: string; supervisor: string; goalScope: string; cycles: unknown[] };
    expect(parsed.schema).toBe("collab-stream.v1");
    expect(parsed.supervisor).toBe(SUPERVISOR);
    expect(parsed.goalScope).toBe("all backlog");
    expect(parsed.cycles.length).toBe(3);
  });

  it("shows missing-summary cycles inline without breaking the stream", async () => {
    const p = project();
    const rt = join(p, ".roll", "loop");
    const events = [...walkedEvents, ...escalatedEvents];
    writeFileSync(join(rt, "events.ndjson"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    // A cycle log directory with no events and no summary.json produces a graceful gap.
    mkdirSync(join(rt, "cycle-logs", "missing-cycle-id"), { recursive: true });
    const { status, out } = await runOnce(["live", "--collab", "--once"], p);
    expect(status).toBe(0);
    const text = stripAnsi(out);
    expect(text).toContain("协同摘要不可用");
  });

  it("snapshot: stream output is stable", async () => {
    const { status, out } = await runOnce(["live", "--collab", "--once"], project());
    expect(status).toBe(0);
    expect(stripAnsi(out)).toMatchSnapshot();
  });
});
