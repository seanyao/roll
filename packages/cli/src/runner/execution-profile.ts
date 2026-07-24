import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  applyExecutionPolicy,
  assembleEvalReport,
  classifyStoryRisk,
  designContractVsDelivered,
  explainExecutionProfile,
  normalizeAgentConfig,
  parseDesignContract,
  renderEvalReport,
  selectExecutionProfile,
  summarizeDesignContractVsDelivered,
  validateDesignArtifact,
  validateEvaluatorArtifact,
  type CycleContext,
} from "@roll/core";
import type { AdversarialPlan } from "@roll/core";
import type { ArtifactManifest, ExecutionProfile, ResolutionSource, Rig } from "@roll/spec";
import { resolveScopedCastRole } from "./scoped-route.js";
import { cardArchiveDir } from "../lib/archive.js";
import { readLatestStoryReviewScore } from "../lib/review-score.js";
import { storySpecPath } from "./attest-gate.js";
import { resolveExecutionCwd } from "./submodule-worktree.js";
import { spawnWatched } from "./spawn-watchdog.js";
import type { Ports } from "./ports.js";
import { eventTs } from "./runner-time.js";

/** Parse an `est_min:<n>` tag from a backlog desc (router input). */
export function parseEstMin(desc: string): number | undefined {
  const m = /est[_-]?min:\s*(\d+)/i.exec(desc);
  return m === null ? undefined : Number(m[1]);
}

/**
 * FIX-1026 — parse `est_min:<n>` from a STORY SPEC's YAML frontmatter.
 *
 * The agents.yaml tier→rig contract (easy ≤8, default 8–20, hard >20) is driven
 * by `est_min`, and the documented escalation lever is "bump est_min to send a
 * stuck card to a harder tier". That lever lives in the spec frontmatter, which
 * was never read by the router — only the backlog row's `est_min:` tag was. A
 * spec declaring `est_min: 24` therefore still ran on the `default` tier.
 *
 * This reads ONLY the leading `--- … ---` frontmatter block (so a stray
 * `est_min:` mention in the prose body cannot hijack routing) and returns the
 * first `est_min:` integer there, or undefined when absent/unparseable. The
 * resolve_route handler prefers this over the backlog row so the spec is the
 * single source of truth for sizing.
 */
export function parseEstMinFromSpec(specText: string): number | undefined {
  const fm = /^---\n([\s\S]*?)\n---/.exec(specText);
  if (fm === null) return undefined;
  const m = /^\s*est[_-]?min:\s*(\d+)/im.exec(fm[1] ?? "");
  return m === null ? undefined : Number(m[1]);
}

/** US-V4-004/003 — the project's `execution_policy.mode` from `.roll/agents.yaml`
 *  (default "standard" when absent/unparseable). Gates whether verified/designed
 *  stages execute; standard keeps the cycle Builder-only (no regression). */
function executionPolicyMode(repoCwd: string): "standard" | "verified" | "designed" | "auto" {
  try {
    const p = join(repoCwd, ".roll", "agents.yaml");
    if (!existsSync(p)) return "standard";
    return normalizeAgentConfig(readFileSync(p, "utf8")).config.executionPolicy.mode;
  } catch {
    return "standard";
  }
}

/**
 * US-V4-004 — select the Story execution profile from the spec's risk signals and
 * RECORD it in a durable `execution:profile` event. Pure-decision + one append;
 * never throws (a spec read blip falls back to `standard`, the current
 * builder-only path). Returns the profile so the executor can fold it into the
 * cycle context. In v4.0 only `standard` actually executes — recording the chosen
 * profile is the foundation verified/designed execution builds on (US-V4-005/006).
 */
