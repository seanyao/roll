#!/usr/bin/env bash
# Roll i18n catalog — update command (US-I18N-002).

_i18n_set en update.version_mismatch "Version mismatch: installed %s, expected %s — CDN propagation lag, clearing cache and retrying..."
_i18n_set zh update.version_mismatch "版本不一致（已安装 %s，期望 %s），疑似 CDN 未同步，清理缓存后重试..."
_i18n_set en update.still_mismatch "Still on %s after retry — registry may not have propagated yet, try again in a minute."
_i18n_set zh update.still_mismatch "重试后仍为 %s，注册表可能尚未同步，请稍后再试。"
_i18n_set en update.current_version "Current version: roll v%s"
_i18n_set zh update.current_version "当前版本: roll v%s"

_i18n_set en update.upgrading_via_npm "Upgrading via npm..."
_i18n_set zh update.upgrading_via_npm "正在通过 npm 升级..."
_i18n_set en update.npm_install_failed_check_network_proxy "npm install failed. Check network/proxy and try again.  npm"
_i18n_set zh update.npm_install_failed_check_network_proxy "安装失败，请检查网络/代理后重试。"
_i18n_set en update.re_syncing_to_ai_tools "Re-syncing to AI tools..."
_i18n_set zh update.re_syncing_to_ai_tools "正在重新同步到 AI 工具..."
