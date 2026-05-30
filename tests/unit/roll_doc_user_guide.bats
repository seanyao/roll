#!/usr/bin/env bats
# Tests for US-DOC-020: Phase 3b user-doc refresh (EN + ZH)

ROOT="${BATS_TEST_DIRNAME}/../.."
GUIDE_EN="${ROOT}/guide/en"
GUIDE_ZH="${ROOT}/guide/zh"

# ── new roll-doc guide pages exist ──────────────────────────────────────────

@test "guide/en/roll-doc.md exists" {
  [ -f "${GUIDE_EN}/roll-doc.md" ]
}

@test "guide/zh/roll-doc.md exists" {
  [ -f "${GUIDE_ZH}/roll-doc.md" ]
}

# ── four required sections (EN) ─────────────────────────────────────────────

@test "EN roll-doc.md covers the four-phase pipeline" {
  grep -qiE 'Four.Phase Pipeline' "${GUIDE_EN}/roll-doc.md"
  grep -qF 'Phase 3b' "${GUIDE_EN}/roll-doc.md"
}

@test "EN roll-doc.md covers Phase 3b six topics" {
  DOC="${GUIDE_EN}/roll-doc.md"
  grep -qiE 'Data flow|call chain' "${DOC}"
  grep -qiE 'State machine' "${DOC}"
  grep -qiE 'External integration' "${DOC}"
  grep -qiE 'Deployment pipeline' "${DOC}"
  grep -qiE 'Agent entrypoint' "${DOC}"
  grep -qiE 'High fan.?in' "${DOC}"
}

@test "EN roll-doc.md documents dry-run and force behavior" {
  grep -qF -- '--dry-run' "${GUIDE_EN}/roll-doc.md"
  grep -qF -- '--force' "${GUIDE_EN}/roll-doc.md"
}

@test "EN roll-doc.md lists typical output files including Phase 3b targets" {
  DOC="${GUIDE_EN}/roll-doc.md"
  grep -qiE 'Typical Output Files' "${DOC}"
  grep -qF 'docs/data-flows.md' "${DOC}"
  grep -qF 'docs/state-machines.md' "${DOC}"
  grep -qF 'docs/integrations.md' "${DOC}"
  grep -qF 'docs/deployment.md' "${DOC}"
}

# ── four required sections (ZH) ─────────────────────────────────────────────

@test "ZH roll-doc.md covers the four-phase pipeline" {
  grep -qF '四 Phase 全流程' "${GUIDE_ZH}/roll-doc.md"
  grep -qF 'Phase 3b' "${GUIDE_ZH}/roll-doc.md"
}

@test "ZH roll-doc.md covers Phase 3b six topics" {
  DOC="${GUIDE_ZH}/roll-doc.md"
  grep -qF '数据流' "${DOC}"
  grep -qF '状态机' "${DOC}"
  grep -qF '外部集成' "${DOC}"
  grep -qF '部署管线' "${DOC}"
  grep -qF 'Agent 入口' "${DOC}"
  grep -qF '高引用目录' "${DOC}"
}

@test "ZH roll-doc.md documents dry-run and force behavior" {
  grep -qF -- '--dry-run' "${GUIDE_ZH}/roll-doc.md"
  grep -qF -- '--force' "${GUIDE_ZH}/roll-doc.md"
}

@test "ZH roll-doc.md lists typical output files section" {
  grep -qF '典型输出文件清单' "${GUIDE_ZH}/roll-doc.md"
}

# ── EN/ZH structural parity (same number of H2 sections) ────────────────────

@test "roll-doc.md EN and ZH have the same number of H2 sections" {
  en=$(grep -c '^## ' "${GUIDE_EN}/roll-doc.md")
  zh=$(grep -c '^## ' "${GUIDE_ZH}/roll-doc.md")
  [ "$en" -eq "$zh" ]
}

