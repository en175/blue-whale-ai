#!/usr/bin/env bash
# Claude Code PreToolUse hook — 发布动作前要求用户确认（仅本项目）
# JSON 与 shell 命令解析委托给 lib/pretool.py，避免转义引号和 git 全局选项绕过。
#
# 兜底对象：
#   - Bash: git push（含发布分支、删除远程源分支、force-with-lease）
#   - Bash: scripts/publish-task-branch.sh / scripts/cleanup-task-worktree.sh
#   - mcp__gitee-ent__create_enterprise_repo_pull: 创建 Gitee PR
#   - mcp__gitee-ent__merge_enterprise_pull: 合并 Gitee PR
#   - mcp__gitee-ent__create_enterprise_repo_release: 创建 Gitee release
#
# 规则：
#   - 发布动作必须先获得用户明确授权；Hook 通过 permissionDecision=ask
#     在工具执行前触发 Claude Code 用户确认。
#   - 创建 PR 必须是 draft PR；非 draft 直接阻断，要求 Agent 改为 draft=true。
#   - 发布审查包授权不覆盖合并；合并仍会单独触发确认。
#
# 输出契约：
#   - stdout 仅输出 Claude Code 结构化 JSON 决策
#   - stderr 仅用于阻断时说明原因
#   - exit 0 = 放行或要求确认；exit 2 = 阻断

INPUT=$(cat)
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
PRETOOL="$HOOK_DIR/lib/pretool.py"

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
- 发布审查包 = 推送当前工单分支 + 创建指向 master 的 draft PR
- 发布审查包必须先获得用户明确授权
- 创建 PR 必须传 draft=true
- 合并 PR 必须另获用户授权，不能复用发布审查包授权

详见 CLAUDE.md「发布动作必须先获用户授权」。
EOF
  exit 2
}

TOOL_NAME=$(extract_json_value "tool_name")
COMMAND=$(extract_json_value "command")

# Bash: 项目发布/清理脚本内部会执行远程变更，PreToolUse 只能看到脚本命令本身。
if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | grep -qE '(^|[;&|[:space:]])([^[:space:]]*/)?publish-task-branch\.sh([[:space:]]|$)'; then
  ask_permission "发布审查包脚本需要用户确认：确认用户已授权推送当前工单分支并创建 draft PR。"
fi

if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | grep -qE '(^|[;&|[:space:]])([^[:space:]]*/)?cleanup-task-worktree\.sh([[:space:]]|$)'; then
  ask_permission "发布后清理脚本需要用户确认：该流程可能删除远程源分支。确认用户已授权清理。"
fi

# Bash: 所有 git push 都属于发布/远程变更动作，需要用户确认。
if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" has-git-push; then
  ask_permission "发布类 Git 操作需要用户确认：git push 会修改远程仓库。确认这是用户已授权的发布审查包或发布后清理动作。"
fi

# Gitee: 创建 PR。发布审查包必须创建 draft PR。
if [ "$TOOL_NAME" = "mcp__gitee-ent__create_enterprise_repo_pull" ]; then
  DRAFT=$(extract_json_value "draft")
  TARGET_BRANCH=$(extract_json_value "target_branch")

  case "$DRAFT" in
    true|TRUE|True|1) ;;
    *) block "创建 Gitee PR 时缺少 draft=true，或 draft=false。" ;;
  esac

  if [ -n "$TARGET_BRANCH" ] && [ "$TARGET_BRANCH" != "master" ]; then
    block "发布审查包只允许创建指向 master 的 draft PR。"
  fi

  ask_permission "创建 Gitee draft PR 需要用户确认：确认用户已授权发布审查包。"
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
