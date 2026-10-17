#!/usr/bin/env bash
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
    raise SystemExit(0 if response.get("isError") is False else 1)
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
读取 docs/agents/gitee-workflow-agent.md，按实际类型、细状态、授权和前置证据判断开工或恢复。
通过 docs/agents/issue-tracker.md 的 MCP 读取与认领流程更新最少字段并回读。
已有执行者或交接不明时停止依赖写入，负责人相同不能证明可以恢复。
EOF
)"
    ;;
  mcp__gitee-ent__create_enterprise_repo_pull)
    emit "$(cat <<'EOF'
工单状态提醒：PR 已创建，保持业务状态。若关联工单，记录 PR 链接与工程验证。
给工单打 ready-for-review 标签，先读取现有 label_ids，合并保留后整体写回并回读。
状态条件见 docs/agents/gitee-workflow-agent.md；MCP 操作见 docs/agents/issue-tracker.md。
EOF
)"
    ;;
  mcp__gitee-ent__merge_enterprise_pull)
    emit "$(cat <<'EOF'
工单状态提醒：PR 已合并，保持业务状态。关联工单记录合并结果。
后续读取 docs/agents/gitee-workflow-agent.md，核对各部署单元的实际部署覆盖、验收安排和授权。
按证据逐票判断后续动作，PR 合并不能证明已提测或已上线。
EOF
)"
    ;;
  *)
    exit 0
    ;;
esac
