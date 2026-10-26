#!/usr/bin/env bash

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
ROOT="$(cd "$ROOT" && pwd)"
# shellcheck source=lib/worktree-paths.sh
source "$ROOT/scripts/lib/worktree-paths.sh"
source "$ROOT/scripts/lib/python3-command.sh"
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
  *) fail "当前分支不是工单分支：${branch}" ;;
esac

if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  git -C "$ROOT" status --short >&2
  fail "工作区不干净，不能清理。"
fi

select_python3_command || fail "找不到 Python 3，无法读取任务基线元数据。"
target_branch="$("${PYTHON3_COMMAND[@]}" "$ROOT/scripts/lib/task_metadata.py" read \
  --worktree "$ROOT" --field target_branch)" || fail "任务基线元数据校验失败，未清理。"
task_sha="$(git -C "$ROOT" rev-parse --verify HEAD)"

if ! git -C "$ROOT" fetch --no-tags origin "refs/heads/$target_branch"; then
  fail "无法读取远端目标 ${target_branch}，未清理。"
fi
fetched_sha="$(git -C "$ROOT" rev-parse --verify 'FETCH_HEAD^{commit}')" \
  || fail "远端目标 ${target_branch} 的提交无法验证，未清理。"
if ! git -C "$ROOT" merge-base --is-ancestor "$task_sha" "$fetched_sha"; then
  fail "远端目标 ${target_branch} 尚未包含任务提交 ${task_sha}，未清理。"
fi

remote_line="$(git -C "$ROOT" ls-remote --exit-code --heads origin "refs/heads/$target_branch")" \
  || fail "无法复核远端目标 ${target_branch}，未清理。"
remote_sha="${remote_line%%[[:space:]]*}"
if [ "$remote_sha" != "$fetched_sha" ]; then
  fail "远端目标 ${target_branch} 在校验期间发生变化，未清理。"
fi

main_root="$(git -C "$ROOT" worktree list --porcelain | awk -v base="$WORKTREE_BASE/" '
  /^worktree / {
    path = substr($0, 10)
    if (substr(path, 1, length(base)) != base) { print path; exit }
  }
')"

[ -n "$main_root" ] || fail "找不到主 checkout（不在 $WORKTREE_BASE 下的 worktree），不能安全删除。"

cd "$main_root"

git worktree remove "$ROOT"

git update-ref -d "refs/heads/$branch" "$task_sha"

echo "✅ 已清理本地任务 worktree 和分支：${branch}（远端任务分支保留）"
