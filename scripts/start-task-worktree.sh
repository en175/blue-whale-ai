#!/usr/bin/env bash
# Create an isolated task worktree from origin/master.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/worktree-paths.sh
source "$ROOT/scripts/lib/worktree-paths.sh"
WORKTREE_BASE="$(worktree_paths_resolve_base "$ROOT")"

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

# 1. 前缀白名单
case "$branch" in
  feature/*|fix/*|hotfix/*|docs/*|chore/*) ;;
  *) fail "分支名必须使用白名单前缀：feature/ fix/ hotfix/ docs/ chore/" ;;
esac

# 2. 前缀后段不能为空（拒绝 feature/）
_suffix="${branch#*/}"
if [ -z "$_suffix" ]; then
  fail "分支名前缀后不能为空。格式：<prefix>/<ticket-id>-<summary>，如 feature/IJZ5WA-add-canvas-node"
fi

# 3. 拒绝含空格
case "$branch" in
  *\ *) fail "分支名不允许含空格：$branch" ;;
esac

# 4. 拒绝含下划线（项目约定用连字符）
case "$branch" in
  *_*) fail "分支名不允许含下划线，请用连字符：$branch" ;;
esac

# 5. 拒绝非 ASCII 字符
if printf '%s' "$branch" | LC_ALL=C grep -q '[^ -~]'; then
  fail "分支名不允许含非 ASCII 字符（如中文）：$branch"
fi

case "$dir_name" in
  ""|"."|".."|/*|*/*)
    fail "worktree 目录名必须是普通目录名，不能为空、绝对路径或包含 /"
    ;;
esac

target="$WORKTREE_BASE/$dir_name"

if [ -e "$target" ]; then
  fail "目标 worktree 已存在：$target"
fi

git -C "$ROOT" fetch origin master

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
