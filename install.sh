#!/usr/bin/env bash
set -euo pipefail

# For contributors working on roll itself.
# Regular users: npm install -g roll
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# US-PORT-021: the bash engine (bin/roll) is retired. The dev entry is the
# TS-first Node launcher; it imports the workspace's built dist/, so build first.
BIN_SRC="$REPO_DIR/packages/cli/bin/roll.js"
BIN_DIR="$HOME/.local/bin"
BIN_DST="$BIN_DIR/roll"

echo "[roll] Installing Roll from: $REPO_DIR"

# 1. Build the workspace so the launcher's dist/ imports resolve
if [[ ! -f "$REPO_DIR/packages/cli/dist/index.js" ]]; then
  echo "[roll] Building workspace…"
  (cd "$REPO_DIR" && pnpm install --frozen-lockfile && pnpm -r build)
fi
chmod +x "$BIN_SRC"

# 2. Ensure ~/.local/bin exists
mkdir -p "$BIN_DIR"

# 3. Symlink into PATH
ln -sf "$BIN_SRC" "$BIN_DST"
echo "[roll] Linked: $BIN_DST -> $BIN_SRC"

# 4. Ensure ~/.local/bin is in PATH (for current session and future shells)
if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  SHELL_RC=""
  case "${SHELL:-}" in
    */zsh)  SHELL_RC="$HOME/.zshrc" ;;
    */bash) SHELL_RC="$HOME/.bashrc" ;;
  esac

  if [[ -n "$SHELL_RC" ]]; then
    EXPORT_LINE='export PATH="$HOME/.local/bin:$PATH"'
    if ! grep -qF "$EXPORT_LINE" "$SHELL_RC" 2>/dev/null; then
      echo "" >> "$SHELL_RC"
      echo "# Added by roll install" >> "$SHELL_RC"
      echo "$EXPORT_LINE" >> "$SHELL_RC"
      echo "[roll] Added PATH entry to $SHELL_RC"
    fi
  fi

  # Also export for the remainder of this session
  export PATH="$BIN_DIR:$PATH"
fi

# 5. Run first-time setup
echo ""
roll setup
