#!/usr/bin/env bash
# migrate-to-roll.sh — One-click migration from wukong → roll
# Usage: bash scripts/migrate-to-roll.sh [--dry-run]
set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# ─── Colors ──────────────────────────────────────────────────────────────────
if [[ -z "${NO_COLOR:-}" ]]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'
  CYAN=$'\033[0;36m'; BOLD=$'\033[1m'; NC=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; NC=''
fi

info()  { echo -e "${CYAN}[migrate]${NC} $*"; }
ok()    { echo -e "${GREEN}[migrate]${NC} $*"; }
warn()  { echo -e "${YELLOW}[migrate]${NC} $*"; }
err()   { echo -e "${RED}[migrate]${NC} $*" >&2; }
step()  { echo -e "\n${BOLD}── $* ──${NC}"; }

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "  ${YELLOW}[dry-run]${NC} $*"
  else
    eval "$@"
  fi
}

confirm() {
  local prompt="$1"
  if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "  ${YELLOW}[dry-run]${NC} Would ask: $prompt → assuming y"
    return 0
  fi
  echo -n "  $prompt [y/N] "
  read -r answer
  [[ "$answer" =~ ^[Yy]$ ]]
}

# ─── Counters ────────────────────────────────────────────────────────────────
migrated=0; removed=0; skipped=0

echo ""
echo -e "${BOLD}Roll Migration Script${NC}"
echo -e "Migrates ${CYAN}~/.wukong/${NC} → ${GREEN}~/.roll/${NC}"
[[ "$DRY_RUN" == "true" ]] && warn "DRY-RUN mode — no changes will be made"
echo ""

# ─── Step 1: Check source exists ─────────────────────────────────────────────
step "Step 1: Check ~/.wukong/"
if [[ ! -d "$HOME/.wukong" ]]; then
  warn "~/.wukong/ not found — nothing to migrate."
  info "If roll is already set up, run: roll setup"
  exit 0
fi
ok "Found ~/.wukong/"

# ─── Step 2: Copy ~/.wukong → ~/.roll ────────────────────────────────────────
step "Step 2: Copy ~/.wukong/ → ~/.roll/"
if [[ -d "$HOME/.roll" ]]; then
  warn "~/.roll/ already exists."
  if ! confirm "Overwrite ~/.roll/ with contents of ~/.wukong/?"; then
    info "Skipped copy — using existing ~/.roll/"
    skipped=$((skipped + 1))
  else
    run "rm -rf '$HOME/.roll'"
    run "cp -r '$HOME/.wukong' '$HOME/.roll'"
    ok "Copied ~/.wukong/ → ~/.roll/"
    migrated=$((migrated + 1))
  fi
else
  run "cp -r '$HOME/.wukong' '$HOME/.roll'"
  ok "Copied ~/.wukong/ → ~/.roll/"
  migrated=$((migrated + 1))
fi

# ─── Step 3: Rewrite config.yaml paths ───────────────────────────────────────
step "Step 3: Update ~/.roll/config.yaml"
ROLL_CONFIG="$HOME/.roll/config.yaml"
if [[ -f "$ROLL_CONFIG" ]] || [[ "$DRY_RUN" == "true" ]]; then
  run "sed -i '' 's|\.wukong/|.roll/|g' '$ROLL_CONFIG' 2>/dev/null || true"
  run "sed -i '' 's|wukong|roll|g' '$ROLL_CONFIG' 2>/dev/null || true"
  ok "Updated ~/.roll/config.yaml"
  migrated=$((migrated + 1))
else
  warn "~/.roll/config.yaml not found — skipping"
fi

# ─── Step 4: Update @wk.md references in ~/.claude/CLAUDE.md ─────────────────
step "Step 4: Update @wk.md → @roll.md in ~/.claude/CLAUDE.md"
CLAUDE_MD="$HOME/.claude/CLAUDE.md"
if [[ -f "$CLAUDE_MD" ]]; then
  if grep -q "@wk.md" "$CLAUDE_MD"; then
    info "Found @wk.md reference in $CLAUDE_MD"
    run "sed -i '' 's|@wk\.md|@roll.md|g' '$CLAUDE_MD'"
    ok "Updated @wk.md → @roll.md in ~/.claude/CLAUDE.md"
    migrated=$((migrated + 1))
  else
    info "No @wk.md reference found in ~/.claude/CLAUDE.md — skipping"
    skipped=$((skipped + 1))
  fi
else
  info "~/.claude/CLAUDE.md not found — skipping"
  skipped=$((skipped + 1))
fi

