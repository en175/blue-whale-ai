#!/usr/bin/env bash

INPUT=$(cat)
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
PRETOOL="$HOOK_DIR/lib/pretool.py"
AUTH_HELPER="$HOOK_DIR/lib/authorization.py"
AUDIT="$HOOK_DIR/lib/hook_audit.py"
HOOK_NAME="$(basename "$0")"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
MARKER_TTL_SECONDS=900

# shellcheck source=lib/merge-method-check.sh
. "$HOOK_DIR/lib/merge-method-check.sh"

extract_json_value() {
  key="$1"
  printf '%s' "$INPUT" | python3 "$PRETOOL" value "$key" 2>/dev/null || true
}

audit() {
  printf '%s' "$INPUT" | python3 "$AUDIT" \
    --project-dir "$PROJECT_DIR" \
    --hook "$HOOK_NAME" \
    --operation "$AUDIT_OPERATION" \
    --exit-code "$1" \
    --reason "$2" >/dev/null || true
}

allow() {
  audit 0 "allowed-policy"
  exit 0
}

block() {
  reason="$1"
  audit 2 "blocked-policy"
  cat >&2 <<EOF
BLOCKED: ${reason}

本项目发布动作必须遵守：
		- 首次发布使用 scripts/publish-review-package.sh --user-authorized --create-pr
		- 已有 PR 更新使用 scripts/publish-review-package.sh --user-authorized --update-pr <PR编号>
		- 分支落后时，Agent 依据规则主动运行 scripts/sync-task-from-origin.sh sync；Hook 不自动同步
	- 本地任务提交走 scripts/commit-task-for-review.sh（出现即放行）
	- 创建 PR 的 draft 必须与发布入口标记一致
	- 合并 PR / 创建 release 必须由 Agent 自动生成绑定具体对象的一次性凭证

详见 CLAUDE.md「发布动作必须先获用户授权」。
EOF
  exit 2
}

tool_response_succeeded() {
  printf '%s' "$INPUT" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
if "tool_response" in data:
    response = data.get("tool_response")
    raise SystemExit(0 if isinstance(response, dict) and response.get("isError") is False else 1)
# Kimi CLI：PostToolUse 仅在工具成功时触发（失败走 PostToolUseFailure），
# 载荷成功输出字段是 tool_output（无 tool_response），事件本身即成功证明。
if "tool_output" in data:
    raise SystemExit(0)
raise SystemExit(1)
' 2>/dev/null
}

action_subject() {
  case "$1" in
    merge-pr) extract_json_value "pull_request_id" ;;
    create-release) extract_json_value "release_tag_version" ;;
    *) return 1 ;;
  esac
}

load_action_scope() {
  AUTH_ACTION="$1"
  AUTH_ENTERPRISE_ID="$(extract_json_value "enterprise_id")"
  AUTH_PROJECT_ID="$(extract_json_value "project_id")"
  AUTH_SUBJECT="$(action_subject "$AUTH_ACTION")"
}

validate_action_authorization() {
  load_action_scope "$1"

  [ -n "$AUTH_ENTERPRISE_ID" ] || block "${AUTH_ACTION} 缺少 enterprise_id，无法校验授权范围。"
  [ -n "$AUTH_PROJECT_ID" ] || block "${AUTH_ACTION} 缺少 project_id，无法校验授权范围。"
  [ -n "$AUTH_SUBJECT" ] || block "${AUTH_ACTION} 缺少目标对象，无法校验授权范围。"
  [ -n "$TOOL_USE_ID" ] || block "${AUTH_ACTION} 缺少 tool_use_id，无法原子占用一次性授权凭证。"

  reason="$(python3 "$AUTH_HELPER" claim "$PROJECT_DIR" "$AUTH_ACTION" "$AUTH_ENTERPRISE_ID" "$AUTH_PROJECT_ID" "$AUTH_SUBJECT" "$TOOL_USE_ID" 2>&1)" || {
    block "${reason} 当前对话若已明确授权，请由 Agent 自动运行 scripts/manage-agent-authorization.sh grant --user-authorized ${AUTH_ACTION} 的对应命令后重试。"
  }
}

