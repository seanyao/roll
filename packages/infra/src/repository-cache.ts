import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseRepositoryBinding, type RepositoryBinding } from "@roll/spec";

export type RepositoryCacheErrorCode =
  | "invalid_roll_home"
  | "invalid_binding";

export class RepositoryCacheError extends Error {
  constructor(readonly code: RepositoryCacheErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RepositoryCacheError";
  }
}

export interface RepositoryCacheIdentity {
  readonly repoId: string;
  readonly remote: string;
  readonly reposRoot: string;
  readonly cachePath: string;
  readonly lockPath: string;
  readonly journalPath: string;
  readonly temporaryPath: string;
}

export interface ResolveRepositoryCacheIdentityInput {
  readonly rollHome: string;
  readonly binding: RepositoryBinding;
}

function childPath(root: string, name: string): string {
  const candidate = resolve(root, name);
  const pathFromRoot = relative(root, candidate);
  if (
    pathFromRoot === "" || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new RepositoryCacheError("invalid_binding", "Repository cache identity escapes its machine root");
  }
  return candidate;
}

/** Resolve the only machine-scoped paths owned by a repository cache. */
export function resolveRepositoryCacheIdentity(
  input: ResolveRepositoryCacheIdentityInput,
): RepositoryCacheIdentity {
  if (!isAbsolute(input.rollHome)) {
    throw new RepositoryCacheError("invalid_roll_home", "ROLL_HOME must be an absolute path");
  }
  const parsed = parseRepositoryBinding(input.binding);
  if (!parsed.ok) {
    throw new RepositoryCacheError("invalid_binding", "Repository binding is invalid or unsafe");
  }
  const rollHome = resolve(input.rollHome);
  const reposRoot = childPath(rollHome, "repos");
  const locksRoot = childPath(rollHome, join("locks", "repos"));
  const repoId = parsed.value.repoId;
  return {
    repoId,
    remote: parsed.value.remote,
    reposRoot,
    cachePath: childPath(reposRoot, `${repoId}.git`),
    lockPath: childPath(locksRoot, `${repoId}.lock`),
    journalPath: childPath(reposRoot, `${repoId}.pending.json`),
    temporaryPath: childPath(reposRoot, `${repoId}.creating`),
  };
}
