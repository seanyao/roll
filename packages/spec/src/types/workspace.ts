import { createHash } from "node:crypto";
import type { JsonSchema } from "./json-schema.js";

export const WORKSPACE_MANIFEST_V1 = "roll.workspace/v1" as const;
export const REPOSITORY_BINDING_V1 = "roll.repository-binding/v1" as const;
export const ISSUE_MANIFEST_V1 = "roll.issue/v1" as const;

export const ROLL_WORKSPACE_V1 = WORKSPACE_MANIFEST_V1;
export const ROLL_REPOSITORY_BINDING_V1 = REPOSITORY_BINDING_V1;
export const ROLL_ISSUE_V1 = ISSUE_MANIFEST_V1;

export type ContractErrorCode =
  | "invalid_type"
  | "unknown_version"
  | "unknown_field"
  | "invalid_value"
  | "identity_mismatch"
  | "duplicate_identity"
  | "unsafe_remote"
  | "repo_id_mismatch";

export interface ContractError {
  code: ContractErrorCode;
  path: string;
  message: string;
}

export type ContractResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: readonly ContractError[] };

export interface RequirementSourceReference {
  provider: string;
  ref: string;
}

export interface RepositoryWorkflowMetadata {
  branchPattern: string;
  requiredChecks: readonly string[];
}

export interface RepositoryBinding {
  schema: typeof REPOSITORY_BINDING_V1;
  repoId: string;
  alias: string;
  remote: string;
  integrationBranch: string;
  provider: string;
  workflow: RepositoryWorkflowMetadata;
}

export interface WorkspaceManifest {
  schema: typeof WORKSPACE_MANIFEST_V1;
  workspaceId: string;
  displayName: string;
  createdAt?: string;
  requirements: readonly RequirementSourceReference[];
  repositories: readonly RepositoryBinding[];
}

export interface WorkspaceManifestExpectations {
  workspaceId?: string;
}

const stringSchema: JsonSchema = { type: "string", minLength: 1 };
const requirementSourceSchema = objectSchema(
  { provider: stringSchema, ref: stringSchema },
  ["provider", "ref"],
);

function objectSchema(
  properties: Readonly<Record<string, JsonSchema>>,
  required: readonly string[],
): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

export const repositoryBindingV1Schema: JsonSchema = objectSchema(
  {
    schema: { const: REPOSITORY_BINDING_V1 },
    repoId: stringSchema,
    alias: stringSchema,
    remote: stringSchema,
    integrationBranch: stringSchema,
    provider: stringSchema,
    workflow: objectSchema(
      {
        branchPattern: stringSchema,
        requiredChecks: { type: "array", items: stringSchema },
      },
      ["branchPattern", "requiredChecks"],
    ),
  },
  ["schema", "repoId", "alias", "remote", "integrationBranch", "provider", "workflow"],
);

export const workspaceManifestV1Schema: JsonSchema = objectSchema(
  {
    schema: { const: WORKSPACE_MANIFEST_V1 },
    workspaceId: stringSchema,
    displayName: stringSchema,
    createdAt: stringSchema,
    requirements: { type: "array", items: requirementSourceSchema },
    repositories: { type: "array", items: repositoryBindingV1Schema },
  },
  ["schema", "workspaceId", "displayName", "requirements", "repositories"],
);

export const issueManifestV1Schema: JsonSchema = objectSchema(
  {
    schema: { const: ISSUE_MANIFEST_V1 },
    workspaceId: stringSchema,
    storyId: stringSchema,
    requirements: { type: "array", items: true },
    repositories: { type: "array", items: true },
  },
  ["schema", "workspaceId", "storyId", "requirements", "repositories"],
);

function fail<T>(code: ContractErrorCode, path: string, message: string): ContractResult<T> {
  return { ok: false, errors: [{ code, path, message }] };
}

function remoteFailure(message: string): ContractResult<string> {
  return fail("unsafe_remote", "remote", message);
}

