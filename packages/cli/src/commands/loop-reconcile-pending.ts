/**
 * `roll loop reconcile-pending` — FIX-1052.
 *
 * Bounded, one-pass reconcile for pending-merge PRs. Polls each PR that is
 * currently `pending_merge` in `deliveries.jsonl` through the GitHub provider
 * adapter, fetches `origin/main` when a merge is detected, rebuilds the
 * delivery projection, and appends an explicit `done` record. Failure states
 * (closed-unmerged, CI-red, unreachable) are surfaced in the delivery cache
 * and printed to stdout so `roll cycles` / `roll loop watch` / `roll truth`
 * reflect the reconciled state without a manual `git fetch`.
 *
 * The command is safe to run repeatedly: already-delivered records are skipped.
 */
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveLang, present } from "@roll/spec";
import type { DeliveryRecord } from "@roll/spec";
import {
  nodeDeliveryStore,
  nodeExecPort,
  readDeliveries,
  ensureDeliveriesFresh,
  appendDelivery,
  EventBus,
  type FreshnessPort,
  type PrStatusProvider,
} from "@roll/core";
import { GitHubPrStatusProvider } from "@roll/infra";

export const RECONCILE_PENDING_USAGE =
  "Usage: roll loop reconcile-pending [--dry-run]\n" +
  "  Poll pending-merge PRs and reconcile delivery truth.\n" +
  "  轮询待合并 PR 并调和交付真相。";

// ── Node-backed ports ─────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function runtimeDir(projectPath: string): string {
  const env = (process.env["ROLL_PROJECT_RUNTIME_DIR"] ?? "").trim();
  return env !== "" ? env : join(projectPath, ".roll", "loop");
}

function resolveRepoSlug(projectPath: string): string | undefined {
  const remote = nodeExecPort.run("git", ["-C", projectPath, "remote", "get-url", "origin"]);
  if (remote.code !== 0 || remote.stdout === "") return undefined;
  const url = remote.stdout.trim();
  // Match GitHub URLs only (the only supported provider today).
  const m =
    /github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/.exec(url) ??
    /git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/.exec(url);
  if (m?.groups === undefined) return undefined;
  return `${m.groups.owner}/${m.groups.repo}`;
}

function findPendingRecords(projectPath: string): DeliveryRecord[] {
  return readDeliveries(nodeDeliveryStore, projectPath).filter(
    (r) =>
      (r.lifecycleState === "pending_merge" || r.lifecycleState === "ci_red") &&
      r.prNumber.present &&
      r.prNumber.value > 0,
  );
}

function isAlreadyDelivered(existing: readonly DeliveryRecord[], storyId: string, cycleId: string): boolean {
  return existing.some((r) => r.storyId === storyId && r.cycleId === cycleId && r.lifecycleState === "done");
}

function prNumberFromRecord(r: DeliveryRecord): number | undefined {
  return r.prNumber.present && r.prNumber.value > 0 ? r.prNumber.value : undefined;
}

// ── Command ───────────────────────────────────────────────────────────────────

