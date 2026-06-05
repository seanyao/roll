# Roll — 测试隔离（`roll test`）

`roll test` 通过 `.roll/local.yaml` 中选择的**隔离适配器**运行项目测试套件：

```yaml
test_isolation:
  type: none   # 默认
```

## `type: none`（唯一内置适配器）

宿主直接执行——与 `npm test` 同一个 shell。`roll test` 转发为
`npm test -- <参数>`，默认参数是 `--affected`：

```bash
roll test                  # npm test -- --affected
roll test -- tests/        # 显式全量
roll test -- --tier=fast   # 任意参数透传给 npm test
```

v3 测试套件构造性 hermetic——伪造 `$HOME`、PATH shim 假二进制、`file://`
远端、网络黑洞——宿主执行不会碰你的 launchd、共享 roll 状态或真实网络。

## 路由：`--where`

只报告测试将在哪里运行，不实际执行：

| 配置的 type | `--where` 输出 |
|---|---|
| `none`（或无配置） | `host` |
| 其他任意值 | `unknown:<type>` |

`<type>:<detail>` 的 token 形状是**扩展位**：未来若有容器适配器，会以
`docker:running` 这类同形 token 输出。

## 未知类型大声失败

`test_isolation.type` 配成 `none` 以外的任何值，`roll test` 都会非零退出并
明确报错、列出支持的类型。**绝不静默回落宿主执行**——隔离配置错了应该拦住
你，而不是悄悄改变测试运行的位置。

## `--reset`

重置隔离环境。`type: none` 没有可重置的东西（宿主执行无状态）：打印提示并
以 0 退出。reset 期间持有 `.roll/.iso-reset.lock` 锁文件；并发的 `roll test`
调用会快速失败并给出清晰报错。
