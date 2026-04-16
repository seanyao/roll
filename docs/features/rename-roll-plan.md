# Plan: wukong → roll 品牌重命名 + 技能重構

**Date**: 2026-04-16  
**Driver**: 名字 "wukong" 拉高預期，"roll" 傳達核心語義——roll out features（滾動交付）

---

## Why

- `wukong` 作為孫悟空的隱喻太重，讓人期待一個「神器」
- `roll` 直白：這個工具幫你 roll out features，僅此而已
- 技能從 16 個縮到 11 個，消除用戶選擇負擔

---

## 技能地圖：16 → 11

### 主動技能（7 個）

| 舊名 | 新名 | 變化 |
|------|------|------|
| `wk-fly-build` + `wk-story-build` | **`roll-build`** | 合并：唯一交付入口 |
| `wk-fix-build` | `roll-fix` | 改名 |
| `wk-design` | `roll-design` | 改名 |
| `wk-research` | `roll-research` | 改名 |
| `wk-spar` | `roll-spar` | 改名 |
| `wk-sentinel` | `roll-sentinel` | 改名 |
| `wk-bb-debug` + `wk-bb-analyzer` | **`roll-debug`** | 合并 |

### 被動技能（4 個）

| 舊名 | 新名 | 變化 |
|------|------|------|
| `wk-.code-review` | `roll-.review` | 改名 |
| `wk-.qa-cover` | `roll-.qa` | 改名 |
| `wk-.changelog` | `roll-.changelog` | 改名 |
| `wk-.echo` | `roll-.echo` | 改名 |

### 刪除（2 個）

| 技能 | 原因 |
|------|------|
| `wk-.yeah` | 慶祝邏輯內嵌到 `roll-build` 結尾即可，不需要獨立技能 |
| `wk-init` | 折入 `roll init` CLI 命令，AI agent 直接調用 CLI |

---

## roll-build 設計（核心難點）

### 統一入口邏輯

```
用戶輸入 → roll-build 判斷上下文
  ├── 輸入匹配 "US-XXX" 格式  → Story 模式（原 story-build）
  ├── 輸入匹配 "FIX-XXX" 格式 → 轉給 roll-fix
  └── 其他（一句話想法）       → Fly 模式（原 fly-build 主路徑）
                                 → 自動澄清 → 創建 Story → 執行
```

### 兩種模式的行為差異

**Fly 模式**（默認，無 ID）：
1. 用 `roll-.echo` 澄清意圖（如有歧義）
2. 用 `roll-design` 思維拆分為 INVEST Story
3. 寫入 BACKLOG
4. 執行 TCR 工作流
5. 完成後觸發慶祝（內嵌）

**Story 模式**（有 US-ID）：
1. 從 BACKLOG 讀取 Story 詳情
2. 直接執行 TCR 工作流
3. 完成後更新 BACKLOG 狀態

兩種模式共享：TCR 循環、code-review、CI/push/deploy/verify。

### 技能引用更新

所有 SKILL.md 內的 `$wk-*` 引用全部改為 `$roll-*`。

---

## CLI 命令變化

```
wukong → roll（二進制改名）
~/.wukong/ → ~/.roll/（主目錄）
WK_HOME → ROLL_HOME（環境變量）
wukong hooks → roll hook（單數，更自然）
```

其他命令結構不變：setup / sync / init / status / reset

---

## 改名工程依賴順序

```
US-ROLL-001（二進制 + 路徑 + 測試）
    └→ US-ROLL-002（技能改名 + 刪除）
    └→ US-ROLL-003（文檔 + migration script）
    └→ US-ROLL-004（合并 roll-debug）
    └→ US-ROLL-005（roll-build 合并，最複雜）
    └→ US-ROLL-006（折入 wk-init）
```

001 必須先完成（基礎路徑確定），002-006 可並行。

---

## 測試覆蓋保障

75 個 bats 測試覆蓋所有 CLI commands 核心路徑。  
改名後測試仍然有效（路徑從 `.wukong` 改為 `.roll`），是安全網。  
US-ROLL-001 包含同步更新所有測試 fixture 路徑。
