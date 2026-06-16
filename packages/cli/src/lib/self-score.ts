import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { cardArchiveDir, epicForStory } from "./archive.js";

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
  /** US-PAIR-009 / US-DOSSIER-019 provenance: "pair" when a heterogeneous peer
   *  scored this delivery, "self" (or absent ⇒ self) when the working agent did.
   *  Drives the dossier's pair-score-first vs self-score-fallback rendering. */
  scoring?: "pair" | "self";
  /** The agent that produced a pair score (US-PAIR-009 `scored-by:`). */
  scoredBy?: string;
  /** FIX-343 (step ④) — the reviewer's fresh session/cast id (`session-id:`),
   *  so "an independent fresh session scored this" is VERIFIABLE, not asserted. */
  sessionId?: string;
  /** Why a pair score fell back to self (US-PAIR-010 `fallback-reason:`); only
   *  present on a self-score note that recorded the fallback explicitly. */
  fallbackReason?: string;
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
  // US-PAIR-009 / US-DOSSIER-019 provenance from the note frontmatter: a
  // `scoring: pair` note (with `scored-by:`) means a heterogeneous peer graded
  // this delivery; otherwise it is a self-score (the working agent's own note).
  const scoringRaw = (field(fields, "scoring") ?? "").toLowerCase();
  const scoring = scoringRaw === "pair" ? "pair" : scoringRaw === "self" ? "self" : undefined;
  const scoredBy = field(fields, "scored-by");
  const sessionId = field(fields, "session-id");
  const fallbackReason = field(fields, "fallback-reason");
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
    ...(scoring !== undefined ? { scoring } : {}),
    ...(scoredBy !== undefined && scoredBy !== "" ? { scoredBy } : {}),
    ...(sessionId !== undefined && sessionId !== "" ? { sessionId } : {}),
    ...(fallbackReason !== undefined && fallbackReason !== "" ? { fallbackReason } : {}),
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

/**
 * FIX-343 (step ③, OWNER B-decision) — the independent-peer selector the gate
 * honors. Independence is verified by SESSION ID, never by vendor name: the
 * boundary is "a FRESH session that does NOT share the builder's session/context"
 * (a sub-agent spawned inside the builder's session shares its context and is NOT
 * independent; a separately-spawned fresh process — even same agent+model — IS).
 *
 * FILTER to a peer-sourced note that is provably an INDEPENDENT fresh session:
 *   - `scoring === "pair"` (peer protocol, not a self note),
 *   - a non-empty `scoredBy` (the scorer is recorded),
 *   - a non-empty `sessionId` (the scorer's fresh session id is recorded), AND
 *   - `sessionId !== builderSessionId` (NOT the builder's own session/sub-agent).
 * THEN pick the latest — filter-then-latest so a self / legacy / stale note can
 * NEVER shadow the real independent peer note.
 *
 * The vendor-name `scoredBy !== buildingAgent` comparison is DROPPED entirely:
 * it deadlocked single-vendor installs (builder=claude, scorer=claude under a
 * fresh session was a valid same-vendor independent score, yet the old gate
 * rejected its own valid peer score → every claude-route delivery hard-failed).
 *
 * Returns undefined when no qualifying independent fresh-session peer note
 * exists ⇒ the gate fails loud ("missing peer review score").
 */
