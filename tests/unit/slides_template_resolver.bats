#!/usr/bin/env bats
# US-DECK-013: _slides_template_path two-level resolution (project → built-in)

load helpers
setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

@test "template_path: project-level override wins over built-in" {
  mkdir -p ".roll/slides/templates"
  echo "PROJECT OVERRIDE" > ".roll/slides/templates/custom.html"
  run bash -c "source '$ROLL_BIN' 2>/dev/null; _slides_template_path custom"
  [ "$status" -eq 0 ]
  [[ "$output" == *".roll/slides/templates/custom.html" ]]
}

@test "template_path: falls back to built-in when no project override" {
  # introduction-v3 is always present in the built-in dir
  run bash -c "source '$ROLL_BIN' 2>/dev/null; _slides_template_path introduction-v3"
  [ "$status" -eq 0 ]
  [[ "$output" == *"lib/slides/templates/introduction-v3.html" ]]
}

@test "template_path: returns error when neither exists" {
  run bash -c "source '$ROLL_BIN' 2>/dev/null; _slides_template_path nosuch_template_xyz"
  [ "$status" -ne 0 ]
}

@test "template_path: project override with same name as built-in" {
  mkdir -p ".roll/slides/templates"
  echo "CUSTOM INTRO" > ".roll/slides/templates/introduction-v3.html"
  run bash -c "source '$ROLL_BIN' 2>/dev/null; _slides_template_path introduction-v3"
  [ "$status" -eq 0 ]
  [[ "$output" == *".roll/slides/templates/introduction-v3.html" ]]
}
