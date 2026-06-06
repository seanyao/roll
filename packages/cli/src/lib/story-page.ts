/**
 * Shared story-card page generator (US-META-005/006/007).
 *
 * One source of truth for the per-story `spec.md` + `index.html` skeleton and
 * for the phase-section markup contract: `roll idea` and `roll migrate-features`
 * emit the skeleton through here, and `roll attest` flips a phase section to
 * done through `markPhaseDone` — so the emitters and the updater can never
 * drift apart (previously two hand-rolled skeletons disagreed on the section
 * markup and attest's update regex silently matched only one of them).
 */

/** Story-ID families the archive layout recognizes (`<FAMILY>-<n>` dirs). */
export const STORY_ID_RE = /^(FIX|US|IDEA|REFACTOR)-/;

/** `FIX-216` → `FIX`; null when the id is not in a known family. */
export function storyFamilyOf(storyId: string): string | null {
  const m = STORY_ID_RE.exec(storyId);
  return m === null ? null : (m[1] as string);
}

export interface StoryCardMeta {
  id: string;
  /** One-line human title; omitted for backfilled cards that only have an id. */
  title?: string;
  /** YYYY-MM-DD. */
  created: string;
  /** spec.md frontmatter `type:`; derived from the id family when omitted. */
  type?: string;
  /** spec.md frontmatter `epic:` (backfill records placement; live cards omit it). */
  epic?: string;
  /** Extra blockquote line under the spec.md heading (e.g. backfill provenance). */
  note?: string;
}

/** Lifecycle phases every story page carries, with their pending placeholders. */
export const STORY_PHASES: ReadonlyArray<readonly [string, string]> = [
  ["Design", "Not yet started"],
  ["Execution", "No cycles yet"],
  ["Delivery", "Not yet delivered"],
  ["Retrospective", "Not yet written"],
];

/** Render the `spec.md` definition file for a story card. */
export function renderSpecMd(meta: StoryCardMeta): string {
  const type = meta.type ?? storyFamilyOf(meta.id)?.toLowerCase() ?? "unknown";
  return (
    `---\n` +
    `id: ${meta.id}\n` +
    (meta.title !== undefined ? `title: ${meta.title}\n` : "") +
    `type: ${type}\n` +
    (meta.epic !== undefined ? `epic: ${meta.epic}\n` : "") +
    `created: ${meta.created}\n` +
    `---\n\n` +
    `# ${meta.id}${meta.title !== undefined ? ` — ${meta.title}` : ""}\n` +
    (meta.note !== undefined ? `\n> ${meta.note}\n` : "")
  );
}

/** Shared stylesheet — same visual language as the attest report (US-META-003). */
const STORY_PAGE_CSS =
  `:root { color-scheme: light dark; --fg:#1f2328; --bg:#ffffff; --muted:#57606a; --line:#d0d7de; }\n` +
  `@media (prefers-color-scheme: dark) { :root { --fg:#e6edf3; --bg:#0d1117; --muted:#8b949e; --line:#30363d; } }\n` +
  `body { margin:0 auto; max-width:880px; padding:32px 20px 80px; background:var(--bg); color:var(--fg);\n` +
  `  font:15px/1.65 -apple-system, "PingFang SC", "Segoe UI", sans-serif; }\n` +
  `h1 { font-size:22px; } h2 { font-size:18px; border-bottom:1px solid var(--line); padding-bottom:6px; }\n` +
  `code { background:rgba(127,127,127,.12); padding:1px 6px; border-radius:6px; font-size:.92em; }\n` +
  `pre { background:rgba(127,127,127,.08); padding:12px; border-radius:8px; overflow-x:auto; }\n` +
  `section { border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin:14px 0; }\n` +
  `.empty { color:var(--muted); font-style:italic; }\n` +
  `footer { color:var(--muted); font-size:13px; margin-top:36px; border-top:1px solid var(--line); padding-top:12px; }\n` +
  `.phase-done { border-left:4px solid #2da44e; } .phase-pending { border-left:4px solid #d0d7de; }\n` +
  `@media print { body { max-width:none; padding:0; } section { break-inside:avoid; } }\n`;

/** Render the `index.html` skeleton for a story card (all phases pending). */
export function renderStoryPage(meta: StoryCardMeta): string {
  const q = (s: string): string => s.replace(/"/g, "&quot;");
  const badge = storyFamilyOf(meta.id) ?? meta.id.split("-")[0];
  const sections = STORY_PHASES.map(
    ([phase, empty]) =>
      `<section class="phase-pending"><h2>${phase}</h2><p class="empty">${empty}</p></section>`,
  ).join("\n");
  return (
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${meta.title !== undefined ? `${meta.id} — ${q(meta.title)}` : meta.id}</title>\n` +
    `<style>\n${STORY_PAGE_CSS}</style>\n` +
    `</head>\n<body>\n` +
    `<h1>${meta.id}</h1>\n` +
    `<p class="meta"><code>${badge}</code> · Created ${meta.created}</p>\n` +
    (meta.title !== undefined ? `<p>${q(meta.title)}</p>\n` : "") +
    `${sections}\n` +
    `<footer>Roll · <a href="spec.md">spec.md</a></footer>\n</body>\n</html>\n`
  );
}

/**
 * Flip a phase section from pending to done, replacing its body. Returns the
 * html unchanged when the section is absent (legacy / hand-edited pages).
 */
export function markPhaseDone(html: string, phase: string, innerHtml: string): string {
  return html.replace(
    new RegExp(`<section class="phase-pending">\\s*<h2>${phase}</h2>[\\s\\S]*?</section>`),
    `<section class="phase-done"><h2>${phase}</h2>${innerHtml}</section>`,
  );
}
