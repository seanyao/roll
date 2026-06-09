/**
 * `roll consistency` — TS port of bin/roll cmd_consistency (5711-5736) plus the
 * full orchestrator lib/consistency_check.py (ported in full).
 *
 * Subcommands: check (default) | --help/-h/help | unknown.
 *
 * `check [--json] [--project-dir DIR]` runs five dimensions (code, docs, i18n,
 * tests, site) and prints a human report (format_human) or JSON. Exit 0 when
 * all dimensions pass, 1 when any dimension has gaps — mirroring main()'s
 * `return 0 if overall == "pass" else 1`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveLang, STATUS_MARKER, t, v2Catalog, type Lang } from "@roll/spec";

const DIMENSIONS = ["code", "cards", "docs", "i18n", "tests", "site"];

interface DimResult {
  status: "pass" | "fail";
  gaps: string[];
  note?: string;
}
interface Report {
  overall: "pass" | "fail";
  dimensions: Record<string, DimResult>;
}

function err(line: string): void {
  const noColor = (process.env["NO_COLOR"] ?? "") !== "";
  const RED = noColor ? "" : "\x1b[0;31m";
  const NC = noColor ? "" : "\x1b[0m";
  process.stderr.write(`${RED}[roll]${NC} ${line}\n`);
}
function msgLang(): Lang {
  return resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });
}

// ─── shared helpers ──────────────────────────────────────────────────────────
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readText(p: string): string {
  return readFileSync(p, "utf8");
}

/** Port of _read_done_features: {feature: [story_id,...]} with ≥1 Done story. */
function readDoneFeatures(backlogText: string): Map<string, string[]> {
  const features = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of backlogText.split("\n")) {
    const m = /^### Feature:\s*(.+)$/.exec(line);
    if (m) {
      current = (m[1] ?? "").trim();
      features.set(current, []);
      continue;
    }
    if (current && line.includes(STATUS_MARKER.done)) {
      const m2 = /\[(US-|FIX-|REFACTOR-)([^\]]+)\]/.exec(line);
      if (m2) features.get(current)?.push((m2[1] ?? "") + (m2[2] ?? ""));
    }
  }
  // {k: v for k, v in features.items() if v}
  const out = new Map<string, string[]>();
  for (const [k, v] of features) if (v.length > 0) out.set(k, v);
  return out;
}

// ─── code dimension: check_features_catalog ──────────────────────────────────
function checkFeaturesCatalog(projectDir: string): DimResult {
  const backlog = join(projectDir, ".roll", "backlog.md");
  const features = join(projectDir, ".roll", "features.md");
  if (!existsSync(backlog) || !existsSync(features)) return { status: "pass", gaps: [] };

  const doneFeatures = readDoneFeatures(readText(backlog));
  if (doneFeatures.size === 0) return { status: "pass", gaps: [] };

  const featuresText = readText(features);
  const gaps: string[] = [];
  for (const featName of doneFeatures.keys()) {
    const escaped = escapeRegExp(featName);
    if (!new RegExp("(^|[\\s/])" + escaped + "([\\s/).]|$)").test(featuresText)) {
      gaps.push(`Feature '${featName}' has Done stories but is missing from features.md catalog`);
    }
  }
  return { status: gaps.length === 0 ? "pass" : "fail", gaps };
}

