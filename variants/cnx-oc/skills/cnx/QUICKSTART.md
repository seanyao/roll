# CNX 命令速查

**AI-Coding 工作流统一入口** - 结构化软件开发的完整工具链

---

## 快速开始

```bash
$cnx <command> [options]
```

---

## 命令总览

| 命令 | 用途 | 场景 |
|------|------|------|
| `backlog` | 需求规划 | 新功能设计、拆分 Stories |
| `build` | 执行 Story | 开发具体功能 |
| `fix` | 修复 Bug | 快速修复问题 |
| `roll` | 一句话交付 | 简单需求快速实现 |
| `review` | 代码审查 | 检查代码质量 |
| `fetch` | 单页抓取 | 获取单个网页内容 |
| `crawl` | 全站爬取 | 批量抓取网站 |
| `probe` | 节点检查 | 发现机器、健康诊断 |
| `init` | 初始化项目 | 创建新项目结构 |
| `changelog` | 生成日志 | 发布前更新记录 |

---

## 使用示例

### 📝 Plan - 规划阶段

```bash
# 规划新功能，自动拆分为 Stories
$cnx backlog "用户登录系统"

# 从已有设计文档规划
$cnx backlog --from-plan docs/plans/auth.md

# 直接创建单个 Story
$cnx backlog --story "添加密码重置功能"
```

### 🔨 Do - 执行阶段

```bash
# 执行指定的 Story
$cnx build US-001

# 快速修复 Bug
$cnx fix "登录按钮点击无响应"

# 一句话快速交付（自动规划+执行）
$cnx roll "添加深色模式切换"
```

### 👀 Check - 检查阶段

```bash
# 代码审查
$cnx review

# 抓取技术文档参考
$cnx fetch https://docs.example.com/api

# 爬取竞品网站分析
$cnx crawl https://competitor.com --depth 2
```

### 🚀 Act - 部署阶段

```bash
# 生成更新日志
$cnx changelog

# 检查生产环境节点
$cnx probe health production.local
```

---

## 场景对比

### fetch vs crawl

| 场景 | 命令 | 说明 |
|------|------|------|
| 查看一篇文章 | `$cnx fetch <url>` | 单页提取，快速获取 |
| 备份整个文档站 | `$cnx crawl <url>` | 全站递归，批量保存 |
| 获取 API 文档 | `$cnx fetch` | 一次获取当前页 |
| 竞品网站分析 | `$cnx crawl` | 深度爬取多页面 |

### build vs fix vs roll

| 场景 | 命令 | 说明 |
|------|------|------|
| 按计划开发功能 | `$cnx build US-001` | 执行已有 Story |
| 修复线上 Bug | `$cnx fix "描述"` | 快速修复流程 |
| 临时小需求 | `$cnx roll "描述"` | 自动规划并执行 |

---

## 完整工作流示例

```bash
# 1. 规划需求 → 生成 US-001
$cnx backlog "用户登录功能"

# 2. 执行开发 → TCR 工作流
$cnx build US-001

# 3. 代码审查
$cnx review

# 4. 发布上线
$cnx changelog
```

---

## 环境要求

- Node.js 18+
- 项目目录需包含 `BACKLOG.md`
- Git 仓库（用于 TCR 工作流）

## 项目结构

```
project/
├── BACKLOG.md          # Story backlog
├── CHANGELOG.md        # 发布历史
├── docs/
│   └── plans/          # 设计方案
└── .github/
    └── workflows/      # CI/CD
```
