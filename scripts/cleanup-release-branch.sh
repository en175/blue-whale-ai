#!/usr/bin/env bash
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

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/worktree-paths.sh
source "$ROOT/scripts/lib/worktree-paths.sh"
WORKTREE_BASE="$(worktree_paths_resolve_base "$ROOT")"

case "$ROOT" in "$WORKTREE_BASE"/*) fail "请在主 checkout 执行，不要在任务 worktree 内清理：$ROOT" ;; esac

current="$(git -C "$ROOT" symbolic-ref --short HEAD 2>/dev/null || true)"
[ "$current" = "master" ] || fail "当前分支是 ${current:-detached HEAD}，请先切回本地 master。"

if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  git -C "$ROOT" status --short >&2
  fail "工作区不干净，不能清理。"
fi

case "$BRANCH" in feature/*|fix/*|hotfix/*|docs/*|chore/*|release/*) ;; *) fail "分支必须使用白名单前缀：feature/ fix/ hotfix/ docs/ chore/ 或 release/" ;; esac

git -C "$ROOT" show-ref --verify --quiet "refs/heads/$BRANCH" || fail "本地分支不存在：$BRANCH"

git -C "$ROOT" fetch origin master
git -C "$ROOT" merge-base --is-ancestor "$BRANCH" origin/master \
  || fail "$BRANCH 尚未被 origin/master 包含。请等待 PR 合并后再清理。"

probe_rc=0
git -C "$ROOT" ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1 || probe_rc=$?
if [ "$probe_rc" = 0 ]; then
  git -C "$ROOT" push origin --delete "$BRANCH"
  git -C "$ROOT" update-ref -d "refs/heads/$BRANCH"
elif [ "$probe_rc" = 2 ]; then
  git -C "$ROOT" update-ref -d "refs/heads/$BRANCH"
else
  fail "ls-remote 探活失败（exit ${probe_rc}），远程状态未知，未删本地分支：${BRANCH}。网络恢复后重试即可。"
fi
git -C "$ROOT" fetch --prune

echo "✅ 已清理发布包装分支：$BRANCH"
