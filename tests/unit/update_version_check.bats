#!/usr/bin/env bats

load helpers
setup() {
  unit_setup
  mkdir -p "$TEST_TMP/bin" "$TEST_TMP/modules/@seanyao/roll/bin"
}
teardown() { unit_teardown; }

_make_npm_stub() {
  local registry_ver="$1"
  local installed_ver="$2"
  cat > "$TEST_TMP/modules/@seanyao/roll/bin/roll" <<ROLLEOF
VERSION="$installed_ver"
ROLLEOF
  cat > "$TEST_TMP/bin/npm" <<NPMEOF
#!/bin/bash
case "\$1" in
  view)    echo "$registry_ver" ;;
  root)    echo "$TEST_TMP/modules" ;;
  install) : ;;
  cache)   : ;;
esac
NPMEOF
  chmod +x "$TEST_TMP/bin/npm"
}

@test "_check_installed_version_or_retry: no-op when versions match" {
  _make_npm_stub "2026.507.2" "2026.507.2"
  PATH="$TEST_TMP/bin:$PATH" run _check_installed_version_or_retry
  [ "$status" -eq 0 ]
  [[ "$output" != *"mismatch"* ]]
}

@test "_check_installed_version_or_retry: warns and retries on mismatch" {
  _make_npm_stub "2026.507.2" "2026.507.1"
  PATH="$TEST_TMP/bin:$PATH" run _check_installed_version_or_retry
  [ "$status" -eq 0 ]
  [[ "$output" == *"mismatch"* ]] || [[ "$output" == *"Version mismatch"* ]]
}

