/**
 * FIX-246 — ac-map omission remediation (one surgical second pass).
 *
 * Observed 2026-06-10: agents deliver real work (commits, tests, even a
 * rendered report) yet consistently skip skill step 10.6 — writing the
 * acceptance intent map `ac-map.json`. The attest gate (FIX-207/US-ATTEST-012)
 * then correctly classifies the report as an empty shell, every delivered
 * cycle dies at capture, and the correction circuit breaker pauses the loop.
 * The work is good; the missing artifact is one small JSON file.
 *
 * The remediation is NOT a gate bypass: when a real delivery has no ac-map,
 * the runner spawns the SAME agent once more with a narrow prompt — "write
 * the ac-map for what you just did, honest statuses only" — and re-renders
 * attest. The honesty red line is untouched: the prompt demands `claimed` for
 * any AC without real evidence, and the render layer still downgrades
 * fabricated passes (US-ATTEST-010). One retry, structurally — the capture
 * step runs once per cycle.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardArchiveDir } from "../lib/archive.js";
import { storyHasAcBlock, storyRequiresScreenshot } from "./attest-gate.js";

/** Hard wall-clock cap for the remediation spawn — writing one JSON file from
 *  already-done work is minutes, not a full cycle. */
export const ACMAP_REMEDIATION_TIMEOUT_MS = 6 * 60_000;

/** The exact ac-map path the gate reads (single-home rule, US-META-002c) —
 *  the remediation prompt bakes this in so the agent cannot guess wrong. */
export function acMapPath(worktreeCwd: string, storyId: string): string {
  return join(cardArchiveDir(worktreeCwd, storyId), "ac-map.json");
}

/**
 * Remediation fires only when the gate would otherwise fail on the FIX-246
 * signature: a real story that owes acceptance evidence (has an AC block) but
 * has no ac-map on disk. Stories without an AC block pass the gate without a
 * report; an existing ac-map means step 10.6 was honored.
 */
export function needsAcMapRemediation(worktreeCwd: string, storyId: string): boolean {
  if (storyId === "") return false;
  if (storyHasAcBlock(worktreeCwd, storyId) !== true) return false;
  return !existsSync(acMapPath(worktreeCwd, storyId));
}

/**
 * The surgical prompt for the remediation spawn. Bilingual (the loop's agents
 * are zh/en mixed), absolute paths baked in, scope pinned to ONE file write.
 * `runDir` is the cycle's evidence frame — ac-map evidence hrefs are relative
 * to it (story-level dirs are `../evidence/` / `../screenshots/`).
 */
export function buildAcMapRemediationPrompt(
  worktreeCwd: string,
  storyId: string,
  runDir: string,
): string {
  const target = acMapPath(worktreeCwd, storyId);
  const storyDir = join(cardArchiveDir(worktreeCwd, storyId));
  return [
    `[attest remediation / 验收补全] 你刚在本 cycle 交付了 ${storyId},但漏写了验收意图映射 ac-map.json — 这是唯一缺口,缺它整个交付会被 attest gate 判失败。`,
    `You delivered ${storyId} this cycle but skipped the acceptance intent map (skill step 10.6). Without it the attest gate fails the whole delivery. Do ONLY the following:`,
    ``,
    `1. Read the story spec and its AC list: ${join(storyDir, "spec.md")}`,
    `2. Review what you actually did this cycle: \`git log --oneline origin/main..HEAD\` and \`git diff origin/main...HEAD --stat\` in ${worktreeCwd}.`,
    `3. Where useful, save REAL command output from this cycle as text evidence under ${join(storyDir, "evidence")}/ (create the dir if absent).`,
    `4. Write ${target} — a JSON array with EXACTLY one entry per AC:`,
    ``,
    `[{ "ac": "${storyId}:AC1", "status": "pass",`,
    `   "evidence": [{ "kind": "text", "label": "vitest run", "textFile": "../evidence/vitest.txt" }] },`,
    ` { "ac": "${storyId}:AC2", "status": "claimed", "evidence": [] }]`,
    ``,
    `- status ∈ "pass" | "partial" | "readonly" | "claimed" | "missing".`,
    `- Evidence paths are RELATIVE TO THE RUN DIR (${runDir}); story-level dirs are reachable as ../evidence/... and ../screenshots/... Reference ONLY files that exist.`,
    `- 诚实红线:没有真实证据的 AC 必须标 "claimed",绝不伪造 pass。Honesty red line: an AC without real evidence MUST be "claimed" — never fabricate a pass; the render layer downgrades and exposes fabrications anyway.`,
    `5. Do NOT change product code, do NOT commit, do not open a PR. Write the file, verify it parses (\`node -e 'JSON.parse(require("fs").readFileSync("${target}","utf8"))'\`), then exit.`,
  ].join("\n");
}

