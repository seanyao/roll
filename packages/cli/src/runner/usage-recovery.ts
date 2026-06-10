/**
 * FIX-249 — pi session-file usage recovery (cli adapter).
 *
 * pi's text-mode stdout carries no usage — `piExtract` is an always-null stub —
 * so every pi cycle's runs row lacked tokens/cost/model: dashboards read "—"/$0
 * and the budget guardrail (US-CORE-011, I11) gated on a cost that was always
 * zero. pi DOES write authoritative per-message usage into its session store:
 *
 *   ~/.pi/agent/sessions/<encoded-cwd>/*.jsonl
 *
 * where <encoded-cwd> is the working directory with `/` → `-`, wrapped in `--`
 * (e.g. `/w/t` → `--w-t--`). Core already ports the pure summers
 * (`sumPiSession` / `aggregateSessions`, v2 oracle pi.py) — they had no live
 * caller. This adapter does the file discovery the core deliberately leaves to
 * the caller: resolve the cycle worktree's session dir, scope to files written
 * THIS cycle (mtime ≥ cycle start), sum, and shape the result as AgentUsage so
 * `toCycleCost` prices it from the table (pi reports no list cost).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PI_DEFAULT_MODEL, type AgentUsage, aggregateSessions, sumPiSession } from "@roll/core";

/** Default pi session store root. */
export function defaultPiSessionsRoot(): string {
  return join(homedir(), ".pi", "agent", "sessions");
}

/** The session dir pi uses for work done in `cwd` (path-encoded dir name). */
export function piSessionsDirFor(root: string, cwd: string): string {
  return join(root, `--${cwd.replace(/^\//, "").replace(/\//g, "-")}--`);
}

/**
 * Recover this cycle's pi usage from its session files, or null when there is
 * nothing attributable (missing dir, no fresh files, zero tokens — "n/a, never
 * fake zeros"). `sinceSec` scopes to files touched this cycle; omitted = all.
 */
export function recoverPiUsage(
  worktreeCwd: string,
  sinceSec?: number,
  sessionsRoot: string = defaultPiSessionsRoot(),
): AgentUsage | null {
  const dir = piSessionsDirFor(sessionsRoot, worktreeCwd);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return null; // no session dir for this cwd
  }
  const summaries = [];
  for (const f of files) {
    const p = join(dir, f);
    try {
      if (sinceSec !== undefined && statSync(p).mtimeMs / 1000 < sinceSec) continue;
      summaries.push(sumPiSession(readFileSync(p, "utf8").split("\n")));
    } catch {
      /* unreadable session file: skip, never fail the cycle */
    }
  }
  const agg = aggregateSessions(summaries, PI_DEFAULT_MODEL);
  if (agg === null) return null;
  return {
    model: agg.model ?? PI_DEFAULT_MODEL,
    input_tokens: agg.input_tokens,
    output_tokens: agg.output_tokens,
    cache_creation_tokens: agg.cache_creation_tokens,
    cache_read_tokens: agg.cache_read_tokens,
    // pi's own per-message cost sum rides along for audit; toCycleCost still
    // prices from the table (no cost_list_usd here, by design).
    cost_reported: agg.cost_reported,
  };
}
