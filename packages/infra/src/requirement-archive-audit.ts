import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  classifyRequirementArchiveIntegrity,
  MAX_REQUIREMENT_BODY_BYTES,
  MAX_REQUIREMENT_CONTEXT_BYTES,
  MAX_REQUIREMENT_CONTEXT_FILES,
  requirementRevisionKey,
} from "@roll/core";
import {
  parseRequirementSourceManifest,
  type RequirementArchiveAudit,
  type RequirementArchiveFinding,
  type RequirementPreviousRevision,
  type RequirementSourceManifest,
} from "@roll/spec";

export interface RequirementArchiveAuditInput {
  readonly workspaceRoot: string;
  readonly provider: string;
  readonly requirementId: string;
  readonly limits?: Partial<RequirementArchiveAuditLimits>;
}

export interface RequirementArchiveAuditLimits {
  readonly maxSourceBytes: number;
  readonly maxCaptureBytes: number;
  readonly maxRevisions: number;
  readonly maxRevisionEntries: number;
  readonly maxContextFiles: number;
  readonly maxContextEntries: number;
  readonly maxContextBytes: number;
  readonly maxBodyBytes: number;
  readonly maxDepth: number;
}

export interface RequirementArchiveAuditDependencies {
  readonly afterStatFile?: (path: string) => void;
  readonly afterReadFile?: (path: string) => void;
  readonly beforeOpenDirectory?: (path: string) => void;
}

const DEFAULT_LIMITS: RequirementArchiveAuditLimits = {
  maxSourceBytes: 1024 * 1024,
  maxCaptureBytes: 1024 * 1024,
  maxRevisions: 256,
  maxRevisionEntries: 256,
  maxContextFiles: MAX_REQUIREMENT_CONTEXT_FILES,
  maxContextEntries: MAX_REQUIREMENT_CONTEXT_FILES * 2,
  maxContextBytes: MAX_REQUIREMENT_CONTEXT_BYTES,
  maxBodyBytes: MAX_REQUIREMENT_BODY_BYTES,
  maxDepth: 32,
};

const READ_CHUNK_BYTES = 64 * 1024;

type ReadFailureKind = "missing" | "unsafe" | "limit" | "changed";

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

type StableRead =
  | { readonly ok: true; readonly content: Buffer; readonly identity: FileIdentity }
  | { readonly ok: false; readonly kind: ReadFailureKind };

type DirectoryRead =
  | { readonly ok: true; readonly entries: readonly string[]; readonly identity: FileIdentity }
  | { readonly ok: false; readonly kind: ReadFailureKind };

function identity(stat: Stats): FileIdentity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function stableReadFile(
  path: string,
  maximumBytes: number,
  deps: RequirementArchiveAuditDependencies,
): StableRead {
  let pathBefore: Stats;
  try {
    pathBefore = lstatSync(path);
  } catch {
    return { ok: false, kind: "missing" };
  }
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile()) return { ok: false, kind: "unsafe" };
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return { ok: false, kind: "changed" };
  }
  try {
    const before = fstatSync(descriptor);
    const beforeIdentity = identity(before);
    if (!before.isFile() || !sameIdentity(identity(pathBefore), beforeIdentity)) {
      return { ok: false, kind: "changed" };
    }
    if (before.size > maximumBytes) return { ok: false, kind: "limit" };
    deps.afterStatFile?.(path);
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const remaining = maximumBytes - total;
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining + 1));
      const bytesRead = readSync(descriptor, chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximumBytes) return { ok: false, kind: "limit" };
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
    }
    const content = Buffer.concat(chunks, total);
    deps.afterReadFile?.(path);
    const after = fstatSync(descriptor);
    let pathAfter: Stats;
    try {
      pathAfter = lstatSync(path);
    } catch {
      return { ok: false, kind: "changed" };
    }
    const afterIdentity = identity(after);
    if (
      pathAfter.isSymbolicLink() || !pathAfter.isFile() ||
      !sameIdentity(beforeIdentity, afterIdentity) ||
      !sameIdentity(afterIdentity, identity(pathAfter)) ||
      after.size !== content.byteLength
    ) {
      return { ok: false, kind: "changed" };
    }
    return { ok: true, content, identity: afterIdentity };
  } catch {
    return { ok: false, kind: "changed" };
  } finally {
    closeSync(descriptor);
  }
}

function anchoredDirectoryPath(path: string, anchor: FileIdentity): boolean {
  try {
    const stat = lstatSync(path);
    return !stat.isSymbolicLink() && stat.isDirectory() &&
      realpathSync(path) === resolve(path) && sameIdentity(identity(stat), anchor);
  } catch {
    return false;
  }
}

