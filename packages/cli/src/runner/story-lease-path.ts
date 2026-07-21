import { dirname, join } from "node:path";
import type { RunnerPaths } from "./ports.js";

/** Resolve the single Story-lease ledger without changing the legacy default. */
export function resolveStoryLeasePath(
  paths: Pick<RunnerPaths, "eventsPath" | "storyLeasePath">,
): string {
  return paths.storyLeasePath ?? join(dirname(paths.eventsPath), "story-leases.json");
}
