import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { normalizeRequirementSourceReference } from "@roll/core";
import {
  WORKSPACE_METADATA_REFERENCE_INDEX_V1,
  parseIssueManifest,
  parseRequirementSourceManifest,
  parseWorkspaceManifest,
  type RequirementSourceReference,
  type WorkspaceMetadataAdditionalFact,
  type WorkspaceMetadataReferenceIndex,
} from "@roll/spec";

const MAX_AUTHORITY_BYTES = 4 * 1024 * 1024;

export type WorkspaceReferenceIndexErrorCode =
  | "invalid_workspace"
  | "invalid_issue"
  | "invalid_requirement_archive"
  | "invalid_additional_fact"
  | "unsafe_authority_path"
  | "authority_changed_during_read"
  | "authority_too_large";

export class WorkspaceReferenceIndexError extends Error {
  constructor(readonly code: WorkspaceReferenceIndexErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspaceReferenceIndexError";
  }
}

export interface WorkspaceReferenceIndexDependencies {
  readonly afterRead?: (path: string) => void;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function contained(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function authorityPath(root: string, path: string): string {
  const rel = relative(root, path).split(sep).join("/");
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    throw new WorkspaceReferenceIndexError("unsafe_authority_path", "Workspace authority path escapes its root");
  }
  return rel;
}

function stableAuthorityFile(
  workspaceRoot: string,
  path: string,
  deps: WorkspaceReferenceIndexDependencies,
): { readonly bytes: Buffer; readonly sha256: string; readonly authorityPath: string } {
  const relativePath = authorityPath(workspaceRoot, path);
  let before: Stats;
  try {
    before = lstatSync(path);
    if (before.isSymbolicLink() || !before.isFile() || before.size > MAX_AUTHORITY_BYTES) {
      throw new WorkspaceReferenceIndexError(
        before.size > MAX_AUTHORITY_BYTES ? "authority_too_large" : "unsafe_authority_path",
        `Workspace authority file is unsafe: ${relativePath}`,
      );
    }
    const canonical = realpathSync(path);
    if (!contained(workspaceRoot, canonical) || canonical !== path) {
      throw new WorkspaceReferenceIndexError("unsafe_authority_path", `Workspace authority file escapes its root: ${relativePath}`);
    }
    const bytes = readFileSync(path);
    deps.afterRead?.(path);
    const after = lstatSync(path);
    if (!sameFile(before, after) || bytes.length !== before.size) {
      throw new WorkspaceReferenceIndexError("authority_changed_during_read", `Workspace authority changed during read: ${relativePath}`);
    }
    return { bytes, sha256: sha256(bytes), authorityPath: relativePath };
  } catch (error) {
    if (error instanceof WorkspaceReferenceIndexError) throw error;
    throw new WorkspaceReferenceIndexError("unsafe_authority_path", `Workspace authority file could not be read safely: ${relativePath}`, { cause: error });
  }
}

function safeDirectoryEntries(workspaceRoot: string, path: string): readonly { readonly name: string; readonly directory: boolean }[] {
  if (!existsSync(path)) return [];
  const relativePath = authorityPath(workspaceRoot, path);
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(path) !== path) {
      throw new WorkspaceReferenceIndexError("unsafe_authority_path", `Workspace authority directory is unsafe: ${relativePath}`);
    }
    return readdirSync(path, { withFileTypes: true }).map((entry) => {
      if (entry.isSymbolicLink()) {
        throw new WorkspaceReferenceIndexError("unsafe_authority_path", `Workspace authority contains a symlink: ${relativePath}/${entry.name}`);
      }
      return { name: entry.name, directory: entry.isDirectory() };
    }).sort((left, right) => compareText(left.name, right.name));
  } catch (error) {
    if (error instanceof WorkspaceReferenceIndexError) throw error;
    throw new WorkspaceReferenceIndexError("unsafe_authority_path", `Workspace authority directory could not be scanned: ${relativePath}`, { cause: error });
  }
}

