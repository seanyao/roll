#!/usr/bin/env bats
# Tests for US-DOC-002: guide/zh/ Chinese user guides

GUIDE_DIR="${BATS_TEST_DIRNAME}/../../guide/zh"

@test "zh overview.md covers three-layer autonomous model" {
  grep -qiE "三层|自主|loop.*dream.*peer|human.*loop" "${GUIDE_DIR}/overview.md"
}

@test "zh loop.md documents roll loop on/off" {
  grep -qF 'roll loop on' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop off' "${GUIDE_DIR}/loop.md"
}

@test "zh loop.md documents all key subcommands" {
  grep -qF 'roll loop now' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop status' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop attach' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop mute' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop pause' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop runs' "${GUIDE_DIR}/loop.md"
}

@test "zh dream.md explains nightly scan" {
  grep -qiE "夜间|每晚|3点|定时|3am|nightly" "${GUIDE_DIR}/dream.md"
}

@test "zh dream.md mentions REFACTOR generation" {
  grep -qiE "REFACTOR|重构" "${GUIDE_DIR}/dream.md"
}

@test "zh peer.md documents AGREE/REFINE/OBJECT/ESCALATE states" {
  grep -qF 'AGREE' "${GUIDE_DIR}/peer.md"
  grep -qF 'REFINE' "${GUIDE_DIR}/peer.md"
  grep -qF 'OBJECT' "${GUIDE_DIR}/peer.md"
  grep -qF 'ESCALATE' "${GUIDE_DIR}/peer.md"
}

@test "zh peer.md documents roll peer command" {
  grep -qF 'roll peer' "${GUIDE_DIR}/peer.md"
}

# ─── E2E golden path ──────────────────────────────────────────────────────────

@test "e2e: zh overview.md links to loop.md, dream.md, peer.md" {
  grep -qF 'loop.md' "${GUIDE_DIR}/overview.md"
  grep -qF 'dream.md' "${GUIDE_DIR}/overview.md"
  grep -qF 'peer.md' "${GUIDE_DIR}/overview.md"
}

@test "e2e: zh loop.md consistent with en on tmux" {
  grep -qiF 'tmux' "${GUIDE_DIR}/loop.md"
}

@test "e2e: zh peer.md covers mute mechanism" {
  grep -qiE 'mute|静音' "${GUIDE_DIR}/peer.md"
}

# ─── REFACTOR-045: zh practices/engineering-common-sense.md ──────────────────────

@test "zh practices/engineering-common-sense.md exists" {
  [ -f "${GUIDE_DIR}/practices/engineering-common-sense.md" ]
}

@test "zh engineering-common-sense.md has Chinese title and baseline framing" {
  DOC="${GUIDE_DIR}/practices/engineering-common-sense.md"
  grep -qF '# Roll 工程常识清单' "${DOC}"
  grep -qF '它们是基线要求' "${DOC}"
}

@test "zh engineering-common-sense.md covers all 11 numbered principles in Chinese" {
  DOC="${GUIDE_DIR}/practices/engineering-common-sense.md"
  grep -qF '## 1. 幂等性' "${DOC}"
  grep -qF '## 2. 跨模块契约一致性' "${DOC}"
  grep -qF '## 3. 数据流完整性' "${DOC}"
  grep -qF '## 4. 原子性' "${DOC}"
  grep -qF '## 5. 输入校验' "${DOC}"
  grep -qF '## 6. 优雅降级' "${DOC}"
  grep -qF '## 7. 可观测性' "${DOC}"
  grep -qF '## 8. 并发安全' "${DOC}"
  grep -qF '## 9. Shell 脚本性能' "${DOC}"
  grep -qF '## 10. Shell 资源清理' "${DOC}"
  grep -qF '## 11. 测试可靠性' "${DOC}"
}

@test "zh engineering-common-sense.md keeps the mandatory checklist process" {
  DOC="${GUIDE_DIR}/practices/engineering-common-sense.md"
  grep -qF '强制检查流程' "${DOC}"
  grep -qF '工程常识检查清单' "${DOC}"
}
