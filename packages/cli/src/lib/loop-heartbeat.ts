/**
 * US-DOSSIER-011 — loop heartbeat collection for the Truth Console overview.
 *
 * Best-effort, injected-fs: for each roll lane on this machine (loop / dream),
 * report whether it is scheduled (launchd plist present), its period, the last
 * cycle stamp from runs.jsonl, and the derived next fire. A collection miss
 * yields an honest empty/partial lane — never a throw (the console must render
 * with whatever is knowable).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TruthSnapshotLoop, TruthSnapshotLoopLane } from "@roll/spec";

export interface HeartbeatDeps {
  /** plist text for a lane, or null when not installed. */
  plistText: (svc: string) => string | null;
  /** latest runs.jsonl row ts (ISO) or null. */
  lastRunAt: () => string | null;
}

const LANES = ["loop", "dream"] as const;

export function defaultHeartbeatDeps(projectPath: string, slug: string, launchAgentsDir: string): HeartbeatDeps {
  return {
    plistText: (svc) => {
      const p = join(launchAgentsDir, `com.roll.${svc}.${slug}.plist`);
      try {
        return existsSync(p) ? readFileSync(p, "utf8") : null;
      } catch {
        return null;
      }
    },
    lastRunAt: () => {
      try {
        const lines = readFileSync(join(projectPath, ".roll", "loop", "runs.jsonl"), "utf8").trim().split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i] ?? "";
          if (line.trim() === "") continue;
          const row = JSON.parse(line) as { ts?: string };
          if (typeof row.ts === "string" && row.ts !== "") return row.ts;
        }
      } catch {
        /* no runs yet */
      }
      return null;
    },
  };
}

function periodMinutes(plist: string): number | undefined {
  const m = /<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/.exec(plist);
  if (m?.[1] !== undefined) return Math.round(Number(m[1]) / 60);
  if (plist.includes("<key>StartCalendarInterval</key>")) return 24 * 60; // daily calendar lane
  return undefined;
}

function addMinutes(iso: string, min: number): string | undefined {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms + min * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Collect the heartbeat lanes; lanes that are off still appear (state off). */
export function collectLoopHeartbeat(deps: HeartbeatDeps): TruthSnapshotLoop {
  const lanes: TruthSnapshotLoopLane[] = [];
  const last = deps.lastRunAt();
  for (const svc of LANES) {
    const plist = deps.plistText(svc);
    const running = plist !== null;
    const everyMin = plist !== null ? periodMinutes(plist) : undefined;
    const lane: TruthSnapshotLoopLane = {
      name: svc,
      running,
      mode: svc === "loop" ? "cron" : "nightly",
      ...(everyMin !== undefined ? { everyMin } : {}),
    };
    if (svc === "loop" && last !== null) {
      lane.lastAt = last;
      if (everyMin !== undefined) {
        const next = addMinutes(last, everyMin);
        if (next !== undefined) lane.nextAt = next;
      }
    }
    lanes.push(lane);
  }
  return { lanes };
}
