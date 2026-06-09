/**
 * TS port of lib/slides-render.py — deck.md → HTML renderer (frozen v2 oracle).
 *
 * Faithfully reimplements the python module's OBSERVABLE contract: the same
 * deck.md parser (YAML-subset frontmatter + per-slide blocks), the same
 * Mustache subset, the same minimal-markdown fallback, and the same layout
 * routing. Output is byte-identical to `python3 slides-render.py <deck> <tpl>
 * <out>` for the deck subset the schema permits.
 *
 * markdown-lib note: the python renderer tries the optional `markdown` package
 * first and only falls back to `_minimal_markdown` when it is absent. The v3
 * difftest env (and the roll runtime) does not install `markdown`, so the
 * minimal renderer is the live path; that is what this port reproduces. (If a
 * host ever installs `markdown`, the bash oracle would diverge — out of scope:
 * the frozen v2 ships no such dependency.)
 *
 * Templates + component partials are NOT embedded — they are read from
 * ROLL_PKG_DIR/lib/slides/{templates,components} at runtime exactly as the
 * python renderer reads them, so the shipped HTML/CSS is the single source.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";

// ─────────────────────────── scalar coercion ─────────────────────────────────

export type Scalar = string | number | boolean;
export type DeckValue = Scalar | DeckValue[] | { [k: string]: DeckValue };

/** _coerce_scalar: strip wrapping quotes; coerce int-looking values to int. */
export function coerceScalar(v: string): Scalar {
  if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === "'" || v[0] === '"')) {
    return v.slice(1, -1);
  }
  if (v.toLowerCase() === "true") return true;
  if (v.toLowerCase() === "false") return false;
  // python int(v): optional sign, all digits, no decimal/exponent. Mirror that.
  if (/^[+-]?\d+$/.test(v)) {
    const n = Number(v);
    if (Number.isSafeInteger(n)) return n;
  }
  return v;
}

const SCALAR_LIST_KEYS = new Set(["evidence"]);

// ─────────────────────────── frontmatter parse ───────────────────────────────

export interface Frontmatter {
  [k: string]: Scalar;
}

/** parse_frontmatter: split deck.md into (frontmatter, body). */
export function parseFrontmatter(src: string): [Frontmatter, string] {
  const lines = src.split("\n");
  if (lines.length === 0 || lines[0]!.trim() !== "---") {
    throw new ValueError("deck.md must start with a '---' frontmatter delimiter");
  }
  let end: number | null = null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === null) {
    throw new ValueError("deck.md frontmatter missing closing '---' delimiter");
  }
  const fm: Frontmatter = {};
  for (const raw of lines.slice(1, end)) {
    if (raw.trim() === "" || raw.replace(/^\s+/, "").startsWith("#")) continue;
    if (!raw.includes(":")) {
      throw new ValueError(`frontmatter line not a key:value pair: ${pyRepr(raw)}`);
    }
    const idx = raw.indexOf(":");
    const key = raw.slice(0, idx).trim();
    const val = raw.slice(idx + 1).trim();
    fm[key] = coerceScalar(val);
  }
  const body = lines.slice(end + 1).join("\n");
  return [fm, body];
}

// ───────────────────────────── slide parse ───────────────────────────────────

const SLIDE_HEADER_RE = /^##\s+Slide\s+(\d+)\s*$/;

export interface Slide {
  [k: string]: DeckValue;
}

/** splitlines() semantics: python str.splitlines() drops a single trailing
 * newline and does NOT yield a trailing empty element the way JS split("\n")
 * would. We mirror python by splitting on \n then dropping one trailing "". */
