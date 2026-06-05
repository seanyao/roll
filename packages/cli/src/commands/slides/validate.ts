/**
 * TS port of lib/slides-validate.py — deck.md schema + grounding validator
 * (frozen v2 oracle). Reuses the ported deck parser (render.ts) and reproduces
 * the python module's stderr lines + exit-code contract byte-for-byte:
 *
 *   0  valid (schema OK + grounding threshold met)
 *   1  schema error (missing field, mismatch, layout error, etc.)
 *   2  grounding warning (schema OK but evidence below threshold)
 *   3  file not found / unreadable / parse error
 *
 * Each `err(en, zh?)` writes `[slides-validate] <line>` to stderr; the bash
 * caller (`roll slides build`) captures stdout+stderr together and re-emits it.
 */
import { readFileSync, statSync } from "node:fs";
import {
  DeckValue,
  Frontmatter,
  Slide,
  ValueError,
  parseFrontmatter,
  parseSlides,
  pyRepr,
} from "./render.js";

const REQUIRED_FRONTMATTER = [
  "template",
  "slug",
  "title_en",
  "title_zh",
  "total_slides",
  "created",
] as const;

const REQUIRED_TITLE_KEYS = ["title_en", "title_zh"] as const;

const DEFAULT_LAYOUT = "plain";

const LAYOUT_SCALAR_FIELDS: Record<string, readonly string[]> = {
  plain: ["body_en", "body_zh"],
  "cards-2": [],
  "cards-3": [],
  "cards-4": [],
  compare: ["left_title_en", "left_title_zh", "right_title_en", "right_title_zh"],
  pipeline: [],
  timeline: [],
  quote: ["text_en", "text_zh"],
  highlight: ["body_en", "body_zh"],
};

const LAYOUT_LIST_FIELDS: Record<string, [string, readonly string[]]> = {
  "cards-2": ["cards", ["title_en", "title_zh", "body_en", "body_zh"]],
  "cards-3": ["cards", ["title_en", "title_zh", "body_en", "body_zh"]],
  "cards-4": ["cards", ["title_en", "title_zh", "body_en", "body_zh"]],
  pipeline: ["stages", ["title_en", "title_zh", "desc_en", "desc_zh"]],
  timeline: ["items", ["title_en", "title_zh", "body_en", "body_zh"]],
  compare: ["left_items", ["text_en", "text_zh"]],
};

const LAYOUT_EXTRA_LISTS: Record<string, ReadonlyArray<[string, readonly string[]]>> = {
  compare: [["right_items", ["text_en", "text_zh"]]],
};

// Insertion order of LAYOUT_SCALAR_FIELDS keys == LAYOUT_WHITELIST in python.
const LAYOUT_WHITELIST = Object.keys(LAYOUT_SCALAR_FIELDS);

const LAYOUT_EXAMPLES: Record<string, string> = {
  "cards-2": 'cards:\n  - title_en: "..."\n    title_zh: "..."\n    body_en: "..."\n    body_zh: "..."',
  "cards-3": 'cards:\n  - title_en: "..."\n    title_zh: "..."\n    body_en: "..."\n    body_zh: "..."',
  "cards-4": 'cards:\n  - title_en: "..."\n    title_zh: "..."\n    body_en: "..."\n    body_zh: "..."',
  compare:
    'left_title_en: "..."\nleft_title_zh: "..."\nright_title_en: "..."\nright_title_zh: "..."\n' +
    'left_items:\n  - text_en: "..."\n    text_zh: "..."\nright_items:\n  - text_en: "..."\n    text_zh: "..."',
  pipeline: 'stages:\n  - title_en: "..."\n    title_zh: "..."\n    desc_en: "..."\n    desc_zh: "..."',
  timeline: 'items:\n  - title_en: "..."\n    title_zh: "..."\n    body_en: "..."\n    body_zh: "..."',
  quote: 'text_en: "..."\ntext_zh: "..."',
  highlight: "body_en: |\n  ...\nbody_zh: |\n  ...",
  plain: "body_en: |\n  ...\nbody_zh: |\n  ...",
};

/** Sink for the bilingual stderr lines (so tests can capture). */
export type ErrSink = (line: string) => void;

