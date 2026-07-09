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
import { specIsExempt } from "./exemption-stats.js";

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

function exemptReason(specText: string): string {
  const fm = /^---\n([\s\S]*?)\n---/.exec(specText.replace(/\r\n?/g, "\n"));
  const m = /^screenshot_exempt:[ \t]*(.+)$/m.exec(fm?.[1] ?? "");
  return (m?.[1] ?? "").replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
}

/** Epics listed under `acceptance.screenshot_exempt_epics:` in policy.yaml. */
export function blanketExemptEpics(repoCwd: string): string[] {
  try {
    const raw = readFileSync(join(repoCwd, ".roll", "policy.yaml"), "utf8").replace(/\r\n?/g, "\n");
    const m = /^\s*screenshot_exempt_epics:\s*\[([^\]]*)\]/m.exec(raw);
    if (m === null) return [];
    return (m[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter((s) => s !== "");
  } catch {
    return [];
  }
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
      if (specIsExempt(spec)) cards.push({ id, epic, reason: exemptReason(spec) });
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
