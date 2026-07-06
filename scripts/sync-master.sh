#!/usr/bin/env bash
# Sync the main checkout's master mirror with origin/master.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_PARENT="$(cd "$ROOT/.." && pwd)"
if [ "$(basename "$ROOT_PARENT")" = "blue-whale-worktrees" ]; then
  WORKTREE_BASE="$ROOT_PARENT"
else
  WORKTREE_BASE="$ROOT_PARENT/blue-whale-worktrees"
fi

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
  echo "❌ sync-master: 本地 master 不是干净镜像，已停止同步。" >&2
  echo "" >&2
  git status --short >&2
  echo "" >&2
  echo "请先确认这些改动归属：任务改动迁移到任务 worktree；误改/生成物确认后清理；用户未完成工作则保留并换干净 checkout 开任务。" >&2
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
  fail "本地 master ahead origin/master。禁止从含本地提交的 master 开新任务，请先处理这些提交。"
fi

fail "本地 master 与 origin/master 已分叉。请人工处理后再开任务 worktree。"
