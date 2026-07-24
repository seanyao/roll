import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  REPOSITORY_BINDING_V1,
  WORKSPACE_EXECUTION_CONTEXT_V1,
  type CycleRepositoryExecutionContext,
  type IssueManifest,
  type RepositoryBinding,
  type WorkspaceContextScope,
  type WorkspaceExecutionAuthorityPaths,
  type WorkspaceExecutionContextResolutionSource,
  type WorkspaceExecutionContextV1,
  type WorkspaceManifest,
  type WorkspaceMatchEvidence,
} from "@roll/spec";
import type { WorkspaceRegistryCandidate } from "./target.js";

export interface WorkspaceExecutionContextFactsV1 {
  readonly candidate: WorkspaceRegistryCandidate;
  readonly manifest: WorkspaceManifest;
  readonly authorities: WorkspaceExecutionAuthorityPaths;
  readonly issue?: {
    readonly manifest: IssueManifest;
    readonly manifestPath: string;
    readonly execution: CycleRepositoryExecutionContext;
  };
}

export type WorkspaceExecutionContextErrorCode =
  | "invalid_execution_context"
  | "workspace_identity_mismatch"
  | "authority_path_mismatch"
  | "issue_identity_mismatch"
  | "repository_context_mismatch"
  | "missing_execution_context"
  | "workspace_lifecycle_forbidden"
  | "missing_issue_context"
  | "missing_repository_context";

export interface WorkspaceExecutionContextError {
  readonly code: WorkspaceExecutionContextErrorCode;
  readonly message: string;
}

export type WorkspaceExecutionContextBuildResult =
  | { readonly ok: true; readonly context: WorkspaceExecutionContextV1 }
  | { readonly ok: false; readonly error: WorkspaceExecutionContextError };

export type WorkspaceExecutionContextScopeResult =
  | { readonly ok: true; readonly context: WorkspaceExecutionContextV1 | undefined }
  | { readonly ok: false; readonly error: WorkspaceExecutionContextError };

function failure(
  code: WorkspaceExecutionContextErrorCode,
  message: string,
): { readonly ok: false; readonly error: WorkspaceExecutionContextError } {
  return { ok: false, error: { code, message } };
}

function contained(root: string, target: string): boolean {
  const child = relative(root, target);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function canonicalAbsolute(path: string): boolean {
  return isAbsolute(path) && resolve(path) === path;
}

export function deriveWorkspaceExecutionAuthorities(canonicalRoot: string): WorkspaceExecutionAuthorityPaths {
  return {
    backlog: join(canonicalRoot, "backlog", "index.md"),
    features: join(canonicalRoot, "features"),
    design: join(canonicalRoot, "design"),
    requirements: join(canonicalRoot, "requirements"),
    policy: join(canonicalRoot, "policy.yaml"),
    evidence: join(canonicalRoot, "evidence"),
    toolDumps: join(canonicalRoot, "runtime", "tool-dumps"),
    events: join(canonicalRoot, "runtime", "events"),
    runtime: join(canonicalRoot, "runtime"),
    locks: join(canonicalRoot, "runtime", "locks"),
  };
}

function sameAuthorities(
  actual: WorkspaceExecutionAuthorityPaths,
  expected: WorkspaceExecutionAuthorityPaths,
): boolean {
  return Object.keys(actual).length === Object.keys(expected).length && Object.keys(expected).every((key) => (
    actual[key as keyof WorkspaceExecutionAuthorityPaths] === expected[key as keyof WorkspaceExecutionAuthorityPaths]
  ));
}

function validSha(value: string): boolean {
  return /^[0-9a-f]{40,64}$/u.test(value);
}

function bindingIndex(bindings: readonly RepositoryBinding[]): ReadonlyMap<string, RepositoryBinding> | undefined {
  const byId = new Map<string, RepositoryBinding>();
  const aliases = new Set<string>();
  for (const binding of bindings) {
    if (byId.has(binding.repoId) || aliases.has(binding.alias)) return undefined;
    byId.set(binding.repoId, binding);
    aliases.add(binding.alias);
  }
  return byId;
}

function validateIssue(
  facts: WorkspaceExecutionContextFactsV1,
): WorkspaceExecutionContextError | undefined {
  const issue = facts.issue;
  if (issue === undefined) return undefined;
  const workspaceId = facts.candidate.workspaceId;
  if (issue.manifest.workspaceId !== workspaceId || issue.execution.workspaceId !== workspaceId) {
    return { code: "issue_identity_mismatch", message: "Issue identity does not match the selected Workspace" };
  }
  const issueRoot = join(facts.candidate.canonicalRoot, "issues", issue.manifest.storyId);
  if (
    !canonicalAbsolute(issue.manifestPath) || issue.manifestPath !== join(issueRoot, "manifest.json") ||
    issue.execution.issueRoot !== issueRoot
  ) {
    return { code: "issue_identity_mismatch", message: "Issue authority paths do not match the selected Workspace" };
  }
  const bindings = bindingIndex(facts.manifest.repositories);
  if (bindings === undefined) {
    return { code: "repository_context_mismatch", message: "Workspace repository bindings contain duplicate identities" };
  }
  const repositories = issue.execution.repositories;
  const targets = issue.manifest.repositories;
  if (Object.keys(repositories).length !== targets.length || targets.length === 0) {
    return { code: "repository_context_mismatch", message: "Issue repository execution map is incomplete" };
  }
  const aliases = new Set<string>();
  for (const target of targets) {
    if (aliases.has(target.alias)) {
      return { code: "repository_context_mismatch", message: "Issue repository aliases are not unique" };
    }
    aliases.add(target.alias);
    const binding = bindings.get(target.repoId);
    const repository = repositories[target.repoId];
    if (
      binding === undefined || binding.alias !== target.alias || repository === undefined ||
      repository.repoId !== target.repoId || repository.alias !== target.alias ||
      repository.access !== target.access || repository.requiredDelivery !== target.requiredDelivery ||
      repository.dependsOnRepo !== target.dependsOnRepo ||
      (target.access === "write"
        ? repository.noChangePolicy !== target.noChangePolicy
        : repository.noChangePolicy !== undefined) ||
      !canonicalAbsolute(repository.worktreePath) ||
      repository.worktreePath !== join(issueRoot, target.alias) ||
      !contained(issueRoot, repository.worktreePath) ||
      !validSha(repository.baseSha) || !validSha(repository.headSha) ||
      !Array.isArray(repository.commands.test) || !Array.isArray(repository.commands.integration)
    ) {
      return { code: "repository_context_mismatch", message: `Repository execution facts do not match Issue target ${target.alias}` };
    }
  }
  return undefined;
}

function freezeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const entry of value) freezeValue(entry);
    return Object.freeze(value);
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) freezeValue(entry);
    return Object.freeze(value);
  }
  return value;
}

