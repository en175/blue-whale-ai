#!/usr/bin/env bash
# Merge an accepted task branch into the user's local master integration area.

set -euo pipefail

AUTHORIZED=0
TASK_BRANCH=""

usage() {
  cat >&2 <<EOF
用法: scripts/merge-task-to-local-master.sh --user-authorized <task-branch>

在干净的本地 master 上以 --no-ff 合入已确认的任务分支。
EOF
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --user-authorized)
      AUTHORIZED=1
      shift
      ;;
    -h|--help)
      usage
      ;;
    -*)
      echo "❌ merge-task-to-local-master: 不支持的参数：$1" >&2
      usage
      ;;
    *)
      [ -z "$TASK_BRANCH" ] || usage
      TASK_BRANCH="$1"
      shift
      ;;
  esac
done

fail() {
  echo "❌ merge-task-to-local-master: $*" >&2
  exit 1
}

[ "$AUTHORIZED" = 1 ] || fail "缺少 --user-authorized。必须先获得用户明确授权合入本地 master。"
[ -n "$TASK_BRANCH" ] || fail "缺少任务分支名。"

# ROOT 用 BASH_SOURCE 而非 git rev-parse --show-toplevel：本脚本是主 checkout 脚本
# （lib/worktree-paths.sh 注释约定），运行时可能 cwd 在任意处；BASH_SOURCE 派生的 ROOT
# 稳定指向主 checkout scripts/ 的父目录，不依赖 cwd/worktree 上下文。IK00BP follow-up：
# 对齐 cleanup-release-branch.sh 的同款推导（旧 rev-parse --show-toplevel 依赖 cwd，不符约定）。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/worktree-paths.sh
source "$ROOT/scripts/lib/worktree-paths.sh"
WORKTREE_BASE="$(worktree_paths_resolve_base "$ROOT")"

case "$ROOT" in
  "$WORKTREE_BASE"/*)
    fail "请在主 checkout 的本地 master 执行，不要在任务 worktree 内合入本地 master：$ROOT"
    ;;
esac

branch="$(git -C "$ROOT" symbolic-ref --short HEAD 2>/dev/null || true)"
[ "$branch" = "master" ] || fail "当前分支是 ${branch:-detached HEAD}，请先切回本地 master。"

if command -v python3 >/dev/null 2>&1; then
  validator=(python3 "$ROOT/scripts/start-task-worktree.py")
elif command -v py >/dev/null 2>&1; then
  validator=(py -3 "$ROOT/scripts/start-task-worktree.py")
elif command -v python >/dev/null 2>&1; then
  validator=(python "$ROOT/scripts/start-task-worktree.py")
else
  fail "未找到 Python 3，无法验证结构化中文分支名。"
fi

validation_error="$("${validator[@]}" --validate-branch "$TASK_BRANCH" 2>&1)" ||
  fail "任务分支名不合规：$validation_error"

git -C "$ROOT" show-ref --verify --quiet "refs/heads/$TASK_BRANCH" || fail "本地任务分支不存在：$TASK_BRANCH"

if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  git -C "$ROOT" status --short >&2
  fail "本地 master 工作区不干净，不能合入任务分支。"
fi

git -C "$ROOT" fetch origin master

if ! git -C "$ROOT" merge --no-ff -m "chore: merge ${TASK_BRANCH}" "$TASK_BRANCH"; then
  git -C "$ROOT" status --short >&2
  fail "合入发生冲突。请在本地 master 解决冲突并验证；不要继续远程发布。"
fi

echo "✅ 已合入本地 master：$TASK_BRANCH"
echo "本地合入授权不覆盖远程发布；发布 PR 需要另行授权。"
