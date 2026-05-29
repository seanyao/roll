#!/usr/bin/env bats
# Tests for roll-doc SKILL.md Phase 3b Deep Read rules (US-DOC-012)

SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-doc/SKILL.md"

@test "roll-doc SKILL.md: documents Phase 3b — Deep Read section" {
  [ -f "$SKILL" ]
  grep -qF 'Phase 3b' "$SKILL"
  grep -qiE 'Deep Read|深度读取' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 1 specifies non-truncated full-file reading" {
  grep -qiE '(no truncat|不截断|read.*full|全量读)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 1 defines symbol table fields — exports" {
  grep -qiE 'exports|exported' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 1 defines symbol table fields — imports" {
  grep -qiE 'imports.*source.*target|import.*source.*target' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 1 defines symbol table fields — enums" {
  grep -qiE 'enums' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 1 defines symbol table fields — external_urls" {
  grep -qiE 'external.url' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 1 defines symbol table fields — configs" {
  grep -qiE 'configs' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 1 lists exclusion directories" {
  grep -qF 'node_modules' "$SKILL"
  grep -qF '.git' "$SKILL"
  grep -qF 'dist' "$SKILL"
  grep -qF 'build' "$SKILL"
  grep -qF '.shared' "$SKILL"
  grep -qF '.roll/dream' "$SKILL"
  grep -qF '.roll/briefs' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b documents trigger conditions" {
  grep -qiE 'Trigger conditions' "$SKILL"
  grep -qiE '(Phase 2 found.*gap|code characteristic|cannot capture)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b documents --dry-run summary behavior" {
  grep -qiE 'dry.run.*(symbol|摘要|summary|print.*count)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b documents --force unchanged behavior" {
  grep -qiE 'force.*(unchanged|不变|still|only.*draft)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 2 lists data-flow topic" {
  grep -qiE '(data.flow|数据流|调用链)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 2 lists state-machine topic" {
  grep -qiE '(state.machine|状态机)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 2 lists external-integration topic" {
  grep -qiE '(integration|外部集成)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 2 lists deployment-pipeline topic" {
  grep -qiE '(deployment|部署管线)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 2 lists AGENTS.md auto-gen topic" {
  grep -qiE 'AGENTS\.md.*(auto|自动|生成|generat)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 2 lists high-fanin README topic" {
  grep -qiE '(high.fan.?in|高引用|high.*ref|被.*引用)' "$SKILL"
}
