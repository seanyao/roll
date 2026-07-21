import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildLoopRunnerScript,
  loopOnCommand,
  loopPauseCommand,
  loopResumeCommand,
  loopWorkspaceStatusCommand,
  type LoopSchedDeps,
} from "../src/commands/loop-sched.js";
import type { BacklogTargetDecision } from "../src/commands/backlog-target.js";
import { loopGoCommand, planGoTmuxCommands, type LoopGoDeps, type StartTmuxInput } from "../src/commands/loop-go.js";
import { workspaceSchedulerPaths } from "../src/lib/operating-mode.js";

const dirs: string[] = [];

function workspaceRoot(id: string): string {
  const root = mkdtempSync(join(tmpdir(), `roll-${id}-`));
  dirs.push(root);
  return root;
}

function target(workspaceId: string, workspaceRoot: string): BacklogTargetDecision {
  return {
    ok: true,
    workspaceId,
    workspaceRoot,
    canonicalRoot: workspaceRoot,
    backlogPath: join(workspaceRoot, "backlog", "index.md"),
    storyRoot: join(workspaceRoot, "backlog"),
    runtimeRoot: join(workspaceRoot, "runtime"),
    configPath: join(workspaceRoot, "runtime", "backlog-sync.yaml"),
  };
}

function schedulerDeps(
  roots: Readonly<Record<string, string>>,
  resolveTarget: (args: readonly string[], operation: "read" | "mutation") => BacklogTargetDecision,
  armed: (label: string) => boolean = () => true,
): { readonly deps: LoopSchedDeps; readonly calls: string[]; readonly shared: string; readonly launchd: string } {
  const shared = workspaceRoot("shared");
  const launchd = workspaceRoot("launchd");
  const calls: string[] = [];
  return {
    shared,
    launchd,
    calls,
    deps: {
      identity: () => Promise.reject(new Error("legacy identity must not be used")),
      uid: () => 501,
      sharedRoot: () => shared,
      launchdDir: () => launchd,
      resolveTarget,
      scheduler: {
        wake: (label, plist) => (calls.push(`wake ${label} ${plist}`), Promise.resolve(true)),
        dormant: (label) => (calls.push(`dormant ${label}`), Promise.resolve(true)),
        isArmed: (label) => (calls.push(`isArmed ${label}`), Promise.resolve(armed(label))),
      },
    },
  };
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
    expect(script).toContain(`export ROLL_WORKSPACE_BACKLOG_PATH='${join(root, "backlog", "index.md")}'`);
    expect(script).toContain("loop run-once --workspace 'ws-alpha'");
    expect(script).not.toContain(`${root}/.roll/loop`);
  });

  it("installs independent scheduler identities and only mutates the selected Workspace", async () => {
    const alpha = workspaceRoot("alpha-on");
    const beta = workspaceRoot("beta-on");
    const roots = { "ws-alpha": alpha, "ws-beta": beta };
    const fixture = schedulerDeps(roots, (args) => {
      const id = args[args.indexOf("--workspace") + 1] ?? "";
      return target(id, roots[id as keyof typeof roots] ?? "");
    });

    expect(await loopOnCommand(["--workspace", "ws-alpha"], fixture.deps)).toBe(0);
    expect(await loopOnCommand(["--workspace", "ws-beta"], fixture.deps)).toBe(0);

    expect(fixture.calls).toContainEqual(expect.stringContaining("com.roll.loop.ws-alpha"));
    expect(fixture.calls).toContainEqual(expect.stringContaining("com.roll.loop.ws-beta"));
    expect(readFileSync(join(fixture.shared, "loop", "run-ws-alpha.sh"), "utf8")).toContain(
      `ROLL_PROJECT_RUNTIME_DIR='${join(alpha, "runtime")}'`,
    );
    expect(readFileSync(join(fixture.shared, "loop", "run-ws-beta.sh"), "utf8")).toContain(
      `ROLL_PROJECT_RUNTIME_DIR='${join(beta, "runtime")}'`,
    );
  });

  it("pauses and resumes one Workspace without changing another Workspace runtime", async () => {
    const alpha = workspaceRoot("alpha-pause");
    const beta = workspaceRoot("beta-pause");
    const roots = { "ws-alpha": alpha, "ws-beta": beta };
    const fixture = schedulerDeps(roots, (args) => {
      const id = args[args.indexOf("--workspace") + 1] ?? "";
      return target(id, roots[id as keyof typeof roots] ?? "");
    });
    const alphaPaths = workspaceSchedulerPaths({ workspaceId: "ws-alpha", workspaceRoot: alpha });
    const betaPaths = workspaceSchedulerPaths({ workspaceId: "ws-beta", workspaceRoot: beta });
    mkdirSync(betaPaths.runtimeRoot, { recursive: true });
    writeFileSync(betaPaths.pauseMarkerPath, "unchanged\n", { flag: "a" });

    expect(await loopPauseCommand(["--workspace", "ws-alpha"], fixture.deps)).toBe(0);
    expect(existsSync(alphaPaths.pauseMarkerPath)).toBe(true);
    expect(readFileSync(betaPaths.pauseMarkerPath, "utf8")).toBe("unchanged\n");

    writeFileSync(join(alphaPaths.runtimeRoot, "consecutive-fails"), "3", { flag: "a" });
    expect(await loopResumeCommand(["--workspace", "ws-alpha"], fixture.deps)).toBe(0);
    expect(existsSync(alphaPaths.pauseMarkerPath)).toBe(false);
    expect(readFileSync(join(alphaPaths.runtimeRoot, "consecutive-fails"), "utf8")).toBe("0");
    expect(readFileSync(betaPaths.pauseMarkerPath, "utf8")).toBe("unchanged\n");
  });

  it("renders --all as a read-only aggregate over isolated Workspace state", async () => {
    const alpha = workspaceRoot("alpha-status");
    const beta = workspaceRoot("beta-status");
    const alphaPaths = workspaceSchedulerPaths({ workspaceId: "ws-alpha", workspaceRoot: alpha });
    mkdirSync(alphaPaths.runtimeRoot, { recursive: true });
    writeFileSync(alphaPaths.pauseMarkerPath, "paused\n", { flag: "a" });
    const fixture = schedulerDeps({ "ws-alpha": alpha, "ws-beta": beta }, (_args, operation) => {
      expect(operation).toBe("read");
      return {
        ok: true,
        aggregate: [
          { workspaceId: "ws-alpha", workspaceRoot: alpha, canonicalRoot: alpha, backlogPath: join(alpha, "backlog", "index.md") },
          { workspaceId: "ws-beta", workspaceRoot: beta, canonicalRoot: beta, backlogPath: join(beta, "backlog", "index.md") },
        ],
      };
    }, (label) => !label.includes("beta"));
    let stdout = "";
    const original = process.stdout.write.bind(process.stdout);
    // @ts-expect-error capture-only
    process.stdout.write = (chunk: string | Uint8Array): boolean => (stdout += String(chunk), true);
    try {
      expect(await loopWorkspaceStatusCommand(["--all"], fixture.deps)).toBe(0);
    } finally {
      process.stdout.write = original;
    }

    expect(stdout).toContain(`ws-alpha  paused  armed  ${alphaPaths.runtimeRoot}`);
    expect(stdout).toContain(`ws-beta  active  unarmed  ${join(beta, "runtime")}`);
    expect(fixture.calls).toEqual(["isArmed com.roll.loop.ws-alpha", "isArmed com.roll.loop.ws-beta"]);
  });

  it("binds loop go and its tmux worker to the selected Workspace runtime and backlog", async () => {
    const root = workspaceRoot("go");
    mkdirSync(join(root, "backlog"), { recursive: true });
    writeFileSync(
      join(root, "backlog", "index.md"),
      "| Story | Description | Status |\n|---|---|---|\n| US-1 | one | 📋 Todo |\n",
    );
    let started: StartTmuxInput | undefined;
    const deps: LoopGoDeps = {
      identity: () => Promise.reject(new Error("legacy identity must not be used")),
      resolveTarget: () => target("ws-alpha", root),
      pid: () => 1,
      nowSec: () => 1,
      nowIso: () => "2026-07-21T00:00:00Z",
      hasTmux: () => true,
      startTmux: (input) => (started = input, true),
      runOnce: () => Promise.resolve(0),
    };

    expect(await loopGoCommand(["--workspace", "ws-alpha"], deps)).toBe(0);
    expect(started).toMatchObject({
      projectPath: root,
      slug: "ws-alpha",
      workspaceId: "ws-alpha",
      runtimeRoot: join(root, "runtime"),
      backlogPath: join(root, "backlog", "index.md"),
    });
    const commands = planGoTmuxCommands(started!, { sessionExists: false, watchWindowExists: false });
    const worker = commands.at(-1)?.at(-1) ?? "";
    expect(worker).toContain("ROLL_WORKSPACE='ws-alpha'");
    expect(worker).toContain(`ROLL_PROJECT_RUNTIME_DIR='${join(root, "runtime")}'`);
    expect(worker).toContain(`ROLL_WORKSPACE_BACKLOG_PATH='${join(root, "backlog", "index.md")}'`);
  });
});
