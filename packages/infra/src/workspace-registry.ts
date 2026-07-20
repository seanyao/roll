import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { WORKSPACE_EVENT_V1, type WorkspaceLifecycleEvent } from "@roll/core";

export const WORKSPACE_REGISTRY_V1 = "roll.workspace-registry/v1" as const;

export type WorkspaceRegistryErrorCode =
  | "invalid_registry"
  | "invalid_path"
  | "identity_mismatch"
  | "path_conflict"
  | "path_change_requires_move"
  | "concurrent_write";

export class WorkspaceRegistryError extends Error {
  constructor(readonly code: WorkspaceRegistryErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceRegistryError";
  }
}

export interface WorkspaceRegistryEntry {
  readonly workspaceId: string;
  readonly root: string;
  readonly canonicalRoot: string;
  readonly pathState: "valid" | "stale";
}

export interface WorkspaceRegistrySnapshot {
  readonly schema: typeof WORKSPACE_REGISTRY_V1;
  readonly revision: number;
  readonly entries: readonly WorkspaceRegistryEntry[];
}

export interface WorkspaceRegistryOptions {
  readonly rollHome: string;
  readonly now?: () => number;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function invalid(message: string): never {
  throw new WorkspaceRegistryError("invalid_registry", message);
}

function parseEntry(value: unknown): WorkspaceRegistryEntry {
  if (!isRecord(value) || !exactKeys(value, ["workspaceId", "root", "canonicalRoot", "pathState"])) {
    return invalid("Workspace registry entry has an invalid or open shape");
  }
  const workspaceId = value["workspaceId"];
  const root = value["root"];
  const canonicalRoot = value["canonicalRoot"];
  const pathState = value["pathState"];
  if (
    typeof workspaceId !== "string" || workspaceId === "" ||
    typeof root !== "string" || !isAbsolute(root) ||
    typeof canonicalRoot !== "string" || !isAbsolute(canonicalRoot) ||
    (pathState !== "valid" && pathState !== "stale")
  ) {
    return invalid("Workspace registry entry contains invalid values");
  }
  return { workspaceId, root, canonicalRoot, pathState };
}

export function parseWorkspaceRegistry(text: string): WorkspaceRegistrySnapshot {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid("Workspace registry is not valid JSON");
  }
  if (!isRecord(value) || !exactKeys(value, ["schema", "revision", "entries"])) {
    return invalid("Workspace registry has an invalid or open shape");
  }
  if (value["schema"] !== WORKSPACE_REGISTRY_V1) return invalid("Unsupported Workspace registry schema");
  if (!Number.isSafeInteger(value["revision"]) || (value["revision"] as number) < 0) {
    return invalid("Workspace registry revision must be a non-negative safe integer");
  }
  if (!Array.isArray(value["entries"])) return invalid("Workspace registry entries must be an array");
  const entries = value["entries"].map(parseEntry)
    .sort((left, right) => compareCodeUnits(left.workspaceId, right.workspaceId));
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.workspaceId) || paths.has(entry.canonicalRoot)) {
      return invalid("Workspace registry contains duplicate identity or path entries");
    }
    ids.add(entry.workspaceId);
    paths.add(entry.canonicalRoot);
  }
  return { schema: WORKSPACE_REGISTRY_V1, revision: value["revision"] as number, entries };
}

export function serializeWorkspaceRegistry(snapshot: WorkspaceRegistrySnapshot): string {
  const entries = [...snapshot.entries]
    .sort((left, right) => compareCodeUnits(left.workspaceId, right.workspaceId))
    .map((entry) => ({
      workspaceId: entry.workspaceId,
      root: entry.root,
      canonicalRoot: entry.canonicalRoot,
      pathState: entry.pathState,
    }));
  return `${JSON.stringify({ schema: WORKSPACE_REGISTRY_V1, revision: snapshot.revision, entries }, null, 2)}\n`;
}

export function workspaceRegistryPath(rollHome: string): string {
  return join(rollHome, "workspaces.json");
}

