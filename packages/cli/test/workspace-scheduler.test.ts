import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildLoopRunnerScript } from "../src/commands/loop-sched.js";
import { workspaceSchedulerPaths } from "../src/lib/operating-mode.js";

const dirs: string[] = [];

function workspaceRoot(id: string): string {
  const root = mkdtempSync(join(tmpdir(), `roll-${id}-`));
  dirs.push(root);
  return root;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("US-WS-016 Workspace scheduler contract", () => {
  it("derives disjoint runtime, event, lock and pause paths from immutable Workspace identity", () => {
    const alpha = workspaceSchedulerPaths({ workspaceId: "ws-alpha", workspaceRoot: workspaceRoot("alpha") });
    const beta = workspaceSchedulerPaths({ workspaceId: "ws-beta", workspaceRoot: workspaceRoot("beta") });

    expect(alpha).toMatchObject({
      workspaceId: "ws-alpha",
      runtimeRoot: join(alpha.workspaceRoot, "runtime"),
      eventsPath: join(alpha.workspaceRoot, "runtime", "events.ndjson"),
      runsPath: join(alpha.workspaceRoot, "runtime", "runs.jsonl"),
      cycleLockPath: join(alpha.workspaceRoot, "runtime", "locks", "cycle.lock"),
      pauseMarkerPath: join(alpha.workspaceRoot, "runtime", "PAUSE-ws-alpha"),
    });
    const betaValues = new Set(Object.values(beta));
    expect(Object.values(alpha).some((value) => betaValues.has(value))).toBe(false);
  });

  it("generates a Workspace runner that binds run-once to one target and never writes repo-local .roll state", () => {
    const root = workspaceRoot("runner");
    const script = buildLoopRunnerScript({
      projectPath: root,
      slug: "ws-alpha",
      workspaceId: "ws-alpha",
      runtimeRoot: join(root, "runtime"),
      activeStart: 0,
      activeEnd: 24,
      rollBin: "/tmp/roll",
    });

    expect(script).toContain(`RT="${join(root, "runtime")}"`);
    expect(script).toContain("export ROLL_WORKSPACE='ws-alpha'");
    expect(script).toContain(`export ROLL_PROJECT_RUNTIME_DIR='${join(root, "runtime")}'`);
    expect(script).toContain("loop run-once --workspace 'ws-alpha'");
    expect(script).not.toContain(`${root}/.roll/loop`);
  });
});
