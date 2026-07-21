import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildLoopRunnerScript,
  LOOP_ON_USAGE,
  loopOnCommand,
  loopPauseCommand,
  loopResumeCommand,
  loopWorkspaceStatusCommand,
  writeDormantMarker,
  type LoopSchedDeps,
} from "../src/commands/loop-sched.js";
import type { BacklogTargetDecision } from "../src/commands/backlog-target.js";
import { loopGoCommand, planGoTmuxCommands, type LoopGoDeps, type StartTmuxInput } from "../src/commands/loop-go.js";
import { loopRunOnceCommand } from "../src/commands/loop-run-once.js";
import { nodePorts, type RunnerPaths } from "../src/runner/index.js";
import { WorkspaceRegistry } from "@roll/infra";
import type { RouteDeps } from "@roll/core";
import { REPOSITORY_BINDING_V1, WORKSPACE_MANIFEST_V1, repositoryIdFromRemote } from "@roll/spec";
import { workspaceSchedulerPaths } from "../src/lib/operating-mode.js";

const dirs: string[] = [];

function workspaceRoot(id: string): string {
  const root = mkdtempSync(join(tmpdir(), `roll-${id}-`));
  dirs.push(root);
  return root;
}

function workspaceManifest(root: string, workspaceId: string): void {
  const remote = `https://example.test/workspaces/${workspaceId}.git`;
  const repoId = repositoryIdFromRemote(remote);
  if (!repoId.ok) throw new Error("fixture remote must be valid");
  writeFileSync(join(root, "workspace.yaml"), `${JSON.stringify({
    schema: WORKSPACE_MANIFEST_V1,
    workspaceId,
    displayName: workspaceId,
    requirements: [],
    repositories: [{
      schema: REPOSITORY_BINDING_V1,
      repoId: repoId.value,
      alias: "primary",
      remote,
      integrationBranch: "main",
      provider: "generic",
      workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: [] },
    }],
  })}\n`);
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
  it("binds the production backlog port to the Workspace backlog and leaves legacy repo-local state untouched", () => {
    const root = workspaceRoot("backlog-port");
    workspaceManifest(root, "ws-alpha");
    const backlogPath = join(root, "backlog", "index.md");
    const legacyBacklogPath = join(root, ".roll", "backlog.md");
    mkdirSync(join(root, "backlog"), { recursive: true });
    mkdirSync(join(root, ".roll"), { recursive: true });
    writeFileSync(
      backlogPath,
      "| Story | Description | Status |\n|---|---|---|\n| US-WS-016 | Workspace story | 📋 Todo |\n",
    );
    writeFileSync(
      legacyBacklogPath,
      "| Story | Description | Status |\n|---|---|---|\n| LEGACY-1 | Legacy decoy | 📋 Todo |\n",
    );
    const runtimeRoot = join(root, "runtime");
    const paths: RunnerPaths = {
      eventsPath: join(runtimeRoot, "events.ndjson"),
      runsPath: join(runtimeRoot, "runs.jsonl"),
      alertsPath: join(runtimeRoot, "alerts.log"),
      lockPath: join(runtimeRoot, "inner.lock"),
      heartbeatPath: join(runtimeRoot, "heartbeat"),
      worktreePath: join(runtimeRoot, "worktrees", "cycle-test"),
    };
    const routeDeps: RouteDeps = {
      readSlot: () => ({ agent: "claude" }),
      firstInstalled: () => "claude",
    };
    const ports = nodePorts({ repoCwd: root, paths, skillBody: "BUILD STORY", routeDeps });

    expect(ports.backlog.read(root)).toEqual([
      expect.objectContaining({ id: "US-WS-016", status: "📋 Todo" }),
    ]);
    ports.backlog.markStatus?.(root, "US-WS-016", "🔨 In Progress");

    expect(readFileSync(backlogPath, "utf8")).toContain("US-WS-016 | Workspace story | 🔨 In Progress");
    expect(readFileSync(legacyBacklogPath, "utf8")).toContain("LEGACY-1 | Legacy decoy | 📋 Todo");
  });

  it("renders loop on help before target resolution or scheduler mutation", async () => {
    const fixture = schedulerDeps({}, () => {
      throw new Error("help must not resolve a target");
    });
    let stdout = "";
    const original = process.stdout.write.bind(process.stdout);
    // @ts-expect-error capture-only
    process.stdout.write = (chunk: string | Uint8Array): boolean => (stdout += String(chunk), true);
    try {
      expect(await loopOnCommand(["--help"], fixture.deps)).toBe(0);
    } finally {
      process.stdout.write = original;
    }
    expect(stdout).toBe(`${LOOP_ON_USAGE}\n`);
    expect(stdout).toContain("--workspace <id|path>");
  });

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

    expect(script).toContain(`PROJECT='${root}'`);
    expect(script).toContain(`RT='${join(root, "runtime")}'`);
    expect(script).toContain("export ROLL_WORKSPACE='ws-alpha'");
    expect(script).toContain(`export ROLL_PROJECT_RUNTIME_DIR='${join(root, "runtime")}'`);
    expect(script).toContain(`export ROLL_WORKSPACE_BACKLOG_PATH='${join(root, "backlog", "index.md")}'`);
    expect(script).toContain("loop run-once --workspace 'ws-alpha'");
    expect(script).not.toContain(`${root}/.roll/loop`);
  });

  it("quotes adversarial Workspace and runtime paths without executing shell syntax", () => {
    const root = workspaceRoot("runner-shell-safe");
    const project = join(root, "workspace-$(touch project-dollar)-`touch project-tick`-'\"");
    const runtime = join(root, "runtime-$(touch runtime-dollar)-`touch runtime-tick`-'\"");
    mkdirSync(project, { recursive: true });
    const runner = join(root, "runner.sh");
    writeFileSync(runner, buildLoopRunnerScript({
      projectPath: project,
      slug: "ws-alpha",
      workspaceId: "ws-alpha",
      runtimeRoot: runtime,
      activeStart: 0,
      activeEnd: 24,
      rollBin: "/usr/bin/true",
    }));

    execFileSync("/bin/bash", [runner], {
      cwd: root,
      env: { ...process.env, ROLL_LOOP_FORCE: "1", ROLL_TMUX_BIN: "/usr/bin/false" },
    });

    expect(existsSync(join(runtime, "cron.log"))).toBe(true);
    expect(existsSync(join(root, "project-dollar"))).toBe(false);
    expect(existsSync(join(root, "project-tick"))).toBe(false);
    expect(existsSync(join(root, "runtime-dollar"))).toBe(false);
    expect(existsSync(join(root, "runtime-tick"))).toBe(false);
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

  it("atomically wakes a dormant Workspace without leaving an armed dormant marker", async () => {
    const root = workspaceRoot("dormant-on");
    const paths = workspaceSchedulerPaths({ workspaceId: "ws-alpha", workspaceRoot: root });
    mkdirSync(paths.runtimeRoot, { recursive: true });
    writeDormantMarker(paths.dormantMarkerPath, { since: "2026-07-21T00:00:00Z", reason: "idle" });
    const fixture = schedulerDeps({ "ws-alpha": root }, () => target("ws-alpha", root));

    expect(await loopOnCommand(["--workspace", "ws-alpha"], fixture.deps)).toBe(0);

    expect(existsSync(paths.dormantMarkerPath)).toBe(false);
    expect(existsSync(join(paths.runtimeRoot, ".waking-ws-alpha"))).toBe(false);
    expect(readFileSync(paths.eventsPath, "utf8")).toContain('"type":"loop:woke"');
    expect(fixture.calls).toContain("isArmed com.roll.loop.ws-alpha");
  });

  it("recovers an orphan Workspace wake claim and records the wake before cleanup", async () => {
    const root = workspaceRoot("orphan-waking-on");
    const paths = workspaceSchedulerPaths({ workspaceId: "ws-alpha", workspaceRoot: root });
    mkdirSync(paths.runtimeRoot, { recursive: true });
    writeFileSync(join(paths.runtimeRoot, ".waking-ws-alpha"), "orphan\n");
    const fixture = schedulerDeps({ "ws-alpha": root }, () => target("ws-alpha", root));

    expect(await loopOnCommand(["--workspace", "ws-alpha"], fixture.deps)).toBe(0);

    expect(existsSync(join(paths.runtimeRoot, ".waking-ws-alpha"))).toBe(false);
    expect(readFileSync(paths.eventsPath, "utf8")).toContain('"type":"loop:woke"');
  });

  it("restores Workspace dormancy when scheduler wake fails", async () => {
    const root = workspaceRoot("dormant-on-fail");
    const paths = workspaceSchedulerPaths({ workspaceId: "ws-alpha", workspaceRoot: root });
    mkdirSync(paths.runtimeRoot, { recursive: true });
    writeDormantMarker(paths.dormantMarkerPath, { since: "2026-07-21T00:00:00Z", reason: "idle" });
    const fixture = schedulerDeps({ "ws-alpha": root }, () => target("ws-alpha", root), () => false);
    fixture.deps.scheduler.wake = () => Promise.resolve(false);

    expect(await loopOnCommand(["--workspace", "ws-alpha"], fixture.deps)).toBe(1);

    expect(existsSync(paths.dormantMarkerPath)).toBe(true);
    expect(existsSync(join(paths.runtimeRoot, ".waking-ws-alpha"))).toBe(false);
    expect(existsSync(paths.eventsPath)).toBe(false);
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

  it("resolves run-once dry-run from Workspace identity without requiring a repository-local Roll root", async () => {
    const root = workspaceRoot("run-once");
    const rollHome = workspaceRoot("run-once-home");
    workspaceManifest(root, "ws-alpha");
    mkdirSync(join(root, "backlog"), { recursive: true });
    writeFileSync(join(root, "backlog", "index.md"), "| Story | Description | Status |\n|---|---|---|\n");
    const registry = new WorkspaceRegistry({ rollHome, now: () => 1 });
    registry.register({ workspaceId: "ws-alpha", root });
    registry.activate("ws-alpha");
    const savedRollHome = process.env["ROLL_HOME"];
    const savedWorkspace = process.env["ROLL_WORKSPACE"];
    const savedMainProject = process.env["ROLL_MAIN_PROJECT"];
    const savedRuntime = process.env["ROLL_PROJECT_RUNTIME_DIR"];
    let stdout = "";
    const original = process.stdout.write.bind(process.stdout);
    process.env["ROLL_HOME"] = rollHome;
    delete process.env["ROLL_WORKSPACE"];
    delete process.env["ROLL_MAIN_PROJECT"];
    delete process.env["ROLL_PROJECT_RUNTIME_DIR"];
    // @ts-expect-error capture-only
    process.stdout.write = (chunk: string | Uint8Array): boolean => (stdout += String(chunk), true);
    try {
      expect(await loopRunOnceCommand(["--dry-run", "--workspace", "ws-alpha"])).toBe(0);
    } finally {
      process.stdout.write = original;
      if (savedRollHome === undefined) delete process.env["ROLL_HOME"];
      else process.env["ROLL_HOME"] = savedRollHome;
      if (savedWorkspace === undefined) delete process.env["ROLL_WORKSPACE"];
      else process.env["ROLL_WORKSPACE"] = savedWorkspace;
      if (savedMainProject === undefined) delete process.env["ROLL_MAIN_PROJECT"];
      else process.env["ROLL_MAIN_PROJECT"] = savedMainProject;
      if (savedRuntime === undefined) delete process.env["ROLL_PROJECT_RUNTIME_DIR"];
      else process.env["ROLL_PROJECT_RUNTIME_DIR"] = savedRuntime;
      delete process.env["ROLL_PROJECT_RUNTIME_DIR"];
      delete process.env["ROLL_WORKSPACE_BACKLOG_PATH"];
    }
    expect(stdout).toContain("# project: ws-alpha");
    expect(existsSync(join(root, ".roll"))).toBe(false);
    expect(existsSync(join(root, "runtime"))).toBe(false);
  });

  it("rejects an implicit repository-local run-once cwd with migration_required", async () => {
    const legacy = workspaceRoot("legacy-run-once");
    const rollHome = workspaceRoot("legacy-home");
    execFileSync("git", ["init", "--quiet"], { cwd: legacy });
    mkdirSync(join(legacy, ".roll"));
    writeFileSync(join(legacy, ".roll", "backlog.md"), "legacy\n");
    const savedCwd = process.cwd();
    const savedRollHome = process.env["ROLL_HOME"];
    const savedWorkspace = process.env["ROLL_WORKSPACE"];
    let stderr = "";
    const original = process.stderr.write.bind(process.stderr);
    process.chdir(legacy);
    process.env["ROLL_HOME"] = rollHome;
    delete process.env["ROLL_WORKSPACE"];
    // @ts-expect-error capture-only
    process.stderr.write = (chunk: string | Uint8Array): boolean => (stderr += String(chunk), true);
    try {
      expect(await loopRunOnceCommand(["--dry-run"])).toBe(1);
    } finally {
      process.stderr.write = original;
      process.chdir(savedCwd);
      if (savedRollHome === undefined) delete process.env["ROLL_HOME"];
      else process.env["ROLL_HOME"] = savedRollHome;
      if (savedWorkspace === undefined) delete process.env["ROLL_WORKSPACE"];
      else process.env["ROLL_WORKSPACE"] = savedWorkspace;
    }
    expect(stderr).toContain("migration_required");
    expect(stderr).toContain("roll workspace migrate --from");
  });
});
