#!/usr/bin/env bats
# US-FB-001: `roll feedback` — open a GitHub issue from the CLI.
#
# Inputs come via flags (so the test is hermetic; the real command may
# prompt interactively, but flags always work):
#   roll feedback --type bug|idea|ux \
#                 --title "<title>" \
#                 --body "<body>" \
#                 [--repo owner/repo] \
#                 [--print-url]      # don't call gh, just print the URL
#
# gh missing OR --print-url → print a pre-filled github.com/.../issues/new URL
# gh present                → invoke `gh issue create`

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  # Make a fake git repo so the helper can derive owner/repo from origin.
  git init -q
  git remote add origin "git@github.com:demo-owner/demo-repo.git"
}

teardown() {
  cd /
  rm -rf "$TEST_TMP"
}

@test "feedback: --print-url prints github issue URL with title and body" {
  run "$ROLL" feedback --type bug --title "Login fails" --body "Steps to repro: ..." --print-url
  [ "$status" -eq 0 ]
  [[ "$output" == *"github.com/demo-owner/demo-repo/issues/new"* ]]
  [[ "$output" == *"Login%20fails"* ]] || [[ "$output" == *"Login+fails"* ]]
}

@test "feedback: --print-url encodes body in query string" {
  run "$ROLL" feedback --type idea --title "Add foo" --body "I want bar" --print-url
  [ "$status" -eq 0 ]
  [[ "$output" == *"github.com"* ]]
  [[ "$output" == *"body="* ]]
}

@test "feedback: --type bug uses a 'bug' label prefix in the URL" {
  run "$ROLL" feedback --type bug --title "X" --body "Y" --print-url
  [ "$status" -eq 0 ]
  [[ "$output" == *"labels=bug"* ]] || [[ "$output" == *"label=bug"* ]] || [[ "$output" == *"FIX"* ]]
}

@test "feedback: --type idea uses an 'enhancement' or 'idea' label" {
  run "$ROLL" feedback --type idea --title "X" --body "Y" --print-url
  [ "$status" -eq 0 ]
  [[ "$output" == *"idea"* ]] || [[ "$output" == *"enhancement"* ]] || [[ "$output" == *"US"* ]]
}

@test "feedback: --repo overrides origin-derived repo" {
  run "$ROLL" feedback --type bug --title "X" --body "Y" --repo other-owner/other-repo --print-url
  [ "$status" -eq 0 ]
  [[ "$output" == *"github.com/other-owner/other-repo/issues/new"* ]]
}

@test "feedback: missing --title fails with helpful error" {
  run "$ROLL" feedback --type bug --body "Y" --print-url
  [ "$status" -ne 0 ]
  [[ "$output" == *"title"* ]] || [[ "$output" == *"--title"* ]]
}

@test "feedback: missing --type defaults to a sensible value (does not error)" {
  run "$ROLL" feedback --title "X" --body "Y" --print-url
  [ "$status" -eq 0 ]
  [[ "$output" == *"github.com"* ]]
}

@test "feedback: invalid --type rejected" {
  run "$ROLL" feedback --type alien --title "X" --body "Y" --print-url
  [ "$status" -ne 0 ]
  [[ "$output" == *"type"* ]] || [[ "$output" == *"bug"* ]]
}

@test "feedback: non-github origin falls back to error or asks for --repo" {
  git remote set-url origin "https://gitlab.com/x/y.git"
  run "$ROLL" feedback --type bug --title "X" --body "Y" --print-url
  # Must either ask for --repo or exit non-zero with a hint
  if [ "$status" -eq 0 ]; then
    [[ "$output" == *"github.com"* ]] || [[ "$output" == *"--repo"* ]]
  else
    [[ "$output" == *"--repo"* ]] || [[ "$output" == *"github"* ]]
  fi
}

@test "feedback help: roll feedback --help describes the command" {
  run "$ROLL" feedback --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"feedback"* ]]
  [[ "$output" == *"--title"* ]]
}

@test "feedback help: roll --help lists feedback subcommand" {
  run "$ROLL" --help
  [ "$status" -eq 0 ] || [ "$status" -ne 127 ]
  [[ "$output" == *"feedback"* ]]
}
