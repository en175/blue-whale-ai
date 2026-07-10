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

ROOT="$(git rev-parse --show-toplevel)"
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

# 1. 前缀白名单
case "$TASK_BRANCH" in
  feature/*|fix/*|hotfix/*|docs/*|chore/*) ;;
  *) fail "任务分支必须使用白名单前缀：feature/ fix/ hotfix/ docs/ chore/" ;;
esac

# 2. 前缀后段不能为空（拒绝 feature/）
_suffix="${TASK_BRANCH#*/}"
if [ -z "$_suffix" ]; then
  fail "任务分支名前缀后不能为空。格式：<prefix>/<ticket-id>-<summary>，如 feature/IJZ5WA-add-canvas-node"
fi

# 3. 拒绝含空格
case "$TASK_BRANCH" in
  *\ *) fail "任务分支名不允许含空格：$TASK_BRANCH" ;;
esac

# 4. 拒绝含下划线（项目约定用连字符）
case "$TASK_BRANCH" in
  *_*) fail "任务分支名不允许含下划线，请用连字符：$TASK_BRANCH" ;;
esac

# 5. 拒绝非 ASCII 字符
if printf '%s' "$TASK_BRANCH" | LC_ALL=C grep -q '[^ -~]'; then
  fail "任务分支名不允许含非 ASCII 字符（如中文）：$TASK_BRANCH"
fi

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
