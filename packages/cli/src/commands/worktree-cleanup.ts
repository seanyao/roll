/**
 * FIX-1273 — `roll worktree cleanup`: safe recovery for branch-canary historical
 * worktree pressure.
 *
 * The branch/worktree canary counts every ephemeral branch + every dir under
 * `.roll/loop/worktrees` and pauses the loop over threshold — INCLUDING inactive
 * worktrees deliberately preserved for unpublished commits or dirty recovery.
 * `roll worktree audit` already proves whether a worktree is a merged, clean
 * `disposable_candidate`, but offered no actionable safe cleanup, so operators
 * force-removed by hand.
 *
 * This command adds a plan/apply route whose SOLE authority is the existing
 * audit. It NEVER removes a path merely because it is old or counted by the
 * canary — a canary count is never translated into a blanket deletion.
 *
 *   - `--dry-run` (default): print the exact counted refs/dirs, their audit
 *     disposition, and the MINIMAL candidate set needed to return under the
 *     canary threshold. It never mutates git state.
 *   - `--apply`: re-run the audit immediately before EVERY removal and require
 *     the same path + head + inactive + no-tracked-dirt + merged-ancestry +
 *     `disposable_candidate` disposition. It removes only that verified worktree
 *     through git, prunes registration, and emits structured events. A changed
 *     head, new dirt, missing path, or concurrent activation fails closed
 *     (fail-loud refusal) without substituting a preserved worktree.
 *
 * Data contract: {@link WorktreeCleanupPlan}, {@link WorktreeCleanupResult}.
 */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { DEFAULT_BRANCH_CANARY_MAX } from "@roll/core";
import type { RollEvent } from "@roll/spec";
import {
  auditWorktrees,
  type WorktreeAuditDeps,
  type WorktreeAuditOutput,
  type WorktreeAuditRecord,
} from "./worktree-audit.js";

// ─── data contract ───────────────────────────────────────────────────────────

/** A single audit-proven removable worktree in a cleanup plan. */
export interface CleanupCandidate {
  path: string;
  cycleId?: string;
  branch?: string;
  /** HEAD the audit observed; `--apply` refuses if the fresh head differs. */
  expectedHead: string;
  reason: "disposable_candidate";
}

/** A worktree the plan leaves untouched, with the audit disposition that spared it. */
export interface PreservedRecord {
  path: string;
  disposition: string;
  reason: string;
}

export interface WorktreeCleanupPlan {
  schema: 1;
  generatedAt: string;
  /** Canary threshold in force when the plan was built. */
  threshold: number;
  /** Total the canary sees: ephemeral branches + loop worktree dirs. */
  canaryTotal: number;
  /** Canary total once the plan's candidates are removed. */
  projectedTotal: number;
  /** The exact ephemeral branches the canary counts (enumerated, not summarised). */
  countedBranches: readonly string[];
  /** Every loop worktree dir the canary counts, with its audit disposition. */
  countedWorktrees: readonly { path: string; disposition: string }[];
  /** The MINIMAL, deterministic set needed to clear pressure. */
  candidates: readonly CleanupCandidate[];
  /** Everything the plan will NOT remove, with the disposition that spared it. */
  preserved: readonly PreservedRecord[];
}

/** Outcome of one candidate under `applyWorktreeCleanup`. */
export interface CleanupRemoval {
  path: string;
  expectedHead: string;
  branch?: string;
  cycleId?: string;
}

export interface CleanupRefusal {
  path: string;
  reason: string;
}

export interface WorktreeCleanupResult {
  schema: 1;
  dryRun: boolean;
  /** Candidates that revalidated and were removed (or WOULD be, under dry-run). */
  removed: CleanupRemoval[];
  /** Candidates that failed fresh revalidation — fail-loud, no substitution. */
  refused: CleanupRefusal[];
  /** The plan's preserved set, carried through verbatim (never removed). */
  preserved: PreservedRecord[];
}

// ─── planning (pure) ─────────────────────────────────────────────────────────

const MERGED_KINDS = new Set(["ancestor", "pr_merged", "patch_equivalent"]);

/** True iff `rec` satisfies EVERY safe-removal invariant on a fresh audit. */
export function isSafelyDisposable(rec: WorktreeAuditRecord): boolean {
  return (
    rec.owner === "loop" &&
    rec.active === false &&
    rec.dirtyTracked === false &&
    rec.disposition === "disposable_candidate" &&
    MERGED_KINDS.has(rec.mergeEvidence.kind) &&
    typeof rec.head === "string" &&
    rec.head.length > 0
  );
}

