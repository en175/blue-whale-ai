#!/usr/bin/env bash
# Push a task branch for either first-time PR creation or an existing PR update.

set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

AUTHORIZED=0
MODE=""
MODE_COUNT=0
PR_IID=""
PR_SNAPSHOT=""
TARGET_BRANCH=""
TARGET_BRANCH_EXPLICIT=0
CREATE_DRAFT=0
AS_JSON=0
PYTHON=()
ALLOW_SCOPE_FILES=()
. "$SCRIPT_ROOT/scripts/lib/python3-command.sh"

# Windows 下子进程 python（inherit 管道）默认按 GBK 编码输出，中文会被
# 写成 GBK 字节；父进程按 utf-8 解码会崩溃。强制 UTF-8 与 Python 源码内
# reconfigure(utf-8) 对齐；POSIX 环境下 PYTHONIOENCODING 同样只是把本就
# 默认的 utf-8 显式化，不影响其他操作系统。
export PYTHONIOENCODING=utf-8

if select_python3_command; then
  PYTHON=("${PYTHON3_COMMAND[@]}")
fi

emit_status() {
  status="$1"
  shift
  if [ "$AS_JSON" = 1 ]; then
    if [ "${#PYTHON[@]}" -gt 0 ]; then
      "${PYTHON[@]}" - "$status" "$@" <<'PY'
import json
import sys

status, *items = sys.argv[1:]
payload = {"status": status}
for index in range(0, len(items), 2):
    key, value = items[index:index + 2]
    if key == "pull_request_id" or key.endswith("_count"):
        payload[key] = int(value)
    elif key == "changed_files":
        payload[key] = value.splitlines() if value else []
    else:
        payload[key] = value
print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
PY
    else
      printf '{"status":"%s"}\n' "$status"
    fi
  else
    printf '%s' "$status"
    while [ "$#" -gt 1 ]; do
      printf ' %s=%s' "$1" "$2"
      shift 2
    done
    printf '\n'
  fi
}

fail_status() {
  code="$1"
  status="$2"
  message="$3"
  shift 3
  echo "❌ publish-review-package: $message" >&2
  emit_status "$status" "$@"
  exit "$code"
}

