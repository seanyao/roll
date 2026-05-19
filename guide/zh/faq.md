# Roll 常见问题 — AI 自治交付

运行 Roll 自治交付系统时最常遇到的问题解答。每条包含一句原理说明，
帮你建立心智模型，而不只是照着步骤操作。

---

## 1. Loop 卡住了 — 故事一直显示 In Progress

**现象：** `roll loop status` 显示 `running`，或者 BACKLOG.md 中某个故事
停留在 `🔨 In Progress` 超过一个周期。

**原因：** Loop 在调用构建技能之前就把故事标记为 `🔨 In Progress`。如果
agent 崩溃、会话超时或 CI 门控阻塞，故事就会停留在该状态。下一个周期的
孤儿恢复机制应该会把它回退——但如果 LOCK 文件也变成僵死状态，下一个周期
可能根本无法启动。

**原理：** 每个 loop 周期都会获取一个项目级的 LOCK 文件
（`~/.shared/roll/loop/.LOCK-<slug>`）。如果 LOCK 里的 PID 已死，下一周期
会自动清理它。但如果进程还活着（如挂起的 tmux 会话），LOCK 就会一直存在，
阻止新周期启动。

**解决：**

```bash
roll loop status          # 查看 LOCK 是否存在及持有者 PID
roll loop attach          # 看看 agent 在 tmux 会话里做什么
# 如果 tmux 会话已死或挂起：
roll loop reset           # 清除 state + LOCK，下一周期重新开始
roll loop now             # 立即触发一个新周期
```

---

## 2. Loop 跑完了但 BACKLOG 没有更新为 Done

**现象：** Agent 正常运行过（能看到 TCR 提交），但故事仍然是
`🔨 In Progress` 或者没有标记为 `✅ Done`。

**原因：** 构建技能在最后阶段（Phase 11）才更新 BACKLOG。如果 agent 会话
在 TCR 提交之后但在 Phase 11 之前中断，或者 CI 门控失败，故事状态会故意
保持不变。Loop 只在 TCR 和 CI 都通过后才标记 Done。

**原理：** 完成后清理阶段会运行两个硬门控：(1) TCR 提交数 > 0，(2) CI
通过（`roll ci --wait`）。任一门控失败都会阻止 Done 状态转换——这是设计
如此，避免假阳性的完成标记。

**解决：**

```bash
roll loop runs            # 查看上一个周期的结果和告警
roll alert                # 查看是否有 CI 或 TCR 告警
# 如果代码确实已完成且测试通过：
$roll-build US-XXX        # 手动重新运行故事，完成 Phase 11
```

---

## 3. Agent 评审打回了自己的 PR（CHANGES_REQUESTED）

**现象：** Loop 开的 PR 显示 AI 评审者标记了 `CHANGES_REQUESTED`，阻塞了
自动合并。

**原因：** AI 代码评审工作流（US-AUTO-035）独立于构建 agent 运行。当评审者
检测到问题时——即使是 loop 自己写的代码——也会请求修改。这是有意为之：
评审 agent 充当独立的质量门控。

**原理：** Loop 对 PR 收件箱进行分类。被人类标记 `CHANGES_REQUESTED` 的 PR
归类为 `blocked_human_request_changes` 并跳过。如果评审来自 AI 工作流，
loop 的下一个周期会尝试处理反馈，或者人可以介入。

**解决：**

```bash
gh pr view <number>                # 阅读评审意见
gh pr review <number> --approve    # 如果反馈有误则覆盖
# 或者让 loop 的下一个周期自动处理
```

---

## 4. PR 合并冲突 / Rebase 失败

**现象：** `gh pr checks` 显示 "This branch has conflicts"，或者
`roll loop runs` 报告了 rebase 失败告警。

**原因：** Loop 在 worktree 中构建期间，另一个提交合入了 `main`，与 PR
产生了冲突。Loop 的 PR 收件箱会尝试 `_loop_pr_rebase_stale`，但当双方
修改了相同行时 rebase 会失败。

**原理：** Rebase 熔断器会追踪每个 PR 的尝试次数——在 24 小时内失败 3 次后
会阻止进一步尝试并写入 ALERT。这防止了结构性冲突导致的无限 rebase 循环。

**解决：**

```bash
gh pr view <number>               # 查看哪些文件冲突
git fetch origin main
git checkout <pr-branch>
git rebase origin/main            # 手动解决冲突
git push --force-with-lease
# PR 将重新进入 CI，绿了自动合并
```

---

## 5. 切换 Agent 后 Loop 行为变了

**现象：** 运行 `roll agent use kimi`（或编辑 `~/.roll/config.yaml`）后，
loop 工作方式不同——更慢、跳过步骤或产生不同的提交模式。

**原因：** 每个 agent（Claude、DeepSeek、Kimi）解读技能提示的能力不同。
Claude 倾向于严格遵循 TCR；其他 agent 可能批量操作更激进或对 AC 的理解
有差异。技能是一样的，但执行效果因模型能力而异。

**原理：** `~/.roll/config.yaml` 中的 `primary_agent` 控制 loop 调用哪个
CLI。后备 agent 仅在主 agent 失败（token 耗尽、网络错误）时启用。切换
主 agent 会改变所有后续周期的默认行为。

**解决：**

```bash
cat ~/.roll/config.yaml            # 确认当前配置的 agent
roll loop runs                     # 对比最近的运行质量
# 切回：
roll agent use claude              # 或直接编辑 ~/.roll/config.yaml
```

