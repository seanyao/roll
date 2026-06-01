#!/usr/bin/env bats

setup() {
  TEST_TMP="$(mktemp -d)"
  INSTALL_SCRIPT="${BATS_TEST_DIRNAME}/../install"
}

teardown() {
  rm -rf "$TEST_TMP"
}

@test "install: script exists and is executable" {
  [[ -f "$INSTALL_SCRIPT" ]]
  [[ -x "$INSTALL_SCRIPT" ]]
}

@test "install: rejects unsupported OS" {
  mkdir -p "${TEST_TMP}/mockbin"
  cat > "${TEST_TMP}/mockbin/uname" <<'EOF'
#!/usr/bin/env bash
echo "Windows_NT"
EOF
  chmod +x "${TEST_TMP}/mockbin/uname"

  PATH="${TEST_TMP}/mockbin:/bin" HOME="$TEST_TMP" run bash "$INSTALL_SCRIPT"
  [[ "$status" -eq 1 ]]
  [[ "$output" == *"Unsupported OS"* ]]
}

@test "install: rejects missing python3" {
  mkdir -p "${TEST_TMP}/mockbin"
  cat > "${TEST_TMP}/mockbin/uname" <<'EOF'
#!/usr/bin/env bash
echo "Darwin"
EOF
  chmod +x "${TEST_TMP}/mockbin/uname"

  # Provide curl and tar mocks, but not python3
  for cmd in curl tar; do
    ln -sf "$(command -v true)" "${TEST_TMP}/mockbin/$cmd"
  done

  PATH="${TEST_TMP}/mockbin:/bin" HOME="$TEST_TMP" run bash "$INSTALL_SCRIPT"
  [[ "$status" -eq 1 ]]
  [[ "$output" == *"python3 is required"* ]]
}

@test "install: copies from local repo and sets up symlink" {
  HOME="$TEST_TMP" run bash "$INSTALL_SCRIPT"
  [[ "$status" -eq 0 ]]

  # Data dir exists
  [[ -d "${TEST_TMP}/.local/share/roll" ]]

  # bin/roll exists in data dir
  [[ -f "${TEST_TMP}/.local/share/roll/bin/roll" ]]

  # Symlink exists
  [[ -L "${TEST_TMP}/.local/bin/roll" ]]

  # .install-method
  [[ "$(cat "${TEST_TMP}/.local/share/roll/.install-method")" == "curl" ]]
}

@test "install: is idempotent - does not duplicate PATH entries" {
  export SHELL=/bin/bash

  HOME="$TEST_TMP" run bash "$INSTALL_SCRIPT"
  [[ "$status" -eq 0 ]]

  # Run again
  HOME="$TEST_TMP" run bash "$INSTALL_SCRIPT"
  [[ "$status" -eq 0 ]]

  # Count PATH entries in .bashrc
  local count
  count=$(grep -cF 'export PATH="$HOME/.local/bin:$PATH"' "${TEST_TMP}/.bashrc" || true)
  [[ "$count" -eq 1 ]]
}

@test "install: symlink resolves ROLL_PKG_DIR correctly" {
  HOME="$TEST_TMP" run bash "$INSTALL_SCRIPT"
  [[ "$status" -eq 0 ]]

  # Extract ROLL_PKG_DIR by sourcing the symlinked bin/roll
  run bash -c 'HOME="'"$TEST_TMP"'" source "'"${TEST_TMP}/.local/bin/roll"'" && echo "$ROLL_PKG_DIR"'
  [[ "$status" -eq 0 ]]
  [[ "$output" == "${TEST_TMP}/.local/share/roll" ]]
}
