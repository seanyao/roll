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

/** Resolve a story's defining spec markdown — the new card layout
 *  `features/<epic>/<ID>/spec.md` first, then the legacy `features/<epic>/<ID>.md`.
 *  Exported so `roll story validate` (FIX-339 AC7) shares the EXACT spec the
 *  runtime gate reads — design self-check and the闸 then never disagree. */
export function storySpecPath(worktreeCwd: string, storyId: string): string | null {
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
      if (reason !== "" && !/^(false|no|0|true|yes|on|1)$/i.test(reason)) {
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
  const all = deliverableUrlsForStory(worktreeCwd, storyId);
  return all.length === 0 ? null : (all[0] as string);
}

/**
 * FIX-339 (AC1) — the FULL list of DECLARED deliverable web surfaces. A card may
 * legitimately ship more than one user-visible web view (e.g. a Casting tab AND
 * a Review tab), and the attest must capture EACH. Parses the frontmatter
 * `deliverable_url:` / `screenshot_url:` in three shapes, all backward-compatible:
 *   - single scalar           `deliverable_url: https://app/x`        → ["https://app/x"]
 *   - inline list             `deliverable_url: [a, b]`               → ["a", "b"]
 *   - comma-separated scalar  `deliverable_url: a, b`                 → ["a", "b"]
 *   - YAML block list         `deliverable_url:\n  - a\n  - b`        → ["a", "b"]
 * A single value is returned as a one-element list, so every legacy single-url
 * card behaves EXACTLY as before. Empty / absent ⇒ []. Order is preserved and
 * duplicates are de-duped (stable).
 */
export function deliverableUrlsForStory(worktreeCwd: string, storyId: string): string[] {
  const spec = storySpecPath(worktreeCwd, storyId);
  if (spec === null) return [];
  let text: string;
  try {
    text = readFileSync(spec, "utf8");
  } catch {
    return [];
  }
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  if (fm === null) return [];
  // deliverable_url keeps comma-splitting: a url never contains a comma, so a
  // comma-separated scalar (`a, b`) is an unambiguous two-url list.
  return parseFrontmatterListField(fm[1] ?? "", /^(?:deliverable_url|screenshot_url):/, { commaSplit: true });
}

/**
 * FIX-339 (AC2) — the DECLARED deliverable CLI commands, after the
 * roll-only allowlist filter (see {@link allowedDeliverableCmd}). A card whose
 * deliverable is a command's terminal output (a CLI surface) declares
 * `deliverable_cmd:` in the frontmatter; the attest runs EACH command in the
 * worktree and captures its terminal output. Two parse shapes (NO comma split):
 *   - single scalar     `deliverable_cmd: roll status --fmt a,b`  → one command
 *   - YAML block list    `deliverable_cmd:\n  - roll status\n  - roll cycles`
 * A scalar is the WHOLE line (one command) — never comma-split, because a
 * command line legitimately carries commas (flag lists / JSON args, e.g.
 * `roll status --fmt a,b`). Empty / absent ⇒ [].
 *
 * SECURITY (FIX-339 复核): a spec is written by the autonomous loop's own cycle
 * agent, so an unfiltered `deliverable_cmd` would be agent-controlled ARBITRARY
 * command execution (the whole line runs verbatim under `sh -lc`). This getter
 * therefore returns ONLY commands that pass {@link allowedDeliverableCmd} — the
 * roll read-only allowlist. A rejected command is DROPPED here (it never runs)
 * and surfaced separately by {@link rejectedDeliverableCmdsForStory} so the gate
 * can FAIL loudly rather than silently honest-skip.
 */
export function deliverableCmdsForStory(worktreeCwd: string, storyId: string): string[] {
  return rawDeliverableCmdsForStory(worktreeCwd, storyId).filter(allowedDeliverableCmd);
}

/**
 * FIX-339 (AC2 复核) — the DECLARED deliverable_cmd entries that the roll-only
 * allowlist REJECTS (a non-roll command, or a state-changing/release roll
 * subcommand). Non-empty ⇒ the spec asked the attest to run something it must
 * not; the gate fails loud (these are never silently skipped).
 */
export function rejectedDeliverableCmdsForStory(worktreeCwd: string, storyId: string): string[] {
  return rawDeliverableCmdsForStory(worktreeCwd, storyId).filter((c) => !allowedDeliverableCmd(c));
}

/** Unfiltered deliverable_cmd parse (scalar = whole line, block list = per item; NO comma split). */
function rawDeliverableCmdsForStory(worktreeCwd: string, storyId: string): string[] {
  const spec = storySpecPath(worktreeCwd, storyId);
  if (spec === null) return [];
  let text: string;
  try {
    text = readFileSync(spec, "utf8");
  } catch {
    return [];
  }
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  if (fm === null) return [];
  return parseFrontmatterListField(fm[1] ?? "", /^deliverable_cmd:/, { commaSplit: false });
}

/**
 * FIX-339 (复核 #1) — the deliverable_cmd security policy. A spec is authored by
 * the autonomous loop's own cycle agent, so `deliverable_cmd` is AGENT-CONTROLLED
 * input that the attest lane runs verbatim under `sh -lc`. Without a gate this is
 * arbitrary command execution. Two rules, both must pass:
 *
 *   (1) ALLOWLIST — the command's first token MUST invoke THIS project's own
 *       `roll` CLI: bare `roll`, `./bin/roll.js`, `bin/roll.js`, or a
 *       `node …/roll(.js)` / `node …/bin/roll.js` form. ANY other command
 *       (`rm`, `curl`, `git push`, a bare script, a pipeline, …) is rejected —
 *       deliverable_cmd is for read-only roll demos only, never arbitrary shell.
 *   (2) DENYLIST — even a roll command must be READ-ONLY: the mutating /
 *       releasing subcommands below are rejected (they change state, publish, or
 *       reconfigure the loop, and have no place in an acceptance demo).
 *
 * The allowlist/denylist are deliberately CONSTANTS here; a later card can lift
 * them into `.roll/policy.yaml` (see {@link DELIVERABLE_CMD_DENY_SUBCOMMANDS}).
 * Exported for direct unit testing.
 */
export function allowedDeliverableCmd(command: string): boolean {
  const tokens = command.trim().split(/\s+/).filter((t) => t !== "");
  if (tokens.length === 0) return false;
  // No shell metacharacters that could chain/echo a second command — a single
  // `roll …` invocation only. (`,` is allowed: it appears in flag values.)
  if (/[;&|`$<>(){}]|\|\||&&/.test(command)) return false;
  const first = tokens[0] ?? "";
  // (1) allowlist — the first token must be the roll CLI itself.
  let subIdx: number;
  if (first === "roll" || /^(?:\.\/)?(?:.*\/)?bin\/roll\.js$/.test(first) || /^(?:.*\/)?roll(?:\.js)?$/.test(first)) {
    subIdx = 1;
  } else if (first === "node") {
    // node <…/roll.js | …/bin/roll.js> <subcommand> …
    const target = tokens[1] ?? "";
    if (!/^(?:.*\/)?(?:bin\/)?roll\.js$/.test(target) && !/^(?:.*\/)?roll(?:\.js)?$/.test(target)) return false;
    subIdx = 2;
  } else {
    return false;
  }
  // (2) denylist — reject state-changing / releasing roll subcommands.
  const sub = (tokens[subIdx] ?? "").toLowerCase();
  if (sub === "") return true; // bare `roll` (prints help) — harmless read-only.
  if (DELIVERABLE_CMD_DENY_SUBCOMMANDS.has(sub)) return false;
  return true;
}

/**
 * FIX-339 (复核 #1) — roll subcommands a deliverable_cmd may NOT invoke. These
 * change state / publish / reconfigure the loop, so they have no place in an
 * acceptance demo (which should be read-only, e.g. `roll pulse` / `roll status`
 * / `roll cycles`). 后续可挪 policy.yaml.
 */
const DELIVERABLE_CMD_DENY_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "release",
  "loop", // on/off/go/… — operate the loop
  "story",
  "idea",
  "agent", // `roll agent use` re-points the shared runner
  "pair",
  "attest", // re-render evidence — never from within an attest demo
  "fix",
  "build",
  "design",
  "propose",
]);

/**
 * Parse a frontmatter field that may be a scalar, an inline `[a, b]` list, or a
 * YAML block list. `keyRe` matches the `key:` prefix on a frontmatter line
 * (anchored at column 0). De-dupes while keeping first-seen order.
 *
 * `commaSplit` controls how a bare scalar is interpreted:
 *   - `true`  (deliverable_url): a scalar may be comma-separated (`a, b` → two
 *             values). Safe for URLs — a url never contains a comma.
 *   - `false` (deliverable_cmd): a scalar is the WHOLE line (one command). A
 *             command line legitimately carries commas (flag lists / JSON args,
 *             e.g. `roll status --fmt a,b`), so splitting on commas would shred
 *             a single command into bogus fragments. Multiple commands use the
 *             YAML block-list form (one `-` per line).
 * The inline `[a, b]` form always splits on commas (it is an explicit list).
 */
function parseFrontmatterListField(fmBody: string, keyRe: RegExp, opts: { commaSplit: boolean }): string[] {
  const lines = fmBody.split(/\r?\n/);
  const out: string[] = [];
  const push = (raw: string): void => {
    const v = stripQuotes(raw.trim());
    if (v !== "" && !out.includes(v)) out.push(v);
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const head = keyRe.exec(line);
    if (head === null) continue;
    const rest = line.slice(head[0].length).trim();
    // inline list: key: [a, b] — an explicit list always splits on commas.
    const inline = /^\[(.*)\]$/.exec(rest);
    if (inline !== null) {
      for (const tok of (inline[1] ?? "").split(",")) push(tok);
      continue;
    }
    if (rest !== "") {
      // scalar — comma-split only when the caller opts in (url), else whole line (cmd).
      if (opts.commaSplit) for (const tok of rest.split(",")) push(tok);
      else push(rest);
      continue;
    }
    // block list: key:\n  - a\n  - b  (consume following `-` item lines)
    for (let j = i + 1; j < lines.length; j += 1) {
      const item = /^(\s+)-\s*(.+?)\s*$/.exec(lines[j] ?? "");
      if (item === null) {
        // a non-list line ends the block (unless it is blank)
        if ((lines[j] ?? "").trim() === "") continue;
        break;
      }
      push(item[2] ?? "");
    }
  }
  return out;
}

/**
 * FIX-339 (AC1) — one web capture target per DECLARED deliverable_url. An env
 * override (a single deploy url) collapses to one target (it points at the live
 * deploy, which is the one surface the deploy proves). With no override, every
 * declared url is resolved through the same FIX-321 rules (http(s)/file as-is,
 * `dossier` opt-in, relative → file:// with #fragment deep-link). Exempt ⇒ [].
 */
export function webCaptureTargetsForStory(worktreeCwd: string, storyId: string, override?: string): string[] {
  if (!storyRequiresScreenshot(worktreeCwd, storyId)) return []; // exempt → no web capture owed
  const trimmed = (override ?? "").trim();
  if (trimmed !== "") return [trimmed]; // env / deploy override wins (single live surface)
  return deliverableUrlsForStory(worktreeCwd, storyId).map((u) => resolveWebTarget(worktreeCwd, storyId, u));
}

/** Back-compat single-target resolver — first declared surface, or null. */
export function webCaptureTargetForStory(worktreeCwd: string, storyId: string, override?: string): string | null {
  const all = webCaptureTargetsForStory(worktreeCwd, storyId, override);
  return all.length === 0 ? null : (all[0] as string);
}

function resolveWebTarget(worktreeCwd: string, storyId: string, declared: string): string {
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

/**
 * FIX-339 (AC6) — does the spec DECLARE ANY visual surface? True iff it has a
 * `deliverable_url`/`screenshot_url`, a `deliverable_cmd`, OR a recorded
 * `screenshot_exempt: <reason>`. PURE (takes spec text), agent-agnostic, used by
 * the build preflight to WARN (this round only — no hard block) when a non-exempt
 * card declares none of the three. Mirrors the runtime gate's frontmatter reads.
 */
export function declaresAnySurface(specText: string): boolean {
  const fm = /^---\n([\s\S]*?)\n---/.exec(specText);
  if (fm === null) return false;
  const body = fm[1] ?? "";
  if (parseFrontmatterListField(body, /^(?:deliverable_url|screenshot_url):/, { commaSplit: true }).length > 0) return true;
  // A declared deliverable_cmd counts as a surface even if the allowlist would
  // later reject it — the card DID declare an intent to demo a CLI surface; the
  // reject path fails loud at the gate, not here.
  if (parseFrontmatterListField(body, /^deliverable_cmd:/, { commaSplit: false }).length > 0) return true;
  const ex = /^screenshot_exempt:\s*(.+)$/m.exec(body);
  if (ex !== null) {
    const reason = stripQuotes((ex[1] ?? "").trim());
    if (reason !== "" && !/^(false|no|0|true|yes|on|1)$/i.test(reason)) return true;
  }
  return false;
}

/**
 * FIX-339 (AC6) — the must-declare HARD-GATE predicate (this round HARDENED from
 * the FIX-339 WARN). A delivery VIOLATES must-declare iff it is a story that owes
 * acceptance evidence yet declares NO deliverable surface AT ALL:
 *
 *   non-exempt (epic-aware {@link screenshotExemption})  AND
 *   {@link declaresAnySurface}(spec) === false  (no deliverable_url / deliverable_cmd / screenshot_exempt)
 *
 * STRUCTURAL, never a classifier guess: it reads ONLY the recorded frontmatter +
 * the policy epic deny-list, exactly the surfaces the runtime capture lanes read.
 * A card that declared any url/cmd, or that is exempt (per-card OR epic), returns
 * false here — the owner red line (误杀 exempt / back-end / declared cards = 阻断
 * loop) is honoured by construction.
 *
 * Reached ONLY from the visual floor ({@link passAcVisualFloor} /
 * {@link verificationReportHasContent}), which `runAttestGate` calls AFTER the
 * `storyHasAcBlock === false` early-return — so a no-AC card (an IDEA note, a
 * pure data card) is never subjected to must-declare. Returns false on any read
 * blip (fail open here; the gate's own control flow stays the single failure
 * surface). Exported for direct unit testing + `roll story validate`.
 */
export function violatesMustDeclareSurface(worktreeCwd: string, storyId: string): boolean {
  if (screenshotExemption(worktreeCwd, storyId).reason !== undefined) return false; // exempt → owes nothing
  const spec = storySpecPath(worktreeCwd, storyId);
  if (spec === null) return false;
  let text: string;
  try {
    text = readFileSync(spec, "utf8");
  } catch {
    return false;
  }
  return !declaresAnySurface(text);
}

/** FIX-339 (AC6) — the canonical must-declare FAIL reason (shared by the gate and
 *  `roll story validate`), so the runtime闸 and the design self-check speak with
 *  one voice. */
export const MUST_DECLARE_FAIL_REASON =
  "no deliverable surface declared — 必须声明 deliverable_url/deliverable_cmd 或 screenshot_exempt";

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

/**
 * FIX-309 (堵 284 洞①) — whether this delivery OWES a REAL web capture, i.e. an
 * honest machine-skip can NO LONGER satisfy its visual floor. True iff the story
 * is non-exempt (`storyRequiresScreenshot`) AND it DECLARED a `deliverable_url`
 * (alias `screenshot_url`) — a concrete, technically-captureable web surface.
 *
 * The FIX-284 leak this closes: a card that DECLARED a deliverable surface but
 * whose capture errored / was skipped (`{kind:"web",taken:false,skipped}`) used
 * to pass via {@link hasMachineCaptureSkip} — "声明了 url 却从没真截也能过". Once a
 * surface is declared, only a REAL capture (`taken:true`) discharges it; an
 * honest-skip is reserved for "确实无可视面 + 记录化豁免" (an EXEMPT card, or a
 * required card with NO declared web target — e.g. a TUI/terminal deliverable
 * riding the separate terminal-capture lane).
 */
function owesRealWebCapture(worktreeCwd: string, storyId: string): boolean {
  return storyRequiresScreenshot(worktreeCwd, storyId) && deliverableUrlsForStory(worktreeCwd, storyId).length > 0;
}

/**
 * FIX-339 (AC2/AC3) — whether this delivery OWES a REAL terminal capture: a
 * non-exempt card that DECLARED ≥1 `deliverable_cmd`. Each declared command is a
 * concrete CLI surface that must be really run + captured; an honest terminal
 * skip no longer discharges a declared command.
 */
function owesTerminalCapture(worktreeCwd: string, storyId: string): boolean {
  return storyRequiresScreenshot(worktreeCwd, storyId) && deliverableCmdsForStory(worktreeCwd, storyId).length > 0;
}

/** Count the REAL, taken captures of a given kind in the evidence manifest. */
function takenCaptureCount(worktreeCwd: string, storyId: string, kind: string): number {
  const manifest = evidenceManifest(worktreeCwd, storyId);
  if (manifest === null || !Array.isArray(manifest.captures)) return 0;
  return manifest.captures.filter((raw) => {
    if (typeof raw !== "object" || raw === null) return false;
    const row = raw as Record<string, unknown>;
    return row["kind"] === kind && row["taken"] === true;
  }).length;
}

/**
 * FIX-339 (复核 #3) — when a deploy/env override (`ROLL_ATTEST_WEB_URL` or a
 * Gate-set deploy url) is in effect, the web capture lane collapses to ONE
 * target (the single live deploy proves one active surface — see
 * {@link webCaptureTargetsForStory}). So the gate must require only ONE taken
 * web shot, not N. Without this a multi-url card under an override would demand
 * N shots while the lane only ever produced 1 → permanent false FAIL.
 */
function webCaptureNeed(worktreeCwd: string, storyId: string): number {
  const override = (process.env["ROLL_ATTEST_WEB_URL"] ?? "").trim();
  if (override !== "") return 1; // override collapses to a single live-deploy shot
  const declared = deliverableUrlsForStory(worktreeCwd, storyId).length;
  return declared === 0 ? 1 : declared; // owesRealWebCapture guarantees ≥1 when called
}

/**
 * FIX-309 + FIX-339 (AC1) — EVERY declared web surface is REALLY captured.
 * A card that declares N deliverable_urls must carry ≥N taken:true web captures
 * (one per surface); a single real shot no longer discharges a multi-surface
 * card. With a single declared url this is exactly the old "≥1 taken web shot".
 * Under a deploy/env override the need folds to 1 ({@link webCaptureNeed}).
 */
function hasRealWebCapture(worktreeCwd: string, storyId: string): boolean {
  return takenCaptureCount(worktreeCwd, storyId, "web") >= webCaptureNeed(worktreeCwd, storyId);
}

/**
 * FIX-339 (AC2) — EVERY declared deliverable_cmd is REALLY captured: ≥N
 * taken:true terminal captures for N declared commands.
 */
function hasRealTerminalCapture(worktreeCwd: string, storyId: string): boolean {
  const need = deliverableCmdsForStory(worktreeCwd, storyId).length;
  if (need === 0) return false;
  return takenCaptureCount(worktreeCwd, storyId, "terminal") >= need;
}

function passAcVisualFloor(worktreeCwd: string, storyId: string): { ok: boolean; reason?: string } {
  // FIX-339 (AC6) — must-declare HARD floor. A non-exempt card that declares NO
  // deliverable surface (no url / cmd / exempt) can NEVER produce a real capture;
  // it would honest-skip forever. Reached only after the storyHasAcBlock early
  // return, so it never touches a no-AC card. Structural, not a classifier guess.
  if (violatesMustDeclareSurface(worktreeCwd, storyId)) {
    return { ok: false, reason: MUST_DECLARE_FAIL_REASON };
  }
  const entries = readAcMapEntries(worktreeCwd, storyId);
  if (entries === null) return { ok: true };
  const pass = entries.filter((e) => e.status === "pass");
  if (pass.length === 0) return { ok: true };
  const missing = pass.filter((e) => !(e.evidence ?? []).some((ev) => ev.kind === "screenshot" && typeof ev.href === "string" && ev.href !== ""));
  if (missing.length === 0) return { ok: true };
  // FIX-339 (AC3): per-surface enforcement. A card may declare web surfaces, CLI
  // commands, or both; EACH declared surface owes a REAL capture and an
  // honest-skip no longer discharges a DECLARED surface.
  const owesWeb = owesRealWebCapture(worktreeCwd, storyId);
  const owesTerm = owesTerminalCapture(worktreeCwd, storyId);
  if (owesWeb || owesTerm) {
    const gaps: string[] = [];
    if (owesWeb && !hasRealWebCapture(worktreeCwd, storyId)) {
      gaps.push(`declared deliverable_url(s) not all really captured (need ${webCaptureNeed(worktreeCwd, storyId)} taken web shots)`);
    }
    if (owesTerm && !hasRealTerminalCapture(worktreeCwd, storyId)) {
      gaps.push(`declared deliverable_cmd(s) not all really captured (need ${deliverableCmdsForStory(worktreeCwd, storyId).length} taken terminal shots)`);
    }
    if (gaps.length === 0) return { ok: true, reason: "all declared surfaces really captured" };
    const ids = missing.map((e) => e.ac ?? "?").join(", ");
    return { ok: false, reason: `pass AC(s) lack screenshot evidence and a declared surface was never really captured (honest-skip does not satisfy a declared surface): ${gaps.join("; ")} [${ids}]` };
  }
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
      // FIX-309 (堵 284 洞①+②) + FIX-339 (AC3 逐面强制): a card that DECLARED any
      // surface (deliverable_url and/or deliverable_cmd) owes a REAL capture of
      // EACH — neither an honest-skip nor a bare `<figure class=shot>` in the HTML
      // (which could be a self-referential dossier self-shot, the FIX-321 forgery
      // shape) discharges it; only recorded `taken:true` captures (one per
      // declared surface) do. A mixed web+cmd card must satisfy BOTH. A required
      // card with NO declared surface keeps the prior floor: a captured figure
      // ref OR an honest skip.
      const owesWeb = owesRealWebCapture(worktreeCwd, storyId);
      const owesTerm = owesTerminalCapture(worktreeCwd, storyId);
      if (owesWeb || owesTerm) {
        if (owesWeb && !hasRealWebCapture(worktreeCwd, storyId)) return false;
        if (owesTerm && !hasRealTerminalCapture(worktreeCwd, storyId)) return false;
        return true;
      }
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
  // FIX-343 (step ②): the quality score is read from the PERSISTENT .roll
  // (repoCwd-rooted), NOT the ephemeral worktree — the fresh-session peer score
  // note (runScorePairing) lands there. Defaults to worktreeCwd so callers that
  // pre-date the split (and tests staging the note under the worktree) are
  // unaffected. `builderSessionId` (step ①, ctx.builderSessionId) is threaded so
  // the gate honors ONLY an independent fresh-session score whose recorded
  // `sessionId` is NOT the builder's own session — never the vendor name.
  scoreRepoCwd: string = worktreeCwd,
  builderSessionId = "",
): AttestGateResult {
  // FIX-343 (step ②): a missing PEER score must surface as a blocking
  // skipped/blocked verdict — the bottom blanket catch below must NOT soft-fail
  // it to `produced`. The peer-score check is therefore evaluated here, where a
  // thrown error in the score read is fail-closed (blocked in hard mode), and
  // its result is reused inside the main path below.
  try {
    // FIX-339 (复核 #1) — a deliverable_cmd outside the roll read-only allowlist
    // is rejected BEFORE anything else: the spec asked the attest lane to run a
    // non-roll command or a state-changing roll subcommand (agent-controlled
    // arbitrary execution). The command never ran; the gate FAILS LOUD here (it
    // is never silently honest-skipped). Reported even ahead of the AC-block
    // exemption, since the security problem stands regardless of AC shape.
    const rejectedCmds = rejectedDeliverableCmdsForStory(worktreeCwd, storyId);
    if (rejectedCmds.length > 0) {
      const reasons = [
        `deliverable_cmd 非白名单(仅限 roll 只读子命令): ${rejectedCmds.join(", ")} — refused (no arbitrary command execution; no state-changing roll subcommand)`,
      ];
      const blocked = mode === "hard";
      sinks.alert(
        `attest gate (${mode}): deliverable_cmd outside the roll read-only allowlist (${storyId}) — refused: ${rejectedCmds.join(", ")} — cycle ${cycleId}` +
          (blocked ? " — BLOCKED (hard mode); story not marked Done" : ""),
      );
      sinks.event({ cycleId, verdict: "skipped", reasons });
      return { verdict: "skipped", mode, reasons, blocked };
    }
    if (storyHasAcBlock(worktreeCwd, storyId) === false) {
      const reasons = ["story has no AC block; acceptance report not required"];
      sinks.event({ cycleId, verdict: "produced", reasons });
      return { verdict: "produced", mode, reasons, blocked: false };
    }
    // FIX-339 (AC6) — must-declare HARD闸. A non-exempt card WITH an AC block that
    // declares NO deliverable surface (no deliverable_url / deliverable_cmd /
    // screenshot_exempt) can never produce a real capture and would honest-skip
    // forever. This is a STRUCTURAL design defect, not an "environment" miss —
    // surfaced loud here (ahead of the freshness/content checks) with its own
    // canonical reason rather than masquerading as an "empty shell". Exempt cards
    // (per-card OR epic-deny-list) and any card that declared a url/cmd are
    // untouched (owner red line: 误杀 exempt/back-end/declared = 阻断 loop).
    if (violatesMustDeclareSurface(worktreeCwd, storyId)) {
      const reasons = [MUST_DECLARE_FAIL_REASON];
      const blocked = mode === "hard";
      sinks.alert(
        `attest gate (${mode}): ${MUST_DECLARE_FAIL_REASON} (${storyId}) — cycle ${cycleId}` +
          (blocked ? " — BLOCKED (hard mode); story not marked Done" : ""),
      );
      sinks.event({ cycleId, verdict: "skipped", reasons });
      return { verdict: "skipped", mode, reasons, blocked };
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
      // FIX-343 (step ③): honor ONLY an INDEPENDENT fresh-session peer score from
      // the PERSISTENT .roll (scoreRepoCwd) — its recorded `sessionId` must be
      // present AND ≠ the builder's session id. A self / legacy / no-sessionId /
      // sessionId===builderSessionId / absent note → status "missing" with
      // "missing peer review score" → block (fail loud, no synthesized pass).
      // FIX-343 (① STRICT cycle-scope): thread THIS cycle's id so only a score
      // minted by this cycle's scorer (`${cycleId}:score:...`) is honored — a
      // prior cycle's peer note on a RESUME (re-picked un-merged same-story
      // branch) no longer soft-passes this cycle's gate.
      const score = evaluateSelfScoreGate(scoreRepoCwd, storyId, builderSessionId, cycleId);
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
    // FIX-343 (step ②): the blanket catch must NOT soft-fail to `produced` — an
    // exception while resolving the peer score (or any other gate check) would
    // otherwise launder a missing-peer-score delivery into a pass. Fail CLOSED:
    // surface a blocking skipped/blocked verdict in hard mode (the cycle owes a
    // real peer score), non-blocking skipped in soft (migration window). A
    // missing peer score is never synthesized into a pass.
    const reasons = ["attest gate error — failing closed (no peer review score honored)"];
    const blocked = mode === "hard";
    return { verdict: "skipped", mode, reasons, blocked };
  }
}
