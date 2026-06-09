/**
 * `roll loop reset | mute | unmute | gc | test` — US-PORT-022 (part 2): the
 * residual loop WRITE/maintenance subcommands ported off the frozen bash
 * `bin/roll` engine. Each mirrors its v2 oracle's side effects, gates, and
 * flags; output follows the resolved locale (single language), via the same
 * [roll]-prefixed ok/info/warn/err presentation the bash helpers emit.
 *
 * Path model (mirrors bin/roll 7286-7330 source-time resolution):
 *   - state file : <rt>/state-<slug>.yaml   (rt = ROLL_PROJECT_RUNTIME_DIR env
 *                  → plist/crontab/inner-script resolved project /.roll/loop →
 *                  else <shared>/loop). Same resolution as `loop status`.
 *   - mute file  : <rt>/mute-<slug>         (shared by the loop + peer auto-attach
 *                  popup gate; run-once reads it before opening the report).
 *   - heal dir   : ${ROLL_LOOP_DIR:-<shared>/loop}/heal  (HEAD-CI heal counters).
 */
import { resolveLang, t, v2Catalog, type Lang } from "@roll/spec";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loopRuntimeDir, projectSlug, sharedRoot } from "./dashboard.js";

// ─── presentation (mirrors bin/roll ok/info/warn/err: "[roll] <line>") ────────
interface Palette {
  GREEN: string;
  CYAN: string;
  YELLOW: string;
  RED: string;
  NC: string;
}
function palette(): Palette {
  const noColor = (process.env["NO_COLOR"] ?? "") !== "";
  return noColor
    ? { GREEN: "", CYAN: "", YELLOW: "", RED: "", NC: "" }
    : { GREEN: "\x1b[0;32m", CYAN: "\x1b[0;36m", YELLOW: "\x1b[0;33m", RED: "\x1b[0;31m", NC: "\x1b[0m" };
}
function ok(line: string, p = palette()): void {
  process.stdout.write(`${p.GREEN}[roll]${p.NC} ${line}\n`);
}
function info(line: string, p = palette()): void {
  process.stdout.write(`${p.CYAN}[roll]${p.NC} ${line}\n`);
}
function err(line: string, p = palette()): void {
  process.stderr.write(`${p.RED}[roll]${p.NC} ${line}\n`);
}

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

// ─── path resolution ──────────────────────────────────────────────────────────

/** <rt>/state-<slug>.yaml — rt from loopRuntimeDir, else <shared>/loop. */
export function stateFile(slug: string): string {
  const rt = loopRuntimeDir(slug) ?? join(sharedRoot(), "loop");
  return join(rt, `state-${slug}.yaml`);
}

/** <rt>/mute-<slug> — same rt resolution as the state file. */
export function muteFile(slug: string): string {
  const rt = loopRuntimeDir(slug) ?? join(sharedRoot(), "loop");
  return join(rt, `mute-${slug}`);
}

/** ${ROLL_LOOP_DIR:-<shared>/loop}/heal — bin/roll `_loop_heal_dir` (11454). */
export function healDir(): string {
  const base = (process.env["ROLL_LOOP_DIR"] ?? "").trim() || join(sharedRoot(), "loop");
  return join(base, "heal");
}

// ─── commands ─────────────────────────────────────────────────────────────────

/**
 * `roll loop reset` — clear the per-project loop state + heal counters so the
 * next cycle starts fresh. The most-pointed-to recovery path (ALERT messages,
 * stale-lock self-heal, tcr.ts error hints all steer here). Mirrors bin/roll
 * `_loop_reset` (10444): rm state-<slug>.yaml (report which branch), then
 * rm -rf the heal dir unconditionally.
 */
export function loopResetCommand(_args: string[] = []): number {
  const slug = projectSlug();
  const state = stateFile(slug);
  if (existsSync(state)) {
    rmSync(state, { force: true });
    ok(msg("loop.loop_state_cleared_will_start_fresh"));
  } else {
    info(msg("loop.no_loop_state_to_clear"));
  }
  rmSync(healDir(), { recursive: true, force: true });
  return 0;
}

/**
 * `roll loop mute` — suppress the auto-attach popup. The marker file's presence
 * makes run-once (and the peer popup gate) skip the Terminal popup on the next
 * fire; loop output still flows to tmux + log. Mirrors `_loop_mute` (10457):
 * mkdir -p the parent, then truncate-create the marker.
 */
export function loopMuteCommand(_args: string[] = []): number {
  const slug = projectSlug();
  const file = muteFile(slug);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "");
  ok(msg("loop.muted_auto_attach_disabled"));
  return 0;
}

/**
 * `roll loop unmute` — re-enable the auto-attach popup. Mirrors `_loop_unmute`
 * (10464): rm -f the marker.
 */
export function loopUnmuteCommand(_args: string[] = []): number {
  const slug = projectSlug();
  rmSync(muteFile(slug), { force: true });
  ok(msg("loop.unmuted_auto_attach_live"));
  return 0;
}

export { err as _err, info as _info, ok as _ok, palette as _palette };
