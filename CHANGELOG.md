# Changelog

## 2026.05.10
- **Added**: E2E 自动沉淀 — 每个 Story 交付时自动写一个端到端测试，项目逐步积累可回放的 E2E 套件
- **Added**: CI E2E 门禁 — 模板 CI 每次推送自动跑 E2E 测试，没有 E2E 时静默跳过不阻塞
- **Added**: CI 红灯分诊 — 按严重程度分类 CI 失败，自动路由到 backlog 变成可执行的修复项
- **Added**: roll-debug 自动修复 — 诊断后若根因在项目源码内，自动进入 TCR 修复流程并回验
- **Added**: Changelog 自动生成 — 每次部署后自动更新，首次运行时回填全部历史记录

## 2026.05.06
- **Added**: OpenCode 集成 — 检测 opencode 环境，自动同步全局 AGENTS.md 规则文件

## 2026.05.05
- **Fixed**: 同步时清理已删除文件，防止用户机器残留幽灵文件
- **Fixed**: 修正 AGENTS.md 中过时的文件路径引用
- **Fixed**: 修正 GEMINI.md 中技术栈描述错误

## 2026.05.04
- **Added**: BB 注入模式 — 对未集成 Black Box 的页面自动注入诊断探针，统一数据采集接口

## 2026.04.24
- **Added**: Trae IDE 支持 — 生成 project_rules.md 规则文件，`roll` 命令自动检测 Trae 并同步配置

## 2026.04.20
- **Added**: roll-release — 一条命令完成版本号、changelog、tag、npm publish 全流程

## 2026.04.19
- **Added**: npm 分发 — 开发/运行时路径分离、`roll update` 自动更新、后台版本检查提醒、npm 发布基础设施

## 2026.04.17
- **Added**: roll-jot — 一句话快速记录 bug 或想法到 backlog，不打断当前工作
- **Added**: roll-.clarify — 遇到模糊需求时自动追问，确保开工前意图清晰

## 2026.04.16
- **Improved**: CLI 精简 — 三步极简 init，约定文件转为技能参考，技能自动读取项目上下文
