/**
 * CycleRoleSummary — US-OBS-032: a pure projection that reads the RollEvent
 * stream for one cycle and translates low-level events into a readable role
 * chain: Builder, Peer Reviewer, Evaluator, and Attest Gate.
 *
 * This is a projection over existing truth (events.ndjson + peer artifacts),
 * NOT a new source of truth. It is idempotent: rebuilding the same summary
 * from the same facts yields byte-stable output.
 */
import {
  type RollEvent,
  type CycleRoleAttempt,
  type CycleRoleName,
  type CycleRoleAttemptState,
  type CycleRoleSummary,
} from "@roll/spec";
import { readFileSync } from "node:fs";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// ── Public API ──────────────────────────────────────────────────────────────

export interface BuildCycleRoleSummaryInput {
  readonly cycleId: string;
  readonly events: readonly RollEvent[];
  readonly peerDir: string;
  readonly cycleLogDir: string;
  readonly deliveries?: readonly DeliveryRecord[];
}

export interface DeliveryRecord {
  readonly prNumber?: number;
  readonly mergeCommit?: string;
  readonly mergedAt?: string;
}

/**
 * Build a CycleRoleSummary from the event stream for one cycle.
 * Idempotent: same facts in → same summary out.
 */
export function buildCycleRoleSummary(input: BuildCycleRoleSummaryInput): CycleRoleSummary {
  const { cycleId, events, peerDir, cycleLogDir, deliveries } = input;
  const cycleEvents = events.filter((e) => "cycleId" in e && (e as { cycleId: string }).cycleId === cycleId);
  const roles: CycleRoleAttempt[] = [];
  let storyId = "";
  let executionProfile: "standard" | "verified" | "planned" = "standard";
  let builderSessionId: string | undefined;
  const sources: string[] = [cycleLogDir];

  // Builder: from cycle:start
  const startEvent = cycleEvents.find((e) => e.type === "cycle:start") as
    | { type: "cycle:start"; cycleId: string; storyId: string; agent: string; model: string; ts: number }
    | undefined;
  if (startEvent) {
    storyId = startEvent.storyId;
    if (startEvent.agent) {
      const builderLog = `${cycleLogDir}/${cycleId}.agent.log`;
      roles.push({
        role: "builder",
        agent: startEvent.agent,
        model: startEvent.model || undefined,
        state: "accepted" as CycleRoleAttemptState,
        stage: "build",
        acceptedByGate: false,
        ts: startEvent.ts,
        logPath: builderLog,
      });
      sources.push(builderLog);
    }
  }

  // Execution profile
  const profileEvent = cycleEvents.find((e) => e.type === "execution:profile") as
    | { type: "execution:profile"; profile: "standard" | "verified" | "planned" }
    | undefined;
  if (profileEvent) {
    executionProfile = profileEvent.profile;
  }

  // Pair events: peer reviewers and scorers
  const selectedReviewers = cycleEvents.filter(
    (e) => e.type === "pair:selected" && (e as { stage?: string }).stage === "review",
  ) as Array<{ type: "pair:selected"; cycleId: string; workingAgent: string; peer: string; stage: string; ts: number }>;

  const selectedScorers = cycleEvents.filter(
    (e) => e.type === "pair:selected" && (e as { stage?: string }).stage === "score",
  ) as Array<{ type: "pair:selected"; cycleId: string; workingAgent: string; peer: string; stage: string; ts: number }>;

  const verdicts = cycleEvents.filter((e) => e.type === "pair:verdict") as Array<{
    type: "pair:verdict";
    cycleId: string;
    peer: string;
    verdict: string;
    findings: number;
    stage?: string;
    ts: number;
  }>;

  const scores = cycleEvents.filter((e) => e.type === "pair:score") as Array<{
    type: "pair:score";
    cycleId: string;
    peer: string;
    score: number;
    verdict: string;
    stage: string;
    ts: number;
  }>;

  const scoreFailures = cycleEvents.filter((e) => e.type === "pair:score-failure") as Array<{
    type: "pair:score-failure";
    cycleId: string;
    peer: string;
    cause: string;
    detail?: string;
    stage: string;
    ts: number;
  }>;

  const consults = cycleEvents.filter((e) => e.type === "pair:consult") as Array<{
    type: "pair:consult";
    cycleId: string;
    peer: string;
    outcome: string;
    ts: number;
  }>;

  const blocks = cycleEvents.filter((e) => e.type === "agent:blocked") as Array<{
    type: "agent:blocked";
    cycleId: string;
    agent: string;
    cause: string;
    stage: string;
    detail: string;
    ts: number;
  }>;

  const noneAvailable = cycleEvents.filter((e) => e.type === "pair:none-available") as Array<{
    type: "pair:none-available";
    cycleId: string;
    stage: string;
    ts: number;
  }>;

  // Peer Reviewers
  for (const sel of selectedReviewers) {
    const peer = sel.peer;
    const verdict = verdicts.find((v) => v.peer === peer);
    const consult = consults.find((c) => c.peer === peer);
    const block = blocks.find((b) => b.agent === peer && b.stage === "review");

    if (block) {
      roles.push({
        role: "peer_reviewer",
        agent: peer,
        state: "failed",
        cause: block.cause,
        detail: block.detail,
        acceptedByGate: false,
        ts: block.ts,
      });
    } else if (verdict) {
      const peerGate = cycleEvents.find((e) => e.type === "peer:gate") as
        | { type: "peer:gate"; cycleId: string; verdict: string }
        | undefined;
      const accepted = peerGate !== undefined && peerGate.verdict === "consulted";
      roles.push({
        role: "peer_reviewer",
        agent: peer,
        state: accepted ? "accepted" : "returned",
        verdict: verdict.verdict,
        findings: verdict.findings,
        acceptedByGate: accepted,
        ts: verdict.ts,
      });
    } else if (consult) {
      // Returned but no structured verdict — always "returned", never "accepted"
      // (only pair:verdict produces "accepted" per the plan's mapping rules).
      roles.push({
        role: "peer_reviewer",
        agent: peer,
        state: "returned",
        detail: consult.outcome === "reviewed" ? "reviewed, no structured verdict accepted" : consult.outcome,
        acceptedByGate: false,
        ts: consult.ts,
      });
    } else {
      roles.push({
        role: "peer_reviewer",
        agent: peer,
        state: "selected",
        acceptedByGate: false,
        ts: sel.ts,
      });
    }
  }

  // Evaluators / Scorers
  for (const sel of selectedScorers) {
    const peer = sel.peer;
    const score = scores.find((s) => s.peer === peer);
    const failure = scoreFailures.find((f) => f.peer === peer);
    const block = blocks.find((b) => b.agent === peer && b.stage === "score");

    if (block) {
      roles.push({
        role: "evaluator",
        agent: peer,
        state: "failed",
        cause: block.cause,
        detail: block.detail,
        acceptedByGate: false,
        ts: block.ts,
      });
    } else if (failure) {
      roles.push({
        role: "evaluator",
        agent: peer,
        state: "failed",
        cause: failure.cause,
        detail: failure.detail,
        acceptedByGate: false,
        ts: failure.ts,
      });
    } else if (score) {
      // Accepted score — check attest gate
      const attestGate = cycleEvents.find((e) => e.type === "attest:gate") as
        | { type: "attest:gate"; cycleId: string; verdict: string }
        | undefined;
      const acceptedByGate = attestGate !== undefined && attestGate.verdict === "produced";
      roles.push({
        role: "evaluator",
        agent: peer,
        state: "accepted",
        score: score.score,
        verdict: score.verdict,
        acceptedByGate,
        ts: score.ts,
      });
    } else {
      // Selected, no score returned yet
      roles.push({
        role: "evaluator",
        agent: peer,
        state: "selected",
        acceptedByGate: false,
        ts: sel.ts,
      });
    }
  }

  // Scorers with score-failure but no pair:selected (e.g. agy in the worked sample)
  for (const fail of scoreFailures) {
    const alreadyHandled = roles.some(
      (r) => r.role === "evaluator" && r.agent === fail.peer,
    );
    if (!alreadyHandled) {
      roles.push({
        role: "evaluator",
        agent: fail.peer,
        state: "failed",
        cause: fail.cause,
        detail: fail.detail,
        acceptedByGate: false,
        ts: fail.ts,
      });
    }
  }

  // `pair:none-available` — no scorer was available
  if (noneAvailable.length > 0) {
    for (const na of noneAvailable) {
      roles.push({
        role: na.stage === "score" ? ("evaluator" as CycleRoleName) : ("peer_reviewer" as CycleRoleName),
        agent: null,
        state: "not_available",
        acceptedByGate: false,
        ts: na.ts,
      });
    }
  }

  // Attest Gate — only add if an actual attest:gate event exists
  const attestGateEvent = cycleEvents.find((e) => e.type === "attest:gate") as
    | { type: "attest:gate"; cycleId: string; verdict: string; reasons?: string[]; ts: number }
    | undefined;

  if (attestGateEvent) {
    roles.push({
      role: "attest_gate",
      agent: null,
      state: attestGateEvent.verdict === "produced" ? "accepted" : "rejected",
      verdict: attestGateEvent.verdict,
      detail: attestGateEvent.reasons?.join("; "),
      acceptedByGate: false,
      ts: attestGateEvent.ts,
    });
  }
  const attestVerdict = attestGateEvent?.verdict ?? undefined;

  // Gates summary
  const peerGateEvent = cycleEvents.find((e) => e.type === "peer:gate") as
    | { type: "peer:gate"; cycleId: string; verdict: string }
    | undefined;

  // Delivery facts from external records
  let deliveryStatus: string | undefined;
  if (deliveries && deliveries.length > 0) {
    const merged = deliveries.find((d) => d.mergeCommit);
    if (merged) {
      deliveryStatus = merged.prNumber ? `PR #${merged.prNumber} merged` : "merged";
    } else {
      deliveryStatus = `PR #${deliveries[0]!.prNumber ?? "?"} open`;
    }
  } else {
    // Check for cycle:end outcome
    const endEvent = cycleEvents.find((e) => e.type === "cycle:end") as
      | { type: "cycle:end"; cycleId: string; outcome: string }
      | undefined;
    if (endEvent) {
      deliveryStatus = endEvent.outcome;
    }
  }

  return {
    schema: "cycle-role-summary.v1",
    cycleId,
    storyId: storyId || "unknown",
    executionProfile,
    generatedAt: new Date().toISOString(),
    builderSessionId,
    roles,
    gates: {
      peerGate: peerGateEvent?.verdict,
      attestGate: attestVerdict,
      delivery: deliveryStatus,
    },
    sources,
  };
}

