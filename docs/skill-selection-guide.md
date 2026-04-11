# CNX Skill Selection Guide

快速选择合适的 skill 或 tool。

## Core Skills

| 用户意图 | 选用 Skill | 说明 |
|---------|-----------|------|
| **"不确定怎么做"** / **"有几个方案"** | `cnx-design` | 方案探索，多方案对比，人类决策 |
| **"帮我做个..."**（需求不清晰） | `cnx-roll-build` | 一句话需求，AI 自动澄清→规划→实现 |
| **"实现 US-001"**（有明确故事） | `cnx-story-build` | 按 BACKLOG.md 执行，完整交付 |
| **"这个逻辑很关键"** / **"涉及支付"** | `cnx-spar` | 攻守对抗式 TDD，高风险时启用 |
| **"修个 bug"** / **"改个文案"** | `cnx-fix-build` | 快速修复，不走完整流程 |
| **"规划需求"** / **"拆成故事"** | `cnx-design` | 只规划不实现，产出 BACKLOG.md |
| **"并行做几个 Action"** | `cnx-story-build` | 拆分 Actions 后自动判断并行 |
| **"初始化项目"** | `cnx-init` | 创建标准目录结构 + BACKLOG.md |
| **"检查线上状态"** | `cnx-sentinel` | 生产巡检，回归测试 |
| **"调试这个页面"** | `cnx-bb-debug` | 深度诊断，收集日志/网络/DOM |

## Tools

| 用户意图 | 选用 Tool | 决策逻辑 |
|---------|----------|---------|
| **"抓取网页"** / **"爬取文档"** | `cnx-fetch` | 见下方 fetch 方法选择 |
| **"找 Orin 机器"** / **"检查节点"** | `cnx-probe` | `find` → 发现机器 / `health` → 健康检查 / `diagnose` → 完整诊断 |

### cnx-fetch 方法选择

| 优先级 | 方法 | 条件 | 说明 |
|-------|------|------|------|
| 1 | **Tavily API** | 有 `TAVILY_API_KEY` | 最佳质量，AI 优化提取 |
| 2 | **LLM Native Fetch** | 无 Tavily | 用 Kimi/Codex/Claude 内置 fetch |
| 3 | **Browser Automation** | 前两者失败 | 见 browser-use 选择 |

#### browser-use 选择

| 条件 | 选择 | 命令 |
|------|------|------|
| 有 `BROWSER_USE_API_KEY` | **Cloud** | `Agent(task=...)` |
| 已安装 `browser-use` | **Local** | `Browser(headless=True)` |
| 都没有 | **跳过** | 提示用户需要配置 |

## Support Skills

| 场景 | Skill | 触发时机 |
|------|-------|---------|
| 完成 Build 庆祝 | `cnx-.yeah` 🎉 | Build 成功后自动执行 |
| 代码自审 | `cnx-.code-review` | Commit 前，或手动触发 |
| 生成 Changelog | `cnx-.changelog` | Deploy 成功后自动触发 |
| QA 测试参考 | `cnx-.qa-cover` | 写测试时参考 |

## 快速决策树

```
用户输入
    ↓
┌──────────────────────┐
│ "不确定方案？"       │──→ cnx-design
└──────────────────────┘
    ↓ 否
┌──────────────────────┐
│ "一句话需求？"       │──→ cnx-roll-build
└──────────────────────┘
    ↓ 否
┌──────────────────────┐
│ "有 US ID？"         │──→ cnx-story-build
└──────────────────────┘
    ↓ 否
┌──────────────────────┐
│ "修 bug？"           │──→ cnx-fix-build
└──────────────────────┘
    ↓ 否
┌──────────────────────┐
│ "规划/拆分？"        │──→ cnx-design
└──────────────────────┘
    ↓ 否
┌──────────────────────┐
│ "抓取网页？"         │──→ cnx-fetch
└──────────────────────┘
    ↓ 否
┌──────────────────────┐
│ "找机器？"           │──→ cnx-probe
└──────────────────────┘
    ↓ 否
  人工判断
```

## Auto-Trigger Keywords

| Skill | 触发关键词 |
|-------|-----------|
| `cnx-design` | "讨论", "方案对比", "怎么选", "权衡", "不确定用什么", "设计", "规划" |
| `cnx-roll-build` | "帮我做", "加个功能", "改一下", "重构" |
| `cnx-story-build` | "实现 US-", "做这个故事", "完成 Action" |
| `cnx-fix-build` | "修 bug", "改个文案", "调个颜色", "报错" |
| `cnx-design` | "规划", "拆分", "写故事", "需求分析" |
| `cnx-spar` | "对抗", "攻防", "高风险", "关键逻辑", "支付", "权限", "安全" |
| `cnx-story-build` | "并行做", "同时开发", "分派", "多路" |
| `cnx-fetch` | "抓取", "爬取", "提取网页", "获取内容" |
| `cnx-probe` | "找机器", "检查节点", "看看 Orin", "健康检查" |
| `cnx-sentinel` | "巡检", "检查线上", "回归测试" |
| `cnx-bb-debug` | "调试", "诊断", "页面有问题", "黑盒分析" |
