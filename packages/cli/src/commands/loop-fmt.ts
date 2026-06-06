/**
 * `roll loop fmt` — US-PORT-012.
 *
 * Reads raw claude stream-json on stdin (the tmux watch window pipes
 * `tail -F live.log` into it) and writes the v2 three-tier transcript on stdout.
 * The cycle's raw live.log is untouched (machine-readable channel preserved,
 * AC3); this command is a pure read-side view that humanizes the stream.
 *
 * Line buffering: `tail -F` hands us arbitrary byte chunks, so a JSON object may
 * straddle two reads. {@link StreamFmtPipe} buffers until a newline before
 * feeding {@link StreamFormatter}, and a torn final line is tolerated at EOF —
 * the formatter itself never throws on malformed JSON (AC4).
 */
import { StreamFormatter, type StreamFmtOptions } from "@roll/core";
import type { Readable } from "node:stream";

/** Buffers stdin chunks into whole lines, feeding the formatter. */
export class StreamFmtPipe {
  private buf = "";
  private readonly fmt: StreamFormatter;

  constructor(opts: StreamFmtOptions = {}) {
    this.fmt = new StreamFormatter(opts);
  }

  /** Push a chunk; return the rendered text for every COMPLETE line within. */
  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      for (const fl of this.fmt.feed(line)) out.push(fl.text);
    }
    return out;
  }

  /** EOF: render any trailing partial line (best-effort; never throws). */
  flush(): string[] {
    if (this.buf === "") return [];
    const line = this.buf;
    this.buf = "";
    return this.fmt.feed(line).map((l) => l.text);
  }
}

export interface LoopFmtDeps {
  stdin: () => Readable;
  write: (s: string) => void;
  env: NodeJS.ProcessEnv;
  isTTY: () => boolean;
}

function realDeps(): LoopFmtDeps {
  return {
    stdin: () => process.stdin,
    write: (s) => process.stdout.write(s),
    env: process.env,
    isTTY: () => process.stdout.isTTY === true,
  };
}

/**
 * Decide whether to colourise. NO_COLOR (any value) wins; an explicit
 * `--no-color` / `--color` flag overrides; otherwise follow the TTY.
 */
export function decideColor(args: string[], env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  if (args.includes("--no-color")) return false;
  if (args.includes("--color")) return true;
  if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "") return false;
  return isTTY;
}

export async function loopFmtCommand(args: string[], deps: LoopFmtDeps = realDeps()): Promise<number> {
  const color = decideColor(args, deps.env, deps.isTTY());
  const pipe = new StreamFmtPipe({ color });
  const stdin = deps.stdin();
  return new Promise<number>((resolve) => {
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk: string) => {
      for (const line of pipe.push(chunk)) deps.write(`${line}\n`);
    });
    stdin.on("end", () => {
      for (const line of pipe.flush()) deps.write(`${line}\n`);
      resolve(0);
    });
    // A broken pipe (the watcher closed) is normal — exit cleanly.
    stdin.on("error", () => resolve(0));
  });
}
