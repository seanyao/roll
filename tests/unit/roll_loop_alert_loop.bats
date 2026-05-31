#!/usr/bin/env bats
# US-AUTO-046 Phase 1: dedicated Alert Loop helpers.
#
# Covers _alert_parse_file (new tagged + legacy formats), _alert_should_notify
# (error always, warn/info 1h dedup), _alert_write_log (JSONL shape),
# _alert_rotate (.prev + empty), and _alert_dispatch (parse→notify→log→rotate).
# _notify is stubbed to record calls; state lives in a sandboxed .roll/state/.

load helpers

setup() {
  unit_setup_cd
  _LOOP_ALERT="${TEST_TMP}/ALERT.md"
  NOTIFY_LOG="${TEST_TMP}/notify.log"
  : > "$NOTIFY_LOG"
  # Stub the macOS notifier so we can assert without osascript.
  _notify() { printf '%s|%s\n' "${1:-}" "${2:-}" >> "$NOTIFY_LOG"; }
  info() { :; }
  warn() { :; }
  _gh_resolve() { printf -v "$1" '%s' "owner/repo"; }
  mkdir -p .roll/state
}
teardown() { unit_teardown_cd; }

# ── _alert_parse_file ─────────────────────────────────────────────────────────

@test "_alert_parse_file: new tagged format extracts ts/level/category/message" {
  printf '[2026-05-26T10:00:00] [error] [TYPE:ci-real-failure] CI failed: run #123\n' > "$_LOOP_ALERT"
  run _alert_parse_file
  [ "$status" -eq 0 ]
  # tab-separated: ts \t level \t category \t message
  [[ "$output" == "2026-05-26T10:00:00	error	ci-real-failure	CI failed: run #123" ]]
}

@test "_alert_parse_file: legacy untagged line defaults to warn/legacy" {
  printf '[2026-05-26T10:00:00] something went sideways\n' > "$_LOOP_ALERT"
  run _alert_parse_file
  [[ "$output" == "2026-05-26T10:00:00	warn	legacy	something went sideways" ]]
}

@test "_alert_parse_file: legacy 'ALERT:' keyword is stripped from message" {
  printf '[2026-05-26T10:00:00] ALERT: disk almost full\n' > "$_LOOP_ALERT"
  run _alert_parse_file
  [[ "$output" == "2026-05-26T10:00:00	warn	legacy	disk almost full" ]]
}

@test "_alert_parse_file: markdown headers and ack footers are skipped" {
  {
    printf '# ALERT\n'
    printf '[2026-05-26T10:00:00] [warn] [TYPE:pr-rebase] PR #42 rebase failed\n'
    printf '\n'
    printf '**Acknowledged**: 2026-05-26 11:00:00\n'
  } > "$_LOOP_ALERT"
  run _alert_parse_file
  # exactly one record survives
  [ "$(printf '%s\n' "$output" | grep -c .)" -eq 1 ]
  [[ "$output" == *"pr-rebase	PR #42 rebase failed"* ]]
}

