/**
 * `roll loop reconcile [--json]` — US-DELIV-002.
 *
 * The IO adapter for the layered reconcile-from-main pure function. Gathers
 * facts from gh/git for each awaiting_merge cycle, runs the pure decision,
 * emits delivery:reconciled events, and handles retroactive heal of existing
 * unpublished/pending cycles.
 *
 * Architecture:
 *   - Pure decision: {@link reconcileDelivery} (packages/core/src/delivery/reconcile.ts).
 *   - IO adapter: this file collects gh PR state + git patch-ids, delegates to
 *     the pure function, and appends events.
 *   - Idempotent + crash-resumable: re-running reconcile is always safe.
 *
 * Trigger points (design §7.3):
 *   - (a) cycle boundary in `roll loop run-once/go`
 *   - (b) `roll loop status` / `roll loop cycles` read-before-show
 *   - (c) explicit `roll loop reconcile [--json]`
 *   - (d) CI step `roll loop reconcile`
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLang, parseEventLine } from "@roll/spec";
import type { RollEvent, DeliveryState } from "@roll/spec";
import {
  nodeExecPort,
  EventBus,
  reconcileDelivery,
  projectDeliveryState,
  type ReconcileCycle,
  type ReconcileFacts,
  type ReconcileResult,
} from "@roll/core";
import type { PrStatusProvider } from "@roll/core";
import { GitHubPrStatusProvider, prMerge, type GhResult } from "@roll/infra";

// ── Usage ─────────────────────────────────────────────────────────────────────

const RECONCILE_USAGE_EN = [
  "Usage: roll loop reconcile [--json] [--story <id>] [--dry-run]",
  "  Reconcile delivery truth: probe pending cycles against main (PR state + patch-id),",
  "  emit delivery:reconciled events, and heal existing unpublished/pending cycles.",
  "",
  "  --json       Machine-readable output (one JSON object per reconciled cycle).",
  "  --story <id> Reconcile only the named story (default: all awaiting cycles).",
  "  --dry-run    Report decisions without emitting events or merging.",
  "",
].join("\n");

const RECONCILE_USAGE_ZH = [
  "用法：roll loop reconcile [--json] [--story <id>] [--dry-run]",
  "  对账交付真相：以主干为锚点（PR 状态 + patch-id）反查待合并 cycle，",
  "  发出 delivery:reconciled 事件，对平存量未对账 cycle。",
  "",
  "  --json       机器可读输出（每个 cycle 一个 JSON 对象）。",
  "  --story <id> 只对账指定 story（默认：所有待合并 cycle）。",
  "  --dry-run    只报告判定，不写事件、不合入。",
  "",
].join("\n");

// ── Ports ─────────────────────────────────────────────────────────────────────

export interface LoopReconcileDeps {
  cwd: string;
  bus: EventBus;
  provider?: PrStatusProvider;
  stdout: { write(text: string): void };
  stderr: { write(text: string): void };
}

function realDeps(): LoopReconcileDeps {
  return {
    cwd: process.cwd(),
    bus: new EventBus(),
    stdout: process.stdout,
    stderr: process.stderr,
  };
}

// ── Fact gathering ────────────────────────────────────────────────────────────

function runtimeDir(cwd: string): string {
  const env = (process.env["ROLL_PROJECT_RUNTIME_DIR"] ?? "").trim();
  return env !== "" ? env : join(cwd, ".roll", "loop");
}

function resolveRepoSlug(cwd: string): string | undefined {
  const r = nodeExecPort.run("git", ["-C", cwd, "remote", "get-url", "origin"]);
  if (r.code !== 0 || r.stdout === "") return undefined;
  const url = r.stdout.trim();
  const m =
    /github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/.exec(url) ??
    /git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/.exec(url);
  return m?.groups !== undefined ? `${m.groups.owner}/${m.groups.repo}` : undefined;
}

function branchExists(cwd: string, branch: string): boolean {
  const r = nodeExecPort.run("git", ["-C", cwd, "rev-parse", "--verify", `refs/remotes/origin/${branch}`]);
  return r.code === 0 && r.stdout.trim() !== "";
}

/**
 * Compute the git patch-id of `git diff origin/main...<branch>`.
 * Returns undefined when the branch doesn't exist or the diff is empty.
 */
