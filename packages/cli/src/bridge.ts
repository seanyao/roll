/**
 * CLI bridge — US-SCAF-004.
 *
 * Commands route TS-first: a subcommand registered in the ported table runs
 * its TypeScript handler; anything else falls back to the frozen bash
 * `bin/roll` with argv, stdio and exit code passed through untouched.
 * This keeps the CLI fully usable for the entire migration window.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A ported subcommand: receives args after the subcommand, returns exit code. */
export type Handler = (args: string[]) => number | Promise<number>;

const ported = new Map<string, Handler>();

export function registerPorted(command: string, handler: Handler): void {
  ported.set(command, handler);
}

export function isPorted(command: string): boolean {
  return ported.has(command);
}

export function portedCommands(): string[] {
  return [...ported.keys()].sort();
}

/** Walk up from this module until the repo root (contains bin/roll). */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "bin", "roll"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("bridge: cannot locate repo root (bin/roll not found)");
}

export interface RunResult {
  status: number;
  stdout?: string;
  stderr?: string;
}

export interface DispatchOptions {
  /** Capture output instead of inheriting stdio (used by tests). */
  capture?: boolean;
  /** Override cwd for the bash fallback (defaults to process.cwd()). */
  cwd?: string;
}

/** Spawn the frozen bash implementation with argv passed through. */
export function fallbackToBash(argv: string[], opts: DispatchOptions = {}): RunResult {
  const res = spawnSync(join(repoRoot(), "bin", "roll"), argv, {
    cwd: opts.cwd ?? process.cwd(),
    stdio: opts.capture ? ["inherit", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
  return {
    status: res.status ?? 1,
    stdout: opts.capture ? (res.stdout ?? "") : undefined,
    stderr: opts.capture ? (res.stderr ?? "") : undefined,
  };
}

/** TS-first dispatch; unported subcommands fall back to bash transparently. */
export async function dispatch(argv: string[], opts: DispatchOptions = {}): Promise<RunResult> {
  const [command, ...rest] = argv;
  if (command !== undefined) {
    const handler = ported.get(command);
    if (handler !== undefined) {
      return { status: await handler(rest) };
    }
  }
  return fallbackToBash(argv, opts);
}
