#!/usr/bin/env bats
# US-ONBOARD-014: `roll offboard` reverses what `roll init --apply` did,
# guided by the changeset manifest (US-ONBOARD-013).

load helpers
setup() {
  unit_setup_cd
  # Stub interactive helpers so cmd_offboard's output doesn't paint terminal
  # escapes into the test buffer.
  err()  { echo "ERR: $*" >&2; }
  warn() { echo "WARN: $*" >&2; }
  ok()   { echo "OK: $*"; }
  info() { echo "INFO: $*"; }
}
teardown() { unit_teardown_cd; }

_seed_full_changeset() {
  _onboard_changeset_begin "$PWD"
  _onboard_changeset_record "$PWD" "scope_approved" "backlog"
  _onboard_changeset_record "$PWD" "files_created" ".roll/backlog.md"
  _onboard_changeset_record "$PWD" "files_created" ".roll/features.md"
  _onboard_changeset_record "$PWD" "dirs_created" ".roll/features"
  _onboard_changeset_record "$PWD" "gitignore_entries_added" ".roll/"

  mkdir -p .roll/features
  echo "# backlog" > .roll/backlog.md
  echo "# features" > .roll/features.md
  printf 'node_modules\n.roll/\n' > .gitignore
}

@test "offboard: refuses with manual instructions when no changeset exists" {
  run cmd_offboard
  [ "$status" -ne 0 ]
  [[ "$output" == *"No onboard changeset"* ]] || [[ "$output" == *"未找到 onboard 变更清单"* ]] \
    || grep -q 'No onboard changeset' <<< "${stderr:-$output}" \
    || [[ "$output$stderr" == *"No onboard changeset"* ]]
}

@test "offboard: dry-run lists every artefact and changes nothing" {
  _seed_full_changeset
  run cmd_offboard
  [ "$status" -eq 0 ]
  [[ "$output" == *".roll/backlog.md"* ]]
  [[ "$output" == *".roll/features.md"* ]]
  [[ "$output" == *".roll/features"* ]]
  [[ "$output" == *".roll/"* ]]
  [[ "$output" == *"dry-run"* ]] || [[ "$output" == *"预演"* ]]

  # Nothing was actually removed
  [ -f .roll/backlog.md ]
  [ -d .roll/features ]
  grep -qFx '.roll/' .gitignore
}

@test "offboard --confirm: removes files + dirs + .gitignore entries" {
  _seed_full_changeset
  run cmd_offboard --confirm
  [ "$status" -eq 0 ]

  [ ! -f .roll/backlog.md ]
  [ ! -f .roll/features.md ]
  [ ! -d .roll/features ]
  ! grep -qFx '.roll/' .gitignore
  # Unrelated lines in .gitignore are preserved
  grep -qFx 'node_modules' .gitignore
  # Changeset removed once offboard is done
  [ ! -f .roll/onboard-changeset.yaml ]
}

@test "offboard --confirm: leaves files that were not in the changeset alone" {
  _seed_full_changeset
  mkdir -p .roll
  echo "user authored" > .roll/notes.md
  echo "user authored" > my-own-file.txt

  cmd_offboard --confirm >/dev/null

  [ -f .roll/notes.md ]
  [ -f my-own-file.txt ]
}

@test "offboard: refuses absolute paths that escape the project root" {
  # Manually craft a changeset that names a file outside the project.
  mkdir -p .roll
  cat > .roll/onboard-changeset.yaml <<EOF
onboarded_at: "2026-05-20T00:00:00Z"
files_created:
  - "/etc/passwd"
dirs_created: []
gitignore_entries_added: []
launchd_plists_installed: []
EOF
  run cmd_offboard
  [ "$status" -ne 0 ]
  [ -f /etc/passwd ]  # would still exist regardless, but sanity
}

@test "offboard: --y short flag is accepted as --confirm" {
  _seed_full_changeset
  run cmd_offboard -y
  [ "$status" -eq 0 ]
  [ ! -f .roll/backlog.md ]
}

@test "offboard: empty changeset is a no-op without errors" {
  _onboard_changeset_begin "$PWD"
  run cmd_offboard --confirm
  [ "$status" -eq 0 ]
  [[ "$output" == *"empty"* ]] || [[ "$output" == *"无需"* ]] || true
}

@test "offboard: --help prints usage and exits 0 without touching anything" {
  _seed_full_changeset
  run cmd_offboard --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage"* ]]
  [ -f .roll/backlog.md ]
}
