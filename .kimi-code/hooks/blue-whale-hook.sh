#!/usr/bin/env bash
# Kimi CLI 生命周期 shim —— 共享 Claude hook 脚本的用户级路由器。
#
# 背景：Kimi CLI 只从用户级 ~/.kimi-code/config.toml 加载 hooks（实测项目级
# .kimi-code/local.toml 不加载 hooks），因此配置片段中的规则对本机所有 kimi
# 会话全局触发。本 shim 把全局触发收敛为仅本项目生效：
#   1. opt-in 标记：会话项目根入库 .kimi-code/hooks.toml 才启用，其它项目静默放行；
#   2. Gate 存在性：.claude/hooks/<gate> 缺失时静默放行。
# .claude/hooks 仍是策略权威（与 Claude Code / Codex / ZCode 同一实现），本 shim
# 只做路由、不含策略逻辑；载荷协议与 Claude 同构（stdin JSON，exit 0 放行 /
# stderr + exit 2 阻断），stdin 原样透传。
#
# 与 codex wrapper 的差异：codex wrapper 只在项目内触发，配置错误可 fail-closed；
# 本 shim 全局触发，任何异常都必须 fail-open，不得影响其它项目。
#
# 安装：scripts/install-kimi-hooks.sh 把本文件同步到 ~/.kimi-code/hooks/，并把
# .kimi-code/hooks.toml 的 [[hooks]] 片段写入 ~/.kimi-code/config.toml managed block。
set -u

# 参数异常静默放行：hooks 全局挂载，配置错误不得波及其它项目。
if [ "$#" -ne 1 ]; then
  exit 0
fi

script_name="$1"
case "$script_name" in
  */*|""|.*)
    exit 0
    ;;
esac

# hook 进程 cwd = kimi 会话项目目录；worktree 会话解析到 worktree 根。
root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
  exit 0
fi

# opt-in 标记：仅本项目（及其 task worktree）入库该文件，其它项目不启用。
if [ ! -f "$root/.kimi-code/hooks.toml" ]; then
  exit 0
fi

script="$root/.claude/hooks/$script_name"
if [ ! -f "$script" ]; then
  exit 0
fi

exec bash "$script"
