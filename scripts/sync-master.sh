#!/usr/bin/env bash
# Fast-forward a clean local master to origin/master when the user wants to refresh it.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/worktree-paths.sh
source "$ROOT/scripts/lib/worktree-paths.sh"
WORKTREE_BASE="$(worktree_paths_resolve_base "$ROOT")"

fail() {
  echo "❌ sync-master: $*" >&2
  exit 1
}

case "$ROOT" in
  "$WORKTREE_BASE"/*)
    fail "请在主 checkout 执行，不要在任务 worktree 内同步 master：$ROOT"
    ;;
esac

cd "$ROOT"

current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
if [ "$current_branch" != "master" ]; then
  fail "当前分支是 ${current_branch:-detached HEAD}，请先回到主 checkout 的 master。"
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "❌ sync-master: 本地 master 工作区不干净，已停止同步。" >&2
  echo "" >&2
  git status --short >&2
  echo "" >&2
  echo "请先确认这些改动归属；本脚本只在用户本地集成区干净时做 fast-forward 同步。" >&2
  exit 1
fi

git fetch origin

origin_master="$(git rev-parse origin/master)"
local_master="$(git rev-parse master)"
merge_base="$(git merge-base master origin/master)"

if [ "$local_master" = "$origin_master" ]; then
  echo "✅ master 已与 origin/master 同步。"
  exit 0
fi

if [ "$merge_base" = "$local_master" ]; then
  git merge --ff-only origin/master
  echo "✅ master 已 fast-forward 到 origin/master。"
  exit 0
fi

if [ "$merge_base" = "$origin_master" ]; then
  fail "本地 master ahead origin/master。保留用户本地集成区，不自动改写或发布。"
fi

fail "本地 master 与 origin/master 已分叉。请人工处理用户本地集成区。"
