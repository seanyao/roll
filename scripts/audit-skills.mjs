#!/usr/bin/env node
/**
 * US-DOSSIER-032 — canonical skills-audit entry at the repo-root `scripts/`
 * path the Delivery Dossier reference names (line 621). This is a thin wrapper
 * over the ONE audit yardstick that ships in `@roll/cli`
 * (`packages/cli/src/lib/skills-audit.ts`), so this CLI, `roll skills audit`,
 * and the machine-global Skills page all read the SAME computation.
 *
 * The TS port is the source of truth; this `.mjs` exists so the canonical path
 * is a real, version-controlled dependency (no silent "unknown"). It loads the
 * compiled audit from the built CLI dist when present; if the package has not
 * been built yet it builds nothing — it prints an honest error and exits 2,
 * never a silent zero.
 *
 *   node scripts/audit-skills.mjs [--strict] [--json] [--skills-dir DIR] [--routes FILE]
 *
 * --strict : exit 1 when any violation exists (the gate the page's bar reports).
 * --json   : emit the machine report; otherwise the human summary.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function parseArgs(argv) {
  const options = {
    skillsDir: path.join(repoRoot, "skills"),
    routeFile: undefined,
    json: false,
    strict: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--skills-dir") options.skillsDir = path.resolve(argv[++i]);
    else if (arg === "--routes") options.routeFile = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function loadAudit() {
  // The compiled TS port — the single source the page + `roll skills audit` use.
  const dist = path.join(repoRoot, "packages", "cli", "dist", "lib", "skills-audit.js");
  if (!existsSync(dist)) {
    throw new Error(
      "skills-audit not built — run `pnpm -r build` first (canonical source: packages/cli/src/lib/skills-audit.ts)",
    );
  }
  return import(pathToFileURL(dist).href);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { auditSkills, formatHumanReport } = await loadAudit();
  const report = auditSkills(
    options.routeFile === undefined
      ? { skillsDir: options.skillsDir }
      : { skillsDir: options.skillsDir, routeFile: options.routeFile },
  );
  if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else process.stdout.write(formatHumanReport(report));
  if (options.strict && report.summary.violations > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write((error?.message ?? String(error)) + "\n");
  process.exitCode = 2;
});
