import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  resolveIssueInitPlan,
  type IssueInitProbe,
  type IssueStoryContract,
  type IssueTargetProbeState,
} from "@roll/core";
import type { IssueManifest, RepositoryBinding, RequirementSourceManifest } from "@roll/spec";
import { ensureRepositoryCache, type RepositoryCacheAction } from "./repository-cache.js";

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

export interface InspectIssueInitInput {
  readonly issueRoot: string;
  readonly contract: IssueStoryContract;
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

function defaultProbeWorktree(issueRoot: string, alias: string): IssueTargetProbeState {
  const path = join(issueRoot, alias);
  if (!existsSync(path)) return "absent";
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return "conflict";
  return existsSync(journalPath(issueRoot)) ? "repairable" : "compatible";
}

export async function inspectIssueInit(input: InspectIssueInitInput): Promise<IssueInitProbe> {
  const worktrees: Record<string, IssueTargetProbeState> = {};
  for (const declared of input.contract.repositories) {
    worktrees[declared.alias] = defaultProbeWorktree(input.issueRoot, declared.alias);
  }
  return {
    manifest: { state: existsSync(manifestPath(input.issueRoot)) ? "compatible" : "absent" },
    worktrees,
  };
}

export interface IssueWorktreeDeps {
  readonly ensureCache?: (
    binding: RepositoryBinding,
  ) => Promise<{ readonly action: RepositoryCacheAction; readonly cachePath: string; readonly baseSha: string }>;
  readonly createWorktree?: (cachePath: string, path: string, branch: string, baseSha: string) => Promise<void>;
  readonly probeWorktree?: (path: string, alias: string) => IssueTargetProbeState;
  readonly now?: () => number;
  readonly renameFile?: (from: string, to: string) => void;
}

export interface ApplyIssueInitInput {
  readonly workspaceId: string;
  readonly issueRoot: string;
  readonly contract: IssueStoryContract;
  readonly bindings: readonly RepositoryBinding[];
  readonly requirementManifests: readonly RequirementSourceManifest[];
}

export interface ApplyIssueInitResult {
  readonly outcome: "created" | "reused" | "repaired";
  readonly manifest: IssueManifest;
}

interface JournalTarget {
  readonly alias: string;
  readonly path: string;
  readonly created: boolean;
}

interface IssueInitJournal {
  readonly schema: typeof ISSUE_INIT_JOURNAL_V1;
  readonly transactionId: string;
  readonly workspaceId: string;
  readonly storyId: string;
  readonly status: "applying" | "repair_required";
  readonly targets: readonly JournalTarget[];
}

function atomicWrite(path: string, text: string, renameFile: (from: string, to: string) => void = renameSync): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" });
    renameFile(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function writeJournal(issueRoot: string, journal: IssueInitJournal, renameFile: (from: string, to: string) => void): void {
  atomicWrite(journalPath(issueRoot), `${JSON.stringify(journal, null, 2)}\n`, renameFile);
}

function rollbackCreatedTargets(issueRoot: string, targets: readonly JournalTarget[]): readonly string[] {
  const preserved: string[] = [];
  for (const target of [...targets].reverse()) {
    if (!target.created) continue;
    if (!existsSync(target.path)) continue;
    const stat = lstatSync(target.path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      preserved.push(target.path);
      continue;
    }
    rmSync(target.path, { recursive: true, force: true });
  }
  return preserved;
}

/** Create, reuse or repair one Issue root: an immutable manifest and one worktree per declared repository target. */
export async function applyIssueInit(
  input: ApplyIssueInitInput,
  deps: IssueWorktreeDeps = {},
): Promise<ApplyIssueInitResult> {
  const now = deps.now ?? Date.now;
  const bindingsByAlias = new Map(input.bindings.map((binding) => [binding.alias, binding]));
  const manifestState = probeManifestState(input.issueRoot, { workspaceId: input.workspaceId, storyId: input.contract.storyId });
  if (manifestState === "conflict") {
    throw new IssueInitializationError("manifest_conflict", "Issue manifest on disk conflicts with the resolved Workspace/Story identity");
  }
  const probeWorktree = deps.probeWorktree ?? ((_path, alias) => defaultProbeWorktree(input.issueRoot, alias));
  const worktreeStates: Record<string, IssueTargetProbeState> = {};
  for (const declared of input.contract.repositories) {
    worktreeStates[declared.alias] = probeWorktree(join(input.issueRoot, declared.alias), declared.alias);
  }
  const planResult = resolveIssueInitPlan({
    workspaceId: input.workspaceId,
    contract: input.contract,
    bindings: input.bindings,
    requirementManifests: input.requirementManifests,
  }, { manifest: { state: manifestState }, worktrees: worktreeStates });
  if (!planResult.ok) {
    throw new IssueInitializationError("rejected", `Issue init plan was rejected: ${planResult.errors[0]?.message ?? "invalid plan"}`);
  }
  const plan = planResult.value;
  mkdirSync(input.issueRoot, { recursive: true });
  const renameFile = deps.renameFile ?? renameSync;
  const ensureCache = deps.ensureCache ?? (async (binding: RepositoryBinding) => {
    const branch = binding.integrationBranch;
    return ensureRepositoryCache({
      binding,
      rollHome: join(input.issueRoot, "..", "..", "..", ".roll-cache"),
      integrationRefspec: `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
    });
  });
  const createWorktree = deps.createWorktree ?? (async (cachePath, path, branch, baseSha) => {
    mkdirSync(dirname(path), { recursive: true });
    const { worktreeAdd } = await import("./git.js");
    const result = await worktreeAdd(cachePath, path, branch, baseSha);
    if (result.code !== 0) throw new Error(`git worktree add failed for ${path}`);
  });

  const targets: JournalTarget[] = plan.targets.map((target) => ({
    alias: target.alias,
    path: join(input.issueRoot, target.alias),
    created: false,
  }));
  let journal: IssueInitJournal = {
    schema: ISSUE_INIT_JOURNAL_V1,
    transactionId: randomUUID(),
    workspaceId: input.workspaceId,
    storyId: input.contract.storyId,
    status: "applying",
    targets,
  };
  writeJournal(input.issueRoot, journal, renameFile);
  try {
    for (const [index, target] of plan.targets.entries()) {
      if (target.action !== "created") continue;
      const binding = bindingsByAlias.get(target.alias);
      if (binding === undefined) throw new IssueInitializationError("apply_failed", `Missing Workspace binding for ${target.alias}`);
      const cache = await ensureCache(binding);
      const branch = `roll/${input.workspaceId}/${input.contract.storyId}/${target.alias}`;
      await createWorktree(cache.cachePath, targets[index]!.path, branch, cache.baseSha);
      targets[index] = { ...targets[index]!, created: true };
      journal = { ...journal, targets: [...targets] };
      writeJournal(input.issueRoot, journal, renameFile);
    }
    if (manifestState === "absent" || manifestState === "repairable") {
      atomicWrite(manifestPath(input.issueRoot), `${JSON.stringify(plan.manifest, null, 2)}\n`, renameFile);
    }
    const eventLines = plan.targets.map((target) => `${JSON.stringify({
      type: "issue:repository_bound",
      workspaceId: input.workspaceId,
      storyId: input.contract.storyId,
      alias: target.alias,
      repoId: target.repoId,
      worktreePath: targets.find((entry) => entry.alias === target.alias)?.path,
      ts: now(),
    })}\n`).join("");
    writeFileSync(eventsPath(input.issueRoot), eventLines, { encoding: "utf8", flag: "a" });
    rmSync(journalPath(input.issueRoot), { force: true });
    return { outcome: plan.outcome, manifest: plan.manifest };
  } catch (error) {
    const preserved = rollbackCreatedTargets(input.issueRoot, targets);
    journal = { ...journal, status: "repair_required", targets: [...targets] };
    writeJournal(input.issueRoot, journal, renameFile);
    void preserved;
    if (error instanceof IssueInitializationError) throw error;
    throw new IssueInitializationError("apply_failed", `Issue init failed: ${(error as Error).message}`, { cause: error });
  }
}
