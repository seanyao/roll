# Roll 常见问题

按你和 Roll 接触的阶段组织，给真实问题真实回答：

- **[A. 上手 / 信任 / 安全](#a-上手--信任--安全)** —— 第一次接触前后会想的
- **[B. 定位与对比](#b-定位与对比)** —— Roll 和同类项目的区别
- **[C. 运行中常见问题](#c-运行中常见问题)** —— 跑起来后卡住怎么办

---

## A. 上手 / 信任 / 安全

> **Roll 有两套界面。** 读这份 FAQ 时请分清：
>
> - **CLI 命令** —— 在终端里跑：`roll init`、`roll loop on`、`roll status`、
>   `roll brief` 等。负责状态管理、调度、观测。**它们本身不写代码**。
> - **Skill** —— 在你的 AI agent 里调用（Claude Code、Cursor、Codex、Pi
>   等）：`$roll-build`、`$roll-design`、`$roll-fix`、`$roll-onboard` 等。
>   在 Claude Code 里输入形式是 `/roll-build`；`$` 前缀是文档里跨工具的
>   通用写法。**真正写代码的是 skill**。
>
> 看到 `roll loop on` —— 是 shell 命令。看到 `$roll-build US-001` —— 是
> 你在 agent prompt 里调用的 skill。

### A1. Roll 会不会改我代码、搞坏我的 main 分支？

**短答：** Roll 有真的护栏，但**两种模式的安全模型不一样**，要看清你在
跑哪种。

**通用保证 —— TCR**：每次提交都跑你的测试。测试不过，提交自动回滚。
**两种模式下，坏代码都不可能保留**。这是其他护栏的地基。

**手动模式（`$roll-build`、`$roll-fix` 等，trunk-based）：**

- agent 一边干一边做 TCR 微提交
- **Phase 6** 在 push 之前在本地跑完整 CI
- **Phase 7** 在 push 之前由 agent 做代码 review
- **Phase 8** 直推 `main` —— 你坐在 agent 面前看着这一切发生，随时能叫停
- 远程 CI 是最后一道网：push 后变红你立刻就能看到，修一下或 revert

**Loop 模式（`roll loop on`）：**

- 在 worktree 的分支上构建（`loop/cycle-${CYCLE_ID}`）
- `gh pr create --base main` 开 PR
- 调用 `gh pr merge --auto --squash --delete-branch` —— PR **只有在你的
  required CI checks 全绿时**才自动合并。**默认是 CI 把关，不是人**
- 要在合并前加上人审，去 GitHub 的 branch protection 把 `main` 加上
  required reviewers，`--auto` 就会等你审完

**两种模式都一样：** 所有过程都在 git history 里。要回滚就 `git revert`
或 `git reset`，没有黑盒。

**先手动试一遍：** 打开你的 AI agent（Claude Code、Cursor、Pi 等），
在项目里调用 build skill 跑一条 story：

```text
$roll-build US-001         # 在 Claude Code 里输入：/roll-build US-001
```

你会在眼前看完整的 design → TCR → 本地 CI → review → push 过程，把
loop 开起来之前先看清 Roll 到底碰了什么。

---

### A2. 我有一个老项目能用吗？会污染我现有代码吗？

**短答：** 可以。Roll 对老项目有专门的 onboarding 流程，且只写自己的目录。

**细节：** 在已有代码的仓库里跑 `roll init`，会自动检测并引你走
`$roll-onboard`。这个 skill 会读你的项目，问 9 个关于认知 / 范围 / 隐私
的问题，先写出 `.roll/onboard-plan.yaml` 作为契约，再由
`roll init --apply` 实际动手。

Roll 写到你仓库里的东西：

- `.roll/` —— backlog、feature 规格、配置（要 commit）
- `.claude/skills/` 或其他 agent 等价目录 —— Roll skill 的软链（要 commit）
- `.gitignore` 加几行

Roll **不会**碰你的源代码 —— 除非 agent 正在执行你写的某条 story。

---

### A3. 我不想让它自动跑，能手动一条条来吗？

**短答：** 能。Loop 是 opt-in 的。

**细节：** 不开 `roll loop on`，Roll 就是一套 CLI + skill 库。你在
`.roll/backlog.md` 写一条 story，然后在 AI agent 里调用 skill：

```text
$roll-build US-001         # 端到端跑一条 user story
$roll-fix   FIX-002        # 端到端跑一条 bugfix
```

（在 Claude Code 里输入形式是 `/roll-build US-001` 和 `/roll-fix FIX-002`。）

每次调用都在你眼前跑完 design → TCR → 本地 CI 闸 → agent 自审 → 推到
`main`，每一步你都看得见，随时能叫停。
等你信任这套流程了，再在终端跑 `roll loop on` 让它自己选 story。

---

### A4. 装上之后改了我哪些系统配置？怎么干净卸载？

**短答：** 三个地方，`./uninstall.sh` 全部还原。

**细节：**

- **全局**：`~/.roll/`（你的 config、primary_agent）、`~/.shared/roll/`
  （loop 状态、`runs.jsonl`）。npm 二进制放在 npm 全局目录里。
- **每个项目**：`.roll/`，以及 `.claude/skills/`（或其他 agent 等价路径）
  下指向 Roll skill 的软链。
- **只在 `roll loop on` 之后**：macOS 上一个 `launchd` plist 用来触发周期。

要完全卸载：

```bash
npm uninstall -g @seanyao/roll
~/.roll/uninstall.sh --dry-run    # 预览会删什么
~/.roll/uninstall.sh              # 实际执行
```

---

### A5. 跑一次大概多少 token？成本能看到吗？

**短答：** 能。Dashboard 按公开单价显示每个周期的模型 + 成本。

**细节：** 从 `v2026.521.1` 起，`roll loop monitor` 和 `roll loop status`
会显示用的模型和按公开 per-token 单价算出来的成本。这是一个**横向可比**
的数字，不是你的实际账单 —— 你的实际花费取决于你的订阅折扣（Claude Pro 等）。

Claude Opus 4.x 上典型单条 story 成本：**$0.5 – $3**，看故事复杂度和
TCR 来回次数。切到 Kimi / DeepSeek 能便宜 5–10 倍，代价是收敛慢一点。

**试一下：**

```bash
roll loop monitor                # 实时 dashboard 带成本列
roll loop status --days 7        # 看过去 7 天每个周期的成本
```

---

### A6. 我需要懂 DDD / TCR / Prompt 工程吗？

**短答：** 不需要。但**会写 user story** 帮助很大。

**细节：** Roll 的方法论藏在 skill 里，不需要你脑子里装。`$roll-design`
带你做 DDD 拆解；`$roll-build` 替你跑 TCR；prompt 工程封装在 skill 文件里
（你好奇可以读或改）。

唯一需要你**脑子里有**的：**把你想要的东西讲清楚**。INVEST 形态的 story
（独立、可协商、有价值、可估算、足够小、可测）比"帮我做个功能"效果好得多。
`$roll-design` 帮你从模糊想法走到 INVEST。

---

### A7. User Story 应该写多细？写得不好它能跑通吗？

**短答：** 细到**你自己**能照着写代码。太模糊的会被识别出来、refine 后再
`$roll-build` 才动代码。

**细节：** 一条可执行的 story 包含价值陈述（`As X, I want Y, so that Z`）、
2–5 条验收标准（AC）、以及非显然的约束。**别**指定实现方式 —— Roll 自己来。

- **太模糊** → `$roll-build` 里的 `$roll-.clarify` 阶段会停下来问你
- **太复杂** → design 阶段会建议拆成更小的 story
- **模糊但能跑** → agent 自己做选择，原型阶段可以接受，生产代码风险较大

**试一下：** 运行 `$roll-design "加一个登出按钮"`，看它怎么把一句话扩成
一条带 AC 的 INVEST story。

---

### A8. Roll 适合什么项目？什么不适合？

**适合：**

- 有真实的测试套件（TCR 依赖它）
- 用 git + PR 工作流
- 有 CI（GitHub Actions 或同类）
- 能用 1–3 句话描述的需求
- TypeScript / Python / Go / Bash 项目（当前支持最好）

**不适合：**

- 一次性脚本、扔掉的原型 —— 开销大于价值
- 高度专门化领域（底层 OS、嵌入式、形式化验证）—— AI agent 在这些领域表现差

**边界情形 —— 没测试的老代码库：** 这是个 bootstrap 问题，不是禁区。
TCR 总得有**点东西**可守，所以零测试的仓库 day-one 跑不了 loop —— 但把
这类代码库救回来正是 Roll 擅长的事。流程：先用 `$roll-onboard` 把现有
代码逆向工程成 backlog，**先写 characterization-test story**（用测试把
当前行为钉死，再动代码），有了这层网之后再在 TCR 下重构。前几条 story
是 bootstrap，之后就和正常的 Roll 项目一样跑。

---

### A9. 没有 CI / 没有 GitHub Actions 也能用吗？

**短答：** 能用，但失去 CI 闸门。TCR 和 PR 流程还在。

**细节：** `roll ci --wait` 找当前 commit 上的 GitHub Actions。如果没配
CI，Roll 优雅降级：TCR 仍是内层闸门（测试不过提交不留），PR 仍然创建，
但 loop 不会等远程 CI 绿就标记 story 为 Done。

纯本地用（不挂 GitHub），Roll 也能当方法论 + skill 层用 —— 只是失去
"等绿了再下一条"的自动行为。

---

### A10. 单人用还是团队用？多人怎么协作？

**短答：** 优先支持单人 / 结对；团队用法可行但需要按场景设计。

**细节：**

- **单人**：默认。`.roll/backlog.md` 是你的私人队列。
- **结对**：把 `.roll/` 提交进 git，搭档的 Roll 读同一份 backlog。锁是
  per-machine 的，两人都开 loop 不会撞状态，但可能抢同一条 story。
- **团队**：`.roll/backlog.md` 当源代码对待，通过 PR 协作。`roll peer`
  支持跨 agent 评审（一个 agent 评另一个 agent 的 PR）。多人 loop 的
  "谁挑下一条"协调还是个粗糙边缘。

务实建议：团队里在自己的分支 / fork 上跑 loop，PR 像普通贡献者一样合上去。

---

## B. 定位与对比

### B1. 和 Claude Code 自带的 `/loop`、skills、tasks 是什么关系？

**Claude Code 已经有什么：** Skills（自定义命令）、tasks（session 内 todo）、
plan mode（执行前 review）、`/loop`（按时间间隔触发 prompt 的定时器）。

**Roll 的差异：**

- **Backlog 持久化在 git 里**。Roll 的 `.roll/backlog.md` 跨 session、
  跨重启、跨模型都在。Claude Code 的 tasks 一个 session 就没了。
- **是交付管线，不是定时器**。`/loop` 每 N 分钟重发一个 prompt。Roll 的
  loop 选下一条 ready 的 story，走完 DDD → TCR → PR → CI，等绿了再下一条。
- **TCR 是硬闸**。Claude Code 的 skill 是建议性的，Roll 在 commit 时刻
  强制 `test && commit || revert`。
- **跨 agent**。同一份 backlog 和 skill，可以在 Codex / Kimi / DeepSeek /
  Pi / OpenCode 上跑。`/loop` 只认 Claude。

**怎么选：**

- 交互式 session，临时任务 → Claude Code 单独用就够
- 长期项目，要无人值守推进、有 CI 闸 → 在 Claude Code 上加一层 Roll

Roll 的 `roll-*` skill **本身就是** Claude Code skill。Roll 不替代
Claude Code，它在上面叠一层。

---

### B2. 和 [superpowers](https://github.com/obra/superpowers)（obra）比？

**superpowers 强在哪：** 成熟的 7 阶段方法论（brainstorm → worktree →
plan → execute → test → review → finish），支持的 agent 很广（Claude
Code / Cursor / Codex / Antigravity / Copilot / Factory / OpenCode），强制
RED-GREEN-REFACTOR，subagent 驱动开发。Roll README 已致谢 ——
Roll 几个工作流模式从它借鉴而来。

**Roll 的差异：**

- **持久 backlog + 自动 loop**。superpowers 是 session 驱动 —— 每个周期
  你自己启动。Roll 有 `roll loop on` 跑无人值守循环，自动挑下一条。
- **CI 作为终态闸门**。Roll 等 GitHub Actions 绿了才标 Done；
  superpowers 把 CI 集成留给你。
- **PR-centric**。每条 Roll story 最后是一个挂上你 CI 的 PR；
  superpowers 对产出形态更灵活。

**怎么选：**

- 你想自己驱动每个 session，要一套强方法论压阵 → **superpowers**
- 你要在 backlog 上无人值守推进，要硬 CI 闸 → **Roll**

也可以一起用 —— 两者有重叠但不冲突。

---

### B3. 和 [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex)（Yeachan Heo）比？

**oh-my-codex 强在哪：** 给 Codex CLI 的精致 harness —— tmux HUD、hooks、
agent 团队（`$ralplan`、`$ralph`、`$ultragoal`）、`.omx/` 持久状态、
基于 ledger checkpoint 的多目标续命。29k star，非常活跃（107 个 release）。

**Roll 的差异：**

- **不只 Codex**。Roll 支持 Claude / Codex / Kimi / DeepSeek / Pi /
  OpenCode。oh-my-codex 有意聚焦 Codex CLI。
- **TCR 是硬闸**。oh-my-codex 推荐 clarification → planning → execution
  的流程，但**不**在 commit 层强制 TDD/TCR。
- **PR + CI 是终态**。Roll 的 loop 每条 story 结束在"PR 合并 + CI 绿"。
  oh-my-codex 结束在"agent 说目标完成"。
- **方法论形态**。oh-my-codex 强调耐久的多目标执行和并行团队。Roll 强调
  单 story 原子化（一条 INVEST story → 一个 PR → CI 绿 → 下一条）。

**怎么选：**

- 重度 Codex CLI 用户，想要 hooks / tmux HUD / 多 agent 团队 →
  **oh-my-codex**
- 想要跨 agent 可移植，把 PR/CI 当成成功契约 → **Roll**

---

## C. 运行中常见问题

### C1. Loop 卡住了 —— 故事停在 "In Progress" / Done 没写上

**现象：** `roll loop status` 显示 `running`，或者 BACKLOG 里某条 story
停在 `🔨 In Progress` 超过一个周期，或者 agent 跑过了（能看到 TCR commit）
但 story 没标 `✅ Done`。

**原因：** Loop 在调用构建 skill **之前**就把 story 标为
`🔨 In Progress`，只有两个硬门都过了才写 `✅ Done`：(1) TCR commit 数 > 0，
(2) `roll ci --wait` 通过。任何一个挂了，story 就保持原状 —— 这是设计如此，
避免假阳性的完成标记。

**原理：** 每个周期获取一个项目级 LOCK
（`~/.shared/roll/loop/.LOCK-<slug>`）。PID 已死的 LOCK 下个周期自动清理；
进程还活着但挂起的（例如 tmux 卡死）会让 LOCK 一直在，阻止新周期启动。

**解决：**

```bash
roll loop status        # 看 LOCK + 持有它的 PID
roll loop attach        # 看 agent 在 tmux 里干什么
roll loop runs          # 上一个周期的结果和告警
roll alert              # 有没有 CI 或 TCR 告警
roll loop reset         # 实在卡死了清状态 + LOCK
roll loop now           # 立即触发新周期
# 如果代码确实做完了、测试也过，但 Phase 11 没走完：
$roll-build US-XXX      # 手动重跑这条 story
```

---

### C2. PR 有合并冲突 / Rebase 失败

**现象：** `gh pr checks` 显示 "This branch has conflicts"，或
`roll loop runs` 报告 rebase 失败告警。

**原因：** Loop 在 worktree 里构建期间，另一个 commit 合到了 `main`，
和 PR 冲突。Loop 的 PR inbox 会尝试 rebase；如果双方动了同一行，rebase
失败。

**原理：** Rebase 熔断器追踪每个 PR 的尝试次数 —— 24 小时内失败 3 次后
阻止继续尝试并写 ALERT。这防止结构性冲突导致的无限 rebase 循环。

**解决：**

```bash
gh pr view <number>               # 看哪些文件冲突
git fetch origin main
git checkout <pr-branch>
git rebase origin/main            # 手动解决
git push --force-with-lease
# CI 重跑；如果开了自动合并，绿了自动 merge
```

---

### C3. 怎么看 Loop 做了什么 + 花了多少钱？

**现象：** Loop 在你不在时跑了，你想快速看清楚发生了什么、花了多少。

**为什么重要：** Roll 每个周期都写结构化记录，但根据需求有多个查看入口。

**原理：** 每个周期向 `~/.shared/roll/loop/runs.jsonl` 追加一条 JSONL，
包含 story ID、模型、TCR commit 数、耗时、结果、成本（按公开单价）。
`roll-brief` 把这些聚合成人类可读摘要。tmux 会话保留完整 agent 对话，
直到下一个周期覆盖。

**观测入口：**

| 你想看什么 | 命令 |
|---|---|
| 最近 N 个周期摘要 + 成本 | `roll loop status --days 7` |
| 每周期 JSONL 记录 | `roll loop runs` |
| 带成本列的实时 dashboard | `roll loop monitor` |
| 实时看 agent 在做什么 | `roll loop attach` |
| 人类可读的每日摘要 | `roll brief` |
| 需要关注的告警 | `roll alert` |
| 完整 agent 对话记录 | `roll loop attach` 后上翻 |

---

### C4. 多个项目同时跑 Loop 会互相干扰吗？

**现象：** 两个项目都开了 `roll loop on`，怀疑它们互相影响。

**原因：** 不会。每个项目有自己的 LOCK
（`~/.shared/roll/loop/.LOCK-<project-slug>`）、自己的 `state.yaml`、自己
的 launchd plist。Slug 由 `basename + md5(绝对路径)` 生成，即便两个项目
目录名一样，路径不同也得不同 slug 和不同锁。

**解决：**

```bash
# 在每个项目目录跑一下，看各自的 scheduler + LOCK
roll loop status

# 看所有活着的锁
ls ~/.shared/roll/loop/.LOCK-*

# 如果另一个项目留下的僵死锁挡住了你
roll loop reset
```

---

### C5. 什么时候自动恢复，什么时候要我介入？

**Loop 的原则：清楚的工作往前推；模糊的工作或坏掉的环境停下来告诉你 ——
不会猜。**

**自动恢复（不需要你）：**

- 网络超时 → 指数退避重试（2s、4s、8s、16s）
- 主 agent token 耗尽 → 切到后备 agent
- 崩溃进程留下的僵死 LOCK → 下个周期自动清理
- 崩溃周期留下的孤儿 `🔨 In Progress` → 下个周期回退为 `📋 Todo`

**需要你：**

- 主 agent 和后备 agent 都失败 → 修环境后 `roll loop resume`
- CI 持续红 → 修测试 / build，然后 `roll loop now`
- PR 合并冲突 → 手动解决，push
- `gh` 认证过期 → `gh auth login`
- Story 反复回滚（每次 TCR commit 数 = 0）→ story 规格不清晰；重写 AC
  或 `$roll-build US-XXX` 手动跑一遍看在哪卡住

更细的操作话题（pause/resume、切换 agent、gh scope 等）见
[loop.md](loop.md) 和 [configuration.md](configuration.md)。