export function workspaceEventsPath(rollHome: string): string {
  return join(rollHome, "workspace-events.ndjson");
}

function readManifestWorkspaceId(root: string): string {
  let text: string;
  try {
    text = readFileSync(join(root, "workspace.yaml"), "utf8");
  } catch {
    throw new WorkspaceRegistryError("invalid_path", "Workspace root must contain workspace.yaml");
  }
  try {
    const value: unknown = JSON.parse(text);
    if (isRecord(value)) {
      const id = value["workspaceId"] ?? value["id"];
      if (typeof id === "string" && id !== "") return id;
    }
  } catch {
    const match = text.match(/^\s*(?:workspaceId|id)\s*:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/mu);
    if (match?.[1] !== undefined) return match[1];
  }
  throw new WorkspaceRegistryError("identity_mismatch", "workspace.yaml does not declare a Workspace ID");
}

export class WorkspaceRegistry {
  private readonly now: () => number;
  private tempCounter = 0;

  constructor(private readonly options: WorkspaceRegistryOptions) {
    this.now = options.now ?? Date.now;
  }

  read(): WorkspaceRegistrySnapshot {
    try {
      return parseWorkspaceRegistry(readFileSync(workspaceRegistryPath(this.options.rollHome), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schema: WORKSPACE_REGISTRY_V1, revision: 0, entries: [] };
      }
      throw error;
    }
  }

  register(input: { readonly workspaceId: string; readonly root: string }): WorkspaceRegistryEntry {
    return this.withLock(() => {
      if (!isAbsolute(input.root)) throw new WorkspaceRegistryError("invalid_path", "Workspace root must be absolute");
      const root = resolve(input.root);
      let canonicalRoot: string;
      try {
        canonicalRoot = realpathSync(root);
      } catch {
        throw new WorkspaceRegistryError("invalid_path", "Workspace root does not exist");
      }
      if (readManifestWorkspaceId(root) !== input.workspaceId) {
        throw new WorkspaceRegistryError("identity_mismatch", "workspace.yaml ID does not match the requested Workspace ID");
      }
      const snapshot = this.read();
      const existing = snapshot.entries.find((entry) => entry.workspaceId === input.workspaceId);
      if (existing !== undefined) {
        if (existing.root !== root || existing.canonicalRoot !== canonicalRoot) {
          throw new WorkspaceRegistryError("path_change_requires_move", "Workspace path changes require an explicit move");
        }
        return existing;
      }
      if (snapshot.entries.some((entry) => entry.canonicalRoot === canonicalRoot)) {
        throw new WorkspaceRegistryError("path_conflict", "Canonical Workspace path is already registered");
      }
      const entry: WorkspaceRegistryEntry = { workspaceId: input.workspaceId, root, canonicalRoot, pathState: "valid" };
      this.write({ ...snapshot, revision: snapshot.revision + 1, entries: [...snapshot.entries, entry] });
      this.appendEvent({ schema: WORKSPACE_EVENT_V1, type: "workspace:registered", workspaceId: input.workspaceId, ts: this.now() });
      return entry;
    });
  }

  private write(snapshot: WorkspaceRegistrySnapshot): void {
    const path = workspaceRegistryPath(this.options.rollHome);
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.tmp.${process.pid}.${this.tempCounter++}`;
    try {
      writeFileSync(temp, serializeWorkspaceRegistry(snapshot), "utf8");
      renameSync(temp, path);
    } finally {
      rmSync(temp, { force: true });
    }
  }

  private appendEvent(event: WorkspaceLifecycleEvent): void {
    const path = workspaceEventsPath(this.options.rollHome);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
  }

  private withLock<T>(run: () => T): T {
    const lock = join(this.options.rollHome, "locks", "workspace-registry.lock");
    mkdirSync(dirname(lock), { recursive: true });
    try {
      mkdirSync(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new WorkspaceRegistryError("concurrent_write", "Workspace registry is locked by another writer");
      }
      throw error;
    }
    try {
      return run();
    } finally {
      rmSync(lock, { recursive: true, force: true });
    }
  }
}
