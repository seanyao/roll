import { launchdLabel } from "@roll/infra";
import { projectSlug as deriveProjectSlug } from "@roll/spec";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface WorkspaceSchedulerIdentity {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
}

export interface WorkspaceSchedulerPaths extends WorkspaceSchedulerIdentity {
  readonly runtimeRoot: string;
  readonly eventsPath: string;
  readonly runsPath: string;
  readonly alertsPath: string;
  readonly cycleLockPath: string;
  readonly goLockPath: string;
  readonly heartbeatPath: string;
  readonly worktreesRoot: string;
  readonly pauseMarkerPath: string;
  readonly dormantMarkerPath: string;
  readonly goalPath: string;
  readonly backlogPath: string;
}

/**
 * The scheduler owns only Workspace operational state. Product repositories
 * never contribute a second runtime root, lock, event stream or pause marker.
 */
export function workspaceSchedulerPaths(input: WorkspaceSchedulerIdentity): WorkspaceSchedulerPaths {
  const runtimeRoot = join(input.workspaceRoot, "runtime");
  return {
    ...input,
    runtimeRoot,
    eventsPath: join(runtimeRoot, "events.ndjson"),
    runsPath: join(runtimeRoot, "runs.jsonl"),
    alertsPath: join(runtimeRoot, "alerts", `ALERT-${input.workspaceId}.md`),
    cycleLockPath: join(runtimeRoot, "locks", "cycle.lock"),
    goLockPath: join(runtimeRoot, "locks", "go.lock"),
    heartbeatPath: join(runtimeRoot, "heartbeats", "scheduler"),
    worktreesRoot: join(runtimeRoot, "worktrees"),
    pauseMarkerPath: join(runtimeRoot, `PAUSE-${input.workspaceId}`),
    dormantMarkerPath: join(runtimeRoot, `DORMANT-${input.workspaceId}`),
    goalPath: join(runtimeRoot, "goal.yaml"),
    backlogPath: join(input.workspaceRoot, "backlog", "index.md"),
  };
}

export type RollOperatingMode = "guided" | "autonomous";

type InstallState = "enabled" | "stale" | "not_installed";
type RunState = "active" | "paused" | "dormant";

export interface OperatingModeView {
  readonly mode: RollOperatingMode;
  readonly installState: InstallState;
  readonly runState: RunState;
  readonly slug: string;
  readonly reason: string;
  readonly ownerAction: string;
  readonly schedulerAction: string;
}

export interface OperatingModeDeps {
  readonly launchdDir?: () => string;
  readonly launchdEnabled?: (label: string) => boolean;
  readonly uid?: () => number;
}

function gitOutput(projectPath: string, argv: readonly string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", projectPath, ...argv], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function canonicalProjectPath(projectPath: string): string {
  let path = projectPath;
  if (process.platform === "darwin") {
    try {
      path = realpathSync(path);
    } catch {
      /* keep caller path */
    }
  }
  const top = gitOutput(path, ["rev-parse", "--show-toplevel"]);
  return top !== undefined && top !== "" ? top : path;
}

function remoteUrl(projectPath: string): string | undefined {
  const origin = gitOutput(projectPath, ["remote", "get-url", "origin"]);
  if (origin !== undefined && origin !== "") return origin;
  const remotes = gitOutput(projectPath, ["remote"]);
  const first = remotes?.split("\n").find((r) => r.trim() !== "")?.trim();
  return first === undefined ? undefined : gitOutput(projectPath, ["remote", "get-url", first]);
}

export function projectOperatingSlug(projectPath: string): string {
  const override = process.env["ROLL_MAIN_SLUG"];
  if (override !== undefined && override !== "") return override;
  const path = canonicalProjectPath(projectPath);
  return deriveProjectSlug({ path, remoteUrl: remoteUrl(path) });
}

function defaultLaunchdDir(): string {
  return process.env["_LAUNCHD_DIR"] ?? join(homedir(), "Library", "LaunchAgents");
}

function installedState(slug: string, deps: OperatingModeDeps): InstallState {
  const label = launchdLabel("loop", slug);
  const plist = join((deps.launchdDir ?? defaultLaunchdDir)(), `${label}.plist`);
  if (!existsSync(plist)) return "not_installed";
  const enabled = deps.launchdEnabled ?? ((l: string): boolean => {
    try {
      const uid = (deps.uid ?? (() => process.getuid?.() ?? 501))();
      execFileSync("launchctl", ["print", `gui/${uid}/${l}`], {
        stdio: ["ignore", "ignore", "ignore"],
        timeout: 2000,
      });
      return true;
    } catch {
      return false;
    }
  });
  return enabled(label) ? "enabled" : "stale";
}

function runState(projectPath: string, slug: string): RunState {
  const rt = join(projectPath, ".roll", "loop");
  if (existsSync(join(rt, `PAUSE-${slug}`))) return "paused";
  if (existsSync(join(rt, `DORMANT-${slug}`))) return "dormant";
  return "active";
}

function nextAction(mode: RollOperatingMode, install: InstallState, run: RunState): string {
  if (mode === "autonomous") {
    if (run === "dormant") return "add Todo work or run `roll loop resume` to wake; observe with `roll supervisor live`";
    return "observe with `roll supervisor live`; pause with `roll loop pause` before manual intervention";
  }
  if (run === "paused") return "run `roll loop resume` to return to autonomous mode, or use `roll supervisor next` for manual guidance";
  if (install === "stale") return "run `roll loop on` to repair autonomous scheduling, or use `roll loop go --cards <id>` for an explicit guided run";
  return "run `roll supervisor next`, then explicitly start work with `roll loop go --cards <id>` or switch with `roll loop on`";
}

export function resolveOperatingMode(projectPath: string = process.cwd(), deps: OperatingModeDeps = {}): OperatingModeView {
  const slug = projectOperatingSlug(projectPath);
  const installState = installedState(slug, deps);
  const state = runState(projectPath, slug);
  const mode: RollOperatingMode = installState === "enabled" && state !== "paused" ? "autonomous" : "guided";
  const reason =
    mode === "autonomous"
      ? state === "dormant"
        ? "scheduler is installed and dormant; it can wake without changing agent config"
        : "scheduler is installed and eligible cycles may start within gates"
      : state === "paused"
        ? "pause marker is present; owner must resume before scheduled work starts"
        : installState === "stale"
          ? "scheduler plist exists but is not loaded"
          : "scheduler is not installed";
  const schedulerAction =
    mode === "autonomous"
      ? "may pick eligible Todo stories, but still honors pause, budget, route, evidence, Evaluator, and release gates"
      : "will not start long-running Story execution until the owner explicitly runs or resumes it";
  return {
    mode,
    installState,
    runState: state,
    slug,
    reason,
    ownerAction: nextAction(mode, installState, state),
    schedulerAction,
  };
}

export function formatOperatingMode(view: OperatingModeView): string {
  return `mode: ${view.mode} (${view.runState}/${view.installState}) — ${view.reason}`;
}

export function suggestedGuidedRun(storyId: string | null): string {
  return storyId === null ? "run `roll supervisor why` or add a Todo story" : `run \`roll loop go --cards ${storyId}\``;
}
