#!/usr/bin/env bash
# Commit a task worktree diff as a reviewable, revertable checkpoint.
# worktree 工单分支上的 commit 是本地可逆动作（不碰发布线、不 push、不 PR），
# 不属发布红线，无需用户授权门槛。推送并创建 PR 前须有用户授权。
#
# 两种模式：
#   提交（默认）：把已完成的子 issue diff 落成一个新 commit。一个工单分支可以提交多次——
#            一个父工单一个 worktree、逐子项各落一个 commit 是既定流程，不是例外。
#   --amend：用户 review commit 后发现修订，覆盖最后 commit。默认 --no-edit 保留原 commit
#            message；-m 覆盖 message。仅在该分支已有自己的 commit 后可用。

set -euo pipefail

MESSAGE=""
AMEND=0

usage() {
  cat >&2 <<EOF
用法:
  提交:            scripts/commit-task-for-review.sh -m "<commit-message>"
  review 后修订:   scripts/commit-task-for-review.sh --amend [-m "<new-message>"]

在任务 worktree 工单分支内提交已完成的子 issue diff，落成可 review、可 revert 的检查点。
同一分支可反复提交（逐子项一个 commit）。--amend 覆盖该分支最后 commit（默认保留原
message，-m 覆盖）；仅在该分支已有自己的 commit 后可用。
EOF
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -m|--message)
      [ "$#" -ge 2 ] || usage
      MESSAGE="$2"
      shift 2
      ;;
    --amend)
      AMEND=1
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "❌ commit-task-for-review: 不支持的参数：$1" >&2
      usage
      ;;
  esac
done

fail() {
  echo "❌ commit-task-for-review: $*" >&2
  exit 1
}

ROOT="$(git rev-parse --show-toplevel)"
# Git Bash on Windows：git rev-parse 返回 `D:/...`（大写盘符），pwd 返回 `/d/...`（小写 posix）。
# case 比较大小写敏感会误判，统一走 pwd 风格。
ROOT="$(cd "$ROOT" && pwd)"
# shellcheck source=lib/worktree-paths.sh
source "$ROOT/scripts/lib/worktree-paths.sh"
WORKTREE_BASE="$(worktree_paths_resolve_base "$ROOT")"

case "$ROOT" in
  "$WORKTREE_BASE"/*) ;;
  *) fail "请在 $WORKTREE_BASE 下的任务 worktree 内执行，不能在本地发布线直接提交任务。" ;;
esac

branch="$(git -C "$ROOT" symbolic-ref --short HEAD 2>/dev/null || true)"
case "$branch" in
  feature/*|fix/*|hotfix/*|docs/*|chore/*) ;;
  "") fail "当前不是分支状态。" ;;
  *) fail "当前分支不是工单分支：$branch" ;;
esac

# 任务起点由开工入口写入私有 Git 元数据，缺失时禁止回退 master 推断。
source "$ROOT/scripts/lib/python3-command.sh"
select_python3_command || fail "未找到可用的 Python 3，无法读取任务起点。"
base_sha="$("${PYTHON3_COMMAND[@]}" "$ROOT/scripts/lib/task_metadata.py" read --worktree "$ROOT" --field start_sha)" \
  || fail "任务起点元数据读取失败；请按上方指引修复。"
target_branch="$("${PYTHON3_COMMAND[@]}" "$ROOT/scripts/lib/task_metadata.py" read --worktree "$ROOT" --field target_branch)" \
  || fail "任务目标发布线读取失败；请按上方指引修复。"
inherited_sha="$("${PYTHON3_COMMAND[@]}" "$ROOT/scripts/lib/task_metadata.py" read --worktree "$ROOT" --field inherited_sha)" \
  || fail "任务继承提交读取失败；请按上方指引修复。"
own_base_sha="${inherited_sha:-$base_sha}"

branch_has_own_commit() {
  local head_sha target_ref target_sha found_target=0
  head_sha="$(git -C "$ROOT" rev-parse HEAD)"
  [ "$own_base_sha" != "$head_sha" ] || return 1
  # 同步任务后，HEAD 可能只是前进的 release 提交。只允许修订尚未进入
  # 本地或已抓取远端目标发布线的任务顶端提交。
  for target_ref in "refs/heads/$target_branch" "refs/remotes/origin/$target_branch"; do
    target_sha="$(git -C "$ROOT" rev-parse --verify --quiet "$target_ref" 2>/dev/null)" || continue
    found_target=1
    git -C "$ROOT" merge-base --is-ancestor "$head_sha" "$target_sha" && return 1
  done
  [ "$found_target" = 1 ]
}

# ── web 类型门禁（IKIZPZ 复盘）─────────────────────────────────────────────
# vitest 走 esbuild 不查类型，类型错误曾一路绿着提交进集成分支（IKIZQE 的 9 个
# tsc -b 错误到收口审查才暴露）。检查命令本身现成，这里只是接线：staged 含
# web/ 路径就必须先证明类型干净；web 依赖未安装视同无法证明，同样拒绝。
run_web_typecheck_gate() {
  git -C "$ROOT" diff --cached --name-only | grep -q '^web/' || return 0
  local tsc_bin="$ROOT/web/node_modules/.bin/tsc"
  if [ ! -x "$tsc_bin" ]; then
    fail "本次提交包含 web/ 改动，但 $tsc_bin 不存在（web 依赖未安装），无法核验类型。先在 web/ 安装依赖并跑通 ./node_modules/.bin/tsc -b 再提交。"
  fi
  echo "ℹ️ commit-task-for-review: web/ 改动 → 先过 tsc -b 类型检查 …"
  if ! (cd "$ROOT/web" && ./node_modules/.bin/tsc -b); then
    fail "web 类型检查未通过（tsc -b）。修复以上类型错误后重试提交。"
  fi
}

if [ "$AMEND" = 1 ]; then
  branch_has_own_commit || fail "当前工单分支尚无自己的 commit，--amend 会改写 worktree 基线。请先用 -m \"<message>\" 提交。"
  git -C "$ROOT" add -A
  run_web_typecheck_gate
  if [ -n "$MESSAGE" ]; then
    git -C "$ROOT" commit --amend -m "$MESSAGE"
  else
    git -C "$ROOT" commit --amend --no-edit
  fi
  echo "✅ 已修订任务验收分支的最后 commit：$branch"
else
  [ -n "$MESSAGE" ] || fail "缺少 commit message。请用 -m \"<message>\"。"
  if [ -z "$(git -C "$ROOT" status --porcelain)" ]; then
    fail "没有可提交的任务验收 diff。"
  fi
  git -C "$ROOT" add -A
  run_web_typecheck_gate
  git -C "$ROOT" commit -m "$MESSAGE"
  commit_count="$(git -C "$ROOT" rev-list --count "$own_base_sha"..HEAD)"
  # ${} 包起来：紧跟其后的全角括号是多字节字符，裸 $branch 会被 bash 当成变量名的一部分。
  echo "✅ 已提交任务验收分支：${branch}（本分支第 ${commit_count} 个 commit）"
fi

if [ -n "$inherited_sha" ]; then
  echo "下一步：将子票提交合回父整合分支，由父整合分支统一验证和发布整包 PR。"
else
  echo "下一步：用户确认后，运行 scripts/publish-review-package.sh --user-authorized --create-pr --target-branch ${target_branch}。"
fi