usage() {
  cat <<'EOF'
用法：
  scripts/publish-review-package.sh --user-authorized --create-pr [--target-branch release/<name>] [--draft-pr] [--json]
  scripts/publish-review-package.sh --user-authorized --update-pr <PR编号> --pr-snapshot <JSON文件> [--allow-scope-file <路径>] [--json]

--create-pr         首次推送并生成创建 PR 的短期发布标记
--update-pr <IID>   安全更新已有 PR 的远端源分支，不生成创建标记
--pr-snapshot FILE  Agent 通过 Gitee MCP 刚读取并规范化的 PR 快照；update 必填
--target-branch NAME 创建 PR 的目标分支；默认任务记录的 release/*
--draft-pr          创建草稿 PR；标记会绑定 draft=true，供 Gitee Hook 核对
--allow-scope-file  明确允许本轮审查修订新增到冻结范围的文件；可重复
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --user-authorized)
      AUTHORIZED=1
      shift
      ;;
    --create-pr)
      MODE="create"
      MODE_COUNT=$((MODE_COUNT + 1))
      shift
      ;;
    --draft-pr)
      CREATE_DRAFT=1
      shift
      ;;
    --update-pr)
      [ "$#" -ge 2 ] || fail_status 2 INVALID_PR_IID "--update-pr 缺少 PR 编号。"
      MODE="update"
      MODE_COUNT=$((MODE_COUNT + 1))
      PR_IID="$2"
      shift 2
      ;;
    --json)
      AS_JSON=1
      shift
      ;;
    --pr-snapshot)
      [ "$#" -ge 2 ] || fail_status 2 PR_SNAPSHOT_REQUIRED "--pr-snapshot 缺少文件路径。"
      PR_SNAPSHOT="$2"
      shift 2
      ;;
    --target-branch)
      [ "$#" -ge 2 ] || fail_status 2 INVALID_TARGET_BRANCH "--target-branch 缺少分支名。"
      TARGET_BRANCH="$2"
      TARGET_BRANCH_EXPLICIT=1
      shift 2
      ;;
    --allow-scope-file)
      [ "$#" -ge 2 ] || fail_status 2 INVALID_ARGUMENT "--allow-scope-file 缺少路径。"
      ALLOW_SCOPE_FILES+=("$2")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail_status 2 INVALID_ARGUMENT "不支持的参数：$1"
      ;;
  esac
done

[ "$AUTHORIZED" = 1 ] || fail_status 2 AUTHORIZATION_REQUIRED "缺少 --user-authorized。必须先获得用户明确授权。"
[ "$MODE_COUNT" = 1 ] || fail_status 2 INVALID_MODE "--create-pr 与 --update-pr 必须且只能选择一个。"
if [ "$MODE" = update ] && [ "$CREATE_DRAFT" = 1 ]; then
  fail_status 2 INVALID_ARGUMENT "--draft-pr 仅用于首次创建 PR。"
fi
if [ "$MODE" = update ]; then
  case "$PR_IID" in
    ''|*[!0-9]*|0) fail_status 2 INVALID_PR_IID "PR 编号必须是正整数。" ;;
  esac
  [ -n "$PR_SNAPSHOT" ] || fail_status 2 PR_SNAPSHOT_REQUIRED "更新已有 PR 前必须通过 Gitee MCP 读取快照并传入 --pr-snapshot。"
  [ "$TARGET_BRANCH_EXPLICIT" = 0 ] || fail_status 2 INVALID_TARGET_BRANCH "更新 PR 的目标分支由快照决定，请勿传 --target-branch。"
  [ -f "$PR_SNAPSHOT" ] || fail_status 8 PR_EVIDENCE_INVALID "PR 快照文件不存在：$PR_SNAPSHOT"
  [ "${#PYTHON[@]}" -gt 0 ] || fail_status 1 PYTHON_UNAVAILABLE "读取 PR 快照需要可用的 Python 3。"
  TARGET_BRANCH="$("${PYTHON[@]}" - "$PR_SNAPSHOT" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8")).get("target_branch", ""))
PY
)" || fail_status 8 PR_EVIDENCE_INVALID "无法从 PR 快照读取目标分支。"
  case "$TARGET_BRANCH" in release/?*) ;; *) fail_status 8 PR_EVIDENCE_INVALID "PR 目标分支必须是 release/*。" ;; esac
fi

ROOT="$(git rev-parse --show-toplevel)"
# Git Bash on Windows：git rev-parse 返回 `D:/...`（大写盘符），pwd 返回 `/d/...`（小写 posix）。
# case 比较/路径拼接受影响，统一走 pwd 风格。
ROOT="$(cd "$ROOT" && pwd)"
branch="$(git -C "$ROOT" symbolic-ref --short HEAD 2>/dev/null || true)"
case "$branch" in
  feature/*|fix/*|hotfix/*|docs/*|chore/*) ;;
  "") fail_status 1 INVALID_BRANCH "当前不是分支状态。" ;;
  *) fail_status 1 INVALID_BRANCH "当前分支不是工单分支：$branch" ;;
esac

if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  git -C "$ROOT" status --short >&2
  fail_status 1 DIRTY_WORKTREE "工作区不干净。请先提交或处理改动。"
fi

[ "${#PYTHON[@]}" -gt 0 ] || fail_status 1 PYTHON_UNAVAILABLE "读取任务起点需要可用的 Python 3。"
metadata=("${PYTHON[@]}" "$SCRIPT_ROOT/scripts/lib/task_metadata.py" read --worktree "$ROOT")
if [ "$MODE" = create ] && [ "$TARGET_BRANCH_EXPLICIT" = 0 ]; then
  TARGET_BRANCH="$("${metadata[@]}" --field target_branch)" \
    || fail_status 12 TASK_BASE_INVALID "无法读取任务记录的目标发布线。"
fi
case "$TARGET_BRANCH" in release/?*) ;; *) fail_status 2 INVALID_TARGET_BRANCH "目标分支必须是 release/*：$TARGET_BRANCH" ;; esac
start_sha="$("${metadata[@]}" --target-branch "$TARGET_BRANCH" --field start_sha)" \
  || fail_status 12 TASK_BASE_INVALID "任务起点或目标发布线与元数据不符。"
inherited_sha="$("${metadata[@]}" --target-branch "$TARGET_BRANCH" --field inherited_sha)" \
  || fail_status 12 TASK_BASE_INVALID "任务继承提交元数据无效。"
[ -z "$inherited_sha" ] || fail_status 12 INTEGRATION_CHILD_NO_PR "整包子票不能独立发布 PR；请由父整合分支统一发布。"

if ! fetch_detail="$(git -C "$ROOT" fetch origin "$TARGET_BRANCH" 2>&1)"; then
  fail_status 7 REMOTE_READ_FAILED "无法读取 origin/${TARGET_BRANCH}；可按规则最多重试两次。" detail "$fetch_detail"
fi
head_sha="$(git -C "$ROOT" rev-parse HEAD)"
upstream_ref="origin/${TARGET_BRANCH}"
upstream_sha="$(git -C "$ROOT" rev-parse "$upstream_ref")"
if ! target_line="$(git -C "$ROOT" ls-remote --heads origin "refs/heads/$TARGET_BRANCH" 2>&1)"; then
  fail_status 7 REMOTE_READ_FAILED "无法复核远端目标；可按规则最多重试两次。" detail "$target_line"
fi
actual_target_sha="${target_line%%[[:space:]]*}"
if [ "$actual_target_sha" != "$upstream_sha" ]; then
  fail_status 7 REMOTE_TARGET_CHANGED "远端目标在 fetch 后变化；重新读取并验证。" fetched_sha "$upstream_sha" actual_sha "$actual_target_sha"
fi
if ! git -C "$ROOT" merge-base --is-ancestor "$start_sha" "$upstream_sha"; then
  pending="$(git -C "$ROOT" log --format='%h %s' --reverse "$upstream_sha..$start_sha")"
  fail_status 12 TASK_BASE_NOT_SHARED "origin/${TARGET_BRANCH} 尚未包含任务起点；先让以下基线提交进入目标分支。" target_branch "$TARGET_BRANCH" start_sha "$start_sha" pending_commits "$pending"
fi
if ! git -C "$ROOT" merge-base --is-ancestor "$upstream_sha" "$head_sha"; then
  fail_status 10 NEEDS_SYNC "当前分支未包含 ${upstream_ref}。先运行 scripts/sync-task-from-origin.sh sync --target-branch ${TARGET_BRANCH} --json。" branch "$branch" target_branch "$TARGET_BRANCH" head "$head_sha" upstream_sha "$upstream_sha"
fi
if ! verification_output="$(node "$SCRIPT_ROOT/scripts/verify-change-scope.mjs" check --stage pr --json 2>&1)"; then
  fail_status 11 VERIFICATION_REQUIRED "当前 HEAD 缺少覆盖发布要求的验证凭证。先运行 node scripts/verify-change-scope.mjs run --stage pr。" detail "$verification_output" head "$head_sha"
fi

remote_ref="refs/heads/$branch"
if ! remote_line="$(git -C "$ROOT" ls-remote --heads origin "$remote_ref" 2>&1)"; then
  fail_status 7 REMOTE_READ_FAILED "无法读取远端源分支；可按规则最多重试两次。" detail "$remote_line"
fi
remote_sha=""
if [ -n "$remote_line" ]; then
  remote_sha="${remote_line%%[[:space:]]*}"
fi

slug="$(printf '%s' "$branch" | tr '/' '%')"
# Git Bash on Windows：git 的路径输出是 `C:/...`（MSYS 绝对路径），而 $ROOT
# 已统一为 pwd 风格 `/c/...`。若直接把 `C:/...` 当作相对路径拼到 $ROOT 后，
# 会得到 `/c/.../main/.gitC:/...` 的混合垃圾路径，marker 写错目录。
# 先用 cygpath 把 Windows 风格绝对路径转成 POSIX 风格，再统一 cd/pwd 归一化。
common="$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
case "$common" in
  [A-Za-z]:*)
    common="$(cygpath -u "$common")"
    ;;
esac
case "$common" in
  "")
    common="$ROOT/.git"
    ;;
  /*) ;;
  *)
    common="$ROOT/$common"
    ;;
esac
common="$(cd "$common" && pwd)"
marker_path="$common/agent-release-review-package-$slug"
git_dir="$(git -C "$ROOT" rev-parse --absolute-git-dir)"
recovery_file="$git_dir/agent-sync-recovery.json"

mark_recovery_state() {
  state="$1"
  [ -f "$recovery_file" ] || return 0
  [ "${#PYTHON[@]}" -gt 0 ] || fail_status 1 PYTHON_UNAVAILABLE "同步恢复点需要可用的 Python 3；Microsoft Store 桩不可用。"
  "${PYTHON[@]}" "$SCRIPT_ROOT/scripts/sync_recovery.py" set-push-state "$recovery_file" "$head_sha" "$state"
}

clear_push_state_only_if_remote_unchanged() {
  expected_sha="$1"
  verification="$(git -C "$ROOT" ls-remote --heads origin "$remote_ref" 2>/dev/null)" || return 0
  actual_sha=""
  if [ -n "$verification" ]; then
    actual_sha="${verification%%[[:space:]]*}"
  fi
  if [ "$actual_sha" = "$expected_sha" ]; then
    mark_recovery_state clear || true
  fi
}

if [ "$MODE" = create ]; then
  if [ -n "$remote_sha" ] && ! git -C "$ROOT" merge-base --is-ancestor "$remote_sha" "$head_sha"; then
    fail_status 5 REMOTE_SOURCE_CHANGED "远端同名分支含本地未包含的提交；创建模式拒绝覆盖。" expected_remote_sha "$remote_sha" head "$head_sha"
  fi
  if ! mark_recovery_state in_flight; then
    fail_status 9 PUSH_STATE_PERSIST_FAILED "无法在推送前持久化 fail-closed 状态。"
  fi
  if ! git -C "$ROOT" push -u origin "HEAD:$remote_ref"; then
    clear_push_state_only_if_remote_unchanged "$remote_sha"
    fail_status 1 PUSH_FAILED "首次发布推送失败。"
  fi
  if ! mark_recovery_state pushed; then
    fail_status 9 PUSH_STATE_PERSIST_FAILED "远端已推送，但本地状态确认写入失败；恢复点保持 fail closed，禁止 rollback。"
  fi
  mkdir -p "$common"
  umask 077
  draft_marker=false
  [ "$CREATE_DRAFT" = 0 ] || draft_marker=true
  cat >"$marker_path" <<EOF
branch=$branch
target=$TARGET_BRANCH
head=$head_sha
target_sha=$upstream_sha
draft=$draft_marker
created_at=$(date +%s)
EOF
  emit_status PUSHED_CREATE_PR branch "$branch" head "$head_sha"
  exit 0
fi

[ -n "$remote_sha" ] || fail_status 1 REMOTE_SOURCE_MISSING "更新模式要求远端已存在同名 PR 源分支。" branch "$branch" pull_request_id "$PR_IID"

expected_remote_sha="$remote_sha"
if [ -f "$recovery_file" ]; then
  [ "${#PYTHON[@]}" -gt 0 ] || fail_status 1 PYTHON_UNAVAILABLE "同步恢复点需要可用的 Python 3；Microsoft Store 桩不可用。"
  recovery_values="$("${PYTHON[@]}" - "$recovery_file" "$branch" "$head_sha" "$TARGET_BRANCH" <<'PY'
import json
import sys

path, branch, head, target = sys.argv[1:]
data = json.load(open(path, encoding="utf-8"))
if (
    data.get("branch") != branch
    or data.get("synced_head") != head
    or data.get("target_branch", "master") != target
):
    raise SystemExit(3)
print(data.get("remote_branch_sha", ""))
PY
)" || fail_status 1 INVALID_RECOVERY "同步恢复点与当前分支、HEAD 或 PR 目标分支不匹配。"
  expected_remote_sha="$recovery_values"
else
  if ! git -C "$ROOT" merge-base --is-ancestor "$remote_sha" "$head_sha"; then
    fail_status 5 REMOTE_SOURCE_CHANGED "本地更新未包含当前远端源分支，拒绝覆盖未知提交。" expected_remote_sha "$remote_sha" head "$head_sha"
  fi
fi

if [ "$expected_remote_sha" != "$remote_sha" ]; then
  fail_status 5 REMOTE_LEASE_CHANGED "同步快照后远端源分支已变化，停止自动更新。" expected_remote_sha "$expected_remote_sha" actual_remote_sha "$remote_sha" pull_request_id "$PR_IID"
fi

task_commit_count="$(git -C "$ROOT" rev-list --count "$upstream_ref"..HEAD)"
merge_commit_count="$(git -C "$ROOT" rev-list --count --merges "$upstream_ref"..HEAD)"
changed_files="$(git -C "$ROOT" diff --name-only "$upstream_ref"...HEAD)"
if [ "$merge_commit_count" -gt 0 ]; then
  fail_status 6 SCOPE_MERGE_COMMIT_DETECTED "PR 创建后范围冻结；任务分支包含 merge commit，停止更新。" merge_commit_count "$merge_commit_count" task_commit_count "$task_commit_count" changed_files "$changed_files" pull_request_id "$PR_IID"
fi

[ "${#PYTHON[@]}" -gt 0 ] || fail_status 1 PYTHON_UNAVAILABLE "PR 快照硬校验需要可用的 Python 3。"
preflight=("${PYTHON[@]}" "$SCRIPT_ROOT/scripts/pr-update-evidence.py" preflight --update-pr "$PR_IID" --pr-snapshot "$PR_SNAPSHOT" --remote-sha "$remote_sha" --json)
if [ "${#ALLOW_SCOPE_FILES[@]}" -gt 0 ]; then
  for allowed_file in "${ALLOW_SCOPE_FILES[@]}"; do
    preflight+=(--allow-scope-file "$allowed_file")
  done
fi
if ! preflight_output="$("${preflight[@]}")"; then
  printf '%s\n' "$preflight_output"
  exit 8
fi

if ! mark_recovery_state in_flight; then
  fail_status 9 PUSH_STATE_PERSIST_FAILED "无法在推送前持久化 fail-closed 状态。"
fi
if ! git -C "$ROOT" push --force-with-lease="$remote_ref:$expected_remote_sha" -u origin "HEAD:$remote_ref"; then
  clear_push_state_only_if_remote_unchanged "$expected_remote_sha"
  fail_status 5 REMOTE_LEASE_CHANGED "安全强推失败；远端可能已经变化。" expected_remote_sha "$expected_remote_sha" pull_request_id "$PR_IID"
fi
if ! mark_recovery_state pushed; then
  fail_status 9 PUSH_STATE_PERSIST_FAILED "远端已推送，但本地状态确认写入失败；恢复点保持 fail closed，禁止 rollback。"
fi
rm -f "$marker_path"
emit_status PUSHED_UPDATE_PR branch "$branch" head "$head_sha" pull_request_id "$PR_IID" previous_remote_sha "$remote_sha" task_commit_count "$task_commit_count" merge_commit_count "$merge_commit_count" changed_files "$changed_files"
