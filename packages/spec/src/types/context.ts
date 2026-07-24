import type { JsonSchema } from "./json-schema.js";
import type { ContractError, ContractResult, WorkspaceExecutionContextV1 } from "./workspace.js";

export const CONTEXT_PROVIDER_REGISTRY_V1 = "roll.context-providers/v1" as const;
export const CONTEXT_READ_REQUEST_V1 = "roll.context-read-request/v1" as const;
export const CONTEXT_READ_RESULT_V1 = "roll.context-read-result/v1" as const;
export const CONTEXT_PAGE_V1 = "roll.context-page/v1" as const;

export const CONTEXT_DIAGNOSTIC_CODES = [
  "context_disabled",
  "provider_not_found",
  "provider_not_bound",
  "invalid_context_binding",
  "provider_disabled",
  "invalid_provider_config",
  "unsupported_git_transport",
  "remote_identity_mismatch",
  "fetch_failed",
  "fetch_timeout",
  "branch_not_found",
  "revision_missing",
  "invalid_wiki_layout",
  "invalid_context_ref",
  "context_file_missing",
  "context_symlink_rejected",
  "context_file_too_large",
  "context_budget_exceeded",
  "invalid_page_frontmatter",
  "scope_mismatch",
  "restricted_context_denied",
  "context_revision_changed",
  "invalid_context_snapshot",
  "context_lock_timeout",
] as const;

export type ContextDiagnosticCode = (typeof CONTEXT_DIAGNOSTIC_CODES)[number];
export type ContextStage = "clarify" | "design" | "tasking" | "build" | "qa" | "review" | "fix" | "operation";

export interface GitLlmWikiProviderConfigV1 {
  readonly id: string;
  readonly type: "git_llm_wiki";
  readonly enabled: boolean;
  readonly remote: string;
  readonly branch: string;
  readonly fetch_timeout_seconds: number;
}

export interface ContextProviderRegistryV1 {
  readonly schema: typeof CONTEXT_PROVIDER_REGISTRY_V1;
  readonly enabled: boolean;
  readonly providers: readonly GitLlmWikiProviderConfigV1[];
}

export interface WorkspaceContextBindingV1 {
  readonly providerId: string;
  readonly enabled: boolean;
  readonly required: boolean;
  readonly entrypoints: readonly string[];
}

export interface WorkspaceContextsV1 {
  readonly enabled: boolean;
  readonly bindings: readonly WorkspaceContextBindingV1[];
}

export interface ContextRefV1 {
  readonly ref: string;
  readonly providerId: string;
  readonly path: string;
}

export interface ContextPageScopeV1 {
  readonly workspace_ids?: readonly string[];
  readonly repository_ids?: readonly string[];
  readonly environment_ids?: readonly string[];
  readonly story_ids?: readonly string[];
  readonly stages?: readonly ContextStage[];
}

export interface ContextPageMetadataV1 {
  readonly schema: typeof CONTEXT_PAGE_V1;
  readonly title: string;
  readonly page_type: string;
  readonly status: "active" | "deprecated" | "proposed";
  readonly confidence: "approved" | "source" | "inferred" | "low";
  readonly updated_at: string;
  readonly scope: ContextPageScopeV1;
  readonly sources: readonly string[];
  readonly sensitivity: "public" | "internal" | "restricted_reference";
}

export interface ContextDiagnosticV1 {
  readonly code: ContextDiagnosticCode;
  readonly severity: "warning" | "gap" | "blocking";
  readonly providerId?: string;
  readonly ref?: string;
  readonly message: string;
  readonly mismatchedDimensions?: readonly string[];
  readonly matchedScope?: Readonly<Record<string, readonly string[]>>;
}

export interface ContextReadRequestV1 {
  readonly schema: typeof CONTEXT_READ_REQUEST_V1;
  readonly workspace: WorkspaceExecutionContextV1;
  readonly storyId?: string;
  readonly stage: ContextStage;
  readonly environmentIds?: readonly string[];
  readonly refs: readonly string[];
  readonly includeNonActive?: boolean;
  readonly includeRestrictedReferences?: boolean;
}

