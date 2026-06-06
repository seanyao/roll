/**
 * `roll loop fmt` — US-PORT-012.
 *
 * The observation-window pipe: stdin is the agent's raw stream-json (the same
 * bytes tee'd to live.log), stdout is the three-tier formatted transcript the
 * tmux watch window renders. The runner template pipes `tail -F live.log` into
 * this; live.log itself is written untouched upstream, so the machine-readable
 * raw stream is unaffected (AC3).
 *
 * The semantic folding lives in @roll/core's {@link formatLine} (shared signal
 * 口径 with the report timeline); this module is the thin render + I/O glue:
 * it colors each {@link FmtLine} by kind, stamps a clock, and walks stdin
 * line-by-line. For non-claude agents (no stream-json), it falls back to a
 * transparent timestamped passthrough so the window still shows live activity.
 */
import { createInterface } from "node:readline";
import { type FmtLine, formatLine, newFmtState, type SignalKind } from "@roll/core";
import { c, renderState } from "../render.js";

const KIND_COLOR: Record<SignalKind, string> = {
  tcr: "green",
  skill: "blue",
  ci: "green",
  peer: "purple",
  attest: "blue",
  pr: "green",
  alert: "red",
};

/** Render ONE folded line into a display string (color gated by renderState). */
export function renderFmtLine(line: FmtLine, opts: { ts?: string } = {}): string {
  const ts = opts.ts !== undefined && opts.ts !== "" ? c("muted", opts.ts) + "  " : "";
  if (line.tier === "banner") {
    const detail = line.detail !== undefined && line.detail !== "" ? c("muted", ` — ${line.detail}`) : "";
    return `${ts}${c("dim", line.label)}${detail}`;
  }
  if (line.tier === "muted") {
    return `${ts}${c("muted", line.label)}`;
  }
  // signal
  const color = line.ok === false ? "red" : (line.kind !== undefined ? KIND_COLOR[line.kind] : "fg");
  const arrow = c("faint", "→");
  const cat = c("blue", line.category.padEnd(6));
  const label = c(color, line.label.padEnd(14), { bold: true });
  const detail = line.detail !== undefined && line.detail !== "" ? "  " + c("muted", line.detail) : "";
  return `${ts}${arrow}  ${cat}  ${label}${detail}`;
}

/**
 * Fold a whole list of raw stream lines into rendered strings (one state across
 * the list). `agent` selects the mode: "claude" → three-tier stream-json fold;
 * anything else → transparent passthrough (the agent's stdout isn't stream-json,
 * so parsing it would blank the window). Pure given inputs + renderState — the
 * timestamp is omitted here so tests stay deterministic; the live command stamps
 * each line with the wall clock.
 */
export function formatStream(lines: string[], agent: string, opts: { ts?: string } = {}): string[] {
  if (agent !== "claude") {
    return lines
      .filter((l) => l.trim() !== "")
      .map((l) => `${opts.ts !== undefined && opts.ts !== "" ? c("muted", opts.ts) + "  " : ""}${c("dim", l)}`);
  }
  const st = newFmtState();
  const out: string[] = [];
  for (const raw of lines) {
    for (const fl of formatLine(raw, st)) {
      out.push(renderFmtLine(fl, opts));
    }
  }
  return out;
}

function hms(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const HELP = `Usage: roll loop fmt

Reads the agent's raw stream-json on stdin and writes a three-tier formatted
transcript to stdout (the loop observation window). Suppresses noise, mutes
edits, and surfaces signals (tcr / story / ci / peer / pr / error).
读取 agent 的 stream-json，输出三层关键节点转录（观测窗）。

Intended to sit in the watch pipe: tail -F live.log | roll loop fmt
`;

/** The `roll loop fmt` entry: stream stdin → formatted stdout. */
export async function loopFmtCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const noColor = args.includes("--no-color") || !process.stdout.isTTY || (process.env["NO_COLOR"] ?? "") !== "";
  renderState.useColor = !noColor;
  const agent = process.env["ROLL_LOOP_AGENT"] ?? "claude";

  if (agent === "claude") {
    const st = newFmtState();
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const raw of rl) {
      for (const fl of formatLine(raw, st)) {
        process.stdout.write(renderFmtLine(fl, { ts: hms() }) + "\n");
      }
    }
    return 0;
  }
  // Non-claude: transparent passthrough with a timestamp prefix.
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const raw of rl) {
    if (raw.trim() === "") continue;
    process.stdout.write(`${c("muted", hms())}  ${c("dim", raw)}\n`);
  }
  return 0;
}