# ─── Step 5: Remove stale skill symlinks ─────────────────────────────────────
step "Step 5: Remove stale wk-* skill symlinks"
AI_DIRS=(~/.claude ~/.gemini ~/.kimi ~/.codex ~/.cursor)
for ai_dir in "${AI_DIRS[@]}"; do
  ai_dir=$(eval echo "$ai_dir")

  # Case A: whole-dir symlink pointing to old ~/.wukong/skills (now dangling)
  skills_dir="$ai_dir/skills"
  if [[ -L "$skills_dir" ]]; then
    target="$(readlink "$skills_dir")"
    real="$(cd "$skills_dir" 2>/dev/null && pwd -P || true)"
    if [[ -z "$real" ]]; then
      info "Removing dangling symlink ${skills_dir/#$HOME/~} -> ${target/#$HOME/~}"
      run "rm '$skills_dir'"
      removed=$((removed + 1))
    fi
    continue
  fi

  # Case B: per-skill wk-* symlinks inside a real skills dir
  [[ -d "$skills_dir" ]] || continue
  old_links=$(find "$skills_dir" -maxdepth 1 -type l -name "wk-*" 2>/dev/null || true)
  if [[ -n "$old_links" ]]; then
    count=$(echo "$old_links" | wc -l | tr -d ' ')
    info "Removing $count wk-* symlinks from ${skills_dir/#$HOME/~}/"
    while IFS= read -r link; do
      run "rm '$link'"
    done <<< "$old_links"
    removed=$((removed + count))
  fi
done
ok "Stale skill symlinks removed"

# ─── Step 6: Install roll binary symlink ─────────────────────────────────────
step "Step 6: Install roll binary"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
BIN_SRC="$REPO_ROOT/bin/roll"
BIN_DST="$HOME/.local/bin/roll"

if [[ ! -f "$BIN_SRC" ]]; then
  warn "bin/roll not found at $BIN_SRC — skipping binary install"
  warn "Run: bash $REPO_ROOT/install.sh"
  skipped=$((skipped + 1))
else
  run "mkdir -p '$HOME/.local/bin'"
  run "chmod +x '$BIN_SRC'"
  run "ln -sf '$BIN_SRC' '$BIN_DST'"
  ok "Linked: $BIN_DST → $BIN_SRC"
  migrated=$((migrated + 1))

  # Ensure ~/.local/bin is in PATH for this session
  if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
    export PATH="$HOME/.local/bin:$PATH"
    info "Added ~/.local/bin to PATH for this session"
  fi
fi

# ─── Step 7: Run roll sync skills ────────────────────────────────────────────
step "Step 7: Install roll-* skill symlinks"
if command -v roll &>/dev/null; then
  run "roll sync skills"
  ok "roll-* skill symlinks installed"
else
  warn "'roll' still not found in PATH."
  info "Add to your shell rc: export PATH=\"\$HOME/.local/bin:\$PATH\""
  info "Then run: roll sync skills"
fi

# ─── Step 8: Remove ~/.wukong/ ───────────────────────────────────────────────
step "Step 8: Remove ~/.wukong/"
if [[ -d "$HOME/.wukong" ]]; then
  if confirm "Remove ~/.wukong/ now? (migration is complete without it)"; then
    run "rm -rf '$HOME/.wukong'"
    ok "Removed ~/.wukong/"
    removed=$((removed + 1))
  else
    info "Kept ~/.wukong/ — you can remove it later: rm -rf ~/.wukong"
    skipped=$((skipped + 1))
  fi
fi

# ─── Step 9: Remove old wukong binary ────────────────────────────────────────
step "Step 9: Remove old wukong binary"
OLD_BIN="$HOME/.local/bin/wukong"
if [[ -L "$OLD_BIN" ]] || [[ -f "$OLD_BIN" ]]; then
  if confirm "Remove $OLD_BIN?"; then
    run "rm '$OLD_BIN'"
    ok "Removed $OLD_BIN"
    removed=$((removed + 1))
  else
    info "Kept $OLD_BIN — you can remove it manually"
    skipped=$((skipped + 1))
  fi
else
  info "$OLD_BIN not found — skipping"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Migration Summary${NC}"
echo -e "  ${GREEN}+${NC} Migrated: $migrated items"
echo -e "  ${RED}-${NC} Removed:  $removed items"
echo -e "  ${YELLOW}~${NC} Skipped:  $skipped items"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  warn "Dry-run complete — no changes were made. Run without --dry-run to apply."
else
  ok "Migration complete!"
  echo ""
  info "Next: verify with  roll status"
  echo ""
  info "Manual action needed:"
  echo "  • Update any existing project CLAUDE.md that references @wk.md → @roll.md"
  echo "  • Reload your shell:  source ~/.zshrc  (or open a new terminal)"
fi