export interface ContextReadFileV1 {
  readonly ref: string;
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly page?: ContextPageMetadataV1;
  readonly matchedScope?: Readonly<Record<string, readonly string[]>>;
  readonly content: string;
}

export interface ContextReadProviderSnapshotV1 {
  readonly providerId: string;
  readonly remoteIdentity: string;
  readonly branch: string;
  readonly fetchedAt: string;
  readonly revision: string;
  readonly providerConfigDigest: string;
  readonly bindingDigest: string;
  readonly files: readonly ContextReadFileV1[];
  readonly warnings: readonly ContextDiagnosticV1[];
}

export interface ContextReadResultV1 {
  readonly schema: typeof CONTEXT_READ_RESULT_V1;
  readonly snapshotId: string;
  readonly snapshotDigest: string;
  readonly createdAt: string;
  readonly artifactPath: string;
  readonly outcome: "completed" | "partial" | "blocked" | "disabled";
  readonly requestScope: {
    readonly workspaceId: string;
    readonly storyId?: string;
    readonly repositoryIds: readonly string[];
    readonly environmentIds: readonly string[];
    readonly stage: ContextStage;
  };
  readonly providers: readonly ContextReadProviderSnapshotV1[];
  readonly gaps: readonly ContextDiagnosticV1[];
}

export interface ContextProviderExecutionPlanV1 {
  readonly provider: GitLlmWikiProviderConfigV1;
  readonly binding: WorkspaceContextBindingV1;
  readonly paths: readonly string[];
  readonly providerConfigDigest: string;
  readonly bindingDigest: string;
}

export interface ContextProviderRegistry {
  resolve(providerId: string): GitLlmWikiProviderConfigV1 | undefined;
  listEnabled(): readonly GitLlmWikiProviderConfigV1[];
}

const stringSchema: JsonSchema = { type: "string", minLength: 1 };

function objectSchema(
  properties: Readonly<Record<string, JsonSchema>>,
  required: readonly string[] = [],
): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

const providerSchema = objectSchema({
  id: stringSchema,
  type: { const: "git_llm_wiki" },
  enabled: { type: "boolean" },
  remote: stringSchema,
  branch: stringSchema,
  fetch_timeout_seconds: { type: "integer", minimum: 5 },
}, ["id", "type", "enabled", "remote", "branch", "fetch_timeout_seconds"]);

const bindingSchema = objectSchema({
  providerId: stringSchema,
  enabled: { type: "boolean" },
  required: { type: "boolean" },
  entrypoints: { type: "array", items: stringSchema },
}, ["providerId", "enabled", "required", "entrypoints"]);

const repositoryWorkflowSchema = objectSchema({
  branchPattern: stringSchema,
  requiredChecks: { type: "array", items: stringSchema },
}, ["branchPattern", "requiredChecks"]);

const repositoryBindingSchema = objectSchema({
  schema: { const: "roll.repository-binding/v1" },
  repoId: stringSchema,
  alias: stringSchema,
  remote: stringSchema,
  integrationBranch: stringSchema,
  provider: stringSchema,
  workflow: repositoryWorkflowSchema,
}, ["schema", "repoId", "alias", "remote", "integrationBranch", "provider", "workflow"]);

const stringArraySchema: JsonSchema = { type: "array", items: stringSchema };
const stringArrayRecordSchema: JsonSchema = { type: "object", additionalProperties: stringArraySchema };

export const contextDiagnosticV1Schema: JsonSchema = objectSchema({
  code: { type: "string", enum: CONTEXT_DIAGNOSTIC_CODES },
  severity: { type: "string", enum: ["warning", "gap", "blocking"] },
  providerId: stringSchema,
  ref: stringSchema,
  message: stringSchema,
  mismatchedDimensions: stringArraySchema,
  matchedScope: stringArrayRecordSchema,
}, ["code", "severity", "message"]);

