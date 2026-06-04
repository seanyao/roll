/**
 * Test-quality merge gate — TS port of the v2 oracle `lib/test_quality_gate.py`
 * (US-LOOP-007 / v2 US-QA-012+013).
 *
 * ─── v2 oracle (frozen python, lib/test_quality_gate.py, read FULLY) ─────────
 *   The gate scans bats test files for two rubric violations and is run by the
 *   loop's auto-merge BETWEEN ci-green and merge; a non-zero exit holds the PR
 *   until the test is fixed or the PR carries `[skip-test-quality]`.
 *
 *   Despite the card's "six-dimension" framing, the SOURCE checks exactly TWO
 *   dimensions (the file is 143 lines; mirror what it does, not the prose):
 *     ❼ inline external-tool patterns (py 29-36): a line flags when it matches
 *        ANY of six tool-pattern regexes (sed-substitution, awk-script,
 *        grep -o/-oE, find -name, cut -f, tr -d). A lone `grep -q` (no -o)
 *        never matches. NB: the py docstring says "TWO OR MORE" but the code
 *        (py 95 `any(...)`) flags on the FIRST match — we mirror the CODE.
 *     ❽ outside-repo paths (py 40-46): `~/.<letter>` dotfile dirs, and absolute
 *        /etc//usr//var/ system paths (each guarded so it isn't part of a longer
 *        identifier). `BATS_TMPDIR` anywhere on the line suppresses ❽ (py 99).
 *
 *   Per-line skip rules, applied IN THIS ORDER (py 59-89):
 *     1. inside a heredoc body → skip entirely until the terminator line
 *        (terminator captured from `<< 'EOF'` / `<<EOF`, py 82). The declarator
 *        line itself is NOT scanned (py 89 `continue`).
 *     2. comment line (lstrip startswith `#`) → skip (py 65).
 *     3. `@test ` decorator line → skip (py 70) — the test name often quotes the
 *        very patterns under test.
 *     4. `test-quality:allow` marker anywhere on the line → skip (py 76).
 *   A line can produce a ❼ AND a ❽ finding (py emits both; ❽ at most one/line).
 *
 *   CLI (py 117-139): `[--skip|--skip-test-quality] <file>...`.
 *     exit 0 — clean OR --skip; 1 — ≥1 violation; 2 — no files (usage).
 *     output line per finding: `<file>:<lineno>: <kind> <stripped-snippet>`.
 *     A missing file yields one `(0, "?", "file not found: <path>")` row (py
 *     112-113) which, being non-empty, makes the run exit 1.
 *
 * ─── Port shape ─────────────────────────────────────────────────────────────
 * Pure: this module takes file CONTENTS (string), never reads disk — the caller
 * (CLI / loop glue) supplies bytes, exactly like score.ts / picker.ts. {@link
 * scanText} mirrors `_scan_lines`; {@link gateVerdict} mirrors `main`'s
 * pass/violation/skip decision (sans the usage exit, which is a CLI concern).
 */

/** A violation kind — mirrors the python `kind` field. */
export type GateFindingKind = "❼" | "❽" | "?";

/** One finding — mirrors the python `(line_no, kind, snippet)` tuple. */
export interface GateFinding {
  /** 1-based line number ( `0` for the not-found pseudo-finding). */
  lineNo: number;
  kind: GateFindingKind;
  /** `line.strip()` of the offending line (the not-found message for kind `?`). */
  snippet: string;
}

// ── ❼ inline external-tool patterns (lib/test_quality_gate.py 29-36) ─────────
// Transcribed verbatim from the python `re.compile` list; JS regex equivalents.
const INLINE_TOOL_PATTERNS: readonly RegExp[] = [
  /\bsed\s+[^|]*[s/]/, // sed with substitution / address
  /\bawk\s+'/, // awk with script
  /\bgrep\s+-[a-zA-Z]*o/, // grep -o / -oE (extraction)
  /\bfind\s+[^|]*-name/, // find -name (path scanning)
  /\bcut\s+-f/, // cut -f (column extraction)
  /\btr\s+-d/, // tr -d (char deletion)
];

// ── ❽ outside-repo path patterns (lib/test_quality_gate.py 40-46) ────────────
// Python uses `(?<![A-Za-z0-9])` lookbehind on the system-path ones; JS regex
// supports lookbehind (ES2018). `~/\.[A-Za-z]` has no guard in the oracle.
const OUTSIDE_PATTERNS: readonly RegExp[] = [
  /~\/\.[A-Za-z]/, // ~/.codex, ~/.kimi, ~/.roll, etc.
  /(?<![A-Za-z0-9])\/etc\/[A-Za-z]/,
  /(?<![A-Za-z0-9])\/usr\/[A-Za-z]/,
  /(?<![A-Za-z0-9])\/var\/[A-Za-z]/,
];
const OUTSIDE_ALLOW = /BATS_TMPDIR/;

