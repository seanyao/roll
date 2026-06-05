/**
 * `roll ci` — TS port of bin/roll cmd_ci (14390-14416) plus the `_gh_available`
 * probe (10987). Reports the GitHub Actions run status for the current HEAD
 * commit.
 *
 * PORTED (the full read surface, no flags / `--timeout=N` without `--wait`):
 *   - gh-not-installed → warn + exit 0
 *   - not-a-git-repo (git rev-parse HEAD fails) → err + exit 1
 *   - `gh run list` failure → warn "gh run list failed" + exit 0
 *   - empty / "[]" runs → "No CI runs for <short-sha>" + exit 0
 *   - otherwise one line per run: "<name>: <status>/<conclusion>" (the bash
 *     `jq -r '.[] | "\(.name): \(.status)/\(.conclusion)"'`, with a null
 *     conclusion rendered literally as `null`, matching jq's string interp).
 *   - unknown argument → usage err + exit 1.
 *
 * FALLBACK — `--wait` (the CI gate): `_ci_wait` (11003-11071) is a 15s-interval
 * polling loop with `sleep`, open-PR detection, and repo-slug resolution. It's a
 * long-running, network-bound wait with no deterministic terminal output, so it
 * stays on the frozen bash implementation (returns null from this handler so the
 * index.ts wrapper shells `bin/roll ci --wait …`). Reason: porting it buys no
 * surface coverage a difftest could pin without faking the passage of time and a
 * live run lifecycle; the read surface above is what `roll ci` is for.
 */
import { spawnSync } from "node:child_process";
import { resolveLang, t, v2Catalog, type Lang } from "@roll/spec";
import { onPath } from "./setup-shared.js";

// ─── bash UI helpers (bin/roll:41-56) ────────────────────────────────────────
function pal(): { YELLOW: string; RED: string; NC: string } {
  const noColor = (process.env["NO_COLOR"] ?? "") !== "";
  return noColor
    ? { YELLOW: "", RED: "", NC: "" }
    : { YELLOW: "\x1b[0;33m", RED: "\x1b[0;31m", NC: "\x1b[0m" };
}
/** warn(): YELLOW [roll] line to STDOUT (echo, no redirect). */
function warn(line: string): void {
  const { YELLOW, NC } = pal();
  process.stdout.write(`${YELLOW}[roll]${NC} ${line}\n`);
}
/** err(): RED [roll] line to STDERR. */
function err(line: string): void {
  const { RED, NC } = pal();
  process.stderr.write(`${RED}[roll]${NC} ${line}\n`);
}

function msgLang(): Lang {
  return resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });
}
function m(key: string, ...args: Array<string | number>): string {
  return t(v2Catalog, msgLang(), key, ...args);
}

// ─── _gh_available (10987) ────────────────────────────────────────────────────
function ghAvailable(): boolean {
  return onPath("gh");
}

interface CiRun {
  name?: unknown;
  status?: unknown;
  conclusion?: unknown;
}

/** jq's `\(.x)` string interpolation: null → "null", strings verbatim. */
function jqInterp(v: unknown): string {
  if (v === null || v === undefined) return "null";
  return String(v);
}

/**
 * cmd_ci (14390). Returns the exit code, or `null` to signal the caller to fall
 * back to bash (the `--wait` CI-gate path is bash-owned).
 */
export function ciCommand(args: string[]): number | null {
  // Arg parse mirrors the bash `while` loop: --wait / --timeout=N / else error.
  let waitMode = false;
  for (const a of args) {
    if (a === "--wait") {
      waitMode = true;
    } else if (a.startsWith("--timeout=")) {
      // accepted; only consulted by the (bash-owned) --wait path.
    } else {
      err(m("ci.usage_roll_ci_wait_timeout_n"));
      return 1;
    }
  }

  if (waitMode) return null; // _ci_wait stays on bash (see header).

  if (!ghAvailable()) {
    warn(m("ci.gh_not_installed_gh"));
    return 0;
  }

  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (head.status !== 0) {
    err(m("ci.not_a_git_repo"));
    return 1;
  }
  const commit = (head.stdout ?? "").trim();

  const run = spawnSync(
    "gh",
    ["run", "list", "--commit", commit, "--json", "status,conclusion,name"],
    { encoding: "utf8" },
  );
  if (run.status !== 0) {
    warn("gh run list failed");
    return 0;
  }
  const runs = (run.stdout ?? "").trim();
  if (runs === "" || runs === "[]") {
    process.stdout.write(m("ci.no_ci_runs_for_git_rev", commit.slice(0, 7)) + "\n");
    return 0;
  }

  let parsed: CiRun[];
  try {
    parsed = JSON.parse(runs) as CiRun[];
  } catch {
    // Malformed JSON would crash jq too; the oracle never reaches here for a
    // status-0 gh, so treat it as the empty case (defensive, no observed path).
    process.stdout.write(m("ci.no_ci_runs_for_git_rev", commit.slice(0, 7)) + "\n");
    return 0;
  }
  for (const r of parsed) {
    process.stdout.write(`${jqInterp(r.name)}: ${jqInterp(r.status)}/${jqInterp(r.conclusion)}\n`);
  }
  return 0;
}
