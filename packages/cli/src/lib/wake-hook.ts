/**
 * Wake-on-roll-command hook — US-LOOP-079i.
 *
 * When the loop is DORMANT (launchd booted-out, no scheduled ticks), ANY
 * productive `roll` command (build, fix, idea, story new, backlog mgmt) on a
 * backlog with work re-arms the scheduler. The hook runs after help
 * short-circuit (FIX-238) but before the handler.
 *
 * Atomic claim via rename(DORMANT → .waking) + .waking orphan recovery
 * so concurrent triggers (roll-cmd + dream) yield at most one wake.
 */
import { existsSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BacklogStore, EventBus, assessBacklog } from "@roll/core";
import { type Scheduler, launchdLabel } from "@roll/infra";
import { dormantMarkerPath } from "../commands/loop-sched.js";

// ─── deps (injectable for testing) ──────────────────────────────────────────

export interface WakeDeps {
  /** Absolute project path. */
  projectPath: string;
  /** Project slug (from projectIdentity). */
  slug: string;
  /** Scheduler seam — {@link rearmLoop} calls wake/isArmed through it. */
  scheduler: Scheduler;
  /** Path to the backlog markdown file. */
  backlogPath: string;
  /** Path to events.ndjson under the project's .roll/loop/. */
  eventsPath: string;
  /** Event bus to append loop:woke events through. */
  eventBus: EventBus;
  /** Reads + parses the backlog. Defaults to {@link BacklogStore.readBacklog}. */
  readBacklog: (path: string) => ReturnType<BacklogStore["readBacklog"]>;
  /** Exists-sync probe: `(path) => boolean`. Inject for sandbox
   *  isolation so tests never touch the real filesystem. */
  probe: (path: string) => boolean;
  /** Rename-sync: `(from, to) => void`. */
  rename: (from: string, to: string) => void;
  /** Unlink-sync: `(path) => void`. */
  unlink: (path: string) => void;
  /** Current epoch seconds. */
  nowSec: () => number;
  /** Path to the loop's launchd plist (passed to scheduler.wake). */
  loopPlistPath: string;
}

// ─── marker paths ───────────────────────────────────────────────────────────

function wakingPath(projectPath: string, slug: string): string {
  return join(projectPath, ".roll", "loop", `.waking-${slug}`);
}

// ─── rearmLoop ──────────────────────────────────────────────────────────────

/**
 * AC1/AC2: atomic claim via `rename(DORMANT-<slug> → .waking-<slug>)` as a
 * filesystem lock. The winner proceeds — only one caller can rename the file,
 * so concurrent triggers (roll-cmd + dream) yield at most one wake.
 *
 * AC3: when DORMANT is absent but `.waking` exists (crash between rename and
 * wake), recovers the orphan — finishes the wake, removes `.waking`, and emits
 * loop:woke (unless the lane is already armed).
 *
 * @param trigger — the trigger label for the loop:woke event.
 * @returns the wake epoch (s) on success, `-1` on no-op.
 */
export async function rearmLoop(
  trigger: "roll-cmd" | "dream",
  deps: WakeDeps,
): Promise<number> {
  const dormant = dormantMarkerPath(deps.projectPath, deps.slug);
  const waking = wakingPath(deps.projectPath, deps.slug);
  const label = launchdLabel("loop", deps.slug);

  // ── attempt atomic claim: rename DORMANT → .waking ──
  let claimed = false;
  try {
    deps.rename(dormant, waking);
    claimed = true;
  } catch {
    // rename failed — check for orphan .waking (AC3)
  }

  // ── orphan recovery (AC3): .waking exists, DORMANT does not ──
  if (!claimed && deps.probe(waking)) {
    const armed = await deps.scheduler.isArmed(label);
    if (!armed) {
      await deps.scheduler.wake(label, deps.loopPlistPath);
      deps.unlink(waking);
      const ts = deps.nowSec();
      deps.eventBus.appendEvent(deps.eventsPath, {
        type: "loop:woke",
        loop: "ci",
        ts,
        trigger,
        wakeEpoch: ts,
      });
      return ts;
    }
    // Lane already armed — just clean the orphan marker
    deps.unlink(waking);
    return -1;
  }

  if (!claimed) return -1; // nothing to claim, no orphan → no-op

  // ── claimed — check lane state ──
  const armed = await deps.scheduler.isArmed(label);
  if (armed) {
    // Lane already armed — clean up .waking, no wake, no event
    deps.unlink(waking);
    return -1;
  }

  // ── wake the lane ──
  await deps.scheduler.wake(label, deps.loopPlistPath);
  deps.unlink(waking);

  const ts = deps.nowSec();
  deps.eventBus.appendEvent(deps.eventsPath, {
    type: "loop:woke",
    loop: "ci",
    ts,
    trigger,
    wakeEpoch: ts,
  });

  return ts;
}

// ─── command classification ─────────────────────────────────────────────────

