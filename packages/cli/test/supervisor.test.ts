/**
 * US-V4-008 — `roll supervisor` CLI: gathers structured facts from a real project
 * (backlog + agents.yaml + events.ndjson) and renders observe/advise/next/why/live,
 * never implementing a Story or marking one Done.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherSupervisorInput, supervisorCommand } from "../src/commands/supervisor.js";

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

const BACKLOG = `# Backlog

| ID | Description | Status |
| --- | --- | --- |
| US-1 | first | ✅ Done |
| US-2 | second \`depends-on:US-1\` | 📋 Todo |
| US-3 | third | 📋 Todo |
`;

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
    expect(r.out).toContain("Supervisor Agent — project facts");
    expect(r.out).toContain("backlog: 2 todo");
    expect(r.out).toContain("mode: guided");
    expect(r.out).toContain("owner action:");
  });

  it("`status` is an alias for the default observe + advise view", () => {
    const cwd = project(BACKLOG, { events: [JSON.stringify({ type: "pr:merge", prNumber: 1, storyId: "US-1", ts: 1 })] });
    const r = run(cwd, ["status"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Supervisor Agent — project facts");
    expect(r.out).toContain("Supervisor Agent —"); // advice block too
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
        JSON.stringify({ type: "pair:selected", cycleId: "C1", workingAgent: "reasonix", peer: "codex", stage: "score", ts: 4 }),
        JSON.stringify({ type: "pair:score", cycleId: "C1", peer: "codex", score: 10, verdict: "good", cost: 0, stage: "score", ts: 5 }),
      ],
    });
    const r = run(cwd, ["status"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("scope: live non-Hold FIX/US/REFACTOR");
    expect(r.out).toContain("selected: US-1");
    expect(r.out).toContain("cast: C1 · US-1 · builder=reasonix · evaluator=codex");
    expect(r.out).toContain("gate: active");
    expect(r.out).toContain(".roll meta:");
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
    expect(r.out).toContain("Supervisor — why stuck");
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
    expect(r.out).toContain("Supervisor Live");
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

  it("rejects an unknown subcommand with usage", () => {
    const cwd = project(BACKLOG);
    expect(run(cwd, ["bogus"]).code).toBe(1);
  });
});
