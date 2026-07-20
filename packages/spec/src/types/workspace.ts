import { createHash } from "node:crypto";
import type { JsonSchema } from "./json-schema.js";

export const WORKSPACE_MANIFEST_V1 = "roll.workspace/v1" as const;
export const REPOSITORY_BINDING_V1 = "roll.repository-binding/v1" as const;
export const ISSUE_MANIFEST_V1 = "roll.issue/v1" as const;

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
  readonly code: ContractErrorCode;
  readonly path: string;
  readonly message: string;
}

export type ContractResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: readonly ContractError[] };

export interface RequirementSourceReference {
  readonly provider: string;
  readonly ref: string;
}

export interface RepositoryWorkflowMetadata {
  readonly branchPattern: string;
  readonly requiredChecks: readonly string[];
}

export interface RepositoryBinding {
  readonly schema: typeof REPOSITORY_BINDING_V1;
  readonly repoId: string;
  readonly alias: string;
  readonly remote: string;
  readonly integrationBranch: string;
  readonly provider: string;
  readonly workflow: RepositoryWorkflowMetadata;
}

export interface WorkspaceManifest {
  readonly schema: typeof WORKSPACE_MANIFEST_V1;
  readonly workspaceId: string;
  readonly displayName: string;
  readonly createdAt?: string;
  readonly requirements: readonly RequirementSourceReference[];
  readonly repositories: readonly RepositoryBinding[];
}

export interface WorkspaceManifestExpectations {
  workspaceId?: string;
}

export interface WorkspaceIdentity {
  readonly workspaceId: string;
}

export interface IssueIdentity extends WorkspaceIdentity {
  readonly storyId: string;
}

export interface RepositoryIssueIdentity extends IssueIdentity {
  readonly repoId: string;
}

export type RepositoryAccess = "read" | "write";
export type NoChangePolicy = "changes_required" | "no_change_allowed";

interface IssueRepositoryTargetBase {
  readonly repoId: string;
  readonly alias: string;
  readonly pathScope?: readonly string[];
  readonly dependsOnRepo?: string;
}

export interface ReadIssueRepositoryTarget extends IssueRepositoryTargetBase {
  readonly access: "read";
  readonly requiredDelivery: false;
  readonly noChangePolicy?: never;
}

export interface WriteIssueRepositoryTarget extends IssueRepositoryTargetBase {
  readonly access: "write";
  readonly requiredDelivery: boolean;
  readonly noChangePolicy: NoChangePolicy;
}

export type IssueRepositoryTarget = ReadIssueRepositoryTarget | WriteIssueRepositoryTarget;

export interface IssueManifest {
  readonly schema: typeof ISSUE_MANIFEST_V1;
  readonly workspaceId: string;
  readonly storyId: string;
  readonly requirements: readonly RequirementSourceReference[];
  readonly repositories: readonly IssueRepositoryTarget[];
}

export interface IssueManifestExpectations {
  workspaceId?: string;
  storyId?: string;
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
    repositories: { type: "array", items: repositoryBindingV1Schema, minItems: 1 },
  },
  ["schema", "workspaceId", "displayName", "requirements", "repositories"],
);

const issueTargetCommonProperties = {
  repoId: stringSchema,
  alias: stringSchema,
  requiredDelivery: { type: "boolean" },
  pathScope: { type: "array", items: stringSchema },
  dependsOnRepo: stringSchema,
} satisfies Readonly<Record<string, JsonSchema>>;

const issueRepositoryTargetSchema: JsonSchema = {
  oneOf: [
    objectSchema(
      { ...issueTargetCommonProperties, access: { const: "read" }, requiredDelivery: { const: false } },
      ["repoId", "alias", "access", "requiredDelivery"],
    ),
    objectSchema(
      {
        ...issueTargetCommonProperties,
        access: { const: "write" },
        noChangePolicy: { type: "string", enum: ["changes_required", "no_change_allowed"] },
      },
      ["repoId", "alias", "access", "requiredDelivery", "noChangePolicy"],
    ),
  ],
};

