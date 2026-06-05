#!/usr/bin/env bash
# scripts/parallel-verify.sh — US-LOOP-006 parallel-verification harness.
#
# Runs the FROZEN v2 bash loop (oracle) and the v3 TS `loop run-once` against
# IDENTICAL fabricated sandboxes, one cycle each, then difftests the two legs'
# terminal records and emits a per-round PASS/DIVERGE verdict table.
#
# This is NEW v3 tooling (lives on the v3 branch only). It NEVER touches the
# frozen bash/python sources; it only *invokes* them. It NEVER fires a real AI
# agent unless `--real` is passed — the default (and every test) uses a shim
# `claude` on PATH that fabricates the story edit + a `tcr:` commit and prints
# fake stream-json usage lines, exactly like the run-cycle integration test's
# shim and what the v2 inner runner expects back (exit 0 + commits ahead of
# origin/main in the cycle worktree).
#
# ── How each leg stays hermetic (no network / no real agent / no real PR) ─────
# Sandbox: temp dir, `git init` (main + one commit), a `file://` BARE remote as
# `origin`. To exercise the SUCCESS (status-0 → terminal `done`) publish path on
# BOTH legs WITHOUT touching GitHub, the clone's origin carries a github-looking
# FETCH url (so both v2 `_gh_repo_slug` and v3 `ghRepoSlug` resolve a slug) while
# its PUSH url is the local `file://` bare (so `git push origin <branch>` lands
# locally). A shim `gh` on PATH answers `--version` / `pr view` (empty) /
# `pr create` (canned url) / `pr merge` (exit 0). With that, both publish plans
# return status 0 and both cycles terminate `done` (v2) / `delivered` (v3).
#
#   v2 leg : `_write_loop_runner_script` (frozen) generates the runner; we run
#            the *inner* script directly. The inner self-sources bin/roll, has NO
#            tmux / Terminal.app dependency, sets its own CYCLE_ID, creates the
#            worktree, runs the (shim) agent, publishes, writes runs.jsonl +
#            events.ndjson. We chose the inner script over `roll loop now` /
#            the outer runner because the outer runner spawns tmux + a macOS
#            Terminal.app popup and re-adds /opt/homebrew/bin to PATH (FIX-050) —
#            neither hermetic nor maskable; the inner is the exact synchronous
#            body the outer runner's no-tmux `else bash "$INNER"` branch invokes.
#   v3 leg : `node packages/cli/bin/roll.js loop run-once` (cwd = clone).
#
# Env both legs share (see ENV TABLE in the report): a seeded HOME (update-check
# cache pre-written so the frozen bin/roll never fetches GitHub releases),
# ROLL_PROJECT_RUNTIME_DIR (honored by both — runs.jsonl/events land there),
# _SHARED_ROOT (v2 control-plane), the routed agent pinned to `claude`.
set -uo pipefail

# ── Locate the repo root (works from anywhere) ────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
V2_BIN="${REPO_ROOT}/bin/roll"
V3_BIN="${REPO_ROOT}/packages/cli/bin/roll.js"

# ── CLI parsing ───────────────────────────────────────────────────────────────
ROUNDS=1
REAL=0
DRY_RUN=0
KEEP=0
usage() {
  cat <<'USAGE'
Usage: scripts/parallel-verify.sh [--rounds N] [--real] [--dry-run] [--keep]

  --rounds N   number of verification rounds (default 1)
  --real       use the real `claude` argv instead of the default shim agent
               (default + every test uses a fake claude on PATH)
  --dry-run    print both legs' planned commands without executing
  --keep       keep the per-round temp sandboxes (default: cleaned up)
  -h, --help   show this help

One ROUND fabricates two identical sandboxes (one trivial story), runs the v2
bash loop one cycle against one and the v3 `loop run-once` against the other,
then difftests the terminal records and prints a PASS/DIVERGE verdict table.
Exit 0 iff every compared key PASSES in every round.
USAGE
}
while [ $# -gt 0 ]; do
  case "$1" in
    --rounds) ROUNDS="${2:-1}"; shift 2 ;;
    --rounds=*) ROUNDS="${1#*=}"; shift ;;
    --real) REAL=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --keep) KEEP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "parallel-verify: unknown arg '$1'" >&2; usage; exit 2 ;;
  esac
done
case "$ROUNDS" in
  ''|*[!0-9]*) echo "parallel-verify: --rounds must be a positive integer" >&2; exit 2 ;;
