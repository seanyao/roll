#!/usr/bin/env bash
# Roll v4 — post-merge showcase
#
# Run AFTER PR #1068 merges to main. It demonstrates the five v4 capabilities on
# a CLEAN, SCOPED demo project (so the output is small + truthful), then shows the
# story-scoped attest report on a real US-V4 story in this repo.
#
#   1. Supervisor Agent is the project-level observe / advise entry
#   2. execution profile has entered the event/state stream
#   3. default agent vs project route profile is a clear, separate mental model
#   4. story-scoped attest report is the acceptance entry
#   5. global dossier refresh is NO LONGER on the delivery path
#
# Usage:  bash scripts/v4-showcase.sh
# Requires: a `roll` on PATH (npm i -g @seanyao/roll) OR run `node dist/roll.mjs`.
set -euo pipefail
export NO_COLOR=1 ROLL_LANG=en

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Honor a pre-set ROLL_BIN (e.g. the fresh bundle); else prefer an installed
# `roll`, falling back to this repo's bundled CLI.
if [ -z "${ROLL_BIN:-}" ]; then
  if command -v roll >/dev/null 2>&1; then ROLL_BIN="roll"; else ROLL_BIN="node $REPO/dist/roll.mjs"; fi
fi
hr() { printf '\n=== %s ===\n' "$1"; }

# ── A clean, scoped demo project (representative v4 state) ───────────────────
DEMO="$(mktemp -d)"; trap 'rm -rf "$DEMO"' EXIT
# Isolate the GLOBAL machine config so the demo never touches your real ~/.roll.
export ROLL_HOME="$DEMO/home"; mkdir -p "$ROLL_HOME"
mkdir -p "$DEMO/.roll/loop" "$DEMO/.roll/features/payments/US-PAY-002"
cat > "$DEMO/.roll/backlog.md" <<'EOF'
# Backlog

| ID | Description | Status |
| --- | --- | --- |
| US-PAY-001 | Refund flow groundwork | ✅ Done |
| US-PAY-002 | Refund UI — user-visible `depends-on:US-PAY-001` | 📋 Todo |
| US-PAY-003 | Reconcile ledger truth + release gate | 📋 Todo |
EOF
# Project route profile (the rendered per-slot form) + opt into auto
# execution-profile selection via execution_policy.
cat > "$DEMO/.roll/agents.yaml" <<'EOF'
schema: v4
easy: { agent: codex }
default: { agent: codex, model: gpt-5-codex }
hard: { agent: kimi }
fallback: { agent: codex }
execution_profiles:
  verified:
    roles:
      builder: { routing: default }
      evaluator: { rig: reasonix-eval }
execution_policy:
  mode: auto
  default_profile: standard
supervisor:
  enabled: false
  mode: observe
EOF
# US-PAY-001 was really delivered (merge truth) + a recorded execution profile
cat > "$DEMO/.roll/features/payments/US-PAY-002/spec.md" <<'EOF'
# US-PAY-002 — Refund UI
**AC:**
- [ ] the refund page renders for a partial payment
EOF
printf '%s\n' \
  '{"type":"pr:open","prNumber":1,"storyId":"US-PAY-001","ts":1}' \
  '{"type":"pr:merge","prNumber":1,"storyId":"US-PAY-001","ts":2}' \
  '{"type":"cycle:start","cycleId":"C-200","storyId":"US-PAY-002","agent":"codex","model":"gpt-5","ts":3}' \
  '{"type":"execution:profile","cycleId":"C-200","storyId":"US-PAY-002","profile":"verified","reason":"verified: user-visible [policy:auto → verified]","ts":4}' \
  > "$DEMO/.roll/loop/events.ndjson"

cd "$DEMO"

# 1 · Supervisor Agent — project-level observe + advise
hr "1. roll supervisor status   (project-level observe + advise)"
$ROLL_BIN supervisor status
hr "   roll supervisor next   (what should Roll do next?)"
$ROLL_BIN supervisor next       # → US-PAY-002 (deps satisfied: US-PAY-001)

# 2 · Execution profile is recorded in the durable event/state stream
hr "2. execution profile recorded in events/state"
echo "   the cycle's live trace:"
$ROLL_BIN cycle watch C-200 --once || true
echo "   the durable execution:profile event (events.ndjson):"
grep "execution:profile" .roll/loop/events.ndjson || true

# 3 · Default agent (global) vs project route profile (project-local)
hr "3. default agent (~/.roll/config.yaml) vs project routes (.roll/agents.yaml)"
$ROLL_BIN agent default codex >/dev/null   # set the demo's machine default (isolated ROLL_HOME)
$ROLL_BIN agent                            # shows BOTH: machine default + project routes

cd - >/dev/null

# 4 + 5 · Story-scoped attest report is the acceptance entry; no global refresh
hr "4+5. roll attest US-V4-008   (story-scoped report; no global dossier refresh)"
# Physical Terminal.app screenshots are Evaluator evidence work; on a headless /
# no-Screen-Recording host the capture lane records an HONEST skip (never a fake
# image, never an owner ask). The story-scoped report is still produced.
INDEX_BEFORE="absent"
if [ -f .roll/features/index.html ]; then
  INDEX_BEFORE="$(cksum .roll/features/index.html)"
fi
$ROLL_BIN attest US-V4-008 || true
INDEX_AFTER="absent"
if [ -f .roll/features/index.html ]; then
  INDEX_AFTER="$(cksum .roll/features/index.html)"
fi
echo "   → report:  .roll/features/autonomous-evolution/US-V4-008/latest/US-V4-008-report.html"
echo "   → attest writes ONLY the story folder; it does NOT refresh .roll/features/index.html:"
if [ "$INDEX_BEFORE" = "$INDEX_AFTER" ]; then
  echo "     [ok] global dossier index unchanged"
else
  echo "     [warn] global dossier index changed"
fi

hr "showcase complete"
