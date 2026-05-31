#!/usr/bin/env bats
# Tests for runner script PATH export (FIX-017)
# launchd default PATH doesn't include /opt/homebrew/bin. claude inherits
# bash's PATH but when it spawns hooks via `sh -c "node ..."`, the brew
# tools become unreachable. Runner template must export PATH explicitly so
# every child process in the chain can find node/claude/etc.

load helpers
setup() {
  unit_setup_cd
  _test_dir="$TEST_TMP"
}
teardown() { unit_teardown_cd; }

@test "_write_loop_runner_script: inner script exports /opt/homebrew/bin in PATH" {
  local script_path="${_test_dir}/run-test-path.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "echo hi" "/tmp/log" 10 24
  local inner_script="${script_path%.sh}-inner.sh"
  [ -f "$inner_script" ]
  grep -qF 'export PATH' "$inner_script"
  grep -qF '/opt/homebrew/bin' "$inner_script"
}

@test "_write_loop_runner_script: PATH export runs before claude command (inner)" {
  local script_path="${_test_dir}/run-test-path-order.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p" "/tmp/log" 10 24
  local inner_script="${script_path%.sh}-inner.sh"
  local export_line cmd_line
  export_line=$(grep -n 'export PATH' "$inner_script" | head -1 | cut -d: -f1)
  cmd_line=$(grep -n 'cd "/tmp/proj"' "$inner_script" | head -1 | cut -d: -f1)
  [[ -n "$export_line" && -n "$cmd_line" ]]
  [[ "$export_line" -lt "$cmd_line" ]]
}

@test "_write_loop_runner_script: cmd is augmented with claude --verbose for attach visibility" {
  local script_path="${_test_dir}/run-test-verbose.sh"
  # The agent_cmd typically starts with claude -p; inner runner should rewrite
  # to claude --verbose -p so the tmux attach view shows live progress.
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p \"prompt\"" "/tmp/log" 10 24
  local inner_script="${script_path%.sh}-inner.sh"
  grep -qE 'claude --verbose -p|claude -p .* --verbose|--verbose' "$inner_script"
}

@test "_write_loop_runner_script: non-claude cmds (kimi/deepseek) are NOT modified" {
  # --verbose injection must be claude-specific; other agents shouldn't get it
  local script_path="${_test_dir}/run-test-kimi.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "kimi -p \"prompt\"" "/tmp/log" 10 24
  local inner_script="${script_path%.sh}-inner.sh"
  ! grep -qF 'kimi --verbose' "$inner_script"
  grep -qF 'kimi -p' "$inner_script"
}

@test "_write_loop_runner_script: with skill_path, inner rebuilds agent cmd at runtime (FIX-134)" {
  # When skill_path (7th arg) is provided, the inner script must resolve the
  # cycle agent live via _loop_cycle_agent_cmd + eval, not run a baked constant.
  local script_path="${_test_dir}/run-test-rebuild.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "cd \"/tmp/proj\" && kimi -p \"x\"" "/tmp/log" 0 24 "/tmp/skill/SKILL.md"
  local inner_script="${script_path%.sh}-inner.sh"
  grep -qF '_loop_cycle_agent_cmd "/tmp/skill/SKILL.md"' "$inner_script"
  # FIX-136 inserted $_AGENT_PTY_PREFIX between eval and the command for
  # non-claude PTY wrapping, so match eval ... "$_CYCLE_CMD" loosely.
  grep -qE 'eval .*"\$_CYCLE_CMD"' "$inner_script"
  grep -qF '"$CYCLE_AGENT"' "$inner_script"
}

@test "FIX-138: _heartbeat_writer starts AFTER sourcing bin/roll (so _loop_event is defined)" {
  # The heartbeat writer calls _loop_event, which is defined in bin/roll.
  # If '_heartbeat_writer &' forks before the source line, the subshell
  # snapshot lacks _loop_event and every phase_tick silently fails -> no
  # heartbeat all cycle. Guard the ordering.
  local script_path="${_test_dir}/run-test-hb-order.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "pi -p \"x\"" "/tmp/log" 0 24 "/tmp/skill/SKILL.md"
  local inner_script="${script_path%.sh}-inner.sh"
  local src_line hb_line
  src_line=$(grep -n '^source ' "$inner_script" | head -1 | cut -d: -f1)
  hb_line=$(grep -n '^_heartbeat_writer &' "$inner_script" | head -1 | cut -d: -f1)
  [[ -n "$src_line" && -n "$hb_line" ]]
  [[ "$hb_line" -gt "$src_line" ]]
}

