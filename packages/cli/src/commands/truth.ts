/**
 * FIX-389a / US-TRUTH-016 AC4 — `roll truth query <storyId>`: the one CLI
 * entry point for deterministic delivery-truth queries.
 *
 * Before reading deliveries.jsonl, calls `ensureDeliveriesFresh` (from core)
 * so the projection engine rebuilds the cache from runs+git facts when stale.
 * This means deleting deliveries.jsonl and re-running produces the same
 * result — the cache is never authoritative (AC2).
 *
 * Usage:
 *   roll truth query <storyId>       — human-readable, locale-resolved
 *   roll truth query <storyId> --json — machine-readable JSON
 */
import { statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveLang } from "@roll/spec";
import {
  queryStoryDelivery,
  nodeDeliveryStore,
  nodeExecPort,
  ensureDeliveriesFresh,
  type FreshnessPort,
  type StoryDeliveryTruth,
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

// ── Node-backed FreshnessPort ────────────────────────────────────────────────

/** Node `fs`-backed {@link FreshnessPort} for production use. */
const nodeFreshnessPort: FreshnessPort = {
  mtimeMs(absPath: string): number | undefined {
    try {
      return statSync(absPath).mtimeMs;
    } catch {
      return undefined;
    }
  },
  readText(absPath: string): string {
    try {
      return readFileSync(absPath, "utf8");
    } catch {
      return "";
    }
  },
  writeText(absPath: string, text: string): void {
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, text, "utf8");
  },
};

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

  // FIX-389a AC2: ensure the deliveries cache is fresh (project from runs+git)
  // before querying. Delete deliveries.jsonl + re-run → same result.
  const cwd = process.cwd();
  const deliveries = ensureDeliveriesFresh(cwd, nodeFreshnessPort, nodeExecPort);
  const truth = queryStoryDelivery(storyId, deliveries);

  if (json) {
    process.stdout.write(JSON.stringify(truth, null, 2) + "\n");
  } else {
    process.stdout.write(formatTruth(truth, lang));
  }

  return 0;
}
