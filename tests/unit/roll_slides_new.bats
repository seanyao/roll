#!/usr/bin/env bats
# Unit tests for `roll slides new` (US-DECK-004).
#
# Exercises cmd_slides_new() in bin/roll. The command:
#   - Parses `<topic>` (required, positional) + `--template <name>` (optional).
#   - Derives a kebab-case <slug> from the topic.
#   - Resolves the selected agent via _project_agent().
#   - Invokes the agent (claude / kimi / codex / ...) with the roll-deck
#     SKILL.md content + topic + slug + template as a single text prompt.
#   - After the agent exits, prints a bilingual "next: roll slides build <slug>"
#     hint so the user can render the deck.
#
# Tests stub the chosen agent on PATH and inspect the captured argv +
# prompt to assert wiring without actually invoking an LLM.

load helpers

setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

REPO="${BATS_TEST_DIRNAME}/../.."

# Stub the `claude` binary so the test captures the prompt the CLI passes,
# then exits 0 without doing anything. The stub writes its argv to
# ${TEST_TMP}/claude.log (one arg per line).
_stub_claude() {
  mkdir -p "${TEST_TMP}/stubbin"
  # NOTE: TEST_TMP is interpolated into the stub at write-time so the stub
  # writes its log file to a stable absolute path. (`run cmd_slides new`
  # may unset / shadow env vars inside the subshell where the stub runs.)
  cat >"${TEST_TMP}/stubbin/claude" <<EOF
#!/usr/bin/env bash
# Dump argv (one per line) for the test to inspect.
for a in "\$@"; do
  printf '%s\n---\n' "\$a"
done >"${TEST_TMP}/claude.log"
EOF
  chmod +x "${TEST_TMP}/stubbin/claude"
  export PATH="${TEST_TMP}/stubbin:${PATH}"
  : >"${TEST_TMP}/claude.log"
}

# Pin the selected project agent to claude (the stub above).
_pin_claude_agent() {
  mkdir -p ".roll"
  printf 'agent: claude\n' >".roll/local.yaml"
}

# Seed a minimal project so the skill can pretend to "read" it. The skill
# itself doesn't run inside these tests (the agent is stubbed) but having
# the files around makes the wiring more realistic.
_seed_min_project() {
  printf '# Roll\n\nTest project.\n' >README.md
  printf '# Agents\n\nConventions.\n' >AGENTS.md
}

# ─── Skill file ──────────────────────────────────────────────────────────────

@test "skill file: skills/roll-deck/SKILL.md exists with valid frontmatter" {
  local skill="${REPO}/skills/roll-deck/SKILL.md"
  [ -f "$skill" ]
  # Frontmatter starts with --- on line 1
  head -1 "$skill" | grep -qE '^---$'
  # Has the required keys
  grep -qE '^name: roll-deck$' "$skill"
  grep -qE '^license: ' "$skill"
  grep -qE '^allowed-tools: ' "$skill"
  grep -qE '^description: ' "$skill"
}

@test "skill file: explains hard constraint to only write .roll/slides/<slug>/deck.md" {
  local skill="${REPO}/skills/roll-deck/SKILL.md"
  # The hard constraint must be present so the agent knows the boundary.
  grep -q "deck.md" "$skill"
  # Some mention of the writing constraint (EN or ZH variant).
  [[ $(grep -c "constraint\|Constraint\|约束" "$skill") -ge 1 ]]
}

@test "skill file: describes grounding threshold (evidence per slide group)" {
  local skill="${REPO}/skills/roll-deck/SKILL.md"
  grep -qiE "grounding|evidence" "$skill"
}

@test "skill file: bilingual rule documented (EN + ZH separate lines)" {
  local skill="${REPO}/skills/roll-deck/SKILL.md"
  # The file must contain both English and Chinese content.
  # CJK regex ranges are unreliable on CI; check for known ZH substrings.
  [[ "$(cat "$skill")" == *"主题"* || "$(cat "$skill")" == *"幻灯片"* ]]
}

@test "skill file: does not embed the bash 'Next:' hint (FIX-089)" {
  local skill="${REPO}/skills/roll-deck/SKILL.md"
  # bin/roll already prints `Next:  roll slides build <slug>` after `new`
  # completes. The skill must NOT instruct the agent to print this hint too
  # — duplicated output makes users wonder if the command ran twice.
  # Anchor on the bilingual hint pair (EN "Next:" + ZH "下一步") that bin/roll
  # owns; bare prose references to `roll slides build` elsewhere are fine.
  ! grep -qE 'Next:[[:space:]]+roll slides build' "$skill"
  ! grep -qE '下一步.*roll slides build' "$skill"
}

# ─── Dispatch / usage ────────────────────────────────────────────────────────

@test "cmd_slides new: no topic → bilingual usage error + non-zero exit" {
  _pin_claude_agent
  run cmd_slides new
  [ "$status" -ne 0 ]
  [[ "$output" == *"topic"* || "$output" == *"Usage"* ]]
  # Bilingual hint
  [[ "$output" == *"主题"* || "$output" == *"用法"* ]]
}

