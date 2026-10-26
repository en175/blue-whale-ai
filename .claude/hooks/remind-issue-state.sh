#!/usr/bin/env bash
# Claude Code / Codex / Kimi / ZCode PostToolUse — 工单状态流转提醒（仅观察，不阻断）
#
# 背景：Issue 状态机规则（docs/agents/issue-tracker.md「任务状态与真实交付」）要求
# Agent 在关键节点核对实际交付与操作授权，但人工/模型都容易遗忘。本 hook 在触发点
# 打印提醒，钉住遗忘根因。红线 7：Hook 只纠偏、不推进状态机——本脚本始终
# exit 0，不自动改任何状态（脚本无 token，也改不了）。
#
# 触发（均 PostToolUse）：
#   1. Bash 成功执行 start-task-worktree 且带 --issue <ident>
#      → 提醒核对 PRD 评审、产品确认、版本、开发子任务创建、负责人及操作授权；worktree 成功不代表准入通过。
#   2. mcp__gitee-ent__create_enterprise_repo_pull 成功
#      → 提醒给关联工单打 ready-for-review 标签。
#   3. mcp__gitee-ent__merge_enterprise_pull 成功
#      → 提醒保留真实阶段；合并不等于测试、部署或验收，不自动完成工作项。
#
# 成功判定：kimi 的 PostToolUse 仅在工具成功时触发（失败走 PostToolUseFailure）；
# Claude/Codex 的 Post 对失败也可能触发，但提醒是纯提示，误提醒无害（Agent 会
# 自行判断入口是否真成功），故不做严格成功判定，保持零依赖。
#
# 退出码恒为 0：Post 阶段不能也不应阻断已执行的工具。

set -u

INPUT=$(cat)

if ! printf '%s' "$INPUT" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except (ValueError, TypeError):
    raise SystemExit(1)
if not isinstance(data, dict) or data.get("hook_event_name", "PostToolUse") != "PostToolUse":
    raise SystemExit(1)
if "tool_response" in data:
    response = data["tool_response"]
    if not isinstance(response, dict) or response.get("interrupted") is True:
        raise SystemExit(1)
    if "isError" in response and response["isError"] is not False:
        raise SystemExit(1)
    for key in ("exit_code", "exitCode"):
        if key in response:
            raise SystemExit(0 if type(response[key]) is int and response[key] == 0 else 1)
    claude_success = (data.get("hook_event_name") == "PostToolUse" and
                      data.get("tool_name") == "Bash" and
                      response.get("interrupted") is False and
                      isinstance(response.get("stdout"), str) and
                      isinstance(response.get("stderr"), str))
    raise SystemExit(0 if response.get("isError") is False or claude_success else 1)
raise SystemExit(0 if data.get("client_type") == "kimi_code_cli" and
                 data.get("hook_event_name") == "PostToolUse" and "tool_output" in data else 1)
' 2>/dev/null; then
  exit 0
fi

extract_json_value() {
  printf '%s' "$INPUT" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data.get(sys.argv[1], ""))
' "$1"
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
    ISSUE=$(printf '%s' "$INPUT" | python3 -c '
import json, posixpath, re, sys
sys.path.insert(0, sys.argv[1])
from pretool import is_separator, shell_tokens
data = json.load(sys.stdin)
command = data.get("tool_input", {}).get("command", "")
tokens = shell_tokens(command)
if any(is_separator(token) for token in tokens):
    raise SystemExit(0)
if tokens and posixpath.basename(tokens[0]) in {"bash", "sh", "zsh"}:
    tokens = tokens[1:]
    if tokens and tokens[0] == "--":
        tokens = tokens[1:]
if not tokens or posixpath.basename(tokens[0]) != "start-task-worktree.sh":
    raise SystemExit(0)
args = tokens[1:]
if "--help" in args or "-h" in args:
    raise SystemExit(0)
if "--issue" in args and args.index("--issue") + 1 < len(args):
    issue = args[args.index("--issue") + 1]
    if re.fullmatch(r"[A-Za-z0-9_-]+", issue):
        print(issue)
' "$(dirname "$0")/lib" 2>/dev/null)
    if [ -z "$ISSUE" ]; then
      exit 0
    fi
    emit "$(cat <<EOF
工单状态提醒：worktree 入口成功且带 --issue ${ISSUE}。
先核对适用 PRD 的产品评审确认、业务父需求、目标版本、负责人及当前操作授权；业务开发确认子任务已由开发创建并挂业务父需求，缺陷按缺陷关联规则处理。
读取 docs/agents/gitee-workflow-agent.md，按实际类型、细状态、授权和前置证据判断开工或恢复；已有执行者、已在测试或发布阶段、或已终止时先确认接手／返工范围，不自动抢占或重开，负责人相同不能证明可以恢复。
通过 docs/agents/issue-tracker.md 的 MCP 读取与认领流程更新最少字段并回读，不因 worktree 建立就自动改状态。
EOF
)"
    ;;
  mcp__gitee-ent__create_enterprise_repo_pull)
    emit "$(cat <<'EOF'
工单状态提醒：PR 已创建，保持业务状态。若关联工单，记录 PR 链接与工程验证。
若当前授权包含标签更新，给工单打 ready-for-review 标签（label id 用 list_enterprise_labels 查）；label_ids 是整体语义，先读取现有标签合并保留后整体写回并回读。
状态条件见 docs/agents/gitee-workflow-agent.md；MCP 操作见 docs/agents/issue-tracker.md。
EOF
)"
    ;;
  mcp__gitee-ent__merge_enterprise_pull)
    emit "$(cat <<'EOF'
工单状态提醒：PR 已合并，保持业务状态。关联工单记录合并结果。
后续读取 docs/agents/gitee-workflow-agent.md，核对各部署单元的实际部署覆盖、验收安排和授权；按证据逐票判断后续动作，PR 合并不能证明已提测或已上线。
合并不等于测试、实际部署或共同验收，不自动完成需求／任务／缺陷，也不自动添加旧完成标签；纯文档等无需部署的事项按实际交付处理。结论由相应负责人确认，Agent 不代签。
EOF
)"
    ;;
  *)
    exit 0
    ;;
esac
