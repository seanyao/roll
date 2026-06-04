/**
 * Terminal rendering primitives — TS port of lib/roll_render.py (the shared
 * layout engine for status/prices/backlog/dashboard views). Byte-aligned with
 * the python oracle; CJK/fullwidth glyphs occupy 2 cells (strw) which is what
 * keeps EN/ZH paired rows column-aligned.
 */

export const COLS = 100;

/** Set from the entry after flag/TTY checks — mirrors roll_render.USE_COLOR. */
export const renderState = { useColor: true };

function rgb(hexstr: string): string {
  const h = hexstr.replace(/^#/, "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

/** Single source of truth — every visible color (mirrors PAL). */
const PAL: Record<string, string> = {
  fg: rgb("e6edf3"),
  dim: rgb("8b949e"),
  muted: rgb("6e7681"),
  faint: rgb("484f58"),
  blue: rgb("58a6ff"),
  green: rgb("3fb950"),
  amber: rgb("d29922"),
  red: rgb("f85149"),
  purple: rgb("bc8cff"),
  pink: rgb("f778ba"),
  yellow: rgb("e3b341"),
};
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export function c(color: string, s: string, opts: { bold?: boolean } = {}): string {
  if (!renderState.useColor) return s;
  return `${PAL[color] ?? ""}${opts.bold === true ? BOLD : ""}${s}${RESET}`;
}

const ANSI_RE = /\x1b\[[\d;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/**
 * East-Asian wide (W) / fullwidth (F) code points → 2 cells, everything else 1
 * (mirrors python unicodedata.east_asian_width in ("F","W")).
 */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK Radicals .. CJK Symbols (excl. 303F)
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana .. CJK Compatibility
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth Forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) || // emoji blocks classified W
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK Ext B+
  );
}

/** Display width after stripping ANSI escapes. */
export function strw(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) {
    const cp = ch.codePointAt(0) ?? 0;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

export function pad(s: string, w: number, align: "l" | "r" = "l"): string {
  const sw = strw(s);
  if (sw >= w) return s;
  const fill = " ".repeat(w - sw);
  return align === "r" ? fill + s : s + fill;
}

/** Two-end-flush row at `width` columns. */
export function row(left: string, right: string, width: number = COLS): string {
  const gap = Math.max(1, width - strw(left) - strw(right));
  return left + " ".repeat(gap) + right;
}

export function sectionHead(en: string, zh: string, hint: string): string {
  const left = "  " + c("pink", en, { bold: true }) + c("muted", "  ·  ") + c("dim", zh);
  return row(left, c("muted", hint));
}

/** Horizontal rule line (mirrors status._hr). */
export function hr(): string {
  return c("faint", "─".repeat(COLS));
}
