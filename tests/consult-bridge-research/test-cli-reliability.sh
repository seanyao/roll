#!/usr/bin/env bash
set -euo pipefail

# Cross-Agent CLI Reliability Test
# Tests non-interactive invocation of Kimi CLI and Claude Code
# to validate feasibility of direct-CLI consult bridge.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_DIR="${SCRIPT_DIR}/reports"
mkdir -p "$REPORT_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="${REPORT_DIR}/report_${TIMESTAMP}.md"

# Colors
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
CYAN=$'\033[0;36m'
BOLD=$'\033[1m'
NC=$'\033[0m'

log_info()  { echo -e "${CYAN}[test]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[test]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[test]${NC} $*"; }
log_err()   { echo -e "${RED}[test]${NC} $*" >&2; }

# ─── Helpers ─────────────────────────────────────────────────────────────────

# Run a command with timeout, capture stdout/stderr/exit_code/time
run_timed() {
  local cmd="$1"
  local label="$2"
  local timeout_sec="${3:-120}"
  local out_file
  local err_file
  local time_file
  out_file="$(mktemp)"
  err_file="$(mktemp)"
  time_file="$(mktemp)"

  log_info "Running: $label"
  log_info "Command: $cmd"

  local exit_code=0
  # Use /usr/bin/time -p for portability on macOS
  if /usr/bin/time -p -o "$time_file" bash -c "$cmd" > "$out_file" 2> "$err_file"; then
    exit_code=0
  else
    exit_code=$?
  fi

  local elapsed
  elapsed=$(grep real "$time_file" | awk '{print $2}')
  rm -f "$time_file"

  echo ""
  echo "## $label"
  echo ""
  echo "- **Command**: \`$cmd\`"
  echo "- **Exit Code**: $exit_code"
  echo "- **Elapsed**: ${elapsed}s"
  echo "- **Stdout Length**: $(wc -c < "$out_file") bytes"
  echo "- **Stderr Length**: $(wc -c < "$err_file") bytes"
  echo ""
  echo "### stdout"
  echo '```'
  head -c 4000 < "$out_file" || true
  echo '```'
  echo ""
  echo "### stderr"
  echo '```'
  head -c 2000 < "$err_file" || true
  echo '```'
  echo ""

  if [[ $exit_code -eq 0 ]] && [[ -s "$out_file" ]]; then
    log_ok "$label: SUCCESS (${elapsed}s, $(wc -c < "$out_file") bytes)"
  elif [[ $exit_code -ne 0 ]]; then
    log_err "$label: FAILED (exit=$exit_code, ${elapsed}s)"
  else
    log_warn "$label: EMPTY (exit=0 but no output, ${elapsed}s)"
  fi

  rm -f "$out_file" "$err_file"
}

# ─── Test Prompts ────────────────────────────────────────────────────────────

PROMPT_SIMPLE="Explain what a bash shebang is, in one sentence."