export function recordExecutionProfile(
  ports: Ports,
  cycleId: string,
  storyId: string,
  estMin: number | undefined,
): ExecutionProfile {
  let profile: ExecutionProfile = "standard";
  let reason = "standard: spec unavailable";
  try {
    const specPath = storySpecPath(ports.repoCwd, storyId);
    if (specPath !== null && existsSync(specPath)) {
      const input = classifyStoryRisk(storyId, readFileSync(specPath, "utf8"), {
        ...(estMin !== undefined ? { estimatedMinutes: estMin } : {}),
      });
      const classified = selectExecutionProfile(input);
      // Apply execution_policy.mode (default "standard" — incl. no agents.yaml) so
      // a project that has not opted into verified/designed stays Builder-only (the
      // v4.0 no-regression guarantee). The classification still informs the reason.
      const mode = executionPolicyMode(ports.repoCwd);
      profile = applyExecutionPolicy(classified, mode);
      reason = `${explainExecutionProfile(input)} [policy:${mode} → ${profile}]`;
    }
  } catch {
    profile = "standard";
    reason = "standard: profile selection failed (fell back)";
  }
  try {
    ports.events.appendEvent(ports.paths.eventsPath, {
      type: "execution:profile",
      cycleId,
      storyId,
      profile,
      reason,
      ts: eventTs(ports),
    });
  } catch {
    /* recording is best-effort; never topple routing on an event-append blip */
  }
  return profile;
}

/** US-LOOP-102 — default adversarial-pairing parameters (design §3.1). A later
 *  story can source these from the profile's `adversarial:` config block; these
 *  are the owner-signed defaults until then. */
export const DEFAULT_ADVERSARIAL_CFG = {
  maxRounds: 4,
  dryRoundsToStop: 2,
  totalTimeoutSec: 2700,
} as const;

/**
 * US-LOOP-102 — resolve the adversarial plan for a verified/designed cycle, or
 * `undefined` to run the standard single-builder path (zero behaviour change).
 *
 * The routed builder is the IMPLEMENTER; the test_author/attacker is the FIRST
 * active agent that differs from it — a minimal heterogeneity gate (agent-entry
 * difference). No heterogeneous partner available ⇒ `undefined` (degrade to
 * standard). Session-level fail-closed independence
 * (`assertAdversarialIndependence`) and the full §7 degrade taxonomy + alerts are
 * US-LOOP-103; this only opens the routing seam.
 */
export function planAdversarial(
  profile: ExecutionProfile,
  implementer: string,
  activeAgents: readonly string[],
): AdversarialPlan | undefined {
  if (profile !== "verified" && profile !== "designed") return undefined;
  const testAuthor = activeAgents.find((a) => a !== "" && a !== implementer);
  if (testAuthor === undefined) return undefined;
  return { testAuthor, implementer, ...DEFAULT_ADVERSARIAL_CFG };
}

