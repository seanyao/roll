/**
 * US-LOOP-093 — `roll worktree audit`: 只读 worktree 生命周期审计。
 *
 * Read-only audit of all git worktrees registered for the current repo.
 * Classifies loop/manual/external ownership, splits dirty state into tracked
 * vs untracked, determines merge evidence (ancestor / PR-merged / patch-equivalent
 * / none / unknown), and assigns a disposition. Never deletes, moves, stashes,
 * pushes, or rewrites any file or git ref.
 *
 * Data contract: {@link WorktreeAuditRecord}, {@link WorktreeAuditOutput}
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isEphemeralBranch } from "@roll/core";
import { resolveIntegrationBranch } from "@roll/infra";

// ─── types (shared with the spec) ───────────────────────────────────────────

export type WorktreeOwner = "loop" | "manual" | "external";

export type MergeEvidenceKind =
  | "ancestor"
  | "pr_merged"
  | "patch_equivalent"
  | "none"
  | "unknown";

export type WorktreeDisposition =
  | "active"
  | "disposable_candidate"
  | "preserved_needs_review"
  | "preserved_unpublished"
  | "preserved_dirty_no_tcr"
  | "external_unmanaged";

export interface WorktreeAuditRecord {
  path: string;
  branch?: string;
  head?: string;
  owner: WorktreeOwner;
  cycleId?: string;
  storyId?: string;
  outcome?: string;
  dirtyTracked: boolean | "unknown";
  dirtyUntracked: boolean | "unknown";
  ahead: number | null;
  mergeEvidence: {
    kind: MergeEvidenceKind;
    detail?: string;
  };
  openPr?: {
    url: string;
    state: "OPEN" | "MERGED" | "CLOSED" | "UNKNOWN";
  };
  active: boolean;
  disposition: WorktreeDisposition;
  reason: string;
}

export interface WorktreeAuditOutput {
  schema: 1;
  generatedAt: string;
  repo: string;
  records: WorktreeAuditRecord[];
  /**
   * FIX-1273: the EXACT ephemeral local branches the branch/worktree canary
   * counts (isEphemeralBranch over `git branch`). Enumerated here so the canary
   * trip + cleanup planner can report the full counted set — the audit is the
   * SOLE authority over what the canary sees, never a separate ad-hoc count.
   */
  ephemeralBranches: string[];
  summary: {
    total: number;
    loop: number;
    manual: number;
    external: number;
    active: number;
    disposableCandidates: number;
    preserved: number;
    /** FIX-1273: ephemeral local branch count (canary's other addend). */
    ephemeralBranches: number;
  };
}

// ─── dependency hooks (injectable for tests) ──────────────────────────────

export interface WorktreeAuditDeps {
  /** CWD for the repo root. */
  repoRoot: string;
  /** Replacement for `git` invocations (array of ['git', 'arg', …'] → stdout). */
  git?: (args: string[], cwd: string) => string;
  /** Read file content (for events.ndjson, lock files). */
  readFile?: (p: string) => string | null;
  /** Current timestamp as ISO-8601 string. */
  nowISO?: () => string;
  /** Current UTC seconds. */
  nowSec?: () => number;
  /** Home directory (for sibling worktree detection). */
  home: string;
  /**
   * E1: the integration branch the merge/ahead probes compare against. Defaults
   * to the project's resolved `integration_branch` config (origin/main unless
   * overridden). Injected in tests.
   */
  integrationBranch?: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
    }).trimEnd();
  } catch {
    return "";
  }
}