---

## 6. 多个项目同时跑 Loop，互相干扰怎么办

**现象：** 两个项目都开启了 `roll loop on`，怀疑它们相互影响（跳过周期、
共享状态或争抢 agent）。

**原因：** 它们不应该互相干扰。每个项目有自己的 LOCK 文件
（`~/.shared/roll/loop/.LOCK-<project-slug>`）、自己的 `state.yaml` 条目
和自己的 launchd plist。Loop 是按项目隔离的。

**原理：** LOCK 文件路径包含一个项目 slug，由绝对目录路径的 basename +
md5 hash 生成。即使两个项目目录名相同但路径不同，也会得到不同的 slug
和不同的锁。

**解决：**

```bash
roll loop status                   # 在每个项目目录中分别运行
# 确认各自显示独立的调度器和 LOCK 路径
ls ~/.shared/roll/loop/.LOCK-*     # 查看所有活跃的锁
# 如果另一个项目的僵死锁存在：
roll loop reset                    # 在受影响的项目中执行
```

---

## 7. `gh` 认证失败 / 没有 PR 写权限

**现象：** Loop 写了关于 `gh` 失败的 ALERT，或者 PR 没有被创建。
`gh auth status` 显示未登录或缺少权限范围。

**原因：** Roll 的 CI 门控和 PR 生命周期依赖 `gh`（GitHub CLI）以 `repo`
scope 认证。如果 token 过期、被撤销或仓库在需要 SSO 授权的组织下，`gh`
调用就会失败。

**原理：** Loop 的 CI 门控（`roll ci --wait`）使用 `gh -R owner/repo`
检查工作流运行。PR 创建步骤使用 `gh pr create`。两者都需要有效 token。
Loop 将缺少 `gh` 二进制视为优雅跳过，但认证错误是阻塞门控的硬失败。

**解决：**

```bash
gh auth status                     # 检查当前认证状态
gh auth login                      # 重新认证
gh auth refresh -s repo,workflow   # 添加缺失的权限范围
# 对于 SSO 保护的组织：
gh auth refresh -h github.com      # 触发 SSO 授权流程
```

---

## 8. 如何暂停 Loop 而不卸载调度

**现象：** 你想临时停止 loop 执行故事（例如代码冻结期间或手动工作时），
但保留 launchd plist 以便轻松恢复。

**原因：** `roll loop off` 会完全移除 launchd plist，需要 `roll loop on`
重新安装。`roll loop pause` 更轻量——它设置一个标记让 loop 在每个周期
开始时立即退出，不做任何工作。

**原理：** Pause 在 `state.yaml` 中写入标记（`status: paused`）。Loop
runner 在获取 LOCK 之前检查此标记。launchd 调度器仍按计划触发，但 runner
在几秒内就退出了。

**解决：**

```bash
roll loop pause                    # 停止执行，保留调度器
roll loop status                   # 确认显示 "paused"
# 准备恢复时：
roll loop resume                   # 清除暂停标记
roll loop now                      # 可选：立即触发一个周期
```

---

## 9. 如何查看 Loop 做了什么（日志 / runs / brief）

**现象：** Loop 在你不在时运行了。你想知道它做了什么、是否成功、改了什么。

**原因：** Loop 每个周期结束后都会写入结构化记录，但根据你需要的信息
有不同的查看入口。

**原理：** 每个周期会在 `~/.shared/roll/loop/runs.jsonl` 追加一条 JSONL
记录，包含故事 ID、TCR 提交数、耗时和结果。`roll-brief` 将这些聚合成
人类可读的摘要。tmux 会话保留完整的 agent 对话，直到下一个周期覆盖它。

**查看方式：**

| 你想知道什么 | 命令 |
|---|---|
| 最近 N 个周期摘要 | `roll loop runs`（默认 10 条） |
| 实时仪表盘 | `roll loop monitor` |
| 实时观看 agent 工作 | `roll loop attach` |
| 人类可读的每日摘要 | `roll brief` |
| 需要关注的告警 | `roll alert` |
| 完整 agent 对话记录 | Attach 到 tmux 会话后上翻 |

---

## 10. 什么时候需要人工介入，什么时候 Loop 会自己恢复

**现象：** 不确定该介入还是等下一个周期。

**原因：** Loop 设计为自动恢复瞬态失败（网络错误、token 耗尽可切换后备
agent），但在遇到需要人类判断的结构性问题时会故意停下。

**原理：** 失败处理有三层：(1) 网络错误用指数退避重试，(2) 主 agent
失败切换到后备 agent，(3) 其他情况暂停 + 写 ALERT。

**自动恢复（无需人工介入）：**
- 网络超时 → 退避重试（2s、4s、8s、16s）
- 主 agent token 耗尽 → 切换到后备 agent
- 崩溃进程留下的僵死 LOCK → 下一周期自动清理
- 崩溃 loop 留下的孤儿 `🔨 In Progress` → 下一周期回退为 `📋 Todo`

**需要人工介入：**
- 主 agent 和后备 agent 都失败 → 修复后 `roll loop resume`
- CI 持续红 → 修复失败的测试/构建，然后 `roll loop now`
- PR 合并冲突 → 手动解决，push
- `gh` 认证过期 → `gh auth login`
- 故事反复回退（每次 TCR 计数 = 0）→ 故事规格可能不清晰；重写
  `.roll/features/` 中的 AC 或通过 `$roll-build` 手动执行
