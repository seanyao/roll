# Feature: alert-lifecycle

## US-ALERT-001 `roll alert` — ALERT lifecycle management ✅

**Completed**: 2026-05-12

**AC:**
- [x] `roll alert` (or `roll alert list`) shows active alert content; shows "no alerts" message when none
- [x] `roll alert ack` appends an Acknowledged timestamp to the active alert file
- [x] `roll alert resolve` (alias: `roll alert clear`) removes the alert file
- [x] `roll loop status` and `roll loop monitor` update hints to point to `roll alert`
- [x] `roll status` global alert badge updated to `roll alert`
- [x] Unit tests cover all subcommands (12 cases)
- [x] E2E integration tests cover happy paths (4 cases)

**Files:**
- `bin/roll` — added `cmd_alert`, wired dispatcher, updated 3 alert display sites
- `tests/unit/roll_alert.bats` — 12 unit tests
- `tests/integration/cmd_alert.bats` — 4 E2E tests
- `docs/features/alert-lifecycle.md` — this file
