#!/usr/bin/env bats
# US-ONBOARD-017: render the three Phase 2 analysis sections to markdown and
# seed candidate BACKLOG stories behind a HARD [Y/n] gate.
#
# Coverage:
#   - DETERMINISTIC rendering: same plan.yaml -> byte-identical markdown
#   - manifest contract (FILE| / SEED| / FIX| lines, in plan order)
#   - the [Y/n] gate: y/Y seeds; n / bare Enter / EOF / non-tty all CANCEL but
#     the three md files are STILL rendered
#   - rendered files are registered in the changeset's files_created (so
#     `roll offboard` removes them) — verified by an end-to-end offboard
#   - seeding is idempotent (a second apply does not duplicate rows)
#   - HIGH-severity risks seed as FIX-SEED-NNN under a separate confirm
#
# The renderer (lib/roll-onboard-render.py) is invoked both directly (for the
# determinism / manifest assertions) and via the bin/roll _init_render_and_seed
# function (for the gate + changeset + offboard behaviour). ROLL_ASSUME_TTY=1
# forces the interactive read path so the y/n/empty answers can be piped in,
# mirroring the ROLL_SPIN_FORCE_TTY seam already in bin/roll.

load helpers
setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

RENDERER="${BATS_TEST_DIRNAME}/../../lib/roll-onboard-render.py"

# Write a plan.yaml carrying the three analysis sections (callers can override
# by passing a full body on stdin). Echoes the path.
_write_full_plan() {
  local path="${PWD}/.roll/onboard-plan.yaml"
  mkdir -p "${PWD}/.roll"
  cat > "$path" <<'YAML'
version: 1
generated_at: "2026-05-31T10:00:00+08:00"
project_understanding: {type: cli, description: "x"}
scope: {approved: [backlog, domain]}
privacy: {gitignore_dot_roll: true}
domain_model:
  bounded_contexts:
    - name: auth
      aggregates: [User, Session]
      ubiquitous_language: [login, token]
tech_analysis:
  stack: [bash, python3]
  dependencies: [pyyaml]
  architecture_notes: ["single-binary CLI"]
  risks:
    - {description: "no macOS CI", severity: HIGH, evidence: detected}
    - {description: "thin lib coverage", severity: MEDIUM, evidence: inferred}
test_assessment:
  current_layers:
    - {claim: "112 bats files detected", evidence: detected}
  gaps:
    - {claim: "none detected", evidence: detected}
  recommended_actions:
    - {claim: "add macOS runner", evidence: inferred}
    - {claim: "add integration tests", evidence: inferred}
YAML
  echo "$path"
}

# Stage what _init_apply does before reaching render+seed: a fresh changeset, a
# seeded backlog (so seeding has a target), and the .roll/domain dir.
_stage_apply_preamble() {
  _onboard_changeset_begin "$PWD"
  _write_backlog "${PWD}/.roll/backlog.md" >/dev/null
  mkdir -p "${PWD}/.roll/domain"
  _onboard_changeset_record "$PWD" "dirs_created" ".roll/domain"
}

# ─── deterministic rendering ──────────────────────────────────────────────────

@test "renderer: same plan.yaml produces byte-identical markdown across runs" {
  local plan; plan=$(_write_full_plan)
  run python3 "$RENDERER" "$plan" "$PWD"
  [ "$status" -eq 0 ]
  local h1; h1=$(cat .roll/domain/context-map.md .roll/tech-analysis.md .roll/test-assessment.md | shasum | awk '{print $1}')
  # Re-render into the same target and hash again.
  run python3 "$RENDERER" "$plan" "$PWD"
  [ "$status" -eq 0 ]
  local h2; h2=$(cat .roll/domain/context-map.md .roll/tech-analysis.md .roll/test-assessment.md | shasum | awk '{print $1}')
  [ "$h1" = "$h2" ]
}

@test "renderer: writes the three markdown files at the AC-fixed paths" {
  local plan; plan=$(_write_full_plan)
  run python3 "$RENDERER" "$plan" "$PWD"
  [ "$status" -eq 0 ]
  [ -f .roll/domain/context-map.md ]
  [ -f .roll/tech-analysis.md ]
  [ -f .roll/test-assessment.md ]
}