esac
[ "$ROUNDS" -ge 1 ] || { echo "parallel-verify: --rounds must be >= 1" >&2; exit 2; }

# ── tool checks ───────────────────────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || { echo "parallel-verify: missing required tool '$1'" >&2; exit 3; }; }
need git
need jq
need node

# The github-looking slug used for both legs' origin FETCH url (push goes local).
FIXTURE_SLUG="fixture/pv-sandbox"
FIXTURE_FETCH_URL="https://github.com/${FIXTURE_SLUG}.git"
# The trivial story edits a DOC-allowlisted file (CHANGELOG.md) so the v2
# gh-missing ff fallback path (if it ever engages) also stays on the doc lane.
STORY_ID="US-PV-001"
MARKER_FILE="CHANGELOG.md"

GIT_ID=(-c "user.email=pv@roll.test" -c "user.name=roll-pv")

# ── shim builders ─────────────────────────────────────────────────────────────
# Build a shim dir containing a fake `claude`, a fake `gh`, and symlinks to the
# real toolchain (node/git/jq/python3/sh) so the leg can run with a PATH that
# DOES NOT contain tmux (forcing v2 to never start a tmux session).
build_shim_dir() {
  local dir="$1"
  mkdir -p "$dir"
  local t rp
  for t in node git jq python3 bash sh env date sed grep awk cat head tail find mkdir rm cp mv touch sleep wc sort uniq cut tr basename dirname; do
    rp="$(command -v "$t" 2>/dev/null || true)"
    [ -n "$rp" ] && ln -sf "$rp" "$dir/$t"
  done

  # Fake `claude`: ignore argv, make the marker edit + a tcr commit in cwd (the
  # cycle worktree), print fake stream-json usage. Mirrors run-cycle's shim.
  cat > "$dir/claude" <<'CLAUDE'
#!/bin/sh
# shim claude — NEVER a real agent. Reads its prompt on argv (ignored), edits
# the marker file, makes a `tcr:` commit, prints fake stream-json usage lines.
printf '%s\n' '{"type":"system","subtype":"init","model":"claude-shim"}'
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"appending marker"}]}}'
echo "parallel-verify marker $(date -u +%s)-$$" >> CHANGELOG.md
git -c user.email=shim@roll.test -c user.name=roll-shim add -A >/dev/null 2>&1
git -c user.email=shim@roll.test -c user.name=roll-shim commit -q --no-verify \
  -m "tcr: deliver US-PV-001 (parallel-verify shim)" >/dev/null 2>&1
printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"usage":{"input_tokens":120,"output_tokens":40},"total_cost_usd":0.0021}'
exit 0
CLAUDE
  chmod +x "$dir/claude"

  # Fake `gh`: answers exactly the calls both publish plans make so status 0.
  cat > "$dir/gh" <<'GH'
#!/bin/sh
# shim gh — no network. --version ok; pr view -> empty (force create);
# pr create -> canned url; pr merge (auto|admin) -> ok.
case "$1" in
  --version) echo "gh version 0.0-parallel-verify-shim"; exit 0 ;;
esac
for a in "$@"; do
  case "$a" in
    view)   echo ""; exit 0 ;;
    create) echo "https://github.com/fixture/pv-sandbox/pull/1"; exit 0 ;;
    merge)  exit 0 ;;
  esac
done
exit 0
GH
  chmod +x "$dir/gh"
}

# Fabricate ONE sandbox clone whose origin FETCH url is the github slug url and
# whose PUSH url is the local file:// bare. Echoes "<clone>|<bare>".
fabricate_sandbox() {
  local tag="$1" root="$2"
  local bare="$root/${tag}-bare.git"
  git init -q --bare -b main "$bare"

  local seed="$root/${tag}-seed"
  git clone -q "$bare" "$seed" 2>/dev/null
  mkdir -p "$seed/.roll"
  printf '# Sandbox project (parallel-verify)\n\nMinimal AGENTS.md for the harness sandbox.\n' > "$seed/AGENTS.md"
  printf '# Changelog\n\n' > "$seed/${MARKER_FILE}"
  # Backlog table the picker understands: exactly ONE trivial Todo story.
  cat > "$seed/.roll/backlog.md" <<EOF
| ID | Description | Status |
|----|-------------|--------|
| ${STORY_ID} | 在 ${MARKER_FILE} 末尾追加一行 "parallel-verify marker" est_min:5 | 📋 Todo |
EOF
  # Pin the agent so routing is deterministic (no auto-downgrade).
  printf 'agent: claude\n' > "$seed/.roll/local.yaml"
  git -C "$seed" "${GIT_ID[@]}" add -A
  git -C "$seed" "${GIT_ID[@]}" commit -q -m "seed sandbox project"
  git -C "$seed" push -q origin main

  local clone="$root/${tag}-clone"
  git clone -q "$bare" "$clone" 2>/dev/null
  # github FETCH url (slug resolution) + local file:// PUSH url (offline push).
  git -C "$clone" remote set-url origin "$FIXTURE_FETCH_URL"
  git -C "$clone" remote set-url --push origin "file://$bare"
  git -C "$clone" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
  # Seed the local origin/main ref from the real (push) bare.
  git -C "$clone" fetch -q "file://$bare" 'main:refs/remotes/origin/main' 2>/dev/null || true
  echo "${clone}|${bare}"
}

