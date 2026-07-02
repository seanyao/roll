/**
 * US-V4-008 — `roll supervisor` CLI: gathers structured facts from a real project
 * (backlog + agents.yaml + events.ndjson) and renders observe/advise/next/why/live,
 * never implementing a Story or marking one Done.
 */
import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherSupervisorInput, supervisorCommand } from "../src/commands/supervisor.js";
import { stripAnsi } from "../src/render.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project(backlog: string, opts: { agents?: string; events?: string[] } = {}): string {
  const d = mkdtempSync(join(tmpdir(), "roll-sup-"));
  dirs.push(d);
  mkdirSync(join(d, ".roll", "loop"), { recursive: true });
  writeFileSync(join(d, ".roll", "backlog.md"), backlog);
  if (opts.agents !== undefined) writeFileSync(join(d, ".roll", "agents.yaml"), opts.agents);
  if (opts.events !== undefined) writeFileSync(join(d, ".roll", "loop", "events.ndjson"), opts.events.join("\n") + "\n");
  return d;
}

function run(cwd: string, args: string[]): { code: number; out: string } {
  const save = process.cwd();
  const chunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (chunks.push(String(c)), true);
  process.chdir(cwd);
  let code = 1;
  try {
    code = supervisorCommand(args);
  } finally {
    process.chdir(save);
    process.stdout.write = realOut;
  }
  return { code, out: chunks.join("") };
}

function installFakeGh(cwd: string, opts: { number?: number; headRefName?: string; title?: string; body?: string } = {}): string {
  const bin = join(cwd, "bin");
  mkdirSync(bin, { recursive: true });
  const ghPath = join(bin, "gh");
  const number = opts.number ?? 42;
  const headRefName = opts.headRefName ?? "loop/US-1-manual";
  const title = opts.title ?? "US-1 manual merge";
  const body = opts.body ?? "delivery\\n\\n[roll:manual-merge]";
  writeFileSync(
    ghPath,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"pr\" ] && [ \"$2\" = \"list\" ]; then",
      `  printf '%s\\n' '[{"number":${number},"headRefName":"${headRefName}","title":"${title}"}]'`,
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"pr\" ] && [ \"$2\" = \"view\" ]; then",
      `  printf '%s\\n' '{"body":"${body}","labels":[],"reviews":[{"authorAssociation":"APP","state":"APPROVED"}],"mergeStateStatus":"CLEAN","statusCheckRollup":[{"conclusion":"SUCCESS"}],"isDraft":false}'`,
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(ghPath, 0o755);
  return bin;
}

function withPath<T>(prefix: string, fn: () => T): T {
  const previous = process.env["PATH"];
  process.env["PATH"] = `${prefix}:${previous ?? ""}`;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env["PATH"];
    else process.env["PATH"] = previous;
  }
}

const BACKLOG = `# Backlog

| ID | Description | Status |
| --- | --- | --- |
| US-1 | first | ✅ Done |
| US-2 | second \`depends-on:US-1\` | 📋 Todo |
| US-3 | third | 📋 Todo |
`;