@test "renderer: markdown carries the analysis content (context, risk, evidence tag)" {
  local plan; plan=$(_write_full_plan)
  python3 "$RENDERER" "$plan" "$PWD"
  grep -q "## auth" .roll/domain/context-map.md
  grep -qF "User" .roll/domain/context-map.md
  grep -qF "no macOS CI" .roll/tech-analysis.md
  grep -qF "severity: HIGH" .roll/tech-analysis.md
  grep -qF "evidence: detected" .roll/test-assessment.md
}

@test "renderer: emits a FILE| line per rendered file and SEED|/FIX| candidates in plan order" {
  local plan; plan=$(_write_full_plan)
  run python3 "$RENDERER" "$plan" "$PWD"
  [ "$status" -eq 0 ]
  [[ "$output" == *"FILE|.roll/domain/context-map.md"* ]]
  [[ "$output" == *"FILE|.roll/tech-analysis.md"* ]]
  [[ "$output" == *"FILE|.roll/test-assessment.md"* ]]
  # recommended_actions -> US-SEED-NNN in order
  [[ "$output" == *"SEED|US-SEED-001|add macOS runner"* ]]
  [[ "$output" == *"SEED|US-SEED-002|add integration tests"* ]]
  # only the HIGH risk becomes a FIX candidate (MEDIUM excluded)
  [[ "$output" == *"FIX|FIX-SEED-001|no macOS CI"* ]]
  [[ "$output" != *"thin lib coverage"* ]]
}

@test "renderer: 'none detected' recommended_action is not turned into a seed candidate" {
  mkdir -p "${PWD}/.roll"
  cat > "${PWD}/.roll/onboard-plan.yaml" <<'YAML'
version: 1
generated_at: "2026-05-31T10:00:00+08:00"
project_understanding: {type: cli, description: "x"}
scope: {approved: [domain]}
privacy: {gitignore_dot_roll: true}
test_assessment:
  recommended_actions:
    - {claim: "none detected", evidence: detected}
YAML
  run python3 "$RENDERER" "${PWD}/.roll/onboard-plan.yaml" "$PWD"
  [ "$status" -eq 0 ]
  [[ "$output" != *"SEED|"* ]]
}

@test "renderer: a plan with no Phase 2 sections is a clean no-op (exit 2)" {
  mkdir -p "${PWD}/.roll"
  cat > "${PWD}/.roll/onboard-plan.yaml" <<'YAML'
version: 1
generated_at: "2026-05-31T10:00:00+08:00"
project_understanding: {type: cli, description: "x"}
scope: {approved: [backlog]}
privacy: {gitignore_dot_roll: true}
YAML
  run python3 "$RENDERER" "${PWD}/.roll/onboard-plan.yaml" "$PWD"
  [ "$status" -eq 2 ]
  [ ! -f .roll/tech-analysis.md ]
}

# ─── the [Y/n] gate ───────────────────────────────────────────────────────────

@test "gate: explicit Y seeds the candidate stories into BACKLOG" {
  _write_full_plan >/dev/null
  _stage_apply_preamble
  ROLL_ASSUME_TTY=1 run bash -c "printf 'y\nn\n' | { source '$ROLL_BIN'; _init_render_and_seed '$PWD' '$PWD/.roll/onboard-plan.yaml'; }"
  [ "$status" -eq 0 ]
  grep -qF "US-SEED-001" .roll/backlog.md
  grep -qF "add macOS runner" .roll/backlog.md
  grep -qF "US-SEED-002" .roll/backlog.md
}

@test "gate: explicit n cancels seeding but the three md files are still rendered" {
  _write_full_plan >/dev/null
  _stage_apply_preamble
  ROLL_ASSUME_TTY=1 run bash -c "printf 'n\nn\n' | { source '$ROLL_BIN'; _init_render_and_seed '$PWD' '$PWD/.roll/onboard-plan.yaml'; }"
  [ "$status" -eq 0 ]
  # No seed rows written
  ! grep -q "US-SEED" .roll/backlog.md
  ! grep -q "FIX-SEED" .roll/backlog.md
  # But the analysis markdown was generated anyway
  [ -f .roll/domain/context-map.md ]
  [ -f .roll/tech-analysis.md ]
  [ -f .roll/test-assessment.md ]
}

@test "gate: a bare Enter (empty line) cancels seeding but still renders md" {
  _write_full_plan >/dev/null
  _stage_apply_preamble
  ROLL_ASSUME_TTY=1 run bash -c "printf '\n\n' | { source '$ROLL_BIN'; _init_render_and_seed '$PWD' '$PWD/.roll/onboard-plan.yaml'; }"
  [ "$status" -eq 0 ]
  ! grep -q "US-SEED" .roll/backlog.md
  [ -f .roll/test-assessment.md ]
}

