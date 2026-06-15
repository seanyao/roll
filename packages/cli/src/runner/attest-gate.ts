/**
 * FIX-207 — the acceptance-report (attest) gate.
 *
 * Skill 10.6 ("write the verification report") was a TEXT instruction: a cycle
 * could ship a high-quality delivery and silently skip the acceptance report
 * (observed 2026-06-06, cycle 20260606-033442 — FIX-199 merged with no ac-map,
 * no report, no self-score). Same failure mode FIX-150b fixed for peer review:
 * text has no teeth. This turns the requirement into a RUNTIME MECHANISM that
 * runs in every cycle's capture step, agent-agnostic:
 *
 *   actual delivery (commits ahead, real story)  AND  no fresh acceptance report
 *     ⇒ ALERT + an `attest:gate` event in events.ndjson (auditable forever).
 *
 * HARD by default: a delivery without dense, fresh acceptance evidence is
 * BLOCKED (the capture fails so the story is not marked Done). The temporary
 * migration hook is `loop_safety.attest_gate: soft` in policy.yaml.
 *
 * Freshness contract: the report at `.roll/verification/<storyId>/latest/report.html`
 * must have been written THIS cycle (mtime ≥ cycle start). A stale report left by
 * a previous delivery of the same story does not count as evidence.
 *
 * Content floor (US-ATTEST-012): freshness alone is mere "存在性". A fresh report
 * that is an EMPTY SHELL — parseable but with zero AC sections / no ac-map (the
 * FIX-214 case, where a heading naming another card stole all the AC) — is also
 * "skipped", not "produced". A real delivery's report carries ≥1 AC + an ac-map.
 *
 * Red-assertion floor (FIX-295): a `fail` AC — a check that EXECUTED AND went
 * red — blocks the delivery unconditionally. `main` is PR-protected and always
 * green, so a red check on a cycle branch is a regression the cycle introduced,
 * never an "environmental" quirk; it cannot be waived. The honest non-execution
 * exceptions (a `blocked` AC, a machine capture skip) are NOT failures and stay
 * waivable as before.
 */
import { acForStory, parsePolicy } from "@roll/core";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { cardArchiveDir, reportFileName } from "../lib/archive.js";
import { evaluateSelfScoreGate } from "../lib/self-score.js";

export type AttestMode = "soft" | "hard";

/**
 * Report path candidates — the card folder ONLY
 * (`features/<epic>/<ID>/latest/<ID>-report.html`). The legacy
 * `verification/<ID>/` read-compat window closed with US-META-002c: the old
 * tree was migrated (002b) and deleted; nothing writes or reads it anymore.
 */
function reportCandidates(worktreeCwd: string, storyId: string): string[] {
  return [join(cardArchiveDir(worktreeCwd, storyId), "latest", reportFileName(storyId))];
}

/** ac-map candidates, same single-home rule. */
function acMapCandidates(worktreeCwd: string, storyId: string): string[] {
  return [join(cardArchiveDir(worktreeCwd, storyId), "ac-map.json")];
}

function storySpecPath(worktreeCwd: string, storyId: string): string | null {
  const featuresDir = join(worktreeCwd, ".roll", "features");
  try {
    for (const epic of readdirSync(featuresDir, { withFileTypes: true })) {
      if (!epic.isDirectory()) continue;
      const spec = join(featuresDir, epic.name, storyId, "spec.md");
      if (existsSync(spec)) return spec;
      const legacy = join(featuresDir, epic.name, `${storyId}.md`);
      if (existsSync(legacy)) return legacy;
    }
  } catch {
    return null;
  }
  return null;
}

/** Whether the story's spec carries an `**AC:**` checklist; null = spec not
 *  found / unreadable. Exported for the FIX-246 remediation trigger, which must
 *  share the gate's exact notion of "this delivery owes an ac-map". */
export function storyHasAcBlock(worktreeCwd: string, storyId: string): boolean | null {
  const spec = storySpecPath(worktreeCwd, storyId);
  if (spec === null) return null;
  try {
    return acForStory(readFileSync(spec, "utf8"), storyId, { fileOwned: true }).length > 0;
  } catch {
    return null;
  }
}

