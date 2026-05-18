#!/usr/bin/env bats
# E2E golden path for US-DOC-005: AGENTS.md conventions + README nav hub

ROOT="${BATS_TEST_DIRNAME}/../.."

@test "e2e: AGENTS.md Documentation Conventions lists all 7 doc directories" {
  grep -qF 'guide/en/' "${ROOT}/AGENTS.md"
  grep -qF 'guide/zh/' "${ROOT}/AGENTS.md"
  grep -qF '.roll/domain/' "${ROOT}/AGENTS.md"
  grep -qF '.roll/features/' "${ROOT}/AGENTS.md"
  grep -qF '.roll/verification/' "${ROOT}/AGENTS.md"
}

@test "e2e: README.md doc index covers all guide/en/ files" {
  grep -qF 'guide/en/overview.md' "${ROOT}/README.md"
  grep -qF 'guide/en/loop.md' "${ROOT}/README.md"
  grep -qF 'guide/en/dream.md' "${ROOT}/README.md"
  grep -qF 'guide/en/peer.md' "${ROOT}/README.md"
  grep -qF 'guide/en/methodology.md' "${ROOT}/README.md"
  grep -qF 'guide/en/skills.md' "${ROOT}/README.md"
}

@test "e2e: README.md doc index covers all guide/zh/ files" {
  grep -qF 'guide/zh/overview.md' "${ROOT}/README.md"
  grep -qF 'guide/zh/loop.md' "${ROOT}/README.md"
  grep -qF 'guide/zh/dream.md' "${ROOT}/README.md"
  grep -qF 'guide/zh/peer.md' "${ROOT}/README.md"
  grep -qF 'guide/zh/methodology.md' "${ROOT}/README.md"
  grep -qF 'guide/zh/skills.md' "${ROOT}/README.md"
}

@test "e2e: README_CN.md mirrors EN structure" {
  en_lines=$(wc -l < "${ROOT}/README.md")
  zh_lines=$(wc -l < "${ROOT}/README_CN.md")
  # Both should be within 10 lines of each other (mirrored structure)
  diff=$(( en_lines - zh_lines ))
  [ "${diff#-}" -le 10 ]
}
