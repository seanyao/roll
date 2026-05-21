#!/usr/bin/env bats
# Unit tests for lib/roll-loop-status.py `_extract_story_id` (FIX-084).
#
# Locks in multi-segment story id support: `US-VIEW-011` must survive intact,
# not get truncated to `VIEW-011`. Also covers the single-segment legacy form
# (`FIX-082`) and an extraction-from-noise case (trailing text after id).

LIB="${BATS_TEST_DIRNAME}/../../lib"
STATUS="${LIB}/roll-loop-status.py"

extract_story_id() {
  local detail="$1"
  python3 - "$STATUS" "$detail" <<'PY'
import sys, importlib.util
status_path, detail = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location("rls", status_path)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
result = m._extract_story_id(detail)
print("" if result is None else result)
PY
}

@test "FIX-084: _extract_story_id returns single-segment FIX-082 unchanged" {
  run extract_story_id "FIX-082"
  [ "$status" -eq 0 ]
  [ "$output" = "FIX-082" ]
}

@test "FIX-084: _extract_story_id captures full US-VIEW-011 multi-segment id" {
  run extract_story_id "US-VIEW-011"
  [ "$status" -eq 0 ]
  [ "$output" = "US-VIEW-011" ]
}

@test "FIX-084: _extract_story_id finds US-LOOP-005 inside surrounding noise" {
  run extract_story_id "noise then US-LOOP-005 trailing"
  [ "$status" -eq 0 ]
  [ "$output" = "US-LOOP-005" ]
}
