#!/usr/bin/env bats
# US-QA-012: loop test-quality gate scans changed test files for rubric
# ❼ (inline external-tool behaviour) and ❽ (file-outside-repo refs)
# violations. Returns non-zero so loop auto-merge stays blocked.

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"
GATE="${BATS_TEST_DIRNAME}/../../lib/test_quality_gate.py"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
}

teardown() { cd /; rm -rf "$TEST_TMP"; }

# -- ❼ inline-external-tool detection ---------------------------------------

@test "gate: clean test passes" {
  cat > t.bats <<'BATS'
@test "x" {
  source "$ROLL"
  run _project_helper foo
  [ "$status" -eq 0 ]
}
BATS
  run python3 "$GATE" t.bats
  [ "$status" -eq 0 ]
}

@test "gate: ❼ inline sed pipeline flagged" {
  cat > t.bats <<'BATS'
@test "x" {
  result=$(echo "$output" | sed 's/.*<string>\(.*\)<\/string>.*/\1/')
  [ -n "$result" ]
}
BATS
  run python3 "$GATE" t.bats
  [ "$status" -ne 0 ]
  [[ "$output" == *"❼"* ]] || [[ "$output" == *"inline"* ]]
}

@test "gate: ❼ inline awk pipeline flagged" {
  cat > t.bats <<'BATS'
@test "x" {
  count=$(cat file | awk '{ print $1 }' | sort | uniq -c)
}
BATS
  run python3 "$GATE" t.bats
  [ "$status" -ne 0 ]
}

@test "gate: ❼ inline grep -o + sed pipeline flagged" {
  cat > t.bats <<'BATS'
@test "x" {
  id=$(echo "$content" | grep -oE 'ID:[a-z0-9]+' | sed 's/ID://')
}
BATS
  run python3 "$GATE" t.bats
  [ "$status" -ne 0 ]
}

@test "gate: ❼ single grep is fine (not a multi-tool pipeline)" {
  cat > t.bats <<'BATS'
@test "x" {
  grep -q "expected" "$output_file"
}
BATS
  run python3 "$GATE" t.bats
  [ "$status" -eq 0 ]
}

# -- ❽ file-outside-repo detection -----------------------------------------

@test "gate: ❽ ~/.codex path flagged" {
  cat > t.bats <<'BATS'
@test "x" {
  echo "test" > ~/.codex/config
}
BATS
  run python3 "$GATE" t.bats
  [ "$status" -ne 0 ]
  [[ "$output" == *"❽"* ]] || [[ "$output" == *"outside"* ]]
}

@test "gate: ❽ ~/.kimi path flagged" {
  cat > t.bats <<'BATS'
@test "x" {
  ls ~/.kimi-code/
}
BATS
  run python3 "$GATE" t.bats
  [ "$status" -ne 0 ]
}

@test "gate: ❽ ~/.roll path in test assertion flagged" {
  cat > t.bats <<'BATS'
@test "x" {
  [ -f ~/.roll/config.yaml ]
}
BATS
  run python3 "$GATE" t.bats
  [ "$status" -ne 0 ]
}

@test "gate: ❽ BATS_TMPDIR is the safe pattern (not flagged)" {
  cat > t.bats <<'BATS'
@test "x" {
  mkdir -p "$BATS_TMPDIR/sandbox"
  HOME="$BATS_TMPDIR/sandbox" run _do_thing
}
BATS
  run python3 "$GATE" t.bats
  [ "$status" -eq 0 ]
}

@test "gate: ❽ /etc/ system path flagged" {
  cat > t.bats <<'BATS'
@test "x" {
  cat /etc/hostname
}
BATS
  run python3 "$GATE" t.bats
  [ "$status" -ne 0 ]
}

# -- Multi-file mode + output --------------------------------------------

@test "gate: multi-file scan reports each file" {
  cat > a.bats <<'BATS'
@test "a" { result=$(echo "$x" | sed 's/.*//' | awk '{print}'); }
BATS
  cat > b.bats <<'BATS'
@test "b" { [ -f ~/.codex/c ]; }
BATS
  run python3 "$GATE" a.bats b.bats
  [ "$status" -ne 0 ]
  [[ "$output" == *"a.bats"* ]]
  [[ "$output" == *"b.bats"* ]]
}

@test "gate: --skip-test-quality bypass returns 0 (US-QA-013 hook)" {
  cat > t.bats <<'BATS'
@test "x" { result=$(echo "$x" | sed 's/.*//' | awk '{print}'); }
BATS
  run python3 "$GATE" --skip t.bats
  [ "$status" -eq 0 ]
}

@test "gate: comments / heredoc text do not trip the detector" {
  cat > t.bats <<'BATS'
# This test does not use sed | awk pipelines.
# The rubric ❼ describes sed|awk|grep|find inline behaviour.
@test "x" {
  cat <<'EOF' > sample
This file has sed | awk in plain text but it's not code.
EOF
  [ -f sample ]
}
BATS
  run python3 "$GATE" t.bats
  [ "$status" -eq 0 ]
}

# Sanity: bin/roll exposes the gate subcommand
@test "bin/roll: roll loop test-quality-check is recognized" {
  source "$ROLL"
  declare -F _loop_test_quality_check >/dev/null
}