/**
 * FIX-309 — a captured screenshot is the BASELINE for EVERY story
 * ("能截则截，应截尽截"): the default is ALWAYS REQUIRED, regardless of surface
 * (Web/CLI/TUI/anything). Keyword/rule matching may NEVER decide whether a
 * screenshot is required — it is always required by default. The ONLY place a
 * rule may run is to identify an EXPLICIT, recorded EXEMPTION.
 *
 * This replaces the FIX-284 leak: the old keyword regex (`(CLI|web|UI|TUI)|界面…`)
 * was used as an ENABLER — a clear UI Casting redesign that happened to lack the
 * literal keywords was judged "no screenshot needed" and slipped the iron rule.
 *
 * Exemption is the ONLY rule path (see {@link screenshotExemption}):
 *   1. spec frontmatter `screenshot_exempt: <reason>` — an explicit, recorded,
 *      per-card exemption, OR
 *   2. a configurable deny-list of genuinely-non-visual epics
 *      (`acceptance.screenshot_exempt_epics:` in `.roll/policy.yaml`).
 * An exemption returns false WITH the recorded reason; everything else is
 * REQUIRED. Returns true ⇒ this story owes captured visual evidence; the attest
 * render wiring drives a REAL capture for the appropriate surface (web/dossier →
 * FIX-291 ladder via {@link webCaptureTargetForStory}; CLI/TUI → the terminal
 * capture / honest machine-skip lane).
 */
export function storyRequiresScreenshot(worktreeCwd: string, storyId: string): boolean {
  return screenshotExemption(worktreeCwd, storyId).reason === undefined;
}

/**
 * FIX-309 — resolve a story's screenshot exemption. Returns the recorded
 * `reason` when (and only when) the story is EXPLICITLY exempted; `undefined`
 * reason ⇒ a screenshot is REQUIRED (the default for every story).
 *
 * The two recognised exemptions, both explicit and recorded:
 *   - spec frontmatter `screenshot_exempt: <reason>` (per-card), or
 *   - the story's epic appears in the policy deny-list
 *     `acceptance.screenshot_exempt_epics:` (genuinely-non-visual epics, e.g.
 *     pure data-migration).
 * No keyword/content matching is consulted — matching can only EXEMPT, never
 * enable.
 */