function splitlines(s: string): string[] {
  // python splitlines splits on more separators, but deck.md is \n-only in the
  // schema; mirror the common case (and \r\n via normalising \r away first to
  // match read_text which keeps bytes — decks are LF). Keep it \n-faithful.
  const parts = s.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** parse_slides: walk body into slide dicts. */
export function parseSlides(body: string): Slide[] {
  const lines = splitlines(body);
  const slides: Slide[] = [];
  let cur: Slide | null = null;
  let curLines: string[] = [];
  for (const line of lines) {
    const m = SLIDE_HEADER_RE.exec(line);
    if (m) {
      if (cur !== null) {
        populateSlide(cur, curLines);
        slides.push(cur);
      }
      cur = { number: parseInt(m[1]!, 10) };
      curLines = [];
    } else if (cur !== null) {
      curLines.push(line);
    }
  }
  if (cur !== null) {
    populateSlide(cur, curLines);
    slides.push(cur);
  }
  return slides;
}

function indentOf(s: string): number {
  return s.length - s.replace(/^ +/, "").length;
}

function populateSlide(slide: Slide, contentLines: string[]): void {
  let i = 0;
  const n = contentLines.length;
  while (i < n) {
    const raw = contentLines[i]!;
    const stripped = raw.trim();
    if (!stripped) {
      i += 1;
      continue;
    }
    if (!raw.includes(":")) {
      i += 1;
      continue;
    }
    const ci = raw.indexOf(":");
    const key = raw.slice(0, ci).trim();
    const val = raw.slice(ci + 1).trim();

    if (val === "|") {
      const block: string[] = [];
      let commonIndent: number | null = null;
      i += 1;
      while (i < n) {
        const bl = contentLines[i]!;
        if (bl.trim() === "") {
          block.push("");
          i += 1;
          continue;
        }
        const indent = indentOf(bl);
        if (commonIndent === null) {
          if (indent === 0) break;
          commonIndent = indent;
        } else if (indent < commonIndent) {
          break;
        }
        block.push(bl.slice(commonIndent));
        i += 1;
      }
      while (block.length && block[block.length - 1] === "") block.pop();
      slide[key] = block.length ? block.join("\n") + "\n" : "";
    } else if (val === "") {
      const keyIndent = indentOf(raw);
      const [block, j] = collectIndentedBlock(contentLines, i + 1, keyIndent);
      if (block.length) {
        slide[key] = SCALAR_LIST_KEYS.has(key) ? parseScalarList(block) : parseBlock(block);
        i = j;
      } else {
        slide[key] = "";
        i += 1;
      }
    } else {
      slide[key] = coerceScalar(val);
      i += 1;
    }
  }
}

function collectIndentedBlock(
  lines: string[],
  start: number,
  parentIndent: number,
): [string[], number] {
  const block: string[] = [];
  let j = start;
  const n = lines.length;
  while (j < n) {
    const bl = lines[j]!;
    if (bl.trim() === "") {
      block.push("");
      j += 1;
      continue;
    }
    const indent = indentOf(bl);
    if (indent <= parentIndent) break;
    block.push(bl);
    j += 1;
  }
  while (block.length && block[block.length - 1] === "") block.pop();
  return [block, j];
}

function parseBlock(block: string[]): DeckValue[] | { [k: string]: DeckValue } {
  const first = block.find((b) => b.trim() !== "") ?? "";
  const baseIndent = indentOf(first);
  if (first.replace(/^ +/, "").startsWith("- ")) {
    return parseSequence(block, baseIndent);
  }
  return parseMapping(block, baseIndent);
}

function looksLikeScalar(rest: string): boolean {
  const ci = rest.indexOf(":");
  if (ci === -1) return true;
  const head = rest.slice(0, ci).trim();
  const tail = rest.slice(ci + 1);
  if (!head || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(head)) return true;
  if (tail && !tail.startsWith(" ") && tail !== "") return true;
  return false;
}

function parseSequence(block: string[], baseIndent: number): DeckValue[] {
  const items: DeckValue[] = [];
  let i = 0;
  const n = block.length;
  while (i < n) {
    const line = block[i]!;
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const strippedLeft = line.replace(/^ +/, "");
    const indent = line.length - strippedLeft.length;
    if (indent === baseIndent && strippedLeft.startsWith("- ")) {
      const afterDash = strippedLeft.slice(1);
      const rest = afterDash.replace(/^ +/, "");
      const contentCol = indent + 1 + (afterDash.length - rest.length);
      if (rest.includes(":") && !looksLikeScalar(rest)) {
        const sub: string[] = [" ".repeat(contentCol) + rest];
        i += 1;
        while (i < n) {
          const bl = block[i]!;
          if (bl.trim() === "") {
            sub.push("");
            i += 1;
            continue;
          }
          const bi = indentOf(bl);
          if (bi <= baseIndent) break;
          sub.push(bl);
          i += 1;
        }
        items.push(parseMapping(sub, contentCol));
      } else {
        items.push(coerceScalar(rest.trim()));
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  return items;
}

function parseMapping(block: string[], baseIndentArg?: number): { [k: string]: DeckValue } {
  const out: { [k: string]: DeckValue } = {};
  let i = 0;
  const n = block.length;
  let baseIndent = baseIndentArg;
  if (baseIndent === undefined) {
    const first = block.find((b) => b.trim() !== "") ?? "";
    baseIndent = indentOf(first);
  }
  while (i < n) {
    const line = block[i]!;
    if (line.trim() === "" || !line.includes(":")) {
      i += 1;
      continue;
    }
    const indent = indentOf(line);
    if (indent !== baseIndent) {
      i += 1;
      continue;
    }
    const ci = line.indexOf(":");
    const key = line.slice(0, ci).trim();
    const val = line.slice(ci + 1).trim();
    if (val === "|") {
      const [blockLines, j] = collectIndentedBlock(block, i + 1, baseIndent);
      out[key] = dedentBlockLiteral(blockLines);
      i = j;
    } else if (val === "") {
      const [child, j] = collectIndentedBlock(block, i + 1, baseIndent);
      if (child.length) {
        out[key] = SCALAR_LIST_KEYS.has(key) ? parseScalarList(child) : parseBlock(child);
        i = j;
      } else {
        out[key] = "";
        i += 1;
      }
    } else {
      out[key] = coerceScalar(val);
      i += 1;
    }
  }
  return out;
}

function dedentBlockLiteral(blockLines: string[]): string {
  const out: string[] = [];
  let commonIndent: number | null = null;
  for (const bl of blockLines) {
    if (bl.trim() === "") continue;
    const indent = indentOf(bl);
    if (commonIndent === null) commonIndent = indent;
    else if (indent < commonIndent) commonIndent = indent;
  }
  if (commonIndent === null) return "";
  for (const bl of blockLines) {
    out.push(bl.trim() !== "" ? bl.slice(commonIndent) : "");
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.length ? out.join("\n") + "\n" : "";
}

function parseScalarList(block: string[]): DeckValue[] {
  const items: DeckValue[] = [];
  for (const line of block) {
    const s = line.trim();
    if (s.startsWith("- ")) items.push(coerceScalar(s.slice(2).trim()));
  }
  return items;
}

// ─────────────────────────── Mustache subset ─────────────────────────────────

/** python html.escape(s, quote=True): & < > " ' → entities. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// {{{raw}}} | {{[#^/]?key}} — raw tried first (greedy match parity with python).
const MU_RE = /\{\{\{(\w+)\}\}\}|\{\{([#^/]?)\s*(\w+)\s*\}\}/g;

type Ctx = { [k: string]: DeckValue } | DeckValue;

function isPlainObject(v: DeckValue): v is { [k: string]: DeckValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** python truthiness for our DeckValue: "", 0, false, [], {} (empty) are falsy. */
function pyTruthy(v: DeckValue | undefined): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return Object.keys(v).length > 0;
}

function lookup(ctxStack: Ctx[], key: string): DeckValue {
  for (let i = ctxStack.length - 1; i >= 0; i--) {
    const ctx = ctxStack[i]!;
    if (isPlainObject(ctx) && Object.prototype.hasOwnProperty.call(ctx, key)) {
      return ctx[key]!;
    }
  }
  return "";
}

/** python str() of a DeckValue used in {{{raw}}} / escaped substitution. */
function pyStr(v: DeckValue): string {
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  // lists/dicts shouldn't reach scalar substitution in well-formed decks; the
  // python str(list/dict) repr is never relied upon by the templates.
  return String(v);
}

function findClose(chunk: string, start: number, key: string): number {
  let depth = 1;
  const re = new RegExp(MU_RE.source, "g");
  re.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) !== null) {
    if (m[1]) {
      re.lastIndex = m.index + m[0].length;
      continue;
    }
    const sigil = m[2];
    const tagKey = m[3];
    if ((sigil === "#" || sigil === "^") && tagKey === key) {
      depth += 1;
    } else if (sigil === "/" && tagKey === key) {
      depth -= 1;
      if (depth === 0) return m.index;
    }
    re.lastIndex = m.index + m[0].length;
  }
  throw new ValueError(`unclosed Mustache section: {{#${key}}}`);
}

export function mustache(template: string, context: { [k: string]: DeckValue }): string {
  function renderChunk(chunk: string, ctxStack: Ctx[]): string {
    const buf: string[] = [];
    let i = 0;
    const re = new RegExp(MU_RE.source, "g");
    while (i < chunk.length) {
      re.lastIndex = i;
      const m = re.exec(chunk);
      if (!m) {
        buf.push(chunk.slice(i));
        break;
      }
      buf.push(chunk.slice(i, m.index));
      const rawKey = m[1];
      const sigil = m[2];
      const tagKey = m[3];
      const matchEnd = m.index + m[0].length;
      if (rawKey) {
        buf.push(pyStr(lookup(ctxStack, rawKey)));
        i = matchEnd;
        continue;
      }
      if (sigil === "") {
        buf.push(escapeHtml(pyStr(lookup(ctxStack, tagKey!))));
        i = matchEnd;
        continue;
      }
      if (sigil === "#" || sigil === "^") {
        const closeIdx = findClose(chunk, matchEnd, tagKey!);
        const inner = chunk.slice(matchEnd, closeIdx);
        const val = lookup(ctxStack, tagKey!);
        if (sigil === "#") {
          if (Array.isArray(val)) {
            for (const item of val) {
              const subCtx: Ctx = isPlainObject(item) ? item : { ".": item };
              buf.push(renderChunk(inner, [...ctxStack, subCtx]));
            }
          } else if (pyTruthy(val)) {
            const subCtx: Ctx = isPlainObject(val) ? val : {};
            buf.push(renderChunk(inner, [...ctxStack, subCtx]));
          }
        } else {
          const isEmptyList = Array.isArray(val) && val.length === 0;
          if (!pyTruthy(val) || isEmptyList) {
            buf.push(renderChunk(inner, ctxStack));
          }
        }
        const closeEnd = chunk.indexOf("}}", closeIdx) + 2;
        i = closeEnd;
        continue;
      }
      if (sigil === "/") {
        buf.push(m[0]);
        i = matchEnd;
        continue;
      }
    }
    return buf.join("");
  }
  return renderChunk(template, [context]);
}

// ─────────────────────── minimal markdown → HTML ─────────────────────────────

export function renderMarkdown(src: string): string {
  // markdown lib intentionally not used (see module header) → minimal path.
  return minimalMarkdown(src);
}

function inlineMd(text: string): string {
  // Code spans first (escape contents).
  let t = text.replace(/`([^`]+)`/g, (_m, g1: string) => "<code>" + escapeHtml(g1) + "</code>");
  // Links [text](url) — escape url with quote=True.
  t = t.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, g1: string, g2: string) => `<a href="${escapeHtml(g2)}">${g1}</a>`,
  );
  // Bold **x** (non-greedy).
  t = t.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
  // Italic *x* (not adjacent to *).
  t = t.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return t;
}

function minimalMarkdown(src: string): string {
  const lines = src.split("\n");
  // python splitlines on the body string drops trailing empty just like above;
  // but render_markdown receives a body string that already ends with "\n",
  // and str.splitlines() drops that single trailing newline.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const out: string[] = [];
  let inList = false;
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length) {
      const text = para
        .map((p) => p.trim())
        .filter((p) => p)
        .join(" ");
      if (text) out.push("<p>" + inlineMd(text) + "</p>");
      para = [];
    }
  };
  const flushList = (): void => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const level = h[1]!.length;
      out.push(`<h${level}>${inlineMd(h[2]!)}</h${level}>`);
      continue;
    }
    const b = /^[-*]\s+(.*)$/.exec(line);
    if (b) {
      flushPara();
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inlineMd(b[1]!)}</li>`);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join("\n");
}

