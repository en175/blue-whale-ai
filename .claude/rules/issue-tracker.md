# Gitee Issue 与 MCP 工具

Issues 追踪在 Gitee 仓库 `git@gitee.com:hangzhou_xuanfu_1/blue-whale-ai.git`。详细流程：`docs/agents/issue-tracker.md`

## 创建 Issue

- `mcp__gitee-ent__create_enterprise_issue` — **必传 `project_id`**（值用 `list_enterprise_repositories` 查），否则工单只在企业工作项可见、仓库 Issues 页看不到。
- `create` 对企业私有仓库的 `labels` 会静默忽略 → 紧跟 `update_enterprise_issue` 补 `label_ids`。

## 子 Issue

- 创建前先读父项，继承 `project_id` / `program_id`。
- 创建后用 `list_enterprise_issues(project_id, search=ident)` 反查，确保 AI Agent 能从仓库 Issues 拉到任务。
- 见 `docs/adr/0008`

## 标签

- `mcp__gitee-ent__update_enterprise_issue` — `label_ids` 为逗号分隔的**标签数字 ID**（非名称），ID 用 `list_enterprise_labels` 查。
- 长度 2–20，非特殊字符。
- Triage 五标签：needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix。详见 `docs/agents/triage-labels.md`

## 关闭 Issue

- `mcp__gitee-ent__update_enterprise_issue` — 用 `issue_state_id`，**不是 `state`**（该工具无此参数）。
- 先 `list_issue_type_states` 查合法状态枚举，传「已完成」对应的 id。

## 合并 PR

- `mcp__gitee-ent__merge_enterprise_pull` — `merge_method=merge`（或不传）。
- **无 `prune_source_branch` 参数**，Gitee merge 默认不删源分支。事后跑 `scripts/cleanup-task-worktree.sh`。
- 踩坑记录：`docs/agents/hooks/README.md`