finish_action_authorization() {
  mode="$1"
  load_action_scope "$2"
  [ -n "$AUTH_ENTERPRISE_ID" ] && [ -n "$AUTH_PROJECT_ID" ] && [ -n "$AUTH_SUBJECT" ] || return 0
  [ -n "$TOOL_USE_ID" ] || return 0
  python3 "$AUTH_HELPER" "$mode" "$PROJECT_DIR" "$AUTH_ACTION" "$AUTH_ENTERPRISE_ID" "$AUTH_PROJECT_ID" "$AUTH_SUBJECT" "$TOOL_USE_ID" >/dev/null 2>&1 || true
}

marker_path_for_branch() {
  br="$1"
  slug="$(printf '%s' "$br" | tr '/' '%')"
  common="$(git -C "$PROJECT_DIR" rev-parse --git-common-dir 2>/dev/null || true)"
  case "$common" in
    "") common="$PROJECT_DIR/.git" ;;
    /*) ;;
    *)  common="$PROJECT_DIR/$common" ;;
  esac
  printf '%s/agent-release-review-package-%s' "$common" "$slug"
}

read_publish_marker() {
  key="$1"; marker_path="$2"
  [ -n "$marker_path" ] && [ -f "$marker_path" ] || return 1
  awk -F= -v key="$key" '$1 == key { print substr($0, length(key) + 2); exit }' "$marker_path"
}

consume_publish_marker() {
  marker_path="$1"
  [ -n "$marker_path" ] && rm -f "$marker_path"
}

validate_publish_marker() {
  source_branch="$1"
  target_branch="$2"
  requested_draft="$3"
  marker_path="$(marker_path_for_branch "$source_branch")"

  marker_branch="$(read_publish_marker branch "$marker_path" || true)"
  marker_target="$(read_publish_marker target "$marker_path" || true)"
  marker_head="$(read_publish_marker head "$marker_path" || true)"
  marker_target_sha="$(read_publish_marker target_sha "$marker_path" || true)"
  marker_draft="$(read_publish_marker draft "$marker_path" || true)"
  marker_created_at="$(read_publish_marker created_at "$marker_path" || true)"

  if [ -z "$marker_branch" ] || [ -z "$marker_target" ] || [ -z "$marker_head" ] ||
     [ -z "$marker_target_sha" ] || [ -z "$marker_created_at" ] || [ -z "$marker_draft" ]; then
    block "创建 PR 前必须先通过 scripts/publish-review-package.sh --user-authorized --create-pr 推送当前工单分支。"
  fi

  now="$(date +%s)"
  case "$marker_created_at" in
    ''|*[!0-9]*) block "发布审查包授权标记无效。请重新执行 scripts/publish-review-package.sh --user-authorized --create-pr。" ;;
  esac

  if [ $((now - marker_created_at)) -gt "$MARKER_TTL_SECONDS" ]; then
    consume_publish_marker "$marker_path"
    block "发布审查包授权标记已过期。请重新执行 scripts/publish-review-package.sh --user-authorized --create-pr。"
  fi

  if [ "$marker_branch" != "$source_branch" ] || [ "$marker_target" != "$target_branch" ]; then
    block "PR 分支与发布审查包授权标记不匹配。请重新执行 scripts/publish-review-package.sh --user-authorized --create-pr。"
  fi

  case "$marker_draft" in
    true|false) ;;
    *) block "发布审查包 draft 标记无效。请重新执行发布入口。" ;;
  esac
  if [ "$marker_draft" != "$requested_draft" ]; then
    block "PR draft 参数与发布审查包标记不匹配。请按发布入口记录的草稿状态创建 PR。"
  fi

  case "$marker_head:$marker_target_sha" in
    *[!0-9a-f:]* ) block "发布审查包提交标记无效，请重新执行发布入口。" ;;
  esac
  if [ "${#marker_head}" -ne 40 ] || [ "${#marker_target_sha}" -ne 40 ]; then
    block "发布审查包提交标记无效，请重新执行发布入口。"
  fi
  remote_refs="$(git -C "$PROJECT_DIR" ls-remote --heads origin \
    "refs/heads/$source_branch" "refs/heads/$target_branch" 2>/dev/null)" ||
    block "无法读取远端 PR 分支，请重新核对发布审查包。"
  remote_head="$(printf '%s\n' "$remote_refs" | awk -v ref="refs/heads/$source_branch" '$2 == ref { print $1; exit }')"
  remote_target_sha="$(printf '%s\n' "$remote_refs" | awk -v ref="refs/heads/$target_branch" '$2 == ref { print $1; exit }')"
  if [ "$remote_head" != "$marker_head" ]; then
    block "源分支提交在发布审查包生成后变化，请重新验证并执行发布入口。"
  fi
  if [ "$remote_target_sha" != "$marker_target_sha" ]; then
    block "目标分支提交在发布审查包生成后变化，请重新验证并执行发布入口。"
  fi

}

handle_post_tool_use() {
  succeeded=0
  tool_response_succeeded && succeeded=1
  case "$TOOL_NAME" in
    mcp__gitee-ent__create_enterprise_repo_pull)
      source_branch="$(extract_json_value "source_branch")"
      if [ "$succeeded" = 1 ] && [ -n "$source_branch" ]; then
        consume_publish_marker "$(marker_path_for_branch "$source_branch")"
      fi
      ;;
    mcp__gitee-ent__merge_enterprise_pull)
      if [ "$succeeded" = 1 ]; then
        finish_action_authorization consume merge-pr
      else
        finish_action_authorization release merge-pr
      fi
      ;;
    mcp__gitee-ent__create_enterprise_repo_release)
      if [ "$succeeded" = 1 ]; then
        finish_action_authorization consume create-release
      else
        finish_action_authorization release create-release
      fi
      ;;
  esac
  exit 0
}

TOOL_NAME=$(extract_json_value "tool_name")
COMMAND=$(extract_json_value "command")
HOOK_EVENT_NAME=$(extract_json_value "hook_event_name")
TOOL_USE_ID=$(extract_json_value "tool_use_id")

if [ "$HOOK_EVENT_NAME" = "PostToolUse" ]; then
  handle_post_tool_use
fi

case "$TOOL_NAME" in
  mcp__gitee-ent__create_enterprise_repo_pull) AUDIT_OPERATION="create-pr" ;;
  mcp__gitee-ent__merge_enterprise_pull) AUDIT_OPERATION="merge-pr" ;;
  mcp__gitee-ent__create_enterprise_repo_release) AUDIT_OPERATION="create-release" ;;
  *) AUDIT_OPERATION="bash-other" ;;
esac

if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" unsafe-git-alias; then
  AUDIT_OPERATION="git-alias"
  block "检测到无法安全分类的 Git alias。请改用明确的标准入口或原生 Git 子命令。"
fi

if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" has-git-push; then
  AUDIT_OPERATION="git-push"
  release_target="$(printf '%s' "$COMMAND" | python3 "$PRETOOL" release-push-target 2>/dev/null || true)"
  if [ -n "$release_target" ]; then
    block "检测到直接 push 发布基线 ${release_target}。release/* 可能直接影响线上，必须通过受审查的发布流程更新。"
  fi
fi

if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" release-direct-git; then
  AUDIT_OPERATION="release-direct-git"
  block "检测到在 release 工作树直接 commit/pull/merge/rebase/cherry-pick。同步请运行 scripts/sync-release-line.sh --json；任务写入与提交在独立 worktree，合入须经目标 release PR。"
fi

if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" unmanaged-task-commit; then
  AUDIT_OPERATION="git-commit"
  block "检测到任务名分支上的直接提交，但当前不是带有效发布线元数据的独立任务 worktree。请通过开工入口创建任务区或显式修复元数据。"
fi

task_acceptance="$(printf '%s' "$COMMAND" | python3 "$PRETOOL" task-acceptance-git 2>/dev/null || true)"
case "$task_acceptance" in
  "git commit")
    AUDIT_OPERATION="git-commit"
    ;;
  "git merge")
    AUDIT_OPERATION="git-merge"
    ;;
  "git merge origin/master")
    AUDIT_OPERATION="git-merge-sync"
    block "检测到在任务分支上用 merge 同步 origin/master。任务分支同步固定使用 rebase；请由 Agent 依据规则运行 scripts/sync-task-from-origin.sh sync --json。"
    ;;
  "git merge origin/release")
    AUDIT_OPERATION="git-merge-sync"
    block "检测到在任务分支上用 merge 同步目标 release。请运行 scripts/sync-task-from-origin.sh sync --target-branch <任务目标release> --json。"
    ;;
  "git pull")
    AUDIT_OPERATION="git-pull"
    block "检测到在任务分支上直接 git pull（无 --ff-only / --rebase）。任务分支同步固定使用 rebase；请由 Agent 依据规则运行 scripts/sync-task-from-origin.sh sync --json。"
    ;;
esac

if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes publish-review-package.sh; then
  AUDIT_OPERATION="publish-package"
  if ! printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes publish-review-package.sh --user-authorized; then
    block "发布审查包入口缺少 --user-authorized。必须先获得用户明确授权。"
  fi
  publish_mode="$(printf '%s' "$COMMAND" | python3 "$PRETOOL" publish-review-mode 2>/dev/null || true)"
  case "$publish_mode" in
    create) allow ;;
    update)
      if ! printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes publish-review-package.sh --pr-snapshot; then
        block "已有 PR 更新入口缺少 --pr-snapshot。Agent 必须先通过 Gitee MCP 读取并规范化 PR 快照。"
      fi
      allow
      ;;
    *) block "发布入口必须且只能选择 --create-pr 或 --update-pr <正整数 PR 编号>。" ;;
  esac
fi

if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes sync-task-from-origin.sh; then
  AUDIT_OPERATION="sync-task"
  allow
fi

if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes merge-task-to-local-master.sh; then
  AUDIT_OPERATION="merge-local-master"
  block "本地 master 集成入口已废止。任务经目标 release PR 合入；紧急生产 hotfix 另获授权。"
fi

if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes manage-release-branch.sh; then
  AUDIT_OPERATION="release-branch"
  if printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes manage-release-branch.sh create \
    || printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes manage-release-branch.sh activate; then
    if ! printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes manage-release-branch.sh --user-authorized; then
      block "release 分支 create/activate 是发布动作，缺少 --user-authorized。必须先获得用户明确授权。"
    fi
  elif ! printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes manage-release-branch.sh list \
    && ! printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes manage-release-branch.sh current; then
    block "release 分支管理入口只允许 list/current 只读调用；create/activate 必须带 --user-authorized。"
  fi
  allow
fi

if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes commit-task-for-review.sh; then
  AUDIT_OPERATION="commit-task"
  allow
fi


if [ "$TOOL_NAME" = "mcp__gitee-ent__create_enterprise_repo_pull" ]; then
  AUDIT_OPERATION="create-pr"
  DRAFT=$(extract_json_value "draft")
  TARGET_BRANCH=$(extract_json_value "target_branch")
  SOURCE_BRANCH=$(extract_json_value "source_branch")
  ENTERPRISE_ID=$(extract_json_value "enterprise_id")
  PROJECT_ID=$(extract_json_value "project_id")
  SOURCE_REPO=$(extract_json_value "source_repo")

  if [ -n "$ENTERPRISE_ID" ] && [ "$ENTERPRISE_ID" != "16660949" ]; then
    block "创建 Gitee PR 的 enterprise_id 与本仓不符。"
  fi
  if [ -n "$PROJECT_ID" ] && [ "$PROJECT_ID" != "48854568" ]; then
    block "创建 Gitee PR 的 project_id 与本仓不符。"
  fi
  if [ -n "$SOURCE_REPO" ] && [ "$SOURCE_REPO" != "48854568" ]; then
    block "创建 Gitee PR 的 source_repo 与本仓不符。"
  fi

  case "$DRAFT" in
    true|false) ;;
    *) block "创建 Gitee PR 时必须显式传 draft=true 或 draft=false。" ;;
  esac

  case "$TARGET_BRANCH" in
    release/?*) ;;
    *) block "普通任务发布审查包只允许创建指向 release/* 的 PR；生产 hotfix 须独立授权流程。" ;;
  esac

  case "$SOURCE_BRANCH" in
    feature/*|fix/*|hotfix/*|docs/*|chore/*) ;;
    *) block "创建 Gitee PR 时 source_branch 必须是工单分支。" ;;
  esac

  validate_publish_marker "$SOURCE_BRANCH" "$TARGET_BRANCH" "$DRAFT"

  allow
fi

if [ "$TOOL_NAME" = "mcp__gitee-ent__merge_enterprise_pull" ]; then
  AUDIT_OPERATION="merge-pr"
  MERGE_METHOD="$(extract_json_value "merge_method")"
  case "$MERGE_METHOD" in
    squash|rebase) audit 2 "blocked-policy" ;;
  esac
  check_merge_method_and_block "$MERGE_METHOD"
  validate_action_authorization merge-pr
  allow
fi

if [ "$TOOL_NAME" = "mcp__gitee-ent__create_enterprise_repo_release" ]; then
  AUDIT_OPERATION="create-release"
  validate_action_authorization create-release
  allow
fi

allow
