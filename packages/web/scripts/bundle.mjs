/**
 * Bundle @roll/web for browser consumption.
 *
 * Uses esbuild (already a monorepo devDependency) to produce a single
 * self-contained ESM file that can be loaded in a <script type="module">.
 * The bundle resolves workspace:* deps to their compiled dist/ outputs.
 */
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");

// Resolve workspace spec dep to its dist output
const specPkg = JSON.parse(
  readFileSync(resolve(pkgRoot, "../spec/package.json"), "utf8"),
);
const specMain = resolve(pkgRoot, "../spec", specPkg.main);

await esbuild.build({
  entryPoints: [resolve(pkgRoot, "src/browser.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: resolve(pkgRoot, "dist/console-bundle.mjs"),
  alias: {
    "@roll/spec": specMain,
  },
  // Treat spec as external since it has node deps? No — we need it bundled.
  // The spec package uses only type exports, no runtime node deps.
});

const outPath = resolve(pkgRoot, "dist/console-bundle.mjs");
const size = readFileSync(outPath).length;
console.log(`Bundled: ${outPath} (${(size / 1024).toFixed(1)} KB)`);
