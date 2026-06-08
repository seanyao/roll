/**
 * US-ATTEST-006 — `roll attest <story-id>`: compose the five-piece evidence
 * chain into one acceptance report.
 *
 *   AC parser (core)      → structured AC items from .roll/features/**
 *   evidence collector    → evidence.json hard facts (infra, injectable seams)
 *   ANSI→HTML + renderer  → single-file report.html (core, pure)
 *   screenshots           → CONSUMED if present in the run dir; this command
 *                           never captures (the skill drives the dispatcher —
 *                           AI owns intent, D7)
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
  type EvidenceRef,
  type ProcessArchive,
  type RunRow,
} from "@roll/core";
import type { RollEvent } from "@roll/spec";
import {
  captureScreenshot,
  collectEvidence,
  openEvidenceFrame,
  redactSecrets,
  screenshotEvidenceRef,
  writeEvidenceJson,
  type EvidenceRun,
  type ScreenshotDeps,
} from "@roll/infra";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative } from "node:path";
import { cardArchiveDir, epicFromFeaturePath, findFeatureFile, generateIndex, reportFileName } from "../lib/archive.js";
import { markPhaseDone } from "../lib/story-page.js";

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
}

/** Default readers over `<runtimeDir>/{runs.jsonl,events.ndjson,cycle-logs/}`. */
function defaultProcessReaders(projectPath: string, env: Record<string, string | undefined>): ProcessReaders {
  const rt = (env.ROLL_PROJECT_RUNTIME_DIR ?? "").trim() || join(projectPath, ".roll", "loop");
  // Reuse the event bus's read side — it already parses runs.jsonl / events.ndjson
  // and returns [] for a missing file (readText → "" on absence), no throw.
  const bus = new EventBus();
  const logPath = (cid: string): string => join(rt, "cycle-logs", `${cid}.agent.log`);
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

function warn(msg: string): void {
  process.stderr.write(`[roll] attest WARN: ${msg}\n`);
}

interface AcMapEntry {
  ac: string;
  status?: string;
  note?: string;
  evidence?: Array<{ kind?: string; label?: string; href?: string; textFile?: string }>;
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

function toRef(runDir: string, e: NonNullable<AcMapEntry["evidence"]>[number]): EvidenceRef | null {
  const kind = (e.kind ?? "") as EvidenceRef["kind"];
  const label = e.label ?? kind;
  if (kind === "text" && e.textFile !== undefined) {
    const p = join(runDir, e.textFile);
    if (!existsSync(p)) return null;
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
  if (["screenshot", "commit", "ci", "deploy", "test-pass"].includes(kind)) {
    return e.href !== undefined ? { kind, label, href: e.href } : { kind, label };
  }
  return null;
}

/**
 * US-ATTEST-009 — same-story Self-Score entries from `.roll/notes/`:
 * `YYYY-MM-DD-<skill>-<STORY>-<ts>.md` with YAML frontmatter
 * {skill, story, score, verdict, ts} + a prose body. Tolerant reader: files
 * that fail to parse are skipped; no notes ⇒ empty list ⇒ block skipped.
 */
export function readSelfScores(
  projectPath: string,
  storyId: string,
): Array<{ skill: string; score: number; verdict: string; ts: string; note: string }> {
  const dir = join(projectPath, ".roll", "notes");
  if (!existsSync(dir)) return [];
  const out: Array<{ skill: string; score: number; verdict: string; ts: string; note: string }> = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith(".md") && f.includes(`-${storyId}-`));
  } catch {
    return [];
  }
  for (const name of names.sort()) {
    try {
      const text = readFileSync(join(dir, name), "utf8");
      const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
      if (!m) continue;
      const fm = new Map<string, string>();
      for (const line of (m[1] ?? "").split("\n")) {
        const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line.trim());
        if (kv?.[1] !== undefined) fm.set(kv[1], (kv[2] ?? "").trim());
      }
      if (fm.get("story") !== storyId) continue;
      const score = Number(fm.get("score") ?? "");
      out.push({
        skill: fm.get("skill") ?? basename(name),
        score: Number.isFinite(score) ? score : 0,
        verdict: fm.get("verdict") ?? "",
        ts: fm.get("ts") ?? "",
        note: (m[2] ?? "").trim().slice(0, 300),
      });
    } catch {
      /* tolerant reader */
    }
  }
  return out;
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

const USAGE = [
  "Usage: roll attest <story-id> [--deploy-url <url>] [--run-dir <path>]",
  "                   [--capture-terminal | --capture-tmux <session> | --capture-command <cmd>]",
  "                   [--capture-region <x,y,w,h>]",
  "  --capture-tmux <session>   self-capture a terminal attached to a tmux session (unattended Gate)",
  "  --capture-command <cmd>    self-capture a terminal running <cmd>",
  "  --capture-region <rect>    screencapture -R rectangle (default 0,0,1280,800)",
  "  (terminal lane honestly skips off-GUI / without screen-recording permission)",
].join("\n");

/** `roll attest <story-id> [--deploy-url <url>] [--capture-tmux <s> | --capture-command <c>]` */
export async function attestCommand(args: string[], deps: AttestDeps = {}): Promise<number> {
  const flagsWithValue = new Set(["--deploy-url", "--run-dir", "--capture-tmux", "--capture-command", "--capture-region"]);
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
  const deployUrl = flagVal("--deploy-url");
  const explicitRunDir = flagVal("--run-dir");
  const envRunDir = (process.env["ROLL_RUN_DIR"] ?? "").trim();
  const providedRunDir =
    explicitRunDir !== undefined && explicitRunDir !== "" ? explicitRunDir : envRunDir !== "" ? envRunDir : undefined;
  // US-ATTEST-011 — unattended terminal self-capture lane. Driven by the Gate
  // session in a headless cycle; on a non-GUI / no-permission host the lane
  // honestly skips and the report drops the self-capture block (no placeholder).
  const captureTmux = flagVal("--capture-tmux");
  const captureCommand = flagVal("--capture-command");
  const captureRegion = flagVal("--capture-region");
  const captureTerminal = args.includes("--capture-terminal") || captureTmux !== undefined || captureCommand !== undefined;

  const projectPath = process.cwd();
  const featureFile = findFeatureFile(projectPath, storyId);
  if (featureFile === null) {
    process.stderr.write(`[roll] attest: story ${storyId} not found under .roll/features/\n`);
    process.stderr.write(`[roll] attest：在 .roll/features/ 下找不到 ${storyId}\n`);
    return 1;
  }

  // US-ATTEST-012: an ID-named card file (`<storyId>.md`) owns its whole body —
  // a `##` heading that merely names another card can't hijack the trailing AC
  // (FIX-214 实案). Content-matched files keep ordinary section attribution.
  const fileOwned = basename(featureFile) === `${storyId}.md`;
  const acItems = acForStory(readFileSync(featureFile, "utf8"), storyId, { fileOwned });
  if (acItems.length === 0) warn(`no **AC:** block for ${storyId} — report will carry facts only`);

  // run dir + latest symlink (never overwrite history).
  const now = (deps.now ?? ((): Date => new Date()))();
  const p2 = (n: number): string => String(n).padStart(2, "0");
  const generatedRunId = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}T${p2(now.getHours())}-${p2(now.getMinutes())}-${p2(now.getSeconds())}`;
  // US-META-001: deliverables land in the card folder `features/<epic>/<ID>/`
  // (epic via the backlog-generated index, uncategorized fallback). Runs never
  // overwrite history; `latest` symlinks the newest.
  const storyDir = cardArchiveDir(projectPath, storyId);
  const runDir = providedRunDir ?? join(storyDir, generatedRunId);
  openEvidenceFrame({ runDir });

  // terminal self-capture (US-ATTEST-011): drive the dispatcher's terminal lane
  // into this run's screenshots/ BEFORE evidence sweep, then bridge a TAKEN shot
  // to a report figure. A SKIP (headless / no permission) yields null → the
  // self-capture block is dropped entirely (deletion-not-placeholder).
  let selfCaptures: EvidenceRef[] = [];
  if (captureTerminal) {
    mkdirSync(join(runDir, "screenshots"), { recursive: true });
    const shot = await captureScreenshot(
      {
        kind: "terminal",
        out: join(runDir, "screenshots", "terminal.png"),
        ...(captureTmux !== undefined ? { tmux: captureTmux } : {}),
        ...(captureCommand !== undefined ? { command: captureCommand } : {}),
        ...(captureRegion !== undefined ? { region: captureRegion } : {}),
      },
      deps.capture ?? {},
    );
    const ref = screenshotEvidenceRef(shot, "screenshots/terminal.png");
    if (ref !== null) selfCaptures = [ref];
    else warn(`terminal self-capture skipped: ${shot.skipped ?? "unknown"}`);
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
  });
  writeEvidenceJson(manifest, runDir);

  // intent map (AI layer) → report items; absent ⇒ honest all-Claimed.
  // Read-compat (US-META-001): prefer the card folder, fall back to the legacy
  // `verification/<ID>/` dir so a card whose Gate still writes there is honoured
  // until US-META-002 migrates the write side of the skill.
  const acMap = readAcMap(storyDir) ?? readAcMap(join(projectPath, ".roll", "verification", storyId));
  const items: AcReportItem[] = acItems.map((ac) => {
    const mapped = acMap?.get(ac.id);
    const status: AcStatus =
      mapped?.status !== undefined && (STATUSES as readonly string[]).includes(mapped.status)
        ? (mapped.status as AcStatus)
        : "claimed";
    const evidence = (mapped?.evidence ?? [])
      .map((e) => toRef(runDir, e))
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
  const selfScores = readSelfScores(projectPath, storyId);
  // US-ATTEST-013 — self-contained card context + before/after comparison.
  const context = buildCardContext(projectPath, featureFile, storyId, process.env);
  const beforeAfter = detectBeforeAfter(runDir);
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
    ...(selfScores.length > 0 ? { selfScores } : {}),
    ...(selfCaptures.length > 0 ? { selfCaptures } : {}),
  });
  // US-META-001: report carries the card id (`<ID>-report.html`) so a tab /
  // download / share is self-identifying.
  const reportPath = join(runDir, reportFileName(storyId));
  writeFileSync(reportPath, html);

  // latest symlink (replace — rm is force-tolerant of absence).
  const latest = join(storyDir, "latest");
  try {
    rmSync(latest, { force: true });
    symlinkSync(relative(storyDir, runDir), latest);
  } catch {
    warn("latest symlink update failed (report still written)");
  }

  // US-META-006: update index.html delivery section if the skeleton exists.
  const indexPath = join(storyDir, "index.html");
  if (existsSync(indexPath)) {
    try {
      const reportRel = join(relative(storyDir, runDir), reportFileName(storyId));
      const deliveryHtml =
        `<p><a href="${reportRel}">${bi("Attestation report", "验收报告")}</a></p>\n` +
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
  if (!smoke.ok) {
    for (const p of smoke.problems) warn(`render smoke: ${p}`);
    return 2;
  }
  return 0;
}
