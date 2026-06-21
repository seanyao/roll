/**
 * US-TRUTH-016 AC4 — `roll truth query <storyId>`: the one CLI entry point for
 * deterministic delivery-truth queries.
 *
 * FIX-389a: deliveries.jsonl is a rebuildable cache. Before querying, we
 * ensure it is fresh by comparing mtimes with runs.jsonl. If stale, we
 * rebuild from runs+git merge facts via rebuildDeliveriesFromFacts.
 * Deleting deliveries.jsonl and re-querying produces the same result (AC2).
 *
 * Usage:
 *   roll truth query <storyId>       — human-readable, locale-resolved
 *   roll truth query <storyId> --json — machine-readable JSON
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLang } from "@roll/spec";
import {
  queryStoryDelivery,
  readDeliveries,
  nodeDeliveryStore,
  deliveriesPath,
  extractRunFact,
  rebuildDeliveriesFromFacts,
  parseMergeCommitMessages,
  type StoryDeliveryTruth,
  type RunFact,
} from "@roll/core";

export const TRUTH_USAGE =
  "Usage: roll truth query <storyId>\n" +
  "  Deterministic delivery-truth query (structured, zero markdown parse).\n" +
  "结构化交付真相查询（确定性，不解析 markdown）。";

function formatTruth(t: StoryDeliveryTruth, lang: "en" | "zh"): string {
  const lines: string[] = [];
  lines.push(`${t.storyId}`);
  lines.push(`  lifecycleState: ${t.lifecycleState}`);
  lines.push(`  delivered: ${t.delivered}`);
  if (t.prNumber !== undefined) lines.push(`  prNumber: ${t.prNumber}`);
  if (t.prUrl !== undefined) lines.push(`  prUrl: ${t.prUrl}`);
  if (t.mergeCommit !== undefined) lines.push(`  mergeCommit: ${t.mergeCommit}`);
  lines.push(`  lastRecordedAt: ${t.lastRecordedAt}`);
  lines.push(`  deliveringCycles: [${t.deliveringCycles.join(", ")}]`);
  if (t.missingReason !== undefined) {
    const label = lang === "zh" ? "缺失原因" : "missing reason";
    lines.push(`  ${label}: ${t.missingReason}`);
  }
  return `${lines.join("\n")}\n`;
}

// ── FIX-389a: projection freshness ──────────────────────────────────────────

/** Resolve the runs.jsonl path for a project. */
function runsPath(projectRoot: string): string {
  return join(projectRoot, ".roll", "loop", "runs.jsonl");
}

/**
 * Ensure deliveries.jsonl is fresh by comparing mtimes with runs.jsonl.
 *
 * If deliveries.jsonl is missing or runs.jsonl is newer, rebuild from
 * runs + git merge facts. Otherwise return the existing deliveries.
 *
 * @returns The fresh (projected) delivery records.
 */