@test "gate: non-interactive stdin cancels seeding (and says so) but still renders md" {
  _write_full_plan >/dev/null
  _stage_apply_preamble
  # No ROLL_ASSUME_TTY, stdin redirected from /dev/null -> the non-tty branch.
  run bash -c "source '$ROLL_BIN'; _init_render_and_seed '$PWD' '$PWD/.roll/onboard-plan.yaml' </dev/null"
  [ "$status" -eq 0 ]
  ! grep -q "US-SEED" .roll/backlog.md
  [ -f .roll/domain/context-map.md ]
  [[ "$output" == *"Non-interactive"* ]] || [[ "$output" == *"skipping"* ]]
}

@test "gate: cancelling still registers the rendered files in the changeset" {
  _write_full_plan >/dev/null
  _stage_apply_preamble
  ROLL_ASSUME_TTY=1 run bash -c "printf 'n\nn\n' | { source '$ROLL_BIN'; _init_render_and_seed '$PWD' '$PWD/.roll/onboard-plan.yaml'; }"
  [ "$status" -eq 0 ]
  local cs; cs=$(_onboard_changeset_path "$PWD")
  grep -qF '  - ".roll/domain/context-map.md"' "$cs"
  grep -qF '  - ".roll/tech-analysis.md"' "$cs"
  grep -qF '  - ".roll/test-assessment.md"' "$cs"
}

# ─── HIGH-risk FIX seeding ────────────────────────────────────────────────────

@test "gate: confirming the FIX prompt seeds HIGH-severity risks as FIX-SEED-NNN" {
  _write_full_plan >/dev/null
  _stage_apply_preamble
  # First confirm = stories (n: skip), second confirm = fixes (y: seed).
  ROLL_ASSUME_TTY=1 run bash -c "printf 'n\ny\n' | { source '$ROLL_BIN'; _init_render_and_seed '$PWD' '$PWD/.roll/onboard-plan.yaml'; }"
  [ "$status" -eq 0 ]
  grep -qF "FIX-SEED-001" .roll/backlog.md
  grep -qF "no macOS CI" .roll/backlog.md
  # MEDIUM risk must not be seeded
  ! grep -q "thin lib coverage" .roll/backlog.md
  # stories were declined
  ! grep -q "US-SEED" .roll/backlog.md
}

# ─── idempotency ──────────────────────────────────────────────────────────────

@test "seeding is idempotent: a second confirmed apply does not duplicate rows" {
  _write_full_plan >/dev/null
  _stage_apply_preamble
  ROLL_ASSUME_TTY=1 bash -c "printf 'y\ny\n' | { source '$ROLL_BIN'; _init_render_and_seed '$PWD' '$PWD/.roll/onboard-plan.yaml'; }" >/dev/null 2>&1
  ROLL_ASSUME_TTY=1 bash -c "printf 'y\ny\n' | { source '$ROLL_BIN'; _init_render_and_seed '$PWD' '$PWD/.roll/onboard-plan.yaml'; }" >/dev/null 2>&1
  [ "$(grep -cF 'US-SEED-001' .roll/backlog.md)" -eq 1 ]
  [ "$(grep -cF 'US-SEED-002' .roll/backlog.md)" -eq 1 ]
  [ "$(grep -cF 'FIX-SEED-001' .roll/backlog.md)" -eq 1 ]
}

# ─── offboard round-trip ──────────────────────────────────────────────────────

@test "offboard removes every rendered markdown file recorded in files_created" {
  _write_full_plan >/dev/null
  _stage_apply_preamble
  ROLL_ASSUME_TTY=1 bash -c "printf 'n\nn\n' | { source '$ROLL_BIN'; _init_render_and_seed '$PWD' '$PWD/.roll/onboard-plan.yaml'; }" >/dev/null 2>&1
  [ -f .roll/domain/context-map.md ]
  [ -f .roll/tech-analysis.md ]
  [ -f .roll/test-assessment.md ]
  # Apply offboard (confirm flag). cmd_offboard reads files_created + dirs_created.
  run cmd_offboard --confirm
  [ "$status" -eq 0 ]
  [ ! -f .roll/domain/context-map.md ]
  [ ! -f .roll/tech-analysis.md ]
  [ ! -f .roll/test-assessment.md ]
}
