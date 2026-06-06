/**
 * US-PORT-012 — the watch-window stream formatter (port of v2 `lib/loop-fmt.py`).
 *
 * The tmux observation window tailed raw claude stream-json — "太多太密" (owner,
 * 2026-06-06). This reducer turns that raw line stream into the same three-tier
 * transcript v2 showed:
 *
 *   - Tier 3 (suppressed): system events, thinking, Read/Glob/Grep & other
 *     read-class tools, non-error/non-signal results, plain chatter.
 *   - Tier 2 (muted):      Edit/Write → a `✏ <basename> | <hint> ×N` line, with
 *     consecutive same-file edits collapsed into a running count.
 *   - Tier 1 (signal):     TCR commits, story skill, peer verdict, CI gate, PR
 *     open/merge, tool errors, and the cycle start/done stamps.
 *
 * Single 口径: the Tier-1 SIGNAL labels (tcr / ci / pr) are rendered by the very
 * same {@link signalLabel} the attest report timeline uses (US-ATTEST-014). What
 * a reviewer reads in tmux is byte-for-byte the turning-point text the report
 * shows — one definition, two consumers.
 *
 * Display-only & resilient: this NEVER emits events or touches usage accounting
 * (the v3 runner owns cost via cost/tracker). A malformed / half-written JSON
 * line is tolerated (treated as plain chatter, never throws) so a torn `tail -F`
 * read can't break the pipe.
 */
import { isSignalMarker, signalLabel, type SignalMarker } from "./transcript.js";

// ── ANSI palette (mirrors loop-fmt.py) ───────────────────────────────────────
const DARK_GRAY = "[90m";
const CYAN = "[36m";
const WHITE = "[97m";
const GREEN = "[32m";
const RED = "[31m";
const RESET = "[0m";

/** Read-class / housekeeping tools whose use is pure noise in the window. */
const SUPPRESS_TOOLS = new Set<string>([
  "Read",
  "Glob",
  "Grep",
  "ReadMcpResourceTool",
  "ListMcpResourcesTool",
  "WebFetch",
  "WebSearch",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
  "TaskOutput",
  "TaskStop",
]);

export interface StreamFmtOptions {
  /** Emit ANSI colour. Defaults to false (off) — callers/CLI decide by TTY. */
  color?: boolean;
}

/** A single formatted output line plus its semantic tag, so consumers (and
 *  tests) can reason about a line's layer without re-parsing the ANSI text. */
export interface FmtLine {
  /** The rendered text (with or without ANSI, per options). */
  text: string;
  /** Tier: signal | muted (edit) | outline (cycle stamps). */
  layer: "signal" | "muted" | "outline";
  /** For signal lines, the canonical marker; otherwise a local tag. */
  marker: SignalMarker | "story" | "error" | "peer:gate" | "edit" | "cycle";
}

