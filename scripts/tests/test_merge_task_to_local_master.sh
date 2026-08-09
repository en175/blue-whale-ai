#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d)"
REPO="$TEST_ROOT/repo"
ORIGIN="$TEST_ROOT/origin.git"
TASK_BRANCH="docs/IK7FI7-测试合并续接"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

git init --bare -q "$ORIGIN"
git init -q -b master "$REPO"
git -C "$REPO" config user.name "Merge Resume Test"
git -C "$REPO" config user.email "merge-resume-test@example.com"
git -C "$REPO" config core.hooksPath /dev/null
mkdir -p "$REPO/scripts/lib"
cp "$SOURCE_ROOT/scripts/merge-task-to-local-master.sh" "$REPO/scripts/merge-task-to-local-master.sh"
cp "$SOURCE_ROOT/scripts/lib/worktree-paths.sh" "$REPO/scripts/lib/worktree-paths.sh"
printf 'base\n' >"$REPO/shared.txt"
git -C "$REPO" add scripts shared.txt
git -C "$REPO" commit -q -m "test: base"
git -C "$REPO" remote add origin "$ORIGIN"
git -C "$REPO" push -q -u origin master

git -C "$REPO" checkout -q -b "$TASK_BRANCH"
printf 'task\n' >"$REPO/shared.txt"
git -C "$REPO" commit -q -am "test: task change"

git -C "$REPO" checkout -q master
printf 'master\n' >"$REPO/shared.txt"
git -C "$REPO" commit -q -am "test: master change"
MASTER_HEAD="$(git -C "$REPO" rev-parse HEAD)"

set +e
FIRST_OUTPUT="$(bash "$REPO/scripts/merge-task-to-local-master.sh" --user-authorized "$TASK_BRANCH" 2>&1)"
FIRST_EXIT=$?
set -e
[ "$FIRST_EXIT" -ne 0 ] || fail "首次冲突合入应失败"
[ -f "$REPO/.git/MERGE_HEAD" ] || fail "首次冲突合入应保留 MERGE_HEAD"

set +e
ABORT_OUTPUT="$(bash "$REPO/scripts/merge-task-to-local-master.sh" --user-authorized --abort "$TASK_BRANCH" 2>&1)"
ABORT_EXIT=$?
set -e
[ "$ABORT_EXIT" -eq 0 ] || fail "--abort 应撤销指定任务分支的冲突合入，实际输出：$ABORT_OUTPUT"
[ ! -f "$REPO/.git/MERGE_HEAD" ] || fail "--abort 成功后不应保留 MERGE_HEAD"
[ "$(git -C "$REPO" rev-parse HEAD)" = "$MASTER_HEAD" ] || fail "--abort 应恢复合入前 master HEAD"
[ -z "$(git -C "$REPO" status --porcelain)" ] || fail "--abort 应恢复干净工作区"

set +e
SECOND_OUTPUT="$(bash "$REPO/scripts/merge-task-to-local-master.sh" --user-authorized "$TASK_BRANCH" 2>&1)"
SECOND_EXIT=$?
set -e
[ "$SECOND_EXIT" -ne 0 ] || fail "重启后的冲突合入应失败"
[ -f "$REPO/.git/MERGE_HEAD" ] || fail "重启后的冲突合入应保留 MERGE_HEAD"

set +e
UNRESOLVED_OUTPUT="$(bash "$REPO/scripts/merge-task-to-local-master.sh" --user-authorized --continue "$TASK_BRANCH" 2>&1)"
UNRESOLVED_EXIT=$?
set -e
[ "$UNRESOLVED_EXIT" -ne 0 ] || fail "仍有未解决冲突时 --continue 应失败"
printf '%s' "$UNRESOLVED_OUTPUT" | grep -qF "仍有未解决冲突" || fail "未解决冲突的错误信息不明确：$UNRESOLVED_OUTPUT"
[ -f "$REPO/.git/MERGE_HEAD" ] || fail "拒绝未解决冲突后应保留 MERGE_HEAD"

printf 'resolved\n' >"$REPO/shared.txt"
git -C "$REPO" add shared.txt

set +e
CONTINUE_OUTPUT="$(bash "$REPO/scripts/merge-task-to-local-master.sh" --user-authorized --continue "$TASK_BRANCH" 2>&1)"
CONTINUE_EXIT=$?
set -e
[ "$CONTINUE_EXIT" -eq 0 ] || fail "冲突解决后 --continue 应成功，实际输出：$CONTINUE_OUTPUT"
[ ! -f "$REPO/.git/MERGE_HEAD" ] || fail "--continue 成功后不应保留 MERGE_HEAD"
[ "$(git -C "$REPO" rev-list --parents -n 1 HEAD | awk '{print NF}')" -eq 3 ] || fail "--continue 应生成双父 merge commit"
printf '%s' "$CONTINUE_OUTPUT" | grep -qF "已完成冲突续接并合入本地 master" || fail "成功输出缺少续接完成标记"

echo "PASS: merge-task-to-local-master 冲突续接"
