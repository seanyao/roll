#!/usr/bin/env bats

setup() {
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  TEST_TMP="$(mktemp -d)"
  TPL_DIR="$TEST_TMP/tpl"
  OUT_DIR="$TEST_TMP/out"
  mkdir -p "$TPL_DIR" "$OUT_DIR"
  _ROLL_MERGE_SUMMARY=()
}

teardown() {
  rm -rf "$TEST_TMP"
}

@test "merge: section with different content prompts and updates when user selects u" {
  # Template has ## Foo with content A
  cat > "$TPL_DIR/AGENTS.md" <<'EOF'
## Foo

Content from template A

## Bar

Bar content
EOF

  # Existing file has ## Foo with different content B
  cat > "$OUT_DIR/AGENTS.md" <<'EOF'
## Foo

Content from user B

## Bar

Bar content
EOF

  # Write stdin responses to a temp file to avoid pipe subshell isolation
  local stdin_file="$TEST_TMP/stdin.txt"
  printf 'M\nu\nk\n' > "$stdin_file"

  # Call merge_convention with stdin redirected from file (runs in current shell, not subshell)
  WK_GLOBAL="/dev/null_nonexistent" merge_convention 'AGENTS.md' "$TPL_DIR" "$OUT_DIR" < "$stdin_file"

  # The ## Foo section should now have template content
  grep -q "Content from template A" "$OUT_DIR/AGENTS.md"
}

@test "merge: section with different content keeps original when user selects k" {
  # Template has ## Foo with content A
  cat > "$TPL_DIR/AGENTS.md" <<'EOF'
## Foo

Content from template A

## Bar

Bar content
EOF

  # Existing file has ## Foo with different content B
  cat > "$OUT_DIR/AGENTS.md" <<'EOF'
## Foo

Content from user B

## Bar

Bar content
EOF

  # Write stdin responses to a temp file to avoid pipe subshell isolation
  local stdin_file="$TEST_TMP/stdin.txt"
  printf 'M\nk\nk\n' > "$stdin_file"

  # Call merge_convention with stdin redirected from file (runs in current shell, not subshell)
  WK_GLOBAL="/dev/null_nonexistent" merge_convention 'AGENTS.md' "$TPL_DIR" "$OUT_DIR" < "$stdin_file"

  # The ## Foo section should still have user content
  grep -q "Content from user B" "$OUT_DIR/AGENTS.md"
}
