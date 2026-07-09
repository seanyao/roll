/**
 * US-EVID-026 — screenshot_exempt rate as an observability signal.
 *
 * 27% of cards self-exempt from visual evidence; if exemption quietly creeps
 * back to "the easy default", the acceptance bar erodes. This surfaces the rate
 * (overall + per epic) as a SMELL signal — never a gate — so a drift back up is
 * visible. Pure read of `.roll/features/<epic>/<id>/spec.md`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface EpicExemption {
  epic: string;
  total: number;
  exempt: number;
}

export interface ExemptionStats {
  total: number;
  exempt: number;
  /** exempt / total in [0,1]; 0 when total is 0. */
  rate: number;
  byEpic: EpicExemption[];
}

/** A card carries a REAL exemption iff `screenshot_exempt:` has a non-boolean reason. */
export function specIsExempt(specText: string): boolean {
  const fm = /^---\n([\s\S]*?)\n---/.exec(specText.replace(/\r\n?/g, "\n"));
  if (fm === null) return false;
  const m = /^screenshot_exempt:[ \t]*(.+)$/m.exec(fm[1] ?? "");
  if (m === null) return false;
  const reason = (m[1] ?? "").replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
  return reason !== "" && !/^(false|no|0|true|yes|on|1)$/i.test(reason);
}

/**
 * Scan every card spec under `.roll/features` and tally the exemption rate,
 * overall and per epic. Best-effort: an unreadable spec/epic is skipped, never
 * throws. Cards sort by epic for a stable board rendering.
 */
export function exemptionStats(repoCwd: string): ExemptionStats {
  const featuresDir = join(repoCwd, ".roll", "features");
  const perEpic = new Map<string, { total: number; exempt: number }>();
  let epics: string[];
  try {
    epics = readdirSync(featuresDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return { total: 0, exempt: 0, rate: 0, byEpic: [] };
  }
  for (const epic of epics) {
    const epicDir = join(featuresDir, epic);
    let cards: string[];
    try {
      cards = readdirSync(epicDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    for (const card of cards) {
      let spec: string;
      try {
        spec = readFileSync(join(epicDir, card, "spec.md"), "utf8");
      } catch {
        continue; // no spec.md in this folder — not a card
      }
      const cur = perEpic.get(epic) ?? { total: 0, exempt: 0 };
      cur.total += 1;
      if (specIsExempt(spec)) cur.exempt += 1;
      perEpic.set(epic, cur);
    }
  }
  const byEpic = [...perEpic.entries()]
    .map(([epic, v]) => ({ epic, total: v.total, exempt: v.exempt }))
    .sort((a, b) => a.epic.localeCompare(b.epic));
  const total = byEpic.reduce((s, e) => s + e.total, 0);
  const exempt = byEpic.reduce((s, e) => s + e.exempt, 0);
  return { total, exempt, rate: total === 0 ? 0 : exempt / total, byEpic };
}

/** One-line board/status summary, e.g. `screenshot_exempt: 27% (306/1117)`. */
export function exemptionSummaryLine(stats: ExemptionStats): string {
  const pct = Math.round(stats.rate * 100);
  return `screenshot_exempt: ${pct}% (${stats.exempt}/${stats.total})`;
}
