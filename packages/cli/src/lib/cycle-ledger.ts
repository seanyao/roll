/**
 * US-DOSSIER-013 — the cycle ledger view model: every loop cycle as one row
 * (verdict dot · cycle no · story · model · tokens · cost · duration) that
 * expands into a seven-segment trace tape (cycle→story→build→peer→ci→pr→end)
 * with whatever evidence is honestly knowable from runs.jsonl + events.ndjson.
 * Failures are first-class: failed = failed + reverted + blocked, never
 * swallowed (the FIX-248 lesson, same vocabulary as the CLI).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEventLine, type RollEvent } from "@roll/spec";

export type CycleLedgerVerdict = "delivered" | "pending_merge" | "reverted" | "failed" | "blocked" | "idle" | "unknown";

export interface CycleTapeSegment {
  key: "cycle" | "story" | "build" | "peer" | "ci" | "pr" | "end";
  /** Honest summary, "—" when nothing is knowable. */
  detail: string;
  /** pass | fail | idle | unknown — drives the segment color. */
  state: "pass" | "fail" | "idle" | "unknown";
}

export interface CycleLedgerRow {
  cycleId: string;
  /** Epoch seconds (0 when the row carries no ts — filtered as ancient). */
  tsSec: number;
  verdict: CycleLedgerVerdict;
  storyId: string;
  agent: string;
  model: string;
  tokens: string;
  cost: string;
  duration: string;
  tape: CycleTapeSegment[];
  /** Evidence links (label → href), relative to features/index.html. */
  evidence: Array<{ label: string; href: string }>;
}

/** The CLI's verdict vocabulary (AC4): delivered / reverted / failed / blocked. */
export function ledgerVerdict(status: string, outcome: string): CycleLedgerVerdict {
  if (status === "reverted") return "reverted";
  // FIX-322: delivered ≡ MERGED only (done≡merged). The merge-backfill stamps
  // status=merged / outcome=delivered on a gh-confirmed merge; until then a cycle
  // that opened a PR is IN-FLIGHT (pending_merge), NOT delivered. Labeling
  // published as delivered made an open, unmerged PR count as a delivery — and
  // showed two "delivered" rows for one card re-delivered across the merge window.
  if (status === "merged" || outcome === "delivered") return "delivered";
  if (
    outcome === "published_pending_merge" ||
    status === "published" ||
    status === "built" ||
    status === "done"
  ) {
    return "pending_merge";
  }
  if (outcome === "blocked" || status === "blocked") return "blocked";
  if (outcome === "idle_no_work" || status === "idle") return "idle";
  if (
    outcome === "failed" ||
    outcome === "aborted_no_delivery" ||
    outcome === "aborted_with_delivery" ||
    outcome === "orphan_timeout" ||
    status === "failed" ||
    status === "aborted" ||
    // FIX-324: `gave_up` is the productivity-floor terminal — an agent that ran
    // but left no commit / no delivery (orchestrator.classifyCaptured). It is a
    // failure-to-deliver, so it belongs in the failed cluster; before this it
    // fell through to "unknown" and `roll cycles` showed a dirty/illegible
    // status for every gave_up cycle. The precise mode stays in runs.jsonl.
    status === "gave_up" ||
    outcome === "gave_up"
  ) {
    return "failed";
  }
  return "unknown";
}

/** failed = failed + reverted + blocked (never swallowed). */
export function ledgerFailedCount(rows: readonly CycleLedgerRow[]): number {
  return rows.filter((r) => r.verdict === "failed" || r.verdict === "reverted" || r.verdict === "blocked").length;
}

/**
 * FIX-297: idle heartbeats are NOT cycles. The scheduled loop lane wakes on its
 * interval, finds no eligible Todo, writes an idle row (no story picked, no work
 * attempted) and sleeps. Those rows stay in runs.jsonl as loop-liveness data,
 * but the cycle ledger must list ONLY real cycles — a story was picked and work
 * was attempted. We drop a row only when it is genuinely a no-op heartbeat:
 * idle verdict (outcome `idle_no_work` or status `idle`) AND no story AND no
 * work (no tcr commits, nothing built). Failures/blocked/aborted carry a story
 * or work and so remain first-class.
 */
