/**
 * US-DOSSIER-033 — the About machine-global page.
 *
 * About is the harness's own charter, surfaced read-only behind the machine
 * breadcrumb (`About / 关于`). It renders, via the SAME minimal markdown render
 * path the dossier already uses (`renderMarkdown`, the SKILL.md viewer's engine
 * — no second markdown engine, no CDN lib), the project's:
 *   - identity (name + slogan) — from INJECTED brand props, never hardcoded;
 *   - `docs/manifesto.md` — the feedback-loop principles;
 *   - `docs/architecture.md` — capability domains + layered control;
 *   - the guide map (`guide/INDEX.md`) — entries that point to their source docs.
 *
 * Self-contained (AC5): doc bodies are read at generate time and baked in; the
 * page makes no network fetch and renders identically offline.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bi } from "@roll/core";
import { machineKicker, machinePalette, renderMachineShell, type ProjectRegistryEntry, type TruthConsoleBrand } from "./truth-console.js";

export interface AboutDoc {
  /** Repo-relative source path (also the section anchor). */
  path: string;
  /** First `# ` heading, else the basename. */
  title: string;
  /** Rendered markdown HTML fragment. */
  html: string;
}

export interface AboutVM {
  /** docs/manifesto.md, rendered — undefined when absent. */
  manifesto: AboutDoc | undefined;
  /** docs/architecture.md, rendered — undefined when absent. */
  architecture: AboutDoc | undefined;
  /** The guide-map rows parsed from guide/INDEX.md (path · title · category). */
  guide: AboutGuideRow[];
}

/** One row of the guide map (one doc the INDEX table lists). */
export interface AboutGuideRow {
  path: string;
  title: string;
  category: string;
}

export interface AboutDeps {
  readDoc: (rel: string) => string | undefined;
  render: (md: string) => string;
}

function docTitle(src: string, rel: string): string {
  for (const raw of src.split("\n")) {
    const m = /^#\s+(.*)$/.exec(raw.trim());
    if (m) return m[1]!.trim();
  }
  return (rel.split("/").at(-1) ?? rel).replace(/\.md$/, "");
}

function renderDoc(deps: AboutDeps, rel: string): AboutDoc | undefined {
  const src = deps.readDoc(rel);
  if (src === undefined) return undefined;
  return { path: rel, title: docTitle(src, rel), html: deps.render(src) };
}

/**
 * Parse the `guide/INDEX.md` markdown table into rows. The table is the
 * roll-doc-generated `| Path | Title | Category | Last Modified |` shape; we
 * keep the first three columns and skip the header + separator rows. Order is
 * preserved (deterministic). Tolerant of a missing/empty file → [].
 */
export function parseGuideIndex(src: string | undefined): AboutGuideRow[] {
  if (src === undefined) return [];
  const rows: AboutGuideRow[] = [];
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // split("|") on "| a | b |" → ["", "a", "b", ""]; drop the empty ends.
    const cols = cells.slice(1, -1);
    if (cols.length < 3) continue;
    const [path, title, category] = cols;
    if (path === undefined || title === undefined || category === undefined) continue;
    // skip the header row and the |---|---| separator row.
    if (path.toLowerCase() === "path") continue;
    if (/^-{2,}$/.test(path.replace(/\s/g, "")) || /^:?-+:?$/.test(path)) continue;
    rows.push({ path, title, category });
  }
  return rows;
}

/** Collect the About view-model from the real doc tree (pure over deps). */
export function collectAbout(deps: AboutDeps): AboutVM {
  return {
    manifesto: renderDoc(deps, "docs/manifesto.md"),
    architecture: renderDoc(deps, "docs/architecture.md"),
    guide: parseGuideIndex(deps.readDoc("guide/INDEX.md")),
  };
}