/**
 * Build the minimal, deterministic cleanup plan from a FRESH audit. The plan
 * removes ONLY audit-proven `disposable_candidate` loop worktrees, and only as
 * many (lowest-path-first) as are needed to bring the canary total back under
 * `threshold`. It never selects a path for being old or merely counted.
 */
export function planWorktreeCleanup(
  audit: WorktreeAuditOutput,
  threshold: number,
): WorktreeCleanupPlan {
  const loopWorktrees = audit.records.filter((r) => r.owner === "loop");
  const canaryTotal = audit.ephemeralBranches.length + loopWorktrees.length;
  const excess = canaryTotal - threshold;

  // The removable pool: audit-proven safe candidates, deterministically ordered.
  const pool = audit.records
    .filter(isSafelyDisposable)
    .sort((a, b) => a.path.localeCompare(b.path));

  // Take the MINIMUM needed to clear pressure (never more). If already under
  // threshold, the minimal set is empty even though disposables may exist.
  const needed = excess > 0 ? Math.min(excess, pool.length) : 0;
  const chosen = pool.slice(0, needed);
  const chosenPaths = new Set(chosen.map((r) => r.path));

  const candidates: CleanupCandidate[] = chosen.map((r) => ({
    path: r.path,
    ...(r.cycleId ? { cycleId: r.cycleId } : {}),
    ...(r.branch ? { branch: r.branch } : {}),
    expectedHead: r.head as string,
    reason: "disposable_candidate" as const,
  }));

  // Everything not chosen is preserved — including disposables held back because
  // the minimal set already cleared the pressure.
  const preserved: PreservedRecord[] = audit.records
    .filter((r) => !chosenPaths.has(r.path))
    .map((r) => ({ path: r.path, disposition: r.disposition, reason: r.reason }));

  const countedWorktrees = loopWorktrees.map((r) => ({
    path: r.path,
    disposition: r.disposition,
  }));

  return {
    schema: 1,
    generatedAt: audit.generatedAt,
    threshold,
    canaryTotal,
    projectedTotal: canaryTotal - candidates.length,
    countedBranches: [...audit.ephemeralBranches],
    countedWorktrees,
    candidates,
    preserved,
  };
}

// ─── apply (effectful, injectable) ───────────────────────────────────────────

export interface ApplyCleanupOptions {
  repositoryRoot: string;
  /** When true, revalidate + report but perform NO git mutation. */
  dryRun: boolean;
  /**
   * Re-run a FRESH audit; called immediately before EVERY candidate removal so
   * a state change between plan and apply is caught. Defaults to the real audit
   * over `repositoryRoot`.
   */
  audit?: () => WorktreeAuditOutput;
  /** Remove one worktree via git + prune registration. Injectable for tests. */
  removeWorktree?: (repositoryRoot: string, path: string) => { ok: boolean; detail: string };
  /** Structured event sink (defaults to no-op; the CLI wires events.ndjson). */
  emit?: (event: RollEvent) => void;
  nowISO?: () => string;
  nowMs?: () => number;
}

