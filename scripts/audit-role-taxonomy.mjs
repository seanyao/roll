#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const DEFAULT_TARGETS = [
  "README.md",
  "README_CN.md",
  "docs",
  "guide",
  "site",
  "scripts",
  "packages/core/src",
  "packages/cli/src",
  "packages/spec/src",
  "skills",
];

const TEXT_EXTENSIONS = new Set([".md", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".sh"]);
const SKIP_DIRS = new Set([".git", "node_modules", ".pnpm", "dist", "coverage"]);

const CHECKS = [
  { label: "retired active role: Prime Agent", pattern: /\bPrime Agent\b/ },
  { label: "retired active role: Planner", pattern: /\bPlanner\b/ },
  { label: "retired profile: planned profile", pattern: /\bplanned profiles?\b/i },
  { label: "retired profile: planned execution", pattern: /\bplanned execution profile\b/i },
  { label: "retired profile literal", pattern: /`planned`/ },
  { label: "retired artifact: planner-contract", pattern: /planner-contract(?:\.md)?/i },
  { label: "retired report wording: planned-vs-delivered", pattern: /planned-vs-delivered/i },
  { label: "retired config key: execution_profiles.planned", pattern: /execution_profiles\.planned/ },
  { label: "retired config key: roles.planner", pattern: /roles\.planner/ },
  { label: "retired config value: mode planned", pattern: /execution_policy\.mode:\s*planned/ },
  { label: "retired config value: default_profile planned", pattern: /default_profile:\s*planned/ },
  { label: "default role exclusion: avoid supervise", pattern: /avoid:\s*\[supervise\]/ },
  { label: "default role exclusion: avoid execute", pattern: /avoid:\s*\[execute\]/ },
  { label: "default brand exclusion: same-brand", pattern: /same-brand/i },
  { label: "default brand exclusion: provider-diversity", pattern: /provider-diversity/i },
  { label: "default builder exclusion wording", pattern: /must differ from builder/i },
  { label: "default provider exclusion wording", pattern: /different provider/i },
];

function parseArgs(argv) {
  const out = { root: repoRoot, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") out.root = path.resolve(argv[++i]);
    else if (arg === "--json") out.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function isTextFile(file) {
  return TEXT_EXTENSIONS.has(path.extname(file));
}

function walk(root, target, out) {
  if (!existsSync(target)) return;
  const st = statSync(target);
  if (st.isDirectory()) {
    const base = path.basename(target);
    if (SKIP_DIRS.has(base)) return;
    for (const entry of readdirSync(target)) walk(root, path.join(target, entry), out);
    return;
  }
  if (st.isFile() && isTextFile(target)) out.push(target);
}

function isAllowed(relativePath, line) {
  if (relativePath === "scripts/audit-role-taxonomy.mjs") return true;
  if (relativePath.startsWith("docs/migration/")) return true;
  if (relativePath === "docs/architecture.md" && /retired active|retired execution|retired active artifact|No alias|legacy/.test(line)) return true;
  if (relativePath === "packages/core/src/agent/config-v4.ts" && /legacy .* removed|execution_profiles\.planned|roles\.planner|use .*designed|use roles\.designer/.test(line)) return true;
  return false;
}

function scan(root) {
  const files = [];
  for (const target of DEFAULT_TARGETS) walk(root, path.join(root, target), files);
  const findings = [];
  for (const file of files.sort()) {
    const relativePath = rel(root, file);
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (isAllowed(relativePath, line)) return;
      for (const check of CHECKS) {
        if (check.pattern.test(line)) {
          findings.push({ file: relativePath, line: index + 1, label: check.label, text: line.trim() });
        }
      }
    });
  }
  return { scannedFiles: files.length, findings };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = scan(options.root);
  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else if (report.findings.length === 0) {
    process.stdout.write(`role-taxonomy audit: ok (${report.scannedFiles} files scanned)\n`);
  } else {
    process.stderr.write(`role-taxonomy audit: ${report.findings.length} retired active term/default rule finding(s)\n`);
    for (const finding of report.findings) {
      process.stderr.write(`  ${finding.file}:${finding.line} ${finding.label}: ${finding.text}\n`);
    }
  }
  if (report.findings.length > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write((error?.message ?? String(error)) + "\n");
  process.exitCode = 2;
}