export function writeEvaluatorArtifact(
  ports: Ports,
  ctx: CycleContext,
  signals: { attestStatus: "produced" | "skipped" | "unknown"; blockingFindings: readonly string[]; designContractVsDelivered?: string },
): { written: boolean; valid: boolean; reasons: readonly string[] } {
  const profile = ctx.selectedProfile;
  if (profile !== "verified" && profile !== "designed") return { written: false, valid: true, reasons: [] };
  const storyId = ctx.storyId ?? "";
  const runDir = ctx.evidenceRunDir ?? "";
  if (storyId === "" || runDir === "") return { written: false, valid: false, reasons: ["no story id / run dir for evaluator artifact"] };
  const scoreEntry = readLatestStoryReviewScore(ports.repoCwd, storyId);
  const verdict: "good" | "ok" | "regression" =
    scoreEntry?.verdict === "good" || scoreEntry?.verdict === "regression" ? scoreEntry.verdict : "ok";
  let designSummary = signals.designContractVsDelivered;
  if (designSummary === undefined || designSummary === "") {
    const contractPath = join(runDir, "role-artifacts", "designer", "design-contract.md");
    if (existsSync(contractPath)) {
      try {
        const contract = parseDesignContract(readFileSync(contractPath, "utf8"), storyId);
        if (contract !== null) {
          designSummary = summarizeDesignContractVsDelivered(designContractVsDelivered(contract, deliveredAcItems(ports.repoCwd, storyId)));
        }
      } catch {
        /* design-contract-vs-delivered is best-effort context for the report */
      }
    }
  }
  const report = assembleEvalReport({
    storyId,
    blockingFindings: signals.blockingFindings,
    ...(scoreEntry !== undefined ? { score: { value: scoreEntry.score, verdict } } : {}),
    attestStatus: signals.attestStatus,
    ...(designSummary !== undefined && designSummary !== "" ? { designContractVsDelivered: designSummary } : {}),
  });
  const reportMd = renderEvalReport(report);
  const manifest: ArtifactManifest = {
    schemaVersion: 1,
    storyId,
    cycleId: ctx.cycleId ?? "",
    role: "evaluator",
    // FIX-1262: the evaluator's rig.agent is the agent that ACTUALLY produced
    // the score (scoredBy) — never a fabricated 'reasonix'. When the score
    // entry carries no scorer, leave agent undefined so validateEvaluatorArtifact
    // fails loud ("manifest.rig.agent missing") instead of the artifact silently
    // claiming an independent evaluation by an agent that never ran.
    rig: { agent: scoreEntry?.scoredBy } as Rig,
    sessionId: scoreEntry?.sessionId ?? "",
    // E4: record the execution worktree (submodule cycle worktree for a submodule
    // story) as the delivery's worktree — the same place the builder/scorer ran.
    worktreeCwd: resolveExecutionCwd(ports, ctx),
    scoreRepoCwd: ports.repoCwd,
    inputs: [
      { path: `${storyId}-report.html`, kind: "report" },
      { path: "ac-map.json", kind: "evidence" },
    ],
    outputs: [{ path: "role-artifacts/evaluator/eval-report.md", kind: "report" }],
    createdAt: new Date(eventTs(ports)).toISOString(),
  };
  const dir = join(runDir, "role-artifacts", "evaluator");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "eval-report.md"), reportMd);
    writeFileSync(join(dir, "artifact-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  } catch {
    return { written: false, valid: false, reasons: ["failed to write evaluator artifact files"] };
  }
  const v = validateEvaluatorArtifact({ manifest, reportMd, storyId, builderSessionId: ctx.builderSessionId ?? "" });
  return { written: true, valid: v.ok, reasons: v.reasons };
}

function deliveredAcItems(repoCwd: string, storyId: string): string[] {
  try {
    const p = join(cardArchiveDir(repoCwd, storyId), "ac-map.json");
    if (!existsSync(p)) return [];
    const arr = JSON.parse(readFileSync(p, "utf8")) as Array<{ ac?: string; status?: string }>;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e) => e.status === "pass" || e.status === "partial" || e.status === "readonly")
      .map((e) => e.ac ?? "")
      .filter((a) => a !== "");
  } catch {
    return [];
  }
}


function buildDesignerPrompt(storyId: string, contractAbsPath: string): string {
  return [
    `You are the DESIGNER for story ${storyId} in a designed execution profile.`,
    `Read the story spec under .roll/features/**/${storyId}/spec.md and produce a design contract.`,
    `Write the contract to: ${contractAbsPath}`,
    "It MUST be markdown with these sections (use '- ' bullets):",
    "## Scope boundary",
    "## Acceptance contract",
    "## Expected evidence",
    "## Risks",
    "## Out of scope",
    "## Resize / split guidance   (optional prose)",
    "Do NOT write product code — you only design. The Builder consumes this contract next.",
  ].join("\n");
}

/**
 * US-DELTA-006 — the Designer role resolved for a Full Delta cycle. `ok:false`
 * means no valid `design` binding could be cast — the caller MUST fail closed
 * (the Builder never starts). `null` (from {@link DesignerStageDeps.resolveDesigner})
 * means the project has no scoped agents.yaml at all; that is ALSO fail-closed
 * for the designed profile (no quiet fallback to reusing the Builder agent).
 */
export interface DesignerResolution {
  readonly ok: boolean;
  readonly agent?: string;
  readonly model?: string;
  readonly source: ResolutionSource;
  readonly reasons: readonly string[];
  readonly error?: string;
}

/** Test/injection seam for the designer stage. */
export interface DesignerStageDeps {
  /** Resolve the Designer INDEPENDENTLY (scope role `design`), never the Builder
   *  agent. Default: the scoped `designer` cast-role resolution. `null` ⇒ no
   *  scoped agents.yaml (fail closed for a designed cycle). */
  readonly resolveDesigner?: (repoCwd: string) => DesignerResolution | null;
  /** Host id stamped into the delta role facts (default `os.hostname()`). */
  readonly hostId?: string;
}

