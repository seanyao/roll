/**
 * US-LOOP-088 — post-cycle environment cleanup.
 *
 * Declarative, fail-safe cleanup of scratch/toolchain artifacts produced inside a
 * cycle worktree. The default manifest targets well-known transient paths; projects
 * can override/extend it with `.roll/loop/cleanup-manifest.yaml`.
 *
 * Design constraints:
 *   - Idempotent: re-running on an already-clean worktree is a no-op.
 *   - Fail-safe: every rule error is reported as a warning, never thrown.
 *   - Observable: each rule emits a `cycle:cleanup` event via the caller.
 *   - Conservative: the default manifest only touches cache/scratch directories
 *     that are normally gitignored; source files and uncommitted work are never
 *     in the target set.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { V2CycleStatus } from "@roll/core";

/** A single cleanup rule. */
export interface CleanupRule {
  /** Human-readable rule name (also used in events). */
  name: string;
  /** `rm` = remove; `isolate` = move into a cycle-local cleanup dir. */
  kind: "rm" | "isolate";
  /** Glob-ish paths relative to the worktree root. `**` is supported for directories. */
  paths: string[];
  /** Optional terminal statuses where this rule is allowed to run. Omitted means all terminals. */
  terminalStatuses?: V2CycleStatus[];
}

/** Result of applying one path target. */
export interface CleanupResult {
  rule: string;
  path: string;
  ok: boolean;
  warning?: string;
}

/** Parsed project override or default manifest. */
export interface CleanupManifest {
  version: number;
  rules: CleanupRule[];
}

/** Overall cleanup budget. Terminal recording and lock release must never wait longer. */
export const CLEANUP_TIMEOUT_MS = 10_000;

const HEAVY_CLEANUP_TERMINALS: V2CycleStatus[] = ["idle", "done", "published", "orphan"];

/** Default manifest — keeps the harness honest without touching source. */
export const DEFAULT_CLEANUP_MANIFEST: CleanupManifest = {
  version: 1,
  rules: [
    {
      name: "scratch-dirs",
      kind: "rm",
      paths: [".scratch", "tmp", ".tmp", "scratch"],
    },
    {
      name: "node-tool-cache",
      kind: "rm",
      paths: ["node_modules/.cache", ".vite", ".vitest-cache"],
      terminalStatuses: HEAVY_CLEANUP_TERMINALS,
    },
    {
      name: "python-cache",
      kind: "rm",
      paths: ["**/__pycache__"],
      terminalStatuses: HEAVY_CLEANUP_TERMINALS,
    },
    {
      name: "swift-build-cache",
      kind: "rm",
      paths: [".build"],
      terminalStatuses: HEAVY_CLEANUP_TERMINALS,
    },
  ],
};

export interface CleanupOptions {
  terminalStatus?: V2CycleStatus;
  maxDurationMs?: number;
  nowMs?: () => number;
}

/**
 * Read a project-level cleanup manifest, if present. Returns `undefined` when the
 * file is missing or unreadable so the caller can fall back to the default.
 */
export function readCleanupManifest(manifestPath: string): CleanupManifest | undefined {
  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch {
    return undefined;
  }
  return parseCleanupManifest(text);
}

/** Parse a YAML-ish manifest string. Keeps the parser tiny and dependency-free. */
export function parseCleanupManifest(text: string): CleanupManifest | undefined {
  const lines = text.split(/\r?\n/);
  const rules: CleanupRule[] = [];
  let current: Partial<CleanupRule> | undefined;
  let inPaths = false;
  let inTerminalStatuses = false;

  for (let raw of lines) {
    const line = (raw.split("#")[0] ?? raw).trimEnd();
    const trim = line.trim();
    if (trim === "" || trim.startsWith("#")) continue;

    if (trim === "rules:") {
      inPaths = false;
      inTerminalStatuses = false;
      continue;
    }

    const nameMatch = /^-\s*name:\s*(.+)$/.exec(trim);
    if (nameMatch) {
      if (current?.name && current.kind && current.paths) {
        rules.push(current as CleanupRule);
      }
      current = { name: nameMatch[1]?.trim() ?? "", paths: [] };
      inPaths = false;
      inTerminalStatuses = false;
      continue;
    }

    const kindMatch = /^\s+kind:\s*(rm|isolate)$/.exec(line);
    if (kindMatch && current) {
      current.kind = kindMatch[1] as "rm" | "isolate";
      continue;
    }

    const pathsMatch = /^\s+paths:\s*$/.exec(line);
    if (pathsMatch && current) {
      inPaths = true;
      inTerminalStatuses = false;
      continue;
    }

    const terminalStatusesMatch = /^\s+terminal_statuses:\s*$/.exec(line);
    if (terminalStatusesMatch && current) {
      current.terminalStatuses = [];
      inPaths = false;
      inTerminalStatuses = true;
      continue;
    }

    const pathItemMatch = /^\s+-\s*(.+)$/.exec(line);
    if (pathItemMatch && current && inPaths) {
      current.paths!.push(pathItemMatch[1]?.trim() ?? "");
      continue;
    }

    if (pathItemMatch && current && inTerminalStatuses) {
      const status = pathItemMatch[1]?.trim();
      if (isV2CycleStatus(status)) current.terminalStatuses!.push(status);
      continue;
    }
  }

  if (current?.name && current.kind && current.paths) {
    rules.push(current as CleanupRule);
  }

  return rules.length > 0 ? { version: 1, rules } : undefined;
}