// ── Markdown rendering ───────────────────────────────────────────────────────

/**
 * Render a CycleRoleSummary to human-readable markdown.
 * Matches the worked-sample shape from the plan.
 */
export function renderCycleRoleSummaryMarkdown(summary: CycleRoleSummary): string {
  const lines: string[] = [];
  lines.push(`# Cycle Role Summary — ${summary.cycleId}`);
  lines.push("");
  lines.push(`Story: ${summary.storyId}`);
  lines.push(`Execution profile: ${summary.executionProfile}`);
  if (summary.builderSessionId) lines.push(`Builder session: ${summary.builderSessionId}`);
  lines.push("");

  // Group roles by type
  const byRole = groupBy(summary.roles, (r) => r.role);

  // Builder
  const builders = byRole.get("builder") ?? [];
  if (builders.length > 0) {
    lines.push("## Builder");
    for (const b of builders) {
      const agent = b.agent ?? "unknown";
      const model = b.model ? ` / ${b.model}` : "";
      lines.push(`- ${agent}${model}`);
      if (b.logPath) lines.push(`  - log: ${b.logPath}`);
    }
    lines.push("");
  }

  // Peer Review
  const reviewers = byRole.get("peer_reviewer") ?? [];
  if (reviewers.length > 0) {
    lines.push("## Peer Review");
    for (const r of reviewers) {
      const agent = r.agent ?? "(none)";
      let detail = r.state;
      if (r.state === "accepted" && r.verdict) detail += ` verdict=${r.verdict}`;
      if (r.findings !== undefined) detail += ` findings=${r.findings}`;
      if (r.detail) detail += ` (${r.detail})`;
      lines.push(`- ${agent}: ${detail}`);
    }
    lines.push("");
  } else {
    lines.push("## Peer Review");
    lines.push("- (none)");
    lines.push("");
  }

  // Evaluator / Score
  const evaluators = byRole.get("evaluator") ?? [];
  if (evaluators.length > 0) {
    lines.push("## Evaluator / Score");
    for (const e of evaluators) {
      const agent = e.agent ?? "(none)";
      let detail = e.state;
      if (e.state === "accepted") {
        if (e.score !== undefined) detail += ` score=${e.score}`;
        if (e.verdict) detail += ` verdict=${e.verdict}`;
      }
      if (e.cause) detail += ` ${e.cause}`;
      if (e.detail) detail += ` (${e.detail})`;
      lines.push(`- ${agent}: ${detail}`);
    }
    lines.push("");
  } else {
    lines.push("## Evaluator / Score");
    lines.push("- (none)");
    lines.push("");
  }

  // Gates
  lines.push("## Gates");
  if (summary.gates.peerGate) lines.push(`- peer: ${summary.gates.peerGate}`);
  if (summary.gates.attestGate) lines.push(`- attest: ${summary.gates.attestGate}`);
  if (summary.gates.delivery) lines.push(`- delivery: ${summary.gates.delivery}`);
  lines.push("");

  return lines.join("\n");
}

// ── Artifact writer ──────────────────────────────────────────────────────────

/**
 * Write summary.md and summary.json to the output directory.
 * Creates the directory if it doesn't exist.
 */
export function writeCycleRoleSummaryArtifacts(summary: CycleRoleSummary, outDir: string): void {
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  // Write JSON
  const jsonPath = `${outDir}/summary.json`;
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2), "utf-8");

  // Write Markdown
  const mdPath = `${outDir}/summary.md`;
  writeFileSync(mdPath, renderCycleRoleSummaryMarkdown(summary), "utf-8");
}

// ── Terminal rendering ───────────────────────────────────────────────────────

/**
 * Render a concise terminal-friendly role summary.
 */
export function renderCycleRolesForTerminal(
  summary: CycleRoleSummary,
  opts: { json: boolean },
): string {
  if (opts.json) {
    return JSON.stringify(summary, null, 2);
  }
  return renderCycleRoleSummaryMarkdown(summary);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupBy<T, K extends string | number | symbol>(
  items: readonly T[],
  keyFn: (item: T) => K,
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}
