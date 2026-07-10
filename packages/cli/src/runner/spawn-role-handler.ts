/**
 * US-LOOP-102 — the adversarial-pairing `spawn_role` executor.
 *
 * The orchestrator (pure) sequences test_author → implementer → attack rounds
 * and emits a {@link CycleCommand} `spawn_role` per stage; this adapter runs the
 * role agent and feeds back a `role_exited` event the orchestrator consumes.
 *
 * This is deliberately a THIN sibling of {@link executeSpawnAgentCommand} — the
 * builder-only quarantine / watchdog / cost machinery is NOT duplicated here.
 * The full §7 degrade taxonomy (rig rotation, fail-closed alerts) is US-LOOP-103
 * and the observability append_run.adversarial aggregate is US-LOOP-104; this
 * story wires the sequence + the two signals the pure state machine needs:
 *   - a role's exit code / timeout (drives the never-deadlock fallback), and
 *   - for an ATTACKER round, whether it surfaced a new hole and which breaking
 *     test it added (collected into the Phase 6 Agent-4 audit input).
 *
 * The attacker reports its finding by writing a small JSON marker to the path
 * handed in `ROLL_ADVERSARIAL_MARKER` (`{ newHole: boolean, attackTest?: string }`).
 * No marker ⇒ the round was dry. Reading a written artifact (not parsing agent
 * stdout) keeps this agent-agnostic, consistent with the roll core thesis.
 *
 * SAFETY DEFERRAL (US-LOOP-103): this thin handler INTENTIONALLY does not carry
 * the builder-spawn's full safety machinery — the FIX-929 stall detector, the
 * US-LOOP-089 main-checkout OS write-protection, and the §7 degrade taxonomy
 * (rig rotation, `adversarial:degraded` alerts). Those belong to US-LOOP-103
 * ("异常一律降级 standard 单 builder,绝不死锁"). Two protections are kept HERE so
 * this story never regresses the safety floor: (1) a spawn-local `timeoutMs`
 * hard-kill so a single hung role can never block the driver forever (the
 * between-step watchdog in run-cycle cannot interrupt an in-flight await), and
 * (2) any main-checkout leak is still caught + rescued downstream at
 * `capture_facts` (`classifyCaptured` → `rescue_leaked`), exactly as on the
 * standard path. The adversarial path is dormant unless a project opts into the
 * verified/designed execution profile, so this floor is sufficient until 103.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CycleCommand, CycleContext } from "@roll/core";
import { adversarialRolePrompt, agentSpawnEnvironment } from "./agent-spawn.js";
import { worktreeGitEnv } from "./main-checkout-guard.js";
import { readCycleTimeoutThresholds } from "./spawn-observers.js";
import { agentWritableRoots } from "./worktree-bootstrap.js";
import type { ExecuteResult, Ports } from "./ports.js";

type SpawnRoleCommand = Extract<CycleCommand, { kind: "spawn_role" }>;

/** The attacker's per-round finding marker. */
interface AttackMarker {
  newHole?: boolean;
  attackTest?: string;
}

/** Resolve the deterministic marker path for a cycle+round (also handed to the
 *  spawned agent via `ROLL_ADVERSARIAL_MARKER`). */
export function adversarialMarkerPath(ports: Ports, cycleId: string, round: number): string {
  return join(dirname(ports.paths.eventsPath), `adversarial-${cycleId || "cycle"}-round-${round}.json`);
}

function readAttackMarker(path: string): AttackMarker | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const rec = parsed as Record<string, unknown>;
    const marker: AttackMarker = {};
    if (typeof rec["newHole"] === "boolean") marker.newHole = rec["newHole"];
    if (typeof rec["attackTest"] === "string") marker.attackTest = rec["attackTest"];
    return marker;
  } catch {
    return null;
  }
}

export async function executeSpawnRoleCommand(
  cmd: SpawnRoleCommand,
  ports: Ports,
  ctx: CycleContext,
): Promise<ExecuteResult> {
  const markerPath = adversarialMarkerPath(ports, ctx.cycleId ?? "", cmd.round);
  // Clear any stale marker from a prior spawn at the same round before running.
  try {
    rmSync(markerPath, { force: true });
  } catch {
    /* best-effort */
  }

  const startSec = ports.clock();
  const rolePrompt = adversarialRolePrompt(cmd.role);
  // Spawn-local hard-kill belt: the whole cycle wall budget bounds a single
  // role, so a lone hung role can never block the driver (which cannot check
  // its between-step watchdog while awaiting one spawn). The real cycle timeout
  // still preempts earlier; this only backstops an in-flight hang.
  const wallSec = readCycleTimeoutThresholds(ports.repoCwd).wallSec;
  const res = await ports.agentSpawn(cmd.agent, {
    purpose: cmd.role,
    cwd: ports.paths.worktreePath,
    skillBody: `${rolePrompt}\n\n${ports.skillBody}`,
    writableRoots: agentWritableRoots(ports.repoCwd, ports.paths.alertsPath),
    timeoutMs: wallSec * 1000,
    ...(ctx.model !== undefined && ctx.model !== "" ? { model: ctx.model } : {}),
    ...(ctx.storyId !== undefined && ctx.storyId !== "" ? { storyId: ctx.storyId } : {}),
    ...(ctx.evidenceRunDir !== undefined ? { runDir: ctx.evidenceRunDir } : {}),
    env: {
      ...process.env,
      ROLL_LOOP_ALERT: ports.paths.alertsPath,
      ROLL_ADVERSARIAL_MARKER: markerPath,
      ...worktreeGitEnv(ports.paths.worktreePath, ports.repoCwd),
      ...agentSpawnEnvironment(cmd.agent),
    },
  });
  // CUMULATIVE elapsed (from cycle start when known) so the pure
  // adversarialNextStep `totalTimeoutSec` guard is a true subsequence-wide cap,
  // not a per-role duration. Falls back to this spawn's duration pre-cycle-start.
  const elapsedSec =
    ctx.startSec !== undefined && ctx.startSec > 0
      ? Math.max(0, ports.clock() - ctx.startSec)
      : Math.max(0, ports.clock() - startSec);

  // The attacker's newHole/attackTest come from the marker it wrote. For the
  // test_author / implementer roles there is no hole signal.
  let newHole: boolean | undefined;
  let attackTest: string | undefined;
  if (cmd.role === "attacker") {
    const marker = readAttackMarker(markerPath);
    newHole = marker?.newHole === true;
    if (newHole && typeof marker?.attackTest === "string" && marker.attackTest !== "") {
      attackTest = marker.attackTest;
    }
  }

  return {
    event: {
      type: "role_exited",
      role: cmd.role,
      exit: res.exitCode,
      timedOut: res.timedOut,
      elapsedSec,
      ...(newHole !== undefined ? { newHole } : {}),
      ...(attackTest !== undefined ? { attackTest } : {}),
    },
  };
}
