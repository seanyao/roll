import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { cardArchiveDir } from "./archive.js";

export type SelfScoreVerdict = "good" | "ok" | "regression" | string;
export const SELF_SCORE_LOW_THRESHOLD = 5;

export interface SelfScoreView {
  skill: string;
  score: number;
  verdict: SelfScoreVerdict;
  ts: string;
  note: string;
  href?: string;
  dimensions?: Record<string, number>;
}

export interface SelfScoreEntry extends SelfScoreView {
  story: string;
  sourcePath: string;
  dimensions: Record<string, number>;
}

export interface SelfScoreGateCheck {
  status: "pass" | "missing" | "regression" | "low";
  reason: string;
  entry?: SelfScoreEntry;
}

interface NoteCandidate {
  name: string;
  path: string;
}

const BASE_KEYS = new Set(["skill", "story", "score", "verdict", "ts", "timestamp"]);

function hrefFrom(fromDir: string | undefined, path: string): string | undefined {
  if (fromDir === undefined || fromDir === "") return undefined;
  const rel = relative(fromDir, path).replace(/\\/g, "/");
  return rel === "" ? basename(path) : rel;
}

function parseFields(text: string): { fields: Array<{ key: string; value: string }>; body: string } {
  const fm = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  const fieldText = fm?.[1] ?? text;
  const body = fm?.[2] ?? text;
  const fields: Array<{ key: string; value: string }> = [];
  for (const line of fieldText.split("\n")) {
    const m = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line.trim());
    if (m?.[1] === undefined) continue;
    fields.push({ key: m[1], value: (m[2] ?? "").trim().replace(/^["']|["']$/g, "") });
  }
  return { fields, body };
}

function field(fields: Array<{ key: string; value: string }>, key: string): string | undefined {
  const found = fields.find((f) => f.key.toLowerCase() === key);
  return found?.value;
}

function noteParagraph(body: string): string {
  for (const para of body.split(/\n{2,}/)) {
    const trimmed = para.trim();
    if (trimmed === "" || trimmed === "---") continue;
    const lines = trimmed.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    if (lines.length === 0) continue;
    if (lines.every((l) => /^[A-Za-z0-9_.-]+:\s*/.test(l))) continue;
    return trimmed.replace(/\s+/g, " ").slice(0, 300);
  }
  return "";
}

function dimensions(fields: Array<{ key: string; value: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fields) {
    const k = f.key.toLowerCase();
    if (BASE_KEYS.has(k)) continue;
    const n = Number(f.value);
    if (!Number.isFinite(n)) continue;
    out[f.key.replace(/_/g, "-")] = n;
  }
  return out;
}

export function parseSelfScoreNote(
  text: string,
  sourcePath: string,
  expectedStory?: string,
  hrefFromDir?: string,
): SelfScoreEntry | null {
  const { fields, body } = parseFields(text);
  const score = Number(field(fields, "score") ?? "");
  if (!Number.isFinite(score)) return null;
  const story = field(fields, "story") ?? expectedStory ?? "";
  if (expectedStory !== undefined && story !== "" && story !== expectedStory) return null;
  const href = hrefFrom(hrefFromDir, sourcePath);
  return {
    skill: field(fields, "skill") ?? basename(sourcePath),
    story: story === "" ? expectedStory ?? "" : story,
    score,
    verdict: field(fields, "verdict") ?? "",
    ts: field(fields, "ts") ?? field(fields, "timestamp") ?? "",
    note: noteParagraph(body),
    sourcePath,
    dimensions: dimensions(fields),
    ...(href !== undefined ? { href } : {}),
  };
}

function readCandidates(
  candidates: NoteCandidate[],
  expectedStory: string | undefined,
  hrefFromDir: string | undefined,
): SelfScoreEntry[] {
  const out: SelfScoreEntry[] = [];
  for (const c of candidates.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.path < b.path ? -1 : 1))) {
    try {
      const parsed = parseSelfScoreNote(readFileSync(c.path, "utf8"), c.path, expectedStory, hrefFromDir);
      if (parsed !== null) out.push(parsed);
    } catch {
      /* tolerant reader */
    }
  }
  return out;
}

function noteCandidates(dir: string, storyId?: string): NoteCandidate[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md") && (storyId === undefined || name.includes(`-${storyId}-`)))
      .map((name) => ({ name, path: join(dir, name) }));
  } catch {
    return [];
  }
}

export function readStorySelfScores(projectPath: string, storyId: string, hrefFromDir?: string): SelfScoreEntry[] {
  const cardNotes = join(cardArchiveDir(projectPath, storyId), "notes");
  const card = readCandidates(noteCandidates(cardNotes), storyId, hrefFromDir);
  if (card.length > 0) return card;
  return readCandidates(noteCandidates(join(projectPath, ".roll", "notes"), storyId), storyId, hrefFromDir);
}

export function readAllSelfScores(projectPath: string): SelfScoreEntry[] {
  return readCandidates(allSelfScoreCandidates(projectPath), undefined, undefined);
}

export function readLatestStorySelfScore(projectPath: string, storyId: string, hrefFromDir?: string): SelfScoreEntry | undefined {
  const entries = readStorySelfScores(projectPath, storyId, hrefFromDir);
  return entries[entries.length - 1];
}

function allSelfScoreCandidates(projectPath: string): NoteCandidate[] {
  const out = noteCandidates(join(projectPath, ".roll", "notes"));
  const featuresDir = join(projectPath, ".roll", "features");
  try {
    for (const epic of readdirSync(featuresDir, { withFileTypes: true })) {
      if (!epic.isDirectory()) continue;
      for (const card of readdirSync(join(featuresDir, epic.name), { withFileTypes: true })) {
        if (!card.isDirectory()) continue;
        out.push(...noteCandidates(join(featuresDir, epic.name, card.name, "notes")));
      }
    }
  } catch {
    /* features dir absent */
  }
  return out;
}

export function readSelfScoreTrend(projectPath: string, windowN = 14): string | undefined {
  const entries = readCandidates(allSelfScoreCandidates(projectPath), undefined, undefined).slice(-windowN);
  if (entries.length === 0) return undefined;
  let total = 0;
  let min = 11;
  let redo = 0;
  for (const e of entries) {
    total += e.score;
    if (e.score < min) min = e.score;
    const verdict = e.verdict.toLowerCase();
    if (verdict === "regression") redo += 1;
    else if (verdict === "ok" && e.score <= SELF_SCORE_LOW_THRESHOLD) redo += 1;
  }
  if (entries.length < 3) return `self-score: (n/a) — ${entries.length} sample(s), need 3 (last ${windowN})`;
  const mean = total / entries.length;
  return `self-score: mean ${mean.toFixed(1)} / min ${min} / redo ${redo} (last ${windowN})`;
}

export function evaluateSelfScoreGate(projectPath: string, storyId: string): SelfScoreGateCheck {
  const latest = readLatestStorySelfScore(projectPath, storyId);
  if (latest === undefined) return { status: "missing", reason: `missing self-score note for ${storyId}` };
  const verdict = latest.verdict.toLowerCase();
  if (verdict === "regression") {
    return { status: "regression", reason: `self-score regression ${latest.score}/10 blocks Done`, entry: latest };
  }
  if (verdict === "ok" && latest.score <= SELF_SCORE_LOW_THRESHOLD) {
    return {
      status: "low",
      reason: `low self-score ok ${latest.score}/10 marks partial + Discrepancy`,
      entry: latest,
    };
  }
  return { status: "pass", reason: `self-score ${latest.verdict} ${latest.score}/10 present`, entry: latest };
}
