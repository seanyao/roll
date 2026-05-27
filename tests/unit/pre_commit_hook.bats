#!/usr/bin/env bats
# pre-commit TCR gate: docs-only commits are exempt from the test-proof check;
# any code/contract file re-arms the full gate.
# bats tier: fast

load helpers

HOOK_DIR="${BATS_TEST_DIRNAME}/../../hooks"

setup() {
  unit_setup
  cd "$TEST_TMP"
  git init -q
  git config user.email t@example.com
  git config user.name t
  git config core.hooksPath "$HOOK_DIR"
  # Seed one commit so HEAD exists (hook runs on every subsequent commit).
  # Use --no-verify so seeding doesn't itself need a proof.
  echo "seed" > seed.txt
  git add seed.txt
  git commit -q --no-verify -m "seed"
  # No .roll/last-test-pass on purpose — these tests assert the gate's behavior
  # in the absence of a fresh proof.
}
teardown() { unit_teardown; }

@test "docs-only: root CHANGELOG.md commits without a test proof" {
  echo "## Unreleased" > CHANGELOG.md
  git add CHANGELOG.md
  run git commit -m "docs: changelog"
  [ "$status" -eq 0 ]
}

@test "docs-only: README.md + docs/ + guide/ all exempt together" {
  mkdir -p docs guide/en
  echo a > README.md
  echo b > docs/x.md
  echo c > guide/en/loop.md
  git add README.md docs/x.md guide/en/loop.md
  run git commit -m "docs: narrative update"
  [ "$status" -eq 0 ]
}

@test "code file with no proof is blocked" {
  echo "print(1)" > foo.py
  git add foo.py
  run git commit -m "feat: code"
  [ "$status" -ne 0 ]
  [[ "$output" == *"tests not verified"* ]]
}

@test "mixed docs + code re-arms the full gate (no smuggling)" {
  echo "## Unreleased" > CHANGELOG.md
  echo "print(1)" > foo.py
  git add CHANGELOG.md foo.py
  run git commit -m "mix"
  [ "$status" -ne 0 ]
  [[ "$output" == *"tests not verified"* ]]
}

@test "skills SKILL.md is a contract, NOT exempt" {
  mkdir -p skills/roll-x
  echo "# skill" > skills/roll-x/SKILL.md
  git add skills/roll-x/SKILL.md
  run git commit -m "docs: skill"
  [ "$status" -ne 0 ]
  [[ "$output" == *"tests not verified"* ]]
}

@test "nested non-doc path (lib/) is NOT exempt even if .md" {
  mkdir -p lib
  echo "# notes" > lib/NOTES.md
  git add lib/NOTES.md
  run git commit -m "docs: lib notes"
  [ "$status" -ne 0 ]
  [[ "$output" == *"tests not verified"* ]]
}

@test "fresh proof + matching tree lets a code commit through" {
  echo "print(1)" > foo.py
  git add foo.py
  mkdir -p .roll
  TREE=$(git write-tree)
  NOW=$(date +%s)
  printf '{"ts":%s,"tree":"%s"}\n' "$NOW" "$TREE" > .roll/last-test-pass
  run git commit -m "feat: code with proof"
  [ "$status" -eq 0 ]
}
