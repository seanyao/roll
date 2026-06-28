/**
 * US-V4-008 — `roll supervisor` CLI: gathers structured facts from a real project
 * (backlog + agents.yaml + events.ndjson) and renders observe/advise/next/why,
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
  });

  it("`status` is an alias for the default observe + advise view", () => {
    const cwd = project(BACKLOG, { events: [JSON.stringify({ type: "pr:merge", prNumber: 1, storyId: "US-1", ts: 1 })] });
    const r = run(cwd, ["status"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Supervisor Agent — project facts");
    expect(r.out).toContain("Supervisor Agent —"); // advice block too
  });

  it("flags truth drift in advise when a Done card is unconfirmed by main", () => {
    const cwd = project(BACKLOG); // no pr:merge → US-1 Done but undelivered
    const r = run(cwd, ["advise"]);
    expect(r.out).toContain("truth drift");
    expect(r.out).toContain("owner confirmation required");
  });

  it("next recommends the first ready Todo whose deps are delivered", () => {
    const cwd = project(BACKLOG, { events: [JSON.stringify({ type: "pr:merge", prNumber: 1, storyId: "US-1", ts: 1 })] });
    const r = run(cwd, ["next"]);
    expect(r.out).toContain("US-2"); // US-2 depends-on US-1 (delivered) → ready
  });

  it("--json emits machine-readable facts + decisions", () => {
    const cwd = project(BACKLOG);
    const r = run(cwd, ["--json"]);
    const parsed = JSON.parse(r.out);
    expect(parsed.facts.counts.done).toBe(1);
    expect(Array.isArray(parsed.decisions)).toBe(true);
  });

  it("rejects an unknown subcommand with usage", () => {
    const cwd = project(BACKLOG);
    expect(run(cwd, ["bogus"]).code).toBe(1);
  });
});