function branchPatchId(cwd: string, branch: string): string | undefined {
  if (!branchExists(cwd, branch)) return undefined;
  // Get the diff between origin/main and the branch.
  const diff = nodeExecPort.run("git", [
    "-C", cwd,
    "diff",
    "origin/main...origin/" + branch,
  ]);
  if (diff.code !== 0 || diff.stdout === "") return undefined;
  // Pipe through git patch-id to get the stable hash.
  // We use a temp approach: write diff to a pipe via echo + patch-id.
  const patchId = nodeExecPort.run("sh", [
    "-c",
    `echo "${diff.stdout.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}" | git -C '${cwd}' patch-id --stable`,
  ]);
  // Actually, let's use a cleaner approach.
  // git patch-id reads from stdin; we'll pipe through bash heredoc.
  const tmpFile = join(
    cwd.replace(
      /\/\.roll\/loop\/worktrees\/[^/]+$/,
      "",
    ),
    ".roll",
    "loop",
    ".reconcile-diff-tmp",
  );
  // Simpler: compute directly by piping diff to patch-id.
  // The git patch-id command reads diff from stdin.
  const result = nodeExecPort.run("sh", [
    "-c",
    `cd '${cwd}' && git diff origin/main...origin/${branch} | git patch-id --stable`,
  ]);
  if (result.code !== 0 || result.stdout === "") return undefined;
  // git patch-id output is "<hash> <patch-id>"
  const parts = result.stdout.trim().split(/\s+/);
  return parts[0] ?? undefined;
}

/**
 * Collect patch-ids from candidate merge commits on main since the branch's
 * fork point. Each patch-id represents what git-patch-id says about a diff.
 *
 * We scan git log origin/main ^origin/<branch> (commits on main not on branch).
 * For each merge commit, we compute its patch-id.
 */
function mainPatchIdsSinceBranch(cwd: string, branch: string): Set<string> {
  const ids = new Set<string>();
  if (!branchExists(cwd, branch)) return ids;

  // Get commits on main that are not on the branch.
  const commits = nodeExecPort.run("git", [
    "-C", cwd,
    "log",
    "--format=%H",
    `origin/main...origin/${branch}`,
    "--", // exclude diff
  ]);
  if (commits.code !== 0 || commits.stdout === "") return ids;

  const shas = commits.stdout.trim().split("\n").filter(Boolean);
  for (const sha of shas) {
    // Get the diff for this commit (vs its parent).
    const diff = nodeExecPort.run("git", [
      "-C", cwd,
      "diff",
      `${sha}^!`,
    ]);
    if (diff.code !== 0 || diff.stdout === "") continue;
    const pid = nodeExecPort.run("sh", [
      "-c",
      `echo '${diff.stdout.replace(/'/g, "'\\''")}' | git -C '${cwd}' patch-id --stable`,
    ]);
    if (pid.code === 0 && pid.stdout !== "") {
      const parts = pid.stdout.trim().split(/\s+/);
      if (parts[0] !== undefined) ids.add(parts[0]);
    }
  }
  return ids;
}

// ── Event reading ─────────────────────────────────────────────────────────────

interface CycleSnapshot {
  cycleId: string;
  storyId: string;
  branch: string;
  prNumber?: number;
  deliveryState: DeliveryState;
}

/**
 * Read events.ndjson and extract cycle delivery snapshots.
 * Returns cycles that are awaiting_merge (or any non-terminal state that
 * could be reconciled).
 */
