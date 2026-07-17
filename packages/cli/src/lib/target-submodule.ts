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
