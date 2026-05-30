#!/usr/bin/env bats
# US-SKILL-017: the skill selection guide documents the skill registration flow
# (scan auto-generates guide/skills.md; never hand-edit) and the allowed-tools
# tool-scope declaration convention, in both languages. Uses literal substring
# checks only (no Unicode regex, which is unreliable across CI runners).

ROOT="${BATS_TEST_DIRNAME}/../.."
EN="${ROOT}/guide/en/skills.md"
ZH="${ROOT}/guide/zh/skills.md"
README="${ROOT}/README.md"

# ─── Files exist ─────────────────────────────────────────────────────────────

@test "guide en: skills.md exists" {
  [ -f "${EN}" ]
}

@test "guide zh: skills.md exists" {
  [ -f "${ZH}" ]
}

# ─── English: registration flow ──────────────────────────────────────────────

@test "skills.md (en) has an Adding a New Skill section" {
  grep -qF "## Adding a New Skill" "${EN}"
}

@test "skills.md (en) documents roll skills generate" {
  grep -qF "roll skills generate" "${EN}"
}

@test "skills.md (en) documents the drift guard via roll skills check" {
  grep -qF "roll skills check" "${EN}"
}

@test "skills.md (en) says guide/skills.md is a generated artifact, not hand-edited" {
  grep -qF "generated artifact" "${EN}"
  grep -qF "do not edit by hand" "${EN}"
  grep -qF "by hand" "${EN}"
}

# ─── English: allowed-tools tool-scope declaration ───────────────────────────

@test "skills.md (en) has a tool-scope section for allowed-tools" {
  grep -qF "## Declaring Tool Scope (" "${EN}"
  grep -qF "allowed-tools" "${EN}"
}

@test "skills.md (en) frames allowed-tools as declaration + lint, enforcement in the harness" {
  grep -qF "declaration + lint" "${EN}"
  grep -qF "inner agent harness" "${EN}"
}

# ─── Chinese: registration flow ──────────────────────────────────────────────

@test "skills.md (zh) has a 新增 skill section" {
  grep -qF "## 新增 skill" "${ZH}"
}

@test "skills.md (zh) documents roll skills generate" {
  grep -qF "roll skills generate" "${ZH}"
}

@test "skills.md (zh) documents the drift guard via roll skills check" {
  grep -qF "roll skills check" "${ZH}"
}

@test "skills.md (zh) says guide/skills.md is a generated artifact, not hand-edited" {
  grep -qF "生成产物" "${ZH}"
  grep -qF "切勿手工编辑" "${ZH}"
}

# ─── Chinese: allowed-tools tool-scope declaration ───────────────────────────

@test "skills.md (zh) has a tool-scope section for allowed-tools" {
  grep -qF "## 声明工具范围（" "${ZH}"
  grep -qF "allowed-tools" "${ZH}"
}

@test "skills.md (zh) frames allowed-tools as declaration + lint, enforcement in the harness" {
  grep -qF "声明 + lint" "${ZH}"
  grep -qF "内层 agent harness" "${ZH}"
}

# ─── README index links the skills guide ─────────────────────────────────────

@test "README links the skill selection guide in both languages" {
  grep -qF "guide/en/skills.md" "${README}"
  grep -qF "guide/zh/skills.md" "${README}"
}
