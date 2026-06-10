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
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cardArchiveDir } from "../lib/archive.js";
import { storyHasAcBlock } from "./attest-gate.js";

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
