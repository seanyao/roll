import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  normalizeRequirementSourceReference,
  planRequirementCapture,
  renderRequirementAttestProjection,
  requirementRevisionKey,
  type RequirementCaptureOutcome,
} from "@roll/core";
import {
  parseRequirementSourceManifest,
  parseWorkspaceManifest,
  type RequirementContextDescriptor,
  type RequirementSourceManifest,
  type WorkspaceManifest,
} from "@roll/spec";
import { acquireLock, releaseLock } from "./process.js";

export type RequirementSourceStoreErrorCode =
  | "invalid_workspace"
  | "source_not_declared"
  | "story_not_found"
  | "unsafe_context"
  | "context_limit"
  | "source_changed"
  | "revision_conflict"
  | "concurrent_capture"
  | "io_failure"
  | "projection_repair_required";

export class RequirementSourceStoreError extends Error {
  constructor(readonly code: RequirementSourceStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RequirementSourceStoreError";
  }
}

export interface RequirementSourceCaptureInput {
  readonly workspaceRoot: string;
  readonly provider: string;
  readonly ref: string;
  readonly revision: string;
  readonly capturedAt: string;
  readonly bodyFile: string;
  readonly contextRoot?: string;
  readonly contextPaths: readonly string[];
  readonly storyIds: readonly string[];
}

export interface RequirementSourceCaptureResult {
  readonly outcome: RequirementCaptureOutcome;
  readonly workspaceId: string;
  readonly requirementPath: string;
  readonly contextCount: number;
  readonly manifest: RequirementSourceManifest;
}

export interface RequirementSourceStoreDeps {
  readonly renameFile?: (from: string, to: string) => void;
  readonly afterReadFile?: (path: string) => void;
  readonly beforeProjection?: () => void;
}

interface StableFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly content: Buffer;
}

interface StableContextFile extends StableFile {
  readonly relativePath: string;
}

const PROJECTION_JOURNAL = "projection.pending.json";

function fail(code: RequirementSourceStoreErrorCode, message: string, cause?: unknown): never {
  throw new RequirementSourceStoreError(code, message, cause === undefined ? undefined : { cause });
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function atomicWrite(path: string, content: string | Buffer, renameFile: (from: string, to: string) => void): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(temporary, content, { flag: "wx" });
    renameFile(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function stableFile(path: string, deps: RequirementSourceStoreDeps): StableFile {
  let before;
  try {
    before = lstatSync(path);
  } catch (error) {
    return fail("unsafe_context", "Requirement capture input could not be inspected", error);
  }
  if (before.isSymbolicLink() || !before.isFile()) {
    return fail("unsafe_context", "Requirement capture inputs must be regular files");
  }
  const content = readFileSync(path);
  deps.afterReadFile?.(path);
  let after;
  try {
    after = lstatSync(path);
  } catch (error) {
    return fail("source_changed", "Requirement capture input changed while it was read", error);
  }
  if (
    before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    return fail("source_changed", "Requirement capture input changed while it was read");
  }
  return {
    path,
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
    content,
  };
}

function safeRelativePath(value: string): boolean {
  if (value === "" || value !== value.trim() || value.startsWith("/") || value.startsWith("~") || value.includes("\\") || /^[A-Za-z]:/u.test(value)) {
    return false;
  }
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function contained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function rejectSymlinkSegments(root: string, relativePath: string): void {
  let cursor = root;
  for (const segment of relativePath.split("/")) {
    cursor = join(cursor, segment);
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch (error) {
      return fail("unsafe_context", "Requirement context path could not be inspected", error);
    }
    if (stat.isSymbolicLink()) fail("unsafe_context", "Requirement context cannot traverse symbolic links");
  }
}

function contextFiles(input: RequirementSourceCaptureInput, deps: RequirementSourceStoreDeps): readonly StableContextFile[] {
  if (input.contextPaths.length === 0) return [];
  if (input.contextRoot === undefined) fail("unsafe_context", "Requirement context root is required");
  let root: string;
  try {
    const rootStat = lstatSync(input.contextRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail("unsafe_context", "Requirement context root must be a real directory");
    root = realpathSync(input.contextRoot);
  } catch (error) {
    if (error instanceof RequirementSourceStoreError) throw error;
    return fail("unsafe_context", "Requirement context root could not be resolved", error);
  }
  return input.contextPaths.map((relativePath) => {
    if (!safeRelativePath(relativePath)) fail("unsafe_context", "Requirement context paths must be safe and relative");
    rejectSymlinkSegments(root, relativePath);
    let path: string;
    try {
      path = realpathSync(join(root, relativePath));
    } catch (error) {
      return fail("unsafe_context", "Requirement context path could not be resolved", error);
    }
    if (!contained(root, path)) fail("unsafe_context", "Requirement context escapes its declared root");
    return { ...stableFile(path, deps), relativePath };
  }).sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
}

function readWorkspace(root: string): WorkspaceManifest {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(root, "workspace.yaml"), "utf8"));
  } catch (error) {
    return fail("invalid_workspace", "Workspace manifest could not be read", error);
  }
  const parsed = parseWorkspaceManifest(value);
  if (!parsed.ok) fail("invalid_workspace", "Workspace manifest is invalid");
  return parsed.value;
}

function declaredSource(
  requirements: readonly { readonly provider: string; readonly ref: string }[],
  provider: string,
  ref: string,
): boolean {
  const requested = normalizeRequirementSourceReference(provider, ref);
  if (!requested.ok) return false;
  return requirements.some((candidate) => {
    const normalized = normalizeRequirementSourceReference(candidate.provider, candidate.ref);
    return normalized.ok && normalized.value.requirementId === requested.value.requirementId;
  });
}

function collectStoryIds(root: string, depth = 0): readonly string[] {
  if (depth > 10 || !existsSync(root)) return [];
  const ids: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (existsSync(join(path, "spec.md"))) ids.push(entry.name);
      ids.push(...collectStoryIds(path, depth + 1));
    }
  }
  return ids;
}