function isIdleHeartbeat(row: Record<string, unknown>, verdict: CycleLedgerVerdict): boolean {
  if (verdict !== "idle") return false;
  const storyId = typeof row["story_id"] === "string" ? (row["story_id"] as string) : "";
  if (storyId !== "") return false;
  const tcr = typeof row["tcr_count"] === "number" ? (row["tcr_count"] as number) : 0;
  if (tcr > 0) return false;
  const built = row["built"];
  if (Array.isArray(built) && built.length > 0) return false;
  return true;
}

/** FIX-290 AC3: "?" when usage could not be read (UNKNOWN, model+duration still
 *  present), "—" only when there is genuinely nothing to show; a real value
 *  otherwise. A TRUE-0 (parsed usage that summed to 0) is never confused with
 *  the unreadable-credentials case (which sets `usage_unknown`). */
function fmtTokens(tin: unknown, tout: unknown, usageUnknown: boolean): string {
  if (usageUnknown) return "?";
  const a = typeof tin === "number" ? tin : 0;
  const b = typeof tout === "number" ? tout : 0;
  if (a + b === 0) return "—";
  const k = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  return `${k(a)}/${k(b)}`;
}

function fmtDuration(sec: unknown): string {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  return `${Math.floor(sec / 60)}m${Math.round(sec % 60).toString().padStart(2, "0")}s`;
}

interface CycleEventFacts {
  peer?: string;
  pairVerdicts: string[];
  attest?: string;
}

function readEventFacts(projectPath: string): { byCycle: Map<string, CycleEventFacts>; prMergedBy: Map<string, number>; prOpenBy: Map<string, number> } {
  const byCycle = new Map<string, CycleEventFacts>();
  const prMergedBy = new Map<string, number>();
  const prOpenBy = new Map<string, number>();
  const path = join(projectPath, ".roll", "loop", "events.ndjson");
  if (!existsSync(path)) return { byCycle, prMergedBy, prOpenBy };
  let content = "";
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return { byCycle, prMergedBy, prOpenBy };
  }
  const facts = (id: string): CycleEventFacts => {
    let f = byCycle.get(id);
    if (f === undefined) {
      f = { pairVerdicts: [] };
      byCycle.set(id, f);
    }
    return f;
  };
  for (const line of content.split("\n")) {
    const e: RollEvent | null = parseEventLine(line);
    if (e === null) continue;
    if (e.type === "peer:gate") facts(e.cycleId).peer = e.verdict;
    else if (e.type === "pair:verdict") facts(e.cycleId).pairVerdicts.push(e.verdict);
    else if (e.type === "attest:gate") facts(e.cycleId).attest = e.verdict;
    else if (e.type === "pr:merge") prMergedBy.set(e.storyId, e.prNumber);
    else if (e.type === "pr:open") prOpenBy.set(e.storyId, e.prNumber);
  }
  return { byCycle, prMergedBy, prOpenBy };
}

function rowTape(row: Record<string, unknown>, verdict: CycleLedgerVerdict, ev: CycleEventFacts | undefined, prNumber: number | undefined, prOpen: number | undefined): CycleTapeSegment[] {
  const storyId = typeof row["story_id"] === "string" ? (row["story_id"] as string) : "";
  const tcr = typeof row["tcr_count"] === "number" ? (row["tcr_count"] as number) : 0;
  const seg = (key: CycleTapeSegment["key"], detail: string, state: CycleTapeSegment["state"]): CycleTapeSegment => ({ key, detail, state });
  // `cycle`/`story` segments record FACTS that already happened (the cycle ran,
  // a story was picked) — they stay green even on a failed row; the failure
  // shows where it actually bit (build/peer/ci/pr/end). kimi pair-review noted
  // the ambiguity; this is the intended reading of the trace tape.
  const endState = verdict === "delivered" ? "pass" : verdict === "idle" ? "idle" : verdict === "unknown" ? "unknown" : "fail";
  return [
    seg("cycle", typeof row["ts"] === "string" ? (row["ts"] as string).replace("T", " ").replace(/:\d{2}Z$/, "Z") : "—", "pass"),
    seg("story", storyId !== "" ? storyId : "—", storyId !== "" ? "pass" : "idle"),
    seg("build", tcr > 0 ? `${tcr} commits` : "—", tcr > 0 ? "pass" : verdict === "idle" ? "idle" : "unknown"),
    seg(
      "peer",
      ev?.pairVerdicts.length ? ev.pairVerdicts.join("/") : ev?.peer === "consulted" ? "consulted" : ev?.peer === "skipped" ? "skipped" : "—",
      // kimi pair-review: a skipped peer gate is an idle segment, not an unknown.
      ev?.pairVerdicts.includes("object") ? "fail" : ev?.pairVerdicts.length || ev?.peer === "consulted" ? "pass" : ev?.peer === "skipped" ? "idle" : "unknown",
    ),
    seg("ci", ev?.attest === "produced" ? "attest ✓" : ev?.attest === "skipped" ? "attest skipped" : "—", ev?.attest === "produced" ? "pass" : ev?.attest === "skipped" ? "fail" : "unknown"),
    seg(
      "pr",
      prNumber !== undefined ? `#${prNumber} merged` : prOpen !== undefined ? `#${prOpen} open` : typeof row["merge_commit"] === "string" && row["merge_commit"] !== "" ? "merged" : "—",
      prNumber !== undefined || (typeof row["merge_commit"] === "string" && row["merge_commit"] !== "") ? "pass" : prOpen !== undefined ? "idle" : "unknown",
    ),
    seg("end", verdict, endState),
  ];
}

