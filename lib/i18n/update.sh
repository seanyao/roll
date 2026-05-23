#!/usr/bin/env bash
# Roll i18n catalog — update command (US-I18N-002).

_i18n_set en update.version_mismatch "Version mismatch: installed %s, expected %s — CDN propagation lag, clearing cache and retrying..."
_i18n_set zh update.version_mismatch "版本不一致（已安装 %s，期望 %s），疑似 CDN 未同步，清理缓存后重试..."
_i18n_set en update.still_mismatch "Still on %s after retry — registry may not have propagated yet, try again in a minute."
_i18n_set zh update.still_mismatch "重试后仍为 %s，注册表可能尚未同步，请稍后再试。"
_i18n_set en update.current_version "Current version: roll v%s"
_i18n_set zh update.current_version "当前版本: roll v%s"
