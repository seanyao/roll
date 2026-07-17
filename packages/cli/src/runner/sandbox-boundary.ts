import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { CycleContext } from "@roll/core";
import { quarantineBundlePath, resolveIntegrationBranch } from "@roll/infra";
import { killLiveAgents } from "./agent-spawn.js";
import { checkMainDirty, quarantineEventToRollEvent, quarantineMainCheckout, type QuarantineResult, type WriteProtectionResult } from "./main-checkout-guard.js";
import type { CleanupResult } from "./environment-cleanup.js";
import { recordRootCauseFailure } from "./failure-attribution.js";
import type { Ports } from "./ports.js";
import { eventTs, guardRuntimeDir } from "./runner-time.js";

const execFileAsync = promisify(execFile);

export async function rescueLeakedMain(
  repoCwd: string,
  refName: string,
): Promise<{ code: number; rescuedSha: string }> {
  // FIX-903: capture the current main HEAD SHA, then create a rescue branch
  // and reset main to origin/main so the leaked commits are reachable via
  // the rescue ref but main is clean again.
  let rescuedSha = "";
  try {
    const headR = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repoCwd,
      encoding: "utf8",
    });
    rescuedSha = (headR.stdout ?? "").trim();
  } catch {
    return { code: 1, rescuedSha: "" };
  }
  let code = 0;
  // US-LOOP-095: save the leaked commits to a quarantine BUNDLE instead of a
  // `rescue/leaked-*` branch. Those branches accumulated and were never GC'd
  // (retro: 51 local); the bundle holds `rescuedSha`, lands in the existing
  // file-retention dir (loop_gc), and is recovered with `git bundle unbundle`.
  try {
    const bundlePath = quarantineBundlePath(repoCwd, refName);
    mkdirSync(dirname(bundlePath), { recursive: true });
    // Bundle HEAD (still the leaked commit here — the reset below happens after);
    // `git bundle` needs a ref, not a bare SHA, or it refuses an "empty" bundle.
    await execFileAsync("git", ["bundle", "create", bundlePath, "HEAD"], {
      cwd: repoCwd,
      encoding: "utf8",
    });
  } catch {
    code = 1;
  }
  let backlogWorktreeContent: string | undefined;
  const backlogPath = join(repoCwd, ".roll", "backlog.md");
  try {
    const status = await execFileAsync("git", ["status", "--porcelain", "--", ".roll/backlog.md"], {
      cwd: repoCwd,
      encoding: "utf8",
    });
    if ((status.stdout ?? "").trim() !== "") {
      backlogWorktreeContent = readFileSync(backlogPath, "utf8");
    }
  } catch {
    backlogWorktreeContent = undefined;
  }
  try {
    // E1: restore the main checkout to the configured integration branch
    // (default origin/main). The leaked commits are already bundled above.
    await execFileAsync("git", ["reset", "--hard", resolveIntegrationBranch(repoCwd)], {
      cwd: repoCwd,
      encoding: "utf8",
    });
  } catch {
    code = 1;
  }
  if (backlogWorktreeContent !== undefined) {
    try {
      mkdirSync(dirname(backlogPath), { recursive: true });
      writeFileSync(backlogPath, backlogWorktreeContent, "utf8");
    } catch {
      code = 1;
    }
  }
  return { code, rescuedSha };
}


export function appendWriteProtectionEvent(ports: Ports, result: WriteProtectionResult): void {
  ports.events.appendEvent(ports.paths.eventsPath, {
    type: "sandbox:write_protected",
    cycleId: result.cycleId,
    status: result.status,
    repoCwd: result.repoCwd,
    markerPath: result.markerPath,
    paths: result.paths,
    ts: result.ts,
  });
}

function appendQuarantineEvent(ports: Ports, result: QuarantineResult): void {
  ports.events.appendEvent(ports.paths.eventsPath, quarantineEventToRollEvent(result));
  ports.events.appendAlert(
    ports.paths.alertsPath,
    `cycle ${result.cycleId}: quarantined main checkout ${result.reason} at ${result.phase}; ref ${result.ref}; manifest ${result.manifestPath}`,
  );
}

export async function quarantineMainCheckoutForCycle(
  ports: Ports,
  ctx: CycleContext,
  phase: QuarantineResult["phase"],
): Promise<QuarantineResult[]> {
  try {
    if (realpathSync(ports.repoCwd) === realpathSync(ports.paths.worktreePath)) return [];
  } catch {
    /* fall through to the guard; it handles unreadable paths as no-op */
  }
  const results = await quarantineMainCheckout({
    repoCwd: ports.repoCwd,
    runtimeDir: guardRuntimeDir(ports),
    cycleId: ctx.cycleId ?? "",
    ...(ctx.storyId !== undefined ? { storyId: ctx.storyId } : {}),
    phase,
    nowMs: () => eventTs(ports),
  });
  for (const result of results) appendQuarantineEvent(ports, result);
  return results;
}

