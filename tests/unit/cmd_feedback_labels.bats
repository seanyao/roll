#!/usr/bin/env bats
# US-FB-004: --type maps to GitHub labels that line up with the Roll
# backlog sync flow (bug→FIX, idea→US, ux→enhancement). The exact label
# string matters because GitHub Actions / project boards filter on it.

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP=$(mktemp -d); cd "$TEST_TMP"
  git init -q
  git remote add origin "git@github.com:demo/demo.git"
}
teardown() { cd /; rm -rf "$TEST_TMP"; }

extract_labels() {
  python3 -c '
import sys, urllib.parse
url = sys.argv[1]
qs = url.split("?", 1)[1]
params = urllib.parse.parse_qs(qs)
print(params.get("labels", [""])[0])
' "$1"
}

@test "labels: type=bug emits 'bug,FIX'" {
  run "$ROLL" feedback --type bug --title X --body y --print-url
  [ "$status" -eq 0 ]
  local labels; labels=$(extract_labels "$output")
  [ "$labels" = "bug,FIX" ]
}

@test "labels: type=idea emits 'idea,enhancement,US'" {
  run "$ROLL" feedback --type idea --title X --body y --print-url
  [ "$status" -eq 0 ]
  local labels; labels=$(extract_labels "$output")
  [ "$labels" = "idea,enhancement,US" ]
}

@test "labels: type=ux emits 'ux,enhancement'" {
  run "$ROLL" feedback --type ux --title X --body y --print-url
  [ "$status" -eq 0 ]
  local labels; labels=$(extract_labels "$output")
  [ "$labels" = "ux,enhancement" ]
}

@test "labels: helper _feedback_label_for_type returns expected strings" {
  source "$ROLL"
  [ "$(_feedback_label_for_type bug)" = "bug,FIX" ]
  [ "$(_feedback_label_for_type idea)" = "idea,enhancement,US" ]
  [ "$(_feedback_label_for_type ux)" = "ux,enhancement" ]
  [ "$(_feedback_label_for_type unknown)" = "feedback" ]
}

@test "labels: no spaces in label string (gh CLI requires comma-only)" {
  run "$ROLL" feedback --type idea --title X --body y --print-url
  local labels; labels=$(extract_labels "$output")
  [[ "$labels" != *" "* ]]
}
