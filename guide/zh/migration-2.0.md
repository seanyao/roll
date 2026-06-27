# 迁移到 Roll 2.0

> **TL;DR:** 跑 `npx @seanyao/roll@2 migrate --dry-run` 预览，确认后 `npx @seanyao/roll@2 migrate`。单个原子 commit。完事。

Roll 2.0 把所有"过程"产物（BACKLOG、PROPOSALS、feature 规格、briefs、dream 日志、设计文档）从项目根级和 `docs/` 搬进统一的 `.roll/` 目录。用户可见文档（`docs/guide/`、`docs/site/`）上移到项目根级。

这是一次性破坏性变更。文件的 git 历史会保留——Roll 用 `git mv`。

## 开工前

- **想留后路就 pin 老版本**：`npm install -g @seanyao/roll@1`。npm 历史版本永远在，随时可以回滚。
- **工作区必须干净**：`npx @seanyao/roll@2 migrate` 不接受未提交改动，先 commit 或 stash。
- **建议把整页读完再开始。**

## 迁移内容

| 老路径 | 新路径 | 说明 |
|--------|--------|------|
| `BACKLOG.md`（根级） | `.roll/backlog.md` | 主项目工作流文件 |
| `PROPOSALS.md`（根级） | `.roll/proposals.md` | 待审批提案 |
| `docs/features.md` | `.roll/features.md` | 功能索引 |
| `docs/features/` | `.roll/features/` | 各 feature 详细规格 |
| `docs/briefs/` | `.roll/briefs/` | `roll-brief` 自动产出 |
| `docs/dream/` | `.roll/dream/` | `roll-.dream` 自动产出 |
| `docs/design/` | `.roll/design/` | 设计探索文档 |
| `docs/domain/` | `.roll/domain/` | DDD 模型 |
| `docs/practices/loop-autorun-verification.md` | `.roll/features/loop-engine/loop-autorun-verification.md` | 执行验证记录 |
| `docs/practices/engineering-common-sense.md` | `guide/en/practices/engineering-common-sense.md` | 工程规范（对外） |
| `docs/intro/` | `site/slides/` | 宣传 HTML 页面 |
| `docs/guide/en/` | `guide/en/` | 用户文档（英文） |
| `docs/guide/zh/` | `guide/zh/` | 用户文档（中文） |
| `docs/site/` | `site/` | 网站源码 |

迁移完成后 `docs/` 目录消失。如果你的 `docs/` 里有自己的文件不在上述列表中，`npx @seanyao/roll@2 migrate` 不会动它们。

## 为什么是两个目的地

Roll 2.0 强制做了架构分离：

- **`.roll/`** = 过程产物，给*我们自己*（维护者）。backlog、dream 日志、设计笔记。
- **根级** = 产品产物，给*别人*。README、guide、site、源码。

`.roll/` 要不要 gitignore 是你的选择（见下方[隐私](#隐私)）。是否 track 跟方向性分类是正交的。

## 三态幂等

`npx @seanyao/roll@2 migrate` 是幂等的，遇到危险就拒绝执行：

| 状态 | 行为 |
|------|------|
| 仅老路径 | 执行迁移（单 commit） |
| 仅 `.roll/`，无老路径 | no-op，输出"已迁移" |
| 两者并存 | **拒绝** —— 列冲突，要求手动解决 |
| 都没有 | no-op |

如果中途停了，部分状态会落入"两者并存"，下次运行会给清晰的冲突报告。

## 分步操作

### 1. 升级到 2.0

```bash
npm install -g @seanyao/roll@2
npx @seanyao/roll@2 version    # 应该显示 2.x
```

### 2. 预览迁移

```bash
cd your-project
npx @seanyao/roll@2 migrate --dry-run
```

打印每条迁移的对照表，文件不会动。

### 3. 执行

```bash
npx @seanyao/roll@2 migrate
```

会在当前分支看到一个 commit：

```
Migrate project layout to .roll/ structure

Paths migrated: 14
```

`git log --follow .roll/backlog.md` 应该还能看到从 `BACKLOG.md` 一路下来的完整历史。

### 4. 验证

```bash
roll status          # 应该正常跑
ls -la .roll/        # 看新结构
git log -1           # 迁移 commit
```

发现异常 → `git revert HEAD` 撤回。

## 隐私

默认情况下 `.roll/` 是**被 track 的**（仓库可见者都能看）。如果想把过程产物私有：

```bash
echo ".roll/" >> .gitignore
git add .gitignore && git commit -m "chore: gitignore .roll/"
```

如果已经被 commit 进 git，再取消 tracking：

```bash
git rm -r --cached .roll/
git commit -m "chore: stop tracking .roll/"
```

Roll 自己用的是另一种方式——**独立 private repo**（`seanyao/roll-meta`），不靠 gitignore 隔离。只有需要彻底分开访问权限时才需要这种模式。

## 回滚

需要撤销时：

```bash
git revert HEAD                          # 撤回迁移 commit
npm install -g @seanyao/roll@1           # 重装老版本
```

文件历史在两种情况下都保留（`git mv` 不丢 blame）。

## 其他工具的影响

迁移后：

- `roll status`、`roll backlog`、`roll loop`、`roll brief` —— 自动用新路径
- `$roll-build`、`$roll-fix`、`$roll-design` 等 skill —— 已更新，重跑 `roll setup` 刷新
- 外部脚本引用了 `BACKLOG.md` 等 —— **需要你手动改**

## FAQ

**Q: 能不能分次迁移？**
不能。迁移是原子的——单 commit。"并存"状态会刻意报错，所以不会陷入半迁移状态。

**Q: CI / GitHub Actions 里还引用老路径怎么办？**
跟迁移在同一时间窗口内更新。迁移后 CI 红，99% 是 workflow 文件里的老路径引用没改。

**Q: 我们团队多个项目都用 Roll，要不要全部迁移？**
独立处理。Roll 2.0 遇到老结构会拒绝运行，提示 `npx @seanyao/roll@2 migrate`，不会静默出错。

**Q: 能不能不迁移，一直用 Roll 1.x？**
可以。npm 历史版本永远在。但新特性（已有代码库接入、agent 发现、plan 驱动 init）就用不到。

**Q: 迁移后 `npm test` 大量失败，是预期吗？**
不是。迁移不应该改变测试结果。如果失败，跑 `git diff HEAD~1` 看哪些文件移动了，找 workflow / test fixture 里漏改的路径。提 issue 附 diff。
