#!/usr/bin/env bash
#
# 守 commit-task-for-review.sh 的 --amend 前置判据。
#
# 这条判据 2026-09-01 从「标记文件」改成「向 master 求 merge-base」：标记文件的副作用是把
# 「一个分支只能提交一次」也一起钉死了，而既定流程是一个父工单一个 worktree、逐子项各落一个
# commit。改完之后没有任何测试守着，本文件补上。
#
# 三条：
#   1. 分支还没有自己的 commit 时，--amend 必须拒绝（否则会改写 worktree 基线）
#   2. 分支已有自己的 commit 后，--amend 放行
#   3. 同一分支可以连续提交多次 —— 这正是旧标记文件挡掉的那件事

set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d)"
# 脚本要求工作目录落在 worktree base 之下，所以按真实布局搭一份。
WORKTREE_BASE="$TEST_ROOT/blue-whale-worktrees"
REPO="$WORKTREE_BASE/chore-iktest"
TASK_BRANCH="chore/IKTEST-提交脚本判据"

cleanup() { rm -rf "$TEST_ROOT"; }
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

run_commit() {
  ( cd "$REPO" && HOME="$TEST_ROOT" bash scripts/commit-task-for-review.sh "$@" ) 2>&1
}

mkdir -p "$REPO/scripts/lib"
git init -q -b master "$REPO"
git -C "$REPO" config user.name "Commit Guard Test"
git -C "$REPO" config user.email "commit-guard-test@example.com"
git -C "$REPO" config core.hooksPath /dev/null
cp "$SOURCE_ROOT/scripts/commit-task-for-review.sh" "$REPO/scripts/commit-task-for-review.sh"
cp "$SOURCE_ROOT/scripts/lib/worktree-paths.sh" "$REPO/scripts/lib/worktree-paths.sh"
cp "$SOURCE_ROOT/scripts/lib/python3-command.sh" "$REPO/scripts/lib/python3-command.sh"
cp "$SOURCE_ROOT/scripts/lib/task_metadata.py" "$REPO/scripts/lib/task_metadata.py"
printf 'base\n' >"$REPO/shared.txt"
git -C "$REPO" add -A
git -C "$REPO" commit -q -m "base"
BASE_SHA="$(git -C "$REPO" rev-parse HEAD)"
TARGET_BRANCH="release/2026.09.24_发布流程验证"
git -C "$REPO" branch "$TARGET_BRANCH"
git -C "$REPO" switch -q -c "$TASK_BRANCH"

# 缺失元数据不得向 master 猜测起点。
if out="$(run_commit -m "chore: 不得静默回退")"; then
  fail "缺元数据时提交应当失败，却成功了"
fi
case "$out" in
  *"缺少任务基线元数据"*) ;;
  *) fail "缺元数据时应给出修复指引，实际：$out" ;;
esac
python3 "$REPO/scripts/lib/task_metadata.py" repair --worktree "$REPO" \
  --target-branch "$TARGET_BRANCH" --start-sha "$BASE_SHA" --user-authorized >/dev/null

# ---- 1. 分支还没有自己的 commit：--amend 必须拒绝 ----
printf 'first\n' >>"$REPO/shared.txt"
if out="$(run_commit --amend)"; then
  fail "分支尚无自己的 commit 时 --amend 应当拒绝，却成功了"
fi
case "$out" in
  *"尚无自己的 commit"*) ;;
  *) fail "拒绝理由应指出分支尚无自己的 commit，实际：$out" ;;
esac
[ "$(git -C "$REPO" rev-list --count "$BASE_SHA"..HEAD)" = "0" ] \
  || fail "--amend 被拒后不该产生任何 commit"

# ---- 2. 首次提交后 --amend 放行 ----
out="$(run_commit -m "chore: 第一个子项")" || fail "首次提交应当成功，实际：$out"
[ "$(git -C "$REPO" rev-list --count "$BASE_SHA"..HEAD)" = "1" ] || fail "首次提交后应有 1 个 commit"

printf 'amended\n' >>"$REPO/shared.txt"
out="$(run_commit --amend)" || fail "已有自己的 commit 后 --amend 应当放行，实际：$out"
[ "$(git -C "$REPO" rev-list --count "$BASE_SHA"..HEAD)" = "1" ] \
  || fail "--amend 不该增加 commit 数"

# ---- 3. 同一分支可以连续提交多次（旧标记文件正是挡掉这件事） ----
printf 'second\n' >>"$REPO/shared.txt"
out="$(run_commit -m "chore: 第二个子项")" || fail "同一分支的第二次提交应当成功，实际：$out"
[ "$(git -C "$REPO" rev-list --count "$BASE_SHA"..HEAD)" = "2" ] \
  || fail "一个工单分支必须能落多个 commit（一个父工单一个 worktree，逐子项各一个 commit）"

printf 'third\n' >>"$REPO/shared.txt"
out="$(run_commit -m "chore: 第三个子项")" || fail "第三次提交应当成功，实际：$out"
[ "$(git -C "$REPO" rev-list --count "$BASE_SHA"..HEAD)" = "3" ] || fail "第三次提交后应有 3 个 commit"
[ "$(python3 "$REPO/scripts/lib/task_metadata.py" read --worktree "$REPO" --field start_sha)" = "$BASE_SHA" ] \
  || fail "修订提交不得改变任务起点 SHA"

echo "PASS: commit-task-for-review.sh --amend 判据与多次提交"