@test "_alert_parse_file: missing file is a no-op" {
  rm -f "$_LOOP_ALERT"
  run _alert_parse_file
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ── _alert_should_notify ──────────────────────────────────────────────────────

@test "_alert_should_notify: error level always notifies" {
  run _alert_should_notify ci-real-failure error
  [ "$output" = "true" ]
}

@test "_alert_should_notify: warn with no prior log → true" {
  run _alert_should_notify pr-rebase warn
  [ "$output" = "true" ]
}

@test "_alert_should_notify: warn already notified within 1h → false" {
  local now; now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '{"category":"pr-rebase","notified":1,"recorded_at":"%s"}\n' "$now" \
    > .roll/state/alert-log.jsonl
  run _alert_should_notify pr-rebase warn
  [ "$output" = "false" ]
}

@test "_alert_should_notify: warn notified over 1h ago → true" {
  # 2 hours ago, computed portably via the helper's own epoch path.
  local then_epoch then_iso
  then_epoch=$(( $(date -u +%s) - 7200 ))
  then_iso=$(date -u -r "$then_epoch" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
             || date -u -d "@$then_epoch" +%Y-%m-%dT%H:%M:%SZ)
  printf '{"category":"pr-rebase","notified":1,"recorded_at":"%s"}\n' "$then_iso" \
    > .roll/state/alert-log.jsonl
  run _alert_should_notify pr-rebase warn
  [ "$output" = "true" ]
}

@test "_alert_should_notify: info with no prior log → true" {
  run _alert_should_notify loop-idle info
  [ "$output" = "true" ]
}

@test "_alert_should_notify: throttle is per-category (different category → true)" {
  local now; now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '{"category":"pr-rebase","notified":1,"recorded_at":"%s"}\n' "$now" \
    > .roll/state/alert-log.jsonl
  run _alert_should_notify ci-degradation warn
  [ "$output" = "true" ]
}

# ── _alert_write_log ──────────────────────────────────────────────────────────

@test "_alert_write_log: appends a valid JSONL record with notified=1" {
  _alert_write_log "2026-05-26T10:00:00" error ci-real-failure "boom" true
  run cat .roll/state/alert-log.jsonl
  [[ "$output" == *'"level":"error"'* ]]
  [[ "$output" == *'"category":"ci-real-failure"'* ]]
  [[ "$output" == *'"message":"boom"'* ]]
  [[ "$output" == *'"notified":1'* ]]
}

@test "_alert_write_log: notified=false normalizes to 0 and escapes quotes" {
  _alert_write_log "2026-05-26T10:00:00" warn legacy 'say "hi"' false
  run cat .roll/state/alert-log.jsonl
  [[ "$output" == *'"notified":0'* ]]
  [[ "$output" == *'\"hi\"'* ]]
}

# ── _alert_rotate ─────────────────────────────────────────────────────────────

@test "_alert_rotate: creates .prev and empties the original" {
  printf 'line\n' > "$_LOOP_ALERT"
  _alert_rotate
  [ -f "${_LOOP_ALERT}.prev" ]
  [[ "$(cat "${_LOOP_ALERT}.prev")" == "line" ]]
  [ -f "$_LOOP_ALERT" ]
  [ ! -s "$_LOOP_ALERT" ]
}

@test "_alert_rotate: missing source is a no-op (idempotent)" {
  rm -f "$_LOOP_ALERT"
  run _alert_rotate
  [ "$status" -eq 0 ]
  [ ! -f "$_LOOP_ALERT" ]
}

@test "_alert_rotate: a concurrent appender's pre-opened fd is preserved (US-AUTO-046 kimi Q2)" {
  # A producer loop (main/pr/ci) opens its `>>` fd, then the Alert Loop rotates
  # underneath it. With copy+truncate (not mv) the inode at the path is stable,
  # so the producer's subsequent write lands in the LIVE alert file — not lost
  # into .prev. (With the old `mv`, this write would vanish into .prev.)
  printf 'first\n' > "$_LOOP_ALERT"
  exec 9>>"$_LOOP_ALERT"               # producer opens append fd before rotation
  _alert_rotate                        # Alert Loop snapshots + truncates in place
  printf 'second\n' >&9                # producer writes through its pre-opened fd
  exec 9>&-                            # close producer fd
  # The post-rotation write must be readable from the live file next tick.
  [[ "$(cat "$_LOOP_ALERT")" == *"second"* ]]
  # And the snapshot kept the pre-rotation content.
  [[ "$(cat "${_LOOP_ALERT}.prev")" == *"first"* ]]
}

# ── _alert_dispatch ───────────────────────────────────────────────────────────

@test "_alert_dispatch: empty file → no side effects (no rotate, no log)" {
  : > "$_LOOP_ALERT"
  _alert_dispatch
  [ ! -f "${_LOOP_ALERT}.prev" ]
  [ ! -f .roll/state/alert-log.jsonl ]
}

@test "_alert_dispatch: missing file → no-op" {
  rm -f "$_LOOP_ALERT"
  run _alert_dispatch
  [ "$status" -eq 0 ]
}

@test "_alert_dispatch: error notifies immediately, duplicate warn is aggregated" {
  {
    printf '[2026-05-26T10:00:00] [error] [TYPE:ci-real-failure] CI failed\n'
    printf '[2026-05-26T10:00:01] [warn] [TYPE:pr-rebase] rebase failed once\n'
    printf '[2026-05-26T10:00:02] [warn] [TYPE:pr-rebase] rebase failed again\n'
  } > "$_LOOP_ALERT"
  _alert_dispatch
  # error always notifies; the first warn notifies; the second warn is throttled
  # (same category within 1h) → 2 notifications total.
  run wc -l < "$NOTIFY_LOG"
  [ "$output" -eq 2 ]
  # log has all three consumed alerts.
  run wc -l < .roll/state/alert-log.jsonl
  [ "$output" -eq 3 ]
}

@test "_alert_dispatch: rotates the alert file after consuming" {
  printf '[2026-05-26T10:00:00] [info] [TYPE:loop-idle] idle round\n' > "$_LOOP_ALERT"
  _alert_dispatch
  [ -f "${_LOOP_ALERT}.prev" ]
  [ ! -s "$_LOOP_ALERT" ]
}

@test "_alert_dispatch: legacy lines are consumed as warn/legacy and notified" {
  printf '[2026-05-26T10:00:00] plain legacy alert\n' > "$_LOOP_ALERT"
  _alert_dispatch
  run cat "$NOTIFY_LOG"
  [[ "$output" == *"plain legacy alert"* ]]
  run cat .roll/state/alert-log.jsonl
  [[ "$output" == *'"category":"legacy"'* ]]
  [[ "$output" == *'"notified":1'* ]]
}

# ── _alert_log (roll alert log) — US-AUTO-046 Phase 2 read view ────────────────

@test "_alert_log: empty / missing history → friendly notice, no error" {
  rm -f .roll/state/alert-log.jsonl
  run _alert_log
  [ "$status" -eq 0 ]
  [[ "$output" == *"No alert history"* ]]
}

@test "_alert_log: prints records newest-first with notified glyphs" {
  {
    printf '{"ts":"2026-06-01T10:00:00","level":"error","category":"ci-real-failure","message":"CI failed","notified":1,"recorded_at":"2026-06-01T10:00:05Z"}\n'
    printf '{"ts":"2026-06-01T10:01:00","level":"warn","category":"pr-rebase","message":"rebase failed","notified":0,"recorded_at":"2026-06-01T10:01:03Z"}\n'
  } > .roll/state/alert-log.jsonl
  run _alert_log
  [ "$status" -eq 0 ]
  [[ "$output" == *"ci-real-failure"* ]]
  [[ "$output" == *"pr-rebase"* ]]
  # newest (10:01 pr-rebase) appears before oldest (10:00 ci) in the output.
  local first second
  first=$(printf '%s\n' "$output" | grep -n 'pr-rebase' | head -1 | cut -d: -f1)
  second=$(printf '%s\n' "$output" | grep -n 'ci-real-failure' | head -1 | cut -d: -f1)
  [ "$first" -lt "$second" ]
}

@test "_alert_log: honors an explicit count argument" {
  for i in 1 2 3 4 5; do
    printf '{"ts":"2026-06-01T10:0%s:00","level":"info","category":"loop-idle","message":"idle %s","notified":1,"recorded_at":"2026-06-01T10:0%s:01Z"}\n' "$i" "$i" "$i"
  done > .roll/state/alert-log.jsonl
  run _alert_log 2
  [ "$status" -eq 0 ]
  # Only the two most recent messages (idle 5, idle 4) should appear.
  [[ "$output" == *"idle 5"* ]]
  [[ "$output" == *"idle 4"* ]]
  [[ "$output" != *"idle 3"* ]]
}
