# Feature: wukong → roll 品牌重命名 + 技能重構

> Design: [rename-roll-plan.md](rename-roll-plan.md)

---

<a id="us-roll-001"></a>
## US-ROLL-001 重命名 CLI 二進制 + 所有內部 wukong 路徑 📋

**Created**: 2026-04-16  
**Plan**: [rename-roll-plan.md](rename-roll-plan.md)

- As a user of this tool
- I want the CLI binary named `roll` and all internal paths using `~/.roll/`
- So that the name consistently reflects the "roll out features" mental model

**AC:**
- [ ] `bin/wukong` → `bin/roll`（可執行，`roll --version` 輸出 `roll vX.X.X`）
- [ ] `WK_HOME` → `ROLL_HOME`，`WK_CONFIG` → `ROLL_CONFIG` 等所有環境變量
- [ ] 默認主目錄 `~/.wukong/` → `~/.roll/`
- [ ] `package.json` name 改為 `"roll"`，bin 入口更新
- [ ] `wukong hooks` → `roll hook`（單數）
- [ ] 所有測試 fixture 和集成測試路徑從 `.wukong` 更新為 `.roll`
- [ ] `npm test` 75/75 通過

**Files:**
- `bin/wukong` → `bin/roll`（重命名 + 內部替換）
- `package.json`
- `tests/integration/helpers.bash`
- `tests/integration/cmd_setup.bats`
- `tests/integration/cmd_sync.bats`
- `tests/integration/cmd_init.bats`
- `tests/integration/cmd_status.bats`

**Dependencies:**
- Depends on: —
- Depended on by: US-ROLL-002, US-ROLL-003, US-ROLL-004, US-ROLL-005, US-ROLL-006

---

<a id="us-roll-002"></a>
## US-ROLL-002 重命名所有 wk-* 技能 → roll-* + 刪除 wk-.yeah 📋

**Created**: 2026-04-16  
**Plan**: [rename-roll-plan.md](rename-roll-plan.md)

- As a user invoking skills
- I want all skills prefixed with `roll-` matching the new brand
- So that skill names are consistent with the CLI name

**AC:**
- [ ] `skills/` 目錄下所有 `wk-*` 目錄改名為 `roll-*`
- [ ] 每個 SKILL.md 內的 `$wk-` 引用全部替換為 `$roll-`
- [ ] `wk-.yeah` 目錄刪除（慶祝邏輯後續內嵌到 roll-build）
- [ ] `wk-init` 目錄刪除（折入 CLI，見 US-ROLL-006）
- [ ] `.claude/CLAUDE.md`、`.claude/wk.md`、`conventions/` 下所有 `$wk-` 引用更新
- [ ] `AGENTS.md` Skill Selection 快速參考更新為 `$roll-*`
- [ ] `npm test` 75/75 通過

**Files:**
- `skills/wk-*` → `skills/roll-*`（14 個目錄重命名）
- `skills/roll-*/SKILL.md`（所有 $wk- → $roll- 替換）
- `conventions/global/AGENTS.md`
- `conventions/global/CLAUDE.md`
- `conventions/templates/*/AGENTS.md`
- `.claude/CLAUDE.md`

**Dependencies:**
- Depends on: US-ROLL-001
- Depended on by: US-ROLL-005

---

<a id="us-roll-003"></a>
## US-ROLL-003 更新 README + 文檔 + migration script 📋

**Created**: 2026-04-16  
**Plan**: [rename-roll-plan.md](rename-roll-plan.md)

- As an existing wukong user or new user
- I want documentation and migration tooling to reflect the new name
- So that onboarding and upgrading are frictionless

**AC:**
- [ ] `README.md` 全面更新：名稱、安裝命令、使用示例
- [ ] `docs/methodology*.md` 中的 wukong/wk- 引用更新
- [ ] `scripts/migrate-to-roll.sh` 腳本：自動把 `~/.wukong/` 遷移到 `~/.roll/`，更新 `.claude/CLAUDE.md` 等引用
- [ ] `install.sh` 更新（如有 wukong 引用）
- [ ] `npm test` 75/75 通過