/**
 * US-DELTA-006 — the default independent Designer resolver: the scoped
 * `designer` cast role maps to the `design` scope role. A missing scoped config
 * (`null`), a non-`design` scope role, or an unresolved `design` binding all
 * surface as fail-closed (no fallback to the Builder's `execute` agent).
 */
function defaultResolveDesigner(repoCwd: string): DesignerResolution | null {
  const route = resolveScopedCastRole(repoCwd, "designer");
  if (route === null) return null;
  if (route.scopeRole !== "design") {
    return {
      ok: false,
      source: "availability-fallback",
      reasons: [],
      error: `resolved scope role '${route.scopeRole}', expected 'design'`,
    };
  }
  if (!route.resolution.ok) {
    const errors = route.resolution.failure.errors;
    return {
      ok: false,
      source: "availability-fallback",
      reasons: errors as string[],
      error: errors[0] ?? "design role unresolved",
    };
  }
  const r = route.resolution.resolved;
  return {
    ok: true,
    agent: r.agent,
    ...(r.model !== undefined && r.model !== "" ? { model: r.model } : {}),
    // A `fixed` owner binding is an explicit user pin; a `select` pool is an
    // availability-driven cast.
    source: r.selectedStrategy === "fixed" ? "user-pin" : "availability-fallback",
    reasons: [`scoped design role via ${r.source}`, `strategy:${r.selectedStrategy}`],
  };
}

/**
 * US-DELTA-006 — the Full Delta / `designed` DESIGN STAGE. The Designer is cast
 * INDEPENDENTLY of the Builder (its own agent identity + session), records
 * separate `delta:role_resolved` and `delta:role_started` facts, runs READ-ONLY
 * (no product worktree write roots), and FAILS CLOSED — returning `ok:false` so
 * the Builder never starts — when no valid `design` binding resolves or the
 * Designer publishes no valid contract.
 */
