/**
 * `roll backlog` WRITE/maintenance subcommands — US-PORT-019. Ports the bash
 * `cmd_backlog` status-management arms off the frozen `bin/roll`:
 *   - block / defer / unblock / promote : rewrite the Status cell (BacklogStore).
 *   - lint [--gate]                     : flag rows whose description carries
 *                                         technical detail (the AGENTS.md §4 rule).
 * (`sync` and `unstick` live in their own modules — they are bigger ports.)
 *
 * Output mirrors the bash oracle: plain `echo` lines (no [roll] prefix), the
 * resolved-locale msg catalog, and the same exit codes.
 */
import { BacklogStore, lintIdeaDescription } from "@roll/core";
import { resolveLang, t, v2Catalog, type Lang } from "@roll/spec";
import { existsSync, readFileSync } from "node:fs";

const BACKLOG_PATH = ".roll/backlog.md";

function lang(): Lang {
  return resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });
}
function msg(key: string, ...args: Array<string | number>): string {
  return t(v2Catalog, lang(), key, ...args);
}
function out(line: string): void {
  process.stdout.write(line + "\n");
}
function errLine(line: string): void {
  process.stderr.write(line + "\n");
}

/** New status string for a set-status subcommand (mirrors the bash case). */
export function statusFor(subcmd: string, reason: string): string | null {
  switch (subcmd) {
    case "block":
      return `🔒 Blocked${reason ? ` [${reason}]` : ""}`;
    case "defer":
      return `⏸ Deferred${reason ? ` [${reason}]` : ""}`;
    case "unblock":
    case "promote":
      return "📋 Todo";
    default:
      return null;
  }
}

/** `roll backlog <block|defer|unblock|promote> <pattern> [reason]`. */
export function backlogSetStatusCommand(
  subcmd: string,
  args: string[],
  store: BacklogStore = new BacklogStore(),
): number {
  const pattern = args[0] ?? "";
  const reason = args[1] ?? "";
  if (pattern === "") {
    errLine(`[roll] ${msg("backlog.usage_roll_backlog_pattern_reason", subcmd)}`);
    return 1;
  }
  const newStatus = statusFor(subcmd, reason);
  if (newStatus === null) return 1; // unreachable via the dispatcher
  if (!existsSync(BACKLOG_PATH)) {
    errLine(`[roll] ${msg("backlog.roll_backlog_md_not_found_run")}`);
    return 1;
  }
  const snap = store.readBacklog(BACKLOG_PATH);
  const { count } = store.mark(BACKLOG_PATH, snap.hash, pattern, newStatus);
  if (count === 0) out(msg("backlog.no_items_matched", pattern));
  else out(msg("backlog.updated_item_s", count, newStatus));
  return 0;
}

// ─── lint ───────────────────────────────────────────────────────────────────

const ID_PREFIX_RE = /^\[[A-Z]+-[0-9]+\]\([^)]*\)\s*|^[A-Z]+-[0-9]+\s*/;

/** Category tags for a description, with the bash `length>N` detail restored. */
export function lintRowIssues(desc: string): string[] {
  const cats = lintIdeaDescription(desc);
  if (cats.length === 0) return [];
  const bodyLen = desc.replace(ID_PREFIX_RE, "").length;
  return cats.map((c) => (c === "length" ? `length>${bodyLen}` : c));
}

/** A lint finding: source line number, story id, joined issues, raw description. */
export interface LintFinding {
  lineno: number;
  sid: string;
  issues: string;
  desc: string;
}

/** Pure: scan backlog content for rows whose description violates §4. */
export function lintBacklogContent(content: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").replace(/\r$/, "");
    if (!line.startsWith("|")) continue;
    if (/Story.*Description.*Status/.test(line) || line.includes("---")) continue;
    const fields = line.split("|");
    const desc = (fields[2] ?? "").trim();
    if (desc === "") continue;
    const issues = lintRowIssues(desc);
    if (issues.length === 0) continue;
    const sidCell = (fields[1] ?? "").trim();
    const sidMatch = /([A-Z]+-[0-9]+)/.exec(sidCell);
    findings.push({
      lineno: i + 1,
      sid: sidMatch?.[1] ?? "",
      issues: issues.join(", "),
      desc,
    });
  }
  return findings;
}

/** `roll backlog lint [--gate] [<path>]` — warn (or gate-fail) on §4 violations. */
export function backlogLintCommand(args: string[]): number {
  let gate = false;
  let backlog = BACKLOG_PATH;
  for (const a of args) {
    if (a === "--gate") gate = true;
    else backlog = a;
  }
  if (!existsSync(backlog)) {
    errLine(`[roll] backlog not found: ${backlog}`);
    return 1;
  }
  const findings = lintBacklogContent(readFileSync(backlog, "utf8"));
  for (const f of findings) {
    out(`${backlog}:${f.lineno}: ${f.sid} — ${f.issues}`);
    out(`  ${f.desc}`);
  }
  out("");
  if (findings.length > 0) {
    out(`  ${findings.length} violation(s) — see conventions/global/AGENTS.md §4`);
    if (gate) {
      out(msg("ci.gate_enabled_exiting_1", findings.length));
      return 1;
    }
    out(msg("ci.phase_1_warn_only_not_blocking", findings.length));
  } else {
    out(msg("ci.no_violations"));
  }
  return 0;
}
