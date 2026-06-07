/**
 * US-META-001 — `roll index`: (re)generate `.roll/index.json`, the authoritative
 * ID→epic map the archive layout uses to place a card's deliverables under
 * `features/<epic>/<ID>/`. Also regenerates `features/index.html`, redesigned
 * as the Delivery Dossier front page (US-DOSSIER-001a; supersedes the
 * US-META-003 flat table). Deterministic + idempotent.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectDossier, generateIndex } from "../lib/archive.js";
import { renderFeaturesIndex } from "../lib/dossier-index.js";

/** `roll index` — regenerate the backlog-derived ID→epic index + features root page. */
export function indexCommand(args: string[]): number {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write("Usage: roll index\n  Regenerate .roll/index.json + .roll/features/index.html\n");
    return 0;
  }
  const cwd = process.cwd();
  const stories = generateIndex(cwd);
  const n = Object.keys(stories).length;
  process.stdout.write(`index.json regenerated\n索引已重建\n  ${n} stories mapped to epics (.roll/index.json)\n`);

  // US-DOSSIER-001a: the Delivery Dossier front page, from the live card tree.
  const featuresDir = join(cwd, ".roll", "features");
  if (existsSync(featuresDir)) {
    try {
      writeFileSync(join(featuresDir, "index.html"), renderFeaturesIndex(collectDossier(cwd)), "utf8");
      process.stdout.write(`features/index.html regenerated\n`);
    } catch {
      /* best-effort */
    }
  }

  return 0;
}