function readAwaitingCycles(cwd: string): CycleSnapshot[] {
  const eventsPath = join(runtimeDir(cwd), "events.ndjson");
  if (!existsSync(eventsPath)) return [];

  let content = "";
  try {
    content = readFileSync(eventsPath, "utf8");
  } catch {
    return [];
  }

  // Collect per-cycle events for projection.
  const cycleEvents = new Map<string, RollEvent[]>();
  const cycleMeta = new Map<string, { storyId: string; branch: string; prNumber?: number }>();

  for (const line of content.split("\n")) {
    const ev = parseEventLine(line);
    if (ev === null) continue;

    const cid = "cycleId" in ev ? (ev as RollEvent & { cycleId: string }).cycleId : undefined;
    if (cid === undefined) continue;
    if (!cycleEvents.has(cid)) cycleEvents.set(cid, []);
    cycleEvents.get(cid)!.push(ev);

    // Capture metadata.
    if (ev.type === "cycle:start") {
      cycleMeta.set(cid, { storyId: ev.storyId, branch: `loop/${cid}`, prNumber: undefined });
    }
    if (ev.type === "delivery:published" && "prNumber" in ev) {
      const meta = cycleMeta.get(cid);
      if (meta) {
        meta.prNumber = (ev as RollEvent & { prNumber: number }).prNumber;
        meta.branch = (ev as RollEvent & { branch: string }).branch;
      }
    }
  }

  // Project each cycle and filter to awaiting_merge.
  const snapshots: CycleSnapshot[] = [];
  for (const [cycleId, events] of cycleEvents) {
    const state = projectDeliveryState(events, cycleId);
    // Only reconcile non-terminal cycles. Retroactive heal covers
    // awaiting_merge, building, ci_failed — but NOT already delivered.
    if (state === "delivered" || state === "delivered_external" || state === "superseded" || state === "abandoned") {
      continue;
    }
    const meta = cycleMeta.get(cycleId) ?? { storyId: "", branch: `loop/${cycleId}` };
    snapshots.push({
      cycleId,
      storyId: meta.storyId,
      branch: meta.branch,
      prNumber: meta.prNumber,
      deliveryState: state,
    });
  }

  return snapshots;
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface ReconcileReportItem {
  cycleId: string;
  storyId: string;
  branch: string;
  prNumber?: number;
  previousState: DeliveryState;
  result: ReconcileResult;
  signal?: string;
  mergeCommit?: string;
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function loopReconcileCommand(
  args: string[],
  deps: LoopReconcileDeps = realDeps(),
): Promise<number> {
  const lang = resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });

  if (args.includes("--help") || args.includes("-h")) {
    deps.stdout.write(`${lang === "zh" ? RECONCILE_USAGE_ZH : RECONCILE_USAGE_EN}\n`);
    return 0;
  }

  const jsonMode = args.includes("--json");
  const dryRun = args.includes("--dry-run");

  // Parse --story <id>
  const storyIdx = args.indexOf("--story");
  const storyFilter: string | undefined =
    storyIdx >= 0 && storyIdx + 1 < args.length ? args[storyIdx + 1] : undefined;

  const unknown = args.filter(
    (a) => !["--json", "--dry-run", "--story"].includes(a) && a !== storyFilter,
  );
  if (unknown.length > 0) {
    deps.stderr.write(
      `${lang === "zh" ? "[roll] 未知标志" : "[roll] unknown flag"}: ${unknown[0]}\n${lang === "zh" ? RECONCILE_USAGE_ZH : RECONCILE_USAGE_EN}\n`,
    );
    return 1;
  }

  const cwd = deps.cwd;
  const slug = resolveRepoSlug(cwd);

  // Read awaiting cycles from event stream.
  let cycles = readAwaitingCycles(cwd);
  if (storyFilter !== undefined) {
    cycles = cycles.filter((c) => c.storyId === storyFilter);
  }

  if (cycles.length === 0) {
    deps.stdout.write(
      lang === "zh" ? "没有待对账的 cycle。\n" : "No cycles awaiting reconciliation.\n",
    );
    return 0;
  }

  const provider = deps.provider ?? (slug !== undefined ? new GitHubPrStatusProvider() : undefined);
  const rt = runtimeDir(cwd);
  const eventsPath = join(rt, "events.ndjson");
  const runsPath = join(rt, "runs.jsonl");
  deps.bus.ensureEventFiles(eventsPath, runsPath);

  const now = Date.now();
  const reportItems: ReconcileReportItem[] = [];

  for (const cyc of cycles) {
    deps.stdout.write(
      lang === "zh"
        ? `  ${cyc.cycleId} · ${cyc.storyId || "—"} · ${cyc.deliveryState}…`
        : `  ${cyc.cycleId} · ${cyc.storyId || "—"} · ${cyc.deliveryState}…`,
    );

    // Gather facts.
    const facts: ReconcileFacts = {
      mainPatchIds: new Set(),
      backlogDone: false,
      attestPresent: false,
    };

    // L1: PR state via gh.
    if (provider !== undefined && cyc.prNumber !== undefined && slug !== undefined) {
      try {
        const prState = await provider.pollPrStatus(slug, cyc.prNumber);
        if (prState.kind === "merged") {
          facts.prState = "MERGED";
          facts.prMergeCommit = prState.mergeCommit;
        } else if (prState.kind === "open") {
          facts.prState = "OPEN";
          facts.ciGreen = prState.ci === "green";
        } else if (prState.kind === "closed_unmerged") {
          facts.prState = "CLOSED";
        }
      } catch {
        // gh unavailable — L1 is silent; fall through to L2.
      }
    }

    // L2: patch-id equivalence.
    facts.branchNetPatchId = branchPatchId(cwd, cyc.branch);
    if (facts.branchNetPatchId !== undefined) {
      facts.mainPatchIds = mainPatchIdsSinceBranch(cwd, cyc.branch);
    }

    // Run pure decision.
    const reconcileCycle: ReconcileCycle = {
      cycleId: cyc.cycleId,
      storyId: cyc.storyId,
      branch: cyc.branch,
      prNumber: cyc.prNumber,
      deliveryState: cyc.deliveryState,
    };
    const result = reconcileDelivery(reconcileCycle, facts);

    const item: ReconcileReportItem = {
      cycleId: cyc.cycleId,
      storyId: cyc.storyId,
      branch: cyc.branch,
      prNumber: cyc.prNumber,
      previousState: cyc.deliveryState,
      result,
    };

    if (result.kind === "delivered") {
      item.signal = result.signal;
      item.mergeCommit = result.mergeCommit;

      // Emit delivery:reconciled event (unless dry run).
      if (!dryRun) {
        deps.bus.appendEvent(eventsPath, {
          type: "delivery:reconciled",
          cycleId: cyc.cycleId,
          storyId: cyc.storyId,
          state: result.via === "runner" ? "delivered" : "delivered_external",
          mergedBy: result.via,
          mergeCommit: result.mergeCommit ?? "unknown",
          signal: result.signal,
          ts: now,
        });
      }
    }

    // ── merge_now: execute gh pr merge --squash ───────────────────────────
    // US-DELIV-003: self-driven merge — does not rely on repo auto-merge
    // setting or launchd. Uses "plain" mode (no --auto, no --admin).
    if (result.kind === "merge_now" && !dryRun) {
      if (slug !== undefined && cyc.prNumber !== undefined) {
        let outcome: "merged" | "blocked" | "gh_down" = "gh_down";
        try {
          const mergeResult: GhResult = await prMerge(slug, String(cyc.prNumber), "plain");
          outcome = mergeResult.code === 0 ? "merged" : "blocked";
        } catch {
          // gh binary not found / unspawnable → gh_down
          outcome = "gh_down";
        }
        deps.bus.appendEvent(eventsPath, {
          type: "delivery:merge_attempt",
          cycleId: cyc.cycleId,
          prNumber: cyc.prNumber,
          method: "squash",
          outcome,
          ts: now,
        });
      } else {
        // slug not resolved (no GitHub remote) → gh_down, stay awaiting_merge
        deps.bus.appendEvent(eventsPath, {
          type: "delivery:merge_attempt",
          cycleId: cyc.cycleId,
          prNumber: cyc.prNumber ?? 0,
          method: "squash",
          outcome: "gh_down" as const,
          ts: now,
        });
      }
    }

    reportItems.push(item);

    // Print result.
    const icon = result.kind === "delivered"
      ? "✅"
      : result.kind === "merge_now"
        ? "🔄"
        : result.kind === "ci_failed"
          ? "❌"
          : "⏳";
    deps.stdout.write(` ${icon} ${result.kind}`);
    if (result.kind === "delivered") {
      deps.stdout.write(` · ${result.signal}`);
      if (result.mergeCommit) {
        deps.stdout.write(` · ${result.mergeCommit.slice(0, 7)}`);
      }
    }
    deps.stdout.write("\n");
  }

  // Summary.
  const delivered = reportItems.filter((i) => i.result.kind === "delivered").length;
  const mergeNow = reportItems.filter((i) => i.result.kind === "merge_now").length;
  const ciFailed = reportItems.filter((i) => i.result.kind === "ci_failed").length;
  const waiting = reportItems.filter((i) => i.result.kind === "wait").length;

  deps.stdout.write(
    lang === "zh"
      ? `\n对账完成：${reportItems.length} 个 cycle · ${delivered} 已交付 · ${mergeNow} 待合并 · ${ciFailed} CI 失败 · ${waiting} 挂起${dryRun ? "（--dry-run）" : ""}\n`
      : `\nReconciled ${reportItems.length} cycles · ${delivered} delivered · ${mergeNow} merge-ready · ${ciFailed} CI failed · ${waiting} waiting${dryRun ? " (--dry-run)" : ""}\n`,
  );

  // --json output.
  if (jsonMode) {
    const jsonOutput = reportItems.map((item) => ({
      cycleId: item.cycleId,
      storyId: item.storyId,
      branch: item.branch,
      prNumber: item.prNumber,
      previousState: item.previousState,
      kind: item.result.kind,
      signal: item.signal,
      mergeCommit: item.mergeCommit,
    }));
    deps.stdout.write(JSON.stringify(jsonOutput, null, 2) + "\n");
  }

  return 0;
}
