/**
 * US-META-001 — `roll index`: (re)generate `.roll/index.json`, the authoritative
 * ID→epic map the archive layout uses to place a card's deliverables under
 * `features/<epic>/<ID>/`. Also regenerates `features/index.html`, redesigned
 * as the Delivery Dossier front page (US-DOSSIER-001a; supersedes the
 * US-META-003 flat table). Deterministic + idempotent.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHROME_CONTROLS, CHROME_CSS, CHROME_SCRIPT, bi } from "@roll/core";
import { collectDossier, generateIndex } from "../lib/archive.js";
import { renderFeaturesIndex } from "../lib/dossier-index.js";
import { morningReportHref } from "../lib/morning-report.js";
import { renderEpicPage } from "../lib/epic-page.js";
import { collectStoryDossierInput, renderStoryDossier, stationsDone } from "../lib/story-dossier.js";
import { renderMarkdown } from "../lib/markdown.js";

/** US-DOSSIER-004: render a card's spec.md → a self-contained spec.html (the
 *  minimal markdown renderer + dossier chrome), so the "Design doc" link opens
 *  a rendered page, not raw markdown. Returns null when spec.md is absent. */
function renderSpecHtml(storyDir: string, id: string): string | null {
  const specPath = join(storyDir, "spec.md");
  if (!existsSync(specPath)) return null;
  let md: string;
  try {
    md = readFileSync(specPath, "utf8");
  } catch {
    return null;
  }
  return (
    `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${id} · spec</title>\n<style>\n${CHROME_CSS}</style>\n${CHROME_SCRIPT}\n` +
    `</head>\n<body>\n${CHROME_CONTROLS}\n` +
    `<p class="crumb"><a href="index.html">← ${bi("Story Dossier", "故事档案")}</a></p>\n` +
    `<article class="md">\n${renderMarkdown(md)}\n</article>\n` +
    `<footer>Roll · ${bi("rendered from", "渲染自")} <code>spec.md</code></footer>\n</body>\n</html>\n`
  );
}

/** `roll index` — regenerate the backlog-derived ID→epic index + the three
 *  dossier layers (front page → epic pages → story dossiers, US-DOSSIER-001d). */
export function indexCommand(args: string[]): number {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      "Usage: roll index [--rebuild]\n" +
        "  Regenerate .roll/index.json + the Delivery Dossier (front page, every epic page).\n" +
        "  Story dossier pages are living mount boards: each lifecycle node mounts its own\n" +
        "  facts onto the existing page, so by default an existing story page is left intact.\n" +
        "  --rebuild  force a full re-render of every story page from source (reconciliation:\n" +
        "             derailed/hand-merged or migrated history cards). Overwrites mounted content.\n",
    );
    return 0;
  }
  // US-DOSSIER-007 (AC3): full re-render is the explicit reconciliation tool, not
  // the hot path — by default we never overwrite an existing story page (its
  // incremental mounts would be lost when source can't reconstruct them).
  const rebuild = args.includes("--rebuild");
  const cwd = process.cwd();
  const stories = generateIndex(cwd);
  const n = Object.keys(stories).length;
  process.stdout.write(`index.json regenerated\n索引已重建\n  ${n} stories mapped to epics (.roll/index.json)\n`);

  // US-DOSSIER-001a/b/c/d: the three dossier layers, from the live card tree.
  const featuresDir = join(cwd, ".roll", "features");
  if (existsSync(featuresDir)) {
    const epics = collectDossier(cwd);
    // US-DOSSIER: enrich each story with its real lifecycle stations (read its
    // evidence via the same collector the per-story page uses) so the index spine
    // reflects definition→design→execution→delivery→retrospective accurately.
    for (const epic of epics) {
      for (const story of epic.stories) {
        try {
          story.stages = [...stationsDone(collectStoryDossierInput(cwd, story))];
        } catch {
          /* best-effort — spine just shows fewer stations */
        }
      }
    }
    let pages = 0;
    try {
      writeFileSync(join(featuresDir, "index.html"), renderFeaturesIndex(epics, { morningReportHref: morningReportHref(cwd) }), "utf8");
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
        const storyDir = join(featuresDir, epic.name, story.id);
        try {
          const storyIndex = join(storyDir, "index.html");
          // Mount board: only (re)render when forced or when the page is missing
          // (a brand-new card needs its initial skeleton).
          if (rebuild || !existsSync(storyIndex)) {
            writeFileSync(storyIndex, renderStoryDossier(collectStoryDossierInput(cwd, story)), "utf8");
            pages += 1;
          }
          // US-DOSSIER-004: rendered spec.html the "Design doc" link points at.
          const specHtml = renderSpecHtml(storyDir, story.id);
          if (specHtml !== null) {
            writeFileSync(join(storyDir, "spec.html"), specHtml, "utf8");
            pages += 1;
          }
        } catch {
          /* best-effort */
        }
      }
    }
    process.stdout.write(`Delivery Dossier regenerated (${pages} pages)\n交付档案已重建（${pages} 页）\n`);
  }

  return 0;
}