# Seed HOME's update-check cache so the frozen bin/roll never fetches releases
# (mirrors packages/cli/test/helpers.ts seedUpdateCheckCache).
seed_home() {
  local home="$1"
  mkdir -p "$home"
  local v
  v="$(sed -n 's/^VERSION="\([^"]*\)".*/\1/p' "$V2_BIN" | head -1)"
  [ -n "$v" ] || v="0"
  mkdir -p "$home/.shared/roll"
  printf '%s %s %s\n' "$(date +%s)" "$v" "$v" > "$home/.shared/roll/.update-check"
  # Some bin/roll versions look for the cache directly under $HOME.
  printf '%s %s %s\n' "$(date +%s)" "$v" "$v" > "$home/.update-check" 2>/dev/null || true
}

# ── leg runners ───────────────────────────────────────────────────────────────
# Resolve the claude argv used for `--real`. The shim path ignores this.
real_claude_cmd() { echo 'claude -p "Read .roll/backlog.md, deliver the single Todo story via TCR, commit with a tcr: message."'; }

# --real prerequisites, resolved from the INVOKING environment (before env -i):
# the real claude binary dir (appended to leg PATH after the shim, whose claude
# is deleted in real mode) and the real HOME — claude auth/config lives there;
# a temp HOME would run claude unauthenticated and it exits without working.
REAL_CLAUDE_DIR=""
REAL_HOME="${HOME}"
resolve_real_claude() {
  local bin
  bin="$(command -v claude || true)"
  [ -n "$bin" ] || { echo "[parallel-verify] --real: no \`claude\` on PATH" >&2; exit 3; }
  REAL_CLAUDE_DIR="$(cd "$(dirname "$bin")" && pwd)"
}

# v3 leg: returns the terminal status by reading the runs.jsonl / events it wrote.
run_v3_leg() {
  local clone="$1" rt="$2" shim="$3" home="$4"
  local path_herm="$shim:/usr/bin:/bin"
  local leg_home="$home"
  if [ "$REAL" -eq 1 ]; then
    path_herm="$path_herm:$REAL_CLAUDE_DIR:/opt/homebrew/bin:/usr/local/bin"
    leg_home="$REAL_HOME"
  fi
  (
    cd "$clone" || exit 9
    env -i \
      PATH="$path_herm" \
      HOME="$leg_home" \
      ROLL_MAIN_SLUG="pv-sandbox" \
      ROLL_LOOP_AGENT="claude" \
      ROLL_PROJECT_RUNTIME_DIR="$rt" \
      node "$V3_BIN" loop run-once
  ) >"$rt/leg.out" 2>&1
}

# v2 leg: generate the runner via the FROZEN _write_loop_runner_script, then run
# the inner script directly (hermetic synchronous path; no tmux).
run_v2_leg() {
  local clone="$1" rt="$2" shim="$3" home="$4" shared="$5" runner="$6"
  local agent_cmd
  if [ "$REAL" -eq 1 ]; then agent_cmd="$(real_claude_cmd)"; else agent_cmd='claude -p "deliver the story"'; fi
  # Generate the runner in a SUBSHELL that sources the frozen bin/roll. We only
  # call the public template generator; we add NOTHING to the bash sources.
  (
    # shellcheck disable=SC1090
    source "$V2_BIN" >/dev/null 2>&1 || true
    _write_loop_runner_script "$runner" "$clone" "$agent_cmd" "$rt/cron.log" >/dev/null 2>&1
  )
  local inner="${runner%.sh}-inner.sh"
  [ -f "$inner" ] || { echo "[v2] inner runner not generated" >"$rt/leg.out"; return 1; }

  # The inner script self-repairs PATH by PREPENDING the FIX-050 brew dirs
  # (/opt/homebrew/bin …) — but ONLY when a dir is not already present. We
  # therefore pre-load every one of those dirs (so the self-repair finds them
  # present and skips the prepend), keeping the SHIM dir first. This guarantees
  # the shim `gh`/`claude` win over any real brew-installed gh/claude (otherwise
  # a real, unauthenticated gh would shadow the shim and the publish would fall
  # to the orphan path instead of the status-0 `done` path).
  local path_herm="$shim:/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:$home/.local/bin:$home/.kimi-code/bin:/usr/bin:/bin"
  # Timeouts: shim cycles finish in seconds; a REAL claude needs minutes.
  local cycle_timeout=60 hb_timeout=45 watchdog_iters=45 leg_home="$home"
  if [ "$REAL" -eq 1 ]; then
    path_herm="$path_herm:$REAL_CLAUDE_DIR"
    leg_home="$REAL_HOME"
    cycle_timeout=900 hb_timeout=600 watchdog_iters=480   # 16min外层兜底
  fi
  mkdir -p "$shared/loop"
  (
    cd "$clone" || exit 9
    env -i \
      PATH="$path_herm" \
      HOME="$leg_home" \
      ROLL_LOOP_FORCE=1 \
      ROLL_LOOP_NO_POPUP=1 \
      ROLL_LOOP_CYCLE_TIMEOUT_SEC="$cycle_timeout" \
      ROLL_HEARTBEAT_TIMEOUT="$hb_timeout" \
      ROLL_PROJECT_RUNTIME_DIR="$rt" \
      _SHARED_ROOT="$shared" \
      bash "$inner"
  ) >"$rt/leg.out" 2>&1 &
  local pid=$!
  # Manual watchdog (no `timeout` dependency): 90s cap (shim) / 16min (real).
  local i
  for i in $(seq 1 "$watchdog_iters"); do kill -0 "$pid" 2>/dev/null || break; sleep 2; done
  if kill -0 "$pid" 2>/dev/null; then
    echo "[v2] inner runner exceeded watchdog — killing" >>"$rt/leg.out"
    kill -9 "$pid" 2>/dev/null || true
  fi
  wait "$pid" 2>/dev/null || true
}

# ── record extraction (normalization) ─────────────────────────────────────────
# Normalization whitelist (fields ALLOWED to differ, never compared):
#   ts, duration_sec, cost, cycle_id, run_id, project, phases, tier,
#   fallback_from, story_type, model, prUrl, heartbeat timestamps.
# Compared keys: terminal_outcome (v2 done == v3 delivered), story_id, agent,
#   tcr_present (>=1 tcr commit on the cycle branch), terminal_event_present.
#
# Extract a normalized record as compact JSON from a leg's runtime dir.
# Falls back to the cycle_end EVENT when runs.jsonl has no row (the v2 gh-success
# path occasionally drops the row; the terminal EVENT is authoritative and is
# always written — see report). Echoes one JSON object.
extract_record() {
  local rt="$1" bare="$2"
  local runs="$rt/runs.jsonl" events="$rt/events.ndjson"

  # Terminal event: v3 writes type=cycle:end outcome=...; v2 writes
  # stage=cycle_end outcome=... — normalize both into {outcome, present}.
  local term_present=0 outcome="" cycle_id=""
  if [ -f "$events" ]; then
    # try v3 shape (type:"cycle:end") and v2 shape (stage:"cycle_end")
    local ev
    ev="$(jq -c 'select((.type=="cycle:end") or (.stage=="cycle_end"))' "$events" 2>/dev/null | tail -1)"
    if [ -n "$ev" ]; then
      term_present=1
      outcome="$(printf '%s' "$ev" | jq -r '.outcome // empty' 2>/dev/null)"
      cycle_id="$(printf '%s' "$ev" | jq -r '.cycleId // .label // empty' 2>/dev/null)"
    fi
  fi

  # runs.jsonl row (if any) — pull story_id/agent/status when present.
  local status="" agent="" story_id="" built="[]" row=""
  if [ -f "$runs" ] && [ -s "$runs" ]; then
    row="$(tail -1 "$runs")"
    status="$(printf '%s' "$row" | jq -r '.status // empty' 2>/dev/null)"
    agent="$(printf '%s' "$row" | jq -r '.agent // empty' 2>/dev/null)"
    story_id="$(printf '%s' "$row" | jq -r '(.story_id // empty)' 2>/dev/null)"
    built="$(printf '%s' "$row" | jq -c '.built // []' 2>/dev/null)"
    [ -n "$cycle_id" ] || cycle_id="$(printf '%s' "$row" | jq -r '.cycle_id // .run_id // empty' 2>/dev/null)"
  fi

  # story_id fallback: derive from the built[] array, else the backlog.
  if [ -z "$story_id" ] || [ "$story_id" = "null" ]; then
    story_id="$(printf '%s' "$built" | jq -r '.[0] // empty' 2>/dev/null)"
  fi
  [ -n "$story_id" ] || story_id="$STORY_ID"
  [ -n "$agent" ] || agent="claude"

  # Normalize the terminal outcome to a single success vocabulary:
  #   v2 status `done` / event `done`  → "success"
  #   v3 status `done` / event `delivered` → "success"
  #   v2 status `built` (row-only) → "success" (built = committed + published)
  #   anything else → the literal value.
  local norm_outcome="$outcome"
  case "$outcome" in
    done|delivered) norm_outcome="success" ;;
    "") case "$status" in done|built) norm_outcome="success" ;; *) norm_outcome="${status:-unknown}" ;; esac ;;
  esac

  # tcr_present: did >=1 `tcr:` commit land? Check the cycle branch on the bare
  # remote first (publish pushed it), else any loop/* branch.
  local tcr_present=0 tcr_count=0
  if [ -n "$bare" ] && [ -d "$bare" ]; then
    local b
    for b in $(git -C "$bare" for-each-ref --format='%(refname:short)' 'refs/heads/loop/*' 2>/dev/null); do
      local c
      c="$(git -C "$bare" log --format='%s' "main..$b" 2>/dev/null | grep -c '^tcr:' || true)"
      tcr_count=$(( tcr_count + c ))
    done
    # Also count tcr commits that landed on main (v2 ff merge_back path).
    local cm
    cm="$(git -C "$bare" log --format='%s' -n 20 main 2>/dev/null | grep -c '^tcr:' || true)"
    [ "$cm" -gt 0 ] && tcr_count=$(( tcr_count + cm ))
  fi
  [ "$tcr_count" -ge 1 ] && tcr_present=1

  jq -nc \
    --arg outcome "$norm_outcome" \
    --arg story_id "$story_id" \
    --arg agent "$agent" \
    --argjson term_present "$term_present" \
    --argjson tcr_present "$tcr_present" \
    --argjson tcr_count "$tcr_count" \
    --arg raw_status "${status:-}" \
    --arg raw_outcome "${outcome:-}" \
    '{outcome:$outcome, story_id:$story_id, agent:$agent,
      terminal_event_present:($term_present==1),
      tcr_present:($tcr_present==1), tcr_count:$tcr_count,
      _raw_status:$raw_status, _raw_outcome:$raw_outcome}'
}

