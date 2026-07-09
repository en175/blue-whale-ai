#!/usr/bin/env bash
# Clean up a merged release-wrapper branch on the main checkout after explicit user authorization.
set -euo pipefail

AUTHORIZED=0
BRANCH=""

usage() {
  cat >&2 <<EOF
用法: scripts/cleanup-release-branch.sh --user-authorized <branch>

在主 checkout 的本地 master 上，清理已合并进 origin/master 的发布包装分支：
删本地分支 + 删远程源分支 + git fetch --prune。
EOF
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --user-authorized) AUTHORIZED=1; shift ;;
    -h|--help) usage ;;
    -*) echo "❌ cleanup-release-branch: 不支持的参数：$1" >&2; usage ;;
    *) [ -z "$BRANCH" ] || usage; BRANCH="$1"; shift ;;
  esac
done

fail() { echo "❌ cleanup-release-branch: $*" >&2; exit 1; }

[ "$AUTHORIZED" = 1 ] || fail "缺少 --user-authorized。必须先获得用户明确授权清理发布包装分支。"
[ -n "$BRANCH" ] || fail "缺少发布包装分支名。"

ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=lib/worktree-paths.sh
source "$ROOT/scripts/lib/worktree-paths.sh"
WORKTREE_BASE="$(worktree_paths_resolve_base "$ROOT")"

# 必须在主 checkout（非 worktree）；worktree 形态走 cleanup-task-worktree.sh
case "$ROOT" in "$WORKTREE_BASE"/*) fail "请在主 checkout 执行，不要在任务 worktree 内清理：$ROOT" ;; esac

# 当前必须在本地 master
current="$(git -C "$ROOT" symbolic-ref --short HEAD 2>/dev/null || true)"
[ "$current" = "master" ] || fail "当前分支是 ${current:-detached HEAD}，请先切回本地 master。"

# 工作区必须干净
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  git -C "$ROOT" status --short >&2
  fail "工作区不干净，不能清理。"
fi

# 目标分支白名单（与 branch-naming.md / ADR-0004 同源）
case "$BRANCH" in feature/*|fix/*|hotfix/*|docs/*|chore/*) ;; *) fail "分支必须使用白名单前缀：feature/ fix/ hotfix/ docs/ chore/" ;; esac

# 本地分支必须存在
git -C "$ROOT" show-ref --verify --quiet "refs/heads/$BRANCH" || fail "本地分支不存在：$BRANCH"

# 确保 origin/master 最新，再校验已合并
git -C "$ROOT" fetch origin master
git -C "$ROOT" merge-base --is-ancestor "$BRANCH" origin/master \
  || fail "$BRANCH 尚未被 origin/master 包含。请等待 PR 合并后再清理。"

# 删除：本地先（update-ref -d 直接删 ref；本地 master 可能落后 origin/master，
# 故不用 branch -d——其「已合入当前 HEAD」判定在本地集成区落后时会误拒；
# ancestor 已证明分支在 origin/master 内，删 ref 安全），再远程（ls-remote 探活），最后 prune。
git -C "$ROOT" update-ref -d "refs/heads/$BRANCH"
if git -C "$ROOT" ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  git -C "$ROOT" push origin --delete "$BRANCH"
fi
git -C "$ROOT" fetch --prune

echo "✅ 已清理发布包装分支：$BRANCH"
