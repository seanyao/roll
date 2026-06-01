#!/usr/bin/env bats

setup() {
  TEST_TMP="$(mktemp -d)"
  INSTALL_SCRIPT="${BATS_TEST_DIRNAME}/../install"

  # Create a minimal fixture tarball that looks like a GitHub release
  mkdir -p "${TEST_TMP}/fixture/roll-v2.601.1/bin"
  cat > "${TEST_TMP}/fixture/roll-v2.601.1/bin/roll" <<'EOF'
#!/usr/bin/env bash
# Minimal roll stub for testing
_source="${BASH_SOURCE[0]:-$0}"
while [[ -L "$_source" ]]; do
  _dir="$(cd "$(dirname "$_source")" && pwd)"
  _source="$(readlink "$_source")"
  [[ "$_source" != /* ]] && _source="$_dir/$_source"
done
SCRIPT_DIR="$(cd "$(dirname "$_source")" && pwd)"
ROLL_PKG_DIR="$(dirname "$SCRIPT_DIR")"
EOF
  chmod +x "${TEST_TMP}/fixture/roll-v2.601.1/bin/roll"
  mkdir -p "${TEST_TMP}/fixture/roll-v2.601.1/lib"
  touch "${TEST_TMP}/fixture/roll-v2.601.1/lib/placeholder"
  (cd "${TEST_TMP}/fixture" && tar -czf "${TEST_TMP}/roll.tar.gz" roll-v2.601.1)

  # Create curl mock that serves the fixture
  mkdir -p "${TEST_TMP}/mockbin"
  cat > "${TEST_TMP}/mockbin/curl" <<EOF
#!/usr/bin/env bash
output_file=""
args=("\$@")
for ((i=0; i<\${#args[@]}; i++)); do
  if [[ "\${args[\$i]}" == "-o" ]] && ((i+1 < \${#args[@]})); then
    output_file="\${args[\$((i+1))]}"
  fi
done

if [[ "\$*" == *"api.github.com"* ]]; then
  if [[ -n "\$output_file" ]]; then
    echo '{"tag_name":"v2.601.1"}' > "\$output_file"
  else
    echo '{"tag_name":"v2.601.1"}'
  fi
elif [[ "\$*" == *"tar.gz"* ]]; then
  if [[ -n "\$output_file" ]]; then
    cat "${TEST_TMP}/roll.tar.gz" > "\$output_file"
  else
    cat "${TEST_TMP}/roll.tar.gz"
  fi
else
  echo "Unexpected curl call: \$*" >&2
  exit 1
fi
EOF
  chmod +x "${TEST_TMP}/mockbin/curl"
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

@test "install: downloads from network and sets up symlink" {
  PATH="${TEST_TMP}/mockbin:$PATH" HOME="$TEST_TMP" run bash "$INSTALL_SCRIPT"
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

  PATH="${TEST_TMP}/mockbin:$PATH" HOME="$TEST_TMP" run bash "$INSTALL_SCRIPT"
  [[ "$status" -eq 0 ]]

  # Run again
  PATH="${TEST_TMP}/mockbin:$PATH" HOME="$TEST_TMP" run bash "$INSTALL_SCRIPT"
  [[ "$status" -eq 0 ]]

  # Count PATH entries in .bashrc
  local count
  count=$(grep -cF 'export PATH="$HOME/.local/bin:$PATH"' "${TEST_TMP}/.bashrc" || true)
  [[ "$count" -eq 1 ]]
}

@test "install: symlink resolves ROLL_PKG_DIR correctly" {
  PATH="${TEST_TMP}/mockbin:$PATH" HOME="$TEST_TMP" run bash "$INSTALL_SCRIPT"
  [[ "$status" -eq 0 ]]

  # Extract ROLL_PKG_DIR by sourcing the symlinked bin/roll
  run bash -c 'HOME="'"$TEST_TMP"'" source "'"${TEST_TMP}/.local/bin/roll"'" && echo "$ROLL_PKG_DIR"'
  [[ "$status" -eq 0 ]]
  [[ "$output" == "${TEST_TMP}/.local/share/roll" ]]
}

@test "install: ROLL_VERSION pins version without calling API" {
  # Create a curl mock that fails on API call but succeeds on download
  cat > "${TEST_TMP}/mockbin/curl" <<EOF
#!/usr/bin/env bash
output_file=""
args=("\$@")
for ((i=0; i<\${#args[@]}; i++)); do
  if [[ "\${args[\$i]}" == "-o" ]] && ((i+1 < \${#args[@]})); then
    output_file="\${args[\$((i+1))]}"
  fi
done

if [[ "\$*" == *"api.github.com"* ]]; then
  echo "API should not be called" >&2
  exit 1
elif [[ "\$*" == *"tar.gz"* ]]; then
  if [[ -n "\$output_file" ]]; then
    cat "${TEST_TMP}/roll.tar.gz" > "\$output_file"
  else
    cat "${TEST_TMP}/roll.tar.gz"
  fi
else
  echo "Unexpected curl call: \$*" >&2
  exit 1
fi
EOF
  chmod +x "${TEST_TMP}/mockbin/curl"

  ROLL_VERSION="v2.601.1" PATH="${TEST_TMP}/mockbin:$PATH" HOME="$TEST_TMP" run bash "$INSTALL_SCRIPT"
  [[ "$status" -eq 0 ]]
  [[ "$output" == *"v2.601.1"* ]]
}

@test "install: handles download failure gracefully" {
  cat > "${TEST_TMP}/mockbin/curl" <<'EOF'
#!/usr/bin/env bash
output_file=""
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  if [[ "${args[$i]}" == "-o" ]] && ((i+1 < ${#args[@]})); then
    output_file="${args[$((i+1))]}"
  fi
done

if [[ "$*" == *"api.github.com"* ]]; then
  if [[ -n "$output_file" ]]; then
    echo '{"tag_name":"v2.601.1"}' > "$output_file"
  else
    echo '{"tag_name":"v2.601.1"}'
  fi
elif [[ "$*" == *"tar.gz"* ]]; then
  echo "Network error" >&2
  exit 1
else
  echo "Unexpected curl call: $*" >&2
  exit 1
fi
EOF
  chmod +x "${TEST_TMP}/mockbin/curl"

  PATH="${TEST_TMP}/mockbin:$PATH" HOME="$TEST_TMP" run bash "$INSTALL_SCRIPT"
  [[ "$status" -eq 1 ]]
  [[ "$output" == *"Failed to download"* ]]
}