function readFileSafe(p: string): string | null {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** Known manual/sibling worktree directory name patterns. */
const MANUAL_PATTERNS = [/roll-wt-/, /^wt-/, /roll-us-init-/];

// ─── classification ─────────────────────────────────────────────────────────

function classifyOwner(absPath: string, repoRoot: string): WorktreeOwner {
  const loopRoot = resolve(repoRoot, ".roll", "loop", "worktrees");
  const rp = resolve(absPath);
  if (rp.startsWith(loopRoot + "/") || rp === loopRoot) return "loop";

  // Check sibling directories: direct children of repo's parent dir
  const repoParent = dirname(resolve(repoRoot));
  const rel = relative(repoParent, rp);
  if (!rel.startsWith("..")) {
    const name = basename(rp);
    for (const re of MANUAL_PATTERNS) {
      if (re.test(name)) return "manual";
    }
  }
  return "external";
}

// ─── events.ndjson helpers ─────────────────────────────────────────────────

interface CycleEvent {
  cycleId?: string;
  storyId?: string;
  outcome?: string;
  type?: string;
  ts?: number;
}

function readCycleContext(eventsPath: string, deps: WorktreeAuditDeps): Map<string, CycleEvent> {
  const map = new Map<string, CycleEvent>();
  const text = deps.readFile ? deps.readFile(eventsPath) : readFileSafe(eventsPath);
  if (!text) return map;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const ev: CycleEvent = JSON.parse(trimmed);
      if (!ev.cycleId) continue;
      const existing = map.get(ev.cycleId);
      if (!existing) {
        map.set(ev.cycleId, ev);
      } else {
        if (ev.storyId) existing.storyId = ev.storyId;
        if (ev.outcome) existing.outcome = ev.outcome;
      }
    } catch {
      /* corrupt line: skip */
    }
  }
  return map;
}

function extractCycleId(dirName: string): string | undefined {
  const m = /^(cycle-\d{8}-\d{6}-\d+)$/.exec(dirName);
  return m ? m[1] : undefined;
}

// ─── dirty detection ────────────────────────────────────────────────────────

function detectDirty(
  wtPath: string,
  deps: WorktreeAuditDeps,
): { dirtyTracked: boolean | "unknown"; dirtyUntracked: boolean | "unknown" } {
  try {
    const g = deps.git ?? git;
    // Tracked-only dirt: no untracked files
    const tracked = g(["status", "--porcelain", "--untracked-files=no"], wtPath);
    // Full status
    const all = g(["status", "--porcelain", "--untracked-files=normal"], wtPath);

    const trackedLines = tracked.split("\n").filter((l) => l.trim());
    const allLines = all.split("\n").filter((l) => l.trim());

    return {
      dirtyTracked: trackedLines.length > 0,
      dirtyUntracked: allLines.length > trackedLines.length,
    };
  } catch {
    return { dirtyTracked: "unknown", dirtyUntracked: "unknown" };
  }
}

// ─── merge evidence ─────────────────────────────────────────────────────────

function detectMergeEvidence(
  wtPath: string,
  branch: string | undefined,
  deps: WorktreeAuditDeps,
  integrationBranch: string,
): { kind: MergeEvidenceKind; detail?: string } {
  // 1. Check if HEAD is ancestor of the integration branch via merge-base compare
  try {
    const g = deps.git ?? git;
    const headSha = g(["rev-parse", "HEAD"], wtPath);
    const mergeBase = g(["merge-base", "HEAD", integrationBranch], wtPath);
    if (headSha && mergeBase && headSha === mergeBase) {
      return { kind: "ancestor", detail: `HEAD is ancestor of ${integrationBranch}` };
    }
  } catch {
    // Fall through
  }

  // 2. Check --is-ancestor via exit code (covers squash merges where
  //    branch is listed in `git branch --merged <integrationBranch>`)
  if (branch) {
    try {
      const g = deps.git ?? git;
      const merged = g(["branch", "--merged", integrationBranch], wtPath);
      const branchName = branch.replace(/^refs\/heads\//, "");
      for (const line of merged.split("\n")) {
        const trimmed = line.replace(/^\*?\s+/, "").trim();
        if (trimmed === branchName) {
          return {
            kind: "pr_merged",
            detail: `branch ${branchName} is merged into ${integrationBranch} (squash-safe)`,
          };
        }
      }
    } catch {
      // Fall through
    }
  }

  // 3. Explicit is-ancestor exit code check
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", "HEAD", integrationBranch], {
      cwd: wtPath,
      stdio: "ignore",
    });
    return { kind: "ancestor", detail: `HEAD is ancestor of ${integrationBranch}` };
  } catch {
    // Not an ancestor
  }

  return { kind: "none" };
}

// ─── ahead count ────────────────────────────────────────────────────────────

