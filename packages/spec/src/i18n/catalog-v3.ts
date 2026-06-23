/**
 * v3-native message catalog. The frozen v2 catalog (catalog.generated.json) is
 * mechanically derived from the bash oracle and must not be hand-edited; strings
 * for behaviour that is new in v3 live here instead (see catalog.ts header).
 *
 * Both en and zh are always present so the single-language contract (output
 * follows ROLL_LANG, never mixes) holds.
 */
import type { Catalog } from "./index.js";

export const v3Catalog: Catalog = {
  // `agent.*` — v3-native agent roster compatibility messages (US-AGENT-045).
  "agent.use_removed_agent": {
    en: "'%s' is no longer supported. Use one of: claude, kimi, codex, pi, agy, reasonix",
    zh: "'%s' 已不再支持。请使用：claude, kimi, codex, pi, agy, reasonix",
  },

  // `ideav3.*` — the live `roll idea` capture command (US-PORT-003). Both en and
  // zh are always present so the single-language contract (output follows
  // ROLL_LANG, never mixes) holds.
  "ideav3.recorded": {
    en: "Recorded as %s",
    zh: "已记录为 %s",
  },
  "ideav3.type": {
    en: "Type",
    zh: "类型",
  },
  "ideav3.section": {
    en: "Section",
    zh: "分区",
  },
  "ideav3.text": {
    en: "Text",
    zh: "描述",
  },
  "ideav3.kind_bug": {
    en: "bug",
    zh: "缺陷",
  },
  "ideav3.kind_idea": {
    en: "idea",
    zh: "想法",
  },
  "ideav3.usage": {
    en: "Usage: roll idea <description>",
    zh: "用法：roll idea <描述>",
  },
  "ideav3.empty": {
    en: "Provide a short description to capture",
    zh: "请提供一句简短描述以记录",
  },
  "ideav3.lint_failed": {
    en: "Description fails backlog lint (%s) — not recorded",
    zh: "描述未过待办校验（%s）— 未记录",
  },
  "ideav3.lint_hint": {
    en: "Shorten to one plain sentence: ≤120 chars, no code, paths, filenames, or function names",
    zh: "精简为一句人话：≤120 字，不含代码、路径、文件名或函数名",
  },
  "ideav3.conflict": {
    en: "Backlog changed on disk — re-run to capture",
    zh: "待办文件已变更 — 请重试以记录",
  },

  // `releasev3.*` — the read-only release-guidance command (US-PORT-004). `roll
  // release` computes the next calver version, surfaces changelog readiness, and
  // prints the PR/tag flow; it NEVER pushes a tag or publishes (release is always
  // a human decision). Both en and zh present so the single-language contract
  // (output follows ROLL_LANG, never mixes) holds.
  "releasev3.usage": {
    en: "Usage: roll release [--dry-run|--yes|--showcase|--json]\n  The ONE release flow: bump → changelog fold → package gate → commit-push → consistency gate → PR → auto-merge → tag push.\n  Drives the merge itself via GitHub auto-merge (needs \"Allow auto-merge\" on the repo); prints progress while it waits and nudges CI if it stalls.\n  The consistency gate runs BEFORE the PR — a drifting release aborts before anything merges. Stops at the tag push; npm publish stays yours. No subcommands remain.\n  --showcase  After a successful release, run the golden-path showcase (real models; recommended, non-blocking — never fails the release).",
    zh: "用法：roll release [--dry-run|--yes|--showcase|--json]\n  唯一发版流：版本号 → 折叠 changelog → 包闸 → 提交推送 → 一致性闸 → PR → 自动合并 → 推 tag。\n  自驱合并（GitHub auto-merge，需仓库开启 “Allow auto-merge”）；等待期间打印进度，CI 卡住时自动推一下。\n  一致性闸在开 PR 之前先跑——漂移的发版会在任何东西合并前中止。止步于推 tag；npm publish 仍由你执行。不再有子命令。\n  --showcase  发版成功后跑一次黄金路径 showcase（真模型；建议、非硬卡——绝不让发版失败）。",
  },
  "releasev3.title": {
    en: "Release plan",
    zh: "发版计划",
  },
  "releasev3.current": {
    en: "Current version",
    zh: "当前版本",
  },
  "releasev3.next": {
    en: "Suggested next",
    zh: "建议下一版",
  },
  "releasev3.tag": {
    en: "Tag",
    zh: "标签",
  },
  "releasev3.changelog": {
    en: "Changelog",
    zh: "更新日志",
  },
  "releasev3.changelog_ready": {
    en: "Unreleased section has content",
    zh: "未发布区有内容",
  },
  "releasev3.changelog_empty": {
    en: "nothing under Unreleased — add entries to CHANGELOG.md before releasing",
    zh: "未发布区为空 — 发版前先把条目写进 CHANGELOG.md",
  },
  "releasev3.flow_title": {
    en: "Release flow (run these yourself — a release is always a human decision):",
    zh: "发版流程（请亲手执行 — 发版始终由人拍板）：",
  },
  "releasev3.step_bump": {
    en: "Bump package.json version to %s",
    zh: "把 package.json 版本号改为 %s",
  },
  "releasev3.step_commit": {
    en: "Commit the bump and open a PR to main",
    zh: "提交版本号变更并向 main 开 PR",
  },
  "releasev3.step_merge": {
    en: "After CI is green and the PR is merged, pull main",
    zh: "CI 通过且 PR 合并后，拉取 main",
  },
  "releasev3.step_tag": {
    en: "Tag %s and push the tag — this triggers the release workflow",
    zh: "打标签 %s 并推送 — 触发发版流水线",
  },
  "releasev3.gate_note": {
    en: "The consistency gate runs on tag push and aborts the release on any gap.",
    zh: "一致性闸在推送标签时运行，任一维度对不上即中止发版。",
  },
  "releasev3.gate_preview": {
    en: "Preview locally with: roll release --dry-run",
    zh: "本地预检：roll release --dry-run",
  },
  "releasev3.no_pkg": {
    en: "package.json version not found — run from the repo root",
    zh: "未找到 package.json 版本号 — 请在仓库根目录运行",
  },

  // `loopv3.*` — the retirement notices for the v2 tmux-popup commands
  // `loop monitor` / `loop attach` (US-PORT-007). The v3 self-contained runner
  // already streams every cycle into the tmux session roll-loop-<slug>, so the
  // old auto-refresh popup (monitor) has no object, and attaching is just a
  // plain `tmux attach`. Both en and zh present (single-language contract).
  "loopv3.monitor_retired": {
    en: "roll loop monitor is retired. Use `roll loop status` for a snapshot, or watch the live cycle: tmux attach -t roll-loop-%s",
    zh: "roll loop monitor 已退役。用 `roll loop status` 看快照，或观察实时周期：tmux attach -t roll-loop-%s",
  },
  "loopv3.attach_retired": {
    en: "roll loop attach is retired. Attach to the live cycle directly: tmux attach -t roll-loop-%s",
    zh: "roll loop attach 已退役。直接观察实时周期：tmux attach -t roll-loop-%s",
  },
  // `loop branches` (US-PORT-022): pure user-introspection (listed loop-branch
  // merge status); no internal caller, so it retires rather than port. The one
  // line that reproduced it is offered for anyone who still wants the view.
  "loopv3.branches_retired": {
    en: "roll loop branches is retired. List loop branches directly: git ls-remote --heads origin 'loop/*'",
    zh: "roll loop branches 已退役。直接列出 loop 分支：git ls-remote --heads origin 'loop/*'",
  },

  // FIX-232: doctor proxy-environment check
  "doctor.proxy_env_warning": {
    en: "Stale proxy environment variables",
    zh: "残留的代理环境变量",
  },
  "doctor.proxy_env_hint": {
    en: "Proxy variables are set but unreachable — a closed proxy app may have poisoned launchd. Clean up:",
    zh: "代理变量已设置但目标不可达 — 已关闭的代理软件可能毒化了 launchd。请清理：",
  },

  // FIX-232 AC2: loop egress pre-check messages
  "loop.egress_blocked": {
    en: "egress blocked (proxy?): network pre-check failed — cycle %s refused to start",
    zh: "出网阻断（疑似代理？）：网络预检失败 — 周期 %s 拒绝启动",
  },

  // FIX-298: shared network guard (first-checkpoint connectivity + active recovery).
  // Lines are emitted one per locale (the single-language contract) — EN and ZH
  // are kept on separate lines by the caller, never inline on one line.
  "net.recovering": {
    en: "network unreachable — running the configured proxy-enable command, then re-checking…",
    zh: "网络不可达 — 正在执行已配置的代理启用命令，然后重新检测……",
  },
  "net.recovered": {
    en: "network restored after the proxy-enable command — continuing.",
    zh: "执行代理启用命令后网络已恢复 — 继续。",
  },
  // %s is the command name (e.g. `roll loop go`). Halt message: clear, actionable.
  "net.blocked_no_hook": {
    en: "%s needs the network, but it is unreachable. No proxy-enable command is configured, so roll will not guess one. Add `loop_safety.proxy_enable_cmd: <your proxy-on command>` to .roll/policy.yaml (e.g. your VPN/proxy toggle), check your connection, then retry.",
    zh: "%s 需要网络，但当前不可达。未配置代理启用命令，roll 不会自行猜测。请在 .roll/policy.yaml 中加入 `loop_safety.proxy_enable_cmd: <你的开代理命令>`（例如你的 VPN/代理开关），检查网络后重试。",
  },
  "net.blocked_after_hook": {
    en: "%s needs the network, but it is STILL unreachable after running the configured proxy-enable command. Check that the command actually turns on connectivity, verify your network, then retry.",
    zh: "%s 需要网络，但执行已配置的代理启用命令后仍不可达。请确认该命令确实能打开网络、检查连接后重试。",
  },

  // FIX-394 — chromium headless browser messages
  "fix394.chromium_unavailable": {
    en: "headless Chromium unavailable",
    zh: "无头 Chromium 不可用",
  },
  "fix394.chromium_offline_hint": {
    en: "offline or network error — chromium download may have failed",
    zh: "离线或网络错误 — Chromium 下载可能失败",
  },
  "fix394.web_evidence_skipped": {
    en: "web evidence skipped",
    zh: "网页证据已跳过",
  },
  "fix394.chromium_fix_hint": {
    en: "run `roll init` or `npx playwright install chromium` after connecting to the network to enable web screenshots",
    zh: "联网后运行 `roll init` 或 `npx playwright install chromium` 以启用网页截图",
  },
  "fix394.browser_tool_degraded": {
    en: "browser tool unavailable — headless Chromium not installed",
    zh: "浏览器工具不可用 — 无头 Chromium 未安装",
  },
};
