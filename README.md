# Cybernetix (CNX)

```
╔═══════════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                           ║
║       ██████╗██╗   ██╗██████╗ ███████╗██████╗ ███╗   ██╗███████╗████████╗██╗██╗  ██╗      ║
║      ██╔════╝╚██╗ ██╔╝██╔══██╗██╔════╝██╔══██╗████╗  ██║██╔════╝╚══██╔══╝██║╚██╗██╔╝      ║
║      ██║      ╚████╔╝ ██████╔╝█████╗  ██████╔╝██╔██╗ ██║█████╗     ██║   ██║ ╚███╔╝       ║
║      ██║       ╚██╔╝  ██╔══██╗██╔══╝  ██╔══██╗██║╚██╗██║██╔══╝     ██║   ██║ ██╔██╗       ║
║      ╚██████╗   ██║   ██████╔╝███████╗██║  ██║██║ ╚████║███████╗   ██║   ██║██╔╝ ██╗      ║
║       ╚═════╝   ╚═╝   ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝╚═╝  ╚═╝      ║
║                                                                                           ║
║                         Agent-First Development Workflow                                  ║
║                         Let's roll, no sprints!                                           ║
╚═══════════════════════════════════════════════════════════════════════════════════════════╝
```
> 
> **C**yber**n**eti**x** - The AI-Native Development Workflow  
> _Let's roll, no sprints!_

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 什么是 Cybernetix？

**Cybernetix (CNX)** 是一套 AI 开发工作流：讨论 → 规划 → 开发 → 检查 → 修复，持续循环。

核心理念

### 1. Agent First

**Agent 是第一用户，人类是决策者。**

```
Human: 设定目标、做决策
   ↓
Agent: 理解、执行、验证、优化
   ↓
System: 反馈驱动、持续改进
```

### 2. 反馈驱动的持续交付

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  DESIGN  │───→│  BUILD   │───→│  CHECK   │───→│   FIX    │
│$cnx-    │    │$cnx-    │    │$cnx-    │    │$cnx-    │
│ design   │    │ story   │    │ sentinel │    │ fix     │
│          │    │ -build  │    │          │    │ -build  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
     ↑                                                │
     └────────────────────────────────────────────────┘
                        持续改进循环
```

## 架构全景

```mermaid
flowchart TB
    subgraph LOOP["🔄 持续交付循环"]
        direction TB
        
        subgraph DESIGN["💬 DESIGN"]
            design["$cnx-design<br/>讨论+设计+规划"]
        end
        
        subgraph BUILD["⚡ BUILD"]
            story["$cnx-story-build<br/>Story开发(含并行调度)"]
            fix["$cnx-fix-build<br/>Bug修复"]
            roll["$cnx-roll-build<br/>快速实现"]
        end
        
        subgraph CHECK["👁️ CHECK"]
            sentinel["$cnx-sentinel<br/>定时巡检"]
            bbdebug["$cnx-bb-debug<br/>深度诊断"]
        end
        
        subgraph FIX["🔧 FIX"]
            act_fix["$cnx-fix-build<br/>修复改进"]
        end
    end
    
    design --> story & roll
    story & roll --> sentinel
    sentinel -->|发现问题| act_fix
    sentinel -->|深度问题| bbdebug
    bbdebug -->|创建FIX| act_fix
    act_fix --> sentinel
    
    style DESIGN fill:#e1f5ff
    style BUILD fill:#e8f5e9
    style CHECK fill:#fff3e0
    style FIX fill:#ffebee
```

---

## Skill 生态系统

| Skill | 阶段 | 功能 | 状态 |
|-------|------|------|------|
| `$cnx-init` | - | 初始化项目 | ✅ |
| `$cnx-design` | DESIGN | 讨论方案 + 设计架构 + 规划 Stories | ✅ |
| `$cnx-story-build` | BUILD | 执行 BACKLOG 中已有的 US（含并行调度） | ✅ |
| `$cnx-spar` | BUILD | 对抗式 TDD：Attacker 写测试攻击，Defender 写代码防守 | ✅ |
| `$cnx-fix-build` | BUILD/FIX | 修单个 BUG / FIX / 小改动 | ✅ |
| `$cnx-roll-build` | DESIGN+BUILD | 一句话模糊需求，边拆边做 | ✅ |
| `$cnx-sentinel` | CHECK | 巡检、回归检查 | ✅ |
| `$cnx-bb-debug` | CHECK | 页面或线上问题深度排查 | ✅ |
| `$cnx-bb-analyzer` | CHECK | 分析诊断报告 | ✅ |
| `$cnx-qa-cover` | Support | 测试规范 | ✅ |

## 快速开始

### 安装

```bash
git clone https://github.com/seanyao/cybernetix.git
# 手动配置 .codex/skills 软连接
```

### 配置 Codex

复制以下内容到你的 Codex 配置：

```markdown
# Cybernetix (CNX) AI 开发助手

你是 CNX 的 AI 开发助手。Agent-First，反馈驱动，持续交付。

## 核心规则

1. **BACKLOG.md** 是任务索引（如有）
2. **AGENTS.md** 是项目约束（如有）
3. Build 类任务遵循 TCR：Test → Commit → Revert
4. 完成前必须通过 Verification Gate（贴新鲜证据）
5. 完成后更新 backlog 状态

## Skill 列表（按需选用）

| Skill | 用途 |
|-------|------|
| `$cnx-design "话题"` | 讨论方案、设计架构、规划 Stories |
| `$cnx-init <项目名>` | 初始化项目 |
| `$cnx-story-build US-001` | 开发指定 Story（独立 Actions 自动并行） |
| `$cnx-spar "功能描述"` | 高风险逻辑用攻守对抗式 TDD |
| `$cnx-fix-build FIX-001` | 修复问题 |
| `$cnx-roll-build "一句话"` | 快速实现 |
| `$cnx-sentinel patrol` | 巡检检查 |
| `$cnx-bb-debug <URL>` | 页面诊断 |

Skills 相互独立，按需调用即可。
```

### 示例

```bash
# 初始化项目
$cnx-init my-app
cd my-app

# 方案不确定？先讨论
$cnx-design "搜索方案选型"

# 规划新需求
$cnx-design "用户登录功能"

# 执行已有 Story（独立 Actions 自动并行）
$cnx-story-build US-001

# 修复已有问题
$cnx-fix-build FIX-001

# 一句话快速实现
$cnx-roll-build "给后台加一个登录入口"

# 巡检 / 排查
$cnx-sentinel patrol --mode=normal
$cnx-bb-debug https://example.com/page
```

---

## 项目结构

```
my-project/
├── 📋 BACKLOG.md              # 任务索引
├── 🤖 AGENTS.md               # 架构约束 & Skill 路由
├── 📁 docs/features/          # Story 详情 & 设计文档
├── 📦 src/domains/            # DDD 领域代码
├── 🔌 api/                    # API 层
├── 🖥️ cli/                    # CLI 工具
├── 📋 schema/                 # 数据契约
├── 🧪 tests/                  # 测试
└── ⚙️ .github/workflows/      # CI/CD + Sentinel
```

---

## License

MIT License - 详见 [LICENSE](./LICENSE)
