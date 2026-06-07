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
import { renderEpicPage } from "../lib/epic-page.js";
import { collectStoryDossierInput, renderStoryDossier } from "../lib/story-dossier.js";

/** `roll index` — regenerate the backlog-derived ID→epic index + the three
 *  dossier layers (front page → epic pages → story dossiers, US-DOSSIER-001d). */
export function indexCommand(args: string[]): number {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      "Usage: roll index\n  Regenerate .roll/index.json + the Delivery Dossier pages\n  (features/index.html, every epic page, every story dossier)\n",
    );
    return 0;
  }
  const cwd = process.cwd();
  const stories = generateIndex(cwd);
  const n = Object.keys(stories).length;
  process.stdout.write(`index.json regenerated\n索引已重建\n  ${n} stories mapped to epics (.roll/index.json)\n`);

  // US-DOSSIER-001a/b/c/d: the three dossier layers, from the live card tree.
  const featuresDir = join(cwd, ".roll", "features");
  if (existsSync(featuresDir)) {
    const epics = collectDossier(cwd);
    let pages = 0;
    try {
      writeFileSync(join(featuresDir, "index.html"), renderFeaturesIndex(epics), "utf8");
      pages += 1;
    } catch {
      /* best-effort */
    }
    for (const epic of epics) {
      try {
        writeFileSync(join(featuresDir, epic.name, "index.html"), renderEpicPage(epic), "utf8");
        pages += 1;
      } catch {
        /* best-effort */
      }
      for (const story of epic.stories) {
        try {
          writeFileSync(
            join(featuresDir, epic.name, story.id, "index.html"),
            renderStoryDossier(collectStoryDossierInput(cwd, story)),
            "utf8",
          );
          pages += 1;
        } catch {
          /* best-effort */
        }
      }
    }
    process.stdout.write(`Delivery Dossier regenerated (${pages} pages)\n交付档案已重建（${pages} 页）\n`);
  }

  return 0;
}
