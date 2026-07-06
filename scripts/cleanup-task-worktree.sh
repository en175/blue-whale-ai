#!/usr/bin/env bash
# Remove the current task worktree after its branch is merged into origin/master.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
ROOT_PARENT="$(cd "$ROOT/.." && pwd)"
if [ "$(basename "$ROOT_PARENT")" = "blue-whale-worktrees" ]; then
  WORKTREE_BASE="$ROOT_PARENT"
else
  WORKTREE_BASE="$ROOT_PARENT/blue-whale-worktrees"
fi

fail() {
  echo "❌ cleanup-task-worktree: $*" >&2
  exit 1
}

case "$ROOT" in
  "$WORKTREE_BASE"/*) ;;
  *) fail "请在 $WORKTREE_BASE 下的任务 worktree 内执行。" ;;
esac

branch="$(git -C "$ROOT" symbolic-ref --short HEAD 2>/dev/null || true)"
case "$branch" in
  feature/*|fix/*|hotfix/*|docs/*|chore/*) ;;
  "") fail "当前不是分支状态。" ;;
  *) fail "当前分支不是工单分支：$branch" ;;
esac

if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  git -C "$ROOT" status --short >&2
  fail "工作区不干净，不能清理。"
fi

git -C "$ROOT" fetch origin

if ! git -C "$ROOT" merge-base --is-ancestor HEAD origin/master; then
  fail "当前分支尚未被 origin/master 包含。请等待 PR 合并，或继续处理审查反馈。"
fi

main_root="$(git -C "$ROOT" worktree list --porcelain | awk '
  $1 == "worktree" { path=$2 }
  $1 == "branch" && $2 == "refs/heads/master" { print path; exit }
')"

[ -n "$main_root" ] || fail "找不到 master 主 checkout，不能安全删除当前 worktree。"

if git -C "$ROOT" ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  git -C "$ROOT" push origin --delete "$branch"
fi

cd "$main_root"
"$main_root/scripts/sync-master.sh"
git worktree remove "$ROOT"
git branch -d "$branch"
git fetch --prune

echo "✅ 已清理任务 worktree 和分支：$branch"