function stableReadDirectory(
  path: string,
  maximumEntries: number,
  deps: RequirementArchiveAuditDependencies,
): DirectoryRead {
  let before: Stats;
  try {
    before = lstatSync(path);
  } catch {
    return { ok: false, kind: "missing" };
  }
  if (before.isSymbolicLink() || !before.isDirectory()) return { ok: false, kind: "unsafe" };
  try {
    if (realpathSync(path) !== resolve(path)) return { ok: false, kind: "unsafe" };
  } catch {
    return { ok: false, kind: "changed" };
  }
  let descriptor: number;
  try {
    deps.beforeOpenDirectory?.(path);
    descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch {
    return { ok: false, kind: "changed" };
  }
  const entries: string[] = [];
  try {
    const anchorBeforeStat = fstatSync(descriptor);
    const anchorBefore = identity(anchorBeforeStat);
    if (!anchorBeforeStat.isDirectory() || !sameIdentity(identity(before), anchorBefore) || !anchoredDirectoryPath(path, anchorBefore)) {
      return { ok: false, kind: "changed" };
    }
    let directory;
    try {
      directory = opendirSync(path);
      if (!anchoredDirectoryPath(path, anchorBefore)) return { ok: false, kind: "changed" };
      for (;;) {
        const entry = directory.readSync();
        if (entry === null) break;
        entries.push(entry.name);
        if (entries.length > maximumEntries) return { ok: false, kind: "limit" };
      }
    } catch {
      return { ok: false, kind: "changed" };
    } finally {
      directory?.closeSync();
    }
    const anchorAfterStat = fstatSync(descriptor);
    const anchorAfter = identity(anchorAfterStat);
    if (
      !anchorAfterStat.isDirectory() || !sameIdentity(anchorBefore, anchorAfter) ||
      !anchoredDirectoryPath(path, anchorAfter)
    ) {
      return { ok: false, kind: "changed" };
    }
    return { ok: true, entries: entries.sort(), identity: anchorAfter };
  } catch {
    return { ok: false, kind: "changed" };
  } finally {
    closeSync(descriptor);
  }
}

function directorySnapshotChanged(
  path: string,
  initial: Extract<DirectoryRead, { readonly ok: true }>,
  maximumEntries: number,
  deps: RequirementArchiveAuditDependencies,
): boolean {
  const current = stableReadDirectory(path, maximumEntries, deps);
  return !current.ok || !sameIdentity(initial.identity, current.identity) ||
    JSON.stringify(initial.entries) !== JSON.stringify(current.entries);
}

function contained(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function safeSegment(value: string, pattern: RegExp): boolean {
  return value === value.trim() && pattern.test(value);
}

function findingForReadFailure(
  failure: ReadFailureKind,
  evidencePath: string,
  revision?: string,
): RequirementArchiveFinding {
  const code = failure === "changed"
    ? "archive_changed_during_read"
    : failure === "missing" ? "revision_missing" : "unsafe_archive_path";
  return revision === undefined ? { code, evidencePath } : { code, revision, evidencePath };
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function samePreviousRevisions(
  left: readonly RequirementPreviousRevision[],
  right: readonly RequirementPreviousRevision[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedHistoryForRevision(
  source: RequirementSourceManifest,
  revision: string,
): readonly RequirementPreviousRevision[] | undefined {
  if (revision === source.revision) return source.previousRevisions;
  const index = source.previousRevisions.findIndex((entry) => entry.revision === revision);
  return index < 0 ? undefined : source.previousRevisions.slice(0, index);
}

function captureMetadataMatches(
  source: RequirementSourceManifest,
  capture: RequirementSourceManifest,
  revision: string,
): boolean {
  const expectedHistory = expectedHistoryForRevision(source, revision);
  const expectedCapturedAt = revision === source.revision
    ? source.capturedAt
    : source.previousRevisions.find((entry) => entry.revision === revision)?.capturedAt;
  if (
    expectedHistory === undefined || expectedCapturedAt === undefined ||
    capture.revision !== revision || capture.capturedAt !== expectedCapturedAt ||
    !samePreviousRevisions(capture.previousRevisions, expectedHistory)
  ) {
    return false;
  }
  if (revision !== source.revision) return true;
  return JSON.stringify(capture.requirement) === JSON.stringify(source.requirement) &&
    JSON.stringify(capture.context) === JSON.stringify(source.context) &&
    JSON.stringify(capture.attest) === JSON.stringify(source.attest) &&
    capture.stories.every((storyId) => source.stories.includes(storyId));
}

function captureIdentityMatches(
  source: RequirementSourceManifest,
  capture: RequirementSourceManifest,
): boolean {
  return capture.requirementId === source.requirementId &&
    capture.provider === source.provider && capture.ref === source.ref;
}

interface WalkState {
  entries: number;
  files: number;
}

interface ContextDirectorySnapshot {
  readonly relativePath: string;
  readonly directory: Extract<DirectoryRead, { readonly ok: true }>;
}

type ContextWalk =
  | {
      readonly ok: true;
      readonly paths: readonly string[];
      readonly directories: readonly ContextDirectorySnapshot[];
    }
  | { readonly ok: false; readonly kind: ReadFailureKind; readonly evidencePath: string };

function walkContext(
  root: string,
  relativeRoot: string,
  depth: number,
  limits: RequirementArchiveAuditLimits,
  state: WalkState,
  deps: RequirementArchiveAuditDependencies,
): ContextWalk {
  if (depth > limits.maxDepth) return { ok: false, kind: "limit", evidencePath: relativeRoot };
  const directoryPath = relativeRoot === "" ? root : join(root, relativeRoot);
  const directory = stableReadDirectory(directoryPath, limits.maxContextEntries - state.entries, deps);
  if (!directory.ok) return { ok: false, kind: directory.kind, evidencePath: relativeRoot };
  const paths: string[] = [];
  const directories: ContextDirectorySnapshot[] = [];
  for (const name of directory.entries) {
    state.entries += 1;
    if (state.entries > limits.maxContextEntries) return { ok: false, kind: "limit", evidencePath: relativeRoot };
    const relativePath = relativeRoot === "" ? name : `${relativeRoot}/${name}`;
    const path = join(root, relativePath);
    let stat: Stats;
    try {
      stat = lstatSync(path);
    } catch {
      return { ok: false, kind: "changed", evidencePath: relativePath };
    }
    if (stat.isSymbolicLink()) return { ok: false, kind: "unsafe", evidencePath: relativePath };
    if (stat.isDirectory()) {
      const nested = walkContext(root, relativePath, depth + 1, limits, state, deps);
      if (!nested.ok) return nested;
      paths.push(...nested.paths);
      directories.push(...nested.directories);
      continue;
    }
    if (!stat.isFile()) return { ok: false, kind: "unsafe", evidencePath: relativePath };
    state.files += 1;
    if (state.files > limits.maxContextFiles) return { ok: false, kind: "limit", evidencePath: relativePath };
    paths.push(relativePath);
  }
  if (directorySnapshotChanged(directoryPath, directory, limits.maxContextEntries, deps)) {
    return { ok: false, kind: "changed", evidencePath: relativeRoot };
  }
  directories.push({ relativePath: relativeRoot, directory });
  return { ok: true, paths, directories };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function scanRevision(
  requirementRoot: string,
  source: RequirementSourceManifest,
  revision: string,
  limits: RequirementArchiveAuditLimits,
  deps: RequirementArchiveAuditDependencies,
  findings: RequirementArchiveFinding[],
): void {
  const revisionKey = requirementRevisionKey(revision);
  const revisionRelative = `revisions/${revisionKey}`;
  const revisionRoot = join(requirementRoot, "revisions", revisionKey);
  const revisionDirectory = stableReadDirectory(revisionRoot, limits.maxRevisionEntries, deps);
  if (!revisionDirectory.ok) {
    findings.push(findingForReadFailure(revisionDirectory.kind, revisionRelative, revision));
    return;
  }
  const expectedRootEntries = new Set(["capture.yaml", "requirement.md", "context"]);
  for (const name of revisionDirectory.entries) {
    if (expectedRootEntries.has(name)) continue;
    const evidencePath = `${revisionRelative}/${name}`;
    try {
      const stat = lstatSync(join(revisionRoot, name));
      findings.push({
        code: stat.isSymbolicLink() ? "unsafe_archive_path" : "revision_metadata_mismatch",
        revision,
        evidencePath,
      });
    } catch {
      findings.push({ code: "archive_changed_during_read", revision, evidencePath });
    }
  }
  const captureRelative = `${revisionRelative}/capture.yaml`;
  const captureRead = stableReadFile(join(revisionRoot, "capture.yaml"), limits.maxCaptureBytes, deps);
  if (!captureRead.ok) {
    findings.push(findingForReadFailure(captureRead.kind, captureRelative, revision));
    return;
  }
  let capture: RequirementSourceManifest | undefined;
  try {
    const parsed = parseRequirementSourceManifest(JSON.parse(captureRead.content.toString("utf8")));
    if (parsed.ok) capture = parsed.value;
  } catch {
    capture = undefined;
  }
  if (capture === undefined || !captureIdentityMatches(source, capture)) {
    findings.push({ code: "manifest_invalid", revision, evidencePath: captureRelative });
    return;
  }
  if (!captureMetadataMatches(source, capture, revision)) {
    findings.push({ code: "revision_metadata_mismatch", revision, evidencePath: captureRelative });
    return;
  }

  const bodyRelative = `${revisionRelative}/requirement.md`;
  const bodyRead = stableReadFile(join(revisionRoot, "requirement.md"), limits.maxBodyBytes, deps);
  if (!bodyRead.ok) {
    findings.push(findingForReadFailure(bodyRead.kind, bodyRelative, revision));
  } else if (bodyRead.content.byteLength !== capture.requirement.bytes || sha256(bodyRead.content) !== capture.requirement.sha256) {
    findings.push({ code: "content_digest_mismatch", revision, evidencePath: bodyRelative });
  }

  const contextRelative = `${revisionRelative}/context`;
  const contextRoot = join(revisionRoot, "context");
  const walked = walkContext(contextRoot, "", 0, limits, { entries: 0, files: 0 }, deps);
  if (!walked.ok) {
    const suffix = walked.evidencePath === "" ? "" : `/${walked.evidencePath}`;
    findings.push(findingForReadFailure(walked.kind, `${contextRelative}${suffix}`, revision));
    return;
  }
  const actualPaths = walked.paths.slice().sort(compareText);
  const expectedPaths = capture.context.map((descriptor) => descriptor.path).slice().sort(compareText);
  for (const missing of expectedPaths.filter((path) => !actualPaths.includes(path))) {
    findings.push({ code: "revision_missing", revision, evidencePath: `${contextRelative}/${missing}` });
  }
  for (const extra of actualPaths.filter((path) => !expectedPaths.includes(path))) {
    findings.push({ code: "revision_metadata_mismatch", revision, evidencePath: `${contextRelative}/${extra}` });
  }
  let remainingBytes = limits.maxContextBytes;
  for (const descriptor of capture.context.slice().sort((left, right) => compareText(left.path, right.path))) {
    if (!actualPaths.includes(descriptor.path)) continue;
    const relativePath = `${contextRelative}/${descriptor.path}`;
    const read = stableReadFile(join(contextRoot, descriptor.path), remainingBytes, deps);
    if (!read.ok) {
      findings.push(findingForReadFailure(read.kind, relativePath, revision));
      continue;
    }
    remainingBytes -= read.content.byteLength;
    if (remainingBytes < 0) {
      findings.push({ code: "unsafe_archive_path", revision, evidencePath: relativePath });
      break;
    }
    if (read.content.byteLength !== descriptor.bytes || sha256(read.content) !== descriptor.sha256) {
      findings.push({ code: "context_digest_mismatch", revision, evidencePath: relativePath });
    }
  }
  for (const snapshot of walked.directories) {
    const directoryPath = snapshot.relativePath === "" ? contextRoot : join(contextRoot, snapshot.relativePath);
    if (!directorySnapshotChanged(directoryPath, snapshot.directory, limits.maxContextEntries, deps)) continue;
    const suffix = snapshot.relativePath === "" ? "" : `/${snapshot.relativePath}`;
    findings.push({
      code: "archive_changed_during_read",
      revision,
      evidencePath: `${contextRelative}${suffix}`,
    });
    break;
  }
  if (directorySnapshotChanged(revisionRoot, revisionDirectory, limits.maxRevisionEntries, deps)) {
    findings.push({ code: "archive_changed_during_read", revision, evidencePath: revisionRelative });
  }
}

function validLimits(input: Partial<RequirementArchiveAuditLimits> | undefined): RequirementArchiveAuditLimits | undefined {
  const limits = { ...DEFAULT_LIMITS, ...input };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) return undefined;
  }
  return limits;
}

export function auditRequirementArchive(
  input: RequirementArchiveAuditInput,
  deps: RequirementArchiveAuditDependencies = {},
): RequirementArchiveAudit {
  const limits = validLimits(input.limits);
  const findings: RequirementArchiveFinding[] = [];
  const fallback = (finding: RequirementArchiveFinding): RequirementArchiveAudit =>
    classifyRequirementArchiveIntegrity({
      requirementId: input.requirementId,
      checkedRevisions: [],
      findings: [finding],
    });
  if (limits === undefined) {
    return fallback({ code: "unsafe_archive_path", evidencePath: "." });
  }
  if (
    !safeSegment(input.provider, /^[a-z][a-z0-9_]*$/u) ||
    !safeSegment(input.requirementId, /^req-[0-9a-f]{12}$/u)
  ) {
    return fallback({ code: "manifest_invalid", evidencePath: "source.yaml" });
  }
  let workspaceRoot: string;
  try {
    workspaceRoot = realpathSync(resolve(input.workspaceRoot));
  } catch {
    return fallback({ code: "unsafe_archive_path", evidencePath: "." });
  }
  const requirementRoot = join(workspaceRoot, "requirements", input.provider, input.requirementId);
  try {
    const canonicalRoot = realpathSync(requirementRoot);
    if (!contained(workspaceRoot, canonicalRoot) || canonicalRoot !== requirementRoot) {
      return fallback({ code: "unsafe_archive_path", evidencePath: "." });
    }
  } catch {
    return fallback({ code: "manifest_invalid", evidencePath: "source.yaml" });
  }
  const sourceRead = stableReadFile(join(requirementRoot, "source.yaml"), limits.maxSourceBytes, deps);
  if (!sourceRead.ok) {
    const finding = sourceRead.kind === "missing"
      ? { code: "manifest_invalid" as const, evidencePath: "source.yaml" }
      : findingForReadFailure(sourceRead.kind, "source.yaml");
    return fallback(finding);
  }
  let source: RequirementSourceManifest | undefined;
  try {
    const parsed = parseRequirementSourceManifest(JSON.parse(sourceRead.content.toString("utf8")));
    if (parsed.ok) source = parsed.value;
  } catch {
    source = undefined;
  }
  if (source === undefined || source.requirementId !== input.requirementId || source.provider !== input.provider) {
    return fallback({ code: "manifest_invalid", evidencePath: "source.yaml" });
  }
  const graph = [source.revision, ...source.previousRevisions.map((entry) => entry.revision).reverse()];
  if (new Set(graph).size !== graph.length || graph.length > limits.maxRevisions) {
    return classifyRequirementArchiveIntegrity({
      requirementId: source.requirementId,
      checkedRevisions: graph.slice(0, limits.maxRevisions),
      findings: [{ code: graph.length > limits.maxRevisions ? "unsafe_archive_path" : "manifest_invalid", evidencePath: "source.yaml" }],
    });
  }

  const revisionsRoot = join(requirementRoot, "revisions");
  const revisionsDirectory = stableReadDirectory(revisionsRoot, limits.maxRevisionEntries, deps);
  if (!revisionsDirectory.ok) {
    findings.push(findingForReadFailure(revisionsDirectory.kind, "revisions"));
  } else {
    const expectedByKey = new Map(graph.map((revision) => [requirementRevisionKey(revision), revision]));
    const blockedKeys = new Set<string>();
    for (const key of revisionsDirectory.entries) {
      const path = join(revisionsRoot, key);
      const revision = expectedByKey.get(key);
      let stat: Stats;
      try {
        stat = lstatSync(path);
      } catch {
        findings.push(revision === undefined
          ? { code: "archive_changed_during_read", evidencePath: `revisions/${key}` }
          : { code: "archive_changed_during_read", revision, evidencePath: `revisions/${key}` });
        if (revision !== undefined) blockedKeys.add(key);
        continue;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        findings.push(revision === undefined
          ? { code: "unsafe_archive_path", evidencePath: `revisions/${key}` }
          : { code: "unsafe_archive_path", revision, evidencePath: `revisions/${key}` });
        if (revision !== undefined) blockedKeys.add(key);
      } else if (revision === undefined) {
        findings.push({ code: "revision_metadata_mismatch", evidencePath: `revisions/${key}` });
      }
    }
    for (const revision of graph) {
      if (!blockedKeys.has(requirementRevisionKey(revision))) {
        scanRevision(requirementRoot, source, revision, limits, deps, findings);
      }
    }
    if (directorySnapshotChanged(revisionsRoot, revisionsDirectory, limits.maxRevisionEntries, deps)) {
      findings.push({ code: "archive_changed_during_read", evidencePath: "revisions" });
    }
  }

  const sourceAfter = stableReadFile(join(requirementRoot, "source.yaml"), limits.maxSourceBytes, deps);
  if (
    !sourceAfter.ok || !sameIdentity(sourceRead.identity, sourceAfter.identity) ||
    !sourceRead.content.equals(sourceAfter.content)
  ) {
    findings.push({ code: "archive_changed_during_read", evidencePath: "source.yaml" });
  }
  return classifyRequirementArchiveIntegrity({
    requirementId: source.requirementId,
    checkedRevisions: graph,
    findings,
  });
}
