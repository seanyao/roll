import { classifyStatus } from "@roll/spec";

export const GOAL_ALLOWED_CARDS_ENV = "ROLL_LOOP_GO_ALLOWED_CARDS";

const DELIVERY_STATUSES = new Set(["built", "published", "done", "merged"]);
const DELIVERY_OUTCOMES = new Set(["published_pending_merge", "delivered"]);

export interface GoalRunAttempt {
  storyId: string;
  cycleId?: string;
  zeroDelivery: boolean;
  known: boolean;
}

export function parseAllowedCardsEnv(env: NodeJS.ProcessEnv = process.env): Set<string> | undefined {
  if (!Object.prototype.hasOwnProperty.call(env, GOAL_ALLOWED_CARDS_ENV)) return undefined;
  const raw = env[GOAL_ALLOWED_CARDS_ENV] ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
  );
}

export function filterByAllowedCards<T extends { id: string }>(items: T[], allowed: Set<string> | undefined): T[] {
  if (allowed === undefined) return items;
  return items.filter((item) => allowed.has(item.id));
}

const OUT_OF_SCOPE_STATUS = "🚫 Hold (outside goal scope)";

/**
 * Scope the picker to the goal's allowed cards without erasing dependency truth.
 *
 * `pickStory` builds its depends-on done index from the same rows it scans. A
 * hard filter to only allowed cards makes `--cards CHILD` unable to prove
 * `depends-on:PARENT` is Done, so the cycle idles as all_blocked_by_deps. Keep
 * every row visible for dependency lookup, but make non-allowed rows unpickable.
 */
export function scopeBacklogForAllowedCards<T extends { id: string; status: string }>(
  items: T[],
  allowed: Set<string> | undefined,
): T[] {
  if (allowed === undefined) return items;
  return items.map((item) => {
    if (allowed.has(item.id)) return item;
    if (classifyStatus(item.status) === "done") return item;
    return { ...item, status: OUT_OF_SCOPE_STATUS };
  });
}

export function runAttemptFromRow(row: Record<string, unknown>): GoalRunAttempt | undefined {
  const storyId = stringField(row, "story_id") ?? stringField(row, "storyId");
  if (storyId === undefined || storyId === "") return undefined;
  const tcrCount = numberField(row, "tcr_count");
  const cycleId = stringField(row, "cycle_id") ?? stringField(row, "cycleId") ?? stringField(row, "run_id");
  const evidence = hasDeliveryEvidence(row);
  if (tcrCount === undefined) {
    return {
      storyId,
      ...(cycleId !== undefined ? { cycleId } : {}),
      zeroDelivery: false,
      known: evidence,
    };
  }
  return {
    storyId,
    ...(cycleId !== undefined ? { cycleId } : {}),
    zeroDelivery: tcrCount === 0 && !evidence,
    known: true,
  };
}

function hasDeliveryEvidence(row: Record<string, unknown>): boolean {
  const status = stringField(row, "status");
  if (status !== undefined && DELIVERY_STATUSES.has(status)) return true;
  const outcome = stringField(row, "outcome");
  if (outcome !== undefined && DELIVERY_OUTCOMES.has(outcome)) return true;
  const built = row["built"];
  if (Array.isArray(built) && built.some((item) => typeof item === "string" && item.trim() !== "")) return true;
  for (const field of ["merge_commit", "mergeCommit", "commit", "commit_hash", "pr_url", "prUrl"]) {
    if ((stringField(row, field) ?? "") !== "") return true;
  }
  return false;
}

function stringField(row: Record<string, unknown>, field: string): string | undefined {
  const value = row[field];
  return typeof value === "string" ? value.trim() : undefined;
}

function numberField(row: Record<string, unknown>, field: string): number | undefined {
  const value = row[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