@test "FIX-139: logging is project-local — no global cron dup, no cap, attach shows this cycle" {
  local script_path="${_test_dir}/run-test-log139.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj139" "pi -p \"x\"" "/tmp/log" 0 24 "/tmp/skill/SKILL.md"
  local outer="$script_path" inner="${script_path%.sh}-inner.sh"
  # pane -> per-cycle raw only (cat), no `tee -a "$LOG"` cumulative dup
  grep -qE 'pipe-pane.*cat >>' "$outer"
  ! grep -qE 'pipe-pane.*tee -a' "$outer"
  # outer creates the machine-log dir from its dirname (honours caller's path)
  grep -qF 'mkdir -p "$(dirname "$LOG")"' "$outer"
  # attach shows newest per-cycle log, not the global cumulative transcript
  grep -qF '.roll/cycle-logs/*.log' "$outer"
  ! grep -qF 'cron-%s.log' "$outer"
  # no per-cycle retention cap
  ! grep -q 'ROLL_CYCLE_LOG_KEEP' "$inner"
  # the loop caller wires the machine log to project-local .roll/loop/cron.log
  local rollbin="${BATS_TEST_DIRNAME}/../../bin/roll"
  grep -qF 'loop_log="${project_path}/.roll/loop/cron.log"' "$rollbin"
}

@test "US-AUTO-044: inner hands PR merge to the PR Loop (supersedes FIX-140 wait/revert)" {
  local script_path="${_test_dir}/run-test-fix140.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj140" "pi -p \"x\"" "/tmp/log" 0 24 "/tmp/skill/SKILL.md"
  local inner="${script_path%.sh}-inner.sh"
  # US-AUTO-044 Phase 2: the main loop no longer waits for merge, so the FIX-140
  # timeout-revert (Done->Todo) is gone. The dedicated PR Loop merges async, and
  # the open-PR eligibility gate (not a revert) keeps the story from re-pick.
  # With worktree isolation the ✅ Done lives only in the unmerged PR, so main
  # never shows a false Done in the first place.
  ! grep -qF '_loop_mark_todo "$ROLL_LOOP_ROUTED_STORY"' "$inner"
  grep -qF 'merge handed to PR Loop' "$inner"
}

# FIX-050: launchd/cron deliver a bare PATH. Hardcoded /opt/homebrew/bin breaks
# on Intel macOS, Linux cron, and any future tool-prefix change. Two layers:
# (1) setup-time PATH in plist EnvironmentVariables; (2) cross-platform PATH
# assembly at the top of both outer + inner runner scripts.

@test "_write_loop_runner_script: inner script uses portable PATH assembly (no bare /opt/homebrew hardcode)" {
  local script_path="${_test_dir}/run-test-portable-path.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "echo hi" "/tmp/log" 10 24
  local inner_script="${script_path%.sh}-inner.sh"
  # Should NOT contain the legacy single-line hardcode
  ! grep -qF 'export PATH="/opt/homebrew/bin:$PATH"' "$inner_script"
  # Should contain a loop iterating candidate dirs (portable assembly)
  grep -q 'for _d in' "$inner_script"
  # Candidate set includes both Apple Silicon and Intel/Linux prefixes
  grep -qF '/opt/homebrew/bin' "$inner_script"
  grep -qF '/usr/local/bin' "$inner_script"
}

@test "_write_loop_runner_script: outer script also assembles PATH (covers launchd before tmux check)" {
  local script_path="${_test_dir}/run-test-outer-path.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "echo hi" "/tmp/log" 10 24
  # Outer script needs PATH set before tmux command-v check at the top
  grep -q 'for _d in' "$script_path"
  grep -qF '/opt/homebrew/bin' "$script_path"
}

@test "_detect_path_prepend: emits colon-separated list with standard dirs" {
  local out; out=$(_detect_path_prepend)
  [[ "$out" == *"/usr/bin"* ]]
  [[ "$out" == *":"* ]]
}

@test "FIX-129: _write_loop_runner_script includes ~/.kimi-code/bin in PATH candidate list" {
  # kimi-code installs its binary in ~/.kimi-code/bin, which is not under
  # brew prefix or ~/.local/bin. launchd loops must find kimi without user
  # having to create a symlink manually.
  local script_path="${_test_dir}/run-test-kimi-path.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "echo hi" "/tmp/log" 10 24
  local inner_script="${script_path%.sh}-inner.sh"
  grep -qF '.kimi-code/bin' "$inner_script"
  grep -qF '.kimi-code/bin' "$script_path"
}

@test "FIX-129: _detect_path_prepend includes ~/.kimi-code/bin when dir exists" {
  # Simulate kimi-code installed: create the dir then check detection.
  local fake_kimi="${TEST_TMP}/.kimi-code/bin"
  mkdir -p "$fake_kimi"
  local orig_home="$HOME"
  export HOME="$TEST_TMP"
  local out; out=$(_detect_path_prepend)
  export HOME="$orig_home"
  [[ "$out" == *".kimi-code/bin"* ]]
}

@test "_write_launchd_plist: writes EnvironmentVariables PATH key" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local plist="${tmp_dir}/test.plist"
  _write_launchd_plist "$plist" "com.roll.loop.test" "/tmp/proj" "60" "0" "" "${tmp_dir}/run.sh"
  grep -q '<key>EnvironmentVariables</key>' "$plist"
  grep -q '<key>PATH</key>' "$plist"
  rm -rf "$tmp_dir"
}