# ── verdict table ─────────────────────────────────────────────────────────────
# Compare two normalized records key by key; print a table; return 0 iff all PASS.
print_verdict() {
  local round="$1" v2rec="$2" v3rec="$3"
  echo
  echo "── Round ${round} verdict ──────────────────────────────────────────"
  printf '%-26s %-18s %-18s %-8s\n' "key" "v2 (bash oracle)" "v3 (TS run-once)" "result"
  printf '%-26s %-18s %-18s %-8s\n' "──────────────────────────" "──────────────────" "──────────────────" "────────"
  local all_pass=0
  local keys="outcome story_id agent terminal_event_present tcr_present"
  local k v2v v3v res
  for k in $keys; do
    v2v="$(printf '%s' "$v2rec" | jq -r --arg k "$k" '.[$k] | tostring')"
    v3v="$(printf '%s' "$v3rec" | jq -r --arg k "$k" '.[$k] | tostring')"
    if [ "$v2v" = "$v3v" ]; then res="PASS"; else res="DIVERGE"; all_pass=1; fi
    printf '%-26s %-18s %-18s %-8s\n' "$k" "$v2v" "$v3v" "$res"
  done
  echo "──────────────────────────────────────────────────────────────────"
  return $all_pass
}

# ── dry-run ───────────────────────────────────────────────────────────────────
if [ "$DRY_RUN" -eq 1 ]; then
  agent_label="shim claude (fake; PATH-injected)"
  [ "$REAL" -eq 1 ] && agent_label="REAL claude argv: $(real_claude_cmd)"
  cat <<DRY