function collabStreamEvents(): string[] {
  const walkedOne = "C-walk-1";
  const walkedTwo = "C-walk-2";
  const missing = "C-missing";
  const escalated = "C-escalated";
  return [
    JSON.stringify({ type: "cycle:start", cycleId: walkedOne, storyId: "FIX-1", agent: "pi", model: "m", ts: 1_000 }),
    JSON.stringify({ type: "cycle:first_edit", cycleId: walkedOne, commitHash: "a1", ts: 1_100 }),
    JSON.stringify({ type: "cycle:tcr", cycleId: walkedOne, commitHash: "a2", message: "tcr: first", ts: 1_200 }),
    JSON.stringify({ type: "pair:selected", cycleId: walkedOne, workingAgent: "pi", peer: "reasonix", stage: "review", ts: 1_300 }),
    JSON.stringify({ type: "pair:verdict", cycleId: walkedOne, peer: "reasonix", verdict: "agree", findings: 0, stage: "review", ts: 1_400 }),
    JSON.stringify({ type: "peer:gate", cycleId: walkedOne, verdict: "consulted", reasons: [], ts: 1_500 }),
    JSON.stringify({ type: "pair:selected", cycleId: walkedOne, workingAgent: "pi", peer: "codex", stage: "score", ts: 1_600 }),
    JSON.stringify({ type: "pair:score", cycleId: walkedOne, peer: "codex", score: 9, verdict: "good", cost: 0, stage: "score", ts: 1_700 }),
    JSON.stringify({ type: "attest:gate", cycleId: walkedOne, verdict: "produced", reasons: [], ts: 1_800 }),
    JSON.stringify({
      type: "cycle:terminal",
      schema: 1,
      cycleId: walkedOne,
      storyId: "FIX-1",
      agent: "pi",
      model: "m",
      startedAt: 1_000,
      endedAt: 1_900,
      outcome: "published_pending_merge",
      pr: { present: false, reason: "test" },
      branch: { present: true, value: "loop/FIX-1" },
      commit: { present: true, value: "a2" },
      tcr: { present: true, value: 1 },
      attest: { present: true, value: { reportPath: ".roll/...", acMap: true } },
      usage: { present: false, reason: "test" },
      cost: { present: false, reason: "test" },
      ts: 1_900,
    }),
    JSON.stringify({ type: "cycle:start", cycleId: walkedTwo, storyId: "FIX-2", agent: "pi", model: "m", ts: 4_000 }),
    JSON.stringify({ type: "cycle:first_edit", cycleId: walkedTwo, commitHash: "b1", ts: 4_100 }),
    JSON.stringify({ type: "cycle:tcr", cycleId: walkedTwo, commitHash: "b2", message: "tcr: second", ts: 4_200 }),
    JSON.stringify({ type: "pair:selected", cycleId: walkedTwo, workingAgent: "pi", peer: "reasonix", stage: "review", ts: 4_300 }),
    JSON.stringify({ type: "pair:verdict", cycleId: walkedTwo, peer: "reasonix", verdict: "agree", findings: 0, stage: "review", ts: 4_400 }),
    JSON.stringify({ type: "peer:gate", cycleId: walkedTwo, verdict: "consulted", reasons: [], ts: 4_500 }),
    JSON.stringify({ type: "pair:selected", cycleId: walkedTwo, workingAgent: "pi", peer: "codex", stage: "score", ts: 4_600 }),
    JSON.stringify({ type: "pair:score", cycleId: walkedTwo, peer: "codex", score: 9, verdict: "good", cost: 0, stage: "score", ts: 4_700 }),
    JSON.stringify({ type: "attest:gate", cycleId: walkedTwo, verdict: "produced", reasons: [], ts: 4_800 }),
    JSON.stringify({
      type: "cycle:terminal",
      schema: 1,
      cycleId: walkedTwo,
      storyId: "FIX-2",
      agent: "pi",
      model: "m",
      startedAt: 4_000,
      endedAt: 4_900,
      outcome: "published_pending_merge",
      pr: { present: false, reason: "test" },
      branch: { present: true, value: "loop/FIX-2" },
      commit: { present: true, value: "b2" },
      tcr: { present: true, value: 1 },
      attest: { present: true, value: { reportPath: ".roll/...", acMap: true } },
      usage: { present: false, reason: "test" },
      cost: { present: false, reason: "test" },
      ts: 4_900,
    }),
    JSON.stringify({ type: "cycle:end", cycleId: missing, outcome: "failed", cost: {}, ts: 7_000 }),
    JSON.stringify({ type: "cycle:start", cycleId: escalated, storyId: "FIX-3", agent: "pi", model: "m", ts: 9_000 }),
    JSON.stringify({ type: "cycle:first_edit", cycleId: escalated, commitHash: "c1", ts: 9_100 }),
    JSON.stringify({ type: "agent:stall", cycleId: escalated, agent: "pi", idleSec: 601, thresholdSec: 600, ts: 9_500 }),
    JSON.stringify({ type: "cycle:end", cycleId: escalated, outcome: "gave_up", cost: {}, ts: 9_600 }),
  ];
}

