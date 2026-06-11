/**
 * v3-native message catalog. The frozen v2 catalog (catalog.generated.json) is
 * mechanically derived from the bash oracle and must not be hand-edited; strings
 * for behaviour that is new in v3 live here instead (see catalog.ts header).
 *
 * `briefv3.*` — the few labels the live `roll brief` digest needs beyond the
 * reused v2 `brief.*` keys (US-PORT-002). Both en and zh are always present so
 * the single-language contract (output follows ROLL_LANG, never mixes) holds.
 */
import type { Catalog } from "./index.js";

export const v3Catalog: Catalog = {
  "briefv3.full_hint": {
    en: "Run with --full for the complete lists",
    zh: "加 --full 查看完整列表",
  },
  "briefv3.all_clear": {
    en: "All clear — nothing needs your call",
    zh: "一切就绪 — 无需您拍板",
  },
  "briefv3.queue_breakdown": {
    en: "%s fixes · %s stories · %s other",
    zh: "%s 缺陷 · %s 故事 · %s 其他",
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
    en: "Usage: roll release [--json]",
    zh: "用法：roll release [--json]",
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
    en: "nothing under Unreleased — run: roll changelog generate --write",
    zh: "未发布区为空 — 请先运行：roll changelog generate --write",
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
    en: "Preview locally with: roll consistency check",
    zh: "本地预检：roll consistency check",
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
};
