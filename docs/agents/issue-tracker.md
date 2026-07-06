# Issue tracker: Gitee

本仓库的 issue 和 PRD 存放在 Gitee 仓库的 Issues 中。
远程地址：`git@gitee.com:hangzhou_xuanfu_1/blue-whale-ai.git`
（网页：https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues）

Gitee 不像 GitHub/GitLab 有成熟的 `gh`/`glab` 官方 CLI，因此本工作流以**自由文本**形式描述。操作 issue 时优先使用：

1. **Gitee MCP 工具**（如本会话中可用）：`mcp__gitee-ent__create_enterprise_issue`、`mcp__gitee-ent__list_enterprise_issues`、`mcp__gitee-ent__get_enterprise_issue_detail`、`mcp__gitee-ent__update_enterprise_issue`、`mcp__gitee-ent__comment_enterprise_issue`、`mcp__gitee-ent__list_enterprise_issue_comments`。
2. **Gitee 网页**（MCP 工具不可用时的回退）：通过上述网页地址手动创建/查看/评论。

## 约定（按操作）

- **创建 issue**：调用 `mcp__gitee-ent__create_enterprise_issue`（用 `enterprise_id` 定位本企业，传入 `title`/`description`；正文多行直接作为字符串传入 `description`）。**必须传 `project_id` 关联仓库**——blue-whale-ai 仓库的 ID 用 `mcp__gitee-ent__list_enterprise_repositories` 查。不传则工单只出现在企业工作项列表、仓库 Issues 页看不到（历史事件 IJZ5WA），PreToolUse hook `block-issue-without-repo.sh` 会硬拦。决策见 [ADR-0007](../adr/0007-issue-must-link-repo.md)。**打标签用 `label_ids`（逗号分隔的标签数字 ID，见下「加/移除标签」），不是 `labels`**——`create_enterprise_issue` 对企业私有仓库的 labels 会静默忽略，需紧跟一次 `update_enterprise_issue` 补 `label_ids`（见 [[gitee-collab-facts]] 第 4 条历史）。
- **读取 issue**：`mcp__gitee-ent__get_enterprise_issue_detail` 取详情；`mcp__gitee-ent__list_enterprise_issue_comments`（`enterprise_id`+`issue_id`）取评论。
- **列出 issue**：`mcp__gitee-ent__list_enterprise_issues`，用 `state`（open/closed/rejected/progressing）过滤；标签过滤用 `label_ids`（数字 ID）。
- **评论**：`mcp__gitee-ent__comment_enterprise_issue`（`enterprise_id`+`issue_id`+`body`）。
- **加/移除标签**：`mcp__gitee-ent__update_enterprise_issue`（`label_ids` 为逗号分隔的**标签数字 ID**；ID 用 `mcp__gitee-ent__list_enterprise_labels` 查。Gitee 标签要求长度 2–20、非特殊字符）。
- **关闭**：`mcp__gitee-ent__update_enterprise_issue`（**`issue_state_id`**，不是 `state`——`update_enterprise_issue` 无 `state` 入参）。合法状态枚举按 issue 所属「工作项类型」不同而不同：先 `mcp__gitee-ent__list_issue_type_states(enterprise_id, issue_type_id)` 查（本仓「需求」类型 = 意向/进行中/已完成/已拒绝，**无 closed/open**），完成 = 传「已完成」对应的 id；`issue_type_id` 从 `get_enterprise_issue_detail` 返回的 `issue_type.id` 取。设完成后 issue 的 `state` 字段会变成 `"closed"`。

企业版 MCP 工具用 `enterprise_id`（本企业 `16660949`）+ `issue_id` 定位，**非 owner/repo**；各工具确切参数（如是否需 `resource_type`）以 MCP schema 为准。远程地址从 `git remote -v` 读。

## Pull requests as a triage surface

**PRs as a request surface: no.**（Gitee 仓库当前不把外部 PR 作为功能请求入口。）

## 当技能说"publish to the issue tracker"

创建一个 Gitee issue（用上述 MCP 工具或网页）。

## 当技能说"fetch the relevant ticket"

用 `mcp__gitee-ent__get_enterprise_issue_detail` + `mcp__gitee-ent__list_enterprise_issue_comments` 读取该 issue 及其评论。
