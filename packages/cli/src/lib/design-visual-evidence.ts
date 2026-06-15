/**
 * FIX-311 — the DESIGN-PHASE visual-evidence contract (roll-design's teeth).
 *
 * The three screenshot gates must agree or they fight each other:
 *   - DESIGN (this file / FIX-311): the spec is BORN honest — every non-exempt
 *     story carries an AC that captures its user-visible surface, and a web
 *     surface DECLARES the real product page it will screenshot
 *     (`deliverable_url:`, alias `screenshot_url:`).
 *   - ENFORCE (FIX-309 / runner/attest-gate.ts): a captured screenshot is the
 *     baseline for EVERY story; keyword/rule matching may NEVER enable the
 *     requirement, only record an explicit exemption.
 *   - ARCHIVE (FIX-334): the produced evidence lands in the card dossier.
 *
 * This is the shift-left of the SAME contract: it is far cheaper to catch a
 * spec with no visual-evidence AC at design time than to let the runtime gate
 * discover, mid-delivery, that the card can never satisfy the screenshot floor.
 *
 * It plugs the two FIX-284 holes at their SOURCE (the spec), the same two holes
 * FIX-321 plugged at capture time:
 *   ① a card that DECLARES a deliverable surface but never wires an AC to
 *      capture it (→ runtime honest-skip / empty shell forever); and
 *   ② a card with NO visual-evidence AC at all that slipped the iron rule
 *      because it lacked the literal keywords (the keyword-as-enabler leak).
 *
 * RED LINE — a GENERIC mechanism, never a per-card patch. It NEVER names a
 * specific card's url and NEVER uses keywords to ENABLE the requirement
 * (the FIX-284 dead-field trap). Visual evidence is required BY DEFAULT for
 * every story; the ONLY way out is a recorded, per-card exemption
 * (`screenshot_exempt: <reason>`). Keyword matching is consulted ONLY to
 * RECOGNISE an AC that already captures a visual surface — never to decide a
 * card needs one.
 */
import { parseAcBlocks } from "@roll/core";

export interface VisualEvidenceVerdict {
  /** true ⇒ the spec satisfies the design-phase visual-evidence contract. */
  ok: boolean;
  /** Machine-readable failure code; undefined when ok. */
  code?: "missing-visual-evidence-ac" | "declared-surface-without-deliverable-url";
  /** Human-readable reason (EN) — undefined when ok. */
  reason?: string;
  /** When exempt, the recorded exemption reason (the contract was waived, not met). */
  exemptReason?: string;
  /** Whether the spec declares a `deliverable_url` / `screenshot_url`. */
  declaresDeliverableUrl: boolean;
  /** Whether some AC captures a user-visible surface (web / CLI / TUI). */
  hasVisualEvidenceAc: boolean;
}

/**
 * Words that, appearing in an AC item, mark it as one that CAPTURES a
 * user-visible surface. This list ONLY RECOGNISES an existing visual-evidence
 * AC — it is never used to decide whether a card needs one (that is always
 * yes, by default). Bilingual + the canonical evidence nouns so the recogniser
 * is not locale-fragile.
 */
const VISUAL_EVIDENCE_TOKENS = [
  "screenshot",
  "screen shot",
  "screen-capture",
  "screencapture",
  "screen capture",
  "captured",
  "capture of",
  "visual evidence",
  "visual proof",
  "rendered view",
  "deliverable_url",
  "screenshot_url",
  "截图",
  "截屏",
  "可视证据",
  "可视化证据",
  "录屏",
  "终端截图",
  "tui 截",
  "cli 截",
];

function frontmatter(specText: string): string | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(specText);
  return m === null ? null : (m[1] ?? "");
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * The recorded per-card exemption reason, or undefined. Mirrors the runtime
 * gate (FIX-309): a naked boolean (`true`/`false`/`yes`/`no`/`on`/`1`/`0`) is
 * NOT a reason — an exemption MUST carry words explaining why the card has no
 * visual surface. Frontmatter only (matching where the runtime gate reads it).
 */
export function visualExemptionReason(specText: string): string | undefined {
  const fm = frontmatter(specText);
  if (fm === null) return undefined;
  const m = /^screenshot_exempt:\s*(.+)$/m.exec(fm);
  if (m === null) return undefined;
  const reason = stripQuotes((m[1] ?? "").trim());
  if (reason === "" || /^(false|no|0|true|yes|on|1)$/i.test(reason)) return undefined;
  return reason;
}

/** Whether the spec frontmatter declares a real deliverable surface URL. */
export function declaresDeliverableUrl(specText: string): boolean {
  const fm = frontmatter(specText);
  if (fm === null) return false;
  const m = /^(?:deliverable_url|screenshot_url):\s*(.+)$/m.exec(fm);
  if (m === null) return false;
  return stripQuotes((m[1] ?? "").trim()) !== "";
}

/** Whether ANY AC item in the spec captures a user-visible surface. */
export function hasVisualEvidenceAc(specText: string): boolean {
  for (const section of parseAcBlocks(specText)) {
    for (const item of section.items) {
      const text = item.text.toLowerCase();
      if (VISUAL_EVIDENCE_TOKENS.some((tok) => text.includes(tok))) return true;
    }
  }
  return false;
}

/**
 * Validate a story spec against the FIX-311 design-phase visual-evidence
 * contract. PURE — takes the spec markdown, returns a verdict; no filesystem,
 * agent-agnostic, so the skill text can cite a function with real teeth and a
 * test can assert both the pass and fail paths.
 *
 * Decision (default = REQUIRED, exemption is the only opt-out):
 *   1. A recorded `screenshot_exempt: <reason>` ⇒ ok (contract waived, with
 *      the reason carried through). This is the ONLY honest skip.
 *   2. Otherwise the spec MUST carry a visual-evidence AC. None ⇒ fail
 *      (`missing-visual-evidence-ac`) — hole ②, the keyword-as-enabler leak.
 *   3. If the spec DECLARES it has a visual surface (a visual-evidence AC) but
 *      does NOT declare `deliverable_url`/`screenshot_url`, the runtime web
 *      gate would have no real product page to capture and the card would
 *      honest-skip forever ⇒ fail (`declared-surface-without-deliverable-url`)
 *      — hole ①, declared-but-never-captured.
 */
export function validateStoryVisualEvidence(specText: string): VisualEvidenceVerdict {
  const exemptReason = visualExemptionReason(specText);
  const declares = declaresDeliverableUrl(specText);
  const hasAc = hasVisualEvidenceAc(specText);

  if (exemptReason !== undefined) {
    return { ok: true, exemptReason, declaresDeliverableUrl: declares, hasVisualEvidenceAc: hasAc };
  }

  if (!hasAc) {
    return {
      ok: false,
      code: "missing-visual-evidence-ac",
      reason:
        "no AC captures a user-visible surface (web/CLI/TUI) and no recorded `screenshot_exempt: <reason>` — every story owes a visual-evidence AC by default; only a recorded exemption opts out",
      declaresDeliverableUrl: declares,
      hasVisualEvidenceAc: hasAc,
    };
  }

  if (!declares) {
    return {
      ok: false,
      code: "declared-surface-without-deliverable-url",
      reason:
        "a visual-evidence AC is present but the spec frontmatter declares no `deliverable_url:` (alias `screenshot_url:`) pointing at the real product surface — the runtime web gate would have no target to capture and the card would honest-skip forever",
      declaresDeliverableUrl: declares,
      hasVisualEvidenceAc: hasAc,
    };
  }

  return { ok: true, declaresDeliverableUrl: declares, hasVisualEvidenceAc: hasAc };
}
