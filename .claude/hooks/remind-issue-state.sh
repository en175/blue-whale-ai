#!/usr/bin/env bash
# Claude Code / Codex / Kimi / ZCode PostToolUse — 工单状态流转提醒（仅观察，不阻断）
#
# 背景：Issue 状态机规则（docs/agents/issue-tracker.md「任务状态机」）要求
# Agent 在三个时机主动变更工单状态，但人工/模型都容易遗忘。本 hook 在触发点
# 打印提醒，钉住遗忘根因。红线 7：Hook 只纠偏、不推进状态机——本脚本始终
# exit 0，不自动改任何状态（脚本无 token，也改不了）。
#
# 触发（均 PostToolUse）：
#   1. Bash 成功执行 start-task-worktree 且带 --issue <ident>
#      → 提醒把 <ident> 置为开发中（缺陷置修复中）；前置状态异常停下问人。
#   2. mcp__gitee-ent__create_enterprise_repo_pull 成功
#      → 提醒给关联工单打 ready-for-review 标签。
#   3. mcp__gitee-ent__merge_enterprise_pull 成功
#      → 提醒把关联工单置已上线（缺陷置待发布，另打 修复待验证）。
#
# 成功判定：kimi 的 PostToolUse 仅在工具成功时触发（失败走 PostToolUseFailure）；
# Claude/Codex 的 Post 对失败也可能触发，但提醒是纯提示，误提醒无害（Agent 会
# 自行判断入口是否真成功），故不做严格成功判定，保持零依赖。
#
# 输出通道：Claude/ZCode 的 PostToolUse 裸 stdout 不进入模型上下文（只落
# transcript），须以 hookSpecificOutput.additionalContent JSON 注入（与
# cbm-discovery-gate 同机制）；kimi 端 shim 消费纯文本。转义经 python3 完成
# （.claude/hooks/lib 既定依赖），失败仅退化为无提醒。
#
# 退出码恒为 0：Post 阶段不能也不应阻断已执行的工具。
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
    # 只关心 worktree 入口命令；其余 Bash 静默。
    case "$COMMAND" in
      *start-task-worktree*)
        ;;
      *)
        exit 0
        ;;
    esac
    # 提取 --issue 的工单号；--no-issue 或无 --issue 静默。
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
