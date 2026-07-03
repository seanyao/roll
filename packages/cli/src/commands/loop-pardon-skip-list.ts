import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEventLine, type FailureClass, type RollEvent } from "@roll/spec";
import { projectIdentity } from "@roll/infra";
import { classifyCycleFailure } from "../runner/failure-attribution.js";
import { readSkipState, writeSkipState } from "../runner/skip-cards.js";

export const LOOP_PARDON_SKIP_LIST_USAGE =
  "Usage: roll loop pardon-skip-list [--dry-run] [--include-unknown]\n" +
  "  Rebuild skip-cards from runs/events, removing env/harness pollution while keeping real card failures.\n" +
  "  --include-unknown also pardons unknown/no-evidence failures; risky because old zero-usage gave_up rows may be real card failures.\n";

interface RunRow {
  readonly story_id?: string;
  readonly cycle_id?: string;
  readonly run_id?: string;
  readonly status?: string;
  readonly outcome?: string;
  readonly failure_class?: FailureClass;
  readonly root_cause_key?: string;
  readonly tcr_count?: number;
  readonly tokens_in?: number;
  readonly tokens_out?: number;
}

function runtimeDir(projectPath: string): string {
  const env = (process.env["ROLL_PROJECT_RUNTIME_DIR"] ?? "").trim();
  return env !== "" ? env : join(projectPath, ".roll", "loop");
}

function readRows(path: string): RunRow[] {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as RunRow];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function readEvents(path: string): RollEvent[] {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8").split("\n").map(parseEventLine).filter((event): event is RollEvent => event !== null);
  } catch {
    return [];
  }
}

function failedRow(row: RunRow): boolean {
  return row.status === "failed" || row.status === "blocked" || row.status === "gave_up" || row.outcome === "failed" || row.outcome === "blocked" || row.outcome === "gave_up";
}

export function rebuildSkipStateFromEvidence(input: {
  readonly currentFails: Record<string, number>;
  readonly currentSkip: readonly string[];
  readonly rows: readonly RunRow[];
  readonly events: readonly RollEvent[];
  readonly threshold: number;
  readonly includeUnknown?: boolean;
}): { fails: Record<string, number>; skip: string[]; pardoned: string[]; kept: string[] } {
  const affected = new Set([...Object.keys(input.currentFails), ...input.currentSkip]);
  const nextFails: Record<string, number> = {};
  for (const row of input.rows) {
    const storyId = (row.story_id ?? "").trim();
    const cycleId = (row.cycle_id ?? row.run_id ?? "").trim();
    if (storyId === "" || cycleId === "" || !affected.has(storyId) || !failedRow(row)) continue;
    const rowClass = row.failure_class;
    const cycleEvents = input.events.filter((event) => (event as unknown as Record<string, unknown>)["cycleId"] === cycleId);
    const hasReplayEvidence =
      (row.tcr_count ?? 0) > 0 ||
      (row.tokens_in ?? 0) > 0 ||
      (row.tokens_out ?? 0) > 0 ||
      cycleEvents.some((event) => event.type !== "cycle:end");
    const attribution =
      hasReplayEvidence || (rowClass !== "env" && rowClass !== "harness" && rowClass !== "card" && rowClass !== "unknown")
        ? classifyCycleFailure({
            cycleId,
            terminal: row.status ?? row.outcome,
            tcrCount: row.tcr_count,
            tokensIn: row.tokens_in,
            tokensOut: row.tokens_out,
            events: cycleEvents,
          })
        : { failureClass: rowClass, rootCauseKey: row.root_cause_key ?? `${rowClass}:unknown`, confidence: rowClass === "unknown" ? "unknown" as const : "envelope" as const };
    if (attribution.failureClass === "card") {
      nextFails[storyId] = (nextFails[storyId] ?? 0) + 1;
    } else if (attribution.failureClass === "unknown" && input.includeUnknown !== true) {
      const preserved = input.currentFails[storyId] ?? (input.currentSkip.includes(storyId) ? input.threshold : 1);
      nextFails[storyId] = Math.max(nextFails[storyId] ?? 0, preserved);
    }
  }
  const nextSkip = Object.entries(nextFails)
    .filter(([, count]) => count >= input.threshold)
    .map(([storyId]) => storyId)
    .sort();
  const pardoned = [...affected].filter((storyId) => !nextSkip.includes(storyId) && (input.currentSkip.includes(storyId) || input.currentFails[storyId] !== undefined)).sort();
  const kept = [...affected].filter((storyId) => nextSkip.includes(storyId)).sort();
  return { fails: nextFails, skip: nextSkip, pardoned, kept };
}

export async function loopPardonSkipListCommand(args: string[]): Promise<number> {
  if (args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(LOOP_PARDON_SKIP_LIST_USAGE);
    return 0;
  }
  const dryRun = args.includes("--dry-run");
  const includeUnknown = args.includes("--include-unknown");
  const id = await projectIdentity();
  const rt = runtimeDir(id.path);
  const current = readSkipState(rt);
  const rebuilt = rebuildSkipStateFromEvidence({
    currentFails: current.fails,
    currentSkip: current.skip,
    rows: readRows(join(rt, "runs.jsonl")),
    events: readEvents(join(rt, "events.ndjson")),
    threshold: 3,
    includeUnknown,
  });
  if (!dryRun) writeSkipState(rt, { fails: rebuilt.fails, skip: rebuilt.skip });
  process.stdout.write(
    `${dryRun ? "dry-run: " : ""}pardon skip-list: pardoned=${rebuilt.pardoned.join(",") || "-"} kept=${rebuilt.kept.join(",") || "-"}\n`,
  );
  return 0;
}
