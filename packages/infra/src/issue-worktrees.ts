import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  renderBranchPattern,
  resolveIssueInitPlan,
  type IssueInitOutcome,
  type IssueInitTargetPlan,
  type IssueStoryContract,
  type IssueTargetProbeState,
} from "@roll/core";
import type { IssueManifest, RepositoryBinding, RequirementSourceManifest } from "@roll/spec";
import {
  ensureRepositoryCache,
  inspectRepositoryCache,
  resolveRepositoryCacheIdentity,
  type RepositoryCacheProbeState,
} from "./repository-cache.js";
import { issueWorktreeAdd, issueWorktreeIdentity, issueWorktreeRemove } from "./issue-worktree-git.js";
import { git } from "./git.js";

const ISSUE_INIT_JOURNAL_V1 = "roll.issue-init-journal/v1" as const;

export type IssueInitializationErrorCode =
  | "rejected"
  | "manifest_conflict"
  | "apply_failed";

export class IssueInitializationError extends Error {
  constructor(readonly code: IssueInitializationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IssueInitializationError";
  }
}

function manifestPath(issueRoot: string): string {
  return join(issueRoot, "manifest.json");
}

function eventsPath(issueRoot: string): string {
  return join(issueRoot, "events.jsonl");
}

function journalPath(issueRoot: string): string {
  return join(issueRoot, "issue-init.pending.json");
}

/** Every alias already recorded by a prior `issue:repository_bound` event —
 *  an idempotent retry must never emit a second event for the same alias. */
function recordedRepositoryBoundAliases(issueRoot: string): ReadonlySet<string> {
  const path = eventsPath(issueRoot);
  if (!existsSync(path)) return new Set();
  const aliases = new Set<string>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event["type"] === "issue:repository_bound" && typeof event["alias"] === "string") {
        aliases.add(event["alias"]);
      }
    } catch {
      // Malformed lines are ignored here; they do not block a retry.
    }
  }
  return aliases;
}

function integrationRefspecFor(binding: RepositoryBinding): string {
  return `+refs/heads/${binding.integrationBranch}:refs/remotes/origin/${binding.integrationBranch}`;
}

/** Read-only base SHA resolution against an already-cached remote-tracking ref
 *  — never fetches, so callers report the LAST cached base without any write. */
async function readCachedBaseSha(cachePath: string, integrationBranch: string): Promise<string | null> {
  const result = await git(["rev-parse", `refs/remotes/origin/${integrationBranch}`], cachePath);
  return result.code === 0 ? result.stdout.trim() : null;
}

/** Every immutable field the manifest carries for one repository target —
 *  compared in full so a changed requirement/repository/access set under the
 *  same Workspace/Story identity is a manifest_conflict, not silently reused. */
function manifestsMatch(onDisk: unknown, expected: IssueManifest): boolean {
  if (typeof onDisk !== "object" || onDisk === null) return false;
  const record = onDisk as Record<string, unknown>;
  if (record["schema"] !== expected.schema) return false;
  if (record["workspaceId"] !== expected.workspaceId) return false;
  if (record["storyId"] !== expected.storyId) return false;
  return JSON.stringify(record["requirements"] ?? null) === JSON.stringify(expected.requirements)
    && JSON.stringify(record["repositories"] ?? null) === JSON.stringify(expected.repositories);
}

export interface IssueCheckTargetReport {
  readonly alias: string;
  readonly access: "read" | "write";
  readonly repoId: string;
  readonly cachePath: string;
  readonly cacheState: RepositoryCacheProbeState;
  readonly baseSha: string | null;
  readonly worktreePath: string;
  readonly workBranch: string | null;
  readonly decision: IssueInitOutcome | "conflict";
}

export interface IssueCheckReport {
  readonly manifest: { readonly state: IssueTargetProbeState };
  readonly targets: Readonly<Record<string, IssueCheckTargetReport>>;
}

export interface InspectIssueInitInput {
  readonly workspaceId: string;
  readonly rollHome: string;
  readonly issueRoot: string;
  readonly contract: IssueStoryContract;
  readonly bindings: readonly RepositoryBinding[];
}