function countAhead(wtPath: string, deps: WorktreeAuditDeps, integrationBranch: string): number | null {
  try {
    const g = deps.git ?? git;
    const out = g(["rev-list", "--count", "HEAD", `^${integrationBranch}`], wtPath).trim();
    if (!out) return null;
    const n = Number(out);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// ─── active cycle detection ─────────────────────────────────────────────────

function isActiveCycle(
  cycleId: string | undefined,
  repoRoot: string,
  deps: WorktreeAuditDeps,
): boolean {
  if (!cycleId) return false;

  // Check inner.lock for the active cycleId
  const lockPath = join(repoRoot, ".roll", "loop", "inner.lock");
  const lock = deps.readFile ? deps.readFile(lockPath) : readFileSafe(lockPath);
  if (lock) {
    for (const line of lock.split("\n")) {
      if (line.trim().startsWith(cycleId)) return true;
    }
  }

  // Check heartbeat freshness
  const nowSec = deps.nowSec?.() ?? Math.floor(Date.now() / 1000);
  const HEARTBEAT_STALE_SEC = 300;

  try {
    const heartbeatPath = join(repoRoot, ".roll", "loop", "heartbeat");
    const hb = deps.readFile ? deps.readFile(heartbeatPath) : readFileSafe(heartbeatPath);
    if (hb) {
      for (const line of hb.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === cycleId && parts.length >= 3) {
          const ts = Number(parts[1]);
          if (Number.isFinite(ts) && nowSec - ts <= HEARTBEAT_STALE_SEC) return true;
        }
      }
    }
  } catch {
    /* heartbeat read failed — not a reason to mark active */
  }

  return false;
}

// ─── disposition ────────────────────────────────────────────────────────────

function classifyDisposition(
  rec: WorktreeAuditRecord,
): { disposition: WorktreeDisposition; reason: string } {
  if (rec.active) return { disposition: "active", reason: "active cycle with fresh lock/heartbeat" };

  if (rec.owner === "external") {
    return { disposition: "external_unmanaged", reason: "external worktree; not managed by loop" };
  }
  if (rec.owner === "manual") {
    return { disposition: "external_unmanaged", reason: "manual sibling worktree; not managed by loop" };
  }

  const hasDirtyTracked = rec.dirtyTracked === true;
  const hasMerge =
    rec.mergeEvidence.kind === "ancestor" ||
    rec.mergeEvidence.kind === "pr_merged" ||
    rec.mergeEvidence.kind === "patch_equivalent";
  const hasOpenPr = rec.openPr?.state === "OPEN";
  const hasMergedPr = rec.openPr?.state === "MERGED";

  // Merged + no tracked dirt + no open PR → disposable
  if (hasMerge && !hasDirtyTracked && !hasOpenPr) {
    return { disposition: "disposable_candidate", reason: "merged worktree with no tracked dirt; candidate for future gc" };
  }

  // Ahead / unpublished
  if (rec.ahead !== null && rec.ahead > 0) {
    if (hasDirtyTracked) {
      return { disposition: "preserved_dirty_no_tcr", reason: "unpublished loop worktree with uncommitted tracked changes; audit only" };
    }
    if (hasOpenPr) {
      return { disposition: "preserved_unpublished", reason: `unpublished loop worktree has open PR (${rec.openPr?.url ?? "unknown"}); audit only` };
    }
    return { disposition: "preserved_unpublished", reason: "unpublished loop worktree has unmerged work ahead; audit only" };
  }

  if (hasDirtyTracked) {
    return { disposition: "preserved_dirty_no_tcr", reason: "loop worktree with tracked changes and no clear merge evidence; audit only" };
  }

  const terminal = ["failed", "blocked", "aborted_no_delivery", "handoff_without_tcr"];
  if (rec.outcome && terminal.includes(rec.outcome)) {
    return { disposition: "preserved_needs_review", reason: `loop worktree with terminal outcome '${rec.outcome}'; may need rescue` };
  }

  if ((hasMerge || hasMergedPr) && rec.dirtyUntracked === true) {
    return { disposition: "disposable_candidate", reason: "merged worktree with only untracked scratch; candidate for future gc" };
  }

  return { disposition: "preserved_needs_review", reason: "loop worktree with unclear state; needs manual review" };
}

// ─── main audit function ───────────────────────────────────────────────────

export function auditWorktrees(deps: WorktreeAuditDeps): WorktreeAuditOutput {
  const repoRoot = resolve(deps.repoRoot);
  // E1: resolve the integration branch ONCE (injected override wins for tests;
  // otherwise the project's `integration_branch` config, default origin/main).
  const integrationBranch = deps.integrationBranch ?? resolveIntegrationBranch(repoRoot);

  // 1. Parse `git worktree list --porcelain`
  const wtOutput = deps.git
    ? deps.git(["worktree", "list", "--porcelain"], repoRoot)
    : git(["worktree", "list", "--porcelain"], repoRoot);

  // 2. Read events.ndjson for cycle context
  const eventsPath = join(repoRoot, ".roll", "loop", "events.ndjson");
  const cycles = readCycleContext(eventsPath, deps);

  // 3. Parse worktree entries
  interface RawWorktree { path: string; head: string; branch: string; }
  const entries: RawWorktree[] = [];
  let current: Partial<RawWorktree> = {};

  for (const line of wtOutput.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) entries.push({ path: current.path, head: current.head ?? "", branch: current.branch ?? "" });
      current = { path: line.slice(9).trim() };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice(5).trim();
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).trim();
    } else if (line === "") {
      if (current.path) {
        entries.push({ path: current.path, head: current.head ?? "", branch: current.branch ?? "" });
        current = {};
      }
    }
  }
  if (current.path) {
    entries.push({ path: current.path, head: current.head ?? "", branch: current.branch ?? "" });
  }

  // 4. Build records
  const records: WorktreeAuditRecord[] = [];

  for (const entry of entries) {
    const absPath = resolve(entry.path);
    const owner = classifyOwner(absPath, repoRoot);

    let cycleId: string | undefined;
    let storyId: string | undefined;
    let outcome: string | undefined;

    if (owner === "loop") {
      cycleId = extractCycleId(basename(absPath));
      if (cycleId) {
        const ce = cycles.get(cycleId);
        if (ce) {
          storyId = ce.storyId;
          outcome = ce.outcome;
        }
      }
    }

    const dirty = detectDirty(absPath, deps);
    const ahead = countAhead(absPath, deps, integrationBranch);
    const mergeEvidence = detectMergeEvidence(absPath, entry.branch || undefined, deps, integrationBranch);
    const active = isActiveCycle(cycleId, repoRoot, deps);

    const baseRec: WorktreeAuditRecord = {
      path: absPath,
      branch: entry.branch || undefined,
      head: entry.head || undefined,
      owner,
      cycleId,
      storyId,
      outcome,
      dirtyTracked: dirty.dirtyTracked,
      dirtyUntracked: dirty.dirtyUntracked,
      ahead,
      mergeEvidence,
      active,
      disposition: "preserved_needs_review",
      reason: "",
    };

    const disp = classifyDisposition(baseRec);
    baseRec.disposition = disp.disposition;
    baseRec.reason = disp.reason;

    records.push(baseRec);
  }

  // 4b. Enumerate the EXACT ephemeral local branches the canary counts. The
  // canary's total = ephemeral branches + loop worktree dirs; surfacing the
  // branch names here makes the audit the single source of truth for what the
  // canary sees (FIX-1273 AC1).
  let ephemeralBranches: string[] = [];
  try {
    const g = deps.git ?? git;
    const branchOut = g(["branch", "--format=%(refname:short)"], repoRoot);
    ephemeralBranches = branchOut
      .split("\n")
      .map((s) => s.trim())
      .filter((b) => b !== "" && isEphemeralBranch(b))
      .sort();
  } catch {
    // A git hiccup while listing branches must not topple the audit — the
    // canary/cleanup surface simply sees zero enumerated branches.
    ephemeralBranches = [];
  }

  // 5. Summary
  const summary = {
    total: records.length,
    loop: records.filter((r) => r.owner === "loop").length,
    manual: records.filter((r) => r.owner === "manual").length,
    external: records.filter((r) => r.owner === "external").length,
    active: records.filter((r) => r.active).length,
    disposableCandidates: records.filter((r) => r.disposition === "disposable_candidate").length,
    preserved: records.filter(
      (r) => r.disposition !== "disposable_candidate" && r.disposition !== "external_unmanaged",
    ).length,
    ephemeralBranches: ephemeralBranches.length,
  };

  const repoName = basename(repoRoot);
  const nowISO = deps.nowISO?.() ?? new Date().toISOString();

  return {
    schema: 1,
    generatedAt: nowISO,
    repo: repoName,
    records,
    ephemeralBranches,
    summary,
  };
}