function parseJson(bytes: Buffer, code: WorkspaceReferenceIndexErrorCode, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new WorkspaceReferenceIndexError(code, `${label} is not valid JSON`, { cause: error });
  }
}

function canonicalRequirement(source: RequirementSourceReference, code: WorkspaceReferenceIndexErrorCode): RequirementSourceReference {
  const normalized = normalizeRequirementSourceReference(source.provider, source.ref);
  if (!normalized.ok) throw new WorkspaceReferenceIndexError(code, "Workspace authority contains an invalid Requirement identity");
  return { provider: normalized.value.provider, ref: normalized.value.ref };
}

function collectIssueReferences(
  workspaceRoot: string,
  workspaceId: string,
  deps: WorkspaceReferenceIndexDependencies,
): WorkspaceMetadataReferenceIndex["issues"] {
  const issuesRoot = join(workspaceRoot, "issues");
  const issues = [];
  for (const entry of safeDirectoryEntries(workspaceRoot, issuesRoot)) {
    if (!entry.directory) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(entry.name)) {
      throw new WorkspaceReferenceIndexError("invalid_issue", `Issue directory has an invalid identity: ${entry.name}`);
    }
    const manifestPath = join(issuesRoot, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) {
      throw new WorkspaceReferenceIndexError("invalid_issue", `Issue ${entry.name} manifest is missing`);
    }
    const manifestFile = stableAuthorityFile(workspaceRoot, manifestPath, deps);
    const parsed = parseIssueManifest(parseJson(manifestFile.bytes, "invalid_issue", `Issue ${entry.name} manifest`), {
      workspaceId,
      storyId: entry.name,
    });
    if (!parsed.ok) throw new WorkspaceReferenceIndexError("invalid_issue", `Issue ${entry.name} manifest is invalid`);
    issues.push({
      storyId: entry.name,
      manifestSha256: manifestFile.sha256,
      requirementKeys: parsed.value.requirements.map((source) => canonicalRequirement(source, "invalid_issue"))
        .sort((left, right) => compareText(`${left.provider}\0${left.ref}`, `${right.provider}\0${right.ref}`)),
      repoIds: [...new Set(parsed.value.repositories.map((repository) => repository.repoId))].sort(compareText),
    });
  }
  return issues;
}

