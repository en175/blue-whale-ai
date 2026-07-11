#!/usr/bin/env bash
# Commit a task worktree diff as a reviewable, revertable checkpoint.
# worktree 工单分支上的 commit 是本地可逆动作（不碰 master、不 push、不 PR），
# 不属发布红线，无需用户授权门槛。用户确认环节落在 merge 本地 master 前。

set -euo pipefail

MESSAGE=""

usage() {
  cat >&2 <<EOF
用法: scripts/commit-task-for-review.sh -m "<commit-message>"

在任务 worktree 工单分支内提交已完成的子 issue diff，落成可 review、可 revert 的检查点。
EOF
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -m|--message)
      [ "$#" -ge 2 ] || usage
      MESSAGE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "❌ commit-task-for-review: 不支持的参数：$1" >&2
      usage
      ;;
  esac
done

fail() {
  echo "❌ commit-task-for-review: $*" >&2
  exit 1
}

[ -n "$MESSAGE" ] || fail "缺少 commit message。请用 -m \"<message>\"。"

ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=lib/worktree-paths.sh
source "$ROOT/scripts/lib/worktree-paths.sh"
WORKTREE_BASE="$(worktree_paths_resolve_base "$ROOT")"

case "$ROOT" in
  "$WORKTREE_BASE"/*) ;;
  *) fail "请在 $WORKTREE_BASE 下的任务 worktree 内执行，不能在用户本地 master 直接提交任务。" ;;
esac

branch="$(git -C "$ROOT" symbolic-ref --short HEAD 2>/dev/null || true)"
case "$branch" in
  feature/*|fix/*|hotfix/*|docs/*|chore/*) ;;
  "") fail "当前不是分支状态。" ;;
  *) fail "当前分支不是工单分支：$branch" ;;
esac

if [ -z "$(git -C "$ROOT" status --porcelain)" ]; then
  fail "没有可提交的任务验收 diff。"
fi

git -C "$ROOT" add -A
git -C "$ROOT" commit -m "$MESSAGE"

echo "✅ 已提交任务验收分支：$branch"
echo "下一步：用户确认后，可在本地 master 运行 scripts/merge-task-to-local-master.sh --user-authorized $branch"