// ─── human output ───────────────────────────────────────────────────────────

function renderHuman(output: WorktreeAuditOutput): string {
  const lines: string[] = ["Worktree audit", ""];

  lines.push(`  total: ${output.summary.total}`);
  lines.push(`  loop: ${output.summary.loop}`);
  lines.push(`  manual: ${output.summary.manual}`);
  if (output.summary.external > 0) lines.push(`  external: ${output.summary.external}`);
  lines.push(`  active: ${output.summary.active}`);
  lines.push(`  disposable candidates: ${output.summary.disposableCandidates}`);
  lines.push(`  preserved: ${output.summary.preserved}`);
  lines.push(`  ephemeral branches: ${output.summary.ephemeralBranches}`);
  lines.push("");

  if (output.ephemeralBranches.length > 0) {
    lines.push("ephemeral branches (canary-counted)");
    for (const b of output.ephemeralBranches) lines.push(`  ${b}`);
    lines.push("");
  }

  // Group by disposition
  const groups = new Map<WorktreeDisposition, WorktreeAuditRecord[]>();
  for (const r of output.records) {
    const list = groups.get(r.disposition) ?? [];
    list.push(r);
    groups.set(r.disposition, list);
  }

  const order: WorktreeDisposition[] = [
    "active",
    "preserved_unpublished",
    "preserved_dirty_no_tcr",
    "preserved_needs_review",
    "disposable_candidate",
    "external_unmanaged",
  ];

  for (const disp of order) {
    const group = groups.get(disp);
    if (!group || group.length === 0) continue;
    lines.push(disp);
    for (const r of group) {
      const parts: string[] = [];
      let displayPath = r.path;
      try {
        const rel = relative(process.cwd(), r.path);
        if (!rel.startsWith("..") && rel.length < r.path.length) displayPath = rel;
      } catch { /* keep absolute */ }
      parts.push(`  ${displayPath}`);
      if (r.storyId) parts.push(r.storyId);
      if (r.openPr) parts.push(`${r.openPr.url} ${r.openPr.state}`);
      const tags: string[] = [];
      if (r.dirtyTracked === true) tags.push("tracked dirt");
      else if (r.dirtyTracked === "unknown") tags.push("dirty=?");
      if (r.dirtyUntracked === true && r.dirtyTracked !== true) tags.push("untracked dirt");
      if (r.ahead !== null && r.ahead > 0) tags.push(`ahead=${r.ahead}`);
      if (r.mergeEvidence.kind === "unknown") tags.push("merge=?");
      if (tags.length > 0) parts.push(tags.join(", "));
      lines.push(parts.join("  "));
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

// ─── CLI command ────────────────────────────────────────────────────────────

const USAGE =
  "Usage: roll worktree audit [--json] [--repo <path>]\n" +
  "  Read-only audit of all git worktrees registered for this repo.\n" +
  "  Classifies ownership, dirt, merge evidence, and disposition.\n" +
  "  --json    print schema-1 JSON output\n" +
  "  --repo    override the project root (default: current directory)\n";

export function worktreeAuditCommand(args: string[], deps?: Partial<WorktreeAuditDeps>): number {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }

  const jsonFlag = args.includes("--json");
  const repoIdx = args.indexOf("--repo");
  const repoOverride = repoIdx >= 0 ? args[repoIdx + 1] : undefined;

  const repoRoot = repoOverride ?? process.cwd();

  const fullDeps: WorktreeAuditDeps = {
    repoRoot,
    home: deps?.home ?? homedir(),
    git: deps?.git,
    readFile: deps?.readFile,
    nowISO: deps?.nowISO,
    nowSec: deps?.nowSec,
  };

  const output = auditWorktrees(fullDeps);

  if (jsonFlag) {
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  } else {
    process.stdout.write(renderHuman(output));
  }

  return 0;
}