function err(sink: ErrSink, msgEn: string, msgZh = ""): void {
  sink(`[slides-validate] ${msgEn}`);
  if (msgZh) sink(`[slides-validate] ${msgZh}`);
}

function isEmpty(v: DeckValue | undefined): boolean {
  if (v === undefined || v === null) return true;
  return typeof v === "string" && v.trim() === "";
}

function pyTypeName(v: DeckValue): string {
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (typeof v === "string") return "str";
  if (Array.isArray(v)) return "list";
  return "dict";
}

/** python repr() for the scalar values that reach total_slides error path. */
function pyReprValue(v: DeckValue): string {
  if (typeof v === "string") return pyRepr(v);
  if (typeof v === "boolean") return v ? "True" : "False";
  return String(v);
}

function slideHeaderLines(src: string): Map<number, number> {
  const headerRe = /^##\s+Slide\s+(\d+)\s*$/;
  const out = new Map<number, number>();
  const lines = src.split("\n");
  // python enumerate over splitlines(); trailing empty from a final \n is not a
  // header line either way, so split("\n") is equivalent for matching.
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  lines.forEach((line, idx) => {
    const m = headerRe.exec(line);
    if (m) out.set(parseInt(m[1]!, 10), idx + 1);
  });
  return out;
}

function slideLayout(slide: Slide): string {
  const layout = slide["layout"];
  if (!layout) return DEFAULT_LAYOUT;
  return String(layout);
}

function validateFrontmatter(fm: Frontmatter): string[] {
  const errors: string[] = [];
  for (const key of REQUIRED_FRONTMATTER) {
    const v = fm[key];
    if (!(key in fm) || v === "" || v === undefined || v === null) {
      errors.push(`missing required frontmatter field: ${key}`);
    }
  }
  if ("total_slides" in fm && typeof fm["total_slides"] !== "number") {
    const v = fm["total_slides"]!;
    errors.push(
      `total_slides must be an integer, got ${pyTypeName(v as DeckValue)}: ${pyReprValue(v as DeckValue)}`,
    );
  }
  return errors;
}

function validateSlides(
  fm: Frontmatter,
  slides: Slide[],
  lineOf: Map<number, number>,
): string[] {
  const errors: string[] = [];
  const actual = slides.length;
  const declared = fm["total_slides"];
  // python: isinstance(declared, int) — booleans are ints in python, but
  // total_slides is never a bool in practice; mirror the int-only check.
  if (typeof declared === "number" && Number.isInteger(declared) && declared !== actual) {
    errors.push(
      `total_slides mismatch: frontmatter declares ${declared} but found ${actual} \`## Slide N\` sections`,
    );
  }
  for (const slide of slides) {
    errors.push(...validateSlideLayout(slide, lineOf));
  }
  return errors;
}

function validateSlideLayout(slide: Slide, lineOf: Map<number, number>): string[] {
  const errors: string[] = [];
  const n = (slide["number"] as number | undefined) ?? "?";
  const line = typeof n === "number" ? lineOf.get(n) : undefined;
  const loc = line ? `deck.md:${line}` : `slide ${n}`;

  for (const key of REQUIRED_TITLE_KEYS) {
    if (isEmpty(slide[key])) {
      errors.push(`slide ${n} (${loc}): missing or empty ${key}`);
    }
  }

  const layout = slideLayout(slide);
  if (!LAYOUT_WHITELIST.includes(layout)) {
    errors.push(
      `slide ${n} (${loc}): unknown layout ${pyRepr(layout)}; allowed: ${LAYOUT_WHITELIST.join(", ")}`,
    );
    return errors;
  }

  const example = LAYOUT_EXAMPLES[layout] ?? "";
  const missing = (field: string): void => {
    let msg = `slide ${n} (${loc}): layout ${pyRepr(layout)} requires field ${pyRepr(field)}`;
    if (example) msg += `\nHint: example for ${layout}:\n${example}`;
    errors.push(msg);
  };

  for (const field of LAYOUT_SCALAR_FIELDS[layout] ?? []) {
    if (isEmpty(slide[field])) missing(field);
  }

  const listSpecs: Array<[string, readonly string[]]> = [];
  if (layout in LAYOUT_LIST_FIELDS) listSpecs.push(LAYOUT_LIST_FIELDS[layout]!);
  listSpecs.push(...(LAYOUT_EXTRA_LISTS[layout] ?? []));
  for (const [listKey, itemFields] of listSpecs) {
    const items = slide[listKey];
    if (!Array.isArray(items) || items.length === 0) {
      missing(listKey);
      continue;
    }
    items.forEach((item, idx0) => {
      const idx = idx0 + 1;
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        errors.push(
          `slide ${n} (${loc}): ${listKey}[${idx}] must be a mapping with ${itemFields.join(", ")}`,
        );
        return;
      }
      for (const f of itemFields) {
        if (isEmpty((item as { [k: string]: DeckValue })[f])) {
          errors.push(`slide ${n} (${loc}): ${listKey}[${idx}] missing ${pyRepr(f)}`);
        }
      }
    });
  }
  return errors;
}

