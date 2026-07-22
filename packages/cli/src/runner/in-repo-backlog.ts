import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { CycleContext } from "@roll/core";
import type { Ports } from "./ports.js";

/** Detect whether `.roll` is tracked by the product repo rather than a nested meta repo. */
export function isInRepoRollLayout(worktreePath: string): boolean {
  try {
    const rollDir = join(worktreePath, ".roll");
    if (!existsSync(rollDir)) return false;
    const top = execFileSync("git", ["-C", rollDir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (top === "") return false;
    return realpathSync(top) !== realpathSync(rollDir);
  } catch {
    return false;
  }
}

/** Persist an in-repo backlog status update on the product integration branch. */
export async function commitInRepoBacklog(
  ports: Ports,
  ctx: CycleContext,
  storyId: string,
): Promise<void> {
  const msg = `chore: ${storyId} status update (cycle ${ctx.cycleId})`;
  const backlogRel = join(".roll", "backlog.md");
  try {
    if (!existsSync(join(ports.repoCwd, backlogRel))) return;
    execFileSync("git", ["add", "--", backlogRel], { cwd: ports.repoCwd, stdio: "ignore" });
    const dirty = execFileSync("git", ["status", "--porcelain", "--", backlogRel], {
      cwd: ports.repoCwd,
      encoding: "utf8",
    }).trim();
    if (dirty === "") return;
    execFileSync("git", ["commit", "-m", msg], { cwd: ports.repoCwd, stdio: "ignore" });
    execFileSync("git", ["push", "origin", "HEAD:refs/heads/main"], {
      cwd: ports.repoCwd,
      stdio: "ignore",
    });
  } catch (error) {
    ports.events.appendAlert(
      ports.paths.alertsPath,
      `FIX-1238: in-repo backlog commit/push failed for ${storyId} (cycle ${ctx.cycleId}) — ${String(error)}`,
    );
  }
}
