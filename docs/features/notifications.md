# Feature: notifications

## US-NOTIFY-001 macOS system notifications for loop events ✅

**Completed**: 2026-05-12

**AC:**
- [x] macOS notification sent when story completes (`roll loop notify "title" "body"`)
- [x] macOS notification sent when CI gate fails (inside `_loop_enforce_ci`)
- [x] macOS notification sent when TCR check fails (inside `_loop_enforce_tcr`)
- [x] No notification when muted (`~/.shared/roll/mute` exists)
- [x] Silently degrades on non-macOS (uname != Darwin)
- [x] Silently degrades when `osascript` not available
- [x] Loop SKILL Step 4 updated to call `roll loop notify` after story success
- [x] Unit tests: 5 cases covering mute/no-osascript paths
- [x] E2E tests: 3 cases covering CLI invocation

**Files:**
- `bin/roll` — added `_notify` helper, wired into `_loop_enforce_ci` and `_loop_enforce_tcr`, added `notify` to `cmd_loop` dispatcher
- `~/.roll/skills/roll-loop/SKILL.md` — Step 4 updated with notification call
- `tests/unit/roll_loop_notify.bats` — 5 unit tests
- `tests/integration/cmd_notify.bats` — 3 E2E tests
- `docs/features/notifications.md` — this file
