/**
 * US-PORT-012 — observation-window 3-tier formatter (TS port of lib/loop-fmt.py).
 *
 * The tmux watch window used to `tail -F live.log` raw stream-json — "太多太密"
 * (owner 2026-06-06). This folds that same stream into a layered, skimmable
 * transcript of the cycle's KEY NODES:
 *
 *   - Tier 3 (suppressed → no line): system events, thinking, read-class tools
 *     (Read/Glob/Grep/…), plain Bash, non-matching results.
 *   - Tier 2 (muted → one dim ✏ line): Edit/Write, collapsed per consecutive
 *     file so a 12-edit run to one file is one line, not twelve.
 *   - Tier 1 (signal → highlighted): the turning points a reviewer traces —
 *     tcr commits, the story skill, CI / peer gates, PR merges, and errors.
 *
 * Signal口径 is NOT redefined here: every Tier-1 line is tagged with a
 * {@link SignalKind} from the shared {@link signalKindForMarker} table, the same
 * taxonomy the acceptance-report timeline (transcript.ts) consumes — so the key
 * nodes in the live window and in the report never drift (一处定义两处消费).
 *
 * The signal payload (commit hash, PR #, CI verdict) lives in the tool_RESULT,
 * not the tool_use, so a small pending-state machine correlates the two. The
 * raw stream is untouched (it still lands in live.log); this is display-only.
 *
 * Resilience (AC4): a half-written / non-JSON line is tolerated — it yields
 * nothing and never throws, so a torn pipe write can't crash the window.
 */
import { type SignalKind, signalKindForMarker } from "./signals.js";

export type FmtTier = "banner" | "signal" | "muted";

/** One rendered observation line (render-agnostic; the CLI adds color/timestamp). */
export interface FmtLine {
  tier: FmtTier;
  /** Present when `tier === "signal"`: the shared turning-point kind. */
  kind?: SignalKind;
  /** Short category column, e.g. `tcr`, `story`, `ci`, `pr`, `peer`, `error`, `cycle`. */
  category: string;
  /** Human one-liner. */
  label: string;
  /** Dim detail suffix. */
  detail?: string;
  /** `false` → render as an error (red). Defaults to truthy. */
  ok?: boolean;
}

/** Mutable per-stream state. One per watch pipe; reset on each cycle banner. */
export interface FmtState {
  pendingCommit: boolean;
  pendingPr: boolean;
  pendingCi: boolean;
  pendingStory: boolean;
  lastBashCmd: string;
  tcrCount: number;
  /** The file path of the current consecutive Edit/Write streak (null = none). */
  editStreakFile: string | null;
}

export function newFmtState(): FmtState {
  return {
    pendingCommit: false,
    pendingPr: false,
    pendingCi: false,
    pendingStory: false,
    lastBashCmd: "",
    tcrCount: 0,
    editStreakFile: null,
  };
}

const SUPPRESS_TOOLS = new Set([
  "Read", "Glob", "Grep", "ReadMcpResourceTool", "ListMcpResourcesTool",
  "WebFetch", "WebSearch", "TaskCreate", "TaskGet", "TaskList",
  "TaskUpdate", "TaskOutput", "TaskStop",
]);

const PEER_VERDICTS = ["AGREE", "REFINE", "OBJECT", "ESCALATE"] as const;

/** Collapse whitespace and clip to one short line. */
function clip(s: string, n = 60): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
}

/** basename without importing node:path (keeps this module FS/clock-free). */
function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

/** Reset the pending tool_use→result correlation (on cycle boundary / error). */
function clearPending(st: FmtState): void {
  st.pendingCommit = false;
  st.pendingPr = false;
  st.pendingCi = false;
  st.pendingStory = false;
}

/** A signal line, with kind derived from the shared taxonomy by its marker. */
function signal(marker: string, category: string, label: string, detail?: string, ok = true): FmtLine {
  const kind = signalKindForMarker(marker);
  const line: FmtLine = { tier: "signal", category, label, ok };
  if (kind !== null) line.kind = kind;
  if (detail !== undefined && detail !== "") line.detail = detail;
  return line;
}

/**
 * Fold ONE raw stream line into zero or more observation lines, mutating `st`.
 * Pure given (line, st): no clock, no FS, no I/O — deterministic for tests.
 */