function probeManifestState(issueRoot: string, expected: { workspaceId: string; storyId: string }): IssueTargetProbeState {
  const interrupted = existsSync(journalPath(issueRoot));
  const path = manifestPath(issueRoot);
  if (!existsSync(path)) return interrupted ? "repairable" : "absent";
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return "conflict";
  }
  if (typeof value !== "object" || value === null) return "conflict";
  const record = value as Record<string, unknown>;
  if (record["workspaceId"] !== expected.workspaceId || record["storyId"] !== expected.storyId) return "conflict";
  return "compatible";
}

/** Combine a target's cache state and its real git worktree identity into ONE
 *  probe state the core plan resolver already understands. */
function combineTargetState(cacheState: RepositoryCacheProbeState, worktreeState: IssueTargetProbeState): IssueTargetProbeState {
  if (cacheState === "conflict" || worktreeState === "conflict") return "conflict";
  if (worktreeState === "absent") return cacheState === "compatible" ? "absent" : cacheState;
  return worktreeState;
}

async function probeWorktreeState(path: string, cachePath: string): Promise<IssueTargetProbeState> {
  const identity = await issueWorktreeIdentity(path, cachePath);
  if (identity.state === "absent") return "absent";
  if (identity.state === "conflict") return "conflict";
  return "compatible";
}

/** Fully resolve every declared repository target — cache and real worktree
 *  identity — with ZERO filesystem writes (including the machine Roll Home
 *  cache): `inspectRepositoryCache` never creates roots/locks/journals, and
 *  worktree identity is read-only `git` introspection. */
export async function inspectIssueInit(input: InspectIssueInitInput): Promise<IssueCheckReport> {
  const bindingsByAlias = new Map(input.bindings.map((binding) => [binding.alias, binding]));
  const manifestState = probeManifestState(input.issueRoot, {
    workspaceId: input.workspaceId,
    storyId: input.contract.storyId,
  });
  const targets: Record<string, IssueCheckTargetReport> = {};
  for (const declared of input.contract.repositories) {
    const binding = bindingsByAlias.get(declared.alias);
    if (binding === undefined) continue;
    const identity = resolveRepositoryCacheIdentity({ rollHome: input.rollHome, binding });
    const cacheState = await inspectRepositoryCache({ rollHome: input.rollHome, binding });
    const baseSha = cacheState === "compatible" ? await readCachedBaseSha(identity.cachePath, binding.integrationBranch) : null;
    const worktreePath = join(input.issueRoot, declared.alias);
    const worktreeState = await probeWorktreeState(worktreePath, identity.cachePath);
    const combined = combineTargetState(cacheState, worktreeState);
    const decision: IssueInitOutcome | "conflict" = combined === "absent" ? "created" : combined === "compatible" ? "reused" : combined === "repairable" ? "repaired" : "conflict";
    targets[declared.alias] = {
      alias: declared.alias,
      access: declared.access,
      repoId: binding.repoId,
      cachePath: identity.cachePath,
      cacheState,
      baseSha,
      worktreePath,
      workBranch: declared.access === "write"
        ? renderBranchPattern(binding.workflow.branchPattern, { workspaceId: input.workspaceId, storyId: input.contract.storyId, repoAlias: declared.alias })
        : null,
      decision,
    };
  }
  return { manifest: { state: manifestState }, targets };
}

export interface ApplyIssueInitDeps {
  /** Test-only hook fired synchronously right after each target's real git
   *  worktree is created — lets a test inject a genuine filesystem mutation
   *  (e.g. making an earlier target dirty) between one target's creation and
   *  a LATER target's failure, without faking any git operation itself. */
  readonly afterTargetCreated?: (alias: string, path: string) => void;
}

export interface ApplyIssueInitInput {
  readonly workspaceId: string;
  readonly rollHome: string;
  readonly issueRoot: string;
  readonly contract: IssueStoryContract;
  readonly bindings: readonly RepositoryBinding[];
  readonly requirementManifests: readonly RequirementSourceManifest[];
}

export interface ApplyIssueInitResult {
  readonly outcome: IssueInitOutcome;
  readonly manifest: IssueManifest;
}

interface ResolvedTargetCache {
  readonly alias: string;
  readonly repoId: string;
  readonly cachePath: string;
  readonly baseSha: string;
}

interface JournalTarget {
  readonly alias: string;
  readonly path: string;
  readonly created: boolean;
  readonly workBranch: string | null;
}

