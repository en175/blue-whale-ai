#!/usr/bin/env bash
# Claude Code PreToolUse hook — 发布动作标准入口兜底（仅本项目）
# JSON 与 shell 命令解析委托给 lib/pretool.py，避免转义引号和 git 全局选项绕过。
#
# 兜底对象：
#   - Bash: 直接 git push（硬拦，必须走标准入口）
#   - Bash: scripts/publish-review-package.sh --user-authorized（一次确认）
#   - Bash: 本地验收 commit / 非 --ff-only merge（一次确认，或走标准本地入口）
#   - mcp__gitee-ent__create_enterprise_repo_pull: 创建 Gitee PR
#   - mcp__gitee-ent__merge_enterprise_pull: 合并 Gitee PR
#   - mcp__gitee-ent__create_enterprise_repo_release: 创建 Gitee release
#
# 规则：
#   - 发布审查包只允许通过标准入口触发，并在入口处 ask 一次。
#   - 直接 git push 是绕过标准入口，直接阻断。
#   - 创建 PR 必须消费标准入口写入的短期标记，并校验 target=master/source_branch/no draft。
#   - 发布审查包授权不覆盖合并；合并仍会单独触发确认。
#   - 本地任务验收授权不覆盖远程发布；commit 与本地 merge 都需要确认。
#
# 输出契约：
#   - stdout 仅输出 Claude Code 结构化 JSON 决策
#   - stderr 仅用于阻断时说明原因
#   - exit 0 = 放行或要求确认；exit 2 = 阻断

INPUT=$(cat)
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
PRETOOL="$HOOK_DIR/lib/pretool.py"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
MARKER_TTL_SECONDS=900

extract_json_value() {
  key="$1"
  printf '%s' "$INPUT" | python3 "$PRETOOL" value "$key" 2>/dev/null || true
}

ask_permission() {
  reason="$1"
  cat <<EOF
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"${reason}"}}
EOF
  exit 0
}

block() {
  reason="$1"
  cat >&2 <<EOF
BLOCKED: ${reason}

本项目发布动作必须遵守：
	- 发布审查包 = 推送当前工单分支 + 创建指向 master 的 PR
	- 发布审查包必须使用 scripts/publish-review-package.sh --user-authorized
	- 本地任务验收必须先获得用户确认，再 commit 或 merge 到本地 master
	- 创建 PR 不使用 draft=true
	- 合并 PR 必须另获用户授权，不能复用发布审查包授权

详见 CLAUDE.md「发布动作必须先获用户授权」。
EOF
  exit 2
}

# 发布标记路径：git common dir（主 checkout 与所有 worktree 共享同一物理路径）
# + branch slug 文件名。common dir 对称 → session 在主 checkout 或 worktree 启动均能命中；
# branch slug → 并行发布任务标记不互相覆盖。与 publish-review-package.sh 写入路径同源。
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
  marker_path="$(marker_path_for_branch "$source_branch")"

  marker_branch="$(read_publish_marker branch "$marker_path" || true)"
  marker_target="$(read_publish_marker target "$marker_path" || true)"
  marker_created_at="$(read_publish_marker created_at "$marker_path" || true)"

  if [ -z "$marker_branch" ] || [ -z "$marker_target" ] || [ -z "$marker_created_at" ]; then
    block "创建 PR 前必须先通过 scripts/publish-review-package.sh --user-authorized 推送当前工单分支。"
  fi

  now="$(date +%s)"
  case "$marker_created_at" in
    ''|*[!0-9]*) block "发布审查包授权标记无效。请重新执行 scripts/publish-review-package.sh --user-authorized。" ;;
  esac

  if [ $((now - marker_created_at)) -gt "$MARKER_TTL_SECONDS" ]; then
    consume_publish_marker "$marker_path"
    block "发布审查包授权标记已过期。请重新执行 scripts/publish-review-package.sh --user-authorized。"
  fi

  if [ "$marker_branch" != "$source_branch" ] || [ "$marker_target" != "$target_branch" ]; then
    block "PR 分支与发布审查包授权标记不匹配。请重新执行 scripts/publish-review-package.sh --user-authorized。"
  fi

  consume_publish_marker "$marker_path"
}