/** Collect the full ledger (newest first); range filtering happens client-side. */
export function collectCycleLedger(projectPath: string): CycleLedgerRow[] {
  const runsPath = join(projectPath, ".roll", "loop", "runs.jsonl");
  if (!existsSync(runsPath)) return [];
  let content = "";
  try {
    content = readFileSync(runsPath, "utf8");
  } catch {
    return [];
  }
  const { byCycle, prMergedBy, prOpenBy } = readEventFacts(projectPath);
  const rows: CycleLedgerRow[] = [];
  for (const line of content.split("\n")) {
    if (line.trim() === "") continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const cycleId = String(row["cycle_id"] ?? row["run_id"] ?? "");
    if (cycleId === "") continue;
    const status = String(row["status"] ?? "");
    const outcome = String(row["outcome"] ?? "");
    const verdict = ledgerVerdict(status, outcome);
    // FIX-297: idle no-op heartbeats are loop liveness, not cycles — exclude them
    // from the ledger here at the collection point (they stay in runs.jsonl).
    if (isIdleHeartbeat(row, verdict)) continue;
    const storyId = typeof row["story_id"] === "string" ? (row["story_id"] as string) : "";
    // ts may be ISO or epoch (kimi pair-review).
    const rawTs = row["ts"];
    const ts = typeof rawTs === "string" ? Date.parse(rawTs) : typeof rawTs === "number" ? (rawTs > 10_000_000_000 ? rawTs : rawTs * 1000) : Number.NaN;
    const cost = typeof row["cost_effective_usd"] === "number" ? (row["cost_effective_usd"] as number) : typeof row["cost_usd"] === "number" ? (row["cost_usd"] as number) : undefined;
    // FIX-290 AC3: a cycle whose usage was unreadable (usage_credentials_missing)
    // carries `usage_unknown:true` — its tokens/cost are UNKNOWN ("?"), not 0/—.
    const usageUnknown = row["usage_unknown"] === true;
    const ev = byCycle.get(cycleId);
    const prNumber = storyId !== "" ? prMergedBy.get(storyId) : undefined;
    const prOpen = storyId !== "" ? prOpenBy.get(storyId) : undefined;
    const evidence: CycleLedgerRow["evidence"] = [];
    if (storyId !== "") evidence.push({ label: storyId, href: `#backlog` });
    rows.push({
      cycleId,
      tsSec: Number.isFinite(ts) ? Math.floor(ts / 1000) : 0,
      verdict,
      storyId,
      agent: String(row["agent"] ?? ""),
      model: typeof row["model"] === "string" && row["model"] !== "" ? (row["model"] as string) : String(row["agent"] ?? "—") || "—",
      tokens: fmtTokens(row["tokens_in"], row["tokens_out"], usageUnknown),
      cost: cost !== undefined ? `$${cost.toFixed(2)}` : usageUnknown ? "?" : "—",
      duration: fmtDuration(row["duration_sec"]),
      tape: rowTape(row, verdict, ev, prNumber, prOpen),
      evidence,
    });
  }
  // De-dupe duplicate cycle ids (kimi pair-review): the LAST row wins — runs.jsonl
  // is append-only, so the newest record is the corrected truth.
  const byId = new Map<string, CycleLedgerRow>();
  for (const r of rows) byId.set(r.cycleId, r);
  const out = [...byId.values()];
  out.sort((a, b) => b.tsSec - a.tsSec);
  return out;
}
