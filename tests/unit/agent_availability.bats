#!/usr/bin/env bats
# US-AGENT-021: local agent detection + cheap online probe (cached).
#
# Covers:
#   - _agents_installed: installed vs not-installed, deepseek excluded
#   - _agent_available: PATH + probe → online; PATH but auth-fail → offline
#   - cache: hit (no re-probe), expiry (re-probe), TTL configurable
#   - bash 3.2 code path (no declare -A / mapfile / ${var^^})

load helpers
setup() {
  unit_setup_cd
  # Sandbox HOME so dir-existence detection is deterministic.
  export HOME="$TEST_TMP/home"
  mkdir -p "$HOME" .roll
  # Project-local cache lands in the sandbox, never the real .roll/cache.
  export ROLL_AGENT_CACHE_DIR="$TEST_TMP/cache"
  # Deterministic PATH: only the fake binaries we create below are visible.
  export FAKE_BIN="$TEST_TMP/bin"
  mkdir -p "$FAKE_BIN"
}
teardown() { unit_teardown_cd; }

# Create a fake CLI on PATH whose `--version` exits with $2 (default 0).
fake_agent() {
  local bin="$1" code="${2:-0}"
  cat > "$FAKE_BIN/$bin" <<EOF
#!/bin/sh
case "\$1" in
  --version) exit $code ;;
esac
exit 0
EOF
  chmod +x "$FAKE_BIN/$bin"
}

# ── _agents_installed ────────────────────────────────────────────────────────

@test "US-AGENT-021 _agents_installed: lists only installed agents" {
  fake_agent claude
  fake_agent pi
  PATH="$FAKE_BIN:/usr/bin:/bin" run _agents_installed
  [ "$status" -eq 0 ]
  echo "$output" | grep -qx claude
  echo "$output" | grep -qx pi
  # codex is not installed → must not appear.
  ! echo "$output" | grep -qx codex
}

@test "US-AGENT-021 _agents_installed: none installed → empty output" {
  PATH="/usr/bin:/bin" run _agents_installed
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "US-AGENT-021 _agents_installed: deepseek never listed (it is a pi model)" {
  # Even with a deepseek binary on PATH, it must not surface as an agent.
  fake_agent deepseek
  PATH="$FAKE_BIN:/usr/bin:/bin" run _agents_installed
  [ "$status" -eq 0 ]
  ! echo "$output" | grep -qx deepseek
}

# ── _agent_available: PATH + probe ───────────────────────────────────────────

@test "US-AGENT-021 _agent_available: on PATH + probe ok → online" {
  fake_agent claude 0
  PATH="$FAKE_BIN:/usr/bin:/bin" run _agent_available claude
  [ "$status" -eq 0 ]
  [ "$output" = "online" ]
}

@test "US-AGENT-021 _agent_available: not on PATH → offline" {
  PATH="/usr/bin:/bin" run _agent_available claude
  [ "$status" -eq 1 ]
  [ "$output" = "offline" ]
}

@test "US-AGENT-021 _agent_available: on PATH but --version fails (auth/network) → offline" {
  # Binary exists, so _agent_installed_by_name passes, but the probe fails:
  # this is the "PATH 有但 auth 失败判 offline" AC case.
  fake_agent claude 1
  PATH="$FAKE_BIN:/usr/bin:/bin" run _agent_available claude
  [ "$status" -eq 1 ]
  [ "$output" = "offline" ]
}

# ── cache: hit / expiry / TTL ────────────────────────────────────────────────

@test "US-AGENT-021 _agent_available: fresh cache is trusted (no re-probe)" {
  # Write a fresh online entry, then make the real probe FAIL. A cache hit
  # must short-circuit before the probe, so the verdict stays online.
  mkdir -p "$ROLL_AGENT_CACHE_DIR"
  now="$(date +%s)"
  printf 'checked_at=%s\nstatus=online\n' "$now" > "$ROLL_AGENT_CACHE_DIR/claude"
  fake_agent claude 1   # probe would say offline if consulted
  PATH="$FAKE_BIN:/usr/bin:/bin" run _agent_available claude
  [ "$status" -eq 0 ]
  [ "$output" = "online" ]
}

@test "US-AGENT-021 _agent_available: expired cache triggers re-probe" {
  # Stale online entry (well past a 60s TTL) → must re-probe, and the probe
  # now reports offline.
  mkdir -p "$ROLL_AGENT_CACHE_DIR"
  old="$(( $(date +%s) - 100000 ))"
  printf 'checked_at=%s\nstatus=online\n' "$old" > "$ROLL_AGENT_CACHE_DIR/claude"
  fake_agent claude 1
  PATH="$FAKE_BIN:/usr/bin:/bin" run _agent_available claude
  [ "$status" -eq 1 ]
  [ "$output" = "offline" ]
}

@test "US-AGENT-021 _agent_available: writes cache after a fresh probe" {
  fake_agent claude 0
  PATH="$FAKE_BIN:/usr/bin:/bin" run _agent_available claude
  [ "$status" -eq 0 ]
  [ -f "$ROLL_AGENT_CACHE_DIR/claude" ]
  grep -q '^status=online$' "$ROLL_AGENT_CACHE_DIR/claude"
  grep -q '^checked_at=[0-9][0-9]*$' "$ROLL_AGENT_CACHE_DIR/claude"
}

@test "US-AGENT-021 _agent_available: TTL configurable via ROLL_AGENT_PROBE_TTL" {
  # Entry is 50s old. With a 10s TTL it is expired (re-probe → offline);
  # with a 1000s TTL it is fresh (trusted → online).
  mkdir -p "$ROLL_AGENT_CACHE_DIR"
  fiftyago="$(( $(date +%s) - 50 ))"
  printf 'checked_at=%s\nstatus=online\n' "$fiftyago" > "$ROLL_AGENT_CACHE_DIR/claude"
  fake_agent claude 1   # re-probe would say offline

  ROLL_AGENT_PROBE_TTL=10 PATH="$FAKE_BIN:/usr/bin:/bin" run _agent_available claude
  [ "$output" = "offline" ]

  printf 'checked_at=%s\nstatus=online\n' "$fiftyago" > "$ROLL_AGENT_CACHE_DIR/claude"
  ROLL_AGENT_PROBE_TTL=1000 PATH="$FAKE_BIN:/usr/bin:/bin" run _agent_available claude
  [ "$output" = "online" ]
}

@test "US-AGENT-021 _agent_available: ROLL_AGENT_PROBE_HOOK overrides the probe" {
  # PATH binary exists; hook forces a verdict regardless of --version.
  fake_agent claude 0
  hook="$TEST_TMP/hook.sh"
  printf '#!/bin/sh\nexit 1\n' > "$hook"   # hook says offline
  chmod +x "$hook"
  ROLL_AGENT_PROBE_HOOK="$hook" PATH="$FAKE_BIN:/usr/bin:/bin" run _agent_available claude
  [ "$status" -eq 1 ]
  [ "$output" = "offline" ]
}
