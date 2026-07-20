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

const stringSchema: JsonSchema = { type: "string", minLength: 1 };

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
    requirements: { type: "array", items: true },
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