PROMPT_CODE_REVIEW="Review this bash function for safety issues. List exactly 2 problems if any:
\`\`\`bash
#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  rm -rf /tmp/workdir
}

trap cleanup EXIT
\`\`\`"

PROMPT_TOOL_NEED="Read the file /Users/seanyao/CodeSpace/Roll/package.json and tell me the project name and version. Do not guess; read the file."

PROMPT_CONSULT_PROTOCOL="You are participating in a cross-agent consultation protocol.

[ROLL_CONSULT round=1 tool=kimi→claude]

## 决议状态
- REFINE

## 上下文交接卡
- 项目根目录: /Users/seanyao/CodeSpace/Roll
- 执行环境: macOS zsh
- 项目类型: Bash CLI + Node.js tooling
- 关键工具:
  - test: npm test
  - build: npm run build (if exists)
  - lint: shellcheck bin/roll

## 议题
Should we add a new 'roll-consult' skill that enables bidirectional negotiation between Kimi CLI and Claude Code?

## 建议方案
Add a new skill directory skills/roll-consult/ with a bridge script that calls the other CLI non-interactively.

## 来源核查
- Roll project root: /Users/seanyao/CodeSpace/Roll (verified by shell pwd)

Please respond using the same [ROLL_CONSULT] format with one of AGREE, REFINE, or OBJECT."

# ─── Report Header ───────────────────────────────────────────────────────────

{
  echo "# Cross-Agent CLI Reliability Report"
  echo ""
  echo "- **Date**: $(date -Iseconds)"
  echo "- **Host**: $(uname -a)"
  echo ""
  echo "## Tool Versions"
  echo ""
  echo "\`\`\`"
  echo "Kimi CLI: $(kimi --version 2>/dev/null || echo 'NOT FOUND')"
  echo "Claude Code: $(claude --version 2>/dev/null || echo 'NOT FOUND')"
  echo "\`\`\`"
  echo ""
} > "$REPORT_FILE"

# ─── Run Tests ───────────────────────────────────────────────────────────────

log_info "Starting CLI reliability tests..."
log_info "Report will be written to: $REPORT_FILE"
echo ""

# ── Test Group A: Basic Non-Interactive Invocation ───────────────────────────

{
  echo "## Group A: Basic Non-Interactive Invocation"
  echo ""
} >> "$REPORT_FILE"

log_info "=== Group A: Basic Non-Interactive Invocation ==="

run_timed \
  "kimi --quiet -p '${PROMPT_SIMPLE}'" \
  "A1: Kimi --quiet simple prompt" \
  60 >> "$REPORT_FILE"

run_timed \
  "claude -p --output-format text '${PROMPT_SIMPLE}'" \
  "A2: Claude -p simple prompt" \
  60 >> "$REPORT_FILE"

# ── Test Group B: Code Analysis (No tools needed) ────────────────────────────

{
  echo "## Group B: Code Analysis (No Tools Needed)"
  echo ""
} >> "$REPORT_FILE"

log_info "=== Group B: Code Analysis (No Tools Needed) ==="

run_timed \
  "kimi --quiet -p '${PROMPT_CODE_REVIEW}'" \
  "B1: Kimi --quiet code review" \
  60 >> "$REPORT_FILE"

run_timed \
  "claude -p --output-format text '${PROMPT_CODE_REVIEW}'" \
  "B2: Claude -p code review" \
  60 >> "$REPORT_FILE"

# ── Test Group C: Tool Invocation Required ───────────────────────────────────

{
  echo "## Group C: Tool Invocation Required (Read File)"
  echo ""
} >> "$REPORT_FILE"

log_info "=== Group C: Tool Invocation Required (Read File) ==="

run_timed \
  "kimi --quiet -p '${PROMPT_TOOL_NEED}'" \
  "C1: Kimi --quiet with tool need" \
  90 >> "$REPORT_FILE"

run_timed \
  "claude -p --output-format text '${PROMPT_TOOL_NEED}'" \
  "C2: Claude -p with tool need" \
  90 >> "$REPORT_FILE"

# ── Test Group D: Consult Protocol Stress Test ───────────────────────────────

{
  echo "## Group D: Consult Protocol Stress Test"
  echo ""
} >> "$REPORT_FILE"

log_info "=== Group D: Consult Protocol Stress Test ==="

run_timed \
  "kimi --quiet -p '${PROMPT_CONSULT_PROTOCOL}'" \
  "D1: Kimi --quiet consult protocol" \
  90 >> "$REPORT_FILE"

run_timed \
  "claude -p --output-format text '${PROMPT_CONSULT_PROTOCOL}'" \
  "D2: Claude -p consult protocol" \
  90 >> "$REPORT_FILE"

# ── Test Group E: Session Resume ─────────────────────────────────────────────

{
  echo "## Group E: Session Resume"
  echo ""
} >> "$REPORT_FILE"

log_info "=== Group E: Session Resume ==="

# Create a session first, then try to resume it
SESSION_NAME="consult_test_${TIMESTAMP}"

run_timed \
  "claude -p --name '${SESSION_NAME}' --output-format text 'Remember this codeword: blue-whale-42. Just confirm you remembered it.'" \
  "E1: Claude create named session" \
  60 >> "$REPORT_FILE"

run_timed \
  "claude -p --resume '${SESSION_NAME}' --output-format text 'What was the codeword I told you?'" \
  "E2: Claude resume named session" \
  60 >> "$REPORT_FILE"

# Kimi session test (if session ID can be extracted, otherwise skip)
log_info "Kimi session resume requires interactive session creation first; skipping automated test."
{
  echo "- **E3**: Kimi session resume — skipped (requires prior interactive session to obtain ID)"
  echo ""
} >> "$REPORT_FILE"

# ── Report Footer ────────────────────────────────────────────────────────────

{
  echo "---"
  echo ""
  echo "## Summary"
  echo ""
  echo "Review the results above. Key metrics to look for:"
  echo ""
  echo "1. **Exit Code 0 + Non-empty stdout** = Direct CLI call works."
  echo "2. **Exit Code 0 + Empty stdout** = API gateway may be blocking (friend-skill symptom)."
  echo "3. **Exit Code non-zero** = CLI error (permissions, auth, version incompatibility)."
  echo "4. **Tool invocation** = Check if C1/C2 actually read the file (not hallucinated)."
  echo ""
} >> "$REPORT_FILE"

log_ok "All tests complete. Report: $REPORT_FILE"
echo ""
cat "$REPORT_FILE"
