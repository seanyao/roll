#!/usr/bin/env bats
# US-LOOP-022: verifies the Phase 2.0 loop-data-layout docs are present and
# describe the NEW project-local layout (not the pre-2.0 ~/.shared/roll/loop/
# layout) in both English and Chinese.

load helpers

setup() { unit_setup; }
teardown() { unit_teardown; }

ROOT="${BATS_TEST_DIRNAME}/../.."
GUIDE_EN="${ROOT}/guide/en"
GUIDE_ZH="${ROOT}/guide/zh"

@test "loop-data-layout guide exists in both languages" {
  [ -f "${GUIDE_EN}/loop-data-layout.md" ]
  [ -f "${GUIDE_ZH}/loop-data-layout.md" ]
}

@test "guide en: data-layout describes project-local .roll/loop/ home" {
  grep -q '<project>/.roll/loop/' "${GUIDE_EN}/loop-data-layout.md"
}

@test "guide en: data-layout documents roll loop gc with retention + dry-run" {
  grep -q 'roll loop gc' "${GUIDE_EN}/loop-data-layout.md"
  grep -q -- '--dry-run' "${GUIDE_EN}/loop-data-layout.md"
  grep -q 'ROLL_LOOP_GC_RETENTION_DAYS' "${GUIDE_EN}/loop-data-layout.md"
}

@test "guide en: data-layout explains automatic 7-day migration window" {
  grep -q '_loop_migrate_legacy_paths' "${GUIDE_EN}/loop-data-layout.md"
  grep -q '7-day' "${GUIDE_EN}/loop-data-layout.md"
}

@test "guide zh: data-layout describes project-local + gc + migration" {
  grep -q '<project>/.roll/loop/' "${GUIDE_ZH}/loop-data-layout.md"
  grep -q 'roll loop gc' "${GUIDE_ZH}/loop-data-layout.md"
  grep -q '_loop_migrate_legacy_paths' "${GUIDE_ZH}/loop-data-layout.md"
}

# AC: no doc page may still describe the pre-2.0 layout. The loop.md State Files
# table used to point state/ALERT/runs at ~/.shared/roll/loop/ — assert those
# stale rows are gone and replaced by project-local paths.
@test "guide en: loop.md State Files no longer points state/runs/ALERT at ~/.shared" {
  run grep -nE '~/\.shared/roll/loop/(state\.yaml|runs\.jsonl|ALERT\.md|PAUSE)' "${GUIDE_EN}/loop.md"
  [ "$status" -ne 0 ]
}

@test "guide zh: loop.md State Files no longer points state/runs/ALERT at ~/.shared" {
  run grep -nE '~/\.shared/roll/loop/(state\.yaml|runs\.jsonl|ALERT\.md|PAUSE)' "${GUIDE_ZH}/loop.md"
  [ "$status" -ne 0 ]
}

@test "guide en: loop.md State Files now lists project-local state" {
  grep -q '<project>/.roll/loop/state-<slug>.yaml' "${GUIDE_EN}/loop.md"
}

@test "guide zh: loop.md State Files now lists project-local state" {
  grep -q '<project>/.roll/loop/state-<slug>.yaml' "${GUIDE_ZH}/loop.md"
}

@test "README index links the new data-layout guide (both languages)" {
  grep -q 'guide/en/loop-data-layout.md' "${ROOT}/README.md"
  grep -q 'guide/zh/loop-data-layout.md' "${ROOT}/README.md"
}

@test "faq en: has a Phase 2.0 migration troubleshooting entry" {
  grep -q 'ALERT-<slug>.md' "${GUIDE_EN}/faq.md"
  grep -q 'migrated-' "${GUIDE_EN}/faq.md"
}

@test "faq zh: has a Phase 2.0 migration troubleshooting entry" {
  grep -q 'ALERT-<slug>.md' "${GUIDE_ZH}/faq.md"
  grep -q 'migrated-' "${GUIDE_ZH}/faq.md"
}
