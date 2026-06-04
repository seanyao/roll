#!/usr/bin/env node
/**
 * Catalog generator — converts the frozen v2 bash catalogs (lib/i18n/*.sh,
 * lines of `_i18n_set <lang> <key> "<value>"`) into a typed JSON catalog.
 *
 * v2 is frozen (tag v2-freeze-2026-06-04), so the generated file cannot
 * drift; regenerate only if the oracle tag ever moves.
 *
 * Usage: node scripts/gen-catalog.mjs  (run from packages/spec)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const I18N_DIRS = ["../../lib/i18n", "../../lib/i18n/skills"];
const OUT = "src/i18n/catalog.generated.json";

// _i18n_set <en|zh> <key> "double-quoted"  or  '...single-quoted...'
const LINE = /^_i18n_set\s+(en|zh)\s+(\S+)\s+("((?:[^"\\]|\\.)*)"|'([^']*)')\s*$/;

/** bash double-quote unescape for the escapes catalogs actually use. */
function unescapeDq(s) {
  return s.replace(/\\(["\\$`])/g, "$1");
}

const catalog = {};
let entries = 0;
for (const dir of I18N_DIRS) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".sh"));
  } catch {
    continue;
  }
  for (const f of files.sort()) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const line of text.split("\n")) {
      if (!line.startsWith("_i18n_set ")) continue;
      const m = LINE.exec(line);
      if (!m) {
        throw new Error(`unparseable _i18n_set line in ${f}: ${line}`);
      }
      const [, lang, key, , dq, sq] = m;
      const val = dq !== undefined ? unescapeDq(dq) : sq;
      catalog[key] ??= {};
      catalog[key][lang] = val;
      entries++;
    }
  }
}

// Contract: every key must have an en entry (msg falls back to EN).
const missingEn = Object.keys(catalog).filter((k) => catalog[k].en === undefined);
if (missingEn.length > 0) {
  console.warn(`WARN: ${missingEn.length} keys have zh but no en (kept as-is):`, missingEn.slice(0, 5));
}

writeFileSync(OUT, JSON.stringify(catalog, null, 1) + "\n");
console.log(`wrote ${OUT}: ${Object.keys(catalog).length} keys, ${entries} entries`);
