#!/usr/bin/env bats
# US-FB-002: roll feedback auto-attaches env info (roll version, OS,
# current agent, language, project name) to the issue body unless
# --no-env is set.

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  git init -q
  git remote add origin "git@github.com:demo/demo.git"
}

teardown() { cd /; rm -rf "$TEST_TMP"; }

decode_body() {
  python3 -c '
import sys, urllib.parse
url = sys.argv[1]
qs = url.split("?", 1)[1]
params = urllib.parse.parse_qs(qs)
print(params.get("body", [""])[0])
' "$1"
}

@test "env: --print-url default includes Environment section in body" {
  run "$ROLL" feedback --type bug --title "X" --body "user-content" --print-url
  [ "$status" -eq 0 ]
  local body
  body=$(decode_body "$output")
  [[ "$body" == *"user-content"* ]]
  [[ "$body" == *"Environment"* ]] || [[ "$body" == *"环境"* ]]
}

@test "env: roll version line present" {
  run "$ROLL" feedback --type bug --title "X" --body "y" --print-url
  local body; body=$(decode_body "$output")
  [[ "$body" == *"roll"* ]] && [[ "$body" == *"version"* || "$body" == *"v2"* ]]
}

@test "env: OS line present" {
  run "$ROLL" feedback --type bug --title "X" --body "y" --print-url
  local body; body=$(decode_body "$output")
  [[ "$body" == *"OS"* ]] || [[ "$body" == *"Darwin"* ]] || [[ "$body" == *"Linux"* ]]
}

@test "env: --no-env disables the environment section" {
  run "$ROLL" feedback --type bug --title "X" --body "user-content" --no-env --print-url
  [ "$status" -eq 0 ]
  local body; body=$(decode_body "$output")
  [[ "$body" == *"user-content"* ]]
  [[ "$body" != *"Environment"* ]] && [[ "$body" != *"环境"* ]]
}

@test "env: empty --body still attaches env when not --no-env" {
  run "$ROLL" feedback --type bug --title "X" --body "" --print-url
  [ "$status" -eq 0 ]
  local body; body=$(decode_body "$output")
  [[ "$body" == *"Environment"* ]] || [[ "$body" == *"环境"* ]]
}

@test "env: --help mentions --no-env" {
  run "$ROLL" feedback --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"--no-env"* ]]
}
