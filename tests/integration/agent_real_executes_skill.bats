#!/usr/bin/env bats
# bats tier: slow
#
# FIX-152: REAL-agent execution regression — NO mocks, NO stubs.
#
# The gap this closes: every existing loop test feeds a MOCK agent (echo / "reply
# hello"), so they prove the infrastructure (tmux/stream/lock/worktree) starts,
# but never prove the *real routed agent actually executes the skill*. That let
# the kimi no-op ship in v2026.601.1 — kimi read the bare SKILL.md as pasted
# context and replied "what would you like me to do?", returning in 8s with zero
# output → the cycle ended idle, no delivery.
#
# This test drives the ACTUAL invocation path the inner runner uses:
#   _loop_cycle_agent_cmd  +  the non-claude PTY prefix (script -q /dev/null)
#   executed inside a real tmux pane (so the PTY exists, exactly like the loop).
# It hands the agent a minimal real skill with a verifiable side effect (create
# PROOF.txt containing EXECUTED-OK) and asserts the file appears. An agent that
# asks for direction instead of executing produces no file → the test fails.
#
# Gating (real, not fake): skips when tmux is missing, when the agent binary is
# not installed, or unless ROLL_TEST_REAL_AGENT=1 is set (real agents spend
# tokens/$ and need network — opt-in, mirroring tests/integration/cmd_test_tart.bats).
# Run for real with:  ROLL_TEST_REAL_AGENT=1 bash tests/run.sh --tier=all

bats_require_minimum_version 1.5.0

setup() {
  command -v tmux >/dev/null 2>&1 || skip "tmux not available"
  [[ "${ROLL_TEST_REAL_AGENT:-0}" = "1" ]] || \
    skip "set ROLL_TEST_REAL_AGENT=1 to opt in (runs real agents, spends tokens)"
  ROLL_BIN="${ROLL_BIN:-${BATS_TEST_DIRNAME}/../../bin/roll}"
  SB="$(mktemp -d)"
  SESS="real-agent-probe-${BATS_TEST_NUMBER:-x}-$$"
}

teardown() {
  [ -n "${SESS:-}" ] && tmux kill-session -t "$SESS" 2>/dev/null || true
  [ -n "${SB:-}" ] && rm -rf "$SB" || true
}

# Build the real cycle command for $agent and run it through the exact inner path
# (PTY prefix for non-claude, inside a tmux pane), then verify the side effect.
_assert_agent_executes() {
  local agent="$1"
  command -v "$agent" >/dev/null 2>&1 || skip "agent '$agent' not installed"

  cat > "$SB/skill.md" <<'SKILL'
---
name: exec-probe
---
立即在当前工作目录创建一个文件 PROOF.txt,内容为一行文本 EXECUTED-OK。这是自动化任务,不要反问、不要解释、不要请求确认,直接完成。
SKILL

  local cmd
  cmd=$(bash -c "source '$ROLL_BIN' 2>/dev/null; _loop_cycle_agent_cmd '$SB/skill.md' '$agent' '$SB'")
  [ -n "$cmd" ] || { echo "empty cycle command for agent '$agent'"; return 1; }
  printf '%s' "$cmd" > "$SB/cmd"

  # Non-claude agents run under a PTY in the real inner script; claude does not.
  local pty=""
  [ "$agent" != "claude" ] && pty="script -q /dev/null"

  tmux kill-session -t "$SESS" 2>/dev/null || true
  tmux new-session -d -s "$SESS" -x 200 -y 50 \
    "cd '$SB' && eval $pty \"\$(cat '$SB/cmd')\" > '$SB/out' 2>&1"

  local i
  for i in $(seq 1 45); do
    tmux has-session -t "$SESS" 2>/dev/null || break
    sleep 4
  done
  if tmux has-session -t "$SESS" 2>/dev/null; then
    tmux kill-session -t "$SESS" 2>/dev/null || true
    echo "agent '$agent' did not finish within timeout; output:"; cat "$SB/out" 2>/dev/null
    return 1
  fi

  if [ ! -f "$SB/PROOF.txt" ] || ! grep -q EXECUTED-OK "$SB/PROOF.txt"; then
    echo "agent '$agent' did NOT execute the skill (no PROOF.txt). output:"; cat "$SB/out" 2>/dev/null
    return 1
  fi
}

@test "real agent kimi executes a routed skill (FIX-152)" {
  _assert_agent_executes kimi
}

@test "real agent pi executes a routed skill" {
  _assert_agent_executes pi
}

@test "real agent claude executes a routed skill" {
  _assert_agent_executes claude
}

# NOTE: agy (antigravity, the fallback slot) is intentionally NOT asserted here.
# Probed 2026-06-01: `agy "$prompt"` (its current plain-mode argv) launches an
# interactive TUI instead of executing headlessly, and `agy -p` did not produce
# output in a non-interactive probe — so the fallback agent cannot run a cycle
# unattended today. Tracked separately as FIX-153; add an assertion here once agy
# has a working headless invocation.