/**
 * AC5: commands that produce or change state — these trigger the wake hook.
 * Pure read-only commands (status, doctor, --help) and loop sub-commands
 * (to prevent recursion) are excluded.
 */
const PRODUCTIVE_COMMANDS = new Set([
  "build",
  "fix",
  "idea",
  "story",
  "backlog",
  "design",
  "propose",
  "peer",
]);

/** Loop sub-commands that must never trigger wake (AC5 anti-recursion). */
function isLoopSubcommand(args: string[]): boolean {
  return args[0] === "loop";
}

/** `story new` / `story validate` are productive; `story` alone is not. */
function isProductiveStoryArgs(args: string[]): boolean {
  const sub = args[1];
  return sub === "new" || sub === "validate";
}

/** `backlog set-status` / `backlog sync` / `backlog unstick` are productive. */
function isProductiveBacklogArgs(args: string[]): boolean {
  const sub = args[1];
  return sub === "set-status" || sub === "sync" || sub === "unstick";
}

/**
 * AC5: determine whether the given argv constitutes a "productive" command
 * that should trigger wake-on-roll.
 */
export function isProductiveCommand(args: string[]): boolean {
  if (args.length === 0) return false;
  if (isLoopSubcommand(args)) return false;
  const cmd = args[0]!;

  // --help/-h on any command is read-only
  if (cmd === "--help" || cmd === "-h" || cmd === "help") return false;
  if (args[1] === "--help" || args[1] === "-h") return false;

  if (!PRODUCTIVE_COMMANDS.has(cmd)) return false;

  // Sub-command gating: "story" / "backlog" require specific sub-commands
  if (cmd === "story" && !isProductiveStoryArgs(args)) return false;
  if (cmd === "backlog" && !isProductiveBacklogArgs(args)) return false;

  return true;
}

// ─── tryWakeOnRoll ──────────────────────────────────────────────────────────

/**
 * AC4/AC5/AC6: the main wake-on-roll-command hook. Called from
 * {@link dispatch} after the help short-circuit and before the handler.
 *
 * AC6: ROLL_NO_WAKE=1 or runner env → skip entirely.
 * AC4: fast path — probe DORMANT + .waking; both absent → return (zero
 *      backlog reads — this is ASSERTED in tests).
 * AC5: only productive commands trigger; requires marker present AND
 *      assessBacklog().hasWork.
 */
export async function tryWakeOnRoll(
  args: string[],
  deps: WakeDeps,
): Promise<void> {
  // AC6: ROLL_NO_WAKE gate
  if (
    process.env["ROLL_NO_WAKE"] === "1" ||
    process.env["ROLL_NO_WAKE"] === "true" ||
    (process.env["ROLL_LOOP_FORCE"] ?? "").trim() !== ""
  ) {
    return;
  }

  // AC4: fast path — probe markers only, no backlog read
  const dormant = dormantMarkerPath(deps.projectPath, deps.slug);
  const waking = wakingPath(deps.projectPath, deps.slug);
  const markerPresent = deps.probe(dormant) || deps.probe(waking);
  if (!markerPresent) return;

  // AC5: only productive commands trigger
  if (!isProductiveCommand(args)) return;

  // AC5: must have actual work in the backlog
  const snap = deps.readBacklog(deps.backlogPath);
  const assessment = assessBacklog(snap.items);
  if (!assessment.hasWork) return;

  await rearmLoop("roll-cmd", deps);
}

// ─── production wiring ──────────────────────────────────────────────────────

/**
 * Build the production {@link WakeDeps} wired to real filesystem and scheduler.
 */
export function buildProductionWakeDeps(
  projectPath: string,
  slug: string,
  scheduler: Scheduler,
): WakeDeps {
  const store = new BacklogStore();
  const launchdDir = join(homedir(), "Library", "LaunchAgents");
  const label = launchdLabel("loop", slug);
  return {
    projectPath,
    slug,
    scheduler,
    backlogPath: join(projectPath, ".roll", "backlog.md"),
    eventsPath: join(projectPath, ".roll", "loop", "events.ndjson"),
    eventBus: new EventBus(),
    readBacklog: (path) => store.readBacklog(path),
    probe: (path) => existsSync(path),
    rename: (from, to) => renameSync(from, to),
    unlink: (path) => unlinkSync(path),
    nowSec: () => Math.floor(Date.now() / 1000),
    loopPlistPath: join(launchdDir, `${label}.plist`),
  };
}

/**
 * Resolve the project identity and build production {@link WakeDeps}
 * (US-LOOP-079i AC6). Called once from `bin/roll.js`; returns `undefined`
 * when the project identity is unavailable (not inside a roll project).
 */
export async function createProductionWakeDeps(): Promise<WakeDeps | undefined> {
  try {
    const { createScheduler, projectIdentity } = await import("@roll/infra");
    const id = await projectIdentity();
    const scheduler = createScheduler(process.platform, { uid: process.getuid?.() ?? 501 });
    return buildProductionWakeDeps(id.path, id.slug, scheduler);
  } catch {
    return undefined;
  }
}