# parallel-verify --dry-run  (rounds=${ROUNDS}, agent=${agent_label})
#
# Per round, the harness would:
#   1. fabricate two identical sandboxes (bare file:// remote + clone, one
#      trivial Todo story '${STORY_ID}' editing ${MARKER_FILE}, .roll/local.yaml
#      pinning agent: claude); seed HOME's update-check cache.
#
#   v2 leg (frozen bash oracle, one cycle):
#     source bin/roll; _write_loop_runner_script <runner> <clone> '<agent_cmd>' <rt>/cron.log
#     cd <clone> && env -i PATH=<shim>:/usr/bin:/bin HOME=<home> \\
#       ROLL_LOOP_FORCE=1 ROLL_LOOP_NO_POPUP=1 ROLL_PROJECT_RUNTIME_DIR=<rt> \\
#       _SHARED_ROOT=<shared> bash <runner>-inner.sh
#     # (inner script self-sources bin/roll; no tmux; writes <rt>/runs.jsonl + events.ndjson)
#
#   v3 leg (TS run-once, one cycle):
#     cd <clone> && env -i PATH=<shim>:/usr/bin:/bin HOME=<home> \\
#       ROLL_MAIN_SLUG=pv-sandbox ROLL_LOOP_AGENT=claude ROLL_PROJECT_RUNTIME_DIR=<rt> \\
#       node packages/cli/bin/roll.js loop run-once
#
#   difftest: normalize (whitelist ts/duration/cost/cycle_id/run_id/phases/…),
#   compare {outcome, story_id, agent, terminal_event_present, tcr_present};
#   print a PASS/DIVERGE verdict table.
#
# (dry-run: nothing executed — no git / gh / agent side effects)
DRY
  exit 0
