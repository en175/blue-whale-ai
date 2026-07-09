#!/usr/bin/env bash
# Remove the current task worktree after its branch is merged into origin/master.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=lib/worktree-paths.sh
source "$ROOT/scripts/lib/worktree-paths.sh"
WORKTREE_BASE="$(worktree_paths_resolve_base "$ROOT")"

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

# 主 checkout = 不在 $WORKTREE_BASE 下的那个 worktree。
# 不依赖主 checkout 当前的分支状态（它可能 detached 或临时切到别的分支）；
# 用 substr 整行截取路径，兼容含空格的路径（awk 按字段切会把空格后的路径截断）。
main_root="$(git -C "$ROOT" worktree list --porcelain | awk -v base="$WORKTREE_BASE/" '
  /^worktree / {
    path = substr($0, 10)
    if (substr(path, 1, length(base)) != base) { print path; exit }
  }
')"

[ -n "$main_root" ] || fail "找不到主 checkout（不在 $WORKTREE_BASE 下的 worktree），不能安全删除。"

cd "$main_root"
git worktree remove "$ROOT"

# 本地 master 可能是用户本地集成区，未必包含 origin/master。
# 前面已经证明任务分支 HEAD 被 origin/master 包含，因此直接删除本地 ref 是安全清理。
git update-ref -d "refs/heads/$branch"

# 远程源分支删除不可逆，放在本地全部清理成功之后：本地失败时尚可重试，远程不受影响。
if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  git push origin --delete "$branch"
fi

git fetch --prune

echo "✅ 已清理任务 worktree 和分支：$branch"
