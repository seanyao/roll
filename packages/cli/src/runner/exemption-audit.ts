/**
 * US-EVID-027 — read-only audit of EXISTING screenshot exemptions.
 *
 * The new exemption discipline (US-EVID-025) is forward-enforcing; this lists
 * the ~306 legacy per-card exemptions and any policy epic-level blanket exempt
 * (`acceptance.screenshot_exempt_epics`) so they can be reviewed in batches. It
 * ONLY reports — it never blocks or rewrites anything (追溯不阻塞). Pure read.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readExemption } from "./exemption-stats.js";

export interface ExemptCard {
  id: string;
  epic: string;
  reason: string;
}

export interface ExemptionAudit {
  /** Per-card `screenshot_exempt: <reason>` cards, sorted by epic then id. */
  cards: ExemptCard[];
  /** Epics blanket-exempted by policy `acceptance.screenshot_exempt_epics`. */
  blanketEpics: string[];
}

/**
 * Epics under `acceptance.screenshot_exempt_epics:` — best-effort, supporting
 * both YAML forms: inline flow `[a, b]` AND a block sequence (`- a` lines that
 * follow the key). Parse failure ⇒ [] (never throws).
 */
export function blanketExemptEpics(repoCwd: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(join(repoCwd, ".roll", "policy.yaml"), "utf8").replace(/\r\n?/g, "\n");
  } catch {
    return [];
  }
  const clean = (s: string): string => s.trim().replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
  const key = /^([ \t]*)screenshot_exempt_epics:[ \t]*(.*)$/m.exec(raw);
  if (key === null) return [];
  const inline = (key[2] ?? "").trim();
  const flow = /^\[([^\]]*)\]/.exec(inline);
  if (flow !== null) {
    return (flow[1] ?? "").split(",").map(clean).filter((s) => s !== "");
  }
  if (inline !== "" && inline !== "|" && inline !== ">") return [clean(inline)].filter((s) => s !== "");
  // Block sequence: `- item` lines following the key, more-indented than it.
  const keyIndent = (key[1] ?? "").length;
  const rest = raw.slice((key.index ?? 0) + key[0].length).split("\n");
  const out: string[] = [];
  for (const line of rest) {
    if (line.trim() === "") continue;
    const item = /^([ \t]*)-[ \t]+(.*)$/.exec(line);
    if (item !== null && (item[1] ?? "").length > keyIndent) {
      const v = clean(item[2] ?? "");
      if (v !== "") out.push(v);
      continue;
    }
    break; // dedented / non-list line ends the block
  }
  return out;
}

/** Enumerate all per-card exemptions + policy blanket-exempt epics. Read-only. */
export function exemptionAudit(repoCwd: string): ExemptionAudit {
  const featuresDir = join(repoCwd, ".roll", "features");
  const cards: ExemptCard[] = [];
  let epics: string[];
  try {
    epics = readdirSync(featuresDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    epics = [];
  }
  for (const epic of epics) {
    let ids: string[];
    try {
      ids = readdirSync(join(featuresDir, epic), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    for (const id of ids) {
      let spec: string;
      try {
        spec = readFileSync(join(featuresDir, epic, id, "spec.md"), "utf8");
      } catch {
        continue;
      }
      const ex = readExemption(spec);
      if (ex.exempt) cards.push({ id, epic, reason: ex.reason });
    }
  }
  cards.sort((a, b) => (a.epic === b.epic ? a.id.localeCompare(b.id) : a.epic.localeCompare(b.epic)));
  return { cards, blanketEpics: blanketExemptEpics(repoCwd) };
}

/** Human-readable audit report (read-only; the header states it never blocks). */
export function renderExemptionAudit(audit: ExemptionAudit): string {
  const lines = [`screenshot_exempt audit (read-only — forward-enforce, never blocks存量):`];
  lines.push(`  per-card exemptions: ${audit.cards.length}`);
  for (const c of audit.cards) lines.push(`    ${c.epic}/${c.id} — ${c.reason}`);
  lines.push(`  blanket-exempt epics: ${audit.blanketEpics.length === 0 ? "(none)" : audit.blanketEpics.join(", ")}`);
  return lines.join("\n");
}
