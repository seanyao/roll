import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  buildWorkspaceCreatePlan,
  renderDefaultWorkspaceAgentScope,
  type WorkspaceCreateConfig,
  type WorkspaceCreatePlan,
  type WorkspaceCreatePlanStep,
  type WorkspaceCreateProbe,
  type WorkspaceCreateState,
} from "@roll/core";
import type { RepositoryBinding } from "@roll/spec";
import {
  ensureRepositoryCache,
  inspectRepositoryCache,
  type RepositoryCacheProbeState,
} from "./repository-cache.js";
import {
  WorkspaceRegistry,
  workspaceRegistryTransactionPath,
} from "./workspace-registry.js";
import { acquireLock, releaseLock } from "./process.js";

const JOURNAL_V1 = "roll.workspace-create-journal/v1" as const;

export class WorkspaceCreationError extends Error {
  constructor(readonly code: "rejected" | "concurrent_create" | "apply_failed", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspaceCreationError";
  }
}

interface WorkspaceCreateDeps {
  readonly inspectCache?: (binding: RepositoryBinding, rollHome: string) => Promise<RepositoryCacheProbeState>;
  readonly ensureCache?: (binding: RepositoryBinding, rollHome: string) => Promise<{ readonly action: "created" | "reused" | "repaired" }>;
  readonly afterStep?: (step: WorkspaceCreatePlanStep) => void;
  readonly renameFile?: (from: string, to: string) => void;
}

interface CreatedNode {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly digest?: string;
}

interface CreateJournal {
  readonly schema: typeof JOURNAL_V1;
  readonly transactionId: string;
  readonly workspaceId: string;
  readonly root: string;
  readonly configDigest: string;
  readonly status: "applying" | "repair_required";
  readonly created: readonly CreatedNode[];
  readonly preserved: readonly string[];
  readonly preservedCaches: readonly string[];
}

export function workspaceCreateJournalPath(rollHome: string, workspaceId: string): string {
  return join(resolve(rollHome), "workspace-create", `${workspaceId}.pending.json`);
}