function hasUnsafeRemoteSyntax(value: string): boolean {
  if (value.includes("\\") || value.includes("%") || value.includes("?") || value.includes("#")) {
    return true;
  }
  const pathPart = value.startsWith("file://")
    ? value.slice("file://".length)
    : value.replace(/^[^:]+:\/\//u, "").replace(/^[^:]+:/u, "");
  return pathPart.split("/").some((segment) => segment === "." || segment === "..");
}

function trimRepositorySuffix(pathname: string): string | null {
  let trimmed = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (trimmed.endsWith(".git")) trimmed = trimmed.slice(0, -4);
  if (trimmed === "" || trimmed === "/" || trimmed.endsWith("/")) return null;
  const segments = trimmed.startsWith("/") ? trimmed.slice(1).split("/") : trimmed.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  return trimmed;
}

function normalizeUrlRemote(value: string): ContractResult<string> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return remoteFailure("repository remote is not a supported absolute URL");
  }

  const sshUsernameOnly = parsed.protocol === "ssh:" && parsed.username !== "" && parsed.password === "";
  if (parsed.password !== "" || (parsed.username !== "" && !sshUsernameOnly)) {
    return remoteFailure("repository remote must not contain credentials");
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    return remoteFailure("repository remote must not contain a query or fragment");
  }

  if (parsed.protocol === "file:") {
    if (parsed.hostname !== "" || parsed.port !== "") {
      return remoteFailure("file repository remote must use an absolute local file URL");
    }
    const path = trimRepositorySuffix(parsed.pathname);
    if (path === null || !path.startsWith("/")) {
      return remoteFailure("file repository remote must contain a safe absolute path");
    }
    return { ok: true, value: `file://${path}` };
  }

  const isHttps = parsed.protocol === "https:";
  const isSsh = parsed.protocol === "ssh:";
  if (!isHttps && !isSsh) {
    return remoteFailure("repository remote protocol is not supported by v1");
  }
  const expectedPort = isHttps ? "443" : "22";
  if (parsed.port !== "" && parsed.port !== expectedPort) {
    return remoteFailure("repository remote uses a non-default port");
  }
  const path = trimRepositorySuffix(parsed.pathname);
  if (parsed.hostname === "" || path === null || !path.startsWith("/")) {
    return remoteFailure("repository remote must contain a host and safe repository path");
  }
  return {
    ok: true,
    value: `${isHttps ? "https" : "ssh"}://${parsed.hostname.toLowerCase()}${path}`,
  };
}

/** Normalize only the closed roll.repository-binding/v1 remote families. */
export function normalizeRepositoryRemote(value: unknown): ContractResult<string> {
  if (typeof value !== "string" || value.trim() === "") {
    return fail("invalid_type", "remote", "repository remote must be a non-empty string");
  }
  if (value !== value.trim() || hasUnsafeRemoteSyntax(value)) {
    return remoteFailure("repository remote contains ambiguous or unsafe syntax");
  }

  const scp = /^([^@:/\s]+)@([^:/\s]+):(.+)$/u.exec(value);
  if (scp !== null) {
    const host = scp[2];
    const rawPath = scp[3];
    if (host === undefined || rawPath === undefined) {
      return remoteFailure("repository remote is not a supported SCP-style remote");
    }
    const path = trimRepositorySuffix(`/${rawPath}`);
    if (path === null) return remoteFailure("repository remote must contain a safe repository path");
    return { ok: true, value: `ssh://${host.toLowerCase()}${path}` };
  }
  return normalizeUrlRemote(value);
}

