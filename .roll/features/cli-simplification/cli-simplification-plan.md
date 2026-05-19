# Plan: CLI Simplification — roll init 極簡化

**Date**: 2026-04-16

---

## Why

`roll init` 現在做了太多：問類型、問工具、merge 模板、scaffold 目錄。

這些問題的根本假設是「用戶在開始時就知道自己要建什麼類型的項目」。但在 AI-native 工作流裡，這個假設是錯的——項目結構應該由 skills 在執行 story 時**按需創建**，而不是在 init 時預先決定。

Skills 是給 AI 看的指令，AI 天然擅長讀上下文。`$roll-build` 看到 `package.json` 有 `"next"` 就知道這是 Next.js 項目，不需要用戶事先聲明 "fullstack"。

---

## 目標狀態

```
roll init
└── 三步完成：
    ├── 如無 AGENTS.md → 創建（從全局通用模板）
    ├── 如無 BACKLOG.md → 創建（空模板）
    ├── 如無 docs/features/ → 創建
    └── 提示：run `roll sync` to distribute to AI tools
```

已有 AGENTS.md 時（re-merge）：
```
roll init
└── Re-merge 全局約定到已有 AGENTS.md（保留用戶內容）
    └── 提示：done，sync 如有需要
```

---

## cmd_init() 新實現（目標 ~30 行）

```bash
cmd_init() {
  [[ ! -d "$ROLL_TEMPLATES" ]] && { err "..."; exit 1; }
  local project_dir; project_dir="$(pwd)"

  if [[ -f "$project_dir/AGENTS.md" ]]; then
    # Re-merge: apply latest global conventions, preserve user content
    info "Re-merging global conventions..."
    _WK_MERGE_SUMMARY=()
    _merge_global_to_project "$project_dir"
    print_merge_summary
    ok "Done. Run 'roll sync' if you want to update AI tool configs."
  else
    # Fresh init: create minimal WK workflow files
    _merge_global_to_project "$project_dir"
    _write_backlog "$project_dir/BACKLOG.md"
    mkdir -p "$project_dir/docs/features"
    ok "Initialized. Next: roll sync"
  fi
}
```

---

## 刪除清單

| 函數 | 行數 | 原因 |
|------|------|------|
| `_select_project_type()` | ~30 | 不再問類型 |
| `_select_tools()` | ~35 | 工具是 sync 的職責 |
| `scaffold_new_project()` | ~55 | 目錄由 skills 動態創建 |
| `scaffold_legacy_project()` | ~70 | 同上 |
| `_init_auto()` | ~20 | 合并入新邏輯 |
| `_init_new()` | ~30 | 同上 |
| `_init_refresh()` | ~15 | 同上 |
| `_detect_and_prompt_type()` | ~45 | 同上 |

**合計刪除 ~300 行**，`cmd_init()` 從 ~165 行降至 ~30 行。

保留：`scan_project_type_from_files()`、`detect_project_type()`（供內部 refresh_project 使用）。

---

## 通用 AGENTS.md 模板

移除 "Fullstack Web" / "CLI Tool" 等類型標記。

`conventions/global/AGENTS.md` 已是通用的，直接用它。  
`conventions/templates/` 繼續保留，作為 skills 的**參考資料**：
- `$roll-design` 在拆分 story 時可以參考對應類型的約定
- `$roll-build` 在創建文件時可以參考目錄結構建議
- 但用戶不再需要選擇它們

---

## Skills 變化

在 `roll-build`、`roll-design`、`roll-fix` 的 SKILL.md 開頭加入：

```
## Project Context Rule
Before creating any file or directory:
1. Read existing project structure (ls, cat package.json, check for go.mod/Cargo.toml etc.)
2. Infer conventions from evidence — don't assume type
3. Follow what already exists; introduce new patterns only when necessary
```

---

## 測試影響

`tests/integration/cmd_init.bats` 需要完全重寫：

**刪除的測試**（scaffold 相關）：
- init fullstack: scaffold creates docs/features/ ← 現在直接創建，不需 scaffold
- init fullstack: scaffold creates src/
- init fullstack: scaffold creates api/
- init cli: scaffold creates cmd/
- init legacy: per-component scaffold

**保留並更新的測試**：
- init: creates AGENTS.md in new project
- init: creates BACKLOG.md in new project
- init: creates docs/features/ in new project
- init: re-merges when AGENTS.md already exists
- init: prints "roll sync" hint

**純化**：測試從 13 個 → ~5 個，聚焦核心行為。

---

## 執行順序

```
US-CLI-001（cmd_init 精簡 + 測試更新）
    ├── US-CLI-002（通用 AGENTS.md 模板 + templates 重新定位）
    └── US-CLI-003（skills 加入 Project Context Rule）
```

001 完成後，002 和 003 可並行。
