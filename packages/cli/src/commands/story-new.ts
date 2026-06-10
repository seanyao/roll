/**
 * `roll story new` — the SINGLE channel for minting a card folder
 * (US-META-009). Reverse-derivation audit, 2026-06-08: card creation had no
 * code-enforced shape — `roll idea` generated proper cards, but design-time
 * splits hand-wrote (or skipped) spec.md, producing frontmatter-less specs
 * and backlog rows with no card at all (US-DOSSIER-001a~d, SoloGo). Skills
 * now call this command instead of hand-writing files.
 *
 *   roll story new <ID> --title <text> [--epic <epic>] [--note <text>]
 *
 * Creates `features/<epic>/<ID>/spec.md` (frontmatter via renderSpecMd) and
 * the story page skeleton, then refreshes `.roll/index.json`. Refuses to
 * overwrite an existing spec — cards are born once, evolved by hand after.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UNCATEGORIZED, generateIndex } from "../lib/archive.js";
import { STORY_ID_RE, renderSpecMd, renderStoryPage } from "../lib/story-page.js";
import { refreshAggregates } from "./index-gen.js";

function todayYmd(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parse `--flag value` pairs; returns null on malformed input. */
function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  return args[i + 1];
}

export function storyNewCommand(args: string[]): number {
  if (args[0] === "--help" || args[0] === "-h" || args[0] === undefined) {
    process.stdout.write(
      "Usage: roll story new <ID> --title <text> [--epic <epic>] [--note <text>]\n" +
        "  Mint the card folder: features/<epic>/<ID>/spec.md + index.html, refresh index.json\n",
    );
    return args[0] === undefined ? 1 : 0;
  }
  const id = args[0];
  if (!STORY_ID_RE.test(id)) {
    process.stderr.write(`story new: '${id}' is not a story id (US-/FIX-/REFACTOR-/IDEA-…)\nstory new: '${id}' 不是合法故事 ID\n`);
    return 2;
  }
  const title = flagValue(args, "--title");
  if (title === undefined || title === "") {
    process.stderr.write("story new: --title is required\nstory new: 必须提供 --title\n");
    return 2;
  }
  const epic = flagValue(args, "--epic") ?? UNCATEGORIZED;
  const note = flagValue(args, "--note");

  const cwd = process.cwd();
  const dir = join(cwd, ".roll", "features", epic, id);
  if (existsSync(join(dir, "spec.md"))) {
    process.stderr.write(`story new: ${epic}/${id}/spec.md already exists — cards are born once\nstory new: 卡已存在，不可覆盖\n`);
    return 1;
  }
  const meta = {
    id,
    title,
    created: todayYmd(),
    ...(epic !== UNCATEGORIZED ? { epic } : {}),
    ...(note !== undefined && note !== "" ? { note } : {}),
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), renderSpecMd(meta), "utf8");
  writeFileSync(join(dir, "index.html"), renderStoryPage(meta), "utf8");
  try {
    generateIndex(cwd);
  } catch {
    /* index refresh is best-effort; attest re-derives via live walk */
  }
  // FIX-231: a new card changes the board's truth — refresh the aggregate
  // pages so it appears on the front page immediately (never blocks).
  refreshAggregates(cwd);
  process.stdout.write(`card minted\n卡已建档\n  .roll/features/${epic}/${id}/spec.md\n`);
  return 0;
}
