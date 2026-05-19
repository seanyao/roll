#!/usr/bin/env bats
# US-ONBOARD-012: `roll init` recognises projects on non-canonical layouts as
# legacy. Previously only `src/app/lib/pkg/cmd` with ≥10 files counted —
# WeChat mini-program / Python flat / Terraform / older Java repos slipped
# through silently. Now any manifest at the root or any commit in HEAD
# triggers the legacy flow.

load helpers
setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# --- classic-layout still works (regression guard) ---

@test "_init_is_legacy_project: classic src/ with ≥10 files is detected" {
  mkdir -p src
  for i in $(seq 1 10); do echo "x" > "src/f$i.txt"; done
  run _init_is_legacy_project "$PWD"
  [ "$status" -eq 0 ]
}

@test "_init_is_legacy_project: classic src/ with <10 files alone is not enough" {
  mkdir -p src
  for i in $(seq 1 3); do echo "x" > "src/f$i.txt"; done
  run _init_is_legacy_project "$PWD"
  [ "$status" -ne 0 ]
}

# --- new manifest signals ---

@test "_init_is_legacy_project: Python flat with requirements.txt is detected" {
  echo "requests==2.0" > requirements.txt
  run _init_is_legacy_project "$PWD"
  [ "$status" -eq 0 ]
}

@test "_init_is_legacy_project: Python flat with setup.py is detected" {
  echo "from setuptools import setup" > setup.py
  run _init_is_legacy_project "$PWD"
  [ "$status" -eq 0 ]
}

@test "_init_is_legacy_project: package.json (Node) is detected" {
  echo '{"name":"x"}' > package.json
  run _init_is_legacy_project "$PWD"
  [ "$status" -eq 0 ]
}

@test "_init_is_legacy_project: go.mod (Go) is detected" {
  echo 'module x' > go.mod
  run _init_is_legacy_project "$PWD"
  [ "$status" -eq 0 ]
}

@test "_init_is_legacy_project: Terraform .tf files are detected" {
  echo 'resource "null_resource" "x" {}' > main.tf
  run _init_is_legacy_project "$PWD"
  [ "$status" -eq 0 ]
}

@test "_init_is_legacy_project: WeChat mini-program (app.json) is detected" {
  echo '{"pages":[]}' > app.json
  run _init_is_legacy_project "$PWD"
  [ "$status" -eq 0 ]
}

@test "_init_is_legacy_project: Dockerfile alone is detected" {
  echo 'FROM alpine' > Dockerfile
  run _init_is_legacy_project "$PWD"
  [ "$status" -eq 0 ]
}

# --- git history signal ---

@test "_init_is_legacy_project: git history alone is detected" {
  git init -q
  git config user.email t@t
  git config user.name t
  git config commit.gpgsign false
  git commit --allow-empty -q -m "init"
  run _init_is_legacy_project "$PWD"
  [ "$status" -eq 0 ]
}

@test "_init_is_legacy_project: .git without any commit yet is not enough on its own" {
  git init -q
  # No commits made
  run _init_is_legacy_project "$PWD"
  [ "$status" -ne 0 ]
}

# --- truly empty project ---

@test "_init_is_legacy_project: empty directory is not legacy" {
  run _init_is_legacy_project "$PWD"
  [ "$status" -ne 0 ]
}

# --- summary surfaces the right signal ---

@test "_init_legacy_file_summary: surfaces manifest name when only signal" {
  echo '{"name":"x"}' > package.json
  run _init_legacy_file_summary "$PWD"
  [[ "$output" == *"manifest: package.json"* ]]
}

@test "_init_legacy_file_summary: surfaces Terraform when only signal" {
  echo 'resource "null_resource" "x" {}' > main.tf
  run _init_legacy_file_summary "$PWD"
  [[ "$output" == *"Terraform"* ]]
}

@test "_init_legacy_file_summary: surfaces git history when only signal" {
  git init -q
  git config user.email t@t
  git config user.name t
  git config commit.gpgsign false
  git commit --allow-empty -q -m "init"
  run _init_legacy_file_summary "$PWD"
  [[ "$output" == *"git history"* ]]
}