@test "cmd_slides new: unknown flag rejected" {
  _pin_claude_agent
  run cmd_slides new "Some Topic" --bogus
  [ "$status" -ne 0 ]
  [[ "$output" == *"--bogus"* || "$output" == *"Unknown"* || "$output" == *"未知"* ]]
}

@test "cmd_slides new --help: bilingual help (EN + ZH)" {
  run cmd_slides new --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"new"* ]]
  # ZH substring from _slides_help — the new subcommand uses the same help.
  [[ "$output" == *"幻灯片"* ]]
}

# ─── Agent wiring ────────────────────────────────────────────────────────────

@test "cmd_slides new: invokes selected agent (claude) with text mode prompt" {
  _pin_claude_agent
  _stub_claude
  _seed_min_project
  run cmd_slides new "Introducing Roll Loop"
  [ "$status" -eq 0 ]
  [ -s "${TEST_TMP}/claude.log" ]
  # claude was called with `-p` and `--output-format text` (text mode argv).
  grep -qE '^-p$' "${TEST_TMP}/claude.log"
  grep -qE '^text$' "${TEST_TMP}/claude.log"
}

@test "cmd_slides new: prompt includes the topic verbatim" {
  _pin_claude_agent
  _stub_claude
  _seed_min_project
  run cmd_slides new "Introducing Roll Loop"
  [ "$status" -eq 0 ]
  grep -q "Introducing Roll Loop" "${TEST_TMP}/claude.log"
}

@test "cmd_slides new: prompt includes the roll-deck skill body" {
  _pin_claude_agent
  _stub_claude
  _seed_min_project
  run cmd_slides new "Introducing Roll Loop"
  [ "$status" -eq 0 ]
  # Skill body marker — pick a stable, distinctive phrase from SKILL.md.
  grep -q "roll-deck" "${TEST_TMP}/claude.log"
  grep -q "deck.md" "${TEST_TMP}/claude.log"
}

@test "cmd_slides new: prompt includes the derived slug" {
  _pin_claude_agent
  _stub_claude
  _seed_min_project
  run cmd_slides new "Introducing Roll Loop"
  [ "$status" -eq 0 ]
  # "Introducing Roll Loop" → "introducing-roll-loop"
  grep -q "introducing-roll-loop" "${TEST_TMP}/claude.log"
}

@test "cmd_slides new: prompt mentions the template (default introduction-v3)" {
  _pin_claude_agent
  _stub_claude
  _seed_min_project
  run cmd_slides new "Introducing Roll Loop"
  [ "$status" -eq 0 ]
  grep -q "introduction-v3" "${TEST_TMP}/claude.log"
}

@test "cmd_slides new: --template overrides the default template name" {
  _pin_claude_agent
  _stub_claude
  _seed_min_project
  run cmd_slides new "Some Topic" --template custom-v1
  [ "$status" -eq 0 ]
  # The override value reaches the agent prompt.
  grep -q "custom-v1" "${TEST_TMP}/claude.log"
  # The actual `template:` task line uses the override (not the default).
  # (The skill body may mention `introduction-v3` as a default — that's docs.)
  grep -qE '^template: custom-v1$' "${TEST_TMP}/claude.log"
}

# ─── Slug derivation ─────────────────────────────────────────────────────────

@test "cmd_slides new: slug is lowercase kebab-case (spaces → dashes, punct stripped)" {
  _pin_claude_agent
  _stub_claude
  _seed_min_project
  run cmd_slides new "Hello, World! It's a Test."
  [ "$status" -eq 0 ]
  # No leading/trailing dashes, no upper-case, no punctuation.
  grep -q "hello-world-it-s-a-test" "${TEST_TMP}/claude.log"
}

# ─── Post-exit hint ──────────────────────────────────────────────────────────

@test "cmd_slides new: prints bilingual 'next: roll slides build <slug>' hint" {
  _pin_claude_agent
  _stub_claude
  _seed_min_project
  run cmd_slides new "Introducing Roll Loop"
  [ "$status" -eq 0 ]
  [[ "$output" == *"roll slides build introducing-roll-loop"* ]]
  # ZH hint substring.
  [[ "$output" == *"下一步"* ]]
}

@test "cmd_slides new --quiet: suppresses progress output but keeps Next hint" {
  _pin_claude_agent
  _stub_claude
  _seed_min_project
  run cmd_slides new --quiet "Introducing Roll Loop"
  [ "$status" -eq 0 ]
  # Progress arrows should NOT appear
  [[ "$output" != *'→ launching'* ]]
  [[ "$output" != *'→ generating'* ]]
  # Next hint should still appear
  [[ "$output" == *"roll slides build introducing-roll-loop"* ]]
}

# ─── Agent resolution failure ────────────────────────────────────────────────

@test "cmd_slides new: unknown agent in .roll/local.yaml → friendly error + non-zero exit" {
  mkdir -p ".roll"
  printf 'agent: nosuchagent\n' >".roll/local.yaml"
  _seed_min_project
  run cmd_slides new "Some Topic"
  [ "$status" -ne 0 ]
  [[ "$output" == *"nosuchagent"* || "$output" == *"Unknown agent"* ]]
}
