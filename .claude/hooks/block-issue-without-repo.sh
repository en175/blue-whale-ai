#!/usr/bin/env bash
# Claude Code PreToolUse hook — 拦截创建 issue 时不关联仓库（project_id 缺失或为 0）
# 零依赖（grep/sed 解析 JSON，同 block-squash-merge.sh）。
#
# 拦截：mcp__gitee-ent__create_enterprise_issue 的 project_id 缺失 / 为空 / = 0
# 放行：project_id 非空且非 0（不校验是否等于具体仓库 ID —— 见 ADR-0007 D3）
#
# 为什么：project_id 在 MCP schema 里是 number；Gitee 用 0 表示「无关联」。
# 不关联仓库的 issue 只出现在企业工作项列表，仓库 Issues 页看不到（见 ADR-0007，
# 触发事件 IJZ5WA）。故 0 和缺失语义等价，都拦。
#
# 配套：settings.json PreToolUse matcher = mcp__gitee-ent__create_enterprise_issue。
# 退出码 2 = 阻断 Claude 执行该工具调用。

# 从 stdin 读 PreToolUse 的 JSON 输入
INPUT=$(cat)
# 提取 tool_input.project_id 的值（同时支持 number 无引号 / string 带引号两种形态）。
# grep 两种形态："project_id": "..."（string）或 "project_id": <digits>（number）。
# sed 去掉键名和可能的引号，留下纯值。jq 不可用时的零依赖兜底。
PROJECT_ID=$(printf '%s' "$INPUT" \
  | grep -oE '"project_id"[[:space:]]*:[[:space:]]*("[^"]*"|[0-9]+)' \
  | head -n1 \
  | sed -E 's/.*"project_id"[[:space:]]*:[[:space:]]*"?([^"]*)"?\s*$/\1/')

# project_id 缺失 / 空字符串 / 等于 0（Gitee 无关联哨兵）→ 拦截
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "0" ]; then
  cat >&2 <<EOF
BLOCKED: 创建 issue 未关联仓库（project_id 缺失或为 0）。
  project_id: ${PROJECT_ID:-（空）}

本项目所有 issue 必须关联到 blue-whale-ai 仓库：
- 不关联的 issue（project_id=0）只出现在企业工作项列表，仓库 Issues 页看不到
- 团队按仓库 Issues 查工单时会漏掉它（历史事件 IJZ5WA）

改法：创建时传 project_id（blue-whale-ai 仓库的 ID，
用 mcp__gitee-ent__list_enterprise_repositories 查）。
详见 docs/agents/issue-tracker.md「创建 issue」。
决策见 docs/adr/0007-issue-must-link-repo.md。
EOF
  exit 2
fi

exit 0
