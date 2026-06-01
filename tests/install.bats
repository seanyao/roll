#!/usr/bin/env bats

setup() {
  true
}

@test "install: script exists" {
  [[ -f "${BATS_TEST_DIRNAME}/../install" ]]
}
