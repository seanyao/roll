import { dirname, join } from "node:path";
import type { RunnerPaths } from "./ports.js";

/** Resolve the canonical per-story lease directory. */
export function resolveStoryLeasePath(
  paths: Pick<RunnerPaths, "eventsPath" | "storyLeasePath">,
): string {
  const configured = paths.storyLeasePath ?? join(dirname(paths.eventsPath), "leases");
  return configured.endsWith("story-leases.json") ? join(dirname(configured), "leases") : configured;
}
