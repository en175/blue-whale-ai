#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d)"
WORKTREE_BASE="$TEST_ROOT/blue-whale-worktrees"
REPO="$WORKTREE_BASE/chore-iktest"
TASK_BRANCH="chore/IKTEST-提交脚本判据"

cleanup() { rm -rf "$TEST_ROOT"; }
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

run_commit() {
  run_commit_in "$REPO" "$@"
}

run_commit_in() {
  ( cd "$1" && HOME="$TEST_ROOT" bash scripts/commit-task-for-review.sh "${@:2}" ) 2>&1
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
printf 'web/node_modules/\n' >"$REPO/.gitignore"
git -C "$REPO" add -A
git -C "$REPO" commit -q -m "base"
BASE_SHA="$(git -C "$REPO" rev-parse HEAD)"
TARGET_BRANCH="release/2026.09.24_发布流程验证"
git -C "$REPO" branch "$TARGET_BRANCH"
git -C "$REPO" switch -q -c "$TASK_BRANCH"

if out="$(run_commit -m "chore: 不得静默回退")"; then
  fail "缺元数据时提交应当失败，却成功了"
fi
case "$out" in
  *"缺少任务基线元数据"*) ;;
  *) fail "缺元数据时应给出修复指引，实际：$out" ;;
esac
python3 "$REPO/scripts/lib/task_metadata.py" repair --worktree "$REPO" \
  --target-branch "$TARGET_BRANCH" --start-sha "$BASE_SHA" --user-authorized >/dev/null

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

out="$(run_commit -m "chore: 第一个子项")" || fail "首次提交应当成功，实际：$out"
case "$out" in
  *"--target-branch $TARGET_BRANCH"*) ;;
  *) fail "提交提醒应指向任务记录的发布线，实际：$out" ;;
esac
[ "$(git -C "$REPO" rev-list --count "$BASE_SHA"..HEAD)" = "1" ] || fail "首次提交后应有 1 个 commit"

printf 'amended\n' >>"$REPO/shared.txt"
out="$(run_commit --amend)" || fail "已有自己的 commit 后 --amend 应当放行，实际：$out"
[ "$(git -C "$REPO" rev-list --count "$BASE_SHA"..HEAD)" = "1" ] \
  || fail "--amend 不该增加 commit 数"

printf 'second\n' >>"$REPO/shared.txt"
out="$(run_commit -m "chore: 第二个子项")" || fail "同一分支的第二次提交应当成功，实际：$out"
[ "$(git -C "$REPO" rev-list --count "$BASE_SHA"..HEAD)" = "2" ] \
  || fail "一个工单分支必须能落多个 commit（一个父工单一个 worktree，逐子项各一个 commit）"

printf 'third\n' >>"$REPO/shared.txt"
out="$(run_commit -m "chore: 第三个子项")" || fail "第三次提交应当成功，实际：$out"
[ "$(git -C "$REPO" rev-list --count "$BASE_SHA"..HEAD)" = "3" ] || fail "第三次提交后应有 3 个 commit"
[ "$(python3 "$REPO/scripts/lib/task_metadata.py" read --worktree "$REPO" --field start_sha)" = "$BASE_SHA" ] \
  || fail "修订提交不得改变任务起点 SHA"

PARENT_SHA="$(git -C "$REPO" rev-parse HEAD)"
CHILD="$WORKTREE_BASE/chore-child"
git -C "$REPO" worktree add -q -b "chore/IKCHILD-保护整包继承提交" "$CHILD" "$BASE_SHA"
git -C "$CHILD" merge -q --no-ff -m "chore: 继承父整合提交" "$PARENT_SHA"
INHERITED_SHA="$(git -C "$CHILD" rev-parse HEAD)"
PYTHONDONTWRITEBYTECODE=1 python3 - "$SOURCE_ROOT" "$CHILD" "$TARGET_BRANCH" "$BASE_SHA" "$INHERITED_SHA" <<'PY'
import sys
from pathlib import Path

source, child, target, start, inherited = sys.argv[1:]
sys.path.insert(0, str(Path(source) / "scripts/lib"))
from task_metadata import write_task_metadata

write_task_metadata(Path(child), target, start, inherited_sha=inherited)
PY
printf 'own\n' >"$CHILD/own.txt"
if out="$(run_commit_in "$CHILD" --amend)"; then
  fail "子票没有自有提交时 --amend 应当拒绝，却成功了"
fi
case "$out" in
  *"尚无自己的 commit"*) ;;
  *) fail "子票 --amend 拒绝理由错误：$out" ;;
