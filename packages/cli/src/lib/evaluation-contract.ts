/**
 * US-SKILL-030 — Evaluation contract block parser.
 *
 * Parses the `**Evaluation contract:**` block from story spec.md text, yielding
 * structured expected_evidence and scorer_focus fields that builder and
 * evaluator consume as a shared artifact contract (no three-agent chat needed).
 *
 * The block is authored by roll-design, consumed by:
 *   - roll-build / roll-fix (read before coding, map delivered evidence back)
 *   - the peer Review Score prompt (include in scorer summary)
 *   - attest report (surface planned-vs-delivered evidence mapping)
 *
 * Legacy specs (no block) → null (graceful degradation, no behavior change).
 * Genuinely trivial/internal stories may carry a one-item minimal block.
 */
export interface EvaluationEvidenceItem {
  kind: "test" | "command" | "screenshot" | "document" | "diff" | "ci" | "manual" | string;
  /** File, command, surface, or report expected to prove an AC. */
  target: string;
  /** AC id (e.g. "AC1") or short AC phrase this evidence proves. */
  proves: string;
}

export interface EvaluationContract {
  expected_evidence: EvaluationEvidenceItem[];
  scorer_focus: string[];
  builder_notes: string[];
}

/** Section header that marks the start of the evaluation contract block. */
const EVAL_CONTRACT_HEADER = /^\*\*Evaluation contract:\*\*\s*$/;

/** Recognise a kind value as one of the known evidence kinds (case-insensitive). */
function normKind(raw: string): string {
  const k = raw.trim();
  const known = new Set(["test", "command", "screenshot", "document", "diff", "ci", "manual"]);
  return known.has(k) ? k : k;
}

/**
 * Parse the `**Evaluation contract:**` block from spec text. Returns null when:
 *   - the header is absent (legacy or old spec)
 *   - the block is present but unparseable (empty / malformed)
 *
 * The block ends at the next `**` heading, an `#`/`##` heading, or end of input.
 * Nested list items (`expected_evidence:` → `- kind:` → `target:`) are parsed
 * at exactly one indentation level.
 */
export function parseEvaluationContract(specText: string): EvaluationContract | null {
  const lines = specText.split(/\r?\n/);
  // 1. Locate the header line.
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (EVAL_CONTRACT_HEADER.test(lines[i] ?? "")) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return null;

  // 2. Collect the block until the next major heading or end of input.
  const block: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    // Stop at another `**…:**` heading or markdown heading (# / ##)
    if (/^\*\*[A-Za-z].+:\*\*\s*$/.test(line)) break;
    if (/^#{1,2}\s/.test(line)) break;
    block.push(line);
  }
  if (block.length === 0) return null;

  // 3. Parse the block line by line. The structure is:
  //    - expected_evidence:
  //      - kind: test
  //        target: …
  //        proves: …
  //    - scorer_focus:
  //      - <item>
  //    - builder_notes:
  //      - <item>
  const evidence: EvaluationEvidenceItem[] = [];
  const scorerFocus: string[] = [];
  const builderNotes: string[] = [];

  let section: "expected_evidence" | "scorer_focus" | "builder_notes" | null = null;
  let currentEvidence: Partial<EvaluationEvidenceItem> | null = null;

  const finalizeEvidence = (): void => {
    if (currentEvidence !== null && currentEvidence.kind !== undefined && currentEvidence.proves !== undefined) {
      evidence.push({
        kind: currentEvidence.kind,
        target: currentEvidence.target ?? "",
        proves: currentEvidence.proves,
      });
    }
    currentEvidence = null;
  };

  for (const raw of block) {
    const line = raw.trim();
    if (line === "") continue;

    // Section headers: `- expected_evidence:` / `- scorer_focus:` / `- builder_notes:`
    const secMatch = /^-\s*(expected_evidence|scorer_focus|builder_notes):\s*$/.exec(line);
    if (secMatch !== null) {
      finalizeEvidence();
      section = secMatch[1] as "expected_evidence" | "scorer_focus" | "builder_notes";
      continue;
    }

    if (section === null) continue;

    if (section === "expected_evidence") {
      // `- kind: test` — start of a new evidence item
      const kindMatch = /^\s*-\s*kind:\s*(.+)$/.exec(line);
      if (kindMatch !== null) {
        finalizeEvidence();
        currentEvidence = { kind: normKind(kindMatch[1] ?? ""), target: "", proves: "" };
        continue;
      }
      // `  target: …` or `  proves: …`
      if (currentEvidence !== null) {
        const targetMatch = /^target:\s*(.+)$/.exec(line);
        if (targetMatch !== null) {
          currentEvidence.target = (targetMatch[1] ?? "").trim();
          continue;
        }
        const provesMatch = /^proves:\s*(.+)$/.exec(line);
        if (provesMatch !== null) {
          currentEvidence.proves = (provesMatch[1] ?? "").trim();
          continue;
        }
      }
    } else if (section === "scorer_focus") {
      const itemMatch = /^-\s*(.+)$/.exec(line);
      if (itemMatch !== null) {
        scorerFocus.push((itemMatch[1] ?? "").trim());
      }
    } else if (section === "builder_notes") {
      const itemMatch = /^-\s*(.+)$/.exec(line);
      if (itemMatch !== null) {
        builderNotes.push((itemMatch[1] ?? "").trim());
      }
    }
  }
  finalizeEvidence();

  // A contract with zero expected_evidence items is a trivial/internal story
  // that carries a minimal block. Accept it (return the contract with empty
  // arrays) rather than return null.
  return { expected_evidence: evidence, scorer_focus: scorerFocus, builder_notes: builderNotes };
}