function collectRequirementArchives(
  workspaceRoot: string,
  deps: WorkspaceReferenceIndexDependencies,
): WorkspaceMetadataReferenceIndex["requirementArchives"] {
  const requirementsRoot = join(workspaceRoot, "requirements");
  const archives = [];
  for (const providerEntry of safeDirectoryEntries(workspaceRoot, requirementsRoot)) {
    if (!providerEntry.directory) continue;
    const providerRoot = join(requirementsRoot, providerEntry.name);
    for (const requirementEntry of safeDirectoryEntries(workspaceRoot, providerRoot)) {
      if (!requirementEntry.directory) continue;
      const sourceFile = stableAuthorityFile(workspaceRoot, join(providerRoot, requirementEntry.name, "source.yaml"), deps);
      const parsed = parseRequirementSourceManifest(parseJson(
        sourceFile.bytes,
        "invalid_requirement_archive",
        `Requirement ${requirementEntry.name} source manifest`,
      ));
      if (
        !parsed.ok || parsed.value.requirementId !== requirementEntry.name ||
        parsed.value.provider !== providerEntry.name
      ) {
        throw new WorkspaceReferenceIndexError("invalid_requirement_archive", `Requirement ${requirementEntry.name} archive identity is invalid`);
      }
      archives.push({
        requirementId: parsed.value.requirementId,
        source: canonicalRequirement(parsed.value, "invalid_requirement_archive"),
        manifestSha256: sourceFile.sha256,
      });
    }
  }
  return archives.sort((left, right) => compareText(left.requirementId, right.requirementId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectEmbeddedReferences(value: unknown): {
  readonly requirements: readonly RequirementSourceReference[];
  readonly repoIds: readonly string[];
} {
  const requirementMap = new Map<string, RequirementSourceReference>();
  const repoIds = new Set<string>();
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    if (!isRecord(candidate)) return;
    if (typeof candidate["repoId"] === "string" && candidate["repoId"] !== "") repoIds.add(candidate["repoId"]);
    if (typeof candidate["provider"] === "string" && typeof candidate["ref"] === "string") {
      const normalized = normalizeRequirementSourceReference(candidate["provider"], candidate["ref"]);
      if (normalized.ok) requirementMap.set(normalized.value.requirementId, {
        provider: normalized.value.provider,
        ref: normalized.value.ref,
      });
    }
    for (const nested of Object.values(candidate)) visit(nested);
  };
  visit(value);
  return {
    requirements: [...requirementMap.values()].sort((left, right) => compareText(`${left.provider}\0${left.ref}`, `${right.provider}\0${right.ref}`)),
    repoIds: [...repoIds].sort(compareText),
  };
}

function collectIssueEventFacts(
  workspaceRoot: string,
  deps: WorkspaceReferenceIndexDependencies,
): readonly WorkspaceMetadataAdditionalFact[] {
  const facts: WorkspaceMetadataAdditionalFact[] = [];
  const issuesRoot = join(workspaceRoot, "issues");
  for (const entry of safeDirectoryEntries(workspaceRoot, issuesRoot)) {
    if (!entry.directory) continue;
    const path = join(issuesRoot, entry.name, "events.jsonl");
    if (!existsSync(path)) continue;
    const file = stableAuthorityFile(workspaceRoot, path, deps);
    const records: unknown[] = [];
    for (const [index, line] of file.bytes.toString("utf8").split(/\r?\n/u).entries()) {
      if (line.trim() === "") continue;
      try {
        records.push(JSON.parse(line) as unknown);
      } catch (error) {
        throw new WorkspaceReferenceIndexError("invalid_additional_fact", `Issue event line ${index + 1} is invalid`, { cause: error });
      }
    }
    const references = collectEmbeddedReferences(records);
    facts.push({
      kind: "event",
      authorityPath: file.authorityPath,
      sha256: file.sha256,
      requirementKeys: references.requirements,
      repoIds: references.repoIds,
    });
  }
  return facts.sort((left, right) => compareText(left.authorityPath, right.authorityPath));
}

export function collectWorkspaceMetadataReferenceIndex(
  input: { readonly workspaceRoot: string },
  deps: WorkspaceReferenceIndexDependencies = {},
): WorkspaceMetadataReferenceIndex {
  let workspaceRoot: string;
  try {
    workspaceRoot = realpathSync(input.workspaceRoot);
    const stat = lstatSync(workspaceRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("not a regular directory");
  } catch (error) {
    throw new WorkspaceReferenceIndexError("invalid_workspace", "Workspace root could not be resolved safely", { cause: error });
  }
  const manifestFile = stableAuthorityFile(workspaceRoot, join(workspaceRoot, "workspace.yaml"), deps);
  const parsedWorkspace = parseWorkspaceManifest(parseJson(manifestFile.bytes, "invalid_workspace", "Workspace manifest"));
  if (!parsedWorkspace.ok) throw new WorkspaceReferenceIndexError("invalid_workspace", "Workspace manifest is invalid");
  return {
    schema: WORKSPACE_METADATA_REFERENCE_INDEX_V1,
    workspaceId: parsedWorkspace.value.workspaceId,
    issues: collectIssueReferences(workspaceRoot, parsedWorkspace.value.workspaceId, deps),
    requirementArchives: collectRequirementArchives(workspaceRoot, deps),
    additionalFacts: collectIssueEventFacts(workspaceRoot, deps),
  };
}