describe("gatherSupervisorInput", () => {
  it("reads backlog rows + depends-on + merge truth + route config errors", () => {
    const cwd = project(BACKLOG, {
      agents: "schema: v4\nrouting:\n  hard: ghost-rig\n",
      events: [JSON.stringify({ type: "pr:merge", prNumber: 1, storyId: "US-1", ts: 1 })],
    });
    const input = gatherSupervisorInput(cwd);
    expect(input.backlog.find((b) => b.id === "US-2")?.dependsOn).toEqual(["US-1"]);
    expect(input.delivered).toContain("US-1");
    expect(input.routeConfigErrors.some((e) => e.includes("ghost-rig"))).toBe(true);
  });

  it("derives open PRs and consecutive failures from the event stream", () => {
    const cwd = project(BACKLOG, {
      events: [
        JSON.stringify({ type: "pr:open", prNumber: 2, storyId: "US-3", ts: 1 }),
        JSON.stringify({ type: "cycle:start", cycleId: "C1", storyId: "US-3", agent: "codex", model: "m", ts: 2 }),
        JSON.stringify({ type: "cycle:end", cycleId: "C1", outcome: "failed", cost: {}, ts: 3 }),
        JSON.stringify({ type: "cycle:start", cycleId: "C2", storyId: "US-3", agent: "codex", model: "m", ts: 4 }),
        JSON.stringify({ type: "cycle:end", cycleId: "C2", outcome: "failed", cost: {}, ts: 5 }),
      ],
    });
    const input = gatherSupervisorInput(cwd);
    expect(input.openPrStories).toContain("US-3");
    expect(input.recentFailures.find((f) => f.storyId === "US-3")?.consecutiveFailures).toBe(2);
  });
});