/**
 * Render the evaluation contract as a human-readable summary block for the
 * scorer prompt. Returns "" when the contract is absent.
 */
export function formatEvaluationContractForScorer(contract: EvaluationContract | null): string {
  if (contract === null) return "";
  const parts: string[] = [];
  if (contract.expected_evidence.length > 0) {
    parts.push("Planned evidence:");
    for (const e of contract.expected_evidence) {
      parts.push(`  - ${e.kind}: ${e.target} (proves ${e.proves})`);
    }
  }
  if (contract.scorer_focus.length > 0) {
    parts.push("Scorer focus:");
    for (const s of contract.scorer_focus) {
      parts.push(`  - ${s}`);
    }
  }
  if (contract.builder_notes.length > 0) {
    parts.push("Builder notes:");
    for (const n of contract.builder_notes) {
      parts.push(`  - ${n}`);
    }
  }
  return parts.join("\n");
}

/**
 * Build a planned-vs-delivered evidence summary from the evaluation contract
 * and the ac-map entries, for inclusion in attest/report output.
 *
 * @param contract  The parsed evaluation contract (null → empty summary).
 * @param acMapEntries  Raw ac-map entries (may be empty).
 * @returns Human-readable summary string, or "" when no contract.
 */
export function evidenceDeltaSummary(
  contract: EvaluationContract | null,
  acMapEntries: ReadonlyArray<{ ac?: string; status?: string; evidence?: Array<{ kind?: string; href?: string; textFile?: string }> }>,
): string {
  if (contract === null) return "";
  const acStatus = new Map<string, string>();
  for (const e of acMapEntries) {
    if (e.ac !== undefined && e.status !== undefined) {
      acStatus.set(e.ac, e.status);
    }
  }
  const lines: string[] = ["Planned-vs-delivered evidence:"];
  for (const item of contract.expected_evidence) {
    const status = acStatus.get(item.proves) ?? "missing";
    const icon = status === "pass" ? "✅" : status === "partial" ? "⚠️" : "❓";
    lines.push(`  ${icon} ${item.kind}: ${item.target} → ${item.proves} (${status})`);
  }
  return lines.join("\n");
}