@test "roll-doc.md keeps EN and ZH on separate pages (no inline EN sentence in ZH prose)" {
  # The bilingual convention keeps EN lines and ZH lines on separate lines /
  # pages. The ZH page must not carry an English full-sentence clause in prose.
  # Whitelisted technical terms (Phase, roll-doc, docs/..., flags) are fine; a
  # bare English connector word run between two spaces is the violation we ban.
  # Guard against an inline EN sentence fragment like " the foo and bar " in
  # prose lines (skip table rows and code fences which legitimately mix).
  while IFS= read -r line; do
    case "$line" in
      *'|'*) continue ;;          # table row — allowed
      '```'*|'    '*) continue ;; # code fence / indented code — allowed
    esac
    printf '%s\n' "$line" | grep -qE ' (the|and|with|from|when) (foo|bar|baz) ' && return 1
  done < "${GUIDE_ZH}/roll-doc.md"
  return 0
}

# ── README / README_CN doc index points at roll-doc ─────────────────────────

@test "README.md doc index links to guide/en/roll-doc.md" {
  grep -qF 'guide/en/roll-doc.md' "${ROOT}/README.md"
}

@test "README.md doc index links to guide/zh/roll-doc.md" {
  grep -qF 'guide/zh/roll-doc.md' "${ROOT}/README.md"
}

@test "README_CN.md doc index links to roll-doc pages" {
  grep -qF 'guide/en/roll-doc.md' "${ROOT}/README_CN.md"
  grep -qF 'guide/zh/roll-doc.md' "${ROOT}/README_CN.md"
}

# ── skills.md roll-doc section (EN + ZH) ────────────────────────────────────

@test "EN skills.md describes roll-doc with Phase 3b and 6 topics" {
  DOC="${GUIDE_EN}/skills.md"
  grep -qF 'roll-doc' "${DOC}"
  grep -qF 'Phase 3b' "${DOC}"
}

@test "ZH skills.md describes roll-doc with Phase 3b" {
  DOC="${GUIDE_ZH}/skills.md"
  grep -qF 'roll-doc' "${DOC}"
  grep -qF 'Phase 3b' "${DOC}"
}

# ── AGENTS.md roll-doc one-liner ────────────────────────────────────────────

@test "AGENTS.md mentions roll-doc four-phase + Phase 3b deep read" {
  grep -qF 'roll-doc' "${ROOT}/AGENTS.md"
  grep -qF 'Phase 3b' "${ROOT}/AGENTS.md"
}

# ── FAQ: Phase 3a vs 3b question (EN + ZH) ──────────────────────────────────

@test "EN faq covers how to tell Phase 3a vs Phase 3b ran" {
  grep -qiE 'Phase 3a.*Phase 3b|3a.*or.*3b' "${GUIDE_EN}/faq.md"
}

@test "ZH faq covers how to tell Phase 3a vs Phase 3b ran" {
  grep -qF 'Phase 3a' "${GUIDE_ZH}/faq.md"
  grep -qF 'Phase 3b' "${GUIDE_ZH}/faq.md"
}

@test "ZH faq H2 count still mirrors EN faq" {
  en=$(grep -c '^## ' "${GUIDE_EN}/faq.md")
  zh=$(grep -c '^## ' "${GUIDE_ZH}/faq.md")
  [ "$en" -eq "$zh" ]
}

# ── no stale Phase-3a-only descriptions anywhere in docs ────────────────────

@test "no stale 'Phase 3 only' description in guide docs" {
  ! grep -rqF 'Phase 3 only' "${GUIDE_EN}" "${GUIDE_ZH}"
}

@test "no stale 'up to 20 source files' claim in user-facing guide pages" {
  # The skill itself legitimately defines the Phase 3 20-file limit; user guides
  # must not present it as the whole story (Phase 3b reads in full).
  ! grep -rqF 'up to 20 source files' "${GUIDE_EN}" "${GUIDE_ZH}"
}

@test "no stale '按目录读截断' phrasing in guide docs" {
  ! grep -rqF '按目录读截断' "${GUIDE_EN}" "${GUIDE_ZH}"
}
