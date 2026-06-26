/**
 * US-ATTEST-006 — `roll attest <story-id>`: compose the five-piece evidence
 * chain into one acceptance report.
 *
 *   AC parser (core)      → structured AC items from .roll/features/**
 *   evidence collector    → evidence.json hard facts (infra, injectable seams)
 *   ANSI→HTML + renderer  → single-file report.html (core, pure)
 *   screenshots           → CONSUMED if present in the run dir; optional
 *                           --capture-* flags drive the terminal self-capture
 *                           lane and record machine capture facts.
 *
 * Intent hook (the AI layer's contract, consumed when present):
 *   `.roll/verification/<id>/ac-map.json` —
 *     [{ "ac": "<acId>", "status": "pass|readonly|partial|fail|blocked|claimed|missing",
 *        "evidence": [{kind,label,href?,textFile?}], "note": "…" }]
 *   Written by the attest skill during the Gate session (US-ATTEST-007 wiring).
 *   ABSENT map ⇒ every AC renders honestly as 🟧 Claimed (the render-layer red
 *   line) — a standalone run never invents per-AC evidence.
 *
 * Run lifecycle (D4): `.roll/verification/<id>/<run-id>/` (run-id =
 * YYYY-MM-DDTHH-MM-SS, never overwritten) + `latest` symlink. Failure policy
 * (D1): story-not-found errs exit 1; anything else degrades with a WARN and
 * still writes the best report it can, exit 0 — attest must never block
 * delivery.
 */