export interface MainCheckoutLeakWatchdog {
  stop(): Promise<{ detected: boolean; files: string[] }>;
}

export function startMainCheckoutLeakWatchdog(
  ports: Ports,
  ctx: CycleContext,
  opts: { pollMs?: number; kill?: () => number } = {},
): MainCheckoutLeakWatchdog {
  try {
    if (realpathSync(ports.repoCwd) === realpathSync(ports.paths.worktreePath)) {
      return { stop: async () => ({ detected: false, files: [] }) };
    }
  } catch {
    /* fall through; checkMainDirty handles unreadable paths as clean */
  }
  const pollMs = opts.pollMs ?? (Number((process.env["ROLL_MAIN_LEAK_POLL_MS"] ?? "").trim()) || 2_000);
  const kill = opts.kill ?? ((): number => killLiveAgents("SIGKILL"));
  let detected = false;
  let files: string[] = [];
  let running = false;
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  // E7: snapshot the main checkout's dirt at startup and DIFF every tick against
  // it, so only paths the builder writes AFTER spawn count as a leak. On a
  // submodule super-repo the main checkout is permanently dirty (gitlink pointer
  // drift, colleague WIP, untracked `wt-*/`); the previous absolute-dirt check
  // SIGKILL'd every builder on its first tick. The baseline is captured async so
  // this function stays synchronous; the git status resolves in a few dozen ms
  // while the first tick is pollMs (default 2s) away, so ticks that run before
  // the baseline is ready are skipped (see `baselineReady` below) rather than
  // racing an unset baseline. A best-effort empty baseline on git error degrades
  // to the original absolute-dirt behavior rather than toppling the cycle.
  let baseline: Set<string> | null = null;
  const baselinePromise = checkMainDirty(ports.repoCwd)
    .then((dirty) => {
      baseline = new Set(dirty);
    })
    .catch(() => {
      baseline = new Set();
    });

  const tick = async (): Promise<void> => {
    if (running || stopped || detected) return;
    // Skip ticks until the baseline snapshot is ready — never diff against null.
    if (baseline === null) return;
    running = true;
    try {
      const dirty = await checkMainDirty(ports.repoCwd);
      const base = baseline;
      const newDirty = dirty.filter((path) => !base.has(path));
      if (newDirty.length === 0) return;
      detected = true;
      files = newDirty;
      clearInterval(timer);
      ports.events.appendEvent(ports.paths.eventsPath, {
        type: "sandbox:main_dirty",
        cycleId: ctx.cycleId ?? "",
        phase: "active-spawn",
        files: newDirty,
        ts: eventTs(ports),
      });
      ports.events.appendAlert(
        ports.paths.alertsPath,
        `cycle ${ctx.cycleId ?? "?"}: detected main checkout write while builder was active; killing agent; files: ${newDirty.join(", ")}`,
      );
      kill();
    } catch {
      /* best-effort guard; post-spawn quarantine still runs */
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    inFlight = tick().finally(() => {
      inFlight = null;
    });
  }, pollMs);
  timer.unref?.();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      // Settle the baseline snapshot even for a very short spawn, so its promise
      // is never left dangling (no unhandled rejection); it is best-effort.
      await baselinePromise.catch(() => {});
      if (inFlight !== null) await inFlight;
      return { detected, files };
    },
  };
}

/** US-LOOP-088 — append a `cycle:cleanup` event for one cleanup rule result. */
export function appendCleanupEvent(ports: Ports, ctx: CycleContext, result: CleanupResult): void {
  try {
    ports.events.appendEvent(ports.paths.eventsPath, {
      type: "cycle:cleanup",
      cycleId: ctx.cycleId,
      rule: result.rule,
      path: result.path,
      ok: result.ok,
      ...(result.warning !== undefined ? { warning: result.warning } : {}),
      ts: eventTs(ports),
    });
  } catch {
    /* observation is best-effort; cleanup failure must not block the terminal */
  }
}

export function cleanupGuardResult(): CleanupResult {
  return {
    rule: "cleanup-main-checkout-guard",
    path: ".",
    ok: true,
    warning: "skipped cleanup because worktreePath resolves to repoCwd",
  };
}

export function recordCleanupFailures(ports: Ports, ctx: CycleContext, results: readonly CleanupResult[]): void {
  const failures = results.filter((r) => !r.ok);
  if (failures.length === 0) return;
  const summary = failures
    .map((r) => `${r.rule}${r.path !== "." ? ` ${r.path}` : ""}: ${r.warning ?? "cleanup failed"}`)
    .join("; ");
  ports.events.appendAlert(
    ports.paths.alertsPath,
    `cycle ${ctx.cycleId}: environment cleanup warning(s): ${summary}`,
  );
  recordRootCauseFailure(
    dirname(ports.paths.eventsPath),
    ctx.cycleId,
    { failureClass: "harness", rootCauseKey: "harness:env_cleanup", confidence: "envelope" },
    [],
    Number.POSITIVE_INFINITY,
  );
}
