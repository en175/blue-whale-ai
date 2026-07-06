#!/usr/bin/env bash
# Push the current task branch after safety checks. Does not create a PR.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
ROOT_PARENT="$(cd "$ROOT/.." && pwd)"
if [ "$(basename "$ROOT_PARENT")" = "blue-whale-worktrees" ]; then
  WORKTREE_BASE="$ROOT_PARENT"
else
  WORKTREE_BASE="$ROOT_PARENT/blue-whale-worktrees"
fi

fail() {
  echo "❌ publish-task-branch: $*" >&2
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
  fail "工作区不干净。请先提交或处理改动，再发布分支。"
fi

git -C "$ROOT" fetch origin

if ! git -C "$ROOT" merge-base --is-ancestor origin/master HEAD; then
  fail "当前分支落后 origin/master。请先执行 git rebase origin/master，验证后再发布。"
fi

git -C "$ROOT" push -u origin "$branch"

cat <<EOF
✅ 分支已推送：$branch

下一步：
  1. 在 Gitee 创建 PR：$branch → master
  2. 按 .gitee/PULL_REQUEST_TEMPLATE.md 填写实现范围、风险、测试结果和审查重点
  3. PR 未合并前保留当前 worktree
  4. PR 合并后回到本 worktree 运行 scripts/cleanup-task-worktree.sh
EOF
