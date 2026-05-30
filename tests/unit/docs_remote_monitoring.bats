#!/usr/bin/env bats
# US-OBS-015: verifies the Remote Monitoring user docs are present in both
# languages — the loop.md "Remote Monitoring" section, the README index entry,
# and the FAQ "watch loop from a phone" question — and that they cover the
# load-bearing facts (roll_meta_dir config, ≤35min freshness, manual push,
# remote-watch prompt, push-status.log troubleshooting).

load helpers

setup() { unit_setup; }
teardown() { unit_teardown; }

ROOT="${BATS_TEST_DIRNAME}/../.."
GUIDE_EN="${ROOT}/guide/en"
GUIDE_ZH="${ROOT}/guide/zh"

@test "loop en: has a Remote Monitoring section" {
  grep -q '^## Remote Monitoring' "${GUIDE_EN}/loop.md"
}

@test "loop zh: has a Remote Monitoring section" {
  grep -q '^## 远程监控' "${GUIDE_ZH}/loop.md"
}

@test "loop en: documents roll_meta_dir config in ~/.roll/config.yaml" {
  grep -q 'roll_meta_dir: ~/projects/roll-meta' "${GUIDE_EN}/loop.md"
  grep -q '~/.roll/config.yaml' "${GUIDE_EN}/loop.md"
}

@test "loop zh: documents roll_meta_dir config in ~/.roll/config.yaml" {
  grep -q 'roll_meta_dir: ~/projects/roll-meta' "${GUIDE_ZH}/loop.md"
  grep -q '~/.roll/config.yaml' "${GUIDE_ZH}/loop.md"
}

@test "loop en: explains the cycle-hook automatic push (≤35min fresh)" {
  grep -q 'cycle_end' "${GUIDE_EN}/loop.md"
  grep -q '35min' "${GUIDE_EN}/loop.md"
}

@test "loop zh: explains the cycle-hook automatic push (≤35min fresh)" {
  grep -q 'cycle_end' "${GUIDE_ZH}/loop.md"
  grep -q '35min' "${GUIDE_ZH}/loop.md"
}

@test "loop en: documents manual push via push-loop-status.sh" {
  grep -q 'push-loop-status.sh' "${GUIDE_EN}/loop.md"
}

@test "loop zh: documents manual push via push-loop-status.sh" {
  grep -q 'push-loop-status.sh' "${GUIDE_ZH}/loop.md"
}

@test "loop en: points users to the remote-watch prompt" {
  grep -q 'remote-watch.md' "${GUIDE_EN}/loop.md"
}

@test "loop zh: points users to the remote-watch prompt" {
  grep -q 'remote-watch.md' "${GUIDE_ZH}/loop.md"
}

@test "loop en: troubleshooting points at push-status.log" {
  grep -q 'push-status.log' "${GUIDE_EN}/loop.md"
}

@test "loop zh: troubleshooting points at push-status.log" {
  grep -q 'push-status.log' "${GUIDE_ZH}/loop.md"
}

@test "README index links the Remote Monitoring section (both languages)" {
  grep -q 'loop.md#remote-monitoring' "${ROOT}/README.md"
  grep -q 'remote-watch' "${ROOT}/README.md"
}

@test "faq en: has a watch-loop-from-phone entry pointing to remote-watch" {
  grep -q 'remote-watch.md' "${GUIDE_EN}/faq.md"
  grep -q 'remote-monitoring' "${GUIDE_EN}/faq.md"
}

@test "faq zh: has a watch-loop-from-phone entry pointing to remote-watch" {
  grep -q 'remote-watch.md' "${GUIDE_ZH}/faq.md"
  grep -q 'remote-monitoring' "${GUIDE_ZH}/faq.md"
}