TOOL_NAME=$(extract_json_value "tool_name")
COMMAND=$(extract_json_value "command")

# Bash: 直接 git push 属于绕过标准入口，硬拦。
if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" has-git-push; then
  block "检测到直接 git push。发布审查包必须使用 scripts/publish-review-package.sh --user-authorized。"
fi

# Bash: 标准发布审查包入口。缺少 --user-authorized 时硬拦；带参数时 ask 一次。
if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes publish-review-package.sh; then
  if ! printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes publish-review-package.sh --user-authorized; then
    block "发布审查包入口缺少 --user-authorized。必须先获得用户明确授权。"
  fi
  ask_permission "确认用户已授权发布审查包：推送当前工单分支并创建 target=master 的 PR。"
fi

# Bash: 标准本地任务验收入口。缺少 --user-authorized 时硬拦；带参数时 ask 一次。
if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes commit-task-for-review.sh; then
  if ! printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes commit-task-for-review.sh --user-authorized; then
    block "任务验收提交入口缺少 --user-authorized。必须先获得用户明确授权。"
  fi
  ask_permission "确认用户已授权提交任务验收分支。该授权不覆盖合入本地 master 或远程发布。"
fi

if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes merge-task-to-local-master.sh; then
  if ! printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes merge-task-to-local-master.sh --user-authorized; then
    block "合入用户本地 master 入口缺少 --user-authorized。必须先获得用户明确授权。"
  fi
  ask_permission "确认用户已授权将任务分支合入本地 master。该授权不覆盖远程发布或 PR 合并。"
fi

# Bash: 直接 git commit / 非 --ff-only git merge 也需要确认，防止绕过任务验收边界。
if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" task-acceptance-git >/dev/null; then
  ask_permission "确认用户已授权本地任务验收 git 操作。子 issue 默认终点仍是未提交 diff + 验证结果。"
fi

# Bash: cleanup-task-worktree.sh 不在这里 ask。脚本自身校验 PR 已进 origin/master、工作区干净、路径正确。

# Gitee: 创建 PR。只校验发布审查包形态，不做二次确认。
if [ "$TOOL_NAME" = "mcp__gitee-ent__create_enterprise_repo_pull" ]; then
  DRAFT=$(extract_json_value "draft")
  TARGET_BRANCH=$(extract_json_value "target_branch")
  SOURCE_BRANCH=$(extract_json_value "source_branch")

  case "$DRAFT" in
    true|TRUE|True|1) block "本项目不使用 draft PR；创建 Gitee PR 时请省略 draft 字段或传 draft=false。" ;;
  esac

  if [ "$TARGET_BRANCH" != "master" ]; then
    block "发布审查包只允许创建指向 master 的 PR。"
  fi

  case "$SOURCE_BRANCH" in
    feature/*|fix/*|hotfix/*|docs/*|chore/*) ;;
    *) block "创建 Gitee PR 时 source_branch 必须是工单分支。" ;;
  esac

  validate_publish_marker "$SOURCE_BRANCH" "$TARGET_BRANCH"

  exit 0
fi

# Gitee: 合并 PR。必须独立确认，不能被发布审查包授权覆盖。
if [ "$TOOL_NAME" = "mcp__gitee-ent__merge_enterprise_pull" ]; then
  ask_permission "合并 Gitee PR 需要用户单独确认：确认用户已明确授权合并该 PR。"
fi

# Gitee: 创建仓库 release。属于发布动作，必须单独确认。
if [ "$TOOL_NAME" = "mcp__gitee-ent__create_enterprise_repo_release" ]; then
  ask_permission "创建 Gitee release 需要用户单独确认：确认用户已明确授权发布该 release。"
fi

exit 0
