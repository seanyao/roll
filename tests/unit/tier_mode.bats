#!/usr/bin/env bats
# US-QA-007: fast/slow tier classification + run.sh --tier flag.
# bats tier: fast

load helpers

setup() {
  unit_setup
  # shellcheck source=../helpers/tier.bash
  source "${BATS_TEST_DIRNAME}/../helpers/tier.bash"
}
teardown() { unit_teardown; }

@test "roll_tier_classify: integration path is always slow" {
  local f="${TEST_TMP}/sample.bats"
  echo '#!/usr/bin/env bats' > "$f"
  # Simulate an integration path by writing to a subdir matching the pattern.
  mkdir -p "${TEST_TMP}/tests/integration"
  cp "$f" "${TEST_TMP}/tests/integration/foo.bats"
  run roll_tier_classify "${TEST_TMP}/tests/integration/foo.bats"
  [ "$status" -eq 0 ]
  [ "$output" = "slow" ]
}

@test "roll_tier_classify: explicit fast header overrides" {
  local f="${TEST_TMP}/x.bats"
  cat > "$f" <<EOF
#!/usr/bin/env bats
# bats tier: fast
@test "x" { :; }
EOF
  run roll_tier_classify "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "fast" ]
}

@test "roll_tier_classify: explicit slow header overrides" {
  local f="${TEST_TMP}/x.bats"
  cat > "$f" <<EOF
#!/usr/bin/env bats
# bats tier: slow
@test "x" { :; }
EOF
  run roll_tier_classify "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "slow" ]
}

@test "roll_tier_classify: file with launchctl reference is slow" {
  local f="${TEST_TMP}/x.bats"
  cat > "$f" <<EOF
#!/usr/bin/env bats
@test "x" {
  launchctl list >/dev/null
}
EOF
  run roll_tier_classify "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "slow" ]
}

@test "roll_tier_classify: file with sleep 5 or longer is slow" {
  local f="${TEST_TMP}/x.bats"
  cat > "$f" <<EOF
#!/usr/bin/env bats
@test "x" {
  sleep 10
}
EOF
  run roll_tier_classify "$f"
  [ "$output" = "slow" ]
}

@test "roll_tier_classify: short sleep (< 5s) does NOT auto-mark slow" {
  local f="${TEST_TMP}/x.bats"
  cat > "$f" <<EOF
#!/usr/bin/env bats
@test "x" {
  sleep 1
  sleep 2
}
EOF
  run roll_tier_classify "$f"
  [ "$output" = "fast" ]
}

@test "roll_tier_classify: default is fast" {
  local f="${TEST_TMP}/x.bats"
  cat > "$f" <<EOF
#!/usr/bin/env bats
@test "x" { :; }
EOF
  run roll_tier_classify "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "fast" ]
}

@test "roll_tier_classify: missing file defaults to fast" {
  run roll_tier_classify "${TEST_TMP}/does-not-exist.bats"
  [ "$status" -eq 0 ]
  [ "$output" = "fast" ]
}

@test "roll_tier_filter: 'fast' selects only fast files" {
  local a="${TEST_TMP}/fast.bats"
  local b="${TEST_TMP}/slow.bats"
  echo '# bats tier: fast' > "$a"
  echo '# bats tier: slow' > "$b"
  out=$(printf '%s\n%s\n' "$a" "$b" | roll_tier_filter fast)
  [ "$out" = "$a" ]
}

@test "roll_tier_filter: 'slow' selects only slow files" {
  local a="${TEST_TMP}/fast.bats"
  local b="${TEST_TMP}/slow.bats"
  echo '# bats tier: fast' > "$a"
  echo '# bats tier: slow' > "$b"
  out=$(printf '%s\n%s\n' "$a" "$b" | roll_tier_filter slow)
  [ "$out" = "$b" ]
}

@test "roll_tier_filter: 'all' lets everything through" {
  local a="${TEST_TMP}/fast.bats"
  local b="${TEST_TMP}/slow.bats"
  echo '# bats tier: fast' > "$a"
  echo '# bats tier: slow' > "$b"
  local n
  n=$(printf '%s\n%s\n' "$a" "$b" | roll_tier_filter all | wc -l | tr -d ' ')
  [ "$n" = "2" ]
}

@test "run.sh --tier=bogus fails with clear message" {
  run bash "${BATS_TEST_DIRNAME}/../run.sh" --tier=bogus
  [ "$status" -ne 0 ]
  [[ "$output" == *"must be one of fast|slow|all"* ]]
}

@test "run.sh --tier flag accepts equals and space form" {
  # We can't fully run the suite here (would recurse). Just ensure parsing
  # doesn't reject the flag form. Use --tier=fast --dry-run won't work here
  # without --affected; instead check the parser via direct grep on the file.
  grep -q -- '--tier=\*' "${BATS_TEST_DIRNAME}/../run.sh"
  grep -q -- '--tier)' "${BATS_TEST_DIRNAME}/../run.sh"
}