export function screenshotExemption(worktreeCwd: string, storyId: string): { reason?: string } {
  const spec = storySpecPath(worktreeCwd, storyId);
  if (spec === null) return {};
  let text: string;
  try {
    text = readFileSync(spec, "utf8");
  } catch {
    return {};
  }
  // (1) per-card explicit exemption: frontmatter `screenshot_exempt: <reason>`.
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  if (fm !== null) {
    const m = /^screenshot_exempt:\s*(.+)$/m.exec(fm[1] ?? "");
    if (m !== null) {
      const reason = stripQuotes((m[1] ?? "").trim());
      if (reason !== "" && !/^(false|no|0)$/i.test(reason)) {
        return { reason: `screenshot_exempt (spec): ${reason}` };
      }
    }
  }
  // (2) epic deny-list exemption: this story's epic is recorded as non-visual.
  const epic = epicForSpec(spec);
  if (epic !== null) {
    const denied = screenshotExemptEpics(worktreeCwd);
    if (denied.includes(epic)) {
      return { reason: `screenshot_exempt_epics (policy): epic "${epic}" is a recorded non-visual epic` };
    }
  }
  return {};
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/** The epic directory name a spec lives under (`features/<epic>/<ID>/spec.md`). */
function epicForSpec(specPath: string): string | null {
  // …/features/<epic>/<ID>/spec.md  OR  …/features/<epic>/<ID>.md
  const parts = specPath.split(/[\\/]/);
  const fi = parts.lastIndexOf("features");
  if (fi === -1 || fi + 1 >= parts.length) return null;
  return parts[fi + 1] ?? null;
}

/**
 * FIX-309 — the configurable deny-list of genuinely-non-visual epics, read from
 * `.roll/policy.yaml` under `acceptance.screenshot_exempt_epics:` (a YAML list).
 * Absent / unreadable ⇒ empty (nothing exempted by epic). This is the ONLY
 * place a configurable rule influences the screenshot requirement, and it can
 * only EXEMPT, never enable.
 */
export function screenshotExemptEpics(worktreeCwd: string): string[] {
  try {
    const p = join(worktreeCwd, ".roll", "policy.yaml");
    if (!existsSync(p)) return [];
    return parseScreenshotExemptEpics(readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}

/** Parse `acceptance.screenshot_exempt_epics:` — a block or inline YAML list. */
function parseScreenshotExemptEpics(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const out: string[] = [];
  let inAcceptance = false;
  let inList = false;
  let listIndent = 0;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ");
    if (/^acceptance:\s*$/.test(line)) {
      inAcceptance = true;
      inList = false;
      continue;
    }
    if (inAcceptance) {
      // inline form: `  screenshot_exempt_epics: [a, b]`
      const inline = /^\s+screenshot_exempt_epics:\s*\[(.*)\]\s*$/.exec(line);
      if (inline !== null) {
        for (const tok of (inline[1] ?? "").split(",")) {
          const v = stripQuotes(tok.trim());
          if (v !== "") out.push(v);
        }
        inList = false;
        continue;
      }
      // block form: `  screenshot_exempt_epics:` then `    - epic`
      const blockHead = /^(\s+)screenshot_exempt_epics:\s*$/.exec(line);
      if (blockHead !== null) {
        inList = true;
        listIndent = (blockHead[1] ?? "").length;
        continue;
      }
      if (inList) {
        const item = /^(\s+)-\s*(.+?)\s*$/.exec(line);
        if (item !== null && (item[1] ?? "").length > listIndent) {
          out.push(stripQuotes((item[2] ?? "").trim()));
          continue;
        }
        // a non-indented / sibling key ends the list
        if (line.trim() !== "" && !/^\s+-/.test(line)) inList = false;
      }
      // a top-level key (no leading space) ends the acceptance block
      if (/^\S/.test(line) && !/^acceptance:/.test(line)) {
        inAcceptance = false;
        inList = false;
      }
    }
  }
  return out.filter((v) => v !== "");
}

/**
 * FIX-321 — the DELIVERABLE web surface a card's attest should screenshot. The
 * screenshot must prove the thing the card delivers (the Casting page, a rendered
 * product view, …), NEVER the card's own dossier/report page — that is
 * self-referential, identical for every card, and proves nothing (the "screenshot
 * forgery" defect: every card's web.png was byte-identical, a shot of its own
 * STORY DOSSIER page). The dossier fallback is DELETED.
 *
 * Precedence: env override (`ROLL_ATTEST_WEB_URL` / a Gate-set deploy url) >
 * the card's DECLARED `deliverable_url` (frontmatter; alias `screenshot_url`) >
 * NULL. http(s) ⇒ a deployed surface; a relative path ⇒ a built artifact under
 * the worktree (file://); the literal `dossier` is an explicit opt-in for the rare
 * card whose deliverable genuinely IS its dossier page. When nothing is declared,
 * returns null — the caller records an HONEST web-capture skip (taken:false) so
 * the visual floor stays satisfiable (hasMachineCaptureSkip) without a hollow
 * filler; the screenshot baseline is then owed via a declared target, never faked.
 * Returns null too when the story is exempt (no captured evidence owed at all).
 * NOTE: terminal/TUI deliverables ride the separate capture.fromMarker lane —
 * deliverable_url is web-only; never force a web url onto a terminal card.
 */
export function deliverableUrlForStory(worktreeCwd: string, storyId: string): string | null {
  const spec = storySpecPath(worktreeCwd, storyId);
  if (spec === null) return null;
  let text: string;
  try {
    text = readFileSync(spec, "utf8");
  } catch {
    return null;
  }
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  if (fm === null) return null;
  const m = /^(?:deliverable_url|screenshot_url):\s*(.+)$/m.exec(fm[1] ?? "");
  if (m === null) return null;
  const v = stripQuotes((m[1] ?? "").trim());
  return v === "" ? null : v;
}

export function webCaptureTargetForStory(worktreeCwd: string, storyId: string, override?: string): string | null {
  if (!storyRequiresScreenshot(worktreeCwd, storyId)) return null; // exempt → no web capture owed
  const trimmed = (override ?? "").trim();
  if (trimmed !== "") return trimmed; // env / deploy override wins
  const declared = deliverableUrlForStory(worktreeCwd, storyId);
  if (declared === null) return null; // FIX-321: NO dossier fallback — caller records an honest skip
  if (declared === "dossier") return pathToFileURL(join(cardArchiveDir(worktreeCwd, storyId), "index.html")).href;
  if (/^(?:https?|file):\/\//i.test(declared)) return declared;
  // relative → a built artifact under the worktree. FIX-321b: split a trailing
  // #fragment BEFORE join (else pathToFileURL encodes the "#" into the filename),
  // then re-append it to the file:// URL — so `features/index.html#casting`
  // deep-links the console's Casting tab (the console routes on location.hash),
  // capturing the actual deliverable view, not the default tab.
  const hashIdx = declared.indexOf("#");
  const relPath = hashIdx >= 0 ? declared.slice(0, hashIdx) : declared;
  const fragment = hashIdx >= 0 ? declared.slice(hashIdx) : "";
  return pathToFileURL(join(worktreeCwd, relPath)).href + fragment;
}

interface AcMapEvidence {
  kind?: string;
  href?: string;
  textFile?: string;
}

interface AcMapEntry {
  ac?: string;
  status?: string;
  evidence?: AcMapEvidence[];
}

interface EvidenceManifestLike {
  screenshots?: unknown;
  captures?: unknown;
}

function readAcMapEntries(worktreeCwd: string, storyId: string): AcMapEntry[] | null {
  const path = acMapCandidates(worktreeCwd, storyId)[0];
  if (path === undefined || !existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed.filter((x) => typeof x === "object" && x !== null) as AcMapEntry[]) : null;
  } catch {
    return null;
  }
}

function evidenceManifest(worktreeCwd: string, storyId: string): EvidenceManifestLike | null {
  const report = existingReport(worktreeCwd, storyId);
  if (report === null) return null;
  const path = join(dirname(report), "evidence.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as EvidenceManifestLike) : null;
  } catch {
    return null;
  }
}

function hasMachineCaptureSkip(worktreeCwd: string, storyId: string): boolean {
  const manifest = evidenceManifest(worktreeCwd, storyId);
  if (manifest === null || !Array.isArray(manifest.captures)) return false;
  return manifest.captures.some((raw) => {
    if (typeof raw !== "object" || raw === null) return false;
    const row = raw as Record<string, unknown>;
    return row["taken"] === false && typeof row["skipped"] === "string" && row["skipped"] !== "";
  });
}

function passAcVisualFloor(worktreeCwd: string, storyId: string): { ok: boolean; reason?: string } {
  const entries = readAcMapEntries(worktreeCwd, storyId);
  if (entries === null) return { ok: true };
  const pass = entries.filter((e) => e.status === "pass");
  if (pass.length === 0) return { ok: true };
  const missing = pass.filter((e) => !(e.evidence ?? []).some((ev) => ev.kind === "screenshot" && typeof ev.href === "string" && ev.href !== ""));
  if (missing.length === 0) return { ok: true };
  if (hasMachineCaptureSkip(worktreeCwd, storyId)) return { ok: true, reason: "machine capture skip present" };
  const ids = missing.map((e) => e.ac ?? "?").join(", ");
  return { ok: false, reason: `pass AC(s) lack screenshot evidence or machine capture skip: ${ids}` };
}

/**
 * FIX-295 — the red-assertion floor (AC-FIX2/AC-FIX3).
 *
 * The acceptance ladder distinguishes a check that EXECUTED AND FAILED (`fail` —
 * "verified AND failed") from a check that COULD NOT RUN (`blocked` — "a
 * precondition blocks verification"). `main` is PR-protected and always green
 * (every merge passed CI), so a `fail` AC on a cycle branch is, by definition, a
 * regression the cycle introduced — NOT an environment quirk. It can never be
 * waived as "environmental"; the only honest exception is a check that could not
 * execute at all (the `blocked` non-execution path / a machine capture skip).
 *
 * Returns the ids of every `fail`-status AC (empty ⇒ no red assertion). A
 * delivery carrying any of these MUST be blocked — a red assertion is a
 * regression, full stop.
 */
function redAcFailures(worktreeCwd: string, storyId: string): string[] {
  const entries = readAcMapEntries(worktreeCwd, storyId);
  if (entries === null) return [];
  return entries.filter((e) => e.status === "fail").map((e) => e.ac ?? "?");
}

/** The acceptance report a delivered story must produce (skill step 10.6) —
 *  the canonical NEW-layout path, used for messaging. */
export function verificationReportPath(worktreeCwd: string, storyId: string): string {
  return reportCandidates(worktreeCwd, storyId)[0] as string;
}

/** First candidate report that exists on disk, or null. */
function existingReport(worktreeCwd: string, storyId: string): string | null {
  for (const p of reportCandidates(worktreeCwd, storyId)) {
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/**
 * Report exists as a file AND — when a cycle-start bound is given — was written
 * this cycle (mtime ≥ `sinceSec`). No bound ⇒ existence alone (graceful: callers
 * that can't determine cycle start still detect a wholly-absent report). Either
 * archive layout counts (US-META-001 read-compat).
 */
export function verificationReportFresh(
  worktreeCwd: string,
  storyId: string,
  sinceSec?: number,
): boolean {
  if (storyId === "") return false;
  const p = existingReport(worktreeCwd, storyId);
  if (p === null) return false;
  try {
    const st = statSync(p);
    if (sinceSec === undefined) return true;
    return st.mtimeMs / 1000 >= sinceSec;
  } catch {
    return false;
  }
}

/**
 * US-ATTEST-012 content floor: a report can be fresh yet be an EMPTY SHELL —
 * parseable but carrying ZERO acceptance criteria (the FIX-214 case, where a
 * heading mentioning another card id stole all the AC, so attest rendered a
 * report with no AC sections). "存在性"过闸不等于"有内容". A delivery's report must
 * carry ≥1 rendered AC section AND an `ac-map.json` (the AI intent layer the
 * skill writes for every real delivery). Missing either ⇒ no content. Either
 * archive layout counts (US-META-001 read-compat).
 */
export function verificationReportHasContent(worktreeCwd: string, storyId: string): boolean {
  if (storyId === "") return false;
  const p = existingReport(worktreeCwd, storyId);
  if (p === null) return false;
  try {
    const html = readFileSync(p, "utf8");
    const hasMap = acMapCandidates(worktreeCwd, storyId).some((m) => existsSync(m));
    if (!hasMap) return false;
    const sections = [...html.matchAll(/<section class="ac\s+([^"]+)"[\s\S]*?<\/section>/g)];
    if (sections.length === 0) return false;
    let positiveWithEvidence = 0;
    for (const m of sections) {
      const cls = m[1] ?? "";
      const body = m[0] ?? "";
      if (!/\bs-(pass|partial|readonly)\b/.test(cls)) continue;
      if (!/(class="ev\b|class="shot\b|<figure class="shot\b)/.test(body)) return false;
      positiveWithEvidence += 1;
    }
    if (positiveWithEvidence === 0) return false;
    if (!passAcVisualFloor(worktreeCwd, storyId).ok) return false;
    if (storyRequiresScreenshot(worktreeCwd, storyId)) {
      return /<figure class="shot\b|href="screenshots\/|src="screenshots\//i.test(html) || hasMachineCaptureSkip(worktreeCwd, storyId);
    }
    return true;
  } catch {
    return false;
  }
}

/** Read `loop_safety.attest_gate` from `<repoCwd>/.roll/policy.yaml`; default hard. */
export function readAttestGateMode(repoCwd: string): AttestMode {
  try {
    const p = join(repoCwd, ".roll", "policy.yaml");
    if (!existsSync(p)) return "hard";
    return parsePolicy(readFileSync(p, "utf8")).loopSafety.attestGate === "hard" ? "hard" : "soft";
  } catch {
    return "hard"; // unreadable / unparseable policy → fail closed
  }
}

export interface AttestGateResult {
  verdict: "produced" | "skipped";
  mode: AttestMode;
  reasons: string[];
  /** true ONLY when mode==="hard" && verdict==="skipped" — the delivery is blocked. */
  blocked: boolean;
}

export interface AttestGateSinks {
  alert: (message: string) => void;
  event: (payload: { cycleId: string; verdict: "produced" | "skipped"; reasons: string[] }) => void;
}

/**
 * Run the gate for one delivered cycle. Pure decision + sink side-effects; never
 * throws. Returns the verdict so callers/tests can assert without the sinks.
 *
 * Call ONLY on an actual delivery (commits ahead + a real story) — an idle cycle
 * has nothing to attest. `produced` → event only; `skipped` → ALERT + event, and
 * `blocked` iff the policy is hard.
 *
 * FIX-295: a `fail` AC (a check that ran and went red) blocks unconditionally —
 * a red assertion on a cycle branch is a regression (main is always green), not
 * an environment issue, so it is never waivable.
 */
export function runAttestGate(
  worktreeCwd: string,
  storyId: string,
  cycleId: string,
  mode: AttestMode,
  sinceSec: number | undefined,
  sinks: AttestGateSinks,
): AttestGateResult {
  try {
    if (storyHasAcBlock(worktreeCwd, storyId) === false) {
      const reasons = ["story has no AC block; acceptance report not required"];
      sinks.event({ cycleId, verdict: "produced", reasons });
      return { verdict: "produced", mode, reasons, blocked: false };
    }
    // FIX-295 (AC-FIX2/AC-FIX3): a red assertion is a regression, never an
    // "environmental" exception. A `fail` AC (a check that ran and went red) on
    // a cycle branch can only be the cycle's own regression — main is always
    // green — so it blocks the delivery and the story is NOT marked Done. The
    // only honest non-pass an env exception covers is a check that COULD NOT RUN
    // (`blocked` / a machine capture skip), which is not a `fail`.
    const redAcs = redAcFailures(worktreeCwd, storyId);
    if (redAcs.length > 0) {
      const reasons = [
        `acceptance check failed for ${storyId}: ${redAcs.join(", ")} went red — a failing check is a regression, not an environment issue, so it cannot be waived`,
      ];
      const blocked = mode === "hard";
      sinks.alert(
        `attest gate (${mode}): acceptance check failed (${storyId}) — ${redAcs.join(", ")} went red; a red check is a regression and is never waived as environmental — cycle ${cycleId}` +
          (blocked ? " — BLOCKED (hard mode); story not marked Done" : ""),
      );
      sinks.event({ cycleId, verdict: "skipped", reasons });
      return { verdict: "skipped", mode, reasons, blocked };
    }
    const fresh = verificationReportFresh(worktreeCwd, storyId, sinceSec);
    // US-ATTEST-012: freshness alone is "存在性" — a fresh empty shell (zero AC /
    // no ac-map, the FIX-214 case) does NOT count as a produced report.
    if (fresh && verificationReportHasContent(worktreeCwd, storyId)) {
      const score = evaluateSelfScoreGate(worktreeCwd, storyId);
      if (score.status === "pass") {
        const visual = passAcVisualFloor(worktreeCwd, storyId);
        const reasons = ["fresh acceptance report present", score.reason, ...(visual.reason !== undefined ? [visual.reason] : [])];
        sinks.event({ cycleId, verdict: "produced", reasons });
        return { verdict: "produced", mode, reasons, blocked: false };
      }
      const reasons = [score.reason];
      const blocked = mode === "hard";
      sinks.alert(
        `attest gate (${mode}): self-score gate failed (${storyId}) — ${score.reason} — cycle ${cycleId}` +
          (blocked ? " — BLOCKED (hard mode); story not marked Done" : ""),
      );
      sinks.event({ cycleId, verdict: "skipped", reasons });
      return { verdict: "skipped", mode, reasons, blocked };
    }
    const reasons = [
      fresh
        ? `acceptance report at .roll/features/<epic>/${storyId}/latest/${storyId}-report.html is an empty shell (no AC content / no ac-map)`
        : `no fresh acceptance report for ${storyId} (checked card archive + legacy verification paths)`,
    ];
    const blocked = mode === "hard";
    const lead = fresh
      ? `delivery with an empty-shell acceptance report (no AC content / no ac-map)`
      : `delivery without a fresh acceptance report`;
    sinks.alert(
      `attest gate (${mode}): ${lead} (${storyId}) — cycle ${cycleId}` +
        (blocked ? " — BLOCKED (hard mode); story not marked Done" : ""),
    );
    sinks.event({ cycleId, verdict: "skipped", reasons });
    return { verdict: "skipped", mode, reasons, blocked };
  } catch {
    // gate must never fail the cycle by surprise — soft-fail to produced/silent.
    return { verdict: "produced", mode, reasons: [], blocked: false };
  }
}