function ensureDeliveriesFresh(projectRoot: string): ReturnType<typeof readDeliveries> {
  const dp = deliveriesPath(projectRoot);
  const rp = runsPath(projectRoot);

  // Get mtimes floored to seconds (sub-second precision is unreliable across
  // atomic writes; equal-second mtimes are ambiguous and trigger a rebuild).
  const deliveriesMtimeSec = existsSync(dp) ? Math.floor(statSync(dp).mtimeMs / 1000) : 0;
  const runsMtimeSec = existsSync(rp) ? Math.floor(statSync(rp).mtimeMs / 1000) : 0;

  // Fresh when deliveries exist and are strictly newer than runs (by seconds).
  // Equal-second mtimes are ambiguous — rebuild to be safe (deliveries may have
  // been created before the rebuild logic existed and lack historical data).
  // Also return cached when runs.jsonl is absent (nothing to rebuild from).
  if (deliveriesMtimeSec > 0 && (runsMtimeSec === 0 || deliveriesMtimeSec > runsMtimeSec)) {
    return readDeliveries(nodeDeliveryStore, projectRoot);
  }

  // ── Rebuild: read runs, collect git merges, project, write back ──────

  // 1. Read runs.jsonl and extract RunFacts
  const runs: RunFact[] = [];
  if (existsSync(rp)) {
    try {
      const raw = readFileSync(rp, "utf8");
      for (const line of raw.split("\n")) {
        if (line.trim() === "") continue;
        let row: Record<string, unknown>;
        try {
          row = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        const fact = extractRunFact(row);
        if (fact !== null) runs.push(fact);
      }
    } catch {
      // Can't read runs — fall through to existing deliveries
      return readDeliveries(nodeDeliveryStore, projectRoot);
    }
  }

  // 2. Collect git merge facts
  const merges: ReturnType<typeof parseMergeCommitMessages> = [];
  try {
    const log = execFileSync(
      "git",
      ["-C", projectRoot, "log", "--first-parent", "main", "--merges", "--format=%H %ct %s"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 },
    );
    merges.push(...parseMergeCommitMessages(log.split("\n")));
    // Also collect squash-merge commits (any commit with (#N) in the subject)
    const squashLog = execFileSync(
      "git",
      ["-C", projectRoot, "log", "--first-parent", "main", "--format=%H %ct %s"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 },
    );
    for (const line of squashLog.split("\n")) {
      if (/\(#\d+\)/.test(line)) {
        const parsed = parseMergeCommitMessages([line]);
        for (const m of parsed) {
          // Only add if not already covered by a merge commit
          if (!merges.some((existing) => existing.prNumber === m.prNumber)) {
            merges.push(m);
          }
        }
      }
    }
  } catch {
    // Git not available — rebuild from runs alone (no merge evidence)
  }

  // 3. Determine repo slug
  let repoSlug: string | undefined;
  try {
    const url = execFileSync("git", ["-C", projectRoot, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    // Extract owner/repo from git URL
    const m1 = /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(url);
    if (m1) repoSlug = `${m1[1]}/${m1[2]}`;
  } catch {
    // No remote — proceed without slug
  }

  // 4. Rebuild
  const rebuilt = rebuildDeliveriesFromFacts(runs, merges, repoSlug);

  // 5. Write back
  try {
    const lines = rebuilt.map((r) => `${JSON.stringify(r)}\n`).join("");
    writeFileSync(dp, lines, "utf8");
  } catch {
    // Write failed — return rebuilt from memory (best-effort)
  }

  return rebuilt;
}

export function truthCommand(args: string[]): number {
  const lang = resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });

  // Subcommand routing
  const sub = args[0];
  if (sub === undefined || sub === "help" || sub === "--help" || sub === "-h") {
    process.stdout.write(`${TRUTH_USAGE}\n`);
    return sub === undefined ? 1 : 0;
  }

  if (sub !== "query") {
    process.stderr.write(
      lang === "zh"
        ? `[roll] 未知 truth 子命令: ${sub}（试试 roll truth query <storyId>）\n`
        : `[roll] unknown truth subcommand: ${sub} (try roll truth query <storyId>)\n`,
    );
    return 1;
  }

  const rest = args.slice(1);
  const json = rest.includes("--json");
  const storyId = rest.find((a) => a !== "--json");

  if (storyId === undefined) {
    process.stderr.write(
      lang === "zh"
        ? `[roll] 需要 storyId（试试 roll truth query <storyId>）\n`
        : `[roll] storyId required (try roll truth query <storyId>)\n`,
    );
    return 1;
  }

  const deliveries = ensureDeliveriesFresh(process.cwd());
  const truth = queryStoryDelivery(storyId, deliveries);

  if (json) {
    process.stdout.write(JSON.stringify(truth, null, 2) + "\n");
  } else {
    process.stdout.write(formatTruth(truth, lang));
  }

  return 0;
}