export function workspaceCreateLockPath(rollHome: string, workspaceId: string): string {
  void workspaceId;
  return join(resolve(rollHome), "locks", "workspace-create.lock");
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function manifestText(config: WorkspaceCreateConfig): string {
  return `${JSON.stringify(config.manifest, null, 2)}\n`;
}

function expectedFiles(config: WorkspaceCreateConfig): Readonly<Record<string, string>> {
  return {
    [join(config.root, "workspace.yaml")]: manifestText(config),
    [join(config.root, "charter.md")]: `# ${config.manifest.displayName}\n\nWorkspace charter.\n`,
    [join(config.root, "agents.yaml")]: renderDefaultWorkspaceAgentScope(),
    [join(config.root, "policy.yaml")]: "schema: roll.workspace-policy/v1\n",
    [join(config.root, "backlog", "index.md")]: "# Backlog\n",
  };
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

function configDigest(config: WorkspaceCreateConfig): string {
  return digest(JSON.stringify({ workspaceId: config.workspaceId, root: config.root, manifest: config.manifest }));
}

function readJournal(config: WorkspaceCreateConfig): "absent" | "repairable" | "conflict" {
  const path = workspaceCreateJournalPath(config.rollHome, config.workspaceId);
  if (!existsSync(path)) return "absent";
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return value["schema"] === JOURNAL_V1 && value["workspaceId"] === config.workspaceId &&
      value["root"] === config.root && value["configDigest"] === configDigest(config)
      ? "repairable" : "conflict";
  } catch {
    return "conflict";
  }
}

function nodeState(path: string, expectedKind: "file" | "directory", expectedText: string | undefined, repairable: boolean): WorkspaceCreateState {
  if (!existsSync(path)) return repairable ? "repairable" : "absent";
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return "conflict";
  if (expectedKind === "directory") return stat.isDirectory() ? "compatible" : "conflict";
  if (!stat.isFile()) return "conflict";
  return readFileSync(path, "utf8") === expectedText ? "compatible" : "conflict";
}

function registryState(config: WorkspaceCreateConfig): WorkspaceCreateState {
  if (existsSync(workspaceRegistryTransactionPath(config.rollHome))) return "conflict";
  try {
    const snapshot = new WorkspaceRegistry({ rollHome: config.rollHome }).read();
    const canonicalRoot = canonicalProspectivePath(config.root);
    const byId = snapshot.entries.find((entry) => entry.workspaceId === config.workspaceId);
    const byPath = snapshot.entries.find((entry) => entry.root === config.root || entry.canonicalRoot === canonicalRoot);
    if (byId === undefined && byPath === undefined) return "absent";
    if (byId?.root === config.root && byId.canonicalRoot === canonicalRoot &&
      (byPath === undefined || byPath.workspaceId === config.workspaceId)) return "compatible";
    return "conflict";
  } catch {
    return "conflict";
  }
}

function canonicalProspectivePath(path: string): string {
  const suffix: string[] = [];
  let cursor = resolve(path);
  for (;;) {
    try {
      return resolve(realpathSync(cursor), ...suffix);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) return resolve(path);
      suffix.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function hasCanonicalPathConflict(config: WorkspaceCreateConfig): boolean {
  const root = canonicalProspectivePath(config.root);
  const reposRoot = canonicalProspectivePath(join(config.rollHome, "repos"));
  return contains(root, reposRoot) || contains(reposRoot, root);
}

export async function inspectWorkspaceCreation(
  config: WorkspaceCreateConfig,
  deps: Pick<WorkspaceCreateDeps, "inspectCache"> = {},
): Promise<WorkspaceCreatePlan> {
  const journal = readJournal(config);
  if (hasCanonicalPathConflict(config)) {
    return buildWorkspaceCreatePlan(config, {
      paths: { [config.root]: "conflict" },
      caches: {},
      registry: { state: registryState(config) },
      journal: { state: journal },
    });
  }
  const rootExists = existsSync(config.root);
  const repairable = journal === "repairable";
  if (rootExists) {
    const stat = lstatSync(config.root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return buildWorkspaceCreatePlan(config, { paths: { [config.root]: "conflict" }, caches: {}, registry: { state: registryState(config) }, journal: { state: journal } });
    }
  }
  const files = expectedFiles(config);
  const pathProbe: Record<string, WorkspaceCreateState> = {};
  const planned = buildWorkspaceCreatePlan(config, { paths: {}, caches: {}, registry: { state: "absent" }, journal: { state: journal } });
  for (const step of planned.steps) {
    if (step.kind !== "file" && step.kind !== "directory") continue;
    pathProbe[step.target] = nodeState(step.target, step.kind, files[step.target], rootExists && repairable);
  }
  if (rootExists && !repairable && pathProbe[join(config.root, "workspace.yaml")] !== "compatible") {
    pathProbe[config.root] = "conflict";
  }
  const inspectCache = deps.inspectCache ?? ((binding: RepositoryBinding, rollHome: string) => inspectRepositoryCache({ binding, rollHome }));
  const caches: Record<string, WorkspaceCreateState> = {};
  for (const binding of config.manifest.repositories) caches[binding.repoId] = await inspectCache(binding, config.rollHome);
  const probe: WorkspaceCreateProbe = { paths: pathProbe, caches, registry: { state: registryState(config) }, journal: { state: journal } };
  return buildWorkspaceCreatePlan(config, probe);
}

function journalText(journal: CreateJournal): string {
  return `${JSON.stringify(journal, null, 2)}\n`;
}

function rollback(created: readonly CreatedNode[]): readonly string[] {
  const preserved: string[] = [];
  for (const node of [...created].reverse()) {
    if (!existsSync(node.path)) continue;
    if (node.kind === "file") {
      const stat = lstatSync(node.path);
      if (!stat.isFile() || stat.isSymbolicLink() || digest(readFileSync(node.path, "utf8")) !== node.digest) {
        preserved.push(node.path);
        continue;
      }
      rmSync(node.path, { force: true });
      continue;
    }
    const stat = lstatSync(node.path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || readdirSync(node.path).length > 0) {
      preserved.push(node.path);
      continue;
    }
    rmSync(node.path, { recursive: true, force: true });
  }
  return preserved.sort();
}

function mkdirTracked(path: string, created: CreatedNode[]): void {
  if (existsSync(path)) return;
  const missing: string[] = [];
  let cursor = path;
  while (!existsSync(cursor)) {
    missing.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  mkdirSync(path, { recursive: true });
  for (const target of missing.reverse()) created.push({ path: target, kind: "directory" });
}

export async function applyWorkspaceCreation(
  config: WorkspaceCreateConfig,
  deps: WorkspaceCreateDeps = {},
): Promise<{ readonly outcome: WorkspaceCreatePlan["outcome"]; readonly plan: WorkspaceCreatePlan }> {
  const initialPlan = await inspectWorkspaceCreation(config, deps);
  if (initialPlan.outcome === "rejected") throw new WorkspaceCreationError("rejected", "Workspace creation plan was rejected");
  const lockPath = workspaceCreateLockPath(config.rollHome, config.workspaceId);
  const lock = acquireLock(lockPath, process.pid, {
    cycleId: `workspace-create:${config.workspaceId}`,
    unparseableIsHeld: true,
  });
  if (!lock.acquired) {
    throw new WorkspaceCreationError("concurrent_create", `Workspace creation is already running for ${config.workspaceId}`);
  }
  try {
    const plan = await inspectWorkspaceCreation(config, deps);
    if (plan.outcome === "rejected") throw new WorkspaceCreationError("rejected", "Workspace creation plan was rejected");
    const journalPath = workspaceCreateJournalPath(config.rollHome, config.workspaceId);
    const created: CreatedNode[] = [];
    const preservedCaches: string[] = [];
    let registered = false;
    let journal: CreateJournal = {
      schema: JOURNAL_V1,
      transactionId: randomUUID(),
      workspaceId: config.workspaceId,
      root: config.root,
      configDigest: configDigest(config),
      status: "applying",
      created,
      preserved: [],
      preservedCaches,
    };
    atomicWrite(journalPath, journalText(journal), deps.renameFile);
    const files = expectedFiles(config);
    const ensureCache = deps.ensureCache ?? (async (binding: RepositoryBinding, rollHome: string) => {
      const branch = binding.integrationBranch;
      return ensureRepositoryCache({
        binding,
        rollHome,
        integrationRefspec: `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
      });
    });
    try {
      for (const step of plan.steps) {
        if (step.kind === "journal" || step.kind === "registry") continue;
        if (step.action === "reused" && step.kind !== "cache") continue;
        if (step.kind === "directory") {
          if (!existsSync(step.target)) mkdirTracked(step.target, created);
        } else if (step.kind === "file") {
          const text = files[step.target];
          if (text === undefined) throw new WorkspaceCreationError("apply_failed", `No content contract for ${step.target}`);
          if (!existsSync(step.target)) {
            atomicWrite(step.target, text, deps.renameFile);
            created.push({ path: step.target, kind: "file", digest: digest(text) });
          }
        } else if (step.kind === "cache") {
          const binding = config.manifest.repositories.find((entry) => entry.repoId === step.target);
          if (binding === undefined) throw new WorkspaceCreationError("apply_failed", `Missing binding ${step.target}`);
          const result = await ensureCache(binding, config.rollHome);
          if (result.action === "created") preservedCaches.push(binding.repoId);
        }
        journal = { ...journal, created: [...created], preservedCaches: [...preservedCaches] };
        atomicWrite(journalPath, journalText(journal), deps.renameFile);
        deps.afterStep?.(step);
      }
      const registry = new WorkspaceRegistry({ rollHome: config.rollHome });
      registry.register({ workspaceId: config.workspaceId, root: config.root });
      registered = true;
      deps.afterStep?.(plan.steps.at(-1) as WorkspaceCreatePlanStep);
      rmSync(journalPath, { force: true });
      return { outcome: plan.outcome, plan };
    } catch (error) {
      const preserved = registered ? created.map((node) => node.path).sort() : rollback(created);
      journal = { ...journal, status: "repair_required", created: [...created], preserved, preservedCaches: [...preservedCaches] };
      atomicWrite(journalPath, journalText(journal), deps.renameFile);
      throw error;
    }
  } finally {
    releaseLock(lockPath);
  }
}