// ─────────────────────────── layout routing ──────────────────────────────────

export const DEFAULT_LAYOUT = "plain";

export class LayoutResolver {
  readonly componentsDir: string;
  constructor(componentsDir?: string) {
    this.componentsDir =
      componentsDir ?? join(libDirFor(import.meta.url), "slides", "components");
  }

  available(): string[] {
    if (!isDir(this.componentsDir)) return [];
    const names = readdirSync(this.componentsDir)
      .filter((f) => f.endsWith(".html"))
      .map((f) => basename(f, ".html"));
    const rest = names.filter((n) => n !== DEFAULT_LAYOUT).sort();
    const head = names.includes(DEFAULT_LAYOUT) ? [DEFAULT_LAYOUT] : [];
    return [...head, ...rest];
  }

  resolve(layout: string): string {
    if (!/^[a-z0-9-]+$/.test(layout)) {
      throw new ValueError(`Unknown layout: ${layout}; available: ${this.available().join(", ")}`);
    }
    const path = join(this.componentsDir, `${layout}.html`);
    if (!isFile(path)) {
      throw new ValueError(`Unknown layout: ${layout}; available: ${this.available().join(", ")}`);
    }
    return path;
  }
}

function renderSlideInner(slide: Slide, resolver: LayoutResolver): string {
  const layout = (typeof slide["layout"] === "string" && slide["layout"]) || DEFAULT_LAYOUT;
  const partialPath = resolver.resolve(String(layout));
  let partial = readFileSync(partialPath, "utf8");
  // Drop a single leading HTML doc comment.
  partial = partial.replace(/^\s*<!--[\s\S]*?-->(?:\s*\n)?/, "");
  const rendered = mustache(partial, slide as { [k: string]: DeckValue });
  return stripNewlines(rendered);
}