export function repositoryIdFromRemote(value: unknown): ContractResult<string> {
  const normalized = normalizeRepositoryRemote(value);
  if (!normalized.ok) return normalized;
  const digest = createHash("sha256").update(normalized.value).digest("hex").slice(0, 12);
  return { ok: true, value: `repo-${digest}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownFieldErrors(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): ContractError[] {
  const allowedSet = new Set(allowed);
  return Object.keys(value)
    .filter((key) => !allowedSet.has(key))
    .map((key) => ({
      code: "unknown_field" as const,
      path: path === "" ? key : `${path}.${key}`,
      message: "contract contains an unknown field",
    }));
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: ContractError[],
): string | undefined {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.trim() === "") {
    errors.push({ code: "invalid_type", path: `${path}${key}`, message: "field must be a non-empty string" });
    return undefined;
  }
  return candidate;
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: ContractError[],
): string | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "string" || candidate.trim() === "") {
    errors.push({ code: "invalid_type", path: `${path}${key}`, message: "field must be a non-empty string" });
    return undefined;
  }
  return candidate;
}

function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}

function isSafeAlias(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/u.test(value);
}

function isSafeGitRef(value: string): boolean {
  if (value.startsWith("/") || value.endsWith("/") || value.endsWith(".") || value.endsWith(".lock")) return false;
  if (value.includes("..") || value.includes("@{") || value.includes("//")) return false;
  return !/[\x00-\x20~^:?*\\[]/u.test(value);
}

const WORKFLOW_TOKENS = [
  "{workspace_id}",
  "{story_id}",
  "{repo_alias}",
  "{workspaceId}",
  "{storyId}",
  "{repoAlias}",
] as const;

function isSafeBranchPattern(value: string): boolean {
  let concrete = value;
  for (const token of WORKFLOW_TOKENS) concrete = concrete.replaceAll(token, "id");
  if (concrete.includes("{") || concrete.includes("}")) return false;
  return isSafeGitRef(concrete);
}

function parseStringArray(value: unknown, path: string, errors: ContractError[]): readonly string[] | undefined {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.trim() !== "")) {
    errors.push({ code: "invalid_type", path, message: "field must be an array of non-empty strings" });
    return undefined;
  }
  return [...value];
}

function parseWorkflow(value: unknown, errors: ContractError[]): RepositoryWorkflowMetadata | undefined {
  if (!isRecord(value)) {
    errors.push({ code: "invalid_type", path: "workflow", message: "workflow must be an object" });
    return undefined;
  }
  errors.push(...unknownFieldErrors(value, ["branchPattern", "requiredChecks"], "workflow"));
  const branchPattern = requiredString(value, "branchPattern", "workflow.", errors);
  const requiredChecks = parseStringArray(value["requiredChecks"], "workflow.requiredChecks", errors);
  if (branchPattern !== undefined && !isSafeBranchPattern(branchPattern)) {
    errors.push({ code: "invalid_value", path: "workflow.branchPattern", message: "branch pattern is not a safe Git ref template" });
  }
  if (branchPattern === undefined || requiredChecks === undefined) return undefined;
  return { branchPattern, requiredChecks };
}

function parseRequirementSource(value: unknown, path: string, errors: ContractError[]): RequirementSourceReference | undefined {
  if (!isRecord(value)) {
    errors.push({ code: "invalid_type", path, message: "requirement source must be an object" });
    return undefined;
  }
  errors.push(...unknownFieldErrors(value, ["provider", "ref"], path));
  const provider = requiredString(value, "provider", `${path}.`, errors);
  const ref = requiredString(value, "ref", `${path}.`, errors);
  return provider === undefined || ref === undefined ? undefined : { provider, ref };
}

function parseRequirementSources(value: unknown, path: string, errors: ContractError[]): readonly RequirementSourceReference[] | undefined {
  if (!Array.isArray(value)) {
    errors.push({ code: "invalid_type", path, message: "requirements must be an array" });
    return undefined;
  }
  const parsed = value.map((entry, index) => parseRequirementSource(entry, `${path}[${index}]`, errors));
  return parsed.every((entry) => entry !== undefined)
    ? (parsed as readonly RequirementSourceReference[])
    : undefined;
}

export function parseRepositoryBinding(value: unknown): ContractResult<RepositoryBinding> {
  if (!isRecord(value)) return fail("invalid_type", "repository", "repository binding must be an object");
  const errors = unknownFieldErrors(
    value,
    ["schema", "repoId", "alias", "remote", "integrationBranch", "provider", "workflow"],
    "",
  );
  if (value["schema"] !== REPOSITORY_BINDING_V1) {
    errors.push({ code: "unknown_version", path: "schema", message: `expected ${REPOSITORY_BINDING_V1}` });
  }
  const repoId = requiredString(value, "repoId", "", errors);
  const alias = requiredString(value, "alias", "", errors);
  const integrationBranch = requiredString(value, "integrationBranch", "", errors);
  const provider = requiredString(value, "provider", "", errors);
  const workflow = parseWorkflow(value["workflow"], errors);
  const normalized = normalizeRepositoryRemote(value["remote"]);
  if (!normalized.ok) errors.push(...normalized.errors);

  if (alias !== undefined && !isSafeAlias(alias)) {
    errors.push({ code: "invalid_value", path: "alias", message: "repository alias must use lowercase letters, digits and hyphens" });
  }
  if (integrationBranch !== undefined && !isSafeGitRef(integrationBranch)) {
    errors.push({ code: "invalid_value", path: "integrationBranch", message: "integration branch is not a safe Git ref" });
  }
  if (normalized.ok && repoId !== undefined) {
    const expected = repositoryIdFromRemote(normalized.value);
    if (!expected.ok || repoId !== expected.value) {
      errors.push({ code: "repo_id_mismatch", path: "repoId", message: "repoId does not match the canonical remote" });
    }
  }

  if (
    errors.length > 0 || repoId === undefined || alias === undefined || integrationBranch === undefined ||
    provider === undefined || workflow === undefined || !normalized.ok
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      schema: REPOSITORY_BINDING_V1,
      repoId,
      alias,
      remote: normalized.value,
      integrationBranch,
      provider,
      workflow,
    },
  };
}

function prefixErrors(errors: readonly ContractError[], prefix: string): ContractError[] {
  return errors.map((error) => ({ ...error, path: `${prefix}.${error.path}` }));
}

function duplicateErrors(repositories: readonly RepositoryBinding[]): ContractError[] {
  const errors: ContractError[] = [];
  const seenAliases = new Set<string>();
  const seenIds = new Set<string>();
  const seenRemotes = new Set<string>();
  for (const repository of repositories) {
    const duplicates: Array<[string, Set<string>, string]> = [
      [repository.alias, seenAliases, "alias"],
      [repository.repoId, seenIds, "repoId"],
      [repository.remote, seenRemotes, "remote"],
    ];
    for (const [identity, seen, field] of duplicates) {
      if (seen.has(identity)) {
        errors.push({ code: "duplicate_identity", path: `repositories.${field}`, message: `duplicate repository ${field}` });
      }
      seen.add(identity);
    }
  }
  return errors;
}

export function parseWorkspaceManifest(
  value: unknown,
  expectations: WorkspaceManifestExpectations = {},
): ContractResult<WorkspaceManifest> {
  if (!isRecord(value)) return fail("invalid_type", "workspace", "Workspace manifest must be an object");
  const errors = unknownFieldErrors(
    value,
    ["schema", "workspaceId", "displayName", "createdAt", "requirements", "repositories"],
    "",
  );
  if (value["schema"] !== WORKSPACE_MANIFEST_V1) {
    errors.push({ code: "unknown_version", path: "schema", message: `expected ${WORKSPACE_MANIFEST_V1}` });
  }
  const workspaceId = requiredString(value, "workspaceId", "", errors);
  const displayName = requiredString(value, "displayName", "", errors);
  const createdAt = optionalString(value, "createdAt", "", errors);
  const requirements = parseRequirementSources(value["requirements"], "requirements", errors);
  const rawRepositories = value["repositories"];
  const repositories: RepositoryBinding[] = [];
  if (!Array.isArray(rawRepositories) || rawRepositories.length === 0) {
    errors.push({ code: "invalid_type", path: "repositories", message: "repositories must be a non-empty array" });
  } else {
    for (const [index, raw] of rawRepositories.entries()) {
      const parsed = parseRepositoryBinding(raw);
      if (parsed.ok) repositories.push(parsed.value);
      else errors.push(...prefixErrors(parsed.errors, `repositories[${index}]`));
    }
  }
  errors.push(...duplicateErrors(repositories));

  if (workspaceId !== undefined && !isSafeIdentifier(workspaceId)) {
    errors.push({ code: "invalid_value", path: "workspaceId", message: "Workspace ID contains unsafe characters" });
  }
  if (workspaceId !== undefined && expectations.workspaceId !== undefined && workspaceId !== expectations.workspaceId) {
    errors.push({ code: "identity_mismatch", path: "workspaceId", message: "Workspace ID does not match the expected identity" });
  }
  if (errors.length > 0 || workspaceId === undefined || displayName === undefined || requirements === undefined) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      schema: WORKSPACE_MANIFEST_V1,
      workspaceId,
      displayName,
      ...(createdAt !== undefined ? { createdAt } : {}),
      requirements,
      repositories,
    },
  };
}
