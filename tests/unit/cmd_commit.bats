#!/usr/bin/env bats
# Unit tests for: cmd_commit — roll commit with AI Co-authored-by trailers

setup() {
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  TEST_TMP="$(mktemp -d)"

  # Mock git: capture all arguments as a single line per invocation
  export GIT_ARGS_FILE="${TEST_TMP}/git_args"
  : > "$GIT_ARGS_FILE"
  git() {
    printf '%s\n' "$@" >> "$GIT_ARGS_FILE"
  }
  export -f git
}

teardown() {
  rm -rf "$TEST_TMP"
}

# Helper: read the git commit message (3rd arg onward, joined)
git_message() {
  local IFS=$'\n'
  local lines=()
  while IFS= read -r line; do
    lines+=("$line")
  done < "$GIT_ARGS_FILE"
  # lines[0]=commit, lines[1]=--no-verify, lines[2]=-m, lines[3..N]=message
  local idx
  for idx in "${!lines[@]}"; do
    if [[ "${lines[$idx]}" == "-m" ]]; then
      local msg=""
      local i=$((idx + 1))
      while [[ $i -lt ${#lines[@]} ]]; do
        [[ -n "$msg" ]] && msg+=$'\n'
        msg+="${lines[$i]}"
        i=$((i + 1))
      done
      echo "$msg"
      return
    fi
  done
}

# ─── Happy path: explicit client + model ─────────────────────────────────────

@test "commit: adds Co-authored-by trailers" {
  run cmd_commit -m "fix: typo" --client opencode --model deepseek-v4-flash
  [ "$status" -eq 0 ]

  local msg
  msg=$(git_message)
  [[ "$msg" == *"Co-authored-by: opencode <opencode@ai>"* ]]
  [[ "$msg" == *"Co-authored-by: deepseek-v4-flash <deepseek-v4-flash@ai>"* ]]
  [[ "$msg" == *"fix: typo"* ]]
}

@test "commit: outputs info messages" {
  run cmd_commit -m "feat: add login" --client opencode --model deepseek-v4-flash
  [ "$status" -eq 0 ]
  [[ "$output" == *"Committing"* ]]
  [[ "$output" == *"Model: deepseek-v4-flash"* ]]
}

# ─── Env var detection ────────────────────────────────────────────────────────

@test "commit: reads client from ROLL_AI_CLIENT env var" {
  ROLL_AI_CLIENT="opencode" run cmd_commit -m "fix: typo" --model deepseek-v4-flash
  [ "$status" -eq 0 ]

  local msg
  msg=$(git_message)
  [[ "$msg" == *"Co-authored-by: opencode <opencode@ai>"* ]]
}

@test "commit: reads model from ROLL_AI_MODEL env var" {
  ROLL_AI_MODEL="deepseek-v4-flash" run cmd_commit -m "fix: typo" --client opencode
  [ "$status" -eq 0 ]

  local msg
  msg=$(git_message)
  [[ "$msg" == *"Co-authored-by: deepseek-v4-flash <deepseek-v4-flash@ai>"* ]]
}

@test "commit: CLI args override env vars" {
  ROLL_AI_CLIENT="claude" ROLL_AI_MODEL="sonnet" run cmd_commit \
    -m "fix: typo" --client opencode --model deepseek-v4-flash
  [ "$status" -eq 0 ]

  local msg
  msg=$(git_message)
  [[ "$msg" == *"Co-authored-by: opencode"* ]]
  [[ "$msg" != *"Co-authored-by: claude"* ]]
  [[ "$msg" == *"Co-authored-by: deepseek-v4-flash"* ]]
  [[ "$msg" != *"Co-authored-by: sonnet"* ]]
}

# ─── Fallback / missing values ────────────────────────────────────────────────

@test "commit: uses 'unknown' model when not provided" {
  run cmd_commit -m "fix: typo" --client opencode
  [ "$status" -eq 0 ]

  local msg
  msg=$(git_message)
  [[ "$msg" == *"Co-authored-by: opencode <opencode@ai>"* ]]
  [[ "$msg" == *"Co-authored-by: unknown <unknown@ai>"* ]]
}

@test "commit: still works when client is empty (only model trailer)" {
  run cmd_commit -m "fix: typo" --model deepseek-v4-flash
  [ "$status" -eq 0 ]

  local msg
  msg=$(git_message)
  [[ "$msg" == *"Co-authored-by: deepseek-v4-flash <deepseek-v4-flash@ai>"* ]]
}

# ─── Error path ────────────────────────────────────────────────────────────────

@test "commit: exits non-zero when -m is missing" {
  run cmd_commit --client opencode --model deepseek-v4-flash
  [ "$status" -ne 0 ]
  [[ "$output" == *"Message required"* ]]
}

@test "commit: exits non-zero on unknown argument" {
  run cmd_commit --bogus
  [ "$status" -ne 0 ]
  [[ "$output" == *"Unknown argument"* ]]
}