interface IssueInitJournal {
  readonly schema: typeof ISSUE_INIT_JOURNAL_V1;
  readonly transactionId: string;
  readonly workspaceId: string;
  readonly storyId: string;
  readonly status: "applying" | "repair_required";
  readonly targets: readonly JournalTarget[];
}

function atomicWrite(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function writeJournal(issueRoot: string, journal: IssueInitJournal): void {
  atomicWrite(journalPath(issueRoot), `${JSON.stringify(journal, null, 2)}\n`);
}

/** Roll back newly-created targets via real `git worktree remove` — refuses
 *  (and preserves) a target that has gone dirty since creation, or one that
 *  was never newly-created (pre-existing). Never a blind `rm -rf`. */
async function rollbackCreatedTargets(
  targets: readonly JournalTarget[],
  cacheByAlias: ReadonlyMap<string, ResolvedTargetCache>,
): Promise<void> {
  for (const target of [...targets].reverse()) {
    if (!target.created) continue;
    if (!existsSync(target.path)) continue;
    const cache = cacheByAlias.get(target.alias);
    if (cache === undefined) continue;
    const identity = await issueWorktreeIdentity(target.path, cache.cachePath);
    if (identity.state !== "compatible" || identity.dirty) continue; // preserve: conflict or dirty
    try {
      await issueWorktreeRemove(cache.cachePath, target.path);
    } catch {
      // A target that refuses removal (e.g. went dirty between the identity
      // check and now) is preserved — never forced.
      continue;
    }
    // The worktree is gone; also delete the governed branch THIS run created,
    // so a repair retry can `worktree add -b` the same branch name again
    // without "a branch named ... already exists".
    if (target.workBranch !== null) {
      await git(["branch", "-D", target.workBranch], cache.cachePath);
    }
  }
}

/** Create, reuse or repair one Issue root: an immutable manifest and one real
 *  git worktree per declared repository target, from the actual machine Roll
 *  Home repository cache (~/.roll/repos via the existing repository-cache
 *  contract) — never a Workspace-relative cache. ALL targets/cache/base SHA
 *  are resolved before the Issue root is created or mutated. */
export async function applyIssueInit(input: ApplyIssueInitInput, deps: ApplyIssueInitDeps = {}): Promise<ApplyIssueInitResult> {
  const bindingsByAlias = new Map(input.bindings.map((binding) => [binding.alias, binding]));
  const manifestOnDiskPath = manifestPath(input.issueRoot);
  const manifestExists = existsSync(manifestOnDiskPath);
  let manifestOnDisk: unknown = null;
  if (manifestExists) {
    try {
      manifestOnDisk = JSON.parse(readFileSync(manifestOnDiskPath, "utf8"));
    } catch {
      throw new IssueInitializationError("manifest_conflict", "Issue manifest on disk is not valid JSON");
    }
  }
  const manifestRecord = manifestOnDisk as Record<string, unknown> | null;
  const manifestIdentityMatches = manifestRecord !== null
    && manifestRecord["workspaceId"] === input.workspaceId
    && manifestRecord["storyId"] === input.contract.storyId;
  if (manifestExists && !manifestIdentityMatches) {
    throw new IssueInitializationError("manifest_conflict", "Issue manifest on disk conflicts with the resolved Workspace/Story identity");
  }

  // Resolve EVERY target's cache and real worktree identity BEFORE any mutation.
  const worktreeStates: Record<string, IssueTargetProbeState> = {};
  const cacheByAlias = new Map<string, ResolvedTargetCache>();
  for (const declared of input.contract.repositories) {
    const binding = bindingsByAlias.get(declared.alias);
    if (binding === undefined) continue; // core plan resolver reports this as unknown_field
    const identity = resolveRepositoryCacheIdentity({ rollHome: input.rollHome, binding });
    const cacheState = await inspectRepositoryCache({ rollHome: input.rollHome, binding });
    const worktreePath = join(input.issueRoot, declared.alias);
    const worktreeState = await probeWorktreeState(worktreePath, identity.cachePath);
    worktreeStates[declared.alias] = combineTargetState(cacheState, worktreeState);
  }

  const planResult = resolveIssueInitPlan({
    workspaceId: input.workspaceId,
    contract: input.contract,
    bindings: input.bindings,
    requirementManifests: input.requirementManifests,
  }, {
    manifest: { state: manifestExists ? "compatible" : (existsSync(journalPath(input.issueRoot)) ? "repairable" : "absent") },
    worktrees: worktreeStates,
  });
  if (!planResult.ok) {
    throw new IssueInitializationError("rejected", `Issue init plan was rejected: ${planResult.errors[0]?.message ?? "invalid plan"}`);
  }
  const plan = planResult.value;

  if (manifestExists && !manifestsMatch(manifestOnDisk, plan.manifest)) {
    throw new IssueInitializationError("manifest_conflict", "Issue manifest on disk conflicts with the resolved Story Contract's immutable intent");
  }

  // Resolve (fetch/create/reuse) EVERY target's repository cache and base SHA
  // BEFORE creating or mutating the Issue root — a failure here leaves no trace.
  for (const declared of input.contract.repositories) {
    const binding = bindingsByAlias.get(declared.alias);
    if (binding === undefined) continue;
    try {
      const cache = await ensureRepositoryCache({
        binding,
        rollHome: input.rollHome,
        integrationRefspec: integrationRefspecFor(binding),
      });
      cacheByAlias.set(declared.alias, { alias: declared.alias, repoId: binding.repoId, cachePath: cache.cachePath, baseSha: cache.baseSha });
    } catch (error) {
      throw new IssueInitializationError("apply_failed", `Failed to resolve the repository cache for ${declared.alias}: ${(error as Error).message}`, { cause: error });
    }
  }

  mkdirSync(input.issueRoot, { recursive: true });
  const targets: JournalTarget[] = plan.targets.map((target) => ({
    alias: target.alias,
    path: join(input.issueRoot, target.alias),
    created: false,
    workBranch: target.workBranch,
  }));
  let journal: IssueInitJournal = {
    schema: ISSUE_INIT_JOURNAL_V1,
    transactionId: randomUUID(),
    workspaceId: input.workspaceId,
    storyId: input.contract.storyId,
    status: "applying",
    targets,
  };
  writeJournal(input.issueRoot, journal);
  try {
    for (const [index, target] of plan.targets.entries()) {
      if (target.action === "reused") continue;
      // A "created" OR "repaired" target may still have no real worktree on
      // disk yet (e.g. its repository cache alone needed repair) — create it
      // whenever the path is genuinely absent, never otherwise.
      if (existsSync(targets[index]!.path)) continue;
      const cache = cacheByAlias.get(target.alias);
      if (cache === undefined) throw new IssueInitializationError("apply_failed", `Missing resolved repository cache for ${target.alias}`);
      await issueWorktreeAdd(cache.cachePath, targets[index]!.path, cache.baseSha, target.workBranch);
      targets[index] = { ...targets[index]!, created: true };
      journal = { ...journal, targets: [...targets] };
      writeJournal(input.issueRoot, journal);
      deps.afterTargetCreated?.(target.alias, targets[index]!.path);
    }
    if (!manifestExists) {
      atomicWrite(manifestOnDiskPath, `${JSON.stringify(plan.manifest, null, 2)}\n`);
    }
    const boundAliases = recordedRepositoryBoundAliases(input.issueRoot);
    const eventLines = plan.targets
      .filter((target) => !boundAliases.has(target.alias))
      .map((target: IssueInitTargetPlan) => `${JSON.stringify({
        type: "issue:repository_bound",
        workspaceId: input.workspaceId,
        storyId: input.contract.storyId,
        alias: target.alias,
        repoId: target.repoId,
        access: target.access,
        baseSha: cacheByAlias.get(target.alias)?.baseSha,
        worktreePath: targets.find((entry) => entry.alias === target.alias)?.path,
        workBranch: target.workBranch,
        ts: Date.now(),
      })}\n`).join("");
    if (eventLines !== "") {
      writeFileSync(eventsPath(input.issueRoot), eventLines, { encoding: "utf8", flag: "a" });
    }
    rmSync(journalPath(input.issueRoot), { force: true });
    return { outcome: plan.outcome, manifest: plan.manifest };
  } catch (error) {
    await rollbackCreatedTargets(targets, cacheByAlias);
    journal = { ...journal, status: "repair_required", targets: [...targets] };
    writeJournal(input.issueRoot, journal);
    if (error instanceof IssueInitializationError) throw error;
    throw new IssueInitializationError("apply_failed", `Issue init failed: ${(error as Error).message}`, { cause: error });
  }
}