/**
 * FIX-317 — the harness↔attest screenshot bridge.
 *
 * Root cause (verified on FIX-284 cycles): a cycle produces a REAL screenshot
 * (`<runDir>/screenshots/web.png`) and a report, but the agent's ac-map marks
 * pass ACs with TEXT-only evidence, never wiring the screenshot in. The
 * agent-agnostic visual floor (`passAcVisualFloor`) then requires a per-AC
 * screenshot ref and judges the report an empty shell → every cycle fails.
 *
 * The fix lives in the harness (roll's normalization thesis: bridge the common
 * gap once; downstream stays agent-agnostic, no per-agent special-casing). The
 * executor calls {@link autoAttachScreenshotToAcMap} after the screenshot is
 * captured: for every `pass` AC lacking visual evidence, it attaches the
 * captured screenshot as a clearly-labelled "visual baseline" ref.
 *
 * Honesty red line (Codex/PI review): only a screenshot that ACTUALLY exists on
 * disk this cycle AND was recorded `taken === true` in evidence.json is ever
 * attached — a recorded machine-skip / absent / malformed manifest attaches
 * nothing and lets the existing skip+exemption paths resolve the cycle. The
 * label discloses it is a delivery-level baseline, NOT AC-specific proof, and
 * the `attest:auto-attach` event records href+count so audits can separate
 * harness-added baselines from agent-supplied evidence.
 */
const SCREENSHOT_BASELINE_LABEL = "cycle visual baseline (auto-attached; not AC-specific proof)";

interface AcMapEvidence {
  kind?: string;
  label?: string;
  href?: string;
  textFile?: string;
}
interface AcMapEntry {
  ac?: string;
  status?: string;
  note?: string;
  evidence?: AcMapEvidence[];
}

/**
 * Pick the captured screenshot href to attach this cycle, or null.
 *
 * Honesty + path safety: a basename is accepted ONLY when (a) evidence.json
 * records a capture for it with `taken === true`, and (b) the PNG exists under
 * `<runDir>/screenshots/`. Matching is by BASENAME (absolute / `..` / escaping
 * paths in the manifest are rejected), and the returned ref is RELATIVE to the
 * run dir so the shared card-level ac-map resolves to THIS cycle's screenshot
 * (toRef resolves run-dir-first, FIX-315). web.png (the dossier baseline,
 * FIX-309) wins over terminal.png when both were genuinely captured.
 */
export function capturedScreenshotRef(runDir: string): string | null {
  if (runDir === "") return null;
  const taken = new Set<string>();
  try {
    const ev = JSON.parse(readFileSync(join(runDir, "evidence.json"), "utf8")) as {
      captures?: Array<{ out?: string; taken?: boolean }>;
    };
    for (const c of ev.captures ?? []) {
      if (c.taken !== true || typeof c.out !== "string" || c.out === "") continue;
      const base = c.out.split(/[\\/]/).pop() ?? "";
      if (base !== "" && !base.includes("..")) taken.add(base);
    }
  } catch {
    return null; // absent / malformed manifest ⇒ no honest signal
  }
  for (const name of ["web.png", "terminal.png"]) {
    if (taken.has(name) && existsSync(join(runDir, "screenshots", name))) return `screenshots/${name}`;
  }
  return null;
}

/**
 * Auto-attach the captured screenshot into every `pass` AC that lacks visual
 * evidence. Idempotent, honest, best-effort (never throws → never fails the
 * cycle). Returns `{ href, count }` when it wrote, else null.
 */
export function autoAttachScreenshotToAcMap(
  worktreeCwd: string,
  storyId: string,
  runDir: string,
): { href: string; count: number } | null {
  try {
    if (storyId === "" || runDir === "") return null;
    if (storyHasAcBlock(worktreeCwd, storyId) !== true) return null;
    if (!storyRequiresScreenshot(worktreeCwd, storyId)) return null; // exempt ⇒ leave it alone
    const ref = capturedScreenshotRef(runDir);
    if (ref === null) return null; // no honest screenshot ⇒ skip/exemption path handles it
    const p = acMapPath(worktreeCwd, storyId);
    if (!existsSync(p)) return null;
    let entries: AcMapEntry[];
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8")) as unknown;
      if (!Array.isArray(parsed)) return null;
      entries = parsed as AcMapEntry[];
    } catch {
      return null; // malformed ⇒ do not clobber the agent's file
    }
    let count = 0;
    for (const e of entries) {
      if (e.status !== "pass") continue; // pass ACs only — never partial/readonly/claimed/fail
      const hasShot = (e.evidence ?? []).some(
        (ev) => ev.kind === "screenshot" && typeof ev.href === "string" && ev.href !== "",
      );
      if (hasShot) continue; // idempotent: agent (or a prior run) already wired one
      (e.evidence ??= []).push({ kind: "screenshot", label: SCREENSHOT_BASELINE_LABEL, href: ref });
      count += 1;
    }
    if (count === 0) return null;
    writeFileSync(p, JSON.stringify(entries, null, 2) + "\n");
    return { href: ref, count };
  } catch {
    return null; // never fail the cycle on a best-effort normalization
  }
}
