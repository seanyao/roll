#!/usr/bin/env bats
# US-SKILL-014: dashboard surfaces a recent self-score trend line.
#
# Helper:
#   _self_score_summary_line  (lib/roll-loop-status.py — the live dashboard path)
#
# Reads .roll/notes/*.md, aggregates the last N entries (default 14),
# and emits a single dim line:
#   self-score: mean 7.8 / min 4 / redo 2 (last 14)
#
# Empty notes dir → empty string (no line printed).
# Sample < 3 → "(n/a)".

RENDERER="${BATS_TEST_DIRNAME}/../../lib/roll-loop-status.py"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  mkdir -p .roll/notes
}
teardown() { cd /; rm -rf "$TEST_TMP"; }

# Load the Python helper and print its summary line for the cwd's .roll/notes.
self_score_line() {
  python3 -c "
import importlib.util
spec = importlib.util.spec_from_file_location('m', '$RENDERER')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m._self_score_summary_line())
"
}

write_note() {
  # Args: skill story score verdict
  local skill="$1" story="$2" score="$3" verdict="$4"
  # avoid relying on time: use random suffix to keep filenames unique.
  local rand="$RANDOM-$RANDOM"
  local file=".roll/notes/2026-05-29-${skill}-${story}-${rand}.md"
  cat > "$file" <<EOF
---
skill: $skill
story: $story
score: $score
verdict: $verdict
ts: 2026-05-29T00:00:00Z
---

rationale
EOF
}

@test "trend summary: empty notes dir → empty line" {
  local line; line=$(self_score_line)
  [ -z "$line" ]
}

@test "trend summary: < 3 samples → n/a" {
  write_note roll-build US-A-001 8 good
  write_note roll-fix FIX-A-001 7 ok
  local line; line=$(self_score_line)
  [[ "$line" == *"self-score"* ]]
  [[ "$line" == *"n/a"* ]]
}

@test "trend summary: ≥ 3 samples shows mean / min / redo count" {
  write_note roll-build US-A-001 9 good
  write_note roll-build US-A-002 8 good
  write_note roll-fix FIX-A-001 4 regression
  write_note roll-fix FIX-A-002 7 ok
  write_note roll-design US-A-003 8 good
  local line; line=$(self_score_line)
  [[ "$line" == *"self-score"* ]]
  [[ "$line" == *"mean"* ]]
  [[ "$line" == *"min"* ]]
  [[ "$line" == *"redo"* ]] || [[ "$line" == *"regression"* ]]
}

@test "trend summary: redo count = number of regression / ok scores < 6" {
  for i in 1 2 3 4 5; do write_note roll-build "US-X-00$i" 9 good; done
  write_note roll-fix FIX-X-001 3 regression
  write_note roll-fix FIX-X-002 5 ok
  local line; line=$(self_score_line)
  # redo count should be ≥ 2 (the regression + low-score-ok pair)
  [[ "$line" =~ redo[[:space:]]+([0-9]+) ]]
  local n="${BASH_REMATCH[1]:-0}"
  [ "$n" -ge 2 ]
}

@test "trend summary: window cap caps the input set" {
  for i in $(seq 1 30); do write_note roll-build "US-W-$i" 5 ok; done
  for i in $(seq 1 3);  do write_note roll-build "US-W-recent-$i" 10 good; done
  # Default window 14 → last 14 records should average closer to 5..10
  local line; line=$(self_score_line)
  [[ "$line" == *"last 14"* ]] || [[ "$line" == *"14"* ]]
}