import {
  acForStory,
  bi,
  parseBacklog,
  renderReport,
  ansiPre,
  boundTranscript,
  EventBus,
  extractCycleSignals,
  smokeCheckReport,
  type AcReportItem,
  type AcStatus,
  type BeforeAfterPair,
  type CardContext,
  type DocGapWarning,
  type EvidenceRef,
  type ProcessArchive,
  type RunRow,
  type ReviewScoreReportEntry,
} from "@roll/core";
import { classifyStatus, type RollEvent } from "@roll/spec";
import {
  captureScreenshot,
  collectEvidence,
  containsSecret,
  openEvidenceFrame,
  redactSecrets,
  screenshotEvidenceRef,
  writeEvidenceJson,
  type CaptureCommandFact,
  type CaptureFact,
  type EvidenceRun,
  type RunOut,
  type ScreenshotDeps,
  type ScreenshotResult,
} from "@roll/infra";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { basename, dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import { cardArchiveDir, epicFromFeaturePath, findFeatureFile, findFeatureFiles, generateIndex, reportFileName } from "../lib/archive.js";
import { physicalTerminalFromSpecText } from "../lib/physical-terminal.js";
import { plannedVsDeliveredEvidence } from "../runner/attest-gate.js";
import { readReviewScoreTrend, readStoryReviewScores } from "../lib/review-score.js";
import { markPhaseDone } from "../lib/story-page.js";
import { collectToolEvidenceFromEventsPath, formatToolCostSummary } from "../lib/tool-display.js";
import { refreshAggregates } from "./index-gen.js";

// Re-export so existing importers (tests, callers) keep their entry point.
export { findFeatureFile } from "../lib/archive.js";

export interface AttestDeps {
  now?: () => Date;
  run?: EvidenceRun;
  ghProbe?: () => Promise<boolean>;
  /** US-ATTEST-011 — seams for the terminal self-capture lane (run/env/platform). */
  capture?: ScreenshotDeps;
  /** US-ATTEST-014 — injectable seam for the cycle process archive sources. */
  process?: ProcessReaders;
}

/**
 * US-ATTEST-014 — the process-archive data sources (runs.jsonl rows, the event
 * stream, and the per-cycle transcript log). Injectable so the reverse-lookup +
 * scoping logic is unit-testable without touching the real runtime dir.
 */
export interface ProcessReaders {
  runs(): RunRow[];
  events(): RollEvent[];
  /** Raw transcript text for a cycle, or null when the log is absent. */
  transcript(cycleId: string): string | null;
  /** Project-relative path to the machine original (indexed, not embedded). */
  transcriptPath(cycleId: string): string;
  /** Tool cost summary for a cycle, sourced from cycle:end cost.toolCosts. */
  toolCostSummary?(cycleId: string): string;
}

/** Default readers over `<runtimeDir>/{runs.jsonl,events.ndjson,cycle-logs/}`. */
function defaultProcessReaders(projectPath: string, env: Record<string, string | undefined>): ProcessReaders {
  const rt = (env.ROLL_PROJECT_RUNTIME_DIR ?? "").trim() || join(projectPath, ".roll", "loop");
  // Reuse the event bus's read side — it already parses runs.jsonl / events.ndjson
  // and returns [] for a missing file (readText → "" on absence), no throw.
  const bus = new EventBus();
  const logPath = (cid: string): string => join(rt, "cycle-logs", `${cid}.agent.log`);
  const toolEvidence = () => collectToolEvidenceFromEventsPath(join(rt, "events.ndjson"));
  return {
    runs: () => bus.readRuns(join(rt, "runs.jsonl")),
    events: () => bus.readEvents(join(rt, "events.ndjson")),
    transcript: (cid) => {
      const p = logPath(cid);
      if (!existsSync(p)) return null;
      try {
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    transcriptPath: (cid) => relative(projectPath, logPath(cid)),
    toolCostSummary: (cid) => formatToolCostSummary(toolEvidence().costsByCycle.get(cid), " · "),
  };
}

/**
 * US-ATTEST-014 — reverse-lookup the cycle that delivered a story. Scans
 * runs.jsonl rows (latest wins, so a rebuilt story resolves to its newest
 * cycle), matching `story_id` or membership in the `built[]` array. `found`
 * distinguishes a loop delivery (row exists) from a hand-delivered card (none).
 */
export function resolveStoryCycle(runs: RunRow[], storyId: string): { cycleId?: string; agent?: string; found: boolean } {
  let hit: RunRow | null = null;
  for (const row of runs) {
    const sid = row["story_id"];
    const built = row["built"];
    const match = sid === storyId || (Array.isArray(built) && built.includes(storyId));
    if (match) hit = row; // keep scanning — latest match wins
  }
  if (hit === null) return { found: false };
  const cycleId = typeof hit["cycle_id"] === "string" ? (hit["cycle_id"] as string) : undefined;
  const agent = typeof hit["agent"] === "string" && hit["agent"] !== "" ? (hit["agent"] as string) : undefined;
  return {
    found: true,
    ...(cycleId !== undefined && cycleId !== "" ? { cycleId } : {}),
    ...(agent !== undefined ? { agent } : {}),
  };
}

/**
 * US-ATTEST-014 — scope the global event stream to ONE cycle+story for the
 * trace extractor. cycleId-bearing events (lifecycle/tcr/gates) must match the
 * cycle; PR events carry the storyId and are kept when it matches; CI events
 * carry only a prNumber, so they ride along when their PR belongs to the story.
 * alert:notify has no story link and is dropped (un-attributable, never guessed).
 */
export function scopeCycleEvents(events: RollEvent[], cycleId: string | undefined, storyId: string): RollEvent[] {
  const prSet = new Set<number>();
  for (const ev of events) {
    if ((ev.type === "pr:open" || ev.type === "pr:merge") && ev.storyId === storyId) prSet.add(ev.prNumber);
  }
  return events.filter((ev) => {
    if ("cycleId" in ev && typeof (ev as { cycleId?: unknown }).cycleId === "string") {
      return cycleId !== undefined && (ev as { cycleId: string }).cycleId === cycleId;
    }
    if (ev.type === "pr:open" || ev.type === "pr:merge") return ev.storyId === storyId;
    if (ev.type === "pr:rebase" || ev.type === "pr:close") return prSet.has(ev.prNumber);
    if (ev.type === "ci:pass" || ev.type === "ci:fail" || ev.type === "ci:rerun") return prSet.has(ev.prNumber);
    return false; // alert:notify, loop:*, policy:*, route:* — not story-scoped here
  });
}

/**
 * US-ATTEST-014 — assemble the cycle process archive (timeline + signal layer +
 * bounded transcript). Tri-state, all degrading gracefully (D1, never throws):
 *   1. run row found            → `loop` delivery, full archive.
 *   2. no row but story events  → `manual` delivery (conductor 手工交付).
 *   3. nothing at all           → undefined (the renderer trims the section).
 * Sensitive strings in the transcript pass through 012's redaction pipeline
 * BEFORE inlining (a hit is WARNed, never silent).
 */
export function buildProcessArchive(storyId: string, readers: ProcessReaders): ProcessArchive | undefined {
  const { cycleId, agent, found } = resolveStoryCycle(readers.runs(), storyId);
  const scoped = scopeCycleEvents(readers.events(), cycleId, storyId);
  const { timeline } = extractCycleSignals(scoped, cycleId ?? "");

  // case 3: nothing to show
  if (!found && timeline.length === 0) return undefined;

  const delivery: ProcessArchive["delivery"] = found && cycleId !== undefined ? "loop" : "manual";
  const missing: string[] = [];
  const archive: ProcessArchive = { delivery };
  if (cycleId !== undefined) archive.cycleId = cycleId;
  if (agent !== undefined) archive.agent = agent;
  if (timeline.length > 0) archive.timeline = timeline;
  else missing.push("timeline");
  if (cycleId !== undefined && readers.toolCostSummary !== undefined) {
    const tools = readers.toolCostSummary(cycleId);
    if (tools !== "") archive.toolCostSummary = tools;
  }
  if (delivery === "manual") missing.push("cycle");

  // transcript — only loop cycles have an agent log; redact → bound → ANSI.
  if (cycleId !== undefined) {
    const raw = readers.transcript(cycleId);
    if (raw !== null) {
      const { redacted, hits } = redactSecrets(raw);
      if (hits.length > 0) warn(`redacted secret(s) in cycle transcript ${cycleId}: ${hits.join(", ")}`);
      const bounded = boundTranscript(redacted);
      archive.transcript = {
        inlineHtml: ansiPre(bounded.text),
        truncated: bounded.truncated,
        totalLen: bounded.totalLen,
        shownLen: bounded.shownLen,
        originalPath: readers.transcriptPath(cycleId),
      };
    } else {
      missing.push("transcript");
    }
  } else {
    missing.push("transcript");
  }

  if (missing.length > 0) archive.missing = missing;
  return archive;
}

const STATUSES: readonly AcStatus[] = ["pass", "readonly", "partial", "fail", "blocked", "claimed", "missing"];
const execFileAsync = promisify(execFile);

function warn(msg: string): void {
  process.stderr.write(`[roll] attest WARN: ${msg}\n`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function commandInProject(projectPath: string, command: string): string {
  return `cd ${shellQuote(projectPath)} && ${command}`;
}

function tail(text: string, max = 4000): string {
  return text.length <= max ? text : text.slice(text.length - max);
}

async function runShell(line: string, deps: ScreenshotDeps | undefined): Promise<RunOut> {
  // RED LINE (US-ATTEST-012 / FIX-339 复核 #2): the GUI screen-capture lane already
  // refuses a command whose body carries a secret (screenshot.ts) — a token baked
  // into pixels can't be un-baked. The HEADLESS command lane (this sink) runs the
  // command and persists its output, so it needs the SAME guard: a command body
  // carrying a secret must NOT run (it could echo/leak the token into the captured
  // stdout). Refuse it before any spawn; the caller records an honest skip.
  if (containsSecret(line)) {
    return { code: 1, stdout: "", stderr: "«REDACTED» secret in capture command — refused (redact & retry)" };
  }
  const injected = deps?.run;
  if (injected !== undefined) return injected("sh", ["-lc", line]);
  try {
    const { stdout, stderr } = await execFileAsync("sh", ["-lc", line], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof err.code === "number" ? err.code : 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

async function captureCommandFact(projectPath: string, command: string, deps: ScreenshotDeps | undefined): Promise<CaptureCommandFact> {
  const wrappedCommand = commandInProject(projectPath, command);
  // FIX-339 (复核 #2): a secret in the command body ⇒ refuse, never run (runShell
  // guards). Surface a non-zero exit so the caller records a taken:false skip.
  if (containsSecret(wrappedCommand)) {
    return {
      command,
      wrappedCommand,
      exitCode: 1,
      stdoutTail: "",
      stderrTail: "«REDACTED» secret in capture command — refused (redact & retry)",
    };
  }
  const r = await runShell(wrappedCommand, deps);
  // FIX-339 (复核 #2): scrub the PERSISTED stdout/stderr tails with the same
  // redaction pipeline used for inlined evidence — a token printed BY the command
  // (env dump, debug log) must never land in the archived evidence fact. A hit is
  // WARNed (留痕), never silent.
  const outR = redactSecrets(tail(r.stdout));
  const errR = redactSecrets(tail(r.stderr));
  if (outR.hits.length > 0 || errR.hits.length > 0) {
    warn(`redacted secret(s) in capture command output (${command}): ${[...outR.hits, ...errR.hits].join(", ")}`);
  }
  return {
    command,
    wrappedCommand,
    exitCode: r.code,
    stdoutTail: outR.redacted,
    stderrTail: errR.redacted,
  };
}

const DOC_ALIGNMENT_PATTERNS: readonly RegExp[] = [
  /^README(?:_[A-Z]+)?\.md$/,
  /^AGENTS\.md$/,
  /^CHANGELOG\.md$/,
  /^docs\//,
  /^guide\//,
  /^site\//,
];

const USER_VISIBLE_SURFACE_PATTERNS: readonly RegExp[] = [
  /^packages\/cli\/src\/commands\/[^/]+\.ts$/,
  /^packages\/cli\/src\/commands\/index\.ts$/,
  /^packages\/cli\/src\/index\.ts$/,
  /^packages\/cli\/src\/render\.ts$/,
  /^packages\/spec\/src\/i18n\//,
];

function normalizeDiffPath(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export function isDocAlignmentFile(file: string): boolean {
  const normalized = normalizeDiffPath(file);
  return DOC_ALIGNMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isUserVisibleSurfaceFile(file: string): boolean {
  const normalized = normalizeDiffPath(file);
  return USER_VISIBLE_SURFACE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function assessDocGapFromFiles(files: readonly string[]): DocGapWarning | undefined {
  const seen = new Set<string>();
  const changedFiles: string[] = [];
  for (const file of files) {
    const normalized = normalizeDiffPath(file);
    if (normalized === "" || seen.has(normalized)) continue;
    seen.add(normalized);
    changedFiles.push(normalized);
  }
  const visibleFiles = changedFiles.filter(isUserVisibleSurfaceFile);
  if (visibleFiles.length === 0) return undefined;
  if (changedFiles.some(isDocAlignmentFile)) return undefined;
  return { changedFiles, visibleFiles };
}

function gitNameOnly(projectPath: string, args: readonly string[]): string[] {
  try {
    const out = execFileSync("git", ["-C", projectPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map(normalizeDiffPath)
      .filter((file) => file !== "");
  } catch {
    return [];
  }
}

function collectChangedFiles(projectPath: string): string[] {
  const candidates: readonly (readonly string[])[] = [
    ["diff", "--name-only", "--diff-filter=ACMRTUXB", "origin/main...HEAD"],
    ["diff", "--name-only", "--diff-filter=ACMRTUXB", "main...HEAD"],
    ["diff", "--name-only", "--diff-filter=ACMRTUXB", "HEAD~1..HEAD"],
    ["diff", "--name-only", "--diff-filter=ACMRTUXB"],
    ["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"],
  ];
  const files: string[] = [];
  const seen = new Set<string>();
  for (const args of candidates) {
    for (const file of gitNameOnly(projectPath, args)) {
      if (seen.has(file)) continue;
      seen.add(file);
      files.push(file);
    }
  }
  return files;
}

function detectDocGap(projectPath: string): DocGapWarning | undefined {
  return assessDocGapFromFiles(collectChangedFiles(projectPath));
}

interface AcMapEntry {
  ac: string;
  status?: string;
  note?: string;
  evidence?: Array<{ kind?: string; label?: string; href?: string; textFile?: string }>;
}

const DEFAULT_MAX_CAST_BYTES = 1024 * 1024;
const DEFAULT_MAX_VIDEO_BYTES = 25 * 1024 * 1024;

function maxBytes(kind: "cast" | "video"): number {
  const envKey = kind === "cast" ? "ROLL_EVIDENCE_MAX_CAST_BYTES" : "ROLL_EVIDENCE_MAX_VIDEO_BYTES";
  const raw = Number(process.env[envKey]);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return kind === "cast" ? DEFAULT_MAX_CAST_BYTES : DEFAULT_MAX_VIDEO_BYTES;
}

/** FIX-332: a cycle that RESUMES an un-merged branch lands in a fresh run dir.
 *  If the agent replays the old commit and deposits no new evidence, the current
 *  run dir is empty — but the card archive still holds the prior cycle's evidence
 *  in sibling run dirs. We bridge ONLY when the current run dir has no evidence of
 *  its own, and we prefer newer siblings first. This keeps the honesty red line
 *  for normal cycles (a populated run dir never silently inherits stale files)
 *  while preventing the resume-empty-shell death spiral.
 *
 *  A run dir is considered "evidenced" when it carries any real artifact file
 *  (text logs under `evidence/`, screenshots under `screenshots/`, cast/video at
 *  the run root, …). The `evidence.json` manifest alone does NOT count — it is
 *  written for every cycle, even when no capture succeeded. */
function runDirHasEvidence(runDir: string): boolean {
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = readdirSync(runDir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.name === "evidence.json") continue;
    if (e.isDirectory()) {
      try {
        if (readdirSync(join(runDir, e.name)).some((f) => f !== "")) return true;
      } catch {
        /* unreadable subdir: ignore */
      }
    } else {
      return true;
    }
  }
  return false;
}

const RUN_DIR_NAME_RE = /^(\d{4}-\d{2}-\d{2}T|cycle-)/;

/** Sorted candidate sibling run dirs under the card archive, newest first.
 *  Excludes the current run dir and non-run subdirs (notes, latest, etc). */
function siblingRunDirs(cardDir: string, currentRunDir: string): string[] {
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = readdirSync(cardDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const currentBase = basename(currentRunDir);
  const dirs = entries
    .filter((e) => e.isDirectory() && RUN_DIR_NAME_RE.test(e.name) && e.name !== currentBase)
    .map((e) => join(cardDir, e.name));
  try {
    dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  } catch {
    /* mtime unreadable: keep directory order */
  }
  return dirs;
}

/** FIX-315 + FIX-332: resolve a relative evidence ref against the run/era dir,
 *  the card/story archive dir, and (only for an empty current run dir) prior
 *  sibling run dirs from resumed work. Returns the first existing path, or null
 *  — the file must actually exist; the red line is preserved by construction. */
function resolveEvidenceFile(
  runDir: string,
  cardDir: string,
  ref: string,
  siblingBases: readonly string[] = [],
): string | null {
  for (const base of [runDir, cardDir, ...siblingBases]) {
    const p = join(base, ref);
    if (existsSync(p)) return p;
  }
  return null;
}

function localEvidencePath(
  runDir: string,
  cardDir: string,
  href: string,
  siblingBases: readonly string[] = [],
): string | null {
  if (href === "" || href.startsWith("/") || href.includes("..") || /^[a-z]+:/i.test(href)) return null;
  return resolveEvidenceFile(runDir, cardDir, href, siblingBases);
}

/** Read + validate the optional AI intent map; null when absent/malformed. */
function readAcMap(storyDir: string): Map<string, AcMapEntry> | null {
  const p = join(storyDir, "ac-map.json");
  if (!existsSync(p)) return null;
  try {
    const arr = JSON.parse(readFileSync(p, "utf8")) as AcMapEntry[];
    if (!Array.isArray(arr)) return null;
    const m = new Map<string, AcMapEntry>();
    for (const e of arr) if (typeof e?.ac === "string") m.set(e.ac, e);
    return m;
  } catch {
    warn("ac-map.json malformed — rendering without intent mapping");
    return null;
  }
}

function toRef(
  runDir: string,
  cardDir: string,
  e: NonNullable<AcMapEntry["evidence"]>[number],
  siblingBases: readonly string[] = [],
): EvidenceRef | null {
  const kind = (e.kind ?? "") as EvidenceRef["kind"];
  const label = e.label ?? kind;
  if (kind === "text" && e.textFile !== undefined) {
    const p = resolveEvidenceFile(runDir, cardDir, e.textFile, siblingBases);
    if (p === null) return null;
    try {
      // RED LINE (US-ATTEST-012): scrub secrets/PII BEFORE the text is inlined
      // into the report — once archived, the run dir is never overwritten. A
      // hit is WARNed, never silent (留痕).
      const { redacted, hits } = redactSecrets(readFileSync(p, "utf8"));
      if (hits.length > 0) warn(`redacted secret(s) in ${e.textFile}: ${hits.join(", ")}`);
      return { kind, label, inlineHtml: ansiPre(redacted) };
    } catch {
      return null;
    }
  }
  if ((kind === "cast" || kind === "video") && e.href !== undefined) {
    const p = localEvidencePath(runDir, cardDir, e.href, siblingBases);
    if (p === null || !existsSync(p)) return null;
    try {
      const size = statSync(p).size;
      if (size > maxBytes(kind)) {
        warn(`${kind} evidence too large (${size} bytes > ${maxBytes(kind)}): ${e.href}`);
        return null;
      }
      if (kind === "cast") {
        const { redacted, hits } = redactSecrets(readFileSync(p, "utf8"));
        if (hits.length > 0) warn(`redacted secret(s) in ${e.href}: ${hits.join(", ")}`);
        const bounded = boundTranscript(redacted);
        return { kind, label, href: e.href, inlineHtml: ansiPre(bounded.text) };
      }
      return { kind, label, href: e.href };
    } catch {
      return null;
    }
  }
  if (["screenshot", "commit", "ci", "deploy", "test-pass"].includes(kind)) {
    return e.href !== undefined ? { kind, label, href: e.href } : { kind, label };
  }
  return null;
}

function relativeFromPhysical(fromDir: string, toPath: string): string {
  try {
    return relative(realpathSync(fromDir), realpathSync(toPath));
  } catch {
    return relative(fromDir, toPath);
  }
}

/**
 * US-ATTEST-009 — same-story Review Score entries from `.roll/notes/`:
 * `YYYY-MM-DD-<skill>-<STORY>-<ts>.md` with YAML frontmatter
 * {skill, story, score, verdict, ts} + a prose body. Tolerant reader: files
 * that fail to parse are skipped; no notes ⇒ empty list ⇒ block skipped.
 */
export function readReviewScores(
  projectPath: string,
  storyId: string,
  hrefFromDir?: string,
): ReviewScoreReportEntry[] {
  return readStoryReviewScores(projectPath, storyId, hrefFromDir).map((e) => ({
    skill: e.skill,
    score: e.score,
    verdict: e.verdict,
    ts: e.ts,
    note: e.note,
    ...(e.href !== undefined ? { href: e.href } : {}),
    ...(Object.keys(e.dimensions).length > 0 ? { dimensions: e.dimensions } : {}),
  }));
}

/**
 * US-ATTEST-013 — read the human one-liner + current status straight from the
 * backlog table row (ID-anchored). The description is the "一句人话"; the status
 * cell tells the reviewer where the card sits right now. Lenient: missing
 * backlog / no matching row ⇒ {}.
 */
export function readBacklogRow(projectPath: string, storyId: string): { description?: string; status?: string } {
  const p = join(projectPath, ".roll", "backlog.md");
  if (!existsSync(p)) return {};
  let text: string;
  try {
    text = readFileSync(p, "utf8");
  } catch {
    return {};
  }
  for (const line of text.split("\n")) {
    if (!line.includes("|") || !line.includes(storyId)) continue;
    const cells = line.split("|").map((c) => c.trim());
    const idIdx = cells.findIndex((c) => c === storyId || c.includes(`${storyId}]`) || c.includes(`${storyId} `) || c === `[${storyId}]`);
    const at = idIdx >= 0 ? idIdx : cells.findIndex((c) => c.includes(storyId));
    if (at < 0) continue;
    const description = cells[at + 1];
    const status = cells[at + 2];
    return {
      ...(description !== undefined && description !== "" ? { description } : {}),
      ...(status !== undefined && status !== "" ? { status } : {}),
    };
  }
  return {};
}

/** Join the FIRST `>` blockquote block of a feature md as the spec/方案 summary. */
function extractSummary(featureText: string): string | undefined {
  const quote: string[] = [];
  for (const l of featureText.split("\n")) {
    const m = /^>\s?(.*)$/.exec(l);
    if (m !== null) quote.push(m[1] ?? "");
    else if (quote.length > 0) break;
  }
  const s = quote.join(" ").replace(/\s+/g, " ").trim();
  return s !== "" ? s : undefined;
}

/**
 * US-ATTEST-013 — assemble the self-contained card context: 一句人话 + epic +
 * spec 摘要 + backlog 现状 + 交付链(cycle id). Empty when nothing resolves (trim
 * upstream). The renderer further trims any empty sub-field.
 */
export function buildCardContext(
  projectPath: string,
  featureFile: string,
  storyId: string,
  env: Record<string, string | undefined>,
): CardContext | undefined {
  const row = readBacklogRow(projectPath, storyId);
  const oneLiner =
    row.description !== undefined ? row.description.replace(/\s*depends-on:\S+/gi, "").trim() : undefined;
  let summary: string | undefined;
  try {
    summary = extractSummary(readFileSync(featureFile, "utf8"));
  } catch {
    /* unreadable: skip summary */
  }
  const epic = epicFromFeaturePath(featureFile);
  const cycleId = env.LOOP_CYCLE_ID;
  const ctx: CardContext = {
    ...(oneLiner !== undefined && oneLiner !== "" ? { oneLiner } : {}),
    ...(epic !== null ? { epic } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(row.status !== undefined ? { backlogStatus: row.status } : {}),
    ...(cycleId !== undefined && cycleId !== "" ? { delivery: { cycleId } } : {}),
  };
  return Object.keys(ctx).length > 0 ? ctx : undefined;
}

/**
 * US-ATTEST-013 — pair `before-<stem>.png` with `after-<stem>.png` shots the
 * Gate dropped in the run's screenshots/. Only matched pairs surface; an
 * unmatched before/after is ignored (the renderer needs both sides). Brand-new
 * features carry none → empty list → section trimmed.
 */
export function detectBeforeAfter(runDir: string): BeforeAfterPair[] {
  const dir = join(runDir, "screenshots");
  if (!existsSync(dir)) return [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  } catch {
    return [];
  }
  const pairs: BeforeAfterPair[] = [];
  for (const f of files.slice().sort()) {
    const m = /^before-(.+)\.(png|jpe?g|webp)$/i.exec(f);
    if (m === null) continue;
    const stem = m[1] ?? "";
    const ext = m[2] ?? "";
    const want = `after-${stem}.${ext}`.toLowerCase();
    const after = files.find((x) => x.toLowerCase() === want);
    if (after === undefined) continue;
    pairs.push({
      label: stem,
      before: { kind: "screenshot", label: `改前 ${stem}`, href: `screenshots/${f}` },
      after: { kind: "screenshot", label: `改后 ${stem}`, href: `screenshots/${after}` },
    });
  }
  return pairs;
}

export interface AfterOnlyShot {
  label: string;
  shot: EvidenceRef;
}

/** US-EVID-004: after-only delivery visuals for brand-new surfaces. */
export function detectAfterOnly(runDir: string): AfterOnlyShot[] {
  const dir = join(runDir, "screenshots");
  if (!existsSync(dir)) return [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  } catch {
    return [];
  }
  const lower = new Set(files.map((f) => f.toLowerCase()));
  const shots: AfterOnlyShot[] = [];
  for (const f of files.slice().sort()) {
    const m = /^after-(.+)\.(png|jpe?g|webp)$/i.exec(f);
    if (m === null) continue;
    const stem = m[1] ?? "";
    const ext = m[2] ?? "";
    if (lower.has(`before-${stem}.${ext}`.toLowerCase())) continue;
    shots.push({
      label: stem,
      shot: { kind: "screenshot", label: `改后 ${stem}`, href: `screenshots/${f}` },
    });
  }
  return shots;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function webJoin(...parts: string[]): string {
  return parts.filter((p) => p !== "").join("/").replace(/\\/g, "/").replace(/\/+/g, "/");
}

function dossierVisualsHtml(runRel: string, pairs: BeforeAfterPair[], afterOnly: AfterOnlyShot[]): string {
  const figs: string[] = [];
  for (const p of pairs) {
    const before = webJoin(runRel, p.before.href ?? "");
    const after = webJoin(runRel, p.after.href ?? "");
    figs.push(
      `<div class="delivery-shot-pair" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:10px 0;">` +
        `<figure style="margin:0;"><a href="${escHtml(before)}"><img src="${escHtml(before)}" alt="${escHtml(p.before.label)}" style="width:100%;height:auto;border-radius:6px;"></a><figcaption>${bi("Before", "改前")} ${escHtml(p.label)}</figcaption></figure>` +
        `<figure style="margin:0;"><a href="${escHtml(after)}"><img src="${escHtml(after)}" alt="${escHtml(p.after.label)}" style="width:100%;height:auto;border-radius:6px;"></a><figcaption>${bi("After", "改后")} ${escHtml(p.label)}</figcaption></figure>` +
      `</div>`,
    );
  }
  for (const shot of afterOnly) {
    const href = webJoin(runRel, shot.shot.href ?? "");
    figs.push(
      `<figure class="delivery-shot-single" style="margin:10px 0;"><a href="${escHtml(href)}"><img src="${escHtml(href)}" alt="${escHtml(shot.shot.label)}" style="width:100%;max-width:720px;height:auto;border-radius:6px;"></a><figcaption>${bi("After", "改后")} ${escHtml(shot.label)}</figcaption></figure>`,
    );
  }
  return figs.length > 0 ? `<div class="delivery-shots">${figs.join("\n")}</div>\n` : "";
}

const USAGE = [
  "Usage: roll attest <story-id> [--deploy-url <url>] [--run-dir <path>]",
  "                   [--capture-terminal | --capture-tmux <session> | --capture-command <cmd>]",
  "                   [--capture-web <url|file>] [--capture-browser <app>] [--capture-region <x,y,w,h>]",
  "  --capture-tmux <session>   self-capture a terminal attached to a tmux session (unattended Gate)",
  "  --capture-command <cmd>    self-capture a terminal running <cmd> (repeatable — one per deliverable_cmd; FIX-339)",
  "  --capture-command-skip <r> record an honest terminal skip for a refused deliverable_cmd (allowlist; repeatable)",
  "  --capture-web <url|file>   self-capture a REAL screenshot of a rendered page (FIX-305; repeatable — one per",
  "                             deliverable_url, FIX-339) — the FIX-291 ladder: macOS GUI browser, else headless Chromium",
  "  --capture-browser <app>    GUI lane browser app to drive (default Google Chrome)",
  "  --capture-region <rect>    screencapture -R rectangle (default 0,0,1280,800)",
  "  (terminal lane honestly skips off-GUI / without screen-recording permission)",
].join("\n");

/**
 * The AC items for a story, resilient to a content-free stub owner (FIX-226).
 * `findFeatureFile` returns the ID-owned card file, which after migrate-features
 * (US-META-007) may be a stub `spec.md` carrying no `**AC:**` block while the
 * story's real ACs still live in the epic feature file. Walk every candidate
 * (ID-owned first) and return the FIRST non-empty AC set — so a stub that DOES
 * carry its own ACs still wins first (FIX-225 preserved), and an empty stub
 * falls through to the epic file instead of yielding a zero-AC report.
 *
 * FIX-374: an ID-owned card is EITHER the flat `<storyId>.md` OR the card-folder
 * `<storyId>/spec.md` (the same `idOwned` predicate `findFeatureFiles` uses).
 * Both forms own the WHOLE file, so `fileOwned` must hold for either — otherwise
 * a `## Root cause (… FIX-368 sibling)` heading inside a `spec.md` re-attributes
 * the trailing AC block to the mentioned sibling and the report renders zero ACs
 * (the FIX-214 hijack class, here via the directory layout). This keeps the
 * report path aligned with the gate path, which already passes `fileOwned: true`.
 */
function isIdOwnedCard(cand: string, storyId: string): boolean {
  return basename(cand) === `${storyId}.md` || (basename(cand) === "spec.md" && basename(dirname(cand)) === storyId);
}

export function resolveStoryAcItems(projectPath: string, storyId: string): ReturnType<typeof acForStory> {
  for (const cand of findFeatureFiles(projectPath, storyId)) {
    try {
      const items = acForStory(readFileSync(cand, "utf8"), storyId, {
        fileOwned: isIdOwnedCard(cand, storyId),
      });
      if (items.length > 0) return items;
    } catch {
      /* unreadable candidate: skip */
    }
  }
  return [];
}

/** `roll attest <story-id> [--deploy-url <url>] [--capture-tmux <s> | --capture-command <c>]` */
export async function attestCommand(args: string[], deps: AttestDeps = {}): Promise<number> {
  // FIX-329 — the `attest backfill` loophole is removed. Acceptance evidence is
  // produced DURING delivery (the loop's HARD attest:gate renders the report
  // in-cycle; manual deliveries run attest as their Phase 10.6 step), never
  // reconstructed after the fact. A bulk "backfill" let Done cards acquire a
  // report with no real in-delivery evidence — an escape hatch around the truth
  // gate. With it gone, an unattested Done card has no way to pass the release
  // consistency gate except by being attested at delivery time.
  if (args[0] === "backfill") {
    process.stderr.write(
      "[roll] `attest backfill` was removed (FIX-329): attest evidence is produced during delivery, " +
        "not backfilled after the fact. Re-deliver the story (loop or manual Phase 10.6 attest) to earn its report.\n",
    );
    return 1;
  }
  const flagsWithValue = new Set(["--deploy-url", "--run-dir", "--capture-tmux", "--capture-command", "--capture-command-skip", "--capture-region", "--capture-web", "--capture-web-skip", "--capture-browser"]);
  let storyId: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (flagsWithValue.has(arg)) {
      i += 1;
      continue;
    }
    if (!arg.startsWith("-")) {
      storyId = arg;
      break;
    }
  }
  if (storyId === undefined || storyId === "") {
    process.stderr.write(USAGE + "\n");
    return 1;
  }
  const flagVal = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  // FIX-339 — a flag may REPEAT (multi-surface: several --capture-web / several
  // --capture-command). Collect every value in order.
  const flagVals = (name: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === name) {
        const v = args[i + 1];
        if (v !== undefined) out.push(v);
      }
    }
    return out;
  };
  const deployUrl = flagVal("--deploy-url");
  const explicitRunDir = flagVal("--run-dir");
  const envRunDir = (process.env["ROLL_RUN_DIR"] ?? "").trim();
  const providedRunDir =
    explicitRunDir !== undefined && explicitRunDir !== "" ? explicitRunDir : envRunDir !== "" ? envRunDir : undefined;
  // US-ATTEST-011 — unattended terminal self-capture lane. Driven by the Gate
  // session in a headless cycle; on a non-GUI / no-permission host the lane
  // honestly skips and the report drops the self-capture block (no placeholder).
  const captureTmux = flagVal("--capture-tmux");
  // FIX-339 (AC2/AC3): --capture-command may REPEAT — one declared deliverable_cmd
  // per flag. Each is run in the worktree and its terminal output captured; a
  // multi-command card produces terminal.png, terminal-1.png, … (no name clash).
  const captureCommands = flagVals("--capture-command");
  // FIX-339 (复核 #1): a deliverable_cmd the runner's allowlist REJECTED. It is
  // NEVER run — we only record an honest terminal skip fact (taken:false) so the
  // report discloses the refusal and the attest gate can fail on it.
  const captureCommandSkips = flagVals("--capture-command-skip");
  const captureRegion = flagVal("--capture-region");
  const captureTerminal = args.includes("--capture-terminal") || captureTmux !== undefined || captureCommands.length > 0;
  // FIX-305 — UI/dossier self-capture lane. A UI/dossier card's acceptance is a
  // RENDERED page, so its evidence must be a REAL pixel screenshot, not a
  // machine-skip. `--capture-web <url|file>` drives the FIX-291 web ladder
  // (macOS GUI browser → headless Chromium → honest skip); the headless rung
  // needs NO GUI, so a network-only loop runner self-produces a real PNG of the
  // dossier/story page instead of leaving the screenshots dir empty.
  // FIX-339 (AC1): --capture-web may REPEAT — one declared deliverable_url per
  // flag. Each url is captured into web.png, web-1.png, … (no name clash).
  const captureWebs = flagVals("--capture-web");
  // FIX-321: when no deliverable web target is declared, the runner passes
  // --capture-web-skip <reason> instead of --capture-web. We record an HONEST web
  // skip (taken:false) — no browser, no hollow dossier shot — which satisfies the
  // visual floor via hasMachineCaptureSkip without faking evidence.
  const captureWebSkip = flagVal("--capture-web-skip");
  const captureBrowser = flagVal("--capture-browser");

  const projectPath = process.cwd();
  const featureFile = findFeatureFile(projectPath, storyId);
  if (featureFile === null) {
    process.stderr.write(`[roll] attest: story ${storyId} not found under .roll/features/\n`);
    process.stderr.write(`[roll] attest：在 .roll/features/ 下找不到 ${storyId}\n`);
    return 1;
  }

  // AC extraction (FIX-226): walk past a content-free stub owner — the ID-owned
  // card file may be a migrate-features `spec.md` (US-META-007) with no `**AC:**`
  // block, while the story's real ACs still live in the epic feature file. The
  // ID-owned file is still tried first, so US-ATTEST-012 / FIX-214 / FIX-225
  // (a real owner wins; no cross-card hijack) are all preserved.
  const acItems = resolveStoryAcItems(projectPath, storyId);
  if (acItems.length === 0) warn(`no AC block for ${storyId} — report will carry facts only`);

  // run dir + latest symlink (never overwrite history).
  const now = (deps.now ?? ((): Date => new Date()))();
  const p2 = (n: number): string => String(n).padStart(2, "0");
  const generatedRunId = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}T${p2(now.getHours())}-${p2(now.getMinutes())}-${p2(now.getSeconds())}`;
  // US-META-001: deliverables land in the card folder `features/<epic>/<ID>/`
  // (epic via the backlog-generated index, uncategorized fallback). Runs never
  // overwrite history; `latest` symlinks the newest.
  const storyDir = cardArchiveDir(projectPath, storyId);
  // FIX-332 hygiene: an ambient ROLL_RUN_DIR from a parent loop can point at a
  // different story's run frame (e.g. the loop runner's own evidence dir). Using
  // it would leak the current story's report into another card's archive. Only
  // honor a provided run dir whose parent directory matches this story id.
  const safeProvidedRunDir =
    providedRunDir !== undefined && basename(dirname(providedRunDir)) === storyId ? providedRunDir : undefined;
  if (providedRunDir !== undefined && safeProvidedRunDir === undefined) {
    warn(`ignoring mismatched run dir ${providedRunDir} for story ${storyId}`);
  }
  const runDir = safeProvidedRunDir ?? join(storyDir, generatedRunId);
  openEvidenceFrame({ runDir });

  // US-INIT-003b: detect physical_terminal cards — they use kind: "physical_terminal"
  // and NEVER fall back to headless text artifacts.
  const isPhysicalTerminal = ((): boolean => {
    try {
      return physicalTerminalFromSpecText(readFileSync(featureFile, "utf8")) !== null;
    } catch {
      return false;
    }
  })();
  const terminalCaptureKind: "terminal" | "physical_terminal" = isPhysicalTerminal ? "physical_terminal" : "terminal";

  // terminal self-capture (US-ATTEST-011): drive the dispatcher's terminal lane
  // into this run's screenshots/ BEFORE evidence sweep, then bridge a TAKEN shot
  // to a report figure. A SKIP (headless / no permission) yields null → the
  // screenshot block is dropped, but FIX-258 records the structured skip fact.
  const selfCaptures: EvidenceRef[] = [];
  const captureFacts: CaptureFact[] = [];
  let commandFact: CaptureCommandFact | null = null;
  if (captureTerminal) {
    mkdirSync(join(runDir, "screenshots"), { recursive: true });
    // FIX-339 (AC2/AC3): capture EACH declared command (--capture-command may
    // repeat) plus, when no command is given, a tmux/bare terminal shot. Each
    // gets a distinct stem terminal.png / terminal-1.png / … so a multi-command
    // card never overwrites its own evidence. SECURITY: every command is one the
    // spec DECLARED, wrapped in `cd <worktree> && …` (commandInProject) — only the
    // worktree's own declared commands ever run; no external input reaches here.
    const lanes: Array<{ command?: string }> =
      captureCommands.length > 0 ? captureCommands.map((c) => ({ command: c })) : [{}];
    for (let li = 0; li < lanes.length; li += 1) {
      const lane = lanes[li] ?? {};
      const stem = li === 0 ? "terminal.png" : `terminal-${li}.png`;
      const out = join(runDir, "screenshots", stem);
      let fact: CaptureCommandFact | null = null;
      if (lane.command !== undefined) {
        fact = await captureCommandFact(projectPath, lane.command, deps.capture);
        if (commandFact === null) commandFact = fact; // first command is the representative capture_command (back-compat)
      }
      let shot: ScreenshotResult =
        fact !== null && fact.exitCode !== 0
          ? { kind: terminalCaptureKind, out, taken: false, skipped: `capture command exited ${fact.exitCode}` }
          : await captureScreenshot(
              {
                kind: terminalCaptureKind,
                out,
                ...(lane.command === undefined && captureTmux !== undefined ? { tmux: captureTmux } : {}),
                ...(lane.command !== undefined ? { command: commandInProject(projectPath, lane.command) } : {}),
                ...(captureRegion !== undefined ? { region: captureRegion } : {}),
              },
              deps.capture ?? {},
            );
      // FIX-392: headless fallback — when a terminal deliverable_cmd ran
      // successfully but the screenshot lane skipped (no GUI / not macOS /
      // headless), promote the command's stdout to a taken text evidence
      // artifact so the attest gate does not deadlock. The stdout text IS
      // the terminal capture.
      // US-INIT-003b: physical_terminal cards NEVER fall back to headless text —
      // physical evidence cannot be satisfied by a transcript dump.
      let refStem = stem;
      if (!shot.taken && fact !== null && fact.exitCode === 0 && !isPhysicalTerminal) {
        refStem = li === 0 ? "terminal-headless.txt" : `terminal-headless-${li}.txt`;
        const txtOut = join(runDir, "screenshots", refStem);
        writeFileSync(txtOut, fact.stdoutTail, "utf8");
        shot = { kind: "terminal", out: txtOut, taken: true };
      }
      captureFacts.push({
        kind: shot.kind,
        out: shot.out,
        taken: shot.taken,
        ...(shot.skipped !== undefined ? { skipped: shot.skipped } : {}),
      });
      const ref = screenshotEvidenceRef(shot, `screenshots/${refStem}`);
      if (ref !== null) selfCaptures.push(ref);
      else warn(`terminal self-capture skipped (${refStem}): ${shot.skipped ?? "unknown"}`);
    }
  }
  // FIX-339 (复核 #1): record a terminal skip fact for each REJECTED deliverable_cmd
  // (allowlist refusal). The command is never run — this only留痕 the refusal so
  // the report discloses it and the gate fails loud.
  for (let si = 0; si < captureCommandSkips.length; si += 1) {
    const reason = captureCommandSkips[si] ?? "";
    if (reason === "") continue;
    captureFacts.push({
      kind: "terminal",
      out: join(runDir, "screenshots", si === 0 ? "terminal-rejected.png" : `terminal-rejected-${si}.png`),
      taken: false,
      skipped: reason,
    });
    warn(`deliverable_cmd refused (allowlist): ${reason}`);
  }

  // FIX-305 — UI/dossier web self-capture lane. For a card whose acceptance is a
  // rendered page (the dossier story page, or any url/file the Gate supplies),
  // attest must CAPTURE a real screenshot rather than machine-skip. We drive the
  // FIX-291 web ladder: a macOS GUI host shoots a real browser window, and a
  // headless host (CI / network-only loop runner) falls through to headless
  // Chromium — NO GUI required — producing an unforgeable PNG. Only an honest
  // failure (ROLL_ATTEST_NO_BROWSER, no url, npx/network down) yields a recorded
  // skip; for a reachable web/dossier page the capture succeeds.
  const realWebs = captureWebs.filter((u) => u !== "");
  if (realWebs.length > 0) {
    mkdirSync(join(runDir, "screenshots"), { recursive: true });
    // FIX-339 (AC1): capture EACH declared deliverable_url. Distinct stems
    // web.png / web-1.png / … so a multi-surface card never overwrites a shot.
    for (let wi = 0; wi < realWebs.length; wi += 1) {
      const stem = wi === 0 ? "web.png" : `web-${wi}.png`;
      const out = join(runDir, "screenshots", stem);
      const shot = await captureScreenshot(
        {
          kind: "web",
          out,
          url: realWebs[wi] as string,
          ...(captureBrowser !== undefined && captureBrowser !== "" ? { browser: captureBrowser } : {}),
          ...(captureRegion !== undefined ? { region: captureRegion } : {}),
        },
        deps.capture ?? {},
      );
      captureFacts.push({
        kind: shot.kind,
        out: shot.out,
        taken: shot.taken,
        ...(shot.skipped !== undefined ? { skipped: shot.skipped } : {}),
      });
      const ref = screenshotEvidenceRef(shot, `screenshots/${stem}`);
      if (ref !== null) selfCaptures.push(ref);
      else warn(`web self-capture skipped (${stem}): ${shot.skipped ?? "unknown"}`);
    }
  } else if (captureWebSkip !== undefined && captureWebSkip !== "") {
    // FIX-321: honest recorded web skip — no deliverable target declared. NO
    // browser, NO hollow dossier shot. taken:false + a reason makes the visual
    // floor satisfiable (hasMachineCaptureSkip) while disclosing the gap.
    captureFacts.push({ kind: "web", out: join(runDir, "screenshots", "web.png"), taken: false, skipped: captureWebSkip });
    warn(`web self-capture skipped: ${captureWebSkip}`);
  }

  // hard facts.
  const manifest = await collectEvidence({
    storyId,
    projectPath,
    runDir,
    ...(deployUrl !== undefined ? { deployUrl } : {}),
    now: () => now.toISOString(),
    ...(deps.run !== undefined ? { run: deps.run } : {}),
    ...(deps.ghProbe !== undefined ? { ghProbe: deps.ghProbe } : {}),
    captures: captureFacts,
    captureCommand: commandFact,
  });
  writeEvidenceJson(manifest, runDir);

  // intent map (AI layer) → report items; absent ⇒ honest all-Claimed.
  // Read-compat (US-META-001): prefer the card folder, fall back to the legacy
  // `verification/<ID>/` dir so a card whose Gate still writes there is honoured
  // until US-META-002 migrates the write side of the skill.
  const acMap = readAcMap(storyDir) ?? readAcMap(join(projectPath, ".roll", "verification", storyId));
  const siblingBases = runDirHasEvidence(runDir) ? [] : siblingRunDirs(storyDir, runDir);
  const items: AcReportItem[] = acItems.map((ac) => {
    const mapped = acMap?.get(ac.id);
    const status: AcStatus =
      mapped?.status !== undefined && (STATUSES as readonly string[]).includes(mapped.status)
        ? (mapped.status as AcStatus)
        : "claimed";
    const evidence = (mapped?.evidence ?? [])
      .map((e) => toRef(runDir, storyDir, e, siblingBases))
      .filter((x): x is EvidenceRef => x !== null);
    return {
      id: ac.id,
      text: ac.text,
      status,
      evidence,
      ...(mapped?.note !== undefined ? { note: mapped.note } : {}),
    };
  });

  const age = manifest.test_pass.present
    ? manifest.test_pass.age_seconds >= 0
      ? `${manifest.test_pass.age_seconds}s ago`
      : "present"
    : "absent";
  const reviewScores = readReviewScores(projectPath, storyId, runDir);
  const reviewScoreTrend = readReviewScoreTrend(projectPath);
  // US-ATTEST-013 — self-contained card context + before/after comparison.
  const context = buildCardContext(projectPath, featureFile, storyId, process.env);
  const beforeAfter = detectBeforeAfter(runDir);
  const afterOnly = detectAfterOnly(runDir);
  const docGap = detectDocGap(projectPath);
  // US-ATTEST-014 — reverse-look up the delivering cycle and inline its process
  // archive (timeline + signal layer + bounded, redacted transcript). Degrades
  // gracefully: hand-delivered / no-data cards yield undefined (section trimmed).
  const processReaders = deps.process ?? defaultProcessReaders(projectPath, process.env);
  let processArchive: ProcessArchive | undefined;
  try {
    processArchive = buildProcessArchive(storyId, processReaders);
  } catch {
    warn("process archive build failed — report omits the process trace");
    processArchive = undefined;
  }
  const html = renderReport({
    storyId,
    title: `${storyId} — Acceptance Evidence`,
    generatedAt: now.toISOString(),
    items,
    facts: { tcrCount: manifest.tcr_commits.length, ciConclusion: manifest.ci.conclusion, testPassAge: age },
    ...(context !== undefined ? { context } : {}),
    ...(beforeAfter.length > 0 ? { beforeAfter } : {}),
    ...(processArchive !== undefined ? { process: processArchive } : {}),
    ...(docGap !== undefined ? { docGap } : {}),
    ...(reviewScores.length > 0 ? { reviewScores } : {}),
    ...(reviewScoreTrend !== undefined ? { reviewScoreTrend } : {}),
    ...(selfCaptures.length > 0 ? { selfCaptures } : {}),
    ...(captureFacts.some((x) => !x.taken && x.skipped !== undefined)
      ? { captureSkips: captureFacts.filter((x) => !x.taken && x.skipped !== undefined).map((x) => ({ kind: x.kind, out: x.out, skipped: x.skipped ?? "" })) }
      : {}),
    ...((() => { const d = plannedVsDeliveredEvidence(projectPath, storyId); return d !== "" ? { evidenceDeltaSummary: d } : {}; })()),
  });
  // US-META-001: report carries the card id (`<ID>-report.html`) so a tab /
  // download / share is self-identifying.
  const reportPath = join(runDir, reportFileName(storyId));
  writeFileSync(reportPath, html);

  // latest symlink (replace — rm is force-tolerant of absence).
  const latest = join(storyDir, "latest");
  try {
    rmSync(latest, { force: true });
    symlinkSync(relativeFromPhysical(storyDir, runDir), latest);
  } catch {
    warn("latest symlink update failed (report still written)");
  }

  // US-META-006: update index.html delivery section if the skeleton exists.
  const indexPath = join(storyDir, "index.html");
  if (existsSync(indexPath)) {
    try {
      const runRel = relativeFromPhysical(storyDir, runDir).replace(/\\/g, "/");
      const reportRel = join(runRel, reportFileName(storyId)).replace(/\\/g, "/");
      const deliveryHtml =
        `<p><a href="${reportRel}">${bi("Attestation report", "验收报告")}</a></p>\n` +
        dossierVisualsHtml(runRel, beforeAfter, afterOnly) +
        `<p class="muted">${bi("Delivered", "交付于")} ${new Date().toISOString().slice(0, 10)}</p>\n`;
      const idx = markPhaseDone(readFileSync(indexPath, "utf8"), "delivery", deliveryHtml);
      writeFileSync(indexPath, idx, "utf8");
    } catch {
      /* best-effort: index.html update is non-blocking */
    }
  }

  // Render smoke (US-ATTEST-012): the report exists — but is it actually
  // openable? A broken <img> ref or an external CDN asset is a real defect, so
  // (unlike the never-block degrade path) a smoke failure is surfaced as a
  // NON-ZERO exit. The report file stays on disk — evidence is never discarded.
  const smoke = smokeCheckReport(html, (rel) => existsSync(join(runDir, rel)));
  process.stdout.write(`Acceptance report written\n验收报告已生成\n  ${relative(projectPath, reportPath)}\n`);
  // US-META-009: archive self-heal — a fresh report changes the dossier's
  // truth, so refresh the ID→epic index right here (best-effort, never blocks
  // the evidence path). Projects that never ran `roll index` converge on
  // their first attest instead of drifting (SoloGo shape).
  try {
    generateIndex(projectPath);
  } catch {
    /* never block the evidence path */
  }
  // FIX-231: same truth change must reach the board's aggregate pages (front +
  // epic) — without this the new report is invisible until a manual `roll
  // index`. Mounted story pages are never clobbered (US-DOSSIER-007).
  refreshAggregates(projectPath);
  if (!smoke.ok) {
    for (const p of smoke.problems) warn(`render smoke: ${p}`);
    return 2;
  }
  if (commandFact !== null && commandFact.exitCode !== 0) {
    warn(`capture command failed with exit ${commandFact.exitCode}`);
    return 3;
  }
  return 0;
}