const repositoryExecutionCommandsSchema = objectSchema({
  test: stringArraySchema,
  integration: stringArraySchema,
}, ["test", "integration"]);

const repositoryExecutionContextSchema = objectSchema({
  repoId: stringSchema,
  alias: stringSchema,
  access: { type: "string", enum: ["read", "write"] },
  requiredDelivery: { type: "boolean" },
  noChangePolicy: { type: "string", enum: ["changes_required", "no_change_allowed"] },
  dependsOnRepo: stringSchema,
  worktreePath: stringSchema,
  baseSha: stringSchema,
  headSha: stringSchema,
  commands: repositoryExecutionCommandsSchema,
}, ["repoId", "alias", "access", "requiredDelivery", "worktreePath", "baseSha", "headSha", "commands"]);

const cycleRepositoryExecutionContextSchema = objectSchema({
  workspaceId: stringSchema,
  issueRoot: stringSchema,
  repositories: { type: "object", additionalProperties: repositoryExecutionContextSchema },
}, ["workspaceId", "issueRoot", "repositories"]);

const workspaceMatchEvidenceSchema = objectSchema({
  kind: {
    type: "string",
    enum: ["issue_exact", "requirement_source_exact", "repository_exact", "path_contained", "semantic_supported"],
  },
  value: stringSchema,
  hard: { type: "boolean" },
  score: { type: "number" },
}, ["kind", "value", "hard", "score"]);

const workspaceAuthorityPathsSchema = objectSchema({
  backlog: stringSchema,
  features: stringSchema,
  design: stringSchema,
  requirements: stringSchema,
  policy: stringSchema,
  evidence: stringSchema,
  toolDumps: stringSchema,
  events: stringSchema,
  runtime: stringSchema,
  locks: stringSchema,
}, ["backlog", "features", "design", "requirements", "policy", "evidence", "toolDumps", "events", "runtime", "locks"]);

export const contextProviderRegistryV1Schema: JsonSchema = objectSchema({
  schema: { const: CONTEXT_PROVIDER_REGISTRY_V1 },
  enabled: { type: "boolean" },
  providers: { type: "array", items: providerSchema },
}, ["schema", "enabled", "providers"]);

export const workspaceContextsV1Schema: JsonSchema = objectSchema({
  enabled: { type: "boolean" },
  bindings: { type: "array", items: bindingSchema },
}, ["enabled", "bindings"]);

const contextStages = ["clarify", "design", "tasking", "build", "qa", "review", "fix", "operation"] as const;

export const workspaceExecutionContextV1Schema: JsonSchema = objectSchema({
  schema: { const: "roll.workspace-execution-context/v1" },
  workspace: objectSchema({
    workspaceId: stringSchema,
    root: stringSchema,
    canonicalRoot: stringSchema,
    lifecycle: { type: "string", enum: ["registered", "active", "paused", "archived"] },
  }, ["workspaceId", "root", "canonicalRoot", "lifecycle"]),
  resolution: objectSchema({
    source: {
      type: "string",
      enum: ["explicit", "environment", "cwd_manifest", "issue_manifest", "requirement_discovery"],
    },
    evidence: { type: "array", items: workspaceMatchEvidenceSchema },
  }, ["source", "evidence"]),
  bindings: { type: "array", items: repositoryBindingSchema },
  contexts: workspaceContextsV1Schema,
  issue: objectSchema({
    storyId: stringSchema,
    manifestPath: stringSchema,
    execution: cycleRepositoryExecutionContextSchema,
  }, ["storyId", "manifestPath", "execution"]),
  authorities: workspaceAuthorityPathsSchema,
}, ["schema", "workspace", "resolution", "bindings", "authorities"]);

export const contextReadRequestV1Schema: JsonSchema = objectSchema({
  schema: { const: CONTEXT_READ_REQUEST_V1 },
  workspace: workspaceExecutionContextV1Schema,
  storyId: stringSchema,
  stage: { type: "string", enum: contextStages },
  environmentIds: { type: "array", items: stringSchema },
  refs: { type: "array", items: stringSchema },
  includeNonActive: { type: "boolean" },
  includeRestrictedReferences: { type: "boolean" },
}, ["schema", "workspace", "stage", "refs"]);

