#!/usr/bin/env bats
# US-AGENT-024: mechanical fallback resolution (`_loop_resolve_fallback_agent`).
#
# Contract under test: given the primary agent the tier router picked, decide
# the agent the cycle actually runs, driven by US-AGENT-021's availability probe
# (+ cache):
#   - primary online                  → run primary, no fallback (field 2 empty)
#   - primary offline + fallback up    → run fallback, field 2 = original agent
#   - primary offline + fallback down  → ALERT written, exit 2, do not run
# Also: a downed agent lands in the availability cache so the next cycle skips it
# without re-probing, and a stale (expired) cache entry forces a re-probe.
#
# stdout contract: "<chosen_agent> <fallback_from>" — field 1 the agent to run,
# field 2 the original agent when a fallback fired (empty otherwise).

load helpers
setup() { unit_setup_cd; _seed; }
teardown() { unit_teardown_cd; }

# Put stub binaries for every routable agent we touch on PATH so
# _agent_installed_by_name passes; a probe hook then decides online/offline by
# name. agents.yaml supplies the fallback slot.
_seed() {
  mkdir -p "$TEST_TMP/stubbin"
  local a
  for a in claude codex kimi pi qwen; do
    printf '#!/bin/sh\nexit 0\n' > "$TEST_TMP/stubbin/$a"
    chmod +x "$TEST_TMP/stubbin/$a"
  done
  mkdir -p .roll
  cat > .roll/agents.yaml <<'YAML'
schema: v3
easy:     { agent: kimi }
default:  { agent: claude }
hard:     { agent: codex }
fallback: { agent: pi }
YAML
  # Force a fresh probe each call by default; individual cache tests opt back in.
  export ROLL_AGENT_NO_CACHE=1
  export ROLL_AGENT_CACHE_DIR="$TEST_TMP/cache"
  export PATH="$TEST_TMP/stubbin:$PATH"
}

# A probe hook: names listed in OFFLINE_AGENTS probe as offline, the rest online.
_install_probe_hook() {
  cat > "$TEST_TMP/probe.sh" <<'SH'
#!/bin/sh
for off in $OFFLINE_AGENTS; do
  [ "$1" = "$off" ] && exit 1
done
exit 0
SH
  chmod +x "$TEST_TMP/probe.sh"
  export ROLL_AGENT_PROBE_HOOK="$TEST_TMP/probe.sh"
}

# ── primary online → no fallback ─────────────────────────────────────────────

@test "primary online → runs primary, no fallback_from" {
  _install_probe_hook
  OFFLINE_AGENTS="" run _loop_resolve_fallback_agent claude
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | awk '{print $1}')" = "claude" ]
  # field 2 (fallback_from) must be empty — no degradation occurred.
  [ -z "$(echo "$output" | awk '{print $2}')" ]
}

# ── primary offline + fallback online → swap, record fallback_from ───────────

@test "primary offline → runs fallback slot agent, fallback_from = primary" {
  _install_probe_hook
  # The resolver WARNs on stderr when it falls back; assert on stdout only so
  # the route-line contract (field 1 = agent, field 2 = fallback_from) is clean.
  run bash -c "
    source '$ROLL_BIN'
    OFFLINE_AGENTS='claude' _loop_resolve_fallback_agent claude 2>/dev/null
  "
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | awk '{print $1}')" = "pi" ]
  [ "$(echo "$output" | awk '{print $2}')" = "claude" ]
}

# ── primary offline + fallback also offline → ALERT + exit 2 ─────────────────

@test "primary + fallback both offline → ALERT written, exit 2, nothing chosen" {
  _install_probe_hook
  export _LOOP_ALERT="$TEST_TMP/ALERT.md"
  OFFLINE_AGENTS="claude pi" run _loop_resolve_fallback_agent claude
  [ "$status" -eq 2 ]
  [ -f "$TEST_TMP/ALERT.md" ]
  grep -q 'fallback exhausted' "$TEST_TMP/ALERT.md"
  grep -q 'claude' "$TEST_TMP/ALERT.md"
  grep -q 'pi' "$TEST_TMP/ALERT.md"
}

# ── no fallback slot configured + primary offline → ALERT + exit 2 ───────────

@test "primary offline + no fallback slot → ALERT names missing slot, exit 2" {
  _install_probe_hook
  cat > .roll/agents.yaml <<'YAML'
schema: v3
easy:    { agent: kimi }
default: { agent: claude }
YAML
  export _LOOP_ALERT="$TEST_TMP/ALERT.md"
  OFFLINE_AGENTS="claude" run _loop_resolve_fallback_agent claude
  [ "$status" -eq 2 ]
  grep -q 'no fallback slot configured' "$TEST_TMP/ALERT.md"
}

# ── empty primary → bad input ────────────────────────────────────────────────

@test "empty primary → exit 1" {
  run _loop_resolve_fallback_agent ""
  [ "$status" -eq 1 ]
}

# ── unavailable cache: a downed agent is cached so the next cycle skips it ────

@test "downed primary is cached offline → reused without re-probe" {
  _install_probe_hook
  unset ROLL_AGENT_NO_CACHE   # let the cache persist between calls
  # First call probes claude offline, caches it, and falls back to pi.
  run bash -c "
    source '$ROLL_BIN'
    unset ROLL_AGENT_NO_CACHE
    OFFLINE_AGENTS='claude' _loop_resolve_fallback_agent claude 2>/dev/null
  "
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | awk '{print $1}')" = "pi" ]
  # Cache entry must record claude as offline.
  grep -q 'status=offline' "$TEST_TMP/cache/claude"
  # Second call uses a probe hook that would now report claude ONLINE, but the
  # fresh cache entry must win → still falls back to pi (proves cache skip).
  run bash -c "
    source '$ROLL_BIN'
    unset ROLL_AGENT_NO_CACHE
    OFFLINE_AGENTS='' _loop_resolve_fallback_agent claude 2>/dev/null
  "
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | awk '{print $1}')" = "pi" ]
}

@test "stale cache entry → re-probes (expired entry not trusted)" {
  _install_probe_hook
  unset ROLL_AGENT_NO_CACHE
  export ROLL_AGENT_PROBE_TTL=1   # 1-second TTL
  mkdir -p "$TEST_TMP/cache"
  # Seed an ancient offline entry for claude.
  printf 'checked_at=1\nstatus=offline\n' > "$TEST_TMP/cache/claude"
  # With probe now reporting claude ONLINE and the entry far past TTL, the
  # resolver must re-probe and run claude directly (no fallback).
  OFFLINE_AGENTS="" run _loop_resolve_fallback_agent claude
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | awk '{print $1}')" = "claude" ]
  [ -z "$(echo "$output" | awk '{print $2}')" ]
}
