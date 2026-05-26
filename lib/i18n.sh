#!/usr/bin/env bash
# Roll i18n engine — US-I18N-001.
#
# Provides:
#   _i18n_resolve_lang     — resolve user's language per precedence
#   msg <key> [args...]    — look up message catalog with EN fallback
#   _i18n_set <lang> <key> <value>  — fill the catalog (used by modules)
#
# Storage is bash 3.2-compatible (macOS default ships 3.2): each catalog entry
# is held in a plain variable named `MSG_<LANG>_<key>`, looked up via indirect
# reference. Bash 4 assoc arrays would be cleaner but break macOS default bash
# (see AGENTS.md §4: single bash script, no runtime).
#
# Precedence: ROLL_LANG env > ~/.roll/config.yaml `lang` > LC_ALL > LANG
#             > (macOS) AppleLanguages > 'en'.
# Decision:   value starting with `zh` → "zh", everything else → "en".

# Sanitize a free-form key into a variable-safe suffix. Anything that isn't a
# letter, digit, or underscore becomes an underscore so callers can use natural
# dotted keys like "loop.cycle_start" without exploding bash syntax.
_i18n_safe_key() {
  echo "${1//[^A-Za-z0-9_]/_}"
}

# Fill the catalog. Modules call this at source-time:
#   _i18n_set en hello "Hello, %s!"
#   _i18n_set zh hello "你好，%s！"
_i18n_set() {
  local lang="$1" key="$2" val="$3"
  local upper safe varname
  upper="${lang^^}"   # FIX: bash built-in — no subshell fork per entry
  safe=$(_i18n_safe_key "$key")
  varname="MSG_${upper}_${safe}"
  printf -v "$varname" '%s' "$val"
  export "$varname"
}

# Decide "zh" or "en" from a free-form locale string.
_i18n_classify() {
  case "${1:-}" in
    zh*) echo zh ;;
    *)   echo en ;;
  esac
}

# Resolve the active language. Caches in ROLL_LANG_RESOLVED so later calls are
# free.
_i18n_resolve_lang() {
  if [[ -n "${ROLL_LANG_RESOLVED:-}" ]]; then
    echo "$ROLL_LANG_RESOLVED"
    return
  fi

  local lang=""

  if [[ -n "${ROLL_LANG:-}" ]]; then
    lang=$(_i18n_classify "$ROLL_LANG")
  fi

  if [[ -z "$lang" && -n "${ROLL_CONFIG:-}" && -f "${ROLL_CONFIG}" ]]; then
    local cfg
    cfg=$(grep -E '^lang:' "$ROLL_CONFIG" 2>/dev/null | head -1 \
            | sed 's/^lang:[[:space:]]*//' \
            | sed 's/[[:space:]]*#.*$//' \
            | sed 's/[[:space:]]*$//')
    [[ -n "$cfg" ]] && lang=$(_i18n_classify "$cfg")
  fi

  if [[ -z "$lang" && -n "${LC_ALL:-}" ]]; then
    lang=$(_i18n_classify "$LC_ALL")
  fi

  if [[ -z "$lang" && -n "${LANG:-}" ]]; then
    lang=$(_i18n_classify "$LANG")
  fi

  if [[ -z "$lang" ]] && command -v defaults >/dev/null 2>&1; then
    local apple
    apple=$(defaults read -g AppleLanguages 2>/dev/null | head -2 | tail -1 \
              | tr -d ' ",()' | head -1 || true)
    [[ -n "$apple" ]] && lang=$(_i18n_classify "$apple")
  fi

  [[ -z "$lang" ]] && lang="en"

  ROLL_LANG_RESOLVED="$lang"
  echo "$lang"
}

# Look up message catalog entry. Falls back to EN, then to the key itself so
# missing translations stay visible without crashing the caller.
msg() {
  local key="$1"; shift || true
  local lang safe
  lang=$(_i18n_resolve_lang)
  safe=$(_i18n_safe_key "$key")

  local zh_var="MSG_ZH_${safe}"
  local en_var="MSG_EN_${safe}"
  local tmpl=""

  if [[ "$lang" == "zh" && -n "${!zh_var:-}" ]]; then
    tmpl="${!zh_var}"
  elif [[ -n "${!en_var:-}" ]]; then
    tmpl="${!en_var}"
  else
    tmpl="$key"
  fi

  # shellcheck disable=SC2059 — template comes from our own catalog
  printf "$tmpl" "$@"
  echo
}

# ── Load per-command message catalogs (US-I18N-002) ──
# Source all lib/i18n/*.sh files (skip self). Called once at bin/roll startup.
_i18n_load_catalogs() {
  local i18n_dir
  i18n_dir="$(dirname "${BASH_SOURCE[0]:-$0}")/i18n"
  if [[ -d "$i18n_dir" ]]; then
    local f
    # Load per-command catalogs
    for f in "$i18n_dir"/*.sh; do
      [[ -f "$f" ]] || continue
      # shellcheck source=/dev/null
      source "$f"
    done
    # Load skill catalogs (US-I18N-003)
    if [[ -d "$i18n_dir/skills" ]]; then
      for f in "$i18n_dir/skills"/*.sh; do
        [[ -f "$f" ]] || continue
        # shellcheck source=/dev/null
        source "$f"
      done
    fi
  fi
}
_i18n_load_catalogs