describe("supervisorCommand", () => {
  it("default view shows observe facts + advice", () => {
    const cwd = project(BACKLOG, { events: [JSON.stringify({ type: "pr:merge", prNumber: 1, storyId: "US-1", ts: 1 })] });
    const r = run(cwd, []);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Prime Agent — project facts");
    expect(r.out).toContain("backlog: 2 todo");
    expect(r.out).toContain("mode: guided");
    expect(r.out).toContain("owner action:");
  });

  it("`status` is an alias for the default observe + advise view", () => {
    const cwd = project(BACKLOG, { events: [JSON.stringify({ type: "pr:merge", prNumber: 1, storyId: "US-1", ts: 1 })] });
    const r = run(cwd, ["status"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Prime Agent — project facts");
    expect(r.out).toContain("Prime Agent —"); // advice block too
  });

  it("summarizes truth coverage in advise when a Done card lacks structured proof", () => {
    const cwd = project(BACKLOG); // no pr:merge → US-1 Done but undelivered
    const r = run(cwd, ["advise"]);
    expect(r.out).toContain("truth coverage");
    expect(r.out).toContain("owner confirmation required");
  });

  it("keeps default status concise for large legacy backlogs", () => {
    const rows = Array.from(
      { length: 25 },
      (_, i) => `| US-LEG-${i + 1} | historical row | ✅ Done |`,
    ).join("\n");
    const cwd = project(`# Backlog\n\n| ID | Description | Status |\n| --- | --- | --- |\n${rows}\n`);
    const r = run(cwd, ["status"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("truth coverage: partial — 25 Done row(s)");
    expect(r.out).toContain("US-LEG-1, US-LEG-2, US-LEG-3, US-LEG-4, US-LEG-5");
    expect(r.out).toContain("… +20 more");
    expect(r.out).toContain("release: ready");
    expect(r.out).not.toContain("US-LEG-20, US-LEG-21");
    expect(r.out.length).toBeLessThan(1600);
  });

  it("next recommends the first ready Todo whose deps are delivered", () => {
    const cwd = project(BACKLOG, { events: [JSON.stringify({ type: "pr:merge", prNumber: 1, storyId: "US-1", ts: 1 })] });
    const r = run(cwd, ["next"]);
    expect(r.out).toContain("US-2"); // US-2 depends-on US-1 (delivered) → ready
    expect(r.out).toContain("mode: guided");
    expect(r.out).toContain("roll loop go --cards US-2");
    expect(r.out).toContain("scheduler:");
  });

  it("US-V4-021: next uses whole backlog scope and does not recommend historical Done noise", () => {
    const cwd = project(`# Backlog

| ID | Description | Status |
| --- | --- | --- |
| FIX-301 | historical truth-coverage row | ✅ Done |
| US-OBS-032 | role summary | 📋 Todo |
| REFACTOR-054 | terminology cleanup | 📋 Todo |
`, { events: [JSON.stringify({ type: "pr:merge", prNumber: 301, storyId: "FIX-301", ts: 1 })] });
    const r = run(cwd, ["next"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("US-OBS-032");
    expect(r.out).toContain("scope: live non-Hold FIX/US/REFACTOR");
    expect(r.out).toContain("remaining: FIX 0 · US 1 · REFACTOR 1");
    expect(r.out).toContain("cast: none");
    expect(r.out).toContain("gate: no active/recent cycle");
    expect(r.out).toContain(".roll meta:");
    expect(r.out).not.toContain("next: FIX-301");
  });

  it("US-V4-021: status exposes scope, selected card, cast, gate state, and roll-meta state", () => {
    const cwd = project(`# Backlog

| ID | Description | Status |
| --- | --- | --- |
| FIX-1 | fixed | ✅ Done |
| US-1 | next story | 📋 Todo |
`, {
      events: [
        JSON.stringify({ type: "pr:merge", prNumber: 1, storyId: "FIX-1", ts: 1 }),
        JSON.stringify({ type: "cycle:start", cycleId: "C1", storyId: "US-1", agent: "reasonix", model: "m", ts: 2 }),
        JSON.stringify({ type: "execution:profile", cycleId: "C1", storyId: "US-1", profile: "verified", reason: "verified: user-visible", ts: 3 }),
        JSON.stringify({ type: "pair:selected", cycleId: "C1", workingAgent: "reasonix", peer: "kimi", stage: "review", ts: 4 }),
        JSON.stringify({ type: "pair:selected", cycleId: "C1", workingAgent: "reasonix", peer: "codex", stage: "review", ts: 5 }),
        JSON.stringify({ type: "pair:consult", cycleId: "C1", peer: "kimi", durationMs: 100, outcome: "reviewed", ts: 6 }),
        JSON.stringify({ type: "pair:verdict", cycleId: "C1", peer: "codex", verdict: "refine", findings: 2, stage: "review", ts: 7 }),
        JSON.stringify({ type: "peer:gate", cycleId: "C1", verdict: "consulted", reasons: [], ts: 8 }),
        JSON.stringify({ type: "pair:selected", cycleId: "C1", workingAgent: "reasonix", peer: "pi", stage: "score", ts: 9 }),
        JSON.stringify({ type: "pair:score-failure", cycleId: "C1", peer: "pi", cause: "unparseable", detail: "SCORE without protocol", stage: "score", ts: 10 }),
        JSON.stringify({ type: "pair:selected", cycleId: "C1", workingAgent: "reasonix", peer: "codex", stage: "score", ts: 11 }),
        JSON.stringify({ type: "pair:score", cycleId: "C1", peer: "codex", score: 10, verdict: "good", cost: 0, stage: "score", ts: 12 }),
      ],
    });
    const r = run(cwd, ["status"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("scope: live non-Hold FIX/US/REFACTOR");
    expect(r.out).toContain("selected: US-1");
    expect(r.out).toContain("cast: C1 · US-1 · builder=reasonix · evaluator=codex");
    expect(r.out).toContain("cast detail:");
    expect(r.out).toContain("reviewers=kimi:returned, codex:accepted/refine");
    expect(r.out).toContain("evaluators=pi:failed/unparseable");
    expect(r.out).toContain("codex:accepted/10");
    expect(r.out).toContain("gate: active");
    expect(r.out).toContain(".roll meta:");
  });

  it("US-V4-021: manual-merge PRs are visible gates before new cards", () => {
    const cwd = project(`# Backlog

| ID | Description | Status |
| --- | --- | --- |
| US-1 | manual merge delivery | 📋 Todo |
| US-2 | next story | 📋 Todo |
`, {
      events: [JSON.stringify({ type: "pr:open", prNumber: 42, storyId: "US-1", ts: 1 })],
    });
    const fakeBin = installFakeGh(cwd);
    const r = withPath(fakeBin, () => run(cwd, ["next"]));
    expect(r.code).toBe(0);
    expect(r.out).toContain("Prime Agent — next: US-1");
    expect(r.out).toContain("manual merge: PR #42:US-1:manual_merge_required");
    expect(r.out).toContain("manual merge gate on PR #42");
    expect(r.out).toContain("do not start another card until the manual-merge PR is merged");

    const json = withPath(fakeBin, () => JSON.parse(run(cwd, ["next", "--json"]).out));
    expect(json.next.kind).toBe("manual_merge_gate");
    expect(json.runbook.truth.manualMergeGates[0].prNumber).toBe(42);
    expect(json.manualMerge).toContain("PR #42:US-1");
  });

  it("US-V4-021: manual-merge PRs are visible even when the local pr:open event is missing", () => {
    const cwd = project(`# Backlog

| ID | Description | Status |
| --- | --- | --- |
| US-1 | manual merge delivery | 📋 Todo |
| US-2 | next story | 📋 Todo |
`);
    const fakeBin = installFakeGh(cwd);
    const r = withPath(fakeBin, () => run(cwd, ["why"]));
    expect(r.code).toBe(0);
    expect(r.out).toContain("manual merge gate on PR #42");
    expect(r.out).toContain("manual merge: PR #42:US-1:manual_merge_required");
    expect(r.out).toContain("do not start another card until the manual-merge PR is merged");

    const json = withPath(fakeBin, () => JSON.parse(run(cwd, ["why", "--json"]).out));
    expect(json.runbook.next.kind).toBe("manual_merge_gate");
    expect(json.runbook.next.storyId).toBe("US-1");
    expect(json.runbook.truth.manualMergeGates[0].source).toBe("gh pr view 42");
  });

  it("US-V4-021: manual-merge story matching does not confuse prefix IDs", () => {
    const cwd = project(`# Backlog

| ID | Description | Status |
| --- | --- | --- |
| FIX-103 | older fix | 📋 Todo |
| FIX-1032 | manual merge fix | 📋 Todo |
`);
    const fakeBin = installFakeGh(cwd, {
      number: 77,
      headRefName: "loop/FIX-1032-manual-merge",
      title: "manual merge delivery",
    });
    const json = withPath(fakeBin, () => JSON.parse(run(cwd, ["next", "--json"]).out));
    expect(json.runbook.next.kind).toBe("manual_merge_gate");
    expect(json.runbook.next.storyId).toBe("FIX-1032");
    expect(json.runbook.truth.manualMergeGates[0].storyId).toBe("FIX-1032");
    expect(JSON.stringify(json.runbook.next)).not.toContain("FIX-103\"");
  });

  it("US-V4-021: why diagnoses repeated failure before another run command", () => {
    const cwd = project(`# Backlog

| ID | Description | Status |
| --- | --- | --- |
| US-1 | repeated failure | 📋 Todo |
`, {
      events: [
        JSON.stringify({ type: "cycle:start", cycleId: "C1", storyId: "US-1", agent: "pi", model: "m", ts: 1 }),
        JSON.stringify({ type: "cycle:end", cycleId: "C1", outcome: "gave_up", cost: {}, ts: 2 }),
        JSON.stringify({ type: "cycle:start", cycleId: "C2", storyId: "US-1", agent: "reasonix", model: "m", ts: 3 }),
        JSON.stringify({ type: "cycle:end", cycleId: "C2", outcome: "failed", cost: {}, ts: 4 }),
      ],
    });
    const r = run(cwd, ["why"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("diagnose repeated failure");
    expect(r.out).toContain("do not retry blindly");
    expect(r.out).toContain("cast: C2 · US-1 · builder=reasonix · evaluator=-");
    expect(r.out).toContain("gate: failed");
    expect(r.out).toContain(".roll meta:");
    expect(r.out).not.toContain("roll loop go --cards US-1");
  });

  it("US-V4-021: why diagnoses zero-TCR dirty-worktree handoff before another run command", () => {
    const cwd = project(`# Backlog

| ID | Description | Status |
| --- | --- | --- |
| US-1 | dirty worktree handoff | 📋 Todo |
| US-2 | next story | 📋 Todo |
`, {
      events: [
        JSON.stringify({ type: "cycle:start", cycleId: "C-zero", storyId: "US-1", agent: "pi", model: "m", ts: 1 }),
        JSON.stringify({ type: "cycle:end", cycleId: "C-zero", outcome: "handoff_without_tcr", cost: {}, ts: 2 }),
      ],
    });
    const r = run(cwd, ["why"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("diagnose structural failure on US-1");
    expect(r.out).toContain("zero TCR with dirty preserved worktree");
    expect(r.out).toContain("do not retry this card");
    expect(r.out).toContain("worktree: .roll/loop/worktrees/cycle-C-zero");
    expect(r.out).not.toContain("roll loop go --cards US-2");

    const json = JSON.parse(run(cwd, ["why", "--json"]).out);
    expect(json.runbook.next.kind).toBe("diagnose_failure");
    expect(json.runbook.truth.structuralFailures[0]).toMatchObject({
      storyId: "US-1",
      kind: "zero_tcr_dirty_worktree",
      source: "cycle:end/C-zero",
      worktreePath: ".roll/loop/worktrees/cycle-C-zero",
    });
  });

  it("US-V4-021: why ignores historical repeated failures when no live scoped card exists", () => {
    const cwd = project(`# Backlog

| ID | Description | Status |
| --- | --- | --- |
| FIX-382 | historical failure already delivered | ✅ Done |
`, {
      events: [
        JSON.stringify({ type: "pr:merge", prNumber: 382, storyId: "FIX-382", ts: 1 }),
        JSON.stringify({ type: "cycle:start", cycleId: "C1", storyId: "FIX-382", agent: "pi", model: "m", ts: 2 }),
        JSON.stringify({ type: "cycle:end", cycleId: "C1", outcome: "failed", cost: {}, ts: 3 }),
        JSON.stringify({ type: "cycle:start", cycleId: "C2", storyId: "FIX-382", agent: "reasonix", model: "m", ts: 4 }),
        JSON.stringify({ type: "cycle:end", cycleId: "C2", outcome: "failed", cost: {}, ts: 5 }),
      ],
    });
    const why = run(cwd, ["why"]);
    expect(why.out).toContain("no ready live non-Hold FIX/US/REFACTOR card");
    expect(why.out).not.toContain("diagnose repeated failure");

    const status = run(cwd, ["status"]);
    expect(status.out).toContain("stuck stories: none in live scope");
    expect(status.out).not.toContain("stuck stories (repeated failures): FIX-382");

    const json = JSON.parse(run(cwd, ["--json"]).out);
    expect(JSON.stringify(json.decisions)).not.toContain("FIX-382");
    expect(JSON.stringify(json.decisions)).not.toContain("stuck stories");
  });

  it("US-V4-021: next/why json includes runbook context plus cast, gate, and meta", () => {
    const cwd = project(`# Backlog

| ID | Description | Status |
| --- | --- | --- |
| US-1 | next story | 📋 Todo |
`, {
      events: [
        JSON.stringify({ type: "cycle:start", cycleId: "C1", storyId: "US-1", agent: "reasonix", model: "m", ts: 1 }),
        JSON.stringify({ type: "pair:score", cycleId: "C1", peer: "codex", score: 10, verdict: "good", cost: 0, stage: "score", ts: 2 }),
      ],
    });
    const next = JSON.parse(run(cwd, ["next", "--json"]).out);
    expect(next.next.storyId).toBe("US-1");
    expect(next.cast).toBe("C1 · US-1 · builder=reasonix · evaluator=codex");
    expect(next.gate).toBe("active");
    expect(next.rollMeta.state).toBeDefined();

    const why = JSON.parse(run(cwd, ["why", "--json"]).out);
    expect(why.why).toContain("not stuck");
    expect(why.cast).toBe("C1 · US-1 · builder=reasonix · evaluator=codex");
    expect(why.gate).toBe("active");
    expect(why.rollMeta.state).toBeDefined();
  });

  it("--json emits machine-readable facts + decisions", () => {
    const cwd = project(BACKLOG);
    const r = run(cwd, ["--json"]);
    const parsed = JSON.parse(r.out);
    expect(parsed.mode.mode).toBe("guided");
    expect(parsed.facts.counts.done).toBe(1);
    expect(Array.isArray(parsed.decisions)).toBe(true);
  });

  it("why explains operating mode and the next owner action", () => {
    const cwd = project(BACKLOG);
    const r = run(cwd, ["why"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Prime Agent — why stuck");
    expect(r.out).toContain("mode: guided");
    expect(r.out).toContain("owner action:");
    expect(r.out).toContain("will not start long-running Story execution");
  });

  it("live renders full-team role panes and handoff flow", () => {
    const cwd = project(BACKLOG, {
      events: [
        JSON.stringify({ type: "cycle:start", cycleId: "C-plan", storyId: "US-2", agent: "codex", model: "gpt", ts: 1 }),
        JSON.stringify({ type: "execution:profile", cycleId: "C-plan", storyId: "US-2", profile: "planned", reason: "planned: cross-module", ts: 2 }),
        JSON.stringify({ type: "cycle:phase", cycleId: "C-plan", phase: "execute", ts: 3 }),
        JSON.stringify({ type: "cycle:phase", cycleId: "C-plan", phase: "publish", ts: 4 }),
        JSON.stringify({ type: "peer:gate", cycleId: "C-plan", verdict: "consulted", reasons: [], ts: 5 }),
      ],
    });
    const r = run(cwd, ["live"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Prime Agent Live");
    expect(r.out).toContain("C-plan · US-2 · planned");
    expect(r.out).toContain("planner   done");
    expect(r.out).toContain("builder   done");
    expect(r.out).toContain("evaluator done");
    expect(r.out).toContain("planner->builder:ready");
    expect(r.out).toContain("builder->evaluator:ready");
  });

  it("live shows not_required panes for standard rows and not_available for missing evaluator", () => {
    const cwd = project(BACKLOG, {
      events: [
        JSON.stringify({ type: "cycle:start", cycleId: "C-std", storyId: "US-3", agent: "codex", model: "gpt", ts: 10 }),
        JSON.stringify({ type: "cycle:start", cycleId: "C-eval", storyId: "US-4", agent: "codex", model: "gpt", ts: 20 }),
        JSON.stringify({ type: "execution:profile", cycleId: "C-eval", storyId: "US-4", profile: "verified", reason: "verified: user-visible", ts: 21 }),
        JSON.stringify({ type: "cycle:phase", cycleId: "C-eval", phase: "execute", ts: 22 }),
        JSON.stringify({ type: "cycle:phase", cycleId: "C-eval", phase: "publish", ts: 23 }),
        JSON.stringify({ type: "pair:none-available", cycleId: "C-eval", stage: "score", reason: "no evaluator", ts: 24 }),
      ],
    });
    const r = run(cwd, ["live"]);
    expect(r.out).toContain("C-std · US-3 · standard");
    expect(r.out).toContain("planner   not_required");
    expect(r.out).toContain("evaluator not_required");
    expect(r.out).toContain("C-eval · US-4 · verified · not_available");
    expect(r.out).toContain("evaluator not_available");
  });

  it("live --json emits the shared board view model", () => {
    const cwd = project(BACKLOG, {
      events: [JSON.stringify({ type: "cycle:start", cycleId: "C-json", storyId: "US-2", agent: "codex", model: "gpt", ts: 1 })],
    });
    const r = run(cwd, ["live", "--json"]);
    const parsed = JSON.parse(r.out);
    expect(parsed.supervisor.state).toBe("observing");
    expect(parsed.rows[0].roles.map((x: { role: string; state: string }) => [x.role, x.state])).toEqual([
      ["planner", "not_required"],
      ["builder", "pending"],
      ["evaluator", "not_required"],
    ]);
  });

  it("live --collab --once renders a folded multi-cycle collaboration stream", () => {
    const cwd = project(BACKLOG, {
      events: collabStreamEvents(),
    });
    const r = run(cwd, ["live", "--collab", "--once", "--no-color"]);
    const text = stripAnsi(r.out);
    expect(r.code).toBe(0);
    expect(text).toContain("Collab stream — goal: live non-Hold FIX/US/REFACTOR");
    expect(text).toContain("🧭 supervisor: codex");
    expect(text).toContain("levels: supervise → plan → build");
    expect(text).toContain("00:00:01  FIX-1");
    expect(text).toContain("walked_full ×2");
    expect(text).toContain("协同摘要不可用");
    expect(text).toContain("00:00:09  FIX-3");
    expect(text).toContain("⤴ escalation");
    expect(text).toContain("escalated ⤴");
    expect(text).toMatchSnapshot();
  });

  it("live --collab --once --json emits collab-stream.v1", () => {
    const cwd = project(BACKLOG, {
      events: collabStreamEvents(),
    });
    const r = run(cwd, ["live", "--collab", "--once", "--json"]);
    const parsed = JSON.parse(r.out) as { schema: string; cycles: Array<{ terminus: string; stance?: { note?: string } }> };
    expect(r.code).toBe(0);
    expect(parsed.schema).toBe("collab-stream.v1");
    expect(parsed.cycles.map((cycle) => cycle.terminus)).toEqual(["walked_full", "walked_full", "", "escalated"]);
    expect(parsed.cycles[2]?.stance?.note).toBe("协同摘要不可用");
  });

  it("live without --collab keeps the existing role board output", () => {
    const cwd = project(BACKLOG, {
      events: [
        JSON.stringify({ type: "cycle:start", cycleId: "C-plan", storyId: "US-2", agent: "codex", model: "gpt", ts: 1 }),
        JSON.stringify({ type: "execution:profile", cycleId: "C-plan", storyId: "US-2", profile: "planned", reason: "planned: cross-module", ts: 2 }),
      ],
    });
    const r = run(cwd, ["live"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Prime Agent Live");
    expect(r.out).not.toContain("Collab stream");
  });

  it("US-V4-022: health shows clean when no toolchain events exist", () => {
    const cwd = project(BACKLOG);
    const r = run(cwd, ["health"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Agent toolchain health: clean");
  });

  it("US-V4-022: health --json classifies a Reasonix skill-root pollution signal", () => {
    const cwd = project(BACKLOG, {
      events: [
        JSON.stringify({
          type: "agent:toolchain_issue",
          agent: "reasonix",
          classification: "setup_skill_root_pollution",
          severity: "warning",
          detail: 'skill "skill-authoring" at ~/.reasonix/skills/docs/skill-authoring.md has no description',
          source: "setup",
          ts: 1,
        }),
      ],
    });
    const parsed = JSON.parse(run(cwd, ["health", "--json"]).out);
    expect(parsed.summary).toContain("agent toolchain issues: reasonix(1)");
    expect(parsed.issues[0]).toMatchObject({
      agent: "reasonix",
      classification: "setup_skill_root_pollution",
      severity: "warning",
      action: "create_fix",
      routing: "delta_team",
    });
  });

  it("US-V4-022: health distinguishes auth block from setup pollution", () => {
    const cwd = project(BACKLOG, {
      events: [
        JSON.stringify({
          type: "agent:blocked",
          cycleId: "C1",
          agent: "claude",
          cause: "auth",
          stage: "build",
          detail: "Please run /login",
          ts: 1,
        }),
      ],
    });
    const parsed = JSON.parse(run(cwd, ["health", "--json"]).out);
    expect(parsed.issues[0]).toMatchObject({
      agent: "claude",
      classification: "auth_block",
      action: "pause_for_owner",
      routing: "owner",
    });
  });

  it("US-V4-022: next surfaces agent health summary alongside the selected card", () => {
    const cwd = project(BACKLOG, {
      events: [
        JSON.stringify({ type: "pr:merge", prNumber: 1, storyId: "US-1", ts: 1 }),
        JSON.stringify({
          type: "agent:toolchain_issue",
          agent: "reasonix",
          classification: "setup_skill_root_pollution",
          severity: "warning",
          detail: 'skill "skill-authoring" has no description',
          source: "setup",
          ts: 2,
        }),
      ],
    });
    const r = run(cwd, ["next"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("agent health: 1 active issue(s)");
    expect(r.out).toContain("US-2");
  });

  it("rejects an unknown subcommand with usage", () => {
    const cwd = project(BACKLOG);
    expect(run(cwd, ["bogus"]).code).toBe(1);
  });

  it("FIX-1047: route prints the Builder trace when a scoped agents.yaml is present", () => {
    const cwd = project(BACKLOG, {
      agents: [
        "schema: roll-agents/v1",
        "scope: project",
        "agents:",
        "  claude:",
        "    capabilities: [supervise, execute, evaluate]",
        "  codex:",
        "    capabilities: [supervise, execute, evaluate]",
        "roles:",
        "  supervise:",
        "    kind: fixed",
        "    agent: codex",
        "defaults:",
        "  story:",
        "    roles:",
        "      execute:",
        "        kind: select",
        "        from: [claude, codex]",
        "        require: [execute]",
        "        avoid: [supervise]",
        "        strategy: first-available",
        "",
      ].join("\n"),
    });
    const saveHome = process.env["ROLL_HOME"];
    // Point ROLL_HOME at the project so the only layer is the project agents.yaml;
    // mark all agents installed so resolution is deterministic across machines.
    process.env["ROLL_HOME"] = join(cwd, "no-machine");
    try {
      const r = run(cwd, ["route", "--json"]);
      // realAgentEnv reports whichever agents are actually installed on the host,
      // so the resolved Builder / skip reasons are environment-dependent. Assert
      // only the env-independent trace shape here; identity-based skipping and
      // fair rotation are proven deterministically in scoped-route.test.ts.
      const parsed = JSON.parse(r.out) as { role: string; candidates: string[] };
      expect(parsed.role).toBe("execute");
      expect(parsed.candidates).toEqual(["claude", "codex"]);
    } finally {
      if (saveHome === undefined) delete process.env["ROLL_HOME"];
      else process.env["ROLL_HOME"] = saveHome;
    }
  });

  it("FIX-1047: route reports legacy routing when no scoped agents.yaml exists", () => {
    const cwd = project(BACKLOG);
    const saveHome = process.env["ROLL_HOME"];
    process.env["ROLL_HOME"] = join(cwd, "no-machine");
    try {
      const r = run(cwd, ["route"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("legacy tier routing");
    } finally {
      if (saveHome === undefined) delete process.env["ROLL_HOME"];
      else process.env["ROLL_HOME"] = saveHome;
    }
  });
});
