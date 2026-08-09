#!/usr/bin/env bash
# Merge an accepted task branch into the user's local master integration area.

set -euo pipefail

AUTHORIZED=0
ABORT_MERGE=0
CONTINUE_MERGE=0
TASK_BRANCH=""

usage() {
  cat >&2 <<EOF
用法:
  scripts/merge-task-to-local-master.sh --user-authorized <task-branch>
  scripts/merge-task-to-local-master.sh --user-authorized --continue <task-branch>
  scripts/merge-task-to-local-master.sh --user-authorized --abort <task-branch>

在干净的本地 master 上以 --no-ff 合入已确认的任务分支。
发生冲突并完成解决、暂存与验证后，用 --continue 完成本次 merge commit。
需要重新合入任务分支最新提交时，用 --abort 恢复合入前的本地 master。
EOF
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --user-authorized)
      AUTHORIZED=1
      shift
      ;;
    --continue)
      CONTINUE_MERGE=1
      shift
      ;;
    --abort)
      ABORT_MERGE=1
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
[ $((ABORT_MERGE + CONTINUE_MERGE)) -le 1 ] || fail "--abort 与 --continue 不能同时使用。"

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

# 新任务由 start-task-worktree.py 生成中文名，pre-push 也会校验。
# 此处只保留前缀校验，让策略生效前已存在的 ASCII task worktree 能完成本地合入。
case "$TASK_BRANCH" in
  feature/*|fix/*|hotfix/*|docs/*|chore/*) ;;
  *) fail "任务分支必须使用白名单前缀：feature/ fix/ hotfix/ docs/ chore/" ;;
esac

git -C "$ROOT" show-ref --verify --quiet "refs/heads/$TASK_BRANCH" || fail "本地任务分支不存在：$TASK_BRANCH"

if [ "$ABORT_MERGE" = 1 ]; then
  merge_head="$(git -C "$ROOT" rev-parse -q --verify MERGE_HEAD 2>/dev/null || true)"
  [ -n "$merge_head" ] || fail "当前没有可撤销的 merge。"

  git_dir="$(git -C "$ROOT" rev-parse --absolute-git-dir)"
  grep -qF "chore: merge ${TASK_BRANCH}" "$git_dir/MERGE_MSG" || fail "当前 merge 不属于指定任务分支：$TASK_BRANCH"

  git -C "$ROOT" merge --abort || fail "merge --abort 失败；已保留当前合并状态。"
  echo "✅ 已撤销冲突合入并恢复本地 master：$TASK_BRANCH"
  exit 0
fi

if [ "$CONTINUE_MERGE" = 1 ]; then
  merge_head="$(git -C "$ROOT" rev-parse -q --verify MERGE_HEAD 2>/dev/null || true)"
  [ -n "$merge_head" ] || fail "当前没有待续接的 merge。"

  task_head="$(git -C "$ROOT" rev-parse "$TASK_BRANCH")"
  [ "$merge_head" = "$task_head" ] || fail "待续接 merge 的来源不是当前任务分支：$TASK_BRANCH"

  unresolved="$(git -C "$ROOT" diff --name-only --diff-filter=U)"
  [ -z "$unresolved" ] || {
    printf '%s\n' "$unresolved" >&2
    fail "仍有未解决冲突；请完成解决并 git add 后再续接。"
  }

  GIT_EDITOR=true git -C "$ROOT" merge --continue || fail "merge --continue 失败；已保留当前合并状态。"
  echo "✅ 已完成冲突续接并合入本地 master：$TASK_BRANCH"
  echo "本地合入授权不覆盖远程发布；发布 PR 需要另行授权。"
  exit 0
fi

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