// ─── cards dimension: check_cards (US-CONSIST-006) ──────────────────────────
//
// The card-folder contract, reverse-derived from the features/ layout: every
// backlog ID must own `features/<epic>/<ID>/spec.md`, and a row's evidence
// link must point at a file that exists. Catches the two real-world failure
// shapes observed 2026-06-08: a story split that wrote backlog rows with no
// card folders (broken links), and a ✅ Done row carrying an evidence link to
// a report that was never produced. Pre-card-era Done rows remain informational;
// card-era Done rows with ACs but no report are a hard gap.
function checkCards(projectDir: string): DimResult {
  const backlog = join(projectDir, ".roll", "backlog.md");
  const featuresDir = join(projectDir, ".roll", "features");
  if (!existsSync(backlog) || !existsSync(featuresDir)) return { status: "pass", gaps: [] };

  // Map every card folder: <ID> → epic (first wins; folders are the truth).
  const cardEpic = new Map<string, string>();
  try {
    for (const epic of readdirSync(featuresDir, { withFileTypes: true })) {
      if (!epic.isDirectory()) continue;
      for (const card of readdirSync(join(featuresDir, epic.name), { withFileTypes: true })) {
        if (!card.isDirectory()) continue;
        if (existsSync(join(featuresDir, epic.name, card.name, "spec.md")) && !cardEpic.has(card.name)) {
          cardEpic.set(card.name, epic.name);
        }
      }
    }
  } catch {
    return { status: "pass", gaps: [], note: "features/ unreadable — skipped" };
  }

  const hasAcBlock = (epic: string, id: string): boolean => {
    try {
      return /\*\*AC:\*\*[\s\S]*?-\s+\[[ xX]\]\s+/.test(readText(join(featuresDir, epic, id, "spec.md")));
    } catch {
      return true;
    }
  };

  const gaps: string[] = [];
  let doneNoReportNoAc = 0;
  let doneNoFolder = 0;
  for (const line of readText(backlog).split("\n")) {
    const row = /^\|\s*\[?((?:US|FIX|REFACTOR|IDEA)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\]?/.exec(line);
    if (row === null) continue;
    const id = row[1] ?? "";
    if (!cardEpic.has(id)) {
      // LIVE rows must own a card folder (a split that writes rows without
      // cards breaks every link downstream). Pre-card-era ✅ Done rows are
      // legitimate history — counted, not failed.
      if (line.includes(STATUS_MARKER.done)) doneNoFolder += 1;
      else gaps.push(`Live backlog row ${id} has no card folder (features/<epic>/${id}/spec.md)`);
      continue;
    }
    // Evidence links must not dangle.
    const ev = /\[evidence\]\(([^)]+)\)/.exec(line);
    if (ev !== null) {
      const target = (ev[1] ?? "").replace(/^\.roll\//, "");
      if (!existsSync(join(projectDir, ".roll", target))) {
        gaps.push(`Backlog row ${id} evidence link is broken: ${ev[1] ?? ""}`);
      }
    } else if (line.includes(STATUS_MARKER.done)) {
      const epic = cardEpic.get(id) ?? "";
      if (!existsSync(join(featuresDir, epic, id, "latest", `${id}-report.html`))) {
        if (hasAcBlock(epic, id)) {
          gaps.push(`Done backlog row ${id} has ACs but no attest report`);
        } else {
          doneNoReportNoAc += 1;
        }
      }
    }
  }
  const result: DimResult = { status: gaps.length === 0 ? "pass" : "fail", gaps };
  const notes: string[] = [];
  if (doneNoFolder > 0) notes.push(`${doneNoFolder} pre-card-era Done rows without a card folder`);
  if (doneNoReportNoAc > 0) notes.push(`${doneNoReportNoAc} Done rows without AC blocks exempt from attest report`);
  if (notes.length > 0) result.note = `${notes.join("; ")} (informational)`;
  return result;
}

// ─── site dimension: check_site ──────────────────────────────────────────────
const SITE_INTERNAL_FEATURES = new Set([
  "cycle-meta-sync", "loop-log-locality", "invoke-stream-visibility",
  "loop-done-semantics", "loop-status-reader-path", "loop-result-eval",
  "loop-data-layout", "hooks-path-enforcement", "dev-vm-isolation",
  "test-quality-gates", "tcr-test-strategy", "test-preconditions",
  "e2e-lifecycle", "skill-harness", "agent-compliance",
  "convention-management", "github-actions", "pr-lifecycle",
  "loop-lifecycle-ownership", "loop-ci-self-heal",
  "cycle-log-archive", "agent-aware-execution",
  "manual-only-retirement", "loop-scheduling",
  "context-feed-budget", "documentation", "github-issues-sync",
  "notifications", "cycle-event-stream", "phase-tracing",
  "loop-write-integrity", "cross-machine-sync", "remote-monitoring",
  "cycle-history-rollup", "non-claude-usage-capture",
  "loop-config-cli", "loop-exit-summary", "edit-render-fold",
  "cli-redesign", "directory-restructure", "lifecycle-management",
  "upstream-watch", "i18n-localization",
]);

function siteTokens(name: string): Set<string> {
  const tk = name.toLowerCase();
  const tokens = new Set<string>();
  // t.lstrip("$") then split on [-/\s]+.
  for (const part of tk.replace(/^\$+/, "").split(/[-/\s]+/)) {
    if (part.length > 1) tokens.add(part);
  }
  return tokens;
}

function checkSite(projectDir: string): DimResult {
  const gaps: string[] = [];
  const siteJs = join(projectDir, "site", "roll-data.js");
  const backlog = join(projectDir, ".roll", "backlog.md");
  if (!existsSync(siteJs) || !existsSync(backlog)) return { status: "pass", gaps: [] };

  const siteText = readText(siteJs);
  const siteFeatures = new Set<string>();
  for (const m of siteText.matchAll(/\bname:\s*"([^"]+)"/g)) {
    const name = (m[1] ?? "").trim();
    if (name) siteFeatures.add(name);
  }

  if (siteFeatures.size === 0) {
    gaps.push(
      "site/roll-data.js has no FEATURE_GROUPS feature names — site may be missing content",
    );
    return { status: "fail", gaps };
  }

  const allSiteTokens = new Set<string>();
  for (const name of siteFeatures) for (const tok of siteTokens(name)) allSiteTokens.add(tok);

  const doneFeatures = readDoneFeatures(readText(backlog));
  if (doneFeatures.size === 0) return { status: "pass", gaps: [] };

  for (const featName of doneFeatures.keys()) {
    if (SITE_INTERNAL_FEATURES.has(featName)) continue;
    const featTokens = siteTokens(featName.replaceAll("-", " "));
    if (featTokens.size === 0) continue;
    let matchCount = 0;
    for (const tok of featTokens) if (allSiteTokens.has(tok)) matchCount++;
    if (matchCount < featTokens.size / 2) {
      gaps.push(
        `Feature '${featName}' has Done stories but is not mentioned ` +
          `on the landing page — site may be missing this capability`,
      );
    }
  }
  // The stale-reference loop in the python is a documented no-op (pass), so it
  // adds no gaps; omitted intentionally.
  return { status: gaps.length === 0 ? "pass" : "fail", gaps };
}

