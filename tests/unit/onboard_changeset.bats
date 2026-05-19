#!/usr/bin/env bats
# US-ONBOARD-013: onboard writes a changeset manifest so offboard knows what
# to undo. Tests focus on the changeset writer + reader plumbing — the full
# _init_apply flow has its own integration coverage.

load helpers
setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

@test "_onboard_changeset_begin: creates a fresh manifest with all sections empty" {
  _onboard_changeset_begin "$PWD"
  local path; path=$(_onboard_changeset_path "$PWD")
  [ -f "$path" ]
  grep -qE '^onboarded_at:' "$path"
  grep -qE '^scope_approved: \[\]$' "$path"
  grep -qE '^files_created: \[\]$' "$path"
  grep -qE '^dirs_created: \[\]$' "$path"
  grep -qE '^gitignore_entries_added: \[\]$' "$path"
  grep -qE '^launchd_plists_installed: \[\]$' "$path"
}

@test "_onboard_changeset_record: appends first entry by expanding the empty list" {
  _onboard_changeset_begin "$PWD"
  _onboard_changeset_record "$PWD" "files_created" ".roll/backlog.md"
  local path; path=$(_onboard_changeset_path "$PWD")
  grep -qE '^files_created:$' "$path"
  grep -qF '  - ".roll/backlog.md"' "$path"
  # The literal `[]` placeholder is gone
  ! grep -qE '^files_created: \[\]$' "$path"
}

@test "_onboard_changeset_record: appends multiple entries under the same section" {
  _onboard_changeset_begin "$PWD"
  _onboard_changeset_record "$PWD" "files_created" ".roll/backlog.md"
  _onboard_changeset_record "$PWD" "files_created" ".roll/features.md"
  local path; path=$(_onboard_changeset_path "$PWD")
  grep -qF '  - ".roll/backlog.md"' "$path"
  grep -qF '  - ".roll/features.md"' "$path"
}

@test "_onboard_changeset_record: records into different sections independently" {
  _onboard_changeset_begin "$PWD"
  _onboard_changeset_record "$PWD" "files_created" ".roll/backlog.md"
  _onboard_changeset_record "$PWD" "dirs_created" ".roll/features"
  _onboard_changeset_record "$PWD" "scope_approved" "backlog"
  _onboard_changeset_record "$PWD" "gitignore_entries_added" ".roll/"
  local path; path=$(_onboard_changeset_path "$PWD")
  grep -qF '  - ".roll/backlog.md"' "$path"
  grep -qF '  - ".roll/features"' "$path"
  grep -qF '  - "backlog"' "$path"
  grep -qF '  - ".roll/"' "$path"
}

@test "_onboard_changeset_begin: a second call overwrites prior contents" {
  _onboard_changeset_begin "$PWD"
  _onboard_changeset_record "$PWD" "files_created" "stale-entry"
  _onboard_changeset_begin "$PWD"
  local path; path=$(_onboard_changeset_path "$PWD")
  ! grep -q 'stale-entry' "$path"
  grep -qE '^files_created: \[\]$' "$path"
}

@test "_onboard_changeset_record: is a no-op when no changeset has been initialised" {
  # Without calling _begin first, the file does not exist.
  run _onboard_changeset_record "$PWD" "files_created" "should-not-create"
  [ "$status" -eq 0 ]
  local path; path=$(_onboard_changeset_path "$PWD")
  [ ! -f "$path" ]
}

@test "_onboard_changeset_path: returns the conventional .roll/ location" {
  local p; p=$(_onboard_changeset_path "/tmp/some-project")
  [ "$p" = "/tmp/some-project/.roll/onboard-changeset.yaml" ]
}
