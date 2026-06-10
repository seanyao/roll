# Roll — 安装与更新

## 安装

### curl（推荐）

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash
```

仅需 bash 3.2+、curl、tar —— macOS 和 Linux 预装即可，无需 Node.js。

钉版本：

```bash
curl -fsSL https://seanyao.github.io/roll/install | ROLL_VERSION=v3.610.1 bash
```

### npm

```bash
npm install -g @seanyao/roll
```

需要 Node.js 16+。

无论哪种方式安装，完成后运行 setup 将约定和技能同步到你的 AI 工具：

```bash
roll setup
```

## 验证

```bash
roll --version   # 显示已安装版本
roll status      # 显示路径和约定状态
```

## 更新

```bash
roll update
```

Roll 自动检测安装方式并对应处理：

| 安装方式 | `roll update` 的行为 |
|---|---|
| curl（默认） | 重新下载最新 tarball、原子替换，然后 `roll sync` |
| npm | `npm update -g @seanyao/roll`，然后 `roll sync` |
| git clone（贡献者） | 在包目录执行 `git pull`，然后 `roll sync` |

## 自动版本提示

每次 `roll` 命令结束后，后台静默查询 GitHub releases API（每 24 小时最多一次，缓存在 `~/.roll/.update-check`）。若有新版本，下一条命令结束时显示一行提示。检查完全异步，不影响命令速度。

## 卸载

### curl

```bash
rm -rf ~/.local/share/roll ~/.local/bin/roll
```

### npm

```bash
npm uninstall -g @seanyao/roll
```

不再需要时删除状态文件：

```bash
rm -rf ~/.roll ~/.shared/roll
```

## 另见

- [overview.md](overview.md) — roll 是什么
- [project-setup.md](project-setup.md) — 新项目的 `roll init`
- [configuration.md](configuration.md) — 环境变量
- [SECURITY.md](../../SECURITY.md) — curl|bash 信任边界与版本钉住
