#!/usr/bin/env bats
# FIX-051: release.sh mechanically enforces 规划中 markers after AI rewrites
# features.md. The rule is no longer carried by AI prompt alone (US-DOC-011);
# a pure-shell post-process step appends *(规划中)* to any all-Todo Feature
# catalog line that lacks the marker.

setup() {
  RELEASE_SH="${BATS_TEST_DIRNAME}/../../scripts/release.sh"
  TMP=$(mktemp -d)
  # Load only _enforce_planning_markers from release.sh (no side effects).
  eval "$(awk '/^_enforce_planning_markers\(\) \{/{found=1} found{print} found && /^\}$/{exit}' "$RELEASE_SH")"
}

teardown() {
  rm -rf "$TMP"
}

@test "appends 规划中 to all-Todo Feature catalog line (linked form)" {
  cat > "$TMP/.roll/backlog.md" <<'EOF'
## Epic: Foo
### Feature: alpha
| US-1 | desc | 📋 Todo |
### Feature: beta
| US-2 | desc | ✅ Done |
EOF
  cat > "$TMP/features.md" <<'EOF'
## Features by Epic
### Foo
- [alpha](.roll/features/alpha.md) — A planning feature
- [beta](.roll/features/beta.md) — A shipped feature
EOF
  _enforce_planning_markers "$TMP/features.md" "$TMP/.roll/backlog.md"
  grep -qF "alpha](.roll/features/alpha.md) — A planning feature *(规划中)*" "$TMP/features.md"
  ! grep -qF "beta](.roll/features/beta.md) — A shipped feature *(规划中)*" "$TMP/features.md"
}

@test "appends 规划中 to all-Todo Feature catalog line (plain-text form)" {
  cat > "$TMP/.roll/backlog.md" <<'EOF'
### Feature: gamma
| US-3 | desc | 📋 Todo |
EOF
  cat > "$TMP/features.md" <<'EOF'
- gamma — plain feature description
EOF
  _enforce_planning_markers "$TMP/features.md" "$TMP/.roll/backlog.md"
  grep -qF -- "- gamma — plain feature description *(规划中)*" "$TMP/features.md"
}

@test "no double-marking when 规划中 already present" {
  cat > "$TMP/.roll/backlog.md" <<'EOF'
### Feature: delta
| US-4 | desc | 📋 Todo |
EOF
  cat > "$TMP/features.md" <<'EOF'
- [delta](.roll/features/delta.md) — description *(规划中)*
EOF
  _enforce_planning_markers "$TMP/features.md" "$TMP/.roll/backlog.md"
  local count
  count=$(grep -c "规划中" "$TMP/features.md")
  [ "$count" -eq 1 ]
}

@test "no-op when no all-Todo Features exist" {
  cat > "$TMP/.roll/backlog.md" <<'EOF'
### Feature: shipped
| US-5 | desc | ✅ Done |
EOF
  cat > "$TMP/features.md" <<'EOF'
- [shipped](.roll/features/shipped.md) — done
EOF
  cp "$TMP/features.md" "$TMP/features.md.orig"
  _enforce_planning_markers "$TMP/features.md" "$TMP/.roll/backlog.md"
  diff "$TMP/features.md" "$TMP/features.md.orig"
}

@test "treats 🔨 In Progress as todo (not shipped)" {
  cat > "$TMP/.roll/backlog.md" <<'EOF'
### Feature: epsilon
| US-6 | desc | 🔨 In Progress |
EOF
  cat > "$TMP/features.md" <<'EOF'
- [epsilon](.roll/features/epsilon.md) — being built
EOF
  _enforce_planning_markers "$TMP/features.md" "$TMP/.roll/backlog.md"
  grep -qF "规划中" "$TMP/features.md"
}

@test "release.sh wires _enforce_planning_markers after AI features rewrite, before commit" {
  local fn_line; fn_line=$(grep -n '^_enforce_planning_markers()' "$RELEASE_SH" | head -1 | cut -d: -f1)
  local call_line; call_line=$(grep -n '_enforce_planning_markers ' "$RELEASE_SH" | grep -v "^${fn_line}:" | head -1 | cut -d: -f1)
  local rewrite_line; rewrite_line=$(grep -n '.roll/features.md updated' "$RELEASE_SH" | head -1 | cut -d: -f1)
  local commit_line; commit_line=$(grep -n '^git commit -m "\[release\]' "$RELEASE_SH" | head -1 | cut -d: -f1)
  [ -n "$call_line" ]
  [ "$rewrite_line" -lt "$call_line" ]
  [ "$call_line" -lt "$commit_line" ]
}
