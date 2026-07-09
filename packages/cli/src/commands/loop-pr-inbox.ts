/**
 * `roll loop pr-inbox` — US-PORT-001: the TS runtime tick for the dedicated
 * PR loop (`com.roll.pr.<slug>`, 5-min cadence). This is the imperative SHELL
 * that finally drives the long-ported pure decision layer (core/pr-loop.ts):
 * it does the gh fan-out + git side-effects, while every routing decision comes
 * from {@link prInboxGate} / {@link selectPrAction} / {@link rebaseCircuitVerdict}
 * / {@link rebaseRecheckAction}. The v2 bash `_loop_pr_inbox` walk
 * (bin/roll 11968-12062) is retired as the runtime driver — the pr runner now
 * calls THIS (see buildPrRunnerScript).
 *
 * Walk (1:1 with the bash inbox, decisions delegated to pr-loop.ts):
 *   1. gh unavailable / no slug                  → idle `gh_unavailable` tick.
 *   2. `gh pr list --state open --json …` fails  → idle `gh_error`.
 *   3. empty / "[]" / zero-length                → idle `empty_response` /
 *      `no_open_prs` / `zero_prs` (via {@link prInboxGate}).
 *   4. per open PR: `gh pr view --json reviews,mergeStateStatus,statusCheckRollup,body,labels`
 *      → reduce {bot, ciState, mergeable} → {@link selectPrAction}:
 *        merge  → `gh pr merge --squash --delete-branch` (eager / bot-approved).
 *        alert  → bot CHANGES_REQUESTED ALERT row, skip.
 *        heal   → ci_red: hand to the bash heal helper (background agent dispatch;
 *                 its TS executor is a separate card — ci-loop.ts).
 *        rebase → stale: 24h circuit breaker (pure, TS) → bridged git rebase →
 *                 re-check → eager merge iff now clean ({@link rebaseRecheckAction}).
 *        skip   → no-op.
 *   5. terminal `acted` tick.
 *
 * DELIBERATE divergence from the v2 bash (whitelisted, like the US-LOOP-009
 * octal fix): the bash inbox swallowed the rebase-circuit result (`… || true`),
 * so a tripped breaker still rebased — defeating the breaker's whole purpose.
 * The TS tick HONORS the verdict: a tripped breaker writes the ALERT and skips
 * the rebase (the behaviour the breaker was designed for, and the contract the
 * pure {@link rebaseCircuitVerdict} already models).
 *
 * Lenient like the bash: any infra hiccup (gh missing, list error, a single PR
 * view failing) degrades to an idle/skip — never a non-zero exit — so the
 * scheduler keeps ticking.
 */
import {
  type CiRollupState,
  type MergeStateStatus,
  type PrTick,
  ciBlackholeAlert,
  prActedTick,
  prIdleTick,
  prInboxGate,
  parseRebaseAttempts,
  promoteDraftAction,
  rebaseCircuitVerdict,
  rebaseRecheckAction,
  reduceCiRollup,
  renderRebaseAttempts,
  selectPrAction,
  DEAD_TICK_NOTES,
  deadTickVerdict,
} from "@roll/core";
import { gh, ghAvailable, ghRepoSlug, prHeadCheckRunCount, prMerge, prReady, remoteUrl, workflowDispatch } from "@roll/infra";
import { DEFAULT_REMOTE_GC_GRACE_MIN, selectDeletableRemoteBranches } from "@roll/core";
import { openPendingPrCreates, pendingPrCreatePath, readPendingPrCreates } from "../runner/pending-pr-create.js";
import { readRunsRows } from "../runner/run-records.js";
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { prHealSelf, prRebaseStale } from "./loop-pr-heal.js";
import { backfillMergedRuns } from "../lib/runs-backfill.js";
import { acMapCandidates, evidencePathsUnresolved } from "../runner/attest-gate.js";

// ─── reduced per-PR facts (the bash jq at bin/roll 11996-12007) ──────────────

/** The classifier inputs the walk reduces from one `pr view` payload. */
export interface PrViewFacts {
  bot: string;
  ciState: CiRollupState;
  mergeable: MergeStateStatus;
  manualMerge?: boolean;
  isDraft?: boolean;
  evidenceResolvable?: boolean;
  evidenceMissing?: string[];
  prAgeMinutes?: number;
  headCheckRunCount?: number;
}

export interface RollEvidenceTrailer {
  storyId: string;
  repo: string;
  sha: string;
  acMapPath: string;
}

