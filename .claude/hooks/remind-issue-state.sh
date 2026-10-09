#!/usr/bin/env bash
set -u

INPUT=$(cat)

extract_json_value() {
  key="$1"
  printf '%s' "$INPUT" \
    | grep -oE "\"${key}\"[[:space:]]*:[[:space:]]*(\"[^\"]*\"|[0-9]+)" \
    | head -n1 \
    | sed -E "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"?([^\"]*)\"?.*/\\1/"
}

TOOL_NAME=$(extract_json_value "tool_name")
CLIENT=$(extract_json_value "client_type")

emit() {
  if [ "$CLIENT" = "kimi_code_cli" ]; then
    printf '%s\n' "$1"
  else
    printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps({"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":sys.stdin.read()}},ensure_ascii=False))' 2>/dev/null
  fi
  exit 0
}

case "$TOOL_NAME" in
  Bash)
    COMMAND=$(extract_json_value "command")
    case "$COMMAND" in
      *start-task-worktree*)
        ;;
      *)
        exit 0
        ;;
    esac
    ISSUE=$(printf '%s' "$COMMAND" \
      | grep -oE -- '--issue[[:space:]]+[A-Za-z0-9_-]+' \
      | head -n1 \
      | sed -E 's/--issue[[:space:]]+//')
    if [ -z "$ISSUE" ]; then
      exit 0
    fi
    emit "$(cat <<EOF
📋 工单状态提醒：worktree 入口已带 --issue ${ISSUE}。
下一步（规则见 docs/agents/issue-tracker.md「任务状态机」）：
1. get_enterprise_issue_detail 查 ${ISSUE} 当前状态。
2. 预期起点（需求=待评审/待排期 / 任务=待排期 / 缺陷=待确认）→
   update_enterprise_issue 置「开发中」（缺陷置「修复中」）。
3. 已在开发完成态（任务=已完成 / 需求=待发布 / 缺陷=已修复）→ 转回开发中/修复中继续。
4. 已在「开发中/修复中」或已是终态（已上线/已关闭/已拒绝/已验收）→ 停止，向用户报告并等指示。
EOF
)"
    ;;
  mcp__gitee-ent__create_enterprise_repo_pull)
    emit "$(cat <<'EOF'
📋 工单状态提醒：PR 已创建。若本 PR 关联工单，给它打 ready-for-review 标签
（label id 用 list_enterprise_labels 查；label_ids 是整体语义，先 get 现有标签合并写回）。
EOF
)"
    ;;
  mcp__gitee-ent__merge_enterprise_pull)
    emit "$(cat <<'EOF'
📋 工单状态提醒：PR 已合并。若本 PR 关联工单，按「任务状态机」收尾：
- 需求/任务 → update_enterprise_issue 置「已上线」
- 缺陷 → 置「待发布」，另打「修复待验证」标签
- 已验收/已拒绝/已关闭归人操作，Agent 不得设置。
EOF
)"
    ;;
  *)
    exit 0
    ;;
esac