export function formatLine(raw: string, st: FmtState): FmtLine[] {
  const line = raw.replace(/\s+$/, "");
  if (line.trim() === "") return [];

  // Cycle banner (executor.ts writes `── cycle <id> · <story> · agent <a> ──`
  // at each agent start) → reset state, show a spine line.
  const header = /^──\s*cycle\s+(.+?)\s*──\s*$/.exec(line);
  if (header) {
    clearPending(st);
    st.tcrCount = 0;
    st.editStreakFile = null;
    return [{ tier: "banner", category: "cycle", label: clip(header[1]!, 80) }];
  }

  let ev: unknown;
  try {
    ev = JSON.parse(line);
  } catch {
    // Plain text. `[loop] cycle N …` is a spine line; everything else is noise.
    const m = /\[loop\]\s+cycle\s+(\d+)/.exec(line);
    if (m) {
      clearPending(st);
      st.tcrCount = 0;
      return [{ tier: "banner", category: "cycle", label: `cycle #${m[1]}` }];
    }
    return []; // AC4: half / non JSON tolerated, no throw, no output
  }

  if (typeof ev !== "object" || ev === null) return [];
  const type = (ev as { type?: unknown }).type;

  if (type === "system") return []; // Tier 3
  if (type === "assistant") return handleAssistant(ev as Record<string, unknown>, st);
  if (type === "user") return handleUser(ev as Record<string, unknown>, st);
  if (type === "result") return handleResult(ev as Record<string, unknown>, st);
  return [];
}

function handleAssistant(ev: Record<string, unknown>, st: FmtState): FmtLine[] {
  const msg = (ev["message"] ?? {}) as Record<string, unknown>;
  const content = Array.isArray(msg["content"]) ? msg["content"] : [];
  const out: FmtLine[] = [];
  for (const blkRaw of content) {
    if (typeof blkRaw !== "object" || blkRaw === null) continue;
    const blk = blkRaw as Record<string, unknown>;
    const bt = blk["type"];
    if (bt === "thinking") continue; // Tier 3
    if (bt === "text") {
      out.push(...handleText(typeof blk["text"] === "string" ? (blk["text"] as string) : "", st));
    } else if (bt === "tool_use") {
      out.push(...handleToolUse(blk, st));
    }
  }
  return out;
}

function handleText(text: string, st: FmtState): FmtLine[] {
  const t = text.trim();
  if (t === "") return [];
  for (const v of PEER_VERDICTS) {
    if (t.includes(v)) {
      const rm = /round\s+(\d+)[/\\](\d+)/i.exec(t);
      const round = rm ? `round ${rm[1]}/${rm[2]}` : "round ?";
      const am = /(\w+)\s*→\s*(\w+)/.exec(t);
      const agents = am ? `${am[1]} → ${am[2]}` : "peer";
      st.editStreakFile = null;
      return [signal("peer", "peer", agents, `${round} · ${v}`)];
    }
  }
  return []; // Tier 3
}

function handleToolUse(blk: Record<string, unknown>, st: FmtState): FmtLine[] {
  const name = typeof blk["name"] === "string" ? (blk["name"] as string) : "";
  const input = (blk["input"] ?? {}) as Record<string, unknown>;

  if (SUPPRESS_TOOLS.has(name)) return []; // Tier 3

  if (name === "Edit" || name === "Write") {
    const path = (typeof input["file_path"] === "string" && input["file_path"]) ||
      (typeof input["path"] === "string" && input["path"]) || "";
    if (path === st.editStreakFile) return []; // collapse consecutive same-file edits
    st.editStreakFile = path as string;
    return [{ tier: "muted", category: "✏", label: `✏ ${basename(path as string)}` }];
  }

  // Any non-edit tool breaks the streak (don't collapse across them).
  st.editStreakFile = null;

  if (name === "Bash") {
    const cmd = typeof input["command"] === "string" ? (input["command"] as string) : "";
    const first = cmd.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? cmd;
    st.lastBashCmd = first;
    if (/git\s+commit[\s\S]*tcr:/.test(cmd)) st.pendingCommit = true;
    else if (/gh\s+pr\s+(create|merge)/.test(cmd)) st.pendingPr = true;
    else if (/(roll\s+ci|npm\s+run\s+ci|_ci_wait|ci:local)/.test(cmd)) st.pendingCi = true;
    return []; // wait for the result
  }

  if (name === "Skill") {
    const skill = typeof input["skill"] === "string" ? (input["skill"] as string) : "";
    if (skill === "roll-build" || skill === "roll-fix") {
      const args = (typeof input["args"] === "string" ? (input["args"] as string) : "").trim();
      const usId = args.split(/\s+/)[0] || "?";
      st.pendingStory = true;
      return [signal("skill", "story", usId, clip(args, 60))];
    }
    return [];
  }

  return []; // Agent, ToolSearch, etc.: Tier 3
}

function extractResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null && (c as Record<string, unknown>)["type"] === "text")
      .map((c) => (typeof c["text"] === "string" ? c["text"] : ""))
      .join("\n");
  }
  return content == null ? "" : String(content);
}

function handleUser(ev: Record<string, unknown>, st: FmtState): FmtLine[] {
  const msg = (ev["message"] ?? {}) as Record<string, unknown>;
  const content = Array.isArray(msg["content"]) ? msg["content"] : [];
  const out: FmtLine[] = [];
  for (const blkRaw of content) {
    if (typeof blkRaw !== "object" || blkRaw === null) continue;
    const blk = blkRaw as Record<string, unknown>;
    if (blk["type"] !== "tool_result") continue;
    const text = extractResultText(blk["content"]);

    if (blk["is_error"] === true) {
      st.editStreakFile = null;
      const lines = text.split("\n").filter((l) => l.trim() !== "").slice(0, 3);
      clearPending(st);
      out.push(signal("error", "error", "tool", clip(lines.join(" | "), 80), false));
      continue;
    }

    if (st.pendingCommit) {
      st.pendingCommit = false;
      const m = /\[[\w/-]+ ([0-9a-f]{7,})\]\s*tcr:\s*(.+)/.exec(text);
      if (m) {
        st.tcrCount += 1;
        out.push(signal("tcr", "tcr", m[1]!.slice(0, 7), clip(m[2]!.trim(), 60)));
      }
      continue;
    }

    if (st.pendingStory) {
      st.pendingStory = false; // story result body suppressed; tcr lines showed the work
      continue;
    }

    if (st.pendingPr) {
      st.pendingPr = false;
      const m = /#(\d+)/.exec(text);
      if (m) {
        const branch = /loop\/[\w-]+/.exec(st.lastBashCmd);
        out.push(signal("pr:merge", "pr", `#${m[1]}`, branch ? `merged · ${branch[0]}` : "merged"));
      }
      continue;
    }

    if (st.pendingCi) {
      st.pendingCi = false;
      const green = /(green|pass|success|all tests)/i.test(text);
      const red = /(red|fail|error)/i.test(text);
      const dur = /(\d+(?:\.\d+)?)\s*s\b/.exec(text);
      const tests = /(\d+)\s+tests?/.exec(text);
      const detail = [dur ? `${dur[1]}s` : "", tests ? `${tests[1]} tests` : ""].filter(Boolean).join(" · ");
      const ok = green && !red;
      out.push(signal(ok ? "ci:pass" : "ci:fail", "ci", ok ? "green" : "red", detail, ok));
      continue;
    }
    // Non-matching result: Tier 3
  }
  return out;
}

function handleResult(ev: Record<string, unknown>, st: FmtState): FmtLine[] {
  st.editStreakFile = null;
  const durMs = typeof ev["duration_ms"] === "number" ? (ev["duration_ms"] as number) : 0;
  const cost = typeof ev["total_cost_usd"] === "number" ? (ev["total_cost_usd"] as number) : 0;
  const durS = Math.round(durMs / 1000);
  if (ev["subtype"] === "error_max_turns") {
    return [signal("error", "error", "max-turns", `${durS}s`, false)];
  }
  const parts = [
    st.tcrCount > 0 ? `${st.tcrCount} tcr` : "",
    `${durS}s`,
    cost > 0 ? `$${cost.toFixed(2)}` : "",
  ].filter(Boolean);
  return [{ tier: "banner", category: "cycle", label: "cycle done", detail: parts.join(" · ") }];
}
