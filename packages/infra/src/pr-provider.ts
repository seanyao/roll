/**
 * FIX-1052 — GitHub PR status provider adapter.
 *
 * Implements the {@link PrStatusProvider} interface from `@roll/core` using the
 * existing `gh` CLI wrappers (US-INFRA-003). The core policy is provider-agnostic;
 * this module is the GitHub-specific implementation and can be replaced by a
 * Gitea/Bitbucket adapter without touching the reconcile logic.
 *
 * The adapter maps `gh pr view --json state,mergedAt,mergeCommit,number,url`
 * plus `gh run list` (for CI state) onto the {@link PrCloudState} vocabulary.
 */
import type { PrCloudState, PrCiState, PrStatusProvider } from "@roll/core";
import { runList, prViewMergeInfo } from "./github.js";

/** Build a slug from an `owner/repo` string; defensive trim. */
function normalizeSlug(slug: string): string {
  return slug.trim();
}

/**
 * Reduce a `gh run list` result to one of the three CI states the reconciler
 * cares about. Mirrors the `reduceCiRollup` semantics in `@roll/core/loop/pr-loop`
 * but over the `gh run list --json conclusion` shape.
 */
function reduceRunConclusions(conclusions: (string | null | undefined)[]): PrCiState {
  if (conclusions.length === 0) return "unknown";
  if (conclusions.some((c) => c === "failure" || c === "FAILURE")) return "red";
  if (conclusions.every((c) => c === "success" || c === "SKIPPED" || c === null || c === undefined)) {
    // All success/skipped → green. Null/undefined entries mean some runs haven't
    // reported yet, so treat as pending instead of green.
    return conclusions.some((c) => c === null || c === undefined) ? "pending" : "green";
  }
  return "pending";
}

/**
 * GitHub-specific {@link PrStatusProvider}. Polls via the `gh` CLI and maps the
 * response to the provider-agnostic {@link PrCloudState}.
 */
export class GitHubPrStatusProvider implements PrStatusProvider {
  readonly name = "github";

  /**
   * Poll one PR's cloud state.
   *
   * @param slug - `owner/repo`.
   * @param prNumber - PR number.
   * @returns {@link PrCloudState}.
   */
  async pollPrStatus(slug: string, prNumber: number): Promise<PrCloudState> {
    const s = normalizeSlug(slug);
    const info = await prViewMergeInfo(s, String(prNumber));
    const checkedAt = new Date().toISOString();

    if (info === undefined) {
      return { kind: "unreachable", reason: "not_found", checkedAt };
    }

    const state = info.state;

    if (state === "MERGED") {
      return {
        kind: "merged",
        mergeCommit: info.mergeCommit ?? "",
        mergedAt: info.mergedAt ?? checkedAt,
        checkedAt,
      };
    }

    if (state === "CLOSED") {
      return { kind: "closed_unmerged", closedAt: info.mergedAt ?? checkedAt, checkedAt };
    }

    if (state === "OPEN") {
      const branch = info.headRefName;
      const runs = branch !== undefined ? await runList(s, "conclusion", { branch }) : [];
      const conclusions = runs.map((r) => r.conclusion);
      const ci = reduceRunConclusions(conclusions);
      return { kind: "open", ci, draft: info.isDraft, mergeable: info.mergeable, checkedAt };
    }

    // UNKNOWN or any unexpected string → treat as unreachable provider_error so
    // the bounded loop retries rather than giving up.
    return { kind: "unreachable", reason: "provider_error", checkedAt };
  }
}

/** Default singleton for callers that do not need to inject a custom provider. */
export const githubPrStatusProvider = new GitHubPrStatusProvider();
