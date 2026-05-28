#!/usr/bin/env bats
# US-FB-003: feedback target repo precedence
#   1. --repo flag (explicit)
#   2. ROLL_FEEDBACK_REPO env var
#   3. .roll/local.yaml feedback_repo
#   4. ~/.roll/config.yaml feedback_repo
#   5. origin-derived github owner/repo

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  git init -q
  git remote add origin "git@github.com:from-origin/from-origin.git"
  mkdir -p .roll
  # Isolate ~/.roll/config.yaml lookup by giving HOME a clean override.
  export HOME="$TEST_TMP/home"; mkdir -p "$HOME/.roll"
  unset ROLL_FEEDBACK_REPO
}

teardown() {
  cd /
  unset HOME ROLL_FEEDBACK_REPO
  rm -rf "$TEST_TMP"
}

extract_repo() {
  python3 -c '
import sys, urllib.parse
url = sys.argv[1]
# strip the leading https://github.com/
_, rest = url.split("github.com/", 1)
owner_repo = rest.split("/issues/new", 1)[0]
print(owner_repo)
' "$1"
}

@test "repo precedence: origin used when nothing else set" {
  run "$ROLL" feedback --title X --body y --print-url
  [ "$status" -eq 0 ]
  [ "$(extract_repo "$output")" = "from-origin/from-origin" ]
}

@test "repo precedence: ~/.roll/config.yaml beats origin" {
  cat > "$HOME/.roll/config.yaml" <<'YAML'
feedback_repo: from-global/from-global
YAML
  run "$ROLL" feedback --title X --body y --print-url
  [ "$status" -eq 0 ]
  [ "$(extract_repo "$output")" = "from-global/from-global" ]
}

@test "repo precedence: .roll/local.yaml beats global" {
  cat > "$HOME/.roll/config.yaml" <<'YAML'
feedback_repo: from-global/from-global
YAML
  cat > .roll/local.yaml <<'YAML'
feedback_repo: from-project/from-project
YAML
  run "$ROLL" feedback --title X --body y --print-url
  [ "$status" -eq 0 ]
  [ "$(extract_repo "$output")" = "from-project/from-project" ]
}

@test "repo precedence: ROLL_FEEDBACK_REPO beats local" {
  cat > .roll/local.yaml <<'YAML'
feedback_repo: from-project/from-project
YAML
  ROLL_FEEDBACK_REPO=from-env/from-env run "$ROLL" feedback --title X --body y --print-url
  [ "$status" -eq 0 ]
  [ "$(extract_repo "$output")" = "from-env/from-env" ]
}

@test "repo precedence: --repo flag beats env var" {
  ROLL_FEEDBACK_REPO=from-env/from-env run "$ROLL" feedback --title X --body y --repo from-flag/from-flag --print-url
  [ "$status" -eq 0 ]
  [ "$(extract_repo "$output")" = "from-flag/from-flag" ]
}

@test "repo precedence: malformed local.yaml falls through to origin" {
  cat > .roll/local.yaml <<'YAML'
not_a_yaml_field_we_care_about: x
YAML
  run "$ROLL" feedback --title X --body y --print-url
  [ "$status" -eq 0 ]
  [ "$(extract_repo "$output")" = "from-origin/from-origin" ]
}