/** python str.strip("\n"): remove leading/trailing newline chars only. */
function stripNewlines(s: string): string {
  return s.replace(/^\n+/, "").replace(/\n+$/, "");
}

// ───────────────────────────── render_deck ───────────────────────────────────

export interface RenderOptions {
  /** Override the lib dir (defaults to ROLL_PKG_DIR/lib or repo lib). */
  componentsDir?: string;
}

export function renderDeck(src: string, template: string, opts: RenderOptions = {}): string {
  const [fm, body] = parseFrontmatter(src);
  const slides = parseSlides(body);
  const resolver = new LayoutResolver(opts.componentsDir);

  for (const slide of slides) {
    slide["body_en_html"] = renderMarkdown(toStr(slide["body_en"]));
    slide["body_zh_html"] = renderMarkdown(toStr(slide["body_zh"]));
    if (!("evidence" in slide)) slide["evidence"] = [];
    slide["slide_inner_html"] = renderSlideInner(slide, resolver);
  }

  const context: { [k: string]: DeckValue } = { ...fm };
  context["slides"] = slides as DeckValue[];
  if (!("empty" in context)) context["empty"] = [];

  return mustache(template, context);
}

function toStr(v: DeckValue | undefined): string {
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  return pyStr(v);
}

// ─────────────────────────────── helpers ─────────────────────────────────────

