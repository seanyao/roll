#!/usr/bin/env node
/**
 * FIX-340 — the story-id uniqueness CI lint. roll's iron rule is "一个概念一个名":
 * a story id must resolve to exactly ONE spec. This scans `.roll/features/**`
 * and REDS (exit 1) when any story id owns more than one spec home across epics
 * — the same drift-guard discipline as README-vs-registry / truth-field-registry.
 *
 * It exists because a DUPLICATE id makes `storySpecPath` ambiguous: the runtime
 * attest gate would (pre-FIX-340) silently read the alphabetical-first epic's
 * spec and misfire (the US-AGENT-001 collision). Now the gate fails loud AND
 * this lint catches the collision in CI before it ever reaches a cycle.
 *
 *   node scripts/lint-story-ids.mjs [--root DIR] [--json]
 *
 * --root : the worktree whose `.roll/features` to scan (default: repo root).
 * --json : emit the machine report instead of the human summary.
 *
 * Exit codes: 0 = unique (or no `.roll/features` present — nothing to scan,
 * e.g. the product repo where the data lives in the roll-meta repo), 1 = one or
 * more duplicate ids, 2 = the lint itself failed (e.g. CLI not built).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function parseArgs(argv) {
  const options = { root: repoRoot, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--root") options.root = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function loadLint() {
  // The compiled TS port — the SAME computation storySpecPath fails-loud on.
  const dist = path.join(repoRoot, "packages", "cli", "dist", "runner", "attest-gate.js");
  if (!existsSync(dist)) {
    throw new Error(
      "attest-gate not built — run `pnpm -r build` first (canonical source: packages/cli/src/runner/attest-gate.ts)",
    );
  }
  return import(pathToFileURL(dist).href);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { findDuplicateStoryIds } = await loadLint();
  const featuresDir = path.join(options.root, ".roll", "features");
  if (!existsSync(featuresDir)) {
    if (options.json) process.stdout.write(JSON.stringify({ scanned: false, root: options.root, duplicates: [] }, null, 2) + "\n");
    else process.stdout.write(`story-id lint: no ${featuresDir} — nothing to scan (data lives in the roll-meta repo)\n`);
    return; // exit 0 — nothing to scan is not a failure
  }
  const dups = findDuplicateStoryIds(options.root);
  if (options.json) {
    process.stdout.write(JSON.stringify({ scanned: true, root: options.root, duplicates: dups }, null, 2) + "\n");
  } else if (dups.length === 0) {
    process.stdout.write(`story-id lint: ✓ every story id resolves uniquely (${featuresDir})\n`);
  } else {
    process.stderr.write(
      `story-id lint: ✗ ${dups.length} duplicate story id(s) — each id MUST resolve to exactly ONE spec (一个 ID 一份 spec):\n` +
        dups.map((d) => `  ${d.id}\n${d.specs.map((s) => `    - ${s}`).join("\n")}`).join("\n") +
        "\nDisambiguate (rename/archive) so each id owns a single spec home.\n",
    );
  }
  if (dups.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write((error?.message ?? String(error)) + "\n");
  process.exitCode = 2;
});
