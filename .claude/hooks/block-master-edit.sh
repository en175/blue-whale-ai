#!/usr/bin/env bash
# Claude Code PreToolUse hook — 拦截 AI 在 master 分支直接 Edit/Write 文件
#
# 拦截对象：
#   - Edit 工具（agent 编辑文件时触发）
#   - Write 工具（agent 创建文件时触发）
#   当 Edit/Write 目标文件所属工作树的 git 分支为 master 时拦截。
#
# 放行：
#   - 目标文件在非 master 分支的工作树（工单分支 worktree / detached HEAD）
#   - 目标文件不在任何 git 工作树内（仓库外 dotfile，如 ~/.codex/config.toml）
#   - 非 Edit/Write 工具
#
# 为什么拦：Agent 不得在本地 master 直接修改文件。
#   所有改动必须在工单分支 worktree 中完成，走分支→PR→合并流程。
#   决策见 docs/adr/0010-local-master-is-user-integration-zone.md
#
# 分支判定按 file_path 所属工作树（git -C），不看 cwd：
#   主 checkout session（cwd=master）编辑 worktree 工单分支文件时，
#   按 file_path 解析得到工单分支 → 放行，不依赖「worktree 必在主 toplevel 外」的布局假设。
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

# 取 Edit/Write 目标文件路径
FILE_PATH=$(printf '%s' "$INPUT" | python3 "$PRETOOL" value file_path 2>/dev/null || true)

# 按目标文件所属工作树解析分支与 toplevel（不看 cwd，去 worktree 路径布局假设）
#   dirname("")="."：file_path 缺失时退化为 cwd 分支判定（保留旧行为）
FILE_DIR="$(dirname "$FILE_PATH")"
BRANCH=$(git -C "$FILE_DIR" symbolic-ref --short HEAD 2>/dev/null || echo "")
TOPLEVEL=$(git -C "$FILE_DIR" rev-parse --show-toplevel 2>/dev/null || echo "")

# file_path 父目录尚不存在（如 Write 全新子目录文件）→ git -C 失败、BRANCH/TOPLEVEL 空。
# 向上遍历到最近存在的祖先目录重试，否则误判「仓库外」放行，master 内新文件漏拦。
if [ -z "$BRANCH" ] && [ -z "$TOPLEVEL" ] && [ -n "$FILE_DIR" ] && [ "$FILE_DIR" != "/" ]; then
  ancestor="$FILE_DIR"
  while [ "$ancestor" != "/" ] && [ ! -d "$ancestor" ]; do
    ancestor="$(dirname "$ancestor")"
  done
  if [ "$ancestor" != "/" ] && [ -d "$ancestor" ] && [ "$ancestor" != "$FILE_DIR" ]; then
    BRANCH=$(git -C "$ancestor" symbolic-ref --short HEAD 2>/dev/null || echo "")
    TOPLEVEL=$(git -C "$ancestor" rev-parse --show-toplevel 2>/dev/null || echo "")
  fi
fi

# 目标文件不在任何 git 工作树内（仓库外）→ 放行
if [ -z "$TOPLEVEL" ]; then
  exit 0
fi

# 非 master 分支（工单分支 worktree / detached HEAD）→ 放行
if [ "$BRANCH" != "master" ]; then
  exit 0
fi

# master 分支 + 仓库内 Edit/Write → 硬拦
cat >&2 <<EOF
BLOCKED: 禁止在 master 分支直接 Edit/Write 文件。
  工具: $TOOL_NAME

Agent 不得在本地 master 直接修改文件（最高红线）。
- 请使用 task worktree 隔离工作：scripts/start-task-worktree.sh <branch> <dir>
- 在 worktree 的工单分支上完成开发后，走 PR 流程合并
- 详见 CLAUDE.md「Task Worktree」与 docs/adr/0010-local-master-is-user-integration-zone.md
EOF
exit 2