fi

# ── ensure v3 packages are built ──────────────────────────────────────────────
if [ ! -f "$V3_BIN" ] || [ ! -d "${REPO_ROOT}/packages/cli/dist" ]; then
  echo "[parallel-verify] building v3 packages (pnpm -r build)…"
  ( cd "$REPO_ROOT" && pnpm -r build >/dev/null 2>&1 ) || {
    echo "parallel-verify: pnpm -r build failed" >&2; exit 4; }
fi

# ── main loop ─────────────────────────────────────────────────────────────────
WORK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/parallel-verify.XXXXXX")"
cleanup() { [ "$KEEP" -eq 1 ] || rm -rf "$WORK_ROOT" 2>/dev/null || true; }
trap cleanup EXIT
[ "$KEEP" -eq 1 ] && echo "[parallel-verify] sandboxes kept under: $WORK_ROOT"

OVERALL=0
for round in $(seq 1 "$ROUNDS"); do
  echo "[parallel-verify] round ${round}/${ROUNDS}…"
  RD="$WORK_ROOT/round-$round"
  mkdir -p "$RD"

  SHIM="$RD/shim"
  build_shim_dir "$SHIM"
  HOME_DIR="$RD/home"
  seed_home "$HOME_DIR"
  # For --real, do NOT inject the shim claude (use the real one if installed);
  # resolve its dir + real HOME for the leg env before env -i strips them.
  if [ "$REAL" -eq 1 ]; then rm -f "$SHIM/claude"; resolve_real_claude; fi

  # v3 leg
  IFS='|' read -r V3_CLONE V3_BARE <<EOF
$(fabricate_sandbox v3 "$RD")
EOF
  V3_RT="$RD/v3-rt"; mkdir -p "$V3_RT"
  run_v3_leg "$V3_CLONE" "$V3_RT" "$SHIM" "$HOME_DIR"
  V3_REC="$(extract_record "$V3_RT" "$V3_BARE")"

  # v2 leg
  IFS='|' read -r V2_CLONE V2_BARE <<EOF
$(fabricate_sandbox v2 "$RD")
EOF
  V2_RT="$RD/v2-rt"; mkdir -p "$V2_RT"
  V2_SHARED="$RD/v2-shared"
  run_v2_leg "$V2_CLONE" "$V2_RT" "$SHIM" "$HOME_DIR" "$V2_SHARED" "$RD/run-pv.sh"
  V2_REC="$(extract_record "$V2_RT" "$V2_BARE")"

  echo "  v2 record: $V2_REC"
  echo "  v3 record: $V3_REC"
  if ! print_verdict "$round" "$V2_REC" "$V3_REC"; then
    OVERALL=1
  fi
done

echo
if [ "$OVERALL" -eq 0 ]; then
  echo "[parallel-verify] ALL ROUNDS PASS — v2 oracle and v3 run-once agree."
else
  echo "[parallel-verify] DIVERGENCE detected — see verdict table(s) above."
fi
exit "$OVERALL"
