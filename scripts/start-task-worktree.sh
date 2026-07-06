#!/usr/bin/env bash
# Create an isolated task worktree from origin/master.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_PARENT="$(cd "$ROOT/.." && pwd)"
if [ "$(basename "$ROOT_PARENT")" = "blue-whale-worktrees" ]; then
  WORKTREE_BASE="$ROOT_PARENT"
else
  WORKTREE_BASE="$ROOT_PARENT/blue-whale-worktrees"
fi

fail() {
  echo "❌ start-task-worktree: $*" >&2
  exit 1
}

usage() {
  echo "用法: scripts/start-task-worktree.sh <branch-name> <worktree-dir-name>" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage

branch="$1"
dir_name="$2"

case "$ROOT" in
  "$WORKTREE_BASE"/*)
    fail "请在主 checkout 执行，不要在任务 worktree 内继续创建任务 worktree：$ROOT"
    ;;
esac

case "$branch" in
  feature/*|fix/*|hotfix/*|docs/*|chore/*) ;;
  *) fail "分支名必须使用白名单前缀：feature/ fix/ hotfix/ docs/ chore/" ;;
esac

case "$dir_name" in
  ""|"."|".."|/*|*/*)
    fail "worktree 目录名必须是普通目录名，不能为空、绝对路径或包含 /"
    ;;
esac

target="$WORKTREE_BASE/$dir_name"

if [ -e "$target" ]; then
  fail "目标 worktree 已存在：$target"
fi

"$ROOT/scripts/sync-master.sh"

mkdir -p "$WORKTREE_BASE"
git -C "$ROOT" worktree add "$target" -b "$branch" origin/master

cat <<EOF
✅ 已创建任务 worktree：
  $target

下一步：
  cd "$target"
  必须先为该 worktree 建立 Codebase Memory MCP 索引，并确认 index_status=ready。
  如本任务需要 Graphify，再运行：
    scripts/ensure-graphify-worktree.sh
EOF