const contextPageScopeSchema = objectSchema({
  workspace_ids: stringArraySchema,
  repository_ids: stringArraySchema,
  environment_ids: stringArraySchema,
  story_ids: stringArraySchema,
  stages: { type: "array", items: { type: "string", enum: contextStages } },
});

const contextPageMetadataSchema = objectSchema({
  schema: { const: CONTEXT_PAGE_V1 },
  title: stringSchema,
  page_type: stringSchema,
  status: { type: "string", enum: ["active", "deprecated", "proposed"] },
  confidence: { type: "string", enum: ["approved", "source", "inferred", "low"] },
  updated_at: stringSchema,
  scope: contextPageScopeSchema,
  sources: stringArraySchema,
  sensitivity: { type: "string", enum: ["public", "internal", "restricted_reference"] },
}, ["schema", "title", "page_type", "status", "confidence", "updated_at", "scope", "sources", "sensitivity"]);

const contextReadFileSchema = objectSchema({
  ref: stringSchema,
  path: stringSchema,
  sha256: stringSchema,
  bytes: { type: "integer", minimum: 0 },
  page: contextPageMetadataSchema,
  matchedScope: stringArrayRecordSchema,
  content: { type: "string" },
}, ["ref", "path", "sha256", "bytes", "content"]);

const contextReadProviderSnapshotSchema = objectSchema({
  providerId: stringSchema,
  remoteIdentity: stringSchema,
  branch: stringSchema,
  fetchedAt: stringSchema,
  revision: stringSchema,
  providerConfigDigest: stringSchema,
  bindingDigest: stringSchema,
  files: { type: "array", items: contextReadFileSchema },
  warnings: { type: "array", items: contextDiagnosticV1Schema },
}, ["providerId", "remoteIdentity", "branch", "fetchedAt", "revision", "providerConfigDigest", "bindingDigest", "files", "warnings"]);

const contextRequestScopeSchema = objectSchema({
  workspaceId: stringSchema,
  storyId: stringSchema,
  repositoryIds: stringArraySchema,
  environmentIds: stringArraySchema,
  stage: { type: "string", enum: contextStages },
}, ["workspaceId", "repositoryIds", "environmentIds", "stage"]);

export const contextReadResultV1Schema: JsonSchema = objectSchema({
  schema: { const: CONTEXT_READ_RESULT_V1 },
  snapshotId: stringSchema,
  snapshotDigest: stringSchema,
  createdAt: stringSchema,
  artifactPath: stringSchema,
  outcome: { type: "string", enum: ["completed", "partial", "blocked", "disabled"] },
  requestScope: contextRequestScopeSchema,
  providers: { type: "array", items: contextReadProviderSnapshotSchema },
  gaps: { type: "array", items: contextDiagnosticV1Schema },
}, ["schema", "snapshotId", "snapshotDigest", "createdAt", "artifactPath", "outcome", "requestScope", "providers", "gaps"]);

export const contextProviderExecutionPlanV1Schema: JsonSchema = objectSchema({
  provider: providerSchema,
  binding: bindingSchema,
  paths: stringArraySchema,
  providerConfigDigest: stringSchema,
  bindingDigest: stringSchema,
}, ["provider", "binding", "paths", "providerConfigDigest", "bindingDigest"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function error(code: ContractError["code"], path: string, message: string): ContractError {
  return { code, path, message };
}

function unknownFields(value: Record<string, unknown>, allowed: readonly string[], path: string): ContractError[] {
  const accepted = new Set(allowed);
  return Object.keys(value)
    .filter((key) => !accepted.has(key))
    .map((key) => error("unknown_field", path === "" ? key : `${path}.${key}`, "contract contains an unknown field"));
}

function parseRequiredBoolean(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: ContractError[],
): boolean | undefined {
  const candidate = value[key];
  if (typeof candidate !== "boolean") {
    errors.push(error("invalid_type", `${path}${key}`, "field must be a boolean"));
    return undefined;
  }
  return candidate;
}

function parseRequiredString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: ContractError[],
): string | undefined {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.trim() === "") {
    errors.push(error("invalid_type", `${path}${key}`, "field must be a non-empty string"));
    return undefined;
  }
  return candidate;
}