/** A ValueError analogue so callers can map to the python exit-code contract. */
export class ValueError extends Error {}

/**
 * python repr() of a string: prefers single quotes, switches to double quotes
 * when the string contains a single quote but no double quote, and escapes a
 * backslash and the active quote. Mirrors CPython's default str repr closely
 * enough for the validator's error messages (ASCII identifiers / layout names /
 * short scalar values), which is all that reaches `{...!r}` here.
 */
export function pyRepr(s: string): string {
  const hasSingle = s.includes("'");
  const hasDouble = s.includes('"');
  const quote = hasSingle && !hasDouble ? '"' : "'";
  let body = s.replace(/\\/g, "\\\\");
  body = body.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  if (quote === "'") body = body.replace(/'/g, "\\'");
  else body = body.replace(/"/g, '\\"');
  return `${quote}${body}${quote}`;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Resolve <pkg>/lib from this module's URL, mirroring python's __file__ dir. */
function libDirFor(_metaUrl: string): string {
  // Default resolution is only used when the caller does not pass componentsDir;
  // the command layer always passes the resolved lib dir, so this is a safety
  // net pointing at the repo lib for direct unit use.
  void _metaUrl;
  void existsSync;
  void dirname;
  return join(repoLibFallback(), "lib");
}

function repoLibFallback(): string {
  // Walk up to the package root (marked by conventions/, US-PORT-021 — was
  // bin/roll); used only as a unit-test default.
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "conventions"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