function clip(s: string, n = 80): string {
  const flat = String(s).replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

/**
 * The stateful 3-tier formatter. Feed it one raw stream-json line at a time via
 * {@link feed}; it returns zero or more {@link FmtLine}s. State (pending Bash →
 * result correlation, edit streak) lives across calls, exactly as v2's LoopFmt.
 */
export class StreamFormatter {
  private readonly color: boolean;
  private lastBashCmd = "";
  private tcrCount = 0;
  private lastTestCount: number | null = null;
  private cycleNum: string | null = null;
  private pendingCommit = false;
  private pendingPr = false;
  private pendingCi = false;
  private pendingStory = false;
  /** [last file path, consecutive count]. */
  private editStreak: [string | null, number] = [null, 0];

  constructor(opts: StreamFmtOptions = {}) {
    this.color = opts.color ?? false;
  }

  // ── rendering helpers (colour-aware) ───────────────────────────────────────
  private c(code: string, s: string): string {
    return this.color ? `${code}${s}${RESET}` : s;
  }

  /** A signal/category line: `→ <cat> <label> <detail>`. */
  private step(category: string, label: string, detail = "", ok = true): string {
    const labelColor = ok && (category === "ci" || category === "pr") ? GREEN : ok ? WHITE : RED;
    const arrow = this.c(DARK_GRAY, "→");
    const cat = `  ${this.c(CYAN, category.padEnd(6))}`;
    const lbl = `  ${this.c(labelColor, label)}`;
    const det = detail ? `  ${this.c(DARK_GRAY, detail)}` : "";
    return `${arrow}${cat}${lbl}${det}`;
  }

  /** A muted/timeless cycle line. */
  private stamp(text: string): string {
    return this.c(DARK_GRAY, text);
  }

  private signal(marker: SignalMarker, detail = "", ok = true): FmtLine {
    const category = marker.includes(":") ? marker.split(":")[0]! : marker;
    // The LABEL is the shared signalLabel text (carried in `detail`); the
    // category column is the marker family (tcr/ci/pr/peer/attest/alert).
    return { text: this.step(category, detail, "", ok), layer: "signal", marker };
  }

  // ── edit streak (Tier 2) ────────────────────────────────────────────────────
  private editHint(input: Record<string, unknown>): string {
    if (input["replace_all"] === true) return "replace-all";
    const ns = input["new_string"];
    if (typeof ns !== "string") return "";
    const firstLine = ns.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
    let s = firstLine.trim().replace(/^(#+|\/\/+|\/\*+|\*+|--+|;+)\s*/, "").trim();
    const token = s.split(/\s+/)[0] ?? "";
    if (!token) return "";
    return token.length > 20 ? `${token.slice(0, 20)}…` : token;
  }

  private editLine(path: string, count: number, hint: string): FmtLine {
    const base = basename(path);
    const hintPart = hint ? ` | ${hint}` : "";
    const suffix = count >= 2 ? ` ×${count}` : "";
    return { text: this.c(DARK_GRAY, `  ✏ ${base}${hintPart}${suffix}`), layer: "muted", marker: "edit" };
  }

  private handleEdit(path: string, hint: string): FmtLine[] {
    const [lastPath, count] = this.editStreak;
    if (path === lastPath) {
      const n = count + 1;
      this.editStreak = [path, n];
      return [this.editLine(path, n, hint)];
    }
    this.editStreak = [path, 1];
    return [this.editLine(path, 1, hint)];
  }

  private flushEditStreak(): void {
    this.editStreak = [null, 0];
  }

  // ── entry point ──────────────────────────────────────────────────────────────
  feed(rawLine: string): FmtLine[] {
    const line = rawLine.replace(/\s+$/, "");
    if (!line) return [];
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      return this.handlePlain(line); // half-JSON / chatter — never throw
    }
    if (typeof ev !== "object" || ev === null) return [];
    const etype = (ev as { type?: unknown }).type;
    if (etype === "system") return [];
    if (etype === "assistant") return this.handleAssistant(ev as Record<string, unknown>);
    if (etype === "user") return this.handleUser(ev as Record<string, unknown>);
    if (etype === "result") return this.handleResult(ev as Record<string, unknown>);
    return [];
  }

  private handlePlain(line: string): FmtLine[] {
    const m = /\[loop\]\s+cycle\s+(\d+)[:\s]/.exec(line);
    if (m) {
      this.cycleNum = m[1]!;
      this.tcrCount = 0;
      return [{ text: this.stamp(`cycle #${this.cycleNum} — picking story`), layer: "outline", marker: "cycle" }];
    }
    return [];
  }

  private handleAssistant(ev: Record<string, unknown>): FmtLine[] {
    const msg = (ev["message"] as Record<string, unknown> | undefined) ?? {};
    const content = Array.isArray(msg["content"]) ? (msg["content"] as Record<string, unknown>[]) : [];
    const out: FmtLine[] = [];
    for (const blk of content) {
      const btype = blk["type"];
      if (btype === "thinking") continue; // Tier 3
      if (btype === "text") out.push(...this.handleText(String(blk["text"] ?? "")));
      else if (btype === "tool_use") out.push(...this.handleToolUse(blk));
    }
    return out;
  }

  private handleText(text: string): FmtLine[] {
    const t = text.trim();
    if (!t) return [];
    for (const verdict of ["AGREE", "REFINE", "OBJECT", "ESCALATE"]) {
      if (t.includes(verdict)) {
        const rm = /round\s+(\d+)[/\\](\d+)/i.exec(t);
        const roundStr = rm ? `round ${rm[1]}/${rm[2]}` : "round ?";
        let agents = "claude → peer";
        const am = /(\w+)\s*→\s*(\w+)/.exec(t);
        if (am) agents = `${am[1]} → ${am[2]}`;
        this.flushEditStreak();
        return [{ text: this.step("peer", agents, `${roundStr} · ${verdict}`), layer: "signal", marker: "peer:gate" }];
      }
    }
    return [];
  }

  private handleToolUse(blk: Record<string, unknown>): FmtLine[] {
    const name = String(blk["name"] ?? "");
    const input = (blk["input"] as Record<string, unknown> | undefined) ?? {};
    if (SUPPRESS_TOOLS.has(name)) return [];
    if (name === "Edit" || name === "Write") {
      const path = String(input["file_path"] ?? input["path"] ?? "");
      return this.handleEdit(path, this.editHint(input));
    }
    // Any non-Edit tool breaks the streak.
    this.flushEditStreak();
    if (name === "Bash") {
      const cmd = String(input["command"] ?? "");
      const firstLine = cmd.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? cmd;
      this.lastBashCmd = firstLine;
      if (/git commit[\s\S]*tcr:/.test(cmd)) this.pendingCommit = true;
      else if (/gh pr (create|merge)/.test(cmd)) this.pendingPr = true;
      else if (/(roll ci|npm run ci|_ci_wait|ci:local)/.test(cmd)) this.pendingCi = true;
      return []; // wait for the result line
    }
    if (name === "Skill") {
      const skill = String(input["skill"] ?? "");
      const args = String(input["args"] ?? "").trim();
      if (skill === "roll-build" || skill === "roll-fix") {
        const usId = args ? args.split(/\s+/)[0]! : "?";
        this.pendingStory = true;
        return [
          { text: this.stamp(`cycle #${this.cycleNum ?? "?"} — picking story`), layer: "outline", marker: "cycle" },
          { text: this.step("story", usId, clip(args, 60)), layer: "signal", marker: "story" },
        ];
      }
      return [];
    }
    return []; // Agent / ToolSearch / etc — Tier 3
  }

  private handleUser(ev: Record<string, unknown>): FmtLine[] {
    const msg = (ev["message"] as Record<string, unknown> | undefined) ?? {};
    const content = Array.isArray(msg["content"]) ? (msg["content"] as Record<string, unknown>[]) : [];
    const out: FmtLine[] = [];
    for (const blk of content) {
      if (blk["type"] !== "tool_result") continue;
      const isErr = blk["is_error"] === true;
      const text = this.extractText(blk["content"]);
      const tm = /\bok\s+(\d+)/.exec(text);
      if (tm) this.lastTestCount = Number(tm[1]);

      if (isErr) {
        this.flushEditStreak();
        const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 3);
        out.push({ text: this.step("error", "tool", clip(lines.join(" | "), 80), false), layer: "signal", marker: "error" });
        this.pendingCommit = this.pendingPr = this.pendingCi = false;
        continue;
      }
      if (this.pendingCommit) {
        this.pendingCommit = false;
        const cm = /\[[\w/\-]+ ([0-9a-f]{7,})\]\s*tcr:\s*(.+)/.exec(text);
        if (cm) {
          const hash = cm[1]!;
          const message = `tcr: ${cm[2]!.trim()}`;
          this.tcrCount += 1;
          const label = signalLabel({ kind: "tcr", commitHash: hash, message });
          const testPart = this.lastTestCount ? ` · ${this.lastTestCount} tests` : "";
          out.push({ text: this.step("tcr", label, testPart.replace(/^ · /, "")), layer: "signal", marker: "tcr" });
        }
        continue;
      }
      if (this.pendingStory) {
        this.pendingStory = false;
        continue; // story result suppressed; the TCR lines showed the work
      }
      if (this.pendingPr) {
        this.pendingPr = false;
        const pm = /#(\d+)/.exec(text);
        if (pm) {
          const prNumber = Number(pm[1]);
          const merged = /merge/.test(this.lastBashCmd);
          const label = signalLabel(merged ? { kind: "pr:merge", prNumber } : { kind: "pr:open", prNumber });
          out.push({ text: this.step("pr", label, "", true), layer: "signal", marker: merged ? "pr:merge" : "pr:open" });
        }
        continue;
      }
      if (this.pendingCi) {
        this.pendingCi = false;
        const hasGreen = /(green|pass|success|all tests)/i.test(text);
        const hasRed = /(red|fail|error)/i.test(text);
        const dm = /(\d+(?:\.\d+)?)\s*s\b/.exec(text);
        const tcm = /(\d+)\s+tests?/.exec(text);
        const prm = /#(\d+)/.exec(text);
        const prNumber = prm ? Number(prm[1]) : 0;
        const pass = hasGreen && !hasRed;
        const label = signalLabel(pass ? { kind: "ci:pass", prNumber } : { kind: "ci:fail", prNumber });
        const detBits = [dm ? `${dm[1]}s` : "", tcm ? `${tcm[1]} tests` : this.lastTestCount ? `${this.lastTestCount} tests` : ""].filter(Boolean);
        out.push({ text: this.step("ci", label, detBits.join(" · "), pass), layer: "signal", marker: pass ? "ci:pass" : "ci:fail" });
        continue;
      }
    }
    return out;
  }

  private extractText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((c) => (c && typeof c === "object" && (c as { type?: string }).type === "text" ? String((c as { text?: string }).text ?? "") : ""))
        .filter(Boolean)
        .join("\n");
    }
    return content ? String(content) : "";
  }

  private handleResult(ev: Record<string, unknown>): FmtLine[] {
    this.flushEditStreak();
    const durMs = Number(ev["duration_ms"] ?? 0);
    const costUsd = Number(ev["total_cost_usd"] ?? 0);
    const durS = durMs / 1000;
    const subtype = String(ev["subtype"] ?? "");
    if (subtype === "error_max_turns") {
      return [{ text: this.step("error", "max-turns", `${Math.round(durS)}s`, false), layer: "signal", marker: "error" }];
    }
    const tcrStr = this.tcrCount ? `${this.tcrCount} tcr` : "";
    const costStr = costUsd ? `$${costUsd.toFixed(2)}` : "";
    const detail = [tcrStr, `${Math.round(durS)}s`, costStr].filter(Boolean).join(" · ");
    const cycleStr = this.cycleNum ? `cycle #${this.cycleNum}` : "cycle done";
    return [{ text: this.stamp(detail ? `${cycleStr} — done · ${detail}` : `${cycleStr} — done`), layer: "outline", marker: "cycle" }];
  }
}

/** Convenience: assert a formatter line's marker is the shared signal口径. */
export function isFmtSignal(line: FmtLine): boolean {
  return line.layer === "signal" && isSignalMarker(line.marker);
}
