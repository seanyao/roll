#!/usr/bin/env bats
# FIX-084: _STORY_ID_PAT must capture multi-segment story IDs like
# US-VIEW-011 in full, not truncate to the trailing VIEW-011 segment.

LIB="${BATS_TEST_DIRNAME}/../../lib"
STATUS="${LIB}/roll-loop-status.py"

extract() {
  python3 -c "
import sys, importlib.util
spec = importlib.util.spec_from_file_location('s', '${STATUS}')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m._extract_story_id(sys.argv[1]) or '')
" "$1"
}

@test "FIX-084: _extract_story_id keeps US-VIEW-011 prefix intact" {
  run extract "US-VIEW-011"
  [ "$status" -eq 0 ]
  [ "$output" = "US-VIEW-011" ]
}

@test "FIX-084: _extract_story_id still returns single-segment FIX-082" {
  run extract "FIX-082"
  [ "$status" -eq 0 ]
  [ "$output" = "FIX-082" ]
}

@test "FIX-084: _extract_story_id finds US-LOOP-005 inside surrounding text" {
  run extract "noise then US-LOOP-005 trailing"
  [ "$status" -eq 0 ]
  [ "$output" = "US-LOOP-005" ]
}

@test "FIX-084: _extract_story_id stays backward compatible with bare VIEW-011" {
  run extract "VIEW-011"
  [ "$status" -eq 0 ]
  [ "$output" = "VIEW-011" ]
}

@test "FIX-108: _extract_story_id accepts alphanumeric segment US-I18N-001" {
  run extract "US-I18N-001"
  [ "$status" -eq 0 ]
  [ "$output" = "US-I18N-001" ]
}

@test "FIX-108: _extract_story_id accepts alphanumeric segment US-K8S-007" {
  run extract "US-K8S-007"
  [ "$status" -eq 0 ]
  [ "$output" = "US-K8S-007" ]
}

@test "FIX-108: _extract_story_id accepts short alphanumeric segment US-D2-042" {
  run extract "US-D2-042"
  [ "$status" -eq 0 ]
  [ "$output" = "US-D2-042" ]
}

@test "FIX-108: _extract_story_id finds US-I18N-001 inside surrounding text" {
  run extract "loop picked US-I18N-001 from backlog"
  [ "$status" -eq 0 ]
  [ "$output" = "US-I18N-001" ]
}

@test "FIX-108: _extract_story_id does NOT match pure-digit pattern 001-002" {
  run extract "001-002"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
