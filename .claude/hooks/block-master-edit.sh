#!/usr/bin/env bash
# Claude Code PreToolUse hook — 拦截 AI 在 master 分支直接 Edit/Write 文件
#
# 拦截对象：
#   - Edit 工具（agent 编辑文件时触发）
#   - Write 工具（agent 创建文件时触发）
#   当当前 git 分支为 master 时一律拦截。
#
# 放行：
#   - 非 master 分支（含 detached HEAD / worktree 工单分支）
#   - 非 Edit/Write 工具
#
# 为什么拦：Agent 不得在本地 master 直接修改文件。
#   所有改动必须在工单分支 worktree 中完成，走分支→PR→合并流程。
#   决策见 docs/adr/0010-local-master-is-user-integration-zone.md
#
# 退出码 2 = 阻断 Claude 执行该工具调用。

INPUT=$(cat)
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
PRETOOL="$HOOK_DIR/lib/pretool.py"
TOOL_NAME=$(printf '%s' "$INPUT" | python3 "$PRETOOL" value tool_name 2>/dev/null || true)

# 只处理 Edit / Write 工具
case "$TOOL_NAME" in
  Edit|Write) ;;
  *) exit 0 ;;
esac

# 获取当前分支（symbolic-ref 在 detached HEAD 时返回空，比 rev-parse --abbrev-ref 更安全）
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")

# 非 master → 放行
if [ "$BRANCH" != "master" ]; then
  exit 0
fi

# 仓库外文件不触发 master 红线（如 ~/.codex/config.toml 等 dotfile）
FILE_PATH=$(printf '%s' "$INPUT" | python3 "$PRETOOL" value file_path 2>/dev/null || true)
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [ -n "$FILE_PATH" ] && [ -n "$TOPLEVEL" ]; then
  case "$FILE_PATH" in
    "$TOPLEVEL"/*) ;;  # 仓库内 → 继续拦
    *) exit 0 ;;       # 仓库外 → 放行
  esac
fi
# FILE_PATH/TOPLEVEL 为空 → fail-closed，沿用下方拦截

# 在 master 上执行 Edit/Write → 硬拦
cat >&2 <<EOF
BLOCKED: 禁止在 master 分支直接 Edit/Write 文件。
  工具: $TOOL_NAME

Agent 不得在本地 master 直接修改文件（最高红线）。
- 请使用 task worktree 隔离工作：scripts/start-task-worktree.sh <branch> <dir>
- 在 worktree 的工单分支上完成开发后，走 PR 流程合并
- 详见 CLAUDE.md「Task Worktree」与 docs/adr/0010-local-master-is-user-integration-zone.md
EOF
exit 2