esac
[ "$(git -C "$CHILD" rev-parse HEAD)" = "$INHERITED_SHA" ] || fail "拒绝时继承提交被改写"
out="$(run_commit_in "$CHILD" -m "chore: 子票自有提交")" || fail "子票首次提交失败：$out"
case "$out" in
  *"父整合分支统一验证和发布"*) ;;
  *) fail "子票提交后不应提示独立 PR：$out" ;;
esac
printf 'revised\n' >"$CHILD/own.txt"
run_commit_in "$CHILD" --amend >/dev/null || fail "子票自有提交后 --amend 应当放行"
git -C "$CHILD" merge-base --is-ancestor "$INHERITED_SHA" HEAD || fail "子票 amend 改写了继承提交"
[ "$(git -C "$REPO" rev-parse HEAD)" = "$PARENT_SHA" ] || fail "子票提交影响了父分支"

FAKE_TSC="$REPO/web/node_modules/.bin/tsc"
TSC_MARKER="$TEST_ROOT/tsc-invoked"

write_fake_tsc() {
  mkdir -p "$(dirname "$FAKE_TSC")"
  cat >"$FAKE_TSC" <<FAKE
#!/usr/bin/env bash
echo "probe" >>"\$TSC_MARKER"
echo "fake-tsc: 探针类型错误 TS18048" >&2
exit "\${FAKE_TSC_EXIT:-0}"
FAKE
  chmod +x "$FAKE_TSC"
}

rm -f "$TSC_MARKER"
write_fake_tsc
printf 'fourth\n' >>"$REPO/shared.txt"
out="$(FAKE_TSC_EXIT=1 TSC_MARKER="$TSC_MARKER" run_commit -m "chore: 第四个子项（非 web）")" \
  || fail "无 web/ 改动的提交应当成功，实际：$out"
[ ! -e "$TSC_MARKER" ] || fail "无 web/ 改动时不应调用 tsc"
COUNT_NOW="$(git -C "$REPO" rev-list --count "$BASE_SHA"..HEAD)"

# ---- 5. web/ 改动但 tsc 缺失（依赖未安装）：拒绝并给出安装指引 ----
rm -rf "$REPO/web/node_modules"
mkdir -p "$REPO/web/src"
printf 'export {}\n' >"$REPO/web/src/probe.ts"
if out="$(run_commit -m "chore: 不应成功")"; then
  fail "web 改动且 tsc 缺失时提交应当拒绝，却成功了"
fi
case "$out" in
  *"不存在"*"tsc -b"*) ;;
  *) fail "缺 tsc 的拒绝理由应指明依赖未安装与修复命令，实际：$out" ;;
esac
[ "$(git -C "$REPO" rev-list --count "$BASE_SHA"..HEAD)" = "$COUNT_NOW" ] \
  || fail "门禁拒绝时不该产生 commit"

# ---- 6. web/ 改动且类型红（tsc 非零）：拒绝并透出错误输出 ----
write_fake_tsc
if out="$(FAKE_TSC_EXIT=1 TSC_MARKER="$TSC_MARKER" run_commit -m "chore: 不应成功")"; then
  fail "web 类型红时提交应当拒绝，却成功了"
fi
case "$out" in
  *"fake-tsc: 探针类型错误"*) ;;
  *) fail "拒绝时应透出 tsc 的错误输出，实际：$out" ;;
esac
[ "$(git -C "$REPO" rev-list --count "$BASE_SHA"..HEAD)" = "$COUNT_NOW" ] \
  || fail "类型红拒绝时不该产生 commit"

# ---- 7. web/ 改动且类型绿：放行，且 tsc 确实执行过 ----
rm -f "$TSC_MARKER"
out="$(FAKE_TSC_EXIT=0 TSC_MARKER="$TSC_MARKER" run_commit -m "chore: 第五个子项（web）")" \
  || fail "web 类型绿时提交应当成功，实际：$out"
[ -e "$TSC_MARKER" ] || fail "web 改动提交时 tsc 必须真的执行"
[ "$(git -C "$REPO" rev-list --count "$BASE_SHA"..HEAD)" = "$((COUNT_NOW + 1))" ] \
  || fail "类型绿放行后应有 1 个新 commit"

# ---- 8. --amend 路径同样受门禁：类型红时拒绝修订 ----
printf 'revised-web\n' >"$REPO/web/src/probe.ts"
if out="$(FAKE_TSC_EXIT=1 TSC_MARKER="$TSC_MARKER" run_commit --amend)"; then
  fail "--amend 携带 web 改动且类型红时应当拒绝，却成功了"
fi
case "$out" in
  *"类型检查未通过"*) ;;
  *) fail "--amend 拒绝理由应指向类型检查，实际：$out" ;;
esac

echo "PASS: commit-task-for-review.sh --amend 判据、多次提交与 web 类型门禁"
