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
import { BacklogStore, appendBacklogRow } from "@roll/core";
import { STORY_ID_RE, renderSpecMd, renderStoryPage } from "../lib/story-page.js";

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
      "Usage: roll story new <ID> --title <text> [--epic <epic>] [--note <text>] [--no-index]\n" +
        "  The ONE card-minting entry: card folder (spec.md + index.html) + backlog row\n" +
        "  + .roll/index.json cache refresh. --no-index defers the cache for batch minting;\n" +
        "  the cache is best-effort — the live locator resolves cards without it.\n" +
        "  单一建卡入口:卡夹 + backlog 行 + index.json 缓存刷新一步完成。\n" +
        "  批量建卡用 --no-index 延后缓存;缓存是尽力而为,定位器无需它即可解析卡片。\n",
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
  // FIX-250: a card is BORN with its backlog row — "单一建卡入口" was only half
  // the chain while agents still hand-appended rows. Optimistically-locked
  // write (I9); an existing row is a no-op so re-runs stay idempotent.
  let rowNote = "";
  try {
    const backlogPath = join(cwd, ".roll", "backlog.md");
    if (existsSync(backlogPath)) {
      const store = new BacklogStore();
      const before = store.readBacklog(backlogPath);
      let appended = false;
      store.writeBacklog(backlogPath, before.hash, (content) => {
        const r = appendBacklogRow(content, { id, title, epic });
        appended = r.appended;
        return r.content;
      });
      rowNote = appended ? `  backlog row appended (📋 Todo)\n` : `  backlog row already present — untouched\n`;
    } else {
      rowNote = "  no .roll/backlog.md — row skipped\n";
    }
  } catch (e) {
    rowNote = `  backlog row append failed (${e instanceof Error ? e.message : "?"}) — append it manually\n`;
  }
  // US-V4-001: maintain the lightweight `.roll/index.json` ID→epic CACHE at card
  // creation (best-effort; the live-first locator works without it). --no-index
  // defers even that for batch minting. The global dossier/epic page refresh is
  // NO LONGER a delivery side effect — run `roll index` to render pages on demand.
  if (!args.includes("--no-index")) {
    try {
      generateIndex(cwd);
    } catch {
      /* index cache is best-effort; the locator re-derives via live walk */
    }
  }
  process.stdout.write(`card minted\n卡已建档\n  .roll/features/${epic}/${id}/spec.md\n${rowNote}`);
  return 0;
}