**Files:**
- `README.md`
- `scripts/migrate-to-roll.sh`（新建）
- `docs/methodology.md`
- `docs/methodology-en.md`
- `install.sh`

**Dependencies:**
- Depends on: US-ROLL-001
- Depended on by: —

---

<a id="us-roll-004"></a>
## US-ROLL-004 合并 wk-bb-debug + wk-bb-analyzer → roll-debug 📋

**Created**: 2026-04-16  
**Plan**: [rename-roll-plan.md](rename-roll-plan.md)

- As a developer debugging a production issue
- I want a single `roll-debug` skill that both collects diagnostics and analyzes them
- So that I don't need to manually chain two separate skills

**AC:**
- [ ] `skills/roll-debug/SKILL.md` 合并兩個技能的能力：
  - 自動 Playwright 診斷（原 bb-debug）
  - 診斷報告分析與根因定位（原 bb-analyzer）
  - 有 BB 工具時使用 BB，沒有時降級到通用模式
- [ ] 原 `skills/wk-bb-debug/` 和 `skills/wk-bb-analyzer/` 刪除
- [ ] 所有引用 `$wk-bb-debug` 或 `$wk-bb-analyzer` 的地方更新為 `$roll-debug`
- [ ] `npm test` 75/75 通過

**Files:**
- `skills/roll-debug/SKILL.md`（新建，合并內容）
- `skills/wk-bb-debug/`（刪除）
- `skills/wk-bb-analyzer/`（刪除）

**Dependencies:**
- Depends on: US-ROLL-001
- Depended on by: —

---

<a id="us-roll-005"></a>
## US-ROLL-005 設計並實現 roll-build — 統一交付入口 📋

**Created**: 2026-04-16  
**Plan**: [rename-roll-plan.md](rename-roll-plan.md)

- As a developer wanting to ship something
- I want a single `roll-build` skill that handles any delivery scenario
- So that I never need to choose between fly/story/fix modes manually

**AC:**
- [ ] `skills/roll-build/SKILL.md` 實現統一入口判斷邏輯：
  - 輸入匹配 `US-XXX` → Story 模式（原 story-build 路徑）
  - 輸入匹配 `FIX-XXX` → 轉給 `$roll-fix`
  - 其他輸入 → Fly 模式（原 fly-build：澄清→設計→執行）
- [ ] Story 模式和 Fly 模式共享 TCR 循環、code-review、CI/push/verify
- [ ] 完成交付後內嵌慶祝輸出（替代已刪除的 wk-.yeah）
- [ ] 原 `skills/wk-fly-build/` 和 `skills/wk-story-build/` 刪除
- [ ] `AGENTS.md` Skill Selection 部分更新：`$roll-build` 作為主入口
- [ ] `npm test` 75/75 通過

**Files:**
- `skills/roll-build/SKILL.md`（新建，合并邏輯）
- `skills/wk-fly-build/`（刪除）
- `skills/wk-story-build/`（刪除）
- `conventions/global/AGENTS.md`（Skill Selection 更新）

**Dependencies:**
- Depends on: US-ROLL-001, US-ROLL-002（技能已改名）
- Depended on by: —

---

<a id="us-roll-006"></a>
## US-ROLL-006 折入 wk-init → roll init CLI，刪除獨立技能 📋

**Created**: 2026-04-16  
**Plan**: [rename-roll-plan.md](rename-roll-plan.md)

- As a developer setting up a new project
- I want `roll init` (the CLI command) to be the single source of truth for project initialization
- So that there's no separate AI skill duplicating what the CLI already does

**AC:**
- [ ] `skills/wk-init/` 刪除
- [ ] `conventions/global/AGENTS.md` 中 wk-init 引用改為直接調用 `roll init`
- [ ] `roll init` CLI 命令的 `--help` 輸出清晰描述所有初始化選項
- [ ] `npm test` 75/75 通過

**Files:**
- `skills/wk-init/`（刪除）
- `conventions/global/AGENTS.md`

**Dependencies:**
- Depends on: US-ROLL-001
- Depended on by: —
