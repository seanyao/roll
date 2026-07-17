/**
 * E2 — read a story spec's `target_submodule:` frontmatter field.
 *
 * A submodule-aware story (its real product code lives in a git submodule of the
 * superproject) declares its target submodule in either place:
 *   - the backlog row tag `target-submodule:<path>` (core `parseTargetSubmodule`), or
 *   - the spec.md frontmatter `target_submodule: <path>` (this module).
 *
 * The runner consults BOTH so a story authored either way routes its worktree +
 * delivery into the submodule. Absent in both → the story is a normal
 * superproject story (zero behavioural change).
 *
 * Frontmatter parsing mirrors `physical-terminal.ts` (same quote/inline-comment
 * stripping) so the two spec readers agree byte-for-byte on frontmatter shape.
 */

function frontmatter(specText: string): string | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(specText);
  return m === null ? null : (m[1] ?? "");
}

function stripInlineComment(value: string): string {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if ((ch === "'" || ch === '"') && (i === 0 || value[i - 1] !== "\\")) {
      quote = quote === ch ? null : quote === null ? ch : quote;
      continue;
    }
    if (ch === "#" && quote === null && (i === 0 || /\s/.test(value[i - 1] ?? ""))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value.trimEnd();
}

function stripQuotes(value: string): string {
  const stripped = stripInlineComment(value.trim());
  if ((stripped.startsWith('"') && stripped.endsWith('"')) || (stripped.startsWith("'") && stripped.endsWith("'"))) {
    return stripped.slice(1, -1);
  }
  return stripped;
}

/**
 * Return the `target_submodule` declared in the spec frontmatter, or `undefined`
 * when there is no frontmatter or the field is absent/empty. Only the
 * frontmatter block is consulted — a `target_submodule:` in the body is ignored.
 */
export function targetSubmoduleFromSpecText(specText: string): string | undefined {
  const fm = frontmatter(specText);
  if (fm === null) return undefined;
  const m = /^target_submodule:\s*(.+)$/m.exec(fm);
  if (m === null) return undefined;
  const value = stripQuotes(m[1] ?? "");
  return value !== "" ? value : undefined;
}

// ─── E6: infer the target submodule from the spec (target_submodule optional) ──

/**
 * E6 — parse EVERY declared submodule PATH from a `.gitmodules` file's text.
 *
 * `.gitmodules` is git-config INI: each submodule is a `[submodule "<name>"]`
 * section carrying a `path = <p>` key (the tracked gitlink location — the name the
 * runner uses). We collect the value of every `path =` line, tolerating leading
 * whitespace and a single layer of surrounding quotes. Returns them in file order
 * (deduping is the caller's concern; a well-formed file has none). Mirrors the
 * `path = skills` grammar of worktree-bootstrap's `declaresSkillsSubmodule`, but
 * takes ALL paths rather than testing for one.
 */
export function gitmodulesPaths(gitmodulesText: string): string[] {
  const out: string[] = [];
  const re = /^\s*path\s*=\s*"?([^"\n]+?)"?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(gitmodulesText)) !== null) {
    const p = (m[1] ?? "").trim();
    if (p !== "") out.push(p);
  }
  return out;
}

/**
 * E6 — infer a story's target submodule by LITERAL submodule-path matching in the
 * spec text. For each declared submodule path, test whether that exact path string
 * appears anywhere in the spec (a code-module declaration, a file path, a gradle
 * module, etc.). The inference is intentionally CONSERVATIVE:
 *   - EXACTLY ONE distinct submodule referenced → return it (the unambiguous case).
 *   - ZERO referenced → `undefined` (caller falls back to `default_submodule`).
 *   - TWO OR MORE distinct submodules referenced → `undefined` (AMBIGUOUS — never
 *     guess; the caller falls through to `default_submodule`/none). A spec that
 *     touches a cross-submodule seam must be routed explicitly, not inferred.
 *
 * Only literal PATH matching is done (reliable); NO backend/frontend prose
 * classification (unreliable). Matching is plain substring containment on the
 * declared path — the paths are distinctive multi-segment names
 * (`dukang-service-online`), so a false hit is vanishingly unlikely; keeping it a
 * pure string test avoids brittle word-boundary heuristics around `/` and `.`.
 */
export function inferTargetSubmodule(
  specText: string,
  submodulePaths: readonly string[],
): string | undefined {
  const referenced = submodulePaths.filter((p) => p !== "" && specText.includes(p));
  const distinct = [...new Set(referenced)];
  return distinct.length === 1 ? distinct[0] : undefined;
}