export const issueManifestV1Schema: JsonSchema = objectSchema(
  {
    schema: { const: ISSUE_MANIFEST_V1 },
    workspaceId: stringSchema,
    storyId: stringSchema,
    requirements: { type: "array", items: requirementSourceSchema },
    repositories: { type: "array", items: issueRepositoryTargetSchema, minItems: 1 },
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
  if (
    /[\x00-\x20\x7f]/u.test(value) || value.includes("\\") || value.includes("%") ||
    value.includes("?") || value.includes("#")
  ) {
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
  if (/^https:\/\/[^/]*@/iu.test(value)) {
    return remoteFailure("HTTPS repository remote must not contain userinfo");
  }
  if (/^file:\/\//iu.test(value) && !/^file:\/\/\//iu.test(value)) {
    return remoteFailure("file repository remote must not contain an authority");
  }
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
    if (path === null || !path.startsWith("/") || /^\/[A-Za-z]:\//u.test(path)) {
      return remoteFailure("file repository remote must contain a safe absolute path");
    }
    return { ok: true, value: `file://${path}` };
  }

  const isHttps = parsed.protocol === "https:";
  const isSsh = parsed.protocol === "ssh:";
  if (!isHttps && !isSsh) {
    return remoteFailure("repository remote protocol is not supported by v1");
  }
  if (isSsh && parsed.username === "") {
    return remoteFailure("SSH repository remote must contain a transport username");
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
  return { ok: true, value: repositoryIdFromCanonicalRemote(normalized.value) };
}

function repositoryIdFromCanonicalRemote(canonicalRemote: string): string {
  const digest = createHash("sha256").update(canonicalRemote).digest("hex").slice(0, 12);
  return `repo-${digest}`;
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
  if (
    value.startsWith("-") || value.startsWith("/") || value.endsWith("/") || value.endsWith(".") ||
    value === "@"
  ) return false;
  if (value.includes("..") || value.includes("@{") || value.includes("//")) return false;
  if (/[\x00-\x20\x7f~^:?*\\[]/u.test(value)) return false;
  return value.split("/").every((component) =>
    component !== "" && !component.startsWith(".") && !component.endsWith(".lock")
  );
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
    if (repoId !== repositoryIdFromCanonicalRemote(normalized.value)) {
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

function parseBoolean(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: ContractError[],
): boolean | undefined {
  const candidate = value[key];
  if (typeof candidate !== "boolean") {
    errors.push({ code: "invalid_type", path: `${path}${key}`, message: "field must be a boolean" });
    return undefined;
  }
  return candidate;
}

function isSafeRelativeTargetPath(value: string): boolean {
  if (
    value === "" || value.startsWith("/") || value.startsWith("~") || value.includes("\\") ||
    /[\x00-\x1f\x7f]/u.test(value) || /^[A-Za-z]:/u.test(value)
  ) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function parseIssueTarget(value: unknown, index: number, errors: ContractError[]): IssueRepositoryTarget | undefined {
  const path = `repositories[${index}]`;
  if (!isRecord(value)) {
    errors.push({ code: "invalid_type", path, message: "repository target must be an object" });
    return undefined;
  }
  errors.push(...unknownFieldErrors(
    value,
    ["repoId", "alias", "access", "requiredDelivery", "noChangePolicy", "pathScope", "dependsOnRepo"],
    path,
  ));
  const repoId = requiredString(value, "repoId", `${path}.`, errors);
  const alias = requiredString(value, "alias", `${path}.`, errors);
  const requiredDelivery = parseBoolean(value, "requiredDelivery", `${path}.`, errors);
  const access = value["access"];
  if (access !== "read" && access !== "write") {
    errors.push({ code: "invalid_value", path: `${path}.access`, message: "access must be read or write" });
  }

  const noChangePolicy = value["noChangePolicy"];
  if (access === "write" && noChangePolicy !== "changes_required" && noChangePolicy !== "no_change_allowed") {
    errors.push({ code: "invalid_value", path: `${path}.noChangePolicy`, message: "write target requires an explicit no-change policy" });
  }
  if (access === "read" && noChangePolicy !== undefined) {
    errors.push({ code: "invalid_value", path: `${path}.noChangePolicy`, message: "read target must not declare a no-change policy" });
  }
  if (access === "read" && requiredDelivery === true) {
    errors.push({ code: "invalid_value", path: `${path}.requiredDelivery`, message: "read target cannot require delivery" });
  }

  const rawPathScope = value["pathScope"];
  let pathScope: readonly string[] | undefined;
  if (rawPathScope !== undefined) {
    pathScope = parseStringArray(rawPathScope, `${path}.pathScope`, errors);
    if (pathScope !== undefined && pathScope.some((entry) => !isSafeRelativeTargetPath(entry))) {
      errors.push({ code: "invalid_value", path: `${path}.pathScope`, message: "path scope must contain safe relative paths" });
    }
  }
  const dependsOnRepo = optionalString(value, "dependsOnRepo", `${path}.`, errors);
  if (repoId !== undefined && !/^repo-[0-9a-f]{12}$/u.test(repoId)) {
    errors.push({ code: "invalid_value", path: `${path}.repoId`, message: "repository target has an invalid repoId" });
  }
  if (alias !== undefined && !isSafeAlias(alias)) {
    errors.push({ code: "invalid_value", path: `${path}.alias`, message: "repository target has an invalid alias" });
  }
  if (
    repoId === undefined || alias === undefined || requiredDelivery === undefined ||
    (access !== "read" && access !== "write")
  ) {
    return undefined;
  }
  const optionalFields = {
    ...(pathScope !== undefined ? { pathScope } : {}),
    ...(dependsOnRepo !== undefined ? { dependsOnRepo } : {}),
  };
  if (access === "read") {
    if (requiredDelivery !== false) return undefined;
    return { repoId, alias, access, requiredDelivery, ...optionalFields };
  }
  if (noChangePolicy !== "changes_required" && noChangePolicy !== "no_change_allowed") return undefined;
  return { repoId, alias, access, requiredDelivery, noChangePolicy, ...optionalFields };
}

function duplicateTargetErrors(targets: readonly IssueRepositoryTarget[]): ContractError[] {
  const errors: ContractError[] = [];
  const aliases = new Set<string>();
  const repoIds = new Set<string>();
  for (const target of targets) {
    if (aliases.has(target.alias)) {
      errors.push({ code: "duplicate_identity", path: "repositories.alias", message: "duplicate repository target alias" });
    }
    if (repoIds.has(target.repoId)) {
      errors.push({ code: "duplicate_identity", path: "repositories.repoId", message: "duplicate repository target repoId" });
    }
    aliases.add(target.alias);
    repoIds.add(target.repoId);
  }
  return errors;
}

export function parseIssueManifest(
  value: unknown,
  expectations: IssueManifestExpectations = {},
): ContractResult<IssueManifest> {
  if (!isRecord(value)) return fail("invalid_type", "issue", "Issue manifest must be an object");
  const errors = unknownFieldErrors(
    value,
    ["schema", "workspaceId", "storyId", "requirements", "repositories"],
    "",
  );
  if (value["schema"] !== ISSUE_MANIFEST_V1) {
    errors.push({ code: "unknown_version", path: "schema", message: `expected ${ISSUE_MANIFEST_V1}` });
  }
  const workspaceId = requiredString(value, "workspaceId", "", errors);
  const storyId = requiredString(value, "storyId", "", errors);
  const requirements = parseRequirementSources(value["requirements"], "requirements", errors);
  const rawTargets = value["repositories"];
  const targets: IssueRepositoryTarget[] = [];
  if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
    errors.push({ code: "invalid_type", path: "repositories", message: "repository targets must be a non-empty array" });
  } else {
    for (const [index, raw] of rawTargets.entries()) {
      const target = parseIssueTarget(raw, index, errors);
      if (target !== undefined) targets.push(target);
    }
  }
  errors.push(...duplicateTargetErrors(targets));
  const aliases = new Set(targets.map((target) => target.alias));
  for (const [index, target] of targets.entries()) {
    if (target.dependsOnRepo !== undefined && (!aliases.has(target.dependsOnRepo) || target.dependsOnRepo === target.alias)) {
      errors.push({ code: "invalid_value", path: `repositories[${index}].dependsOnRepo`, message: "dependency must name a different declared repository alias" });
    }
  }

  if (workspaceId !== undefined && !isSafeIdentifier(workspaceId)) {
    errors.push({ code: "invalid_value", path: "workspaceId", message: "Workspace ID contains unsafe characters" });
  }
  if (storyId !== undefined && !isSafeIdentifier(storyId)) {
    errors.push({ code: "invalid_value", path: "storyId", message: "Story ID contains unsafe characters" });
  }
  if (workspaceId !== undefined && expectations.workspaceId !== undefined && workspaceId !== expectations.workspaceId) {
    errors.push({ code: "identity_mismatch", path: "workspaceId", message: "Workspace ID does not match the expected identity" });
  }
  if (storyId !== undefined && expectations.storyId !== undefined && storyId !== expectations.storyId) {
    errors.push({ code: "identity_mismatch", path: "storyId", message: "Story ID does not match the expected identity" });
  }
  if (errors.length > 0 || workspaceId === undefined || storyId === undefined || requirements === undefined) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: { schema: ISSUE_MANIFEST_V1, workspaceId, storyId, requirements, repositories: targets },
  };
}
