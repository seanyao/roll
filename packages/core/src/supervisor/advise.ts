/**
 * US-V4-008 — Supervisor Agent v0: ADVISE.
 *
 * Turns {@link SupervisorFacts} into structured {@link SupervisorDecision}
 * records and answers system-level questions ("what should Roll do next?", "why
 * is the project stuck?"). Pure. Advisory ONLY: every decision that would change
 * persistent policy carries `requiresOwner: true` — the Supervisor never silently
 * rewrites routing/policy or marks a Story Done (the metrics-don't-mutate-policy
 * invariant).
 */
import type { SupervisorDecision, SupervisorFacts, SupervisorInput } from "@roll/spec";

function summarizeIds(ids: readonly string[], limit = 5): string {
  if (ids.length === 0) return "none";
  const shown = ids.slice(0, limit).join(", ");
  const remaining = ids.length - limit;
  return remaining > 0 ? `${shown}, … +${remaining} more` : shown;
}

/** Produce the Supervisor's ordered advice from the project facts. Pure. */
export function adviseProject(facts: SupervisorFacts): SupervisorDecision[] {
  const decisions: SupervisorDecision[] = [];
  if (facts.truthDrift.length > 0) {
    decisions.push({
      kind: "escalate",
      reason:
        `truth coverage partial: ${facts.truthDrift.length} Done row(s) lack structured delivery truth ` +
        `(${summarizeIds(facts.truthDrift)}). This is a backfill/audit task, not a release blocker unless release consistency fails.`,
      evidence: [],
      requiresOwner: true,
    });
  }
  if (facts.stuckStories.length > 0) {
    decisions.push({
      kind: "escalate",
      reason: `stuck stories (repeated failures): ${summarizeIds(facts.stuckStories)}`,
      evidence: [],
      requiresOwner: true,
    });
  }
  if (facts.routeConfigErrors.length > 0) {
    decisions.push({
      kind: "recommend-route-change",
      reason: `route profile errors: ${facts.routeConfigErrors.join("; ")}`,
      evidence: [],
      requiresOwner: true,
    });
  }
  if (!facts.budgetHealth.ok) {
    decisions.push({ kind: "pause", reason: facts.budgetHealth.note, evidence: [], requiresOwner: true });
  }
  if (!facts.releaseReadiness.ready) {
    decisions.push({
      kind: "release-readiness",
      reason: `release blocked: ${summarizeIds(facts.releaseReadiness.blockers)}`,
      evidence: [],
      requiresOwner: true,
    });
  }
  return decisions;
}

/**
 * US-V4-008 — answer "what should Roll do next?". Deterministic ranking over the
 * backlog: the first un-blocked, not-in-flight, not-delivered Todo whose
 * dependencies are all delivered. Returns a human-readable recommendation; the
 * Supervisor advises, the owner confirms.
 */
export function recommendNext(input: SupervisorInput): { storyId: string | null; reason: string } {
  const deliveredSet = new Set(input.delivered);
  const inFlight = new Set(input.openPrStories);
  const blockedStatus = (s: string): boolean => {
    const t = s.toLowerCase();
    return t.includes("blocked") || t.includes("🔒") || t.includes("deferred") || t.includes("⏸");
  };
  const isTodo = (s: string): boolean => s.toLowerCase().includes("todo") || s.includes("📋");
  for (const row of input.backlog) {
    if (!isTodo(row.status) || blockedStatus(row.status)) continue;
    if (deliveredSet.has(row.id) || inFlight.has(row.id)) continue;
    const deps = row.dependsOn ?? [];
    const unmet = deps.filter((d) => !deliveredSet.has(d));
    if (unmet.length > 0) continue;
    return { storyId: row.id, reason: `next ready Todo (deps satisfied${deps.length > 0 ? `: ${deps.join(", ")}` : ""})` };
  }
  return { storyId: null, reason: "no ready Todo (all delivered, in-flight, blocked, or dependency-gated)" };
}

/** US-V4-008 — answer "why is the project stuck?" from the facts. */
export function explainStuck(facts: SupervisorFacts): string {
  const parts: string[] = [];
  if (facts.stuckStories.length > 0) parts.push(`repeated failures on: ${summarizeIds(facts.stuckStories)}`);
  if (facts.truthDrift.length > 0) parts.push(`truth coverage partial on: ${summarizeIds(facts.truthDrift)}`);
  if (facts.routeConfigErrors.length > 0) parts.push(`route config errors: ${facts.routeConfigErrors.join("; ")}`);
  if (!facts.budgetHealth.ok) parts.push(facts.budgetHealth.note);
  if (facts.counts.todo === 0 && facts.openPrCount === 0) parts.push("no Todo work and no open PRs");
  return parts.length === 0 ? "not stuck: work is flowing (open PRs and/or ready Todos exist)" : parts.join("; ");
}