function lintSlideLayout(slide: Slide): string[] {
  const warnings: string[] = [];
  const layout = slideLayout(slide);
  if (layout === "plain" || layout === "highlight") return warnings;
  const n = (slide["number"] as number | undefined) ?? "?";
  for (const f of ["body_en", "body_zh"]) {
    if (!isEmpty(slide[f])) {
      warnings.push(
        `slide ${n}: layout ${pyRepr(layout)} does not use ${pyRepr(f)}; the field will be ignored (possible waste)`,
      );
    }
  }
  return warnings;
}

function evaluateGrounding(slides: Slide[]): [number, number, boolean] {
  let citations = 0;
  for (const slide of slides) {
    const ev = slide["evidence"];
    if (Array.isArray(ev)) citations += ev.length;
  }
  const threshold = slides.length ? Math.ceil(slides.length / 3) : 0;
  return [citations, threshold, citations >= threshold];
}

export interface ValidateResult {
  exitCode: 0 | 1 | 2 | 3;
}

/**
 * Run the validator against a deck.md file. `errSink` receives each stderr line
 * (no trailing newline). Returns the exit code matching slides-validate.py.
 */
export function validateDeckFile(
  path: string,
  errSink: ErrSink,
  componentsDir?: string,
): 0 | 1 | 2 | 3 {
  void componentsDir; // validator does not touch components; parity with python.
  if (!isFile(path)) {
    err(errSink, `deck file not found: ${path}`, `未找到 deck 文件：${path}`);
    return 3;
  }

  let src: string;
  let fm: Frontmatter;
  let slides: Slide[];
  try {
    src = readFileSync(path, "utf8");
    [fm] = parseFrontmatter(src);
    const [, body] = parseFrontmatter(src);
    slides = parseSlides(body);
  } catch (e) {
    if (e instanceof ValueError) {
      err(errSink, `failed to parse deck.md: ${e.message}`, "解析 deck.md 失败");
      return 3;
    }
    // OSError analogue (read failure) → same exit code/message family.
    err(errSink, `failed to parse deck.md: ${(e as Error).message}`, "解析 deck.md 失败");
    return 3;
  }

  const lineOf = slideHeaderLines(src);

  const schemaErrors: string[] = [];
  schemaErrors.push(...validateFrontmatter(fm));
  schemaErrors.push(...validateSlides(fm, slides, lineOf));

  if (schemaErrors.length) {
    for (const e of schemaErrors) err(errSink, e);
    return 1;
  }

  for (const slide of slides) {
    for (const w of lintSlideLayout(slide)) err(errSink, `⚠️ ${w}`);
  }

  const [citations, threshold, ok] = evaluateGrounding(slides);
  if (!ok) {
    err(
      errSink,
      `⚠️ grounding below threshold: ${citations} evidence citation(s) for ${slides.length} slides (need >= ${threshold}). Each slide group of 3 must include at least one evidence entry.`,
      `⚠️ 证据引用不足：${slides.length} 张幻灯片仅有 ${citations} 条 evidence，至少需要 ${threshold} 条（每 3 张 ≥ 1 条）。`,
    );
    return 2;
  }

  return 0;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