/** Default deps — best-effort real reads rooted at `cwd`. */
export function defaultAboutDeps(cwd: string, render: (md: string) => string): AboutDeps {
  return {
    readDoc: (rel) => {
      const abs = join(cwd, rel);
      if (!existsSync(abs)) return undefined;
      try {
        return readFileSync(abs, "utf8");
      } catch {
        return undefined;
      }
    },
    render,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface RenderAboutInput {
  brand: TruthConsoleBrand;
  vm: AboutVM;
  projects?: ProjectRegistryEntry[];
  currentSlug?: string;
  snapshot: { release?: { latestTag?: string } };
}

/**
 * US-DOSSIER-033 — render the About machine page: identity (injected brand) +
 * manifesto + architecture (rendered markdown, the SKILL.md-style path) + the
 * guide map (rows link to their source docs). Wrapped in the shared machine
 * shell so it wears the same top bar + lang script as the console.
 */
export function renderAboutPage(input: RenderAboutInput): string {
  const C = machinePalette();
  const MONO = C.mono;
  const { vm, brand } = input;

  const identity =
    `<section style="border:1px solid ${C.line};border-radius:12px;background:${C.card};padding:22px 24px;margin:18px 0;box-shadow:0 1px 2px rgba(17,26,69,.05);">` +
    `<div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;">` +
    `<span style="${MONO}font-size:26px;font-weight:700;letter-spacing:-.01em;color:${C.ink};">${esc(brand.name)}</span>` +
    (brand.slogan !== "" ? `<span style="font-size:15px;color:${C.sub};">${esc(brand.slogan)}</span>` : "") +
    `</div>` +
    `<div style="${MONO}font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:${C.faint};margin-top:10px;">${bi("project identity · injected, not hardcoded", "项目身份 · 注入而非硬编码")}</div>` +
    `</section>`;

  const docSection = (doc: AboutDoc | undefined, fallbackEn: string, fallbackZh: string): string => {
    if (doc === undefined) {
      return (
        `<section style="border:1px dashed ${C.line};border-radius:12px;background:${C.card};padding:20px 22px;margin:14px 0;color:${C.faint};font-size:13px;">` +
        bi(fallbackEn, fallbackZh) +
        `</section>`
      );
    }
    return (
      `<section style="border:1px solid ${C.line};border-radius:12px;background:${C.card};padding:22px 26px;margin:14px 0;box-shadow:0 1px 2px rgba(17,26,69,.04);">` +
      `<div style="${MONO}font-size:11px;color:${C.blue};background:${C.blue}0d;border:1px solid ${C.blue}33;border-radius:6px;padding:3px 9px;display:inline-block;margin:0 0 14px;">${esc(doc.path)}</div>` +
      `<div class="md-body">${doc.html}</div></section>`
    );
  };

  const guideRows = vm.guide
    .map(
      (r) =>
        `<a href="${esc(r.path)}" style="display:grid;grid-template-columns:1fr 130px;gap:14px;align-items:baseline;padding:9px 16px;border-bottom:1px solid ${C.hair};text-decoration:none;">` +
        `<span style="min-width:0;"><span style="font-size:13.5px;color:${C.ink};font-weight:600;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.title)}</span>` +
        `<span style="${MONO}font-size:10.5px;color:${C.faint};display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.path)}</span></span>` +
        `<span style="${MONO}font-size:11px;color:${C.sub};text-align:right;">${esc(r.category)}</span></a>`,
    )
    .join("");
  const guideSection =
    vm.guide.length > 0
      ? `<section style="border:1px solid ${C.line};border-radius:12px;background:${C.card};overflow:hidden;margin:14px 0;box-shadow:0 1px 2px rgba(17,26,69,.04);">` +
        `<div style="display:grid;grid-template-columns:1fr 130px;gap:14px;padding:9px 16px;border-bottom:1px solid ${C.line};${MONO}font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${C.faint};"><span>${bi("doc", "文档")}</span><span style="text-align:right;">${bi("category", "类别")}</span></div>` +
        guideRows +
        `</section>`
      : "";

  const sectionLabel = (en: string, zh: string): string =>
    `<div style="display:flex;align-items:baseline;gap:12px;margin:26px 0 4px;"><span style="${MONO}font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${C.sub};font-weight:600;">${bi(en, zh)}</span><span style="flex:1;height:1px;background:#dfe4ec;"></span></div>`;

  const body =
    `<div style="padding:34px 0 4px;">` +
    machineKicker(bi("Machine layer · about", "机器层 · 关于")) +
    `<h1 style="margin:10px 0 0;font-size:33px;line-height:1.1;font-weight:700;letter-spacing:-.02em;color:${C.ink};">${bi("About — Charter", "关于 — 章程")}</h1>` +
    `<p style="margin:12px 0 0;max-width:680px;font-size:15.5px;line-height:1.6;color:${C.sub};">${bi(
      "Who roll is, the feedback loop it is built around, and the map of its own guide — rendered read-only from the repo.",
      "roll 是谁、它围绕的反馈闭环、以及它自身指南的索引——从仓库只读渲染。",
    )}</p></div>` +
    identity +
    sectionLabel("Manifesto", "理念") +
    docSection(vm.manifesto, "docs/manifesto.md not found.", "未找到 docs/manifesto.md。") +
    sectionLabel("Architecture", "架构") +
    docSection(vm.architecture, "docs/architecture.md not found.", "未找到 docs/architecture.md。") +
    sectionLabel("Guide map", "指南索引") +
    (guideSection !== "" ? guideSection : `<section style="border:1px dashed ${C.line};border-radius:12px;background:${C.card};padding:20px 22px;margin:14px 0;color:${C.faint};font-size:13px;">${bi("guide/INDEX.md not found.", "未找到 guide/INDEX.md。")}</section>`);

  return renderMachineShell({
    page: "about",
    titleText: "About",
    brand,
    body,
    snapshot: input.snapshot,
    ...(input.projects !== undefined ? { projects: input.projects } : {}),
    ...(input.currentSlug !== undefined ? { currentSlug: input.currentSlug } : {}),
  });
}
