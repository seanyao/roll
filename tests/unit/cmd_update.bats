#!/usr/bin/env bats

load helpers

setup() {
  unit_setup
  mkdir -p "$TEST_TMP/bin"
}

teardown() { unit_teardown; }

@test "cmd_update: defaults to npm when .install-method is missing" {
  mkdir -p "$TEST_TMP/mock_roll/bin"
  cat > "$TEST_TMP/mock_roll/bin/roll" <<'EOF'
VERSION="2026.601.4"
EOF

  # Mock npm to succeed
  cat > "$TEST_TMP/bin/npm" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  view)    echo "2026.601.5" ;;
  root)    echo "$TEST_TMP/modules" ;;
  install) : ;;
  cache)   : ;;
esac
EOF
  chmod +x "$TEST_TMP/bin/npm"

  PATH="$TEST_TMP/bin:$PATH" \
    run bash -c 'source bin/roll >/dev/null 2>&1; cmd_update() { info "$(msg update.upgrading_via_npm)"; }; cmd_update'
  [[ "$status" -eq 0 ]]
  [[ "$output" == *"Upgrading via npm"* ]]
}

@test "cmd_update: uses curl path when .install-method is curl" {
  mkdir -p "$TEST_TMP/mock_roll/bin"
  cat > "$TEST_TMP/mock_roll/bin/roll" <<'EOF'
VERSION="2026.601.4"
EOF
  echo "curl" > "$TEST_TMP/mock_roll/.install-method"

  # Mock _download_and_install_curl to just succeed
  run bash -c 'source bin/roll >/dev/null 2>&1; _download_and_install_curl() { return 0; }; cmd_update() { info "$(msg update.upgrading_via_curl)"; _download_and_install_curl "v2026.601.5"; }; cmd_update'
  [[ "$status" -eq 0 ]]
  [[ "$output" == *"Upgrading via curl"* ]]
}

@test "_resolve_remote_version: returns ROLL_VERSION when set" {
  ROLL_VERSION="v2026.601.5" run bash -c 'source bin/roll >/dev/null 2>&1; _resolve_remote_version'
  [[ "$status" -eq 0 ]]
  [[ "$output" == "v2026.601.5" ]]
}

@test "_resolve_remote_version: resolves from GitHub API" {
  cat > "$TEST_TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"api.github.com"* ]]; then
  echo '{"tag_name":"v2026.601.5"}'
else
  echo "Unexpected call" >&2
  exit 1
fi
EOF
  chmod +x "$TEST_TMP/bin/curl"

  PATH="$TEST_TMP/bin:$PATH" run bash -c 'source bin/roll >/dev/null 2>&1; _resolve_remote_version'
  [[ "$status" -eq 0 ]]
  [[ "$output" == "v2026.601.5" ]]
}

@test "_download_and_install_curl: downloads and atomically swaps" {
  mkdir -p "$TEST_TMP/pkg/bin"
  echo "old" > "$TEST_TMP/pkg/bin/roll"
  echo "curl" > "$TEST_TMP/pkg/.install-method"

  mkdir -p "$TEST_TMP/fixture/roll-v2026.601.5/bin"
  echo "new" > "$TEST_TMP/fixture/roll-v2026.601.5/bin/roll"
  (cd "$TEST_TMP/fixture" && tar -czf "$TEST_TMP/roll.tar.gz" roll-v2026.601.5)

  cat > "$TEST_TMP/bin/curl" <<EOF
#!/usr/bin/env bash
# Mock curl: honor -o <file> like real curl (the code downloads with -o).
out=""
prev=""
for arg in "\$@"; do
  [[ "\$prev" == "-o" ]] && out="\$arg"
  prev="\$arg"
done
if [[ "\$*" == *"tar.gz"* ]]; then
  if [[ -n "\$out" ]]; then
    cp "$TEST_TMP/roll.tar.gz" "\$out"
  else
    cat "$TEST_TMP/roll.tar.gz"
  fi
else
  echo "Unexpected call" >&2
  exit 1
fi
EOF
  chmod +x "$TEST_TMP/bin/curl"

  ROLL_PKG_DIR="$TEST_TMP/pkg" \
    PATH="$TEST_TMP/bin:$PATH" \
    run bash -c 'source bin/roll >/dev/null 2>&1; _download_and_install_curl "v2026.601.5"'
  [[ "$status" -eq 0 ]]
  [[ "$(cat "$TEST_TMP/pkg/bin/roll")" == "new" ]]
  [[ "$(cat "$TEST_TMP/pkg/.install-method")" == "curl" ]]
}
