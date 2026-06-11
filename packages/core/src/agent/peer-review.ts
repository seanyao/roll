import { agentVendor, isHeterogeneous } from "./pairing.js";
import { agentIsKnown, canonicalAgentName } from "./registry.js";

export type PeerReviewMode = "auto" | "hetero" | "self";
export type PeerReviewVerdict = "APPROVE" | "REQUEST_CHANGES" | "TIMEOUT" | "ERROR";
export type ReviewerKind = "external" | "auxiliary" | "unknown";

export interface ParsedPeerReview {
  verdict: "APPROVE" | "REQUEST_CHANGES";
  reason: string;
  findings: string[];
}

export interface PeerReviewerInput {
  mode: PeerReviewMode;
  candidates: readonly string[];
  workerAgents: readonly string[];
  requestedReviewer?: string;
}

export type PeerReviewerSelection =
  | {
      status: "selected";
      effectiveMode: "hetero" | "self";
      reviewer: string;
      provider: string;
      degraded: boolean;
      reason?: string;
    }
  | {
      status: "unavailable";
      reason:
        | "no_installed_reviewer"
        | "no_external_reviewer"
        | "no_heterogeneous_reviewer"
        | "requested_reviewer_is_auxiliary"
        | "requested_reviewer_unavailable";
    };

export interface PeerReviewFacts {
  agent: string;
  provider: string;
  commandFamily: string;
  effectiveMode?: "hetero" | "self";
  verdict: PeerReviewVerdict;
  reason: string;
  findings: string[];
  durationMs: number;
  transcriptPath?: string;
  evidencePath?: string;
  error?: string;
  degradedReason?: string;
}

function uniqueCanonical(agents: readonly string[]): string[] {
  const out: string[] = [];
  for (const agent of agents) {
    const canonical = canonicalAgentName(agent.trim());
    if (canonical === "" || out.includes(canonical)) continue;
    out.push(canonical);
  }
  return out;
}

export function reviewerKind(agent: string): ReviewerKind {
  const raw = agent.trim().toLowerCase();
  if (raw === "" || /^codex-subagent[:/]/.test(raw) || /^subagent[:/]/.test(raw)) return "auxiliary";
  const canonical = canonicalAgentName(raw);
  return agentIsKnown(canonical) ? "external" : "unknown";
}

function externalReviewers(candidates: readonly string[]): string[] {
  return uniqueCanonical(candidates).filter((agent) => reviewerKind(agent) === "external");
}

function firstSelfReviewer(candidates: readonly string[], workers: readonly string[]): string | undefined {
  const installed = externalReviewers(candidates);
  const canonicalWorkers = uniqueCanonical(workers);
  return canonicalWorkers.find((agent) => installed.includes(agent)) ?? installed[0];
}

export function selectPeerReviewer(input: PeerReviewerInput): PeerReviewerSelection {
  const candidates = externalReviewers(input.candidates);
  if (input.requestedReviewer !== undefined) {
    const requested = canonicalAgentName(input.requestedReviewer.trim());
    if (reviewerKind(requested) === "auxiliary") return { status: "unavailable", reason: "requested_reviewer_is_auxiliary" };
    if (!candidates.includes(requested)) return { status: "unavailable", reason: "requested_reviewer_unavailable" };
    return {
      status: "selected",
      effectiveMode: uniqueCanonical(input.workerAgents).some((worker) => !isHeterogeneous(worker, requested)) ? "self" : "hetero",
      reviewer: requested,
      provider: agentVendor(requested),
      degraded: false,
    };
  }

  if (input.candidates.length === 0) return { status: "unavailable", reason: "no_installed_reviewer" };
  if (candidates.length === 0) return { status: "unavailable", reason: "no_external_reviewer" };

  if (input.mode === "self") {
    const reviewer = firstSelfReviewer(candidates, input.workerAgents);
    if (reviewer === undefined) return { status: "unavailable", reason: "no_external_reviewer" };
    return { status: "selected", effectiveMode: "self", reviewer, provider: agentVendor(reviewer), degraded: false };
  }

  const workers = uniqueCanonical(input.workerAgents);
  const hetero = candidates.find((agent) => workers.length === 0 || workers.every((worker) => isHeterogeneous(worker, agent)));
  if (hetero !== undefined) {
    return { status: "selected", effectiveMode: "hetero", reviewer: hetero, provider: agentVendor(hetero), degraded: false };
  }

  if (input.mode === "hetero") return { status: "unavailable", reason: "no_heterogeneous_reviewer" };

  const reviewer = firstSelfReviewer(candidates, workers);
  if (reviewer === undefined) return { status: "unavailable", reason: "no_external_reviewer" };
  return {
    status: "selected",
    effectiveMode: "self",
    reviewer,
    provider: agentVendor(reviewer),
    degraded: true,
    reason: "single_provider_available",
  };
}

export function parsePeerReviewTranscript(stdout: string): ParsedPeerReview {
  const verdicts = [...stdout.matchAll(/^\s*VERDICT:\s*(APPROVE|REQUEST_CHANGES)\s*$/gim)].map((m) =>
    (m[1] ?? "").toUpperCase(),
  );
  const findings = reviewFindings(stdout);
  if (verdicts.length !== 1) {
    const reason = reviewReason(stdout, "");
    return {
      verdict: "REQUEST_CHANGES",
      reason: "malformed_or_multiple_verdict_lines",
      findings: findings.length > 0 || reason === "" ? findings : [reason],
    };
  }
  const verdict = verdicts[0] === "APPROVE" ? "APPROVE" : "REQUEST_CHANGES";
  return {
    verdict,
    reason: reviewReason(stdout, verdict === "APPROVE" ? "approved" : "review_requested_changes"),
    findings,
  };
}

export function reviewFindings(stdout: string): string[] {
  const explicit = [...stdout.matchAll(/^\s*FINDING:\s*(.+)$/gim)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
  if (explicit.length > 0) return explicit.slice(0, 10);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^VERDICT:/i.test(line) && !/^REASON:/i.test(line))
    .slice(0, 5);
}

export function reviewReason(stdout: string, fallback: string): string {
  const explicit = /^\s*REASON:\s*(.+)$/im.exec(stdout)?.[1]?.trim();
  if (explicit !== undefined && explicit !== "") return explicit.slice(0, 500);
  return reviewFindings(stdout)[0]?.slice(0, 500) ?? fallback;
}