@test "_check_installed_version_or_retry: silent when npm view unavailable" {
  # npm not in PATH → graceful skip
  PATH="/usr/bin:/bin" run _check_installed_version_or_retry
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "_notify_update: exits 0 when update cache is missing" {
  ROLL_HOME="$TEST_TMP/no-roll-home"
  run _notify_update
  [ "$status" -eq 0 ]
}

@test "FIX-163: _notify_update nags when GitHub latest differs, even if semver-lower (Jan-1 MMDD wrap)" {
  ROLL_HOME="$TEST_TMP/rh"; mkdir -p "$ROLL_HOME"
  # GitHub releases/latest (chronological) = 2.101.1 (new year), running = 2.1231.5 (last year).
  # sort -V would rank 2.1231.5 higher and (old behavior) suppress the update — must NOT.
  # FIX-170: cache carries the writer version (3rd field); same writer → nag stands.
  printf '111 2.101.1 2.1231.5\n' > "$ROLL_HOME/.update-check"
  VERSION="2.1231.5" run _notify_update
  [ "$status" -eq 0 ]
  [[ "$output" == *"2.101.1"* ]]
}

@test "FIX-163: _notify_update silent when GitHub latest matches running version" {
  ROLL_HOME="$TEST_TMP/rh"; mkdir -p "$ROLL_HOME"
  printf '111 2.602.1\n' > "$ROLL_HOME/.update-check"
  VERSION="2.602.1" run _notify_update
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "FIX-166: _invalidate_update_cache removes the stale update-check file" {
  ROLL_HOME="$TEST_TMP/rh"; mkdir -p "$ROLL_HOME"
  printf '111 2.602.1\n' > "$ROLL_HOME/.update-check"
  [ -f "$ROLL_HOME/.update-check" ]
  run _invalidate_update_cache
  [ "$status" -eq 0 ]
  [ ! -f "$ROLL_HOME/.update-check" ]
}

@test "FIX-166: after cache invalidation _notify_update is silent (no reverse-nag)" {
  # Cache holds an older latest (2.602.1) written by the SAME running version —
  # a legit FIX-163 nag. After invalidation the file is gone → silent.
  ROLL_HOME="$TEST_TMP/rh"; mkdir -p "$ROLL_HOME"
  printf '111 2.602.1 2.602.2\n' > "$ROLL_HOME/.update-check"
  VERSION="2.602.2" run _notify_update
  [[ "$output" == *"2.602.1"* ]]          # same-writer nag exists before invalidation
  _invalidate_update_cache
  VERSION="2.602.2" run _notify_update
  [ "$status" -eq 0 ]
  [ -z "$output" ]                         # silent after invalidation
}

@test "FIX-166: _invalidate_update_cache is a no-op when cache already absent" {
  ROLL_HOME="$TEST_TMP/rh-empty"; mkdir -p "$ROLL_HOME"
  run _invalidate_update_cache
  [ "$status" -eq 0 ]
}

# ── FIX-170: bind the cache to the binary version that wrote it ──────────────
# FIX-166 only invalidates via the NEW binary's cmd_update; an upgrade executed
# by an old binary (or out-of-band: npm -g / brew / git) leaves a stale cache
# that reverse-nags for up to 24h. A writer-version mismatch must mean "stale".

_stub_curl_release() {
  # GitHub releases/latest stub → tag_name v$1
  cat > "$TEST_TMP/bin/curl" <<CURLEOF
#!/bin/bash
echo '"tag_name": "v$1",'
CURLEOF
  chmod +x "$TEST_TMP/bin/curl"
}

@test "FIX-170: _notify_update silent when cache was written by a different binary version" {
  # Reproduces the live bug: cache '… 2.602.2 2.602.2' written pre-upgrade,
  # now running 2.602.4 → must NOT reverse-nag 2.602.2.
  ROLL_HOME="$TEST_TMP/rh"; mkdir -p "$ROLL_HOME"
  printf '111 2.602.2 2.602.2\n' > "$ROLL_HOME/.update-check"
  VERSION="2.602.4" run _notify_update
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "FIX-170: _notify_update silent on legacy 2-field cache (no writer version)" {
  # Pre-FIX-170 cache format has no 3rd field → treated as written by an
  # unknown (different) version → silent, async refetch repopulates.
  ROLL_HOME="$TEST_TMP/rh"; mkdir -p "$ROLL_HOME"
  printf '111 2.602.2\n' > "$ROLL_HOME/.update-check"
  VERSION="2.602.4" run _notify_update
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "FIX-170: _check_update_async refetches within TTL when writer version differs" {
  ROLL_HOME="$TEST_TMP/rh"; mkdir -p "$ROLL_HOME"
  _stub_curl_release "9.999.9"
  # Fresh timestamp (inside 24h TTL) but written by another binary version.
  printf '%s 2.602.2 2.602.2\n' "$(date +%s)" > "$ROLL_HOME/.update-check"
  VERSION="2.602.4"
  PATH="$TEST_TMP/bin:$PATH" _check_update_async >/dev/null 2>&1
  # Fetch runs as a disowned background job — poll for the rewrite.
  local i
  for i in $(seq 1 30); do
    grep -q "9.999.9" "$ROLL_HOME/.update-check" 2>/dev/null && break
    sleep 0.1
  done
  run cat "$ROLL_HOME/.update-check"
  [[ "$output" == *" 9.999.9 2.602.4" ]]   # new latest + writer version stamped
}

@test "FIX-170: failed fetch writes '-' placeholder, _notify_update stays silent, TTL holds" {
  ROLL_HOME="$TEST_TMP/rh"; mkdir -p "$ROLL_HOME"
  cat > "$TEST_TMP/bin/curl" <<'CURLEOF'
#!/bin/bash
exit 22
CURLEOF
  chmod +x "$TEST_TMP/bin/curl"
  VERSION="2.602.4"
  PATH="$TEST_TMP/bin:$PATH" _check_update_async >/dev/null 2>&1
  local i
  for i in $(seq 1 30); do
    [ -s "$ROLL_HOME/.update-check" ] && break
    sleep 0.1
  done
  run cat "$ROLL_HOME/.update-check"
  [[ "$output" == *" - 2.602.4" ]]         # placeholder + writer stamped → TTL holds next run
  VERSION="2.602.4" run _notify_update
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "FIX-170: _check_update_async respects TTL when writer version matches" {
  ROLL_HOME="$TEST_TMP/rh"; mkdir -p "$ROLL_HOME"
  _stub_curl_release "9.999.9"
  local stamp; stamp="$(date +%s)"
  printf '%s 2.602.2 2.602.4\n' "$stamp" > "$ROLL_HOME/.update-check"
  VERSION="2.602.4"
  PATH="$TEST_TMP/bin:$PATH" _check_update_async >/dev/null 2>&1
  sleep 0.5
  run cat "$ROLL_HOME/.update-check"
  [[ "$output" == "$stamp 2.602.2 2.602.4" ]]   # untouched — no refetch inside TTL
}