export function isValidContextProviderId(value: string): boolean {
  return value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function safeRemotePath(value: string): string | undefined {
  let path = value.endsWith("/") ? value.slice(0, -1) : value;
  if (path.endsWith(".git")) path = path.slice(0, -4);
  if (path.startsWith("/")) path = path.slice(1);
  const segments = path.split("/");
  if (segments.length < 2 || segments.some((segment) =>
    segment === "" || segment === "." || segment === ".." || segment.startsWith("-") ||
    /[\x00-\x20\x7f\\?#%]/u.test(segment)
  )) return undefined;
  return segments.join("/");
}

function normalizeHost(value: string): string | undefined {
  if (value.startsWith("[")) {
    if (!/^\[[0-9A-Fa-f:.]+\]$/u.test(value)) return undefined;
  } else if (!value.split(".").every((label) =>
    label.length >= 1 && label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label)
  )) return undefined;
  try {
    return new URL(`https://${value}/`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function normalizeContextGitRemote(value: unknown): ContractResult<string> {
  const fail = (): ContractResult<string> => ({
    ok: false,
    errors: [error("invalid_value", "remote", "Context provider remote must use credential-free HTTPS or SSH")],
  });
  if (typeof value !== "string" || value !== value.trim() || value === "" || /[\x00-\x20\x7f]/u.test(value)) return fail();

  const https = /^https:\/\/([^/@:]+)(?::443)?\/(.+)$/u.exec(value);
  if (https !== null) {
    const host = https[1] === undefined ? undefined : normalizeHost(https[1]);
    const path = https[2] === undefined ? undefined : safeRemotePath(https[2]);
    return host === undefined || path === undefined ? fail() : { ok: true, value: `https://${host}/${path}` };
  }

  const ssh = /^ssh:\/\/(?:[A-Za-z0-9._~-]+@)?([^/@:]+)(?::22)?\/(.+)$/u.exec(value);
  if (ssh !== null) {
    const host = ssh[1] === undefined ? undefined : normalizeHost(ssh[1]);
    const path = ssh[2] === undefined ? undefined : safeRemotePath(ssh[2]);
    return host === undefined || path === undefined ? fail() : { ok: true, value: `ssh://${host}/${path}` };
  }

  const scp = /^([A-Za-z0-9._~-]+)@([^:@/]+):(.+)$/u.exec(value);
  if (scp !== null) {
    const host = scp[2] === undefined ? undefined : normalizeHost(scp[2]);
    const path = scp[3] === undefined ? undefined : safeRemotePath(scp[3]);
    return host === undefined || path === undefined ? fail() : { ok: true, value: `ssh://${host}/${path}` };
  }
  return fail();
}

export function isValidContextBranch(value: string): boolean {
  if (value.length > 255 || value.startsWith("-") || value.startsWith("refs/") || /^[0-9a-f]{40}$/u.test(value)) return false;
  if (value.startsWith("/") || value.endsWith("/") || value.endsWith(".") || value === "@" || value === "HEAD") return false;
  if (value.includes("..") || value.includes("@{") || value.includes("//")) return false;
  if (/[\x00-\x20\x7f~^:?*\\[]/u.test(value)) return false;
  return value.split("/").every((segment) => segment !== "" && !segment.startsWith(".") && !segment.endsWith(".lock"));
}

const RESERVED_CONTEXT_PATHS = new Set(["purpose.md", "schema.md"]);
const FORBIDDEN_CONTEXT_SEGMENTS = new Set([".git", ".llm-wiki", ".obsidian", "credentials"]);

export function isSafeContextPath(value: string, allowReserved: boolean): boolean {
  if (allowReserved && RESERVED_CONTEXT_PATHS.has(value)) return true;
  if (
    !value.startsWith("wiki/") || value.startsWith("/") || value.includes("\\") ||
    /[\x00-\x1f\x7f?#%]/u.test(value)
  ) return false;
  const segments = value.split("/");
  return segments.every((segment) =>
    segment !== "" && segment !== "." && segment !== ".." && !segment.startsWith(".") &&
    !segment.startsWith("-") && !FORBIDDEN_CONTEXT_SEGMENTS.has(segment)
  );
}

function parseProvider(value: unknown, index: number, errors: ContractError[]): GitLlmWikiProviderConfigV1 | undefined {
  const path = `providers[${index}]`;
  if (!isRecord(value)) {
    errors.push(error("invalid_type", path, "Context provider must be an object"));
    return undefined;
  }
  errors.push(...unknownFields(value, ["id", "type", "enabled", "remote", "branch", "fetch_timeout_seconds"], path));
  const id = parseRequiredString(value, "id", `${path}.`, errors);
  const enabled = parseRequiredBoolean(value, "enabled", `${path}.`, errors);
  const branch = parseRequiredString(value, "branch", `${path}.`, errors);
  if (value["type"] !== "git_llm_wiki") errors.push(error("invalid_value", `${path}.type`, "v1 supports only git_llm_wiki"));
  if (id !== undefined && !isValidContextProviderId(id)) errors.push(error("invalid_value", `${path}.id`, "provider id is invalid"));
  if (branch !== undefined && !isValidContextBranch(branch)) errors.push(error("invalid_value", `${path}.branch`, "provider branch is invalid"));
  const timeout = value["fetch_timeout_seconds"];
  if (!Number.isSafeInteger(timeout) || (timeout as number) < 5 || (timeout as number) > 300) {
    errors.push(error("invalid_value", `${path}.fetch_timeout_seconds`, "fetch timeout must be an integer from 5 to 300 seconds"));
  }
  const remote = normalizeContextGitRemote(value["remote"]);
  if (!remote.ok) errors.push(...remote.errors.map((entry) => ({ ...entry, path: `${path}.${entry.path}` })));
  if (
    id === undefined || enabled === undefined || branch === undefined || value["type"] !== "git_llm_wiki" ||
    !Number.isSafeInteger(timeout) || (timeout as number) < 5 || (timeout as number) > 300 || !remote.ok ||
    !isValidContextProviderId(id) || !isValidContextBranch(branch)
  ) return undefined;
  return { id, type: "git_llm_wiki", enabled, remote: remote.value, branch, fetch_timeout_seconds: timeout as number };
}

export function parseContextProviderRegistry(value: unknown): ContractResult<ContextProviderRegistryV1> {
  if (!isRecord(value)) return { ok: false, errors: [error("invalid_type", "registry", "Context registry must be an object")] };
  const errors = unknownFields(value, ["schema", "enabled", "providers"], "");
  if (value["schema"] !== CONTEXT_PROVIDER_REGISTRY_V1) {
    errors.push(error("unknown_version", "schema", `expected ${CONTEXT_PROVIDER_REGISTRY_V1}`));
  }
  const enabled = parseRequiredBoolean(value, "enabled", "", errors);
  const providers: GitLlmWikiProviderConfigV1[] = [];
  const rawProviders = value["providers"];
  if (!Array.isArray(rawProviders)) {
    errors.push(error("invalid_type", "providers", "providers must be an array"));
  } else {
    const seen = new Set<string>();
    for (const [index, raw] of rawProviders.entries()) {
      const parsed = parseProvider(raw, index, errors);
      if (parsed === undefined) continue;
      if (seen.has(parsed.id)) errors.push(error("duplicate_identity", `providers[${index}].id`, "duplicate Context provider id"));
      seen.add(parsed.id);
      providers.push(parsed);
    }
  }
  if (errors.length > 0 || enabled === undefined) return { ok: false, errors };
  return { ok: true, value: { schema: CONTEXT_PROVIDER_REGISTRY_V1, enabled, providers } };
}

function stableUnique(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function parseWorkspaceContexts(value: unknown, basePath = "contexts"): ContractResult<WorkspaceContextsV1> {
  if (!isRecord(value)) return { ok: false, errors: [error("invalid_type", basePath, "Workspace contexts must be an object")] };
  const errors = unknownFields(value, ["enabled", "bindings"], basePath);
  const enabled = parseRequiredBoolean(value, "enabled", `${basePath}.`, errors);
  const bindings: WorkspaceContextBindingV1[] = [];
  const rawBindings = value["bindings"];
  const seen = new Set<string>();
  if (!Array.isArray(rawBindings)) {
    errors.push(error("invalid_type", `${basePath}.bindings`, "bindings must be an array"));
  } else {
    for (const [index, raw] of rawBindings.entries()) {
      const path = `${basePath}.bindings[${index}]`;
      if (!isRecord(raw)) {
        errors.push(error("invalid_type", path, "Context binding must be an object"));
        continue;
      }
      errors.push(...unknownFields(raw, ["providerId", "enabled", "required", "entrypoints"], path));
      const providerId = parseRequiredString(raw, "providerId", `${path}.`, errors);
      const bindingEnabled = parseRequiredBoolean(raw, "enabled", `${path}.`, errors);
      const required = parseRequiredBoolean(raw, "required", `${path}.`, errors);
      const rawEntrypoints = raw["entrypoints"];
      let entrypoints: readonly string[] | undefined;
      if (!Array.isArray(rawEntrypoints) || !rawEntrypoints.every((entry) => typeof entry === "string")) {
        errors.push(error("invalid_type", `${path}.entrypoints`, "entrypoints must be an array of strings"));
      } else {
        const valid: string[] = [];
        for (const [entryIndex, entry] of rawEntrypoints.entries()) {
          if (!isSafeContextPath(entry, false)) {
            errors.push(error("invalid_value", `${path}.entrypoints[${entryIndex}]`, "entrypoint must be a safe wiki path"));
          } else valid.push(entry);
        }
        entrypoints = stableUnique(valid);
      }
      if (providerId !== undefined && !isValidContextProviderId(providerId)) {
        errors.push(error("invalid_value", `${path}.providerId`, "provider id is invalid"));
      }
      if (bindingEnabled === false && required === true) {
        errors.push(error("invalid_value", path, "required Context binding cannot be disabled"));
      }
      if (providerId !== undefined) {
        if (seen.has(providerId)) errors.push(error("invalid_value", `${path}.providerId`, "duplicate Context binding provider id"));
        seen.add(providerId);
      }
      if (
        providerId !== undefined && isValidContextProviderId(providerId) && bindingEnabled !== undefined &&
        required !== undefined && !(bindingEnabled === false && required === true) && entrypoints !== undefined
      ) {
        bindings.push({ providerId, enabled: bindingEnabled, required, entrypoints });
      }
    }
  }
  if (errors.length > 0 || enabled === undefined) return { ok: false, errors };
  return { ok: true, value: { enabled, bindings } };
}

export function parseContextRef(value: unknown): ContractResult<ContextRefV1> {
  const fail = (): ContractResult<ContextRefV1> => ({
    ok: false,
    errors: [error("invalid_value", "ref", "Context ref must use context://<provider>/<safe-path>")],
  });
  if (typeof value !== "string" || value !== value.trim()) return fail();
  const matched = /^context:\/\/([^/]+)\/(.+)$/u.exec(value);
  if (matched === null) return fail();
  const providerId = matched[1];
  const path = matched[2];
  if (providerId === undefined || path === undefined || !isValidContextProviderId(providerId) || !isSafeContextPath(path, false)) return fail();
  return { ok: true, value: { ref: value, providerId, path } };
}