// ─── i18n dimension: check_i18n ──────────────────────────────────────────────
function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((n) => {
      try {
        return statSync(join(dir, n)).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function checkI18n(projectDir: string): DimResult {
  const gaps: string[] = [];

  // 1. Guide file parity.
  const guideEn = join(projectDir, "guide", "en");
  const guideZh = join(projectDir, "guide", "zh");
  if (existsSync(guideEn) && existsSync(guideZh)) {
    const enFiles = new Set(listFiles(guideEn));
    const zhFiles = new Set(listFiles(guideZh));
    const enOnly = [...enFiles].filter((f) => !zhFiles.has(f)).sort();
    const zhOnly = [...zhFiles].filter((f) => !enFiles.has(f)).sort();
    for (const f of enOnly) gaps.push(`guide/en/${f} has no corresponding guide/zh/${f}`);
    for (const f of zhOnly) gaps.push(`guide/zh/${f} has no corresponding guide/en/${f}`);
  }

  // 2. i18n key completeness.
  const i18nDir = join(projectDir, "lib", "i18n");
  if (existsSync(i18nDir)) {
    const keysEn = new Set<string>();
    const keysZh = new Set<string>();
    let shFiles: string[] = [];
    try {
      shFiles = readdirSync(i18nDir).filter((n) => n.endsWith(".sh")).sort();
    } catch {
      shFiles = [];
    }
    for (const name of shFiles) {
      const text = readText(join(i18nDir, name));
      for (const m of text.matchAll(/_i18n_set\s+(en|zh)\s+([^\s]+)/g)) {
        const lang = m[1];
        const key = m[2] ?? "";
        if (lang === "en") keysEn.add(key);
        else keysZh.add(key);
      }
    }
    const enOnlyKeys = [...keysEn].filter((k) => !keysZh.has(k)).sort();
    const zhOnlyKeys = [...keysZh].filter((k) => !keysEn.has(k)).sort();
    for (const k of enOnlyKeys) gaps.push(`i18n key '${k}' has EN but is missing ZH translation`);
    for (const k of zhOnlyKeys) gaps.push(`i18n key '${k}' has ZH but is missing EN translation`);
  }

  return { status: gaps.length === 0 ? "pass" : "fail", gaps };
}

// ─── tests dimension: check_tests ─────────────────────────────────────────────
function featureToKeywords(featureName: string): string[] {
  const slug = featureName.toLowerCase().replaceAll("-", " ").replaceAll("_", " ");
  return slug.split(/\s+/).filter((p) => p.length > 2);
}

function testFileRelatesToFeature(testName: string, featureName: string): boolean {
  const keywords = featureToKeywords(featureName);
  if (keywords.length === 0) return false;
  const lower = testName.toLowerCase();
  return keywords.every((kw) => lower.includes(kw));
}

function rglobBats(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: string[] = [];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (e.endsWith(".bats")) out.push(e);
    }
  };
  walk(dir);
  return out;
}

function checkTests(projectDir: string): DimResult {
  const gaps: string[] = [];
  const backlog = join(projectDir, ".roll", "backlog.md");
  const testsDir = join(projectDir, "tests");
  if (!existsSync(backlog)) return { status: "pass", gaps: [] };

  const backlogText = readText(backlog);
  const allFeatures = new Set<string>();
  const doneFeatures: string[] = [];

  for (const line of backlogText.split("\n")) {
    const m = /^### Feature:\s*(.+)$/.exec(line);
    if (m) {
      allFeatures.add((m[1] ?? "").trim());
      continue;
    }
    // py: `if "✅ Done" in line: pass` — no-op first scan.
  }

  let currentFeature: string | null = null;
  for (const line of backlogText.split("\n")) {
    const m = /^### Feature:\s*(.+)$/.exec(line);
    if (m) {
      currentFeature = (m[1] ?? "").trim();
      continue;
    }
    if (currentFeature && line.includes(STATUS_MARKER.done)) {
      const m2 = /\[(US-|FIX-|REFACTOR-)([^\]]+)\]/.exec(line);
      if (m2 && !doneFeatures.includes(currentFeature)) doneFeatures.push(currentFeature);
    }
  }

  const testFiles = existsSync(testsDir) ? rglobBats(testsDir) : [];
  if (testFiles.length === 0) return { status: "pass", gaps: [] };

  // 1. Done feature test coverage.
  for (const feat of doneFeatures) {
    const hasTest = testFiles.some((tf) => testFileRelatesToFeature(tf, feat));
    if (!hasTest) {
      gaps.push(
        `Feature '${feat}' has Done stories but no test file appears to cover it ` +
          `(heuristic: no test file name matches keywords ` +
          `${pyListRepr(featureToKeywords(feat))})`,
      );
    }
  }

  // 2. Stale test files.
  for (const tf of testFiles) {
    let stem = tf.replace(".bats", "");
    for (const prefix of ["cmd_", "agent_"]) {
      if (stem.startsWith(prefix)) {
        stem = stem.slice(prefix.length);
        break;
      }
    }
    if (stem.includes("_") || stem.length < 4) continue;
    const candidate = stem.replaceAll("_", "-");
    if (!allFeatures.has(candidate) && !allFeatures.has(stem)) {
      gaps.push(
        `Test file '${tf}' appears to reference feature '${candidate}' ` +
          `which does not exist in backlog — may be stale`,
      );
    }
  }

  return { status: gaps.length === 0 ? "pass" : "fail", gaps };
}

