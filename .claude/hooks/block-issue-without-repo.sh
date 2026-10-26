#!/usr/bin/env bash

INPUT=$(cat)
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
AUDIT="$HOOK_DIR/lib/hook_audit.py"
HOOK_NAME="$(basename "$0")"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

extract_json_value() {
  key="$1"
  printf '%s' "$INPUT" \
    | grep -oE "\"${key}\"[[:space:]]*:[[:space:]]*(\"[^\"]*\"|[0-9]+)" \
    | head -n1 \
    | sed -E "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"?([^\"]*)\"?.*/\\1/"
}

TOOL_NAME=$(extract_json_value "tool_name")
PROJECT_ID=$(extract_json_value "project_id")
PROGRAM_ID=$(extract_json_value "program_id")
PARENT_ID=$(extract_json_value "parent_id")
ASSIGNEE_ID=$(extract_json_value "assignee_id")

IS_UPDATE=0
[ "$TOOL_NAME" = "mcp__gitee-ent__update_enterprise_issue" ] && IS_UPDATE=1

AUDIT_OPERATION="issue-create"
[ "$IS_UPDATE" -eq 1 ] && AUDIT_OPERATION="issue-update"

HAS_PARENT=0
[ -n "$PARENT_ID" ] && [ "$PARENT_ID" != "0" ] && HAS_PARENT=1

block() {
  reason="$1"
  printf '%s' "$INPUT" | python3 "$AUDIT" \
    --project-dir "$PROJECT_DIR" \
    --hook "$HOOK_NAME" \
    --operation "$AUDIT_OPERATION" \
    --exit-code 2 \
    --reason "blocked-policy" >/dev/null || true
  cat >&2 <<EOF
BLOCKED: ${reason}
  tool_name: ${TOOL_NAME:-（未知，按 create 规则处理）}
  parent_id: ${PARENT_ID:-（空）}
  project_id: ${PROJECT_ID:-（空）}
  program_id: ${PROGRAM_ID:-（空）}

本项目所有 issue 必须关联到 blue-whale-ai 仓库、且归属其项目：
- 不关联仓库的 issue（project_id=0）只出现在企业工作项列表，仓库 Issues 页看不到
- 不归属项目的根 issue（program_id=0）游离于企业「项目管理」之外
- 子工作项还必须继承父项的 project_id/program_id，否则父项页可见但仓库 Issues/MCP 仓库过滤查不到
- 团队按仓库 Issues / 项目管理查工单时会漏掉它（历史事件 IJZ5WA / IJZ74J-N / IK0FL6-7）

改法：
- 根 issue：创建时传 project_id（blue-whale-ai 仓库 ID，用 list_enterprise_repositories 查）和 program_id（项目 ID，用 list_programs 查）
- 子 issue：先 get 父 issue，创建/更新时传 parent_id=父项 id、project_id=父项 project_id、program_id=父项 program_id
- 发布后用 list_enterprise_issues(project_id, search=ident) 反查确认仓库可见

详见 docs/agents/issue-tracker.md「创建 issue」。
EOF
  exit 2
}

if [ "$PROJECT_ID" = "0" ]; then
  block "issue 的 project_id 为 0（未关联仓库）。"
fi

if [ "$PROGRAM_ID" = "0" ]; then
  block "issue 的 program_id 为 0（未归属项目）。"
fi

if [ "$HAS_PARENT" -eq 1 ]; then
  if [ -z "$PROJECT_ID" ]; then
    block "子 issue 缺少 project_id，无法保证仓库 Issues 可见。"
  fi
  if [ -z "$PROGRAM_ID" ] || [ "$PROGRAM_ID" = "0" ]; then
    block "子 issue 缺少 program_id，未继承父项项目归属。"
  fi
fi

block_empty_description() {
  printf '%s' "$INPUT" | python3 "$AUDIT" \
    --project-dir "$PROJECT_DIR" \
    --hook "$HOOK_NAME" \
    --operation "$AUDIT_OPERATION" \
    --exit-code 2 \
    --reason "blocked-empty-description" >/dev/null || true
  cat >&2 <<'EOF'
BLOCKED: create_enterprise_issue 的 description 缺失或为空。

Gitee MCP 写工具对未知/错名参数静默忽略、不报错——把描述传到 body 等错名参数，
工单会建成空描述（历史事件 IK5THP）。

改法：
- 描述入参名是 description（不是 body），创建必传且非空
- 创建后 get_enterprise_issue_detail 回读确认 description 非空

详见 docs/agents/issue-tracker.md「操作约定」。
EOF
  exit 2
}

if [ "$IS_UPDATE" -eq 0 ] && [ -z "$PROJECT_ID" ]; then
  block "创建根 issue 未关联仓库（project_id 缺失或为空）。"
fi

if [ "$IS_UPDATE" -eq 0 ] && [ "$HAS_PARENT" -eq 0 ]; then
  if [ -z "$PROGRAM_ID" ] || [ "$PROGRAM_ID" = "0" ]; then
    block "创建根 issue 未归属项目（program_id 缺失或为 0）。"
  fi
fi

block_missing_assignee() {
  printf '%s' "$INPUT" | python3 "$AUDIT" \
    --project-dir "$PROJECT_DIR" \
    --hook "$HOOK_NAME" \
    --operation "$AUDIT_OPERATION" \
    --exit-code 2 \
    --reason "blocked-no-assignee" >/dev/null || true
  cat >&2 <<'EOF'
BLOCKED: create_enterprise_issue 缺少 assignee_id（负责人）。

本项目所有工单创建时必须标注负责人（2026-10-03 定规，IKJKWK）：
- 未点名负责人 → 创建人即负责人：get_user_info 取当前 token 用户 id 作 assignee_id，
  collaborator_ids 可空
- 点名了负责人 → list_enterprise_members(search=<名字>) 解析 id 作 assignee_id，
  创建人并入 collaborator_ids；解析不到或多人同名时停下问发单人，不静默兜底
- 点名负责人且另有协作者 → 创建人也必须并入 collaborator_ids

详见 docs/agents/issue-tracker.md「创建归属标注」。
EOF
  exit 2
}

if [ "$IS_UPDATE" -eq 0 ]; then
  if [ -z "$ASSIGNEE_ID" ] || [ "$ASSIGNEE_ID" = "0" ]; then
    block_missing_assignee
  fi
fi

if [ "$IS_UPDATE" -eq 0 ]; then
  DESCRIPTION=$(extract_json_value "description")
  if [ -z "$DESCRIPTION" ]; then
    block_empty_description
  fi
fi

printf '%s' "$INPUT" | python3 "$AUDIT" \
  --project-dir "$PROJECT_DIR" \
  --hook "$HOOK_NAME" \
  --operation "$AUDIT_OPERATION" \
  --exit-code 0 \
  --reason "allowed-policy" >/dev/null || true
exit 0
