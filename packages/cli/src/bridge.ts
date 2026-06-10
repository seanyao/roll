/**
 * CLI bridge — US-SCAF-004 / US-PORT-021.
 *
 * Commands route TS-first: a subcommand registered in the ported table runs its
 * TypeScript handler. Every command is now TS-native, so the bash `bin/roll`
 * fallback is retired — an unregistered command prints the usage (no bash spawn).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A ported subcommand: receives args after the subcommand, returns exit code. */
export type Handler = (args: string[]) => number | Promise<number>;

const ported = new Map<string, Handler>();
// REFACTOR-049: commands that stay callable (aliases / emergency manual entry
// points) but are hidden from the main usage list to keep the surface lean.
const hidden = new Set<string>();
// FIX-239: per-command usage text. When registered, the bridge enforces the
// ONE help contract centrally — `roll <cmd> --help|-h` prints this to stdout
// and exits 0 BEFORE the handler runs (so a cry for help can never trigger
// side effects, the FIX-238 `update --help` upgrade incident). Commands with
// richer internal help simply don't register a string and keep handling it.
const helpText = new Map<string, string>();

export function registerPorted(command: string, handler: Handler, opts?: { hidden?: boolean; help?: string }): void {
  ported.set(command, handler);
  if (opts?.hidden === true) hidden.add(command);
  if (opts?.help !== undefined) helpText.set(command, opts.help);
}

/** Commands with bridge-enforced help (FIX-239 AC3's table). */
export function registeredHelp(): string[] {
  return [...helpText.keys()].sort();
}

export function isPorted(command: string): boolean {
  return ported.has(command);
}

export function portedCommands(): string[] {
  return [...ported.keys()].sort();
}

/**
 * Walk up from this module to the package root. US-PORT-021 prep: the root
 * marker is the shipped `conventions/` directory (present in both the dev repo
 * and the published npm package's `files`) — the bash engine (`bin/roll`) is
 * retired (US-PORT-021).
 */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "conventions"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("bridge: cannot locate package root (no conventions/ marker)");
}

export interface RunResult {
  status: number;
}

/** Top-level usage — TS-native (no bash). Lists the visible registered
 *  commands (hidden aliases/manual entry points stay callable, unlisted). */
export function usage(): string {
  const cmds = portedCommands().filter((c) => !c.startsWith("-") && !hidden.has(c)).join(", ");
  return (
    `roll <command> [args]\n\n` +
    `Commands: ${cmds}\n\n` +
    `Run \`roll <command> --help\` for command-specific help.\n`
  );
}

/**
 * TS-first dispatch (US-PORT-021: no bash fallback). A registered command runs
 * its handler; `help`/`--help`/`-h`/no command prints the usage (exit 0); any
 * other unknown command prints "unknown command" + usage (exit 1).
 */
export async function dispatch(argv: string[]): Promise<RunResult> {
  const [command, ...rest] = argv;
  if (command !== undefined) {
    const handler = ported.get(command);
    if (handler !== undefined) {
      // FIX-238/239: the contract half the bridge owns — help is read-only.
      const help = helpText.get(command);
      if (help !== undefined && (rest[0] === "--help" || rest[0] === "-h")) {
        process.stdout.write(help.endsWith("\n") ? help : `${help}\n`);
        return { status: 0 };
      }
      return { status: await handler(rest) };
    }
  }
  if (command === undefined || command === "" || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return { status: 0 };
  }
  process.stderr.write(`roll: unknown command '${command}'\n\n${usage()}`);
  return { status: 1 };
}