// Heredoc start: `<< 'EOF'` / `<<EOF` (optional quotes) — py 82.
const HEREDOC_START = /<<\s*['"]?([A-Z_]+)['"]?/;

/**
 * Scan one file's text for ❼ / ❽ findings — mirrors `_scan_lines`
 * (lib/test_quality_gate.py 49-106) line-for-line, including the heredoc /
 * comment / `@test ` / `test-quality:allow` skip ordering and the
 * "one ❽ per line, break" rule.
 */
export function scanText(text: string): GateFinding[] {
  const findings: GateFinding[] = [];
  let inHeredoc = false;
  let heredocTerminator = "";
  // py splitlines(): split on \n; trailing-\n does not yield an empty tail line.
  const lines = splitLines(text);

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx] ?? "";
    const line = raw.replace(/\n+$/, ""); // py `rstrip("\n")`
    const stripped = line.replace(/^\s+/, ""); // py `lstrip()`

    if (inHeredoc) {
      // py 60: `line.strip() == heredoc_terminator`
      if (line.trim() === heredocTerminator) inHeredoc = false;
      continue;
    }

    // py 65: comment lines can legitimately discuss sed/awk in prose.
    if (stripped.startsWith("#")) continue;

    // py 70: @test decorators quote the patterns under test (false positive).
    if (stripped.startsWith("@test ")) continue;

    // py 76: explicit allow marker for fixture content / doc-validation awks.
    if (line.includes("test-quality:allow")) continue;

    // py 82-89: heredoc start — capture terminator, don't scan declarator line.
    const m = HEREDOC_START.exec(line);
    if (m) {
      heredocTerminator = m[1] ?? "";
      inHeredoc = true;
      continue;
    }

    // py 95: ❼ — any inline extraction/parsing tool flags.
    if (INLINE_TOOL_PATTERNS.some((pat) => pat.test(line))) {
      findings.push({ lineNo: idx + 1, kind: "❼", snippet: line.trim() });
    }

    // py 99-104: ❽ — outside-path hit unless BATS_TMPDIR appears.
    if (OUTSIDE_ALLOW.test(line)) continue;
    for (const pat of OUTSIDE_PATTERNS) {
      if (pat.test(line)) {
        findings.push({ lineNo: idx + 1, kind: "❽", snippet: line.trim() });
        break; // py 104: one ❽ finding per line is enough
      }
    }
  }

  return findings;
}

/**
 * Per-file scan with the not-found pseudo-finding — mirrors `scan_file`
 * (lib/test_quality_gate.py 109-114). When `text` is `undefined` (file absent),
 * yields the single `(0, "?", "file not found: <path>")` row the oracle emits,
 * which counts as a violation. Otherwise delegates to {@link scanText}.
 */
export function scanFile(path: string, text: string | undefined): GateFinding[] {
  if (text === undefined) {
    return [{ lineNo: 0, kind: "?", snippet: `file not found: ${path}` }];
  }
  return scanText(text);
}

/** A scanned file paired with its findings (drives the CLI line output). */
export interface GateFileResult {
  path: string;
  findings: GateFinding[];
}

/** The gate decision — mirrors `main`'s return value (0 / 1). */
export interface GateVerdict {
  /** True iff zero findings across all files (or `skip`). py: exit 0. */
  pass: boolean;
  /** Total findings across all files (py `total`). 0 when `skip`. */
  total: number;
  /** Per-file results, in input order (empty when `skip`). */
  files: GateFileResult[];
  /** `[skip-test-quality]` / `--skip` short-circuit was applied. */
  skipped: boolean;
}

/** One input file for {@link gateVerdict}: its path + contents (or absent). */
export interface GateInput {
  path: string;
  /** File contents, or `undefined` if the file does not exist. */
  text: string | undefined;
}

/**
 * Decide the gate over a set of files — mirrors `main`
 * (lib/test_quality_gate.py 117-139) minus the usage exit (a CLI concern).
 *
 *   skip === true            → pass, zero findings (py 130-131 `--skip` → 0).
 *   any findings             → fail (py 139 `1 if total > 0`).
 *   else                     → pass.
 */
export function gateVerdict(inputs: readonly GateInput[], skip = false): GateVerdict {
  if (skip) {
    return { pass: true, total: 0, files: [], skipped: true };
  }
  const files: GateFileResult[] = inputs.map((i) => ({
    path: i.path,
    findings: scanFile(i.path, i.text),
  }));
  const total = files.reduce((n, f) => n + f.findings.length, 0);
  return { pass: total === 0, total, files, skipped: false };
}

/**
 * Render a verdict as the oracle's stdout lines — mirrors the per-finding print
 * (lib/test_quality_gate.py 137): `<file>:<lineno>: <kind> <snippet>`. Returns
 * the lines in file-then-finding order (no trailing newline join concern; the
 * caller decides). Empty array when clean or skipped.
 */
export function formatFindings(verdict: GateVerdict): string[] {
  const out: string[] = [];
  for (const f of verdict.files) {
    for (const v of f.findings) {
      out.push(`${f.path}:${v.lineNo}: ${v.kind} ${v.snippet}`);
    }
  }
  return out;
}

/**
 * Split text into lines the way python `str.splitlines()` does for the inputs
 * the gate sees: split on `\n`, and a trailing newline does NOT produce a
 * spurious empty final element (unlike JS `"a\n".split("\n") === ["a",""]`).
 */
function splitLines(text: string): string[] {
  if (text === "") return [];
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}
