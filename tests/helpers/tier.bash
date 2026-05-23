#!/usr/bin/env bash
# US-QA-007: classify a .bats file into fast / slow tier.
#
# Resolution order:
#   1. Explicit `# bats tier: fast|slow` header in the file (1st match wins,
#      developer can override the auto-classifier).
#   2. Path under tests/integration/  → slow.
#   3. File body greps for spawning long-running children (launchctl, cron
#      scheduling primitives, sleep N where N≥5)              → slow.
#   4. Default: fast.
#
# Output: prints "fast" or "slow" for the given file path.

roll_tier_classify() {
  local file="$1"
  [ -f "$file" ] || { printf 'fast\n'; return 0; }

  # 1. Explicit header — search first 10 lines only (header comment block).
  local explicit
  explicit=$(head -n 10 "$file" | grep -oE '^[[:space:]]*#[[:space:]]*bats tier:[[:space:]]*(fast|slow)' | head -1 | grep -oE '(fast|slow)$' || true)
  if [ -n "$explicit" ]; then
    printf '%s\n' "$explicit"
    return 0
  fi

  # 2. Integration tests are always slow.
  case "$file" in
    */tests/integration/*|tests/integration/*) printf 'slow\n'; return 0 ;;
  esac

  # 3. Auto-detect long-running primitives.
  # launchctl / cron-style schedulers spawn real system services.
  # sleep N where N >= 5 keeps the test thread idle long enough to matter.
  if grep -qE '\b(launchctl|crontab|launchd[[:space:]]+register|sleep[[:space:]]+([5-9]|[1-9][0-9]+))\b' "$file" 2>/dev/null; then
    printf 'slow\n'
    return 0
  fi

  # 4. Default.
  printf 'fast\n'
}

# Filter a list of test files by tier. Reads files from stdin, writes
# matching files to stdout. WANT is "fast", "slow", or "all".
roll_tier_filter() {
  local want="${1:-fast}"
  local f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if [ "$want" = "all" ]; then
      printf '%s\n' "$f"
      continue
    fi
    local got; got=$(roll_tier_classify "$f")
    if [ "$got" = "$want" ]; then
      printf '%s\n' "$f"
    fi
  done
}