function isV2CycleStatus(value: string | undefined): value is V2CycleStatus {
  return (
    value === "idle" ||
    value === "gave_up" ||
    value === "handoff_without_tcr" ||
    value === "agent_internal" ||
    value === "built" ||
    value === "done" ||
    value === "published" ||
    value === "orphan" ||
    value === "local" ||
    value === "needs_review" ||
    value === "failed" ||
    value === "aborted" ||
    value === "blocked" ||
    value === "dormant"
  );
}

/**
 * Apply the manifest to a worktree. Returns one result row per matched path.
 * Never throws — every failure is captured as a result with `ok: false`.
 */
export function applyCleanupManifest(
  worktreePath: string,
  cycleId: string,
  manifest: CleanupManifest,
  opts: CleanupOptions = {},
): CleanupResult[] {
  const results: CleanupResult[] = [];
  const started = (opts.nowMs ?? Date.now)();
  const maxDurationMs = opts.maxDurationMs ?? CLEANUP_TIMEOUT_MS;
  const deadline = started + maxDurationMs;
  const now = opts.nowMs ?? Date.now;
  let timedOut = false;
  for (const rule of manifest.rules) {
    if (timedOut) break;
    if (opts.terminalStatus !== undefined && rule.terminalStatuses !== undefined && !rule.terminalStatuses.includes(opts.terminalStatus)) {
      results.push({
        rule: rule.name,
        path: ".",
        ok: true,
        warning: `skipped for terminal status ${opts.terminalStatus}`,
      });
      continue;
    }
    if (now() >= deadline) {
      results.push(cleanupTimeoutResult(maxDurationMs));
      timedOut = true;
      break;
    }
    for (const pattern of rule.paths) {
      if (now() >= deadline) {
        results.push(cleanupTimeoutResult(maxDurationMs));
        timedOut = true;
        break;
      }
      for (const target of resolvePattern(worktreePath, pattern, deadline, now)) {
        if (now() >= deadline) {
          results.push(cleanupTimeoutResult(maxDurationMs));
          timedOut = true;
          break;
        }
        results.push(applyRule(worktreePath, cycleId, rule, target));
      }
      if (timedOut) break;
    }
  }
  return results;
}

function cleanupTimeoutResult(maxDurationMs: number): CleanupResult {
  return {
    rule: "cleanup-timebox",
    path: ".",
    ok: false,
    warning: `cleanup exceeded ${maxDurationMs}ms; remaining rules skipped`,
  };
}

function resolvePattern(worktreePath: string, pattern: string, deadline: number, now: () => number): string[] {
  if (!pattern.includes("**")) {
    const abs = join(worktreePath, pattern);
    // Always return literal paths so applyRule can enforce the worktree boundary
    // and report idempotent success for missing targets.
    return [abs];
  }
  // Minimal glob support: `prefix/**/suffix` recursively searches prefix.
  const parts = pattern.split("**", 2);
  const prefix = parts[0] ?? "";
  const rest = parts[1];
  const base = join(worktreePath, prefix);
  if (!existsSync(base)) return [];
  const suffix = rest?.replace(/^\//, "") ?? "";
  const matches: string[] = [];
  walkRecursive(base, worktreePath, suffix, matches, deadline, now);
  return matches;
}

function walkRecursive(dir: string, worktreePath: string, suffix: string, out: string[], deadline: number, now: () => number): void {
  if (now() >= deadline) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (now() >= deadline) return;
    const abs = join(dir, entry);
    const rel = relative(worktreePath, abs);
    if (suffix && rel.endsWith(suffix)) {
      out.push(abs);
    }
    try {
      if (lstatSync(abs).isDirectory()) {
        walkRecursive(abs, worktreePath, suffix, out, deadline, now);
      }
    } catch {
      // ignore unreadable entries
    }
  }
}

function applyRule(worktreePath: string, cycleId: string, rule: CleanupRule, absPath: string): CleanupResult {
  const rel = relative(worktreePath, absPath);
  if (rel.startsWith("..")) {
    return { rule: rule.name, path: absPath, ok: false, warning: "target outside worktree refused" };
  }

  try {
    if (!existsSync(absPath)) {
      return { rule: rule.name, path: rel, ok: true };
    }
  } catch {
    return { rule: rule.name, path: rel, ok: false, warning: "cannot stat target" };
  }

  if (rule.kind === "isolate") {
    const isolateRoot = join(worktreePath, ".roll-cleanup", cycleId, rule.name);
    const base = basename(absPath);
    const dest = join(isolateRoot, base);
    try {
      mkdirSync(isolateRoot, { recursive: true });
      renameSync(absPath, dest);
      return { rule: rule.name, path: rel, ok: true };
    } catch (err) {
      return { rule: rule.name, path: rel, ok: false, warning: `isolate failed: ${err}` };
    }
  }

  try {
    rmSync(absPath, { recursive: true, force: true });
    return { rule: rule.name, path: rel, ok: true };
  } catch (err) {
    return { rule: rule.name, path: rel, ok: false, warning: `rm failed: ${err}` };
  }
}

/**
 * Resolve the effective manifest for a worktree: project override wins, then default.
 */
export function resolveCleanupManifest(worktreePath: string, manifestPath: string): CleanupManifest {
  return readCleanupManifest(manifestPath) ?? DEFAULT_CLEANUP_MANIFEST;
}