export async function runDesignerStage(
  ports: Ports,
  ctx: CycleContext,
  deps: DesignerStageDeps = {},
): Promise<{ ran: boolean; ok: boolean; reasons: readonly string[]; designerAgent?: string; designerSessionId?: string }> {
  if (ctx.selectedProfile !== "designed") return { ran: false, ok: true, reasons: [] };
  const storyId = ctx.storyId ?? "";
  const runDir = ctx.evidenceRunDir ?? "";
  if (storyId === "" || runDir === "") return { ran: false, ok: false, reasons: ["no story id / run dir for designer stage"] };

  // AC1/AC2: resolve the Designer INDEPENDENTLY (scope role `design`). A missing
  // scoped config, a non-`design` scope role, or an unresolved `design` binding
  // all fail closed here — the Builder is NEVER reused as the Designer and there
  // is NO quiet fallback to `execute`.
  const resolveDesigner = deps.resolveDesigner ?? defaultResolveDesigner;
  const resolved = resolveDesigner(ports.repoCwd);
  if (resolved === null) {
    return {
      ran: false,
      ok: false,
      reasons: ["designer stage: no scoped agents.yaml design binding — Full Delta requires an independently cast Designer (no fallback to the Builder agent)"],
    };
  }
  if (!resolved.ok || resolved.agent === undefined || resolved.agent === "") {
    return { ran: false, ok: false, reasons: [`designer stage: ${resolved.error ?? "design role unresolved"}`] };
  }
  const designerAgent = resolved.agent;

  const dir = join(runDir, "role-artifacts", "designer");
  const contractPath = join(dir, "design-contract.md");
  const manifestPath = join(dir, "artifact-manifest.json");
  const designerSessionId = `${ctx.cycleId ?? "cycle"}:design:${designerAgent}:${ports.clock()}`;
  const roleInstanceId = `${ctx.cycleId ?? "cycle"}:designer:${designerAgent}`;
  const delegationId = ctx.cycleId ?? "cycle";
  const hostId = deps.hostId ?? hostname();
  // The scoped router casts an agent IDENTITY; a per-role MODEL resolution is
  // US-DELTA-002 territory, so absent an explicit model the agent name is the
  // best-available identity token (mirrors the manifest's `rig.agent`).
  const modelId = resolved.model !== undefined && resolved.model !== "" ? resolved.model : designerAgent;
  // E4: the designer reads the code it designs against; run it where the builder
  // will run (submodule cycle worktree for a submodule story). No targetSubmodule
  // ⇒ ports.paths.worktreePath, unchanged.
  const execCwd = resolveExecutionCwd(ports, ctx);

  // AC3: record SEPARATE role-resolution and role-start facts for the Designer
  // BEFORE the design stage runs, so the independent cast is auditable.
  try {
    ports.events.appendEvent(ports.paths.eventsPath, {
      type: "delta:role_resolved",
      delegationId,
      storyId,
      role: "designer",
      roleInstanceId,
      hostId,
      modelId,
      source: resolved.source,
      reasons: [...resolved.reasons],
      inventorySha256: "",
      inventoryObservedAt: new Date(eventTs(ports)).toISOString(),
      ts: eventTs(ports),
    });
    ports.events.appendEvent(ports.paths.eventsPath, {
      type: "delta:role_started",
      delegationId,
      storyId,
      role: "designer",
      sessionId: designerSessionId,
      roleInstanceId,
      hostId,
      modelId,
      identityProvenance: "adapter-observed",
      // AC5: the Designer runs READ-ONLY — only the Builder gets write roots.
      worktreeAccess: "read-only",
      ts: eventTs(ports),
    });
  } catch {
    /* recording is best-effort; never topple the stage on an event-append blip */
  }

  if (!existsSync(contractPath)) {
    try {
      mkdirSync(dir, { recursive: true });
      // US-CYCLE-002: the designer sub-spawn goes through the shared watchdog —
      // per-role cap (designer 20min) + liveness renewal in its own cwd, so a
      // productive designer survives and a silent one dies on schedule.
      await spawnWatched({
        ports,
        ctx,
        purpose: "designer",
        agent: designerAgent,
        observeCwd: execCwd,
        run: () =>
          // AC5: NO `writableRoots` — the Designer runs READ-ONLY. Only the
          // Builder spawn (spawn-agent-handler) receives product worktree write
          // roots.
          ports.agentSpawn(designerAgent, {
            cwd: execCwd,
            skillBody: buildDesignerPrompt(storyId, contractPath),
            storyId,
            runDir: dir,
          }),
      });
    } catch {
      /* a designer spawn blip -> no contract -> validation below fails closed */
    }
  }
  const manifest: ArtifactManifest = {
    schemaVersion: 1,
    storyId,
    cycleId: ctx.cycleId ?? "",
    role: "designer",
    rig: { agent: designerAgent } as Rig,
    sessionId: designerSessionId,
    worktreeCwd: execCwd,
    scoreRepoCwd: ports.repoCwd,
    inputs: [{ path: `.roll/features/**/${storyId}/spec.md`, kind: "contract" }],
    outputs: [{ path: "role-artifacts/designer/design-contract.md", kind: "contract" }],
    createdAt: new Date(eventTs(ports)).toISOString(),
  };
  try {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  } catch {
    /* best-effort manifest record */
  }
  const contractMd = existsSync(contractPath) ? readFileSync(contractPath, "utf8") : null;
  const v = validateDesignArtifact({ manifest, contractMd, storyId });
  return { ran: true, ok: v.ok, reasons: v.reasons, designerAgent, designerSessionId };
}

export function routerEstMin(worktreeCwd: string, storyId: string, backlogDesc: string): number | undefined {
  try {
    const specPath = storySpecPath(worktreeCwd, storyId);
    if (specPath !== null && existsSync(specPath)) {
      const fromSpec = parseEstMinFromSpec(readFileSync(specPath, "utf8"));
      if (fromSpec !== undefined) return fromSpec;
    }
  } catch {
    /* spec read/parse is an optimization — never topple routing on it */
  }
  return parseEstMin(backlogDesc);
}