export function parseRollEvidenceTrailer(body: string): RollEvidenceTrailer | null {
  for (const line of body.split(/\r?\n/)) {
    const m = /^Roll-Evidence:\s+(\S+)\s+([^@\s]+)@([0-9a-fA-F]{7,64})\s+(\S+)\s*$/.exec(line.trim());
    if (m === null) continue;
    return { storyId: m[1] ?? "", repo: m[2] ?? "", sha: m[3] ?? "", acMapPath: (m[4] ?? "").replace(/^\.roll\//, "") };
  }
  return null;
}

export interface EvidenceResolution {
  ok: boolean;
  missing: string[];
}

function firstStoryId(text: string): string | undefined {
  return /\b(?:US|FIX|REFACTOR|IDEA)-[A-Z0-9]+(?:-[0-9A-Za-z]+)*\b/.exec(text)?.[0];
}

function gitSucceeds(cwd: string, args: string[]): boolean {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

interface StepFailure {
  step: string;
  message: string;
  stderr?: string;
  transient: boolean;
}

function errorText(err: unknown): string {
  if (err instanceof Error && err.message.trim() !== "") return err.message.trim();
  return String(err);
}

function stderrText(err: unknown): string | undefined {
  const candidate = err as { stderr?: unknown };
  if (Buffer.isBuffer(candidate.stderr)) {
    const text = candidate.stderr.toString("utf8").trim();
    return text === "" ? undefined : text;
  }
  if (typeof candidate.stderr === "string") {
    const text = candidate.stderr.trim();
    return text === "" ? undefined : text;
  }
  return undefined;
}

function gitFailureReason(step: string, err: unknown): StepFailure {
  const stderr = stderrText(err);
  const detail = (stderr ?? errorText(err)).toLowerCase();
  const permission = detail.includes("permission") || detail.includes("authentication") || detail.includes("authorization") || detail.includes("403");
  const nonFastForward = detail.includes("non-fast-forward") || detail.includes("fetch first") || detail.includes("stale info") || detail.includes("rejected");
  return {
    step,
    message: permission ? "permission denied" : nonFastForward ? "non-fast-forward push rejected" : errorText(err),
    ...(stderr !== undefined ? { stderr } : {}),
    transient: true,
  };
}

function runGitStep(cwd: string, step: string, args: readonly string[]): StepFailure | undefined {
  try {
    execFileSync("git", [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    return undefined;
  } catch (err) {
    return gitFailureReason(step, err);
  }
}

function archiveGitTree(gitCwd: string, treeish: string, targetDir: string, pathspec?: string): boolean {
  const tar = join(targetDir, "tree.tar");
  try {
    execFileSync("git", ["archive", "--format=tar", `--output=${tar}`, treeish, ...(pathspec !== undefined ? [pathspec] : [])], {
      cwd: gitCwd,
      stdio: "ignore",
    });
    execFileSync("tar", ["-xf", tar, "-C", targetDir], { stdio: "ignore" });
    rmSync(tar, { force: true });
    return true;
  } catch {
    return false;
  }
}

function hasAcMap(projectCwd: string, storyId: string): boolean {
  return acMapCandidates(projectCwd, storyId).some((p) => existsSync(p));
}

export function resolvePrEvidence(projectCwd: string, headRef: string, body: string): EvidenceResolution {
  const trailer = parseRollEvidenceTrailer(body);
  const tmp = mkdtempSync(join(tmpdir(), "roll-pr-evidence-"));
  try {
    if (trailer !== null) {
      const rollDir = join(projectCwd, ".roll");
      if (!existsSync(rollDir)) return { ok: false, missing: [".roll git repo missing for Roll-Evidence trailer"] };
      const acPath = trailer.acMapPath.replace(/^\.roll\//, "");
      if (!gitSucceeds(rollDir, ["cat-file", "-e", `${trailer.sha}:${acPath}`])) return { ok: false, missing: [acPath] };
      const rollTarget = join(tmp, ".roll");
      mkdirSync(rollTarget, { recursive: true });
      if (!archiveGitTree(rollDir, trailer.sha, rollTarget)) return { ok: false, missing: [`roll-meta@${trailer.sha}`] };
      const missing = evidencePathsUnresolved(tmp, trailer.storyId);
      return { ok: missing.length === 0, missing };
    }

    const storyId = firstStoryId(`${body}\n${headRef}`);
    if (storyId === undefined) return { ok: true, missing: [] };
    if (headRef.trim() !== "") {
      const branchTarget = join(tmp, "branch");
      mkdirSync(branchTarget, { recursive: true });
      if (archiveGitTree(projectCwd, headRef, branchTarget) || archiveGitTree(projectCwd, `origin/${headRef}`, branchTarget)) {
        if (hasAcMap(branchTarget, storyId)) {
          const missing = evidencePathsUnresolved(branchTarget, storyId);
          return { ok: missing.length === 0, missing };
        }
      }
    }
    if (hasAcMap(projectCwd, storyId)) {
      const missing = evidencePathsUnresolved(projectCwd, storyId);
      return { ok: missing.length === 0, missing };
    }
    return {
      ok: false,
      missing: [
        `Roll-Evidence trailer missing and local roll-meta evidence missing for ${storyId}; remediation: run roll attest ${storyId}, commit/push roll-meta, and republish with a Roll-Evidence trailer`,
      ],
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The raw `gh pr view --json reviews,mergeStateStatus,statusCheckRollup,body,labels` shape. */
interface PrViewRaw {
  reviews?: Array<{ authorAssociation?: string; state?: string }>;
  mergeStateStatus?: string;
  statusCheckRollup?: Array<{ conclusion?: string | null }>;
  body?: string;
  labels?: Array<{ name?: string }>;
  isDraft?: boolean;
  createdAt?: string;
}

function prAgeMinutes(createdAt: string | undefined, nowMs = Date.now()): number | undefined {
  if (createdAt === undefined || createdAt.trim() === "") return undefined;
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return undefined;
  return Math.max(0, Math.floor((nowMs - createdMs) / 60000));
}

/**
 * Reduce one `pr view` payload to {bot, ciState, mergeable} — mirrors the jq at
 * bin/roll 11996-12007: bot review = last BOT/APP review's state; mergeable =
 * `mergeStateStatus`; ciState = {@link reduceCiRollup} over the rollup.
 */
export function reducePrView(raw: PrViewRaw): PrViewFacts {
  const reviews = raw.reviews ?? [];
  const botReviews = reviews.filter(
    (r) => r.authorAssociation === "BOT" || r.authorAssociation === "APP",
  );
  const lastBot = botReviews.length > 0 ? botReviews[botReviews.length - 1] : undefined;
  const rollup = (raw.statusCheckRollup ?? []).map((c) => c.conclusion ?? null);
  return {
    bot: lastBot?.state ?? "",
    ciState: reduceCiRollup(rollup),
    mergeable: raw.mergeStateStatus ?? "",
    manualMerge:
      (raw.body ?? "").includes("[roll:manual-merge]") ||
      (raw.labels ?? []).some((label) => label.name === "manual-merge" || label.name === "roll:manual-merge"),
    ...(raw.isDraft === true ? { isDraft: true } : {}),
  };
}

// ─── injectable deps (tests fake gh/git + fs + clock) ────────────────────────

export interface PrInboxDeps {
  /** `_gh_available` — gh binary on PATH. */
  ghAvailable: () => Promise<boolean>;
  /** `_gh_resolve` — owner/repo slug, or undefined (→ idle gh_unavailable). */
  resolveSlug: () => Promise<string | undefined>;
  /** `gh -R <slug> pr list --state open --json number,headRefName,author,title`. */
  listOpenPrs: (slug: string) => Promise<{ code: number; stdout: string; stderr?: string }>;
  /** `gh -R <slug> pr view <num> --json …` → reduced facts, or undefined on failure (skip). */
  viewPr: (slug: string, num: string, headRef: string) => Promise<PrViewFacts | undefined>;
  /** `gh -R <slug> pr ready <num>` → true on success. */
  ready: (slug: string, num: string) => Promise<boolean>;
  /** `gh -R <slug> pr merge <num> --squash --delete-branch` → true on success. */
  merge: (slug: string, num: string) => Promise<boolean>;
  /**
   * FIX-367 — durably record merge truth the instant the PR-lane merges. The
   * PR-lane merges a cycle PR asynchronously (5-min cadence); before this, NOTHING
   * flipped the card Done at merge time, so a delivered card sat 📋 Todo/🔨 in the
   * window between publish and the NEXT `loop run-once` — long enough to be
   * re-picked (the FIX-364 re-pick storm). Credit the merged cycle's runs row to
   * `merged`/`delivered` NOW so the picker's `hasMergedDelivery` guard excludes the
   * card immediately and durably (the runs ledger survives any backlog.md
   * clobber). Best-effort: a failure must never break the merge or the tick.
   */
  onMerged?: (slug: string, num: string, headRef: string) => Promise<void>;
  /** ci_red → hand to the (bash) heal helper; background, best-effort. */
  heal: (num: string, headRef: string, slug: string) => Promise<void>;
  /** FIX-1217: CI event blackhole → trigger workflow_dispatch for this branch. */
  dispatchCi: (num: string, headRef: string, slug: string) => Promise<boolean>;
  /** 24h rebase circuit (pure verdict + state persistence + trip ALERT). */
  rebaseCircuitAllowed: (num: string) => boolean;
  /** Bridged git rebase dance → re-checked facts (or undefined on any failure). */
  rebaseStale: (num: string, headRef: string, slug: string) => Promise<PrViewFacts | undefined>;
  /** evidence_unresolvable → one bounded self-repair attempt, then re-check facts. */
  repairEvidence?: (num: string, headRef: string, slug: string, missing: readonly string[]) => Promise<PrViewFacts | undefined>;
  /** Append one ALERT line. */
  alert: (line: string) => void;
  /** Append a pr-tick.jsonl row (with rotation). */
  writeTick: (tick: PrTick) => void;
  info: (line: string) => void;
  warn: (line: string) => void;
  /**
   * FIX-1214: drain the pending-pr-create queue after walking open PRs.
   * Defaults to the real gh-backed drain; tests inject a fake.
   */
  drainPendingPrCreates?: (slug: string, openHeadRefs: ReadonlySet<string>) => Promise<void>;
  /**
   * US-LOOP-097: after the drain, GC stranded `loop/cycle-*` remote branches
   * (narrow — see {@link selectDeletableRemoteBranches}). Defaults to the real
   * git/gh-backed sweep; tests inject a fake.
   */
  sweepRemoteBranches?: (slug: string, openHeadRefs: ReadonlySet<string>) => Promise<void>;
}

// ─── the walk (decisions from pr-loop.ts; effects via deps) ───────────────────

/**
 * Walk the open PRs and route each — the TS port of `_loop_pr_inbox`. Returns
 * the tick it wrote, so callers (and tests) can assert the terminal outcome.
 */
export async function runPrInbox(deps: PrInboxDeps): Promise<PrTick> {
  if (!(await deps.ghAvailable())) return emit(deps, prIdleTick("gh_unavailable"));
  const slug = await deps.resolveSlug();
  if (slug === undefined || slug === "") return emit(deps, prIdleTick("gh_unavailable"));

  const list = await deps.listOpenPrs(slug);
  const stdout = (list.stdout ?? "").trim();
  let openCount = 0;
  let openPrs: Array<{ number?: number; headRefName?: string }> = [];
  if (list.code === 0 && stdout !== "" && stdout !== "[]") {
    try {
      const arr = JSON.parse(stdout) as unknown;
      if (Array.isArray(arr)) {
        openCount = arr.length;
        openPrs = arr as Array<{ number?: number; headRefName?: string }>;
      }
    } catch {
      openCount = 0;
    }
  } else if (list.code === 0 && stdout === "[]") {
    cleanupEvidenceRepairMarkers(new Set());
  }
  if (openPrs.length > 0) {
    cleanupEvidenceRepairMarkers(new Set(openPrs.map((pr) => String(pr.number ?? "")).filter((num) => num !== "")));
  }
  const gate = prInboxGate({
    ghAvailable: true,
    listOk: list.code === 0,
    listStdout: stdout,
    openCount,
    ...(list.stderr !== undefined ? { listStderr: list.stderr } : {}),
  });
  if (gate !== undefined) return emit(deps, gate);

  const openHeadRefs = new Set(openPrs.map((pr) => pr.headRefName ?? "").filter((ref) => ref !== ""));

  for (const pr of openPrs) {
    const num = String(pr.number ?? "");
    if (num === "") continue;
    const headRef = pr.headRefName ?? "";

    const facts = await deps.viewPr(slug, num, headRef);
    if (facts === undefined) continue; // bash: view failure → i++; continue.

    const promote = promoteDraftAction({
      isDraft: facts.isDraft === true,
      manualMerge: facts.manualMerge === true,
      botReview: facts.bot,
      ciState: facts.ciState,
      mergeable: facts.mergeable,
      evidenceResolvable: facts.evidenceResolvable,
    });
    if (promote.kind === "promote_and_merge") {
      if (await deps.ready(slug, num)) await doMerge(deps, slug, num, headRef);
      else deps.warn(`PR #${num}: ready failed — left open`);
      continue;
    }
    if (promote.reason === "evidence_unresolvable") {
      const repaired = await attemptEvidenceRepair(deps, slug, num, headRef, facts.evidenceMissing);
      if (repaired !== undefined) {
        const repairedPromote = promoteDraftAction({
          isDraft: repaired.isDraft === true,
          manualMerge: repaired.manualMerge === true,
          botReview: repaired.bot,
          ciState: repaired.ciState,
          mergeable: repaired.mergeable,
          evidenceResolvable: repaired.evidenceResolvable,
        });
        if (repairedPromote.kind === "promote_and_merge") {
          if (await deps.ready(slug, num)) await doMerge(deps, slug, num, headRef);
          else deps.warn(`PR #${num}: ready failed — left open`);
        } else deps.alert(evidenceBlockedAlert(num, repaired.evidenceMissing));
      }
      continue;
    }

    const action = selectPrAction(facts);
    switch (action.kind) {
      case "merge":
        await doMerge(deps, slug, num, headRef);
        break;
      case "alert":
        deps.alert(`PR #${num}: bot review CHANGES_REQUESTED — loop PR rejected by GHA reviewer`);
        break;
      case "heal":
        await deps.heal(num, headRef, slug);
        break;
      case "dispatch_ci":
        if (await deps.dispatchCi(num, headRef, slug)) {
          deps.alert(ciBlackholeAlert(Number(num), headRef, facts.prAgeMinutes ?? 0));
        } else {
          deps.alert(`PR #${num} (${headRef}) — CI event blackhole detected, but workflow_dispatch failed`);
        }
        break;
      case "rebase": {
        if (!deps.rebaseCircuitAllowed(num)) break; // tripped → ALERT written, skip.
        const rechecked = await deps.rebaseStale(num, headRef, slug);
        if (rechecked !== undefined) {
          const re = rebaseRecheckAction(rechecked.ciState, rechecked.mergeable, rechecked.manualMerge === true, rechecked.evidenceResolvable !== false);
          if (re.kind === "merge") await doMerge(deps, slug, num, headRef);
          else if (re.kind === "skip" && re.reason === "evidence_unresolvable") {
            const repaired = await attemptEvidenceRepair(deps, slug, num, headRef, rechecked.evidenceMissing);
            if (repaired !== undefined) {
              const repairedRecheck = rebaseRecheckAction(repaired.ciState, repaired.mergeable, repaired.manualMerge === true, repaired.evidenceResolvable !== false);
              if (repairedRecheck.kind === "merge") await doMerge(deps, slug, num, headRef);
              else deps.alert(evidenceBlockedAlert(num, repaired.evidenceMissing));
            }
          }
        }
        break;
      }
      case "skip":
        if (action.reason === "evidence_unresolvable") {
          const repaired = await attemptEvidenceRepair(deps, slug, num, headRef, facts.evidenceMissing);
          if (repaired !== undefined) {
            const repairedAction = selectPrAction(repaired);
            if (repairedAction.kind === "merge") await doMerge(deps, slug, num, headRef);
            else deps.alert(evidenceBlockedAlert(num, repaired.evidenceMissing));
          }
        }
        break;
    }
  }

  // FIX-1214: retry PRs that were deferred because of a transient GitHub API
  // fault during the cycle's publish step. Skip branches that already have an
  // open PR (the queue entry is stale and gets cleaned up inside the drain).
  try {
    const drain = deps.drainPendingPrCreates ?? defaultDrainPendingPrCreates;
    await drain(slug, openHeadRefs);
  } catch {
    /* best-effort: a queue drain failure must not break the regular inbox walk */
  }

  // US-LOOP-097: AFTER the drain (so a just-drained branch is now an open PR /
  // out of the pending queue), sweep stranded loop/cycle-* remote branches.
  try {
    const sweep = deps.sweepRemoteBranches ?? defaultSweepRemoteBranches;
    await sweep(slug, openHeadRefs);
  } catch {
    /* best-effort: remote GC must never break the inbox walk */
  }

  return emit(deps, prActedTick());
}

/** US-LOOP-097 default remote GC: gather the guard sets and delete only the
 *  loop/cycle branches that clear every one (narrow). */
async function defaultSweepRemoteBranches(slug: string, openHeadRefs: ReadonlySet<string>): Promise<void> {
  const rt = runtimeDir();
  // Candidate remote branches (ls-remote → refs/heads short names).
  let remoteBranches: string[] = [];
  try {
    const out = execFileSync("git", ["ls-remote", "--heads", "origin"], { encoding: "utf8" });
    remoteBranches = out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "")
      .map((l) => l.replace(/^\S+\s+refs\/heads\//, ""));
  } catch {
    return; // no remote / offline → nothing to do
  }
  // Pending-pr-create queue (FIX-1214) — must not delete.
  const pendingBranches = new Set<string>();
  try {
    for (const e of readPendingPrCreates(rt)) pendingBranches.add(e.branch);
  } catch {
    /* best-effort */
  }
  // Runs-ledger branches still parked on the remote (orphan/local/published/built)
  // — pushed but not confirmed merged; keep.
  const PROTECT = new Set(["orphan", "local", "published", "built", "pending_merge"]);
  const activeRunBranches = new Set<string>();
  try {
    for (const row of readRunsRows(join(rt, "runs.jsonl"))) {
      const cid = typeof row["cycle_id"] === "string" ? row["cycle_id"] : "";
      const status = typeof row.status === "string" ? row.status : "";
      if (cid !== "" && PROTECT.has(status)) activeRunBranches.add(`loop/cycle-${cid}`);
    }
  } catch {
    /* best-effort */
  }
  const graceParsed = parseInt(process.env["ROLL_REMOTE_GC_GRACE_MIN"] ?? "", 10);
  const graceMin = Number.isFinite(graceParsed) && graceParsed > 0 ? graceParsed : DEFAULT_REMOTE_GC_GRACE_MIN;
  const deletable = selectDeletableRemoteBranches({
    remoteBranches,
    openPrHeads: openHeadRefs,
    pendingBranches,
    activeRunBranches,
    graceMs: graceMin * 60_000,
    nowMs: Date.now(),
  });
  if (deletable.length === 0) return;
  for (const b of deletable) {
    try {
      execFileSync("git", ["push", "origin", "--delete", b], { stdio: "ignore" });
    } catch {
      /* a protected/already-gone branch is fine to skip */
    }
  }
  appendAlert(`US-LOOP-097: remote GC deleted ${deletable.length} stranded loop/cycle branch(es) on ${slug}`);
}

/** FIX-1214: default production drain for the pending-pr-create queue. */
function defaultDrainPendingPrCreates(slug: string, openHeadRefs: ReadonlySet<string>): Promise<void> {
  return openPendingPrCreates(
    {
      gh: (args) => gh(args),
      nowMs: () => Date.now(),
      runtimeDir: runtimeDir(),
      projectCwd: process.cwd(),
      alert: appendAlert,
      info: (line) => process.stdout.write(`${pal().yellow}[roll]${pal().nc} ${line}\n`),
    },
    slug,
    openHeadRefs,
  );
}

async function attemptEvidenceRepair(
  deps: PrInboxDeps,
  slug: string,
  num: string,
  headRef: string,
  missing: readonly string[] | undefined,
): Promise<PrViewFacts | undefined> {
  const missingList = missing ?? [];
  if (deps.repairEvidence === undefined) {
    deps.alert(evidenceBlockedAlert(num, missingList));
    return undefined;
  }
  const repaired = await deps.repairEvidence(num, headRef, slug, missingList);
  if (repaired !== undefined && repaired.evidenceResolvable !== false) return repaired;
  deps.alert(evidenceRepairFailedAlert(num, repaired?.evidenceMissing ?? missingList));
  return undefined;
}

function evidenceBlockedAlert(num: string, missing: readonly string[] | undefined): string {
  const suffix = missing !== undefined && missing.length > 0 ? `: ${missing.join(", ")}` : "";
  return `PR #${num}: evidence_unresolvable — merge blocked until Roll-Evidence paths resolve${suffix}`;
}

function evidenceRepairFailedAlert(num: string, missing: readonly string[] | undefined): string {
  const suffix = missing !== undefined && missing.length > 0 ? `: ${missing.join(", ")}` : "";
  return `PR #${num}: evidence_repair_failed after evidence_unresolvable self-repair attempt${suffix}`;
}

function emit(deps: PrInboxDeps, tick: PrTick): PrTick {
  deps.writeTick(tick);
  return tick;
}

async function doMerge(deps: PrInboxDeps, slug: string, num: string, headRef: string): Promise<void> {
  if (await deps.merge(slug, num)) {
    deps.info(`PR #${num}: CI green — merged`);
    // FIX-367: durably record the merge so the just-delivered card cannot be
    // re-picked in the window before the next `loop run-once` backfill runs.
    if (deps.onMerged !== undefined) {
      try {
        await deps.onMerged(slug, num, headRef);
      } catch {
        /* recording merge truth is best-effort — never break a successful merge */
      }
    }
  } else deps.warn(`PR #${num}: merge failed — left open`);
}

// ─── real deps (the production wiring) ────────────────────────────────────────

/** Runtime control-plane dir — `<project>/.roll/loop`, env-overridable (tests). */
function runtimeDir(): string {
  const override = (process.env["ROLL_PROJECT_RUNTIME_DIR"] ?? "").trim();
  if (override !== "") return override;
  return join(process.cwd(), ".roll", "loop");
}

/** `_LOOP_PROJ_SLUG` for ALERT/state filenames — ROLL_MAIN_SLUG override, else basename. */
function projSlug(): string {
  const override = (process.env["ROLL_MAIN_SLUG"] ?? "").trim();
  if (override !== "") return override;
  return process.cwd().split("/").filter(Boolean).pop() ?? "default";
}

function alertPath(): string {
  return join(runtimeDir(), `ALERT-${projSlug()}.md`);
}
function statePath(): string {
  return join(runtimeDir(), `state-${projSlug()}.yaml`);
}
function tickPath(): string {
  return join(runtimeDir(), "pr-tick.jsonl");
}

function pal(): { yellow: string; nc: string } {
  return (process.env["NO_COLOR"] ?? "") !== ""
    ? { yellow: "", nc: "" }
    : { yellow: "\x1b[0;33m", nc: "\x1b[0m" };
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Append a pr-tick row, then rotate to the last 500 lines (bin/roll 8033-8041). */
function writeTickFile(tick: PrTick): void {
  const file = tickPath();
  mkdirSync(dirname(file), { recursive: true });
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  appendFileSync(file, `${JSON.stringify({ ts, ...tick })}\n`);
  try {
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l !== "");
    if (lines.length > 500) writeFileSync(file, `${lines.slice(-500).join("\n")}\n`);
  } catch {
    /* rotation is best-effort */
  }
  // FIX-233 AC1: a dead loop must scream — 345 silent gh_error ticks over four
  // days (proxy poison) is the incident this closes. Streak alert + recovery
  // note, marker-deduped so one streak alerts once.
  try {
    checkDeadTickStreak(file, appendAlert);
  } catch {
    /* alerting must never break the tick */
  }
}

/** FIX-233: marker path — present ⇔ the current abnormal streak was alerted. */
function deadTickMarkerPath(): string {
  return join(runtimeDir(), ".pr-deadtick-alerted");
}

/** Read the tick tail, fold through the pure verdict, act (exported for tests). */
export function checkDeadTickStreak(file: string, alert: (line: string) => void, markerPath = deadTickMarkerPath()): void {
  let rows: Array<{ ts?: string; note?: string }> = [];
  try {
    rows = readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as { ts?: string; note?: string });
  } catch {
    return;
  }
  const notes = rows.map((r) => r.note ?? "");
  const verdict = deadTickVerdict({ recentNotes: notes, alreadyAlerted: existsSync(markerPath) });
  if (verdict === "alert") {
    const streak = [...notes].reverse().findIndex((n) => !DEAD_TICK_NOTES.has(n));
    const count = streak === -1 ? notes.length : streak;
    const first = rows[rows.length - count]?.ts ?? "?";
    const last = rows[rows.length - 1]?.ts ?? "?";
    alert(`pr-loop dead ticks: ${count} consecutive abnormal ticks (${first} → ${last}) — check gh/network/launchd env (FIX-233)`);
    try {
      writeFileSync(markerPath, `${last}\n`);
    } catch {
      /* marker is best-effort */
    }
  } else if (verdict === "recovered") {
    alert("pr-loop recovered: healthy tick after an alerted dead-tick streak (FIX-233)");
    try {
      rmSync(markerPath, { force: true });
    } catch {
      /* best-effort */
    }
  }
}

function appendAlert(line: string): void {
  const file = alertPath();
  mkdirSync(dirname(file), { recursive: true });
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  appendFileSync(file, `[${ts}] ${line}\n`);
}

/**
 * The 24h rebase circuit breaker — pure {@link rebaseCircuitVerdict} over the
 * timestamps parsed from the per-slug state file, persisting the pruned list
 * (and, when allowed, the new attempt). On a trip: write the ALERT block
 * (bin/roll 11816-11826) and return false.
 */
function rebaseCircuitAllowed(num: string): boolean {
  const state = statePath();
  let body = "";
  try {
    body = readFileSync(state, "utf8");
  } catch {
    /* no state yet */
  }
  const verdict = rebaseCircuitVerdict(parseRebaseAttempts(body, num), nowSec());
  writeRebaseAttempts(state, num, verdict.freshTimestamps);
  if (!verdict.allowed) {
    const file = alertPath();
    mkdirSync(dirname(file), { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    // bash `cat > "${_LOOP_ALERT}"` (bin/roll 11816) — OVERWRITE, not append.
    writeFileSync(
      file,
      [
        `# ALERT — PR rebase circuit breaker tripped`,
        ``,
        `**Time**: ${stamp}`,
        `**PR**: #${num}`,
        `**Reason**: PR #${num} rebased ${verdict.windowCount}× within 24h with no CI progress`,
        ``,
        `**Action required**:`,
        `- Check PR CI logs and workflow files for breakage`,
        `- Resolve manually, then: \`roll loop now\``,
        ``,
      ].join("\n"),
    );
    return false;
  }
  return true;
}

/**
 * Pure upsert of `pr_state.<pr>.attempts_at = "<value>"` into a loop-state YAML
 * body — mirrors the awk at bin/roll 11838-11871. Returns the new body (always
 * exactly one trailing newline). The single trailing-newline artifact of
 * `split("\n")` is stripped first so repeated upserts never accrete blank lines.
 */
export function upsertRebaseAttempts(stateBody: string, pr: string, value: string): string {
  const prKey = `"${pr}":`;
  const lines = stateBody.replace(/\n$/, "").split("\n").filter((l, i, a) => !(a.length === 1 && l === ""));
  const out: string[] = [];
  let inPr = false;
  let inTarget = false;
  let written = false;
  for (const line of lines) {
    if (/^pr_state:/.test(line)) {
      inPr = true;
      out.push(line);
      continue;
    }
    if (inPr && line.includes(prKey)) {
      inTarget = true;
      out.push(`  ${prKey}`);
      out.push(`    attempts_at: "${value}"`);
      written = true;
      continue;
    }
    if (inTarget && /attempts_at:/.test(line)) continue; // drop old value
    if (inTarget && /^[^\s]/.test(line)) inTarget = false;
    out.push(line);
  }
  if (!inPr) {
    out.push("pr_state:");
    out.push(`  ${prKey}`);
    out.push(`    attempts_at: "${value}"`);
  } else if (!written) {
    out.push(`  ${prKey}`);
    out.push(`    attempts_at: "${value}"`);
  }
  return `${out.join("\n")}\n`;
}

/** Persist `pr_state.<pr>.attempts_at` to the state file (via {@link upsertRebaseAttempts}). */
function writeRebaseAttempts(state: string, pr: string, timestamps: readonly number[]): void {
  mkdirSync(dirname(state), { recursive: true });
  let body = "";
  try {
    body = readFileSync(state, "utf8");
  } catch {
    /* fresh */
  }
  writeFileSync(state, upsertRebaseAttempts(body, pr, renderRebaseAttempts(timestamps)));
}

function evidenceRepairMarkerPath(num: string): string {
  return join(runtimeDir(), `.pr-evidence-repair-${num}.attempted`);
}

const EVIDENCE_REPAIR_MARKER_TTL_MS = 24 * 60 * 60 * 1000;

function evidenceRepairMarkerNumber(name: string): string | undefined {
  return /^\.pr-evidence-repair-(\d+)\.attempted$/.exec(name)?.[1];
}

export function evidenceRepairMarkerIsFresh(marker: string, nowMs = Date.now()): boolean {
  try {
    return nowMs - statSync(marker).mtimeMs < EVIDENCE_REPAIR_MARKER_TTL_MS;
  } catch {
    return false;
  }
}

export function cleanupEvidenceRepairMarkers(openPrNumbers: ReadonlySet<string>, nowMs = Date.now()): void {
  const dir = runtimeDir();
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const num = evidenceRepairMarkerNumber(name);
    if (num === undefined) continue;
    const marker = join(dir, name);
    if (!openPrNumbers.has(num) || !evidenceRepairMarkerIsFresh(marker, nowMs)) rmSync(marker, { force: true });
  }
}

function writeEvidenceRepairMarker(num: string, missing: readonly string[]): void {
  const marker = evidenceRepairMarkerPath(num);
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, `${new Date().toISOString()} ${missing.join(", ")}\n`);
}

function appendPrEvidenceRepairEvent(
  type: "pr:evidence_repaired" | "pr:evidence_repair_failed",
  num: string,
  detail: string,
  extra: Record<string, unknown> = {},
): void {
  try {
    const file = join(runtimeDir(), "events.ndjson");
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ type, prNumber: Number(num), detail, ts: Date.now(), ...extra })}\n`);
  } catch {
    /* observability must not break the PR tick */
  }
}

interface RepairEvidenceCommandResult {
  verdict: "repaired" | "already_repaired" | "not_reparable" | "failed";
  storyId?: string;
  detail: string;
  failure?: StepFailure;
}

function runRepairEvidenceCommand(num: string): RepairEvidenceCommandResult {
  const entry = process.argv[1] ?? "";
  const useNode = entry.endsWith(".js") || entry.endsWith(".mjs");
  try {
    const out = execFileSync(useNode ? process.execPath : "roll", [
      ...(useNode ? [entry] : []),
      "supervisor",
      "repair-evidence",
      num,
      "--json",
    ], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const parsed = JSON.parse(out) as { storyId?: unknown; verdict?: unknown; reason?: unknown };
    const verdict = typeof parsed.verdict === "string" ? parsed.verdict : "";
    const detail = typeof parsed.reason === "string" && parsed.reason !== "" ? parsed.reason : verdict;
    if (verdict === "repaired" || verdict === "already_repaired") {
      return {
        verdict,
        ...(typeof parsed.storyId === "string" && parsed.storyId !== "" ? { storyId: parsed.storyId } : {}),
        detail,
      };
    }
    return { verdict: "not_reparable", detail: detail === "" ? "supervisor repair-evidence returned no repaired verdict" : detail };
  } catch (err) {
    return { verdict: "failed", detail: errorText(err), failure: { step: "supervisor repair-evidence", message: errorText(err), ...(stderrText(err) !== undefined ? { stderr: stderrText(err) } : {}), transient: true } };
  }
}

function copyIfExists(src: string, dst: string): void {
  if (!existsSync(src)) return;
  cpSync(src, dst, { recursive: true, force: true });
}

export interface EvidenceRepairAttachResult {
  ok: boolean;
  committed: boolean;
  failure?: StepFailure;
}

function relPathInsideRepo(cwd: string, path: string): string | undefined {
  const rel = relative(cwd, path);
  if (rel === "" || rel.startsWith("..")) return undefined;
  return rel;
}

function porcelainPath(line: string): string {
  const raw = line.slice(3).trim();
  const target = raw.includes(" -> ") ? raw.split(" -> ").at(-1) ?? raw : raw;
  return target.replace(/^"|"$/g, "");
}

function dirtyPathsOutside(cwd: string, allowedRelRoot: string): string[] | StepFailure {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return out
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map(porcelainPath)
      .filter((path) => path !== allowedRelRoot && !path.startsWith(`${allowedRelRoot}/`));
  } catch (err) {
    return gitFailureReason("preflight status", err);
  }
}

export function attachEvidenceRepairToPrBranch(storyId: string, headRef: string): EvidenceRepairAttachResult {
  if (storyId === "" || headRef === "") return { ok: false, committed: false, failure: { step: "preflight", message: "missing storyId or headRef", transient: false } };
  const cwd = process.cwd();
  const acMap = acMapCandidates(cwd, storyId).find((p) => existsSync(p));
  if (acMap === undefined) return { ok: false, committed: false, failure: { step: "preflight", message: `ac-map.json missing for ${storyId}`, transient: false } };
  const cardRoot = dirname(acMap);
  const relCard = relPathInsideRepo(cwd, cardRoot);
  if (relCard === undefined) return { ok: false, committed: false, failure: { step: "preflight", message: "evidence path escapes repo", transient: false } };
  const temp = mkdtempSync(join(tmpdir(), "roll-pr-evidence-repair-"));
  const saved = join(temp, "card");
  const worktree = join(temp, "worktree");
  mkdirSync(saved, { recursive: true });
  for (const entry of ["ac-map.json", "evidence", "latest", "screenshots"]) copyIfExists(join(cardRoot, entry), join(saved, entry));
  let committed = false;
  try {
    const outsideDirty = dirtyPathsOutside(cwd, relCard);
    if (!Array.isArray(outsideDirty)) return { ok: false, committed: false, failure: outsideDirty };
    if (outsideDirty.length > 0) {
      return { ok: false, committed: false, failure: { step: "preflight clean worktree", message: "refusing evidence repair with unrelated dirty worktree paths", transient: true } };
    }
    let failure = runGitStep(cwd, "fetch origin headRef", ["fetch", "origin", headRef]);
    if (failure !== undefined) return { ok: false, committed: false, failure };
    failure = runGitStep(cwd, "worktree add repair branch", ["worktree", "add", "-B", headRef, worktree, "FETCH_HEAD"]);
    if (failure !== undefined) return { ok: false, committed: false, failure };
    const wtCardRoot = join(worktree, relCard);
    mkdirSync(wtCardRoot, { recursive: true });
    for (const entry of ["ac-map.json", "evidence", "latest", "screenshots"]) copyIfExists(join(saved, entry), join(wtCardRoot, entry));
    failure = runGitStep(worktree, "git add evidence", ["add", "-A", "-f", "--", relCard]);
    if (failure !== undefined) return { ok: false, committed: false, failure };
    const dirty = execFileSync("git", ["status", "--porcelain", "--", relCard], { cwd: worktree, encoding: "utf8" }).trim();
    if (dirty !== "") {
      failure = runGitStep(worktree, "commit evidence", ["commit", "-m", `chore: attach acceptance evidence for ${storyId}`]);
      if (failure !== undefined) return { ok: false, committed: false, failure };
      committed = true;
      failure = runGitStep(worktree, "push evidence", ["push", "origin", `HEAD:${headRef}`]);
      if (failure !== undefined) return { ok: false, committed, failure };
    }
    failure = runGitStep(cwd, "fetch pushed headRef", ["fetch", "origin", headRef]);
    if (failure !== undefined) return { ok: false, committed, failure };
    return { ok: true, committed };
  } finally {
    runGitStep(cwd, "worktree remove", ["worktree", "remove", "--force", worktree]);
    rmSync(temp, { recursive: true, force: true });
  }
}

async function repairEvidenceOnce(num: string, headRef: string, slug: string, missing: readonly string[]): Promise<PrViewFacts | undefined> {
  const marker = evidenceRepairMarkerPath(num);
  if (evidenceRepairMarkerIsFresh(marker)) return undefined;
  rmSync(marker, { force: true });
  try {
    const repaired = runRepairEvidenceCommand(num);
    if (repaired.verdict === "failed") {
      appendPrEvidenceRepairEvent("pr:evidence_repair_failed", num, repaired.detail, { step: repaired.failure?.step, transient: true, ...(repaired.failure?.stderr !== undefined ? { stderr: repaired.failure.stderr } : {}) });
      return undefined;
    }
    if (repaired.verdict === "not_reparable") {
      writeEvidenceRepairMarker(num, missing);
      appendPrEvidenceRepairEvent("pr:evidence_repair_failed", num, repaired.detail, { step: "supervisor repair-evidence", transient: false });
      return undefined;
    }
    if (repaired.storyId !== undefined) {
      const attached = attachEvidenceRepairToPrBranch(repaired.storyId, headRef);
      if (!attached.ok) {
        const failure = attached.failure;
        appendPrEvidenceRepairEvent("pr:evidence_repair_failed", num, failure?.message ?? "attach evidence failed", {
          step: failure?.step ?? "attach evidence",
          transient: failure?.transient ?? true,
          ...(failure?.stderr !== undefined ? { stderr: failure.stderr } : {}),
        });
        if (failure?.transient === false) writeEvidenceRepairMarker(num, missing);
        return undefined;
      }
    }
    const r = await gh(["-R", slug, "pr", "view", num, "--json", "reviews,mergeStateStatus,statusCheckRollup,body,labels,isDraft"]);
    if (r.code !== 0 || r.stdout.trim() === "") {
      appendPrEvidenceRepairEvent("pr:evidence_repair_failed", num, r.stderr.trim() || "gh pr view failed after repair", { step: "gh pr view", transient: true, ...(r.stderr.trim() !== "" ? { stderr: r.stderr.trim() } : {}) });
      return undefined;
    }
    const raw = JSON.parse(r.stdout) as PrViewRaw;
    const facts = reducePrView(raw);
    const evidence = resolvePrEvidence(process.cwd(), headRef, raw.body ?? "");
    if (!evidence.ok) writeEvidenceRepairMarker(num, evidence.missing);
    appendPrEvidenceRepairEvent(evidence.ok ? "pr:evidence_repaired" : "pr:evidence_repair_failed", num, evidence.missing.join(", "), {
      step: "verify repaired evidence",
      ...(evidence.ok ? {} : { transient: false }),
    });
    return { ...facts, evidenceResolvable: evidence.ok, evidenceMissing: evidence.missing };
  } catch (err) {
    appendPrEvidenceRepairEvent("pr:evidence_repair_failed", num, missing.join(", "), { step: "repairEvidenceOnce", transient: true, message: errorText(err), ...(stderrText(err) !== undefined ? { stderr: stderrText(err) } : {}) });
    return undefined;
  }
}

function realDeps(): PrInboxDeps {
  const { yellow, nc } = pal();
  return {
    ghAvailable: () => ghAvailable(),
    resolveSlug: async () => {
      if (!(await ghAvailable())) return undefined;
      const url = await remoteUrl(process.cwd());
      return ghRepoSlug(url);
    },
    listOpenPrs: async (slug) => {
      const r = await gh([
        "-R", slug, "pr", "list", "--state", "open",
        "--json", "number,headRefName,author,title",
      ]);
      return { code: r.code, stdout: r.stdout, stderr: r.stderr };
    },
    viewPr: async (slug, num, headRef) => {
      const r = await gh([
        "-R", slug, "pr", "view", num,
        "--json", "reviews,mergeStateStatus,statusCheckRollup,body,labels,isDraft,createdAt",
      ]);
      if (r.code !== 0 || r.stdout.trim() === "") return undefined;
      try {
        const raw = JSON.parse(r.stdout) as PrViewRaw;
        const facts = reducePrView(raw);
        const evidence = resolvePrEvidence(process.cwd(), headRef, raw.body ?? "");
        const headCheckRunCount = await prHeadCheckRunCount(slug, Number(num));
        return {
          ...facts,
          evidenceResolvable: evidence.ok,
          evidenceMissing: evidence.missing,
          prAgeMinutes: prAgeMinutes(raw.createdAt),
          headCheckRunCount,
        };
      } catch {
        return undefined;
      }
    },
    ready: async (slug, num) => (await prReady(slug, num)).code === 0,
    merge: async (slug, num) => (await prMerge(slug, num, "plain")).code === 0,
    onMerged: async () => {
      // FIX-367: credit the just-merged cycle's runs row → merged/delivered so the
      // picker's hasMergedDelivery guard durably excludes the card the instant the
      // PR-lane merges — not only after the next `loop run-once` backfill. Bounded
      // (≤20 gh probes) and evidence-only (nothing flips without gh-confirmed
      // MERGED); the runs ledger is the clobber-proof signal (survives any stale
      // backlog.md metadata commit). Best-effort by contract (doMerge swallows).
      await backfillMergedRuns(process.cwd(), join(runtimeDir(), "runs.jsonl"));
    },
    heal: async (num, headRef, slug) => {
      // US-PORT-021: native TS gate; dispatches the heal detached, never blocks.
      prHealSelf(num, headRef, slug);
    },
    dispatchCi: async (_num, headRef, slug) => (await workflowDispatch(slug, "ci.yml", headRef)).code === 0,
    rebaseCircuitAllowed,
    rebaseStale: async (num, headRef, slug) => {
      prRebaseStale(num, headRef); // US-PORT-021: native TS rebase (was bridged bash)
      // Re-fetch the PR state after the rebase to decide an eager merge.
      const r = await gh(["-R", slug, "pr", "view", num, "--json", "mergeStateStatus,statusCheckRollup,body,labels,isDraft"]);
      if (r.code !== 0 || r.stdout.trim() === "") return undefined;
      try {
        const raw = JSON.parse(r.stdout) as PrViewRaw;
        const facts = reducePrView(raw);
        const evidence = resolvePrEvidence(process.cwd(), headRef, raw.body ?? "");
        return { ...facts, evidenceResolvable: evidence.ok, evidenceMissing: evidence.missing };
      } catch {
        return undefined;
      }
    },
    repairEvidence: (num, headRef, slug, missing) => repairEvidenceOnce(num, headRef, slug, missing),
    alert: appendAlert,
    writeTick: writeTickFile,
    info: (line) => process.stdout.write(`${yellow}[roll]${nc} ${line}\n`),
    warn: (line) => process.stdout.write(`${yellow}[roll]${nc} ${line}\n`),
  };
}

/**
 * `roll loop pr-inbox` — drive one PR-loop tick. Lenient: always exits 0 so the
 * scheduler keeps ticking (the bash inbox's `return 0` posture).
 */
export async function loopPrInboxCommand(_args: string[], deps: PrInboxDeps = realDeps()): Promise<number> {
  try {
    await runPrInbox(deps);
  } catch {
    /* lenient: any unexpected error degrades to a silent idle tick already
       written by runPrInbox's gates, or none — never break the scheduler. */
  }
  return 0;
}