/** python repr() of a list[str], e.g. ['a', 'b'] (single quotes). */
function pyListRepr(items: string[]): string {
  return "[" + items.map((s) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`).join(", ") + "]";
}

// ─── orchestration ────────────────────────────────────────────────────────────
/** Programmatic pass/fail for the six dimensions — reused by `roll release ship`. */
export function consistencyPasses(projectDir: string): boolean {
  return runAll(projectDir).overall === "pass";
}

function runAll(projectDir: string): Report {
  const report: Report = { overall: "pass", dimensions: {} };
  for (const dim of DIMENSIONS) {
    let result: DimResult;
    if (dim === "code") result = checkFeaturesCatalog(projectDir);
    else if (dim === "cards") result = checkCards(projectDir);
    else if (dim === "i18n") result = checkI18n(projectDir);
    else if (dim === "tests") result = checkTests(projectDir);
    else if (dim === "docs")
      result = { status: "pass", gaps: [], note: "placeholder — will be implemented in US-CONSIST-002" };
    else if (dim === "site") result = checkSite(projectDir);
    else result = { status: "pass", gaps: [], note: `unknown dimension: ${dim}` };
    report.dimensions[dim] = result;
    if (result.status === "fail") report.overall = "fail";
  }
  return report;
}

/** Port of format_human. */
function formatHuman(report: Report): string {
  const lines: string[] = [];
  lines.push("Consistency Report");
  lines.push("=".repeat(50));
  for (const dim of DIMENSIONS) {
    const result = report.dimensions[dim];
    if (result === undefined) continue;
    const icon = result.status === "pass" ? "✅" : "❌";
    lines.push(`${icon} ${dim}: ${result.status}`);
    for (const gap of result.gaps) lines.push(`   • ${gap}`);
    const note = result.note ?? "";
    if (note) lines.push(`   ℹ ${note}`);
  }
  lines.push("-".repeat(50));
  lines.push(`Overall: ${report.overall}`);
  return lines.join("\n");
}

/** python json.dumps(indent=2, ensure_ascii=False) for the report shape. */
function jsonDumps(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  const pad2 = " ".repeat(indent + 2);
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return "[\n" + value.map((v) => pad2 + jsonDumps(v, indent + 2)).join(",\n") + "\n" + pad + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return "{}";
  return (
    "{\n" +
    keys.map((k) => `${pad2}${JSON.stringify(k)}: ${jsonDumps(obj[k], indent + 2)}`).join(",\n") +
    "\n" +
    pad +
    "}"
  );
}

/** Build the JSON-serializable report (dim result objects drop undefined note). */
function reportToJsonShape(report: Report): unknown {
  const dims: Record<string, unknown> = {};
  for (const dim of DIMENSIONS) {
    const r = report.dimensions[dim];
    if (r === undefined) continue;
    const o: Record<string, unknown> = { status: r.status, gaps: r.gaps };
    if (r.note !== undefined) o["note"] = r.note;
    dims[dim] = o;
  }
  return { overall: report.overall, dimensions: dims };
}

const CHECK_HELP = `Usage: roll consistency <subcommand>

  check [--json] [--project-dir DIR]    逐维度跑一致性检查
    Run checks across five dimensions (code, docs, i18n, tests, site)
    and produce a structured pass/gap report.

  roll consistency check                # human-readable report
  roll consistency check --json         # machine-readable JSON
`;

export function consistencyCommand(args: string[]): number {
  const subcmd = args[0] ?? "check";
  const rest = args.slice(1);

  if (subcmd === "check") {
    let isJson = false;
    let projectDir = process.cwd();
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i] ?? "";
      if (a === "--json") isJson = true;
      else if (a === "--project-dir") projectDir = rest[++i] ?? projectDir;
      else if (a.startsWith("--project-dir=")) projectDir = a.slice("--project-dir=".length);
    }
    const report = runAll(projectDir);
    if (isJson) {
      process.stdout.write(jsonDumps(reportToJsonShape(report)) + "\n");
    } else {
      process.stdout.write(formatHuman(report) + "\n");
    }
    return report.overall === "pass" ? 0 : 1;
  }

  if (subcmd === "--help" || subcmd === "-h" || subcmd === "help") {
    process.stdout.write(CHECK_HELP);
    return 0;
  }

  const lang = msgLang();
  err(t(v2Catalog, lang, "consistency.unknown_sub", subcmd));
  err("Try: roll consistency check");
  return 1;
}