function validateStories(workspaceRoot: string, storyIds: readonly string[]): void {
  const known = new Set(collectStoryIds(join(workspaceRoot, "backlog")));
  if (storyIds.some((storyId) => !known.has(storyId))) {
    fail("story_not_found", "Every Requirement Story link must resolve inside the Workspace backlog");
  }
}

function readExisting(path: string): RequirementSourceManifest | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = parseRequirementSourceManifest(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.ok) fail("io_failure", "Requirement source index is invalid");
    return parsed.value;
  } catch (error) {
    if (error instanceof RequirementSourceStoreError) throw error;
    return fail("io_failure", "Requirement source index could not be read", error);
  }
}

function copyContextProjection(
  revisionContext: string,
  requirementPath: string,
  renameFile: (from: string, to: string) => void,
): void {
  const staging = join(requirementPath, `.context.${randomUUID()}`);
  const target = join(requirementPath, "context");
  const backup = join(requirementPath, `.context.backup.${randomUUID()}`);
  mkdirSync(staging, { recursive: true });
  const copy = (from: string, to: string): void => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const source = join(from, entry.name);
      const destination = join(to, entry.name);
      if (entry.isDirectory()) {
        mkdirSync(destination);
        copy(source, destination);
      } else {
        writeFileSync(destination, readFileSync(source), { flag: "wx" });
      }
    }
  };
  copy(revisionContext, staging);
  let movedOld = false;
  try {
    if (existsSync(target)) {
      renameFile(target, backup);
      movedOld = true;
    }
    renameFile(staging, target);
    rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (movedOld && !existsSync(target) && existsSync(backup)) {
      try { renameFile(backup, target); } catch { /* next retry repairs from the committed revision */ }
    }
    throw error;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function projectCurrent(
  requirementPath: string,
  manifest: RequirementSourceManifest,
  deps: RequirementSourceStoreDeps,
): void {
  const renameFile = deps.renameFile ?? renameSync;
  const revision = join(requirementPath, "revisions", requirementRevisionKey(manifest.revision));
  const journal = join(requirementPath, PROJECTION_JOURNAL);
  atomicWrite(journal, json({ schema: "roll.requirement-projection-journal/v1", revision: manifest.revision }), renameFile);
  try {
    deps.beforeProjection?.();
    atomicWrite(join(requirementPath, "requirement.md"), readFileSync(join(revision, "requirement.md")), renameFile);
    copyContextProjection(join(revision, "context"), requirementPath, renameFile);
    atomicWrite(join(requirementPath, "attest.md"), renderRequirementAttestProjection(manifest), renameFile);
    rmSync(journal, { force: true });
  } catch (error) {
    return fail("projection_repair_required", "Requirement revision committed but its current projection needs repair", error);
  }
}

function writeRevision(
  requirementPath: string,
  manifest: RequirementSourceManifest,
  body: StableFile,
  context: readonly StableContextFile[],
  renameFile: (from: string, to: string) => void,
): void {
  const revisionPath = join(requirementPath, "revisions", requirementRevisionKey(manifest.revision));
  if (existsSync(revisionPath)) {
    const captured = readExisting(join(revisionPath, "capture.yaml"));
    if (
      captured === undefined || captured.revision !== manifest.revision || captured.requirement.sha256 !== manifest.requirement.sha256 ||
      JSON.stringify(captured.context) !== JSON.stringify(manifest.context)
    ) {
      fail("revision_conflict", "Immutable Requirement revision already contains different evidence");
    }
    return;
  }
  const staging = join(requirementPath, `.revision.${randomUUID()}`);
  try {
    mkdirSync(join(staging, "context"), { recursive: true });
    writeFileSync(join(staging, "capture.yaml"), json(manifest), { flag: "wx" });
    writeFileSync(join(staging, "requirement.md"), body.content, { flag: "wx" });
    for (const [index, file] of context.entries()) {
      const descriptor = manifest.context[index];
      if (descriptor === undefined) fail("io_failure", "Requirement context descriptor mismatch");
      const target = join(staging, "context", descriptor.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, { flag: "wx" });
    }
    mkdirSync(dirname(revisionPath), { recursive: true });
    renameFile(staging, revisionPath);
  } catch (error) {
    if (error instanceof RequirementSourceStoreError) throw error;
    return fail("io_failure", "Requirement revision could not be committed", error);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function requirementCaptureLockPath(workspaceRoot: string, requirementId: string): string {
  return join(resolve(workspaceRoot), "runtime", "locks", "requirements", `${requirementId}.lock`);
}

export function captureRequirementSource(
  input: RequirementSourceCaptureInput,
  deps: RequirementSourceStoreDeps = {},
): RequirementSourceCaptureResult {
  let workspaceRoot: string;
  try {
    workspaceRoot = realpathSync(input.workspaceRoot);
  } catch (error) {
    return fail("invalid_workspace", "Workspace root could not be resolved", error);
  }
  const workspace = readWorkspace(workspaceRoot);
  const source = normalizeRequirementSourceReference(input.provider, input.ref);
  if (!source.ok) fail("source_not_declared", "Requirement source identity is invalid or undeclared");
  if (!declaredSource(workspace.requirements, input.provider, input.ref)) {
    fail("source_not_declared", "Requirement source must be declared in workspace.yaml before capture");
  }
  validateStories(workspaceRoot, input.storyIds);
  const requirementPath = join(workspaceRoot, "requirements", source.value.provider, source.value.requirementId);
  const lockPath = requirementCaptureLockPath(workspaceRoot, source.value.requirementId);
  const lock = acquireLock(lockPath, process.pid, {
    cycleId: `requirement:${workspace.workspaceId}:${source.value.requirementId}`,
    unparseableIsHeld: true,
  });
  if (!lock.acquired) fail("concurrent_capture", "Requirement source capture is already running");
  try {
    const renameFile = deps.renameFile ?? renameSync;
    const sourcePath = join(requirementPath, "source.yaml");
    const existing = readExisting(sourcePath);
    if (existing !== undefined && existsSync(join(requirementPath, PROJECTION_JOURNAL))) {
      projectCurrent(requirementPath, existing, deps);
    }
    const body = stableFile(resolve(input.bodyFile), deps);
    const context = contextFiles(input, deps);
    const descriptors: RequirementContextDescriptor[] = context.map((file) => ({
      path: file.relativePath,
      bytes: file.bytes,
      sha256: file.sha256,
    }));
    const planned = planRequirementCapture({
      provider: input.provider,
      ref: input.ref,
      revision: input.revision,
      capturedAt: input.capturedAt,
      requirement: { bytes: body.bytes, sha256: body.sha256 },
      context: descriptors,
      stories: input.storyIds,
    }, existing);
    if (!planned.ok) {
      const first = planned.errors[0];
      const code = first?.code === "context_limit" ? "context_limit" : first?.code === "revision_conflict" ? "revision_conflict" : "unsafe_context";
      fail(code, first?.message ?? "Requirement capture plan is invalid");
    }
    const plan = planned.value;
    if (plan.outcome === "reused") {
      return {
        outcome: plan.outcome,
        workspaceId: workspace.workspaceId,
        requirementPath,
        contextCount: plan.manifest.context.length,
        manifest: plan.manifest,
      };
    }
    if (plan.outcome === "created" || plan.outcome === "updated") {
      writeRevision(requirementPath, plan.manifest, body, context, renameFile);
    }
    try {
      atomicWrite(sourcePath, json(plan.manifest), renameFile);
    } catch (error) {
      return fail("io_failure", "Requirement source index could not be committed", error);
    }
    projectCurrent(requirementPath, plan.manifest, deps);
    return {
      outcome: plan.outcome,
      workspaceId: workspace.workspaceId,
      requirementPath,
      contextCount: plan.manifest.context.length,
      manifest: plan.manifest,
    };
  } finally {
    releaseLock(lockPath);
  }
}