export async function loopReconcilePendingCommand(args: string[]): Promise<number> {
  const lang = resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${RECONCILE_PENDING_USAGE}\n`);
    return 0;
  }

  const dryRun = args.includes("--dry-run");
  const unknown = args.filter((a) => a !== "--dry-run");
  if (unknown.length > 0) {
    process.stderr.write(`[roll] unknown flag: ${unknown[0]}\n${RECONCILE_PENDING_USAGE}\n`);
    return 1;
  }

  const cwd = process.cwd();
  const slug = resolveRepoSlug(cwd);
  if (slug === undefined) {
    process.stderr.write(
      lang === "zh"
        ? "[roll] 无法解析 GitHub owner/repo（没有 origin remote 或非 GitHub 仓库）\n"
        : "[roll] cannot resolve GitHub owner/repo (no origin remote or non-GitHub repo)\n",
    );
    return 1;
  }

  const pending = findPendingRecords(cwd);
  if (pending.length === 0) {
    process.stdout.write(lang === "zh" ? "没有待合并的 PR。\n" : "No pending-merge PRs.\n");
    return 0;
  }

  const provider: PrStatusProvider = new GitHubPrStatusProvider();
  const bus = new EventBus();
  const rt = runtimeDir(cwd);
  const eventsPath = join(rt, "events.ndjson");
  const runsPath = join(rt, "runs.jsonl");
  bus.ensureEventFiles(eventsPath, runsPath);

  const now = Date.now();
  const allExisting = readDeliveries(nodeDeliveryStore, cwd);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const record of pending) {
    const prNumber = prNumberFromRecord(record);
    if (prNumber === undefined) continue;

    if (isAlreadyDelivered(allExisting, record.storyId, record.cycleId)) {
      skipped += 1;
      process.stdout.write(
        lang === "zh"
          ? `  ${record.storyId} · PR #${prNumber} · 已交付（跳过）\n`
          : `  ${record.storyId} · PR #${prNumber} · already delivered (skip)\n`,
      );
      continue;
    }

    process.stdout.write(
      lang === "zh"
        ? `  ${record.storyId} · PR #${prNumber} · 轮询中…\n`
        : `  ${record.storyId} · PR #${prNumber} · polling…\n`,
    );

    if (dryRun) {
      process.stdout.write(lang === "zh" ? "    --dry-run，未执行\n" : "    --dry-run, not executed\n");
      continue;
    }

    try {
      const state = await provider.pollPrStatus(slug, prNumber);

      if (state.kind === "merged") {
        // Fetch origin/main so the projection rebuild sees the merge commit.
        nodeExecPort.run("git", ["-C", cwd, "fetch", "origin", "main", "--quiet"]);
        ensureDeliveriesFresh(cwd, nodeFreshnessPort, nodeExecPort);

        const newRecord: DeliveryRecord = {
          storyId: record.storyId,
          cycleId: record.cycleId,
          lifecycleState: "done",
          prNumber: record.prNumber,
          prUrl: record.prUrl,
          mergedAt: present(Date.parse(state.mergedAt) || now),
          mergeCommit: present(state.mergeCommit),
          recordedAt: now,
        };
        appendDelivery(nodeDeliveryStore, cwd, newRecord);
        bus.appendEvent(eventsPath, {
          type: "pr:merge",
          prNumber,
          storyId: record.storyId,
          ts: now,
        });
        updated += 1;
        process.stdout.write(
          lang === "zh"
            ? `    ✅ 已合并 · ${state.mergeCommit.slice(0, 7)}\n`
            : `    ✅ merged · ${state.mergeCommit.slice(0, 7)}\n`,
        );
      } else if (state.kind === "closed_unmerged") {
        const newRecord: DeliveryRecord = {
          storyId: record.storyId,
          cycleId: record.cycleId,
          lifecycleState: "abandoned",
          prNumber: record.prNumber,
          prUrl: record.prUrl,
          mergedAt: { present: false, reason: "not_recorded" },
          mergeCommit: { present: false, reason: "not_recorded" },
          recordedAt: now,
        };
        appendDelivery(nodeDeliveryStore, cwd, newRecord);
        bus.appendEvent(eventsPath, {
          type: "pr:close",
          prNumber,
          reason: "closed_unmerged",
          ts: now,
        });
        updated += 1;
        process.stdout.write(lang === "zh" ? "    🗑 已关闭未合并\n" : "    🗑 closed unmerged\n");
      } else if (state.kind === "open" && state.ci === "red") {
        const newRecord: DeliveryRecord = {
          storyId: record.storyId,
          cycleId: record.cycleId,
          lifecycleState: "ci_red",
          prNumber: record.prNumber,
          prUrl: record.prUrl,
          mergedAt: { present: false, reason: "not_recorded" },
          mergeCommit: { present: false, reason: "not_recorded" },
          recordedAt: now,
        };
        appendDelivery(nodeDeliveryStore, cwd, newRecord);
        bus.appendEvent(eventsPath, {
          type: "ci:fail",
          prNumber,
          failSummary: "pr reconcile: CI red",
          ts: now,
        });
        updated += 1;
        process.stdout.write(lang === "zh" ? "    ❌ CI 失败\n" : "    ❌ CI red\n");
      } else if (state.kind === "open") {
        const ci = state.ci === "green" ? "green" : state.ci === "pending" ? "pending" : "unknown";
        process.stdout.write(
          lang === "zh" ? `    ⏳ 开启中 · CI ${ci}\n` : `    ⏳ open · CI ${ci}\n`,
        );
      } else {
        // unreachable
        bus.appendEvent(eventsPath, {
          type: "loop:error",
          loop: "pr",
          error: `pr ${prNumber} unreachable: ${state.reason}`,
          ts: now,
        });
        errors += 1;
        process.stdout.write(
          lang === "zh" ? `    ⚠️ 无法访问 · ${state.reason}\n` : `    ⚠️ unreachable · ${state.reason}\n`,
        );
      }
    } catch (err) {
      errors += 1;
      const detail = err instanceof Error ? err.message : String(err);
      bus.appendEvent(eventsPath, {
        type: "loop:error",
        loop: "pr",
        error: `pr ${prNumber} poll failed: ${detail}`,
        ts: now,
      });
      process.stderr.write(
        lang === "zh" ? `    ⚠️ 轮询失败 · ${detail}\n` : `    ⚠️ poll failed · ${detail}\n`,
      );
    }
  }

  const summary =
    lang === "zh"
      ? `完成：${updated} 已更新 · ${skipped} 已跳过 · ${errors} 错误\n`
      : `done: ${updated} updated · ${skipped} skipped · ${errors} errors\n`;
  process.stdout.write(summary);
  return errors > 0 ? 1 : 0;
}