export function readLatestStoryPeerScore(
  projectPath: string,
  storyId: string,
  builderSessionId: string,
  hrefFromDir?: string,
): SelfScoreEntry | undefined {
  const builderSession = builderSessionId.trim();
  const peers = readStorySelfScores(projectPath, storyId, hrefFromDir).filter(
    (e) =>
      e.scoring === "pair" &&
      e.scoredBy !== undefined &&
      e.scoredBy.trim() !== "" &&
      e.sessionId !== undefined &&
      e.sessionId.trim() !== "" &&
      // INDEPENDENCE INVARIANT: the scorer's fresh session is NOT the builder's
      // own session (and so not a sub-agent sharing the builder's context). An
      // empty builderSession (builder not yet recorded) never EQUALS a non-empty
      // recorded session, so a real recorded peer note still qualifies; a note
      // whose session id matches the builder's is rejected as self-scoring.
      e.sessionId.trim() !== builderSession,
  );
  return peers[peers.length - 1];
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

// ─── FIX-274: TS-native writer ───────────────────────────────────────────────
// The v2 contract had agents `source "$(command -v roll)"` to reach a bash
// helper; v3's `roll` is a bundled TS CLI and cannot be sourced. This writer is
// the replacement path. It emits the exact note shape the readers above (and
// dossier / attest gate / dashboard trend) already parse.

export const SELF_SCORE_VERDICTS = ["good", "ok", "regression"] as const;

export interface SelfScoreWriteInput {
  skill: string;
  story: string;
  score: number;
  verdict: (typeof SELF_SCORE_VERDICTS)[number];
  rationale: string;
  /** ISO timestamp; defaults to now. Same skill/story/ts payload re-runs are idempotent. */
  ts?: string;
  /** US-PAIR-009 provenance: the agent that produced the score (pair scoring). */
  scoredBy?: string;
  /** FIX-343 (step ④): the reviewer's fresh session/cast id, recorded as
   *  `session-id:` so the independence of the scoring session is verifiable. */
  sessionId?: string;
  /** "pair" when a heterogeneous peer scored; defaults to "self". */
  scoring?: "pair" | "self";
  /** Why pair scoring fell back to self (recorded in the note for audit).
   *  Production writer: the manual `roll pair score` fallback path (US-PAIR-010);
   *  the loop's fallback keeps the agent's own note untouched and audits the
   *  reason via the pair:none-available event instead. */
  fallbackReason?: string;
}

export interface SelfScoreWriteResult {
  path: string;
  /** false when an identical note already existed (idempotent retry). */
  written: boolean;
}

/**
 * Note home: the card folder when the story's card exists
 * (`features/<epic>/<ID>/notes/`, US-META-008), else `.roll/notes/` for
 * design/session-level notes that are not card-owned.
 */
function selfScoreNoteDir(projectPath: string, storyId: string): string {
  const epic = epicForStory(projectPath, storyId);
  if (epic !== null && existsSync(cardArchiveDir(projectPath, storyId))) {
    return join(cardArchiveDir(projectPath, storyId), "notes");
  }
  return join(projectPath, ".roll", "notes");
}

export function writeSelfScoreNote(projectPath: string, input: SelfScoreWriteInput): SelfScoreWriteResult {
  if (!existsSync(join(projectPath, ".roll"))) {
    throw new Error(`self-score: ${projectPath} is not a roll project (no .roll/) — run from the main project root`);
  }
  const skill = input.skill.trim();
  if (skill === "") throw new Error("self-score: skill must be non-empty");
  const story = input.story.trim();
  if (story === "") throw new Error("self-score: story must be non-empty");
  if (!Number.isInteger(input.score) || input.score < 1 || input.score > 10) {
    throw new Error(`self-score: score must be an integer 1..10, got ${input.score}`);
  }
  if (!SELF_SCORE_VERDICTS.includes(input.verdict)) {
    throw new Error(`self-score: verdict must be one of ${SELF_SCORE_VERDICTS.join("|")}, got ${input.verdict}`);
  }
  const rationale = input.rationale.trim();
  if (rationale === "") throw new Error("self-score: rationale must be non-empty");
  const explicitTs = input.ts !== undefined;
  const ts = input.ts ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  let epochSec = Math.floor(Date.parse(ts) / 1000);
  if (!Number.isFinite(epochSec)) throw new Error(`self-score: invalid ts ${ts}`);

  const dir = selfScoreNoteDir(projectPath, story);
  // Idempotency: an existing note for the same skill/story/ts is either the
  // same payload (retry → reuse) or a contradiction (→ fail loud). A retry
  // usually arrives WITHOUT the original ts (the agent just re-runs the
  // command), so an identical skill/story/score/verdict/rationale note also
  // counts as the same write, whatever its timestamp.
  const rationaleKey = rationale.replace(/\s+/g, " ").slice(0, 300);
  for (const c of noteCandidates(dir, story)) {
    const raw = readFileSync(c.path, "utf8");
    const prior = parseSelfScoreNote(raw, c.path, story);
    if (prior === null || prior.skill !== skill) continue;
    const samePayload = prior.score === input.score && prior.verdict === input.verdict;
    // codex pair-review: a retry that NOW carries an audit field the prior note
    // lacks (fallback-reason) is not the same write — reusing would lose the audit.
    const sameProvenance =
      (input.fallbackReason === undefined || raw.includes(`fallback-reason: ${input.fallbackReason.trim()}`)) &&
      (input.scoredBy === undefined || raw.includes(`scored-by: ${input.scoredBy.trim()}`));
    if (samePayload && sameProvenance && (prior.ts === ts || prior.note === rationaleKey)) {
      return { path: c.path, written: false };
    }
    // A contradiction needs an identity claim: only an EXPLICIT same-ts write
    // with a different payload is rejected. Default-ts writes landing in the
    // same second are just consecutive notes (the rescore-after-review path).
    if (!explicitTs || prior.ts !== ts) continue;
    throw new Error(
      `self-score: contradicting note for ${skill}/${story}@${ts} already exists at ${c.path} ` +
        `(${prior.verdict} ${prior.score} vs ${input.verdict} ${input.score})`,
    );
  }

  const date = ts.slice(0, 10);
  let path = join(dir, `${date}-${skill}-${story}-${epochSec}.md`);
  while (existsSync(path)) {
    epochSec += 1; // same-second sibling note: keep filenames unique
    path = join(dir, `${date}-${skill}-${story}-${epochSec}.md`);
  }
  const scoring = input.scoring ?? "self";
  const text = [
    "---",
    `skill: ${skill}`,
    `story: ${story}`,
    `score: ${input.score}`,
    `verdict: ${input.verdict}`,
    `ts: ${ts}`,
    // US-PAIR-009 provenance: who scored, and why a pair score fell back to self.
    // Readers tolerate the extra string fields (non-numeric → not a dimension).
    `scoring: ${scoring}`,
    ...(input.scoredBy !== undefined ? [`scored-by: ${input.scoredBy.trim()}`] : []),
    // FIX-343 (step ④): the reviewer's fresh session/cast id — independence is
    // recorded, not just asserted.
    ...(input.sessionId !== undefined && input.sessionId.trim() !== "" ? [`session-id: ${input.sessionId.trim()}`] : []),
    ...(input.fallbackReason !== undefined ? [`fallback-reason: ${input.fallbackReason.trim()}`] : []),
    "---",
    "",
    rationale,
    "",
  ].join("\n");
  mkdirSync(dir, { recursive: true });
  // Complete-file write: land on a tmp name, then rename into place so readers
  // never observe partial YAML. The tmp name embeds the unique target basename,
  // so concurrent writers for different stories cannot collide.
  const tmp = join(dir, `.${date}-${skill}-${story}-${epochSec}.md.tmp`);
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
  return { path, written: true };
}

/**
 * FIX-343 (step ③, OWNER B-decision) — the attest gate's quality-score check.
 * The gate honors ONLY an INDEPENDENT fresh-session PEER score:
 * `readLatestStoryPeerScore` filters to a `scoring === "pair"` note that records
 * a `scoredBy` AND a `sessionId`, with `sessionId !== builderSessionId` (the
 * scorer ran in a separate fresh session, NOT the builder's own session / a
 * sub-agent sharing its context), THEN picks the latest. Rejected → `missing`
 * with the fail-loud reason "missing peer review score" so the cycle blocks (no
 * synthesized pass):
 *   - a self note (`scoring:self` / no `scoring`),
 *   - a pair note with no `sessionId` (independence unverifiable — incl. a bare
 *     builder self-score, which has neither pair scoring nor a session id),
 *   - a pair note whose `sessionId === builderSessionId` (the builder scored its
 *     own work in its own session / via a sub-agent), or
 *   - an absent note.
 * A SAME-VENDOR note (e.g. claude scoring claude) with a DISTINCT fresh session
 * id PASSES — single-vendor installs are no longer deadlocked. `builderSessionId`
 * is the builder's minted session id, injected by the runner (ctx.builderSessionId).
 */
export function evaluateSelfScoreGate(projectPath: string, storyId: string, builderSessionId: string): SelfScoreGateCheck {
  const latest = readLatestStoryPeerScore(projectPath, storyId, builderSessionId);
  if (latest === undefined) return { status: "missing", reason: `missing peer review score for ${storyId}` };
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