function immutableSerializableSnapshot<T>(value: T): T | undefined {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return undefined;
    const snapshot = JSON.parse(serialized) as unknown;
    return freezeValue(snapshot) as T;
  } catch {
    return undefined;
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is UnknownRecord {
  if (!isRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function validEvidence(value: unknown): boolean {
  if (!exactRecord(value, ["kind", "value", "hard", "score", "source", "provenance", "detail"])) return false;
  return ["issue_exact", "requirement_source_exact", "repository_exact", "path_contained", "semantic_supported"].includes(String(value["kind"])) &&
    typeof value["value"] === "string" && typeof value["hard"] === "boolean" &&
    typeof value["score"] === "number" && Number.isFinite(value["score"]) &&
    typeof value["source"] === "string" &&
    ["explicit_user", "cli_argument", "issue_manifest", "cwd_repository", "deterministic_extraction", "semantic_inference"].includes(String(value["provenance"])) &&
    typeof value["detail"] === "string";
}

function runtimeBindingIndex(value: unknown): ReadonlyMap<string, UnknownRecord> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const byId = new Map<string, UnknownRecord>();
  const aliases = new Set<string>();
  for (const entry of value) {
    if (!exactRecord(entry, ["schema", "repoId", "alias", "remote", "integrationBranch", "provider", "workflow"])) {
      return undefined;
    }
    const workflow = entry["workflow"];
    if (
      entry["schema"] !== REPOSITORY_BINDING_V1 || !nonEmptyString(entry["repoId"]) ||
      !nonEmptyString(entry["alias"]) || !nonEmptyString(entry["remote"]) ||
      !nonEmptyString(entry["integrationBranch"]) || !nonEmptyString(entry["provider"]) ||
      !exactRecord(workflow, ["branchPattern", "requiredChecks"]) ||
      !nonEmptyString(workflow["branchPattern"]) || !stringArray(workflow["requiredChecks"]) ||
      byId.has(entry["repoId"]) || aliases.has(entry["alias"])
    ) return undefined;
    byId.set(entry["repoId"], entry);
    aliases.add(entry["alias"]);
  }
  return byId;
}

function validateContextSnapshot(
  context: unknown,
): WorkspaceExecutionContextError | undefined {
  if (!exactRecord(context, ["schema", "workspace", "resolution", "bindings", "authorities"], ["issue"])) {
    return { code: "invalid_execution_context", message: "Workspace execution context has an invalid or open shape" };
  }
  if (context["schema"] !== WORKSPACE_EXECUTION_CONTEXT_V1) {
    return { code: "invalid_execution_context", message: "Workspace execution context schema is unsupported" };
  }
  const workspace = context["workspace"];
  if (
    !exactRecord(workspace, ["workspaceId", "root", "canonicalRoot", "lifecycle"]) ||
    !nonEmptyString(workspace["workspaceId"]) || !nonEmptyString(workspace["root"]) ||
    !nonEmptyString(workspace["canonicalRoot"]) || !canonicalAbsolute(workspace["root"]) ||
    !canonicalAbsolute(workspace["canonicalRoot"]) ||
    !["registered", "active", "paused", "archived"].includes(String(workspace["lifecycle"]))
  ) {
    return { code: "invalid_execution_context", message: "Workspace execution context identity is invalid" };
  }
  const resolution = context["resolution"];
  if (
    !exactRecord(resolution, ["source", "evidence"]) ||
    !["explicit", "environment", "cwd_manifest", "issue_manifest", "requirement_discovery"].includes(String(resolution["source"])) ||
    !Array.isArray(resolution["evidence"]) || !resolution["evidence"].every(validEvidence)
  ) {
    return { code: "invalid_execution_context", message: "Workspace execution context resolution evidence is invalid" };
  }
  const authorities = context["authorities"];
  const authorityKeys = ["backlog", "features", "design", "requirements", "policy", "evidence", "toolDumps", "events", "runtime", "locks"] as const;
  if (!sameAuthorities(
    exactRecord(authorities, authorityKeys) && authorityKeys.every((key) => nonEmptyString(authorities[key]))
      ? authorities as unknown as WorkspaceExecutionAuthorityPaths
      : {} as WorkspaceExecutionAuthorityPaths,
    deriveWorkspaceExecutionAuthorities(workspace["canonicalRoot"]),
  )) {
    return { code: "authority_path_mismatch", message: "Workspace execution context authority paths are invalid" };
  }
  const bindings = runtimeBindingIndex(context["bindings"]);
  if (bindings === undefined) {
    return { code: "repository_context_mismatch", message: "Workspace execution context bindings are invalid" };
  }
  const issue = context["issue"];
  if (issue === undefined) return undefined;
  if (!exactRecord(issue, ["storyId", "manifestPath", "execution"])) {
    return { code: "invalid_execution_context", message: "Workspace execution context Issue has an invalid or open shape" };
  }
  const execution = issue["execution"];
  if (!exactRecord(execution, ["workspaceId", "issueRoot", "repositories"])) {
    return { code: "invalid_execution_context", message: "Workspace execution context Issue execution has an invalid or open shape" };
  }
  if (!nonEmptyString(issue["storyId"]) || !nonEmptyString(issue["manifestPath"]) ||
      !nonEmptyString(execution["workspaceId"]) || !nonEmptyString(execution["issueRoot"])) {
    return { code: "issue_identity_mismatch", message: "Workspace execution context Issue identity is invalid" };
  }
  const issueRoot = join(workspace["canonicalRoot"], "issues", issue["storyId"]);
  if (
    issue["manifestPath"] !== join(issueRoot, "manifest.json") ||
    execution["workspaceId"] !== workspace["workspaceId"] || execution["issueRoot"] !== issueRoot
  ) {
    return { code: "issue_identity_mismatch", message: "Workspace execution context Issue identity is invalid" };
  }
  const repositories = execution["repositories"];
  if (!isRecord(repositories) || Object.keys(repositories).length === 0) {
    return { code: "repository_context_mismatch", message: "Workspace execution context repository map is empty" };
  }
  for (const [repoId, repository] of Object.entries(repositories)) {
    const binding = bindings.get(repoId);
    if (!exactRecord(repository, [
      "repoId",
      "alias",
      "access",
      "requiredDelivery",
      "worktreePath",
      "baseSha",
      "headSha",
      "commands",
    ], ["noChangePolicy", "dependsOnRepo"])) {
      return { code: "repository_context_mismatch", message: `Workspace execution context repository ${repoId} has an invalid or open shape` };
    }
    const commands = repository["commands"];
    if (
      !exactRecord(commands, ["test", "integration"]) ||
      !stringArray(commands["test"]) || !stringArray(commands["integration"])
    ) {
      return { code: "repository_context_mismatch", message: `Workspace execution context repository ${repoId} commands are invalid` };
    }
    if (
      binding === undefined || repository["repoId"] !== repoId || binding["alias"] !== repository["alias"] ||
      !nonEmptyString(repository["alias"]) ||
      (repository["access"] !== "read" && repository["access"] !== "write") ||
      typeof repository["requiredDelivery"] !== "boolean" ||
      (repository["access"] === "read" && (repository["requiredDelivery"] || repository["noChangePolicy"] !== undefined)) ||
      (repository["access"] === "write" && !["changes_required", "no_change_allowed"].includes(String(repository["noChangePolicy"]))) ||
      (repository["dependsOnRepo"] !== undefined && !nonEmptyString(repository["dependsOnRepo"])) ||
      !nonEmptyString(repository["worktreePath"]) || repository["worktreePath"] !== join(issueRoot, repository["alias"]) ||
      !contained(issueRoot, repository["worktreePath"]) ||
      !nonEmptyString(repository["baseSha"]) || !validSha(repository["baseSha"]) ||
      !nonEmptyString(repository["headSha"]) || !validSha(repository["headSha"])
    ) {
      return { code: "repository_context_mismatch", message: `Workspace execution context repository ${repoId} is invalid` };
    }
  }
  return undefined;
}

export function buildWorkspaceExecutionContext(input: {
  readonly facts: WorkspaceExecutionContextFactsV1;
  readonly source: WorkspaceExecutionContextResolutionSource;
  readonly evidence: readonly WorkspaceMatchEvidence[];
}): WorkspaceExecutionContextBuildResult {
  const { candidate, manifest } = input.facts;
  if (
    candidate.pathState !== "valid" || !canonicalAbsolute(candidate.root) ||
    !canonicalAbsolute(candidate.canonicalRoot)
  ) {
    return failure("invalid_execution_context", "Selected Workspace target is not a canonical valid registry fact");
  }
  if (
    candidate.workspaceId !== candidate.manifestWorkspaceId ||
    candidate.workspaceId !== manifest.workspaceId
  ) {
    return failure("workspace_identity_mismatch", "Registry and Workspace manifest identities do not match");
  }
  if (bindingIndex(manifest.repositories) === undefined || manifest.repositories.length === 0) {
    return failure("repository_context_mismatch", "Workspace repository bindings are incomplete or duplicated");
  }
  const expectedAuthorities = deriveWorkspaceExecutionAuthorities(candidate.canonicalRoot);
  if (!sameAuthorities(input.facts.authorities, expectedAuthorities)) {
    return failure("authority_path_mismatch", "Workspace authority paths are not derived from the canonical root");
  }
  const issueError = validateIssue(input.facts);
  if (issueError !== undefined) return { ok: false, error: issueError };

  const context: WorkspaceExecutionContextV1 = {
    schema: WORKSPACE_EXECUTION_CONTEXT_V1,
    workspace: {
      workspaceId: candidate.workspaceId,
      root: candidate.root,
      canonicalRoot: candidate.canonicalRoot,
      lifecycle: candidate.lifecycle,
    },
    resolution: { source: input.source, evidence: input.evidence },
    bindings: manifest.repositories,
    ...(input.facts.issue === undefined ? {} : {
      issue: {
        storyId: input.facts.issue.manifest.storyId,
        manifestPath: input.facts.issue.manifestPath,
        execution: input.facts.issue.execution,
      },
    }),
    authorities: input.facts.authorities,
  };
  const snapshot = immutableSerializableSnapshot(context);
  if (snapshot === undefined) {
    return failure("invalid_execution_context", "Workspace execution context is not serializable");
  }
  const validationError = validateContextSnapshot(snapshot);
  return validationError === undefined ? { ok: true, context: snapshot } : { ok: false, error: validationError };
}

export function resolveWorkspaceExecutionContextScope(input: {
  readonly scope: WorkspaceContextScope;
  readonly context: WorkspaceExecutionContextV1 | undefined;
}): WorkspaceExecutionContextScopeResult {
  if (input.context === undefined) {
    return input.scope === "machine_only" || input.scope === "workspace_optional_read" || input.scope === "legacy_migration_only"
      ? { ok: true, context: undefined }
      : failure("missing_execution_context", `Scope ${input.scope} requires a Workspace execution context`);
  }
  const validationError = validateContextSnapshot(input.context);
  if (validationError !== undefined) return { ok: false, error: validationError };
  const snapshot = immutableSerializableSnapshot(input.context);
  if (snapshot === undefined) {
    return failure("invalid_execution_context", "Workspace execution context is not serializable");
  }
  if (
    (input.scope === "workspace_required_mutation" || input.scope === "issue_required" || input.scope === "repository_required") &&
    snapshot.workspace.lifecycle !== "active"
  ) {
    return failure("workspace_lifecycle_forbidden", `Scope ${input.scope} requires an active Workspace`);
  }
  if (input.scope === "issue_required" && snapshot.issue === undefined) {
    return failure("missing_issue_context", "Issue scope requires an Issue execution context");
  }
  if (
    input.scope === "repository_required" &&
    (snapshot.issue === undefined || Object.keys(snapshot.issue.execution.repositories).length === 0)
  ) {
    return failure("missing_repository_context", "Repository scope requires a non-empty repository execution context");
  }
  return { ok: true, context: snapshot };
}