function defaultRemoveWorktree(repositoryRoot: string, path: string): { ok: boolean; detail: string } {
  try {
    // Remove ONLY this validated path. --force tolerates untracked scratch, but
    // tracked dirt was already rejected by the immediately-preceding fresh audit
    // (isSafelyDisposable requires dirtyTracked === false), and a disposable
    // candidate is merged (ancestor/pr-equivalent) so no unpublished commit is
    // pinned solely by this worktree.
    execFileSync("git", ["-C", repositoryRoot, "worktree", "remove", "--force", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
  try {
    // Reclaim the worktree admin metadata immediately (git's default prune
    // expiry is 3 months) — but never let a prune hiccup mask a successful remove.
    execFileSync("git", ["-C", repositoryRoot, "worktree", "prune", "--expire", "now"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    /* best-effort: the removal already succeeded */
  }
  return { ok: true, detail: "" };
}

/**
 * Apply (or dry-run) a cleanup plan. For EACH candidate it re-runs a FRESH audit
 * and requires the same path + head + inactive + no-tracked-dirt + merged +
 * `disposable_candidate` before touching git. Any mismatch is a fail-loud
 * refusal recorded via `worktree_cleanup_refused`; NO other worktree is
 * substituted, and NO threshold-only deletion ever happens.
 */
export async function applyWorktreeCleanup(
  plan: WorktreeCleanupPlan,
  options: ApplyCleanupOptions,
): Promise<WorktreeCleanupResult> {
  const repositoryRoot = resolve(options.repositoryRoot);
  const auditFn =
    options.audit ?? (() => auditWorktrees({ repoRoot: repositoryRoot, home: homedir() }));
  const removeFn = options.removeWorktree ?? defaultRemoveWorktree;
  const emit = options.emit ?? (() => {});
  const nowMs = options.nowMs ?? (() => Date.now());

  const removed: CleanupRemoval[] = [];
  const refused: CleanupRefusal[] = [];

  for (const candidate of plan.candidates) {
    // Re-derive action from a FRESH audit — never from the (possibly stale) plan.
    const fresh = auditFn();
    const rec = fresh.records.find((r) => resolve(r.path) === resolve(candidate.path));

    const refuse = (reason: string): void => {
      refused.push({ path: candidate.path, reason });
      emit({ type: "worktree_cleanup_refused", path: candidate.path, reason, ts: nowMs() });
    };

    if (!rec) {
      refuse("missing: worktree no longer registered (already removed or pruned)");
      continue; // fail closed for this candidate; never substitute another
    }
    if (rec.head !== candidate.expectedHead) {
      refuse(`changed-head: expected ${candidate.expectedHead}, found ${rec.head ?? "none"}`);
      continue;
    }
    if (rec.active) {
      refuse("active: worktree activated concurrently (fresh lock/heartbeat)");
      continue;
    }
    if (rec.dirtyTracked === true) {
      refuse("dirty: tracked changes appeared after planning");
      continue;
    }
    if (rec.dirtyTracked === "unknown") {
      refuse("dirty-unknown: could not confirm a clean tracked tree");
      continue;
    }
    if (!isSafelyDisposable(rec)) {
      refuse(`disposition: fresh audit reports '${rec.disposition}' (${rec.mergeEvidence.kind})`);
      continue;
    }

    const removal: CleanupRemoval = {
      path: rec.path,
      expectedHead: candidate.expectedHead,
      ...(rec.branch ? { branch: rec.branch } : {}),
      ...(rec.cycleId ? { cycleId: rec.cycleId } : {}),
    };

    if (options.dryRun) {
      // Revalidated as removable, but perform NO git mutation under dry-run.
      removed.push(removal);
      continue;
    }

    const result = removeFn(repositoryRoot, rec.path);
    if (!result.ok) {
      refuse(`remove-failed: ${result.detail}`);
      continue;
    }
    removed.push(removal);
    emit({
      type: "worktree_cleanup_applied",
      path: rec.path,
      expectedHead: candidate.expectedHead,
      ...(rec.branch ? { branch: rec.branch } : {}),
      ...(rec.cycleId ? { cycleId: rec.cycleId } : {}),
      ts: nowMs(),
    });
  }

  return {
    schema: 1,
    dryRun: options.dryRun,
    removed,
    refused,
    preserved: [...plan.preserved],
  };
}

// ─── canary-trip enumeration (pure, AC1) ─────────────────────────────────────

/**
 * Build the enumerated canary-trip report + structured event from a fresh audit.
 * The pause is thereby auditable: it lists the EXACT counted branches and loop
 * worktrees with each worktree's disposition, not a bare number.
 */
export function formatCanaryTripReport(
  audit: WorktreeAuditOutput,
  threshold: number,
  nowMs: number,
): { alert: string; event: RollEvent } {
  const worktrees = audit.records
    .filter((r) => r.owner === "loop")
    .map((r) => ({ path: r.path, disposition: r.disposition }));
  const total = audit.ephemeralBranches.length + worktrees.length;

  const disposable = worktrees.filter((w) => w.disposition === "disposable_candidate").length;
  const branchLines = audit.ephemeralBranches.length
    ? audit.ephemeralBranches.map((b) => `  - branch ${b}`).join("\n")
    : "  - (none)";
  const wtLines = worktrees.length
    ? worktrees.map((w) => `  - worktree ${w.path} [${w.disposition}]`).join("\n")
    : "  - (none)";

  const alert =
    `# ALERT — loop auto-paused: branch/worktree leak canary tripped (US-LOOP-096 / FIX-1273)\n\n` +
    `**Leak count**: ${total} (ephemeral branches ${audit.ephemeralBranches.length} + ` +
    `worktrees ${worktrees.length}) > threshold ${threshold}\n\n` +
    `**Counted ephemeral branches**:\n${branchLines}\n\n` +
    `**Counted loop worktrees (with audit disposition)**:\n${wtLines}\n\n` +
    `**Safe recovery**: ${disposable} worktree(s) audit as \`disposable_candidate\`.\n` +
    `  1. Inspect + plan (no mutation): \`roll worktree cleanup --dry-run\`\n` +
    `  2. Apply the audited minimal set:  \`roll worktree cleanup --apply\`\n` +
    `  3. Resume the loop explicitly:     \`roll loop resume\`\n` +
    `  Preserved (unpublished / dirty / active / external) worktrees are NEVER removed.\n`;

  const event: RollEvent = {
    type: "branch_canary_tripped",
    total,
    threshold,
    ephemeralBranches: [...audit.ephemeralBranches],
    worktrees,
    ts: nowMs,
  };
  return { alert, event };
}

// ─── human rendering ─────────────────────────────────────────────────────────

function rel(p: string): string {
  try {
    const r = relative(process.cwd(), p);
    if (!r.startsWith("..") && r.length < p.length) return r;
  } catch {
    /* keep absolute */
  }
  return p;
}

function renderPlanHuman(plan: WorktreeCleanupPlan, mode: "dry-run" | "apply"): string {
  const lines: string[] = [];
  lines.push(`Worktree cleanup (${mode})`);
  lines.push("");
  lines.push(`  canary count: ${plan.canaryTotal} (threshold ${plan.threshold})`);
  lines.push(
    `  counted: ${plan.countedBranches.length} ephemeral branch(es) + ` +
      `${plan.countedWorktrees.length} loop worktree(s)`,
  );
  lines.push("");

  lines.push("counted ephemeral branches");
  if (plan.countedBranches.length === 0) lines.push("  (none)");
  for (const b of plan.countedBranches) lines.push(`  ${b}`);
  lines.push("");

  lines.push("counted loop worktrees");
  if (plan.countedWorktrees.length === 0) lines.push("  (none)");
  for (const w of plan.countedWorktrees) lines.push(`  ${rel(w.path)}  [${w.disposition}]`);
  lines.push("");

  if (plan.candidates.length === 0) {
    if (plan.canaryTotal <= plan.threshold) {
      lines.push("No cleanup needed — canary count is already within threshold.");
    } else {
      lines.push(
        "No disposable candidates — every counted worktree is preserved " +
          "(unpublished / dirty / active / external). Canary pressure cannot be " +
          "cleared by cleanup; inspect the preserved worktrees manually.",
      );
    }
    lines.push("");
    return lines.join("\n").trimEnd() + "\n";
  }

  lines.push(`minimal candidate set (${plan.canaryTotal} → ${plan.projectedTotal})`);
  for (const c of plan.candidates) {
    const tags = [c.branch, c.cycleId].filter(Boolean).join(" ");
    lines.push(`  ${rel(c.path)}${tags ? "  " + tags : ""}  [disposable_candidate]`);
  }
  lines.push("");

  if (mode === "dry-run") {
    lines.push("Dry run — no git state changed.");
    lines.push("Apply the audited set with: roll worktree cleanup --apply");
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function renderResultHuman(result: WorktreeCleanupResult): string {
  const lines: string[] = [];
  lines.push("Worktree cleanup (apply)");
  lines.push("");
  if (result.removed.length > 0) {
    lines.push(`removed (${result.removed.length})`);
    for (const r of result.removed) lines.push(`  ${rel(r.path)}  ${r.expectedHead}`);
    lines.push("");
  }
  if (result.refused.length > 0) {
    lines.push(`refused — fail closed, no substitution (${result.refused.length})`);
    for (const r of result.refused) lines.push(`  ${rel(r.path)}  ${r.reason}`);
    lines.push("");
  }
  if (result.removed.length === 0 && result.refused.length === 0) {
    lines.push("Nothing to remove — no revalidated candidates.");
    lines.push("");
  }
  if (result.removed.length > 0) {
    lines.push("Resume the loop explicitly when ready: roll loop resume");
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

// ─── CLI command ─────────────────────────────────────────────────────────────

export const CLEANUP_USAGE =
  "Usage: roll worktree cleanup [--dry-run | --apply] [--json] [--repo <path>]\n" +
  "  Safely recover from branch/worktree canary pressure using the worktree\n" +
  "  audit as the SOLE authority. Removes ONLY inactive, merged, clean\n" +
  "  `disposable_candidate` loop worktrees — never a path that is merely old or\n" +
  "  counted, and never a preserved (unpublished / dirty / active / external) one.\n" +
  "\n" +
  "  Always dry-run first. Default (no flag) is --dry-run.\n" +
  "  --dry-run  print counted refs/dirs, audit dispositions, and the minimal\n" +
  "             candidate set to clear pressure. Never mutates git state.\n" +
  "  --apply    re-run the audit before EVERY removal; remove only revalidated\n" +
  "             candidates via git, prune registration, emit events. A changed\n" +
  "             head / new dirt / missing path / concurrent activation fails\n" +
  "             closed (no substitution). Then resume explicitly: roll loop resume\n" +
  "  --json     emit the schema-1 plan (dry-run) or result (apply) as JSON\n" +
  "  --repo     override the project root (default: current directory)\n" +
  "\n" +
  "  安全清理:仅移除审计判定为已合并、干净、非活跃的 disposable_candidate;\n" +
  "  先跑 --dry-run,再 --apply,最后手动 roll loop resume。";

function resolveThreshold(): number {
  const parsed = parseInt(process.env["ROLL_BRANCH_CANARY_MAX"] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BRANCH_CANARY_MAX;
}

export async function worktreeCleanupCommand(
  args: string[],
  deps?: Partial<WorktreeAuditDeps> & {
    removeWorktree?: (repositoryRoot: string, path: string) => { ok: boolean; detail: string };
    emit?: (event: RollEvent) => void;
    nowMs?: () => number;
  },
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(CLEANUP_USAGE + "\n");
    return 0;
  }

  const jsonFlag = args.includes("--json");
  const apply = args.includes("--apply");
  if (apply && args.includes("--dry-run")) {
    process.stderr.write("roll worktree cleanup: --apply and --dry-run are mutually exclusive.\n");
    return 2;
  }
  const repoIdx = args.indexOf("--repo");
  const repoOverride = repoIdx >= 0 ? args[repoIdx + 1] : undefined;
  const repoRoot = resolve(repoOverride ?? process.cwd());

  const fullDeps: WorktreeAuditDeps = {
    repoRoot,
    home: deps?.home ?? homedir(),
    git: deps?.git,
    readFile: deps?.readFile,
    nowISO: deps?.nowISO,
    nowSec: deps?.nowSec,
    integrationBranch: deps?.integrationBranch,
  };

  const threshold = resolveThreshold();
  const plan = planWorktreeCleanup(auditWorktrees(fullDeps), threshold);

  if (!apply) {
    // Dry-run (default): report only, never mutate git state.
    if (jsonFlag) {
      process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    } else {
      process.stdout.write(renderPlanHuman(plan, "dry-run"));
    }
    return 0;
  }

  // Apply: revalidate every candidate against a FRESH audit; emit events.
  const eventsPath = join(repoRoot, ".roll", "loop", "events.ndjson");
  const emit =
    deps?.emit ??
    ((event: RollEvent): void => {
      try {
        mkdirSync(dirname(eventsPath), { recursive: true });
        appendFileSync(eventsPath, JSON.stringify(event) + "\n", "utf8");
      } catch {
        /* best-effort observability */
      }
    });

  const result = await applyWorktreeCleanup(plan, {
    repositoryRoot: repoRoot,
    dryRun: false,
    audit: () => auditWorktrees(fullDeps),
    ...(deps?.removeWorktree ? { removeWorktree: deps.removeWorktree } : {}),
    emit,
    ...(deps?.nowMs ? { nowMs: deps.nowMs } : {}),
  });

  if (jsonFlag) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(renderResultHuman(result));
  }
  // Non-zero only when every attempted removal was refused — a partial success
  // (some removed, some refused) still returns 0 so the operator sees progress.
  return result.removed.length === 0 && result.refused.length > 0 ? 1 : 0;
}
